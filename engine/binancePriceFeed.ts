/**
 * Binance WebSocket Price Feed — Single Source of Truth
 * 
 * Replaces all REST polling with a persistent WebSocket connection
 * to Binance's real-time price stream. Updates marketState in-memory
 * and emits events for the Sentry Engine to react instantly.
 * 
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Ping/pong heartbeat to detect silent disconnections
 * - Proactive 23h50m reconnect to avoid Binance's 24h kill
 * - Scheduled maintenance window at 3:30 AM IST (22:00 UTC)
 * - Trade freeze 10 minutes before maintenance
 * - Telegram + dashboard notifications
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';

// Maintenance window: 3:30 AM IST = 22:00 UTC (previous day)
const MAINTENANCE_HOUR_UTC = 22;
const MAINTENANCE_MINUTE_UTC = 0;

export interface PriceFeedStatus {
  isConnected: boolean;
  isTradeFrozen: boolean;
  isMaintenanceWarning: boolean;
  maintenanceCountdownMinutes: number | null;
  reconnectAttempts: number;
  lastPriceUpdate: number;
  connectionUptime: number; // seconds
  symbolsTracked: number;
}

export class BinancePriceFeed extends EventEmitter {
  private ws: WebSocket | null = null;
  private marketState: Record<string, { price: number; lastChange: number }>;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000; // 30s cap
  private connectionStartTime = 0;
  private lastPriceUpdate = 0;
  private isConnected = false;
  private isMounted = true;

  // Maintenance window state
  private maintenanceCheckInterval: ReturnType<typeof setInterval> | null = null;
  private proactiveReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _isTradeFrozen = false;
  private _isMaintenanceWarning = false;
  private _maintenanceCountdownMinutes: number | null = null;

  // Track which symbols we care about (open positions, sentry configs, etc.)
  private trackedSymbols: Set<string> = new Set();

  constructor(marketState: Record<string, { price: number; lastChange: number }>) {
    super();
    this.marketState = marketState;
    // Allow many listeners (sentry, position monitor, etc.)
    this.setMaxListeners(50);
  }

  /**
   * Normalize symbol formats to a common key
   * "INJ/USDT" → "INJUSDT", "injusdt" → "INJUSDT"
   */
  private normalizeSymbol(symbol: string): string {
    return symbol.replace('/', '').toUpperCase();
  }

  /**
   * Add a symbol to track (e.g., when a trade opens or sentry activates)
   */
  trackSymbol(symbol: string) {
    const normalized = this.normalizeSymbol(symbol);
    this.trackedSymbols.add(normalized);
    // Also ensure marketState has an entry
    const slashFormat = this.toSlashFormat(normalized);
    if (!this.marketState[slashFormat] && !this.marketState[normalized]) {
      this.marketState[slashFormat] = { price: 0, lastChange: 0 };
    }
  }

  /**
   * Convert "INJUSDT" → "INJ/USDT" for marketState compatibility
   */
  private toSlashFormat(symbol: string): string {
    // Handle common quote currencies
    for (const quote of ['USDT', 'BUSD', 'BTC', 'ETH', 'BNB']) {
      if (symbol.endsWith(quote)) {
        return symbol.slice(0, -quote.length) + '/' + quote;
      }
    }
    return symbol;
  }

  /**
   * Start the WebSocket connection to Binance
   */
  start() {
    console.log('[PRICE FEED] 🚀 Starting Binance WebSocket price feed...');
    this.connect();
    this.startMaintenanceScheduler();
  }

  /**
   * Connect to Binance WebSocket
   */
  private connect() {
    if (!this.isMounted) return;

    try {
      // Use !miniTicker@arr — lightweight, pushes ALL symbols every ~1 second
      this.ws = new WebSocket('wss://stream.binance.com:9443/ws/!miniTicker@arr');

      this.ws.on('open', () => {
        console.log('[PRICE FEED] ✅ Connected to Binance WebSocket');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.connectionStartTime = Date.now();
        this.startHeartbeat();
        this.scheduleProactiveReconnect();
        this.emit('connected');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const tickers = JSON.parse(data.toString());
          if (!Array.isArray(tickers)) return;

          for (const t of tickers) {
            const rawSymbol = t.s; // e.g., "INJUSDT"
            if (!rawSymbol) continue;

            const normalizedSymbol = rawSymbol.toUpperCase();
            const slashSymbol = this.toSlashFormat(normalizedSymbol);
            const closePrice = parseFloat(t.c); // 'c' = close/last price

            if (isNaN(closePrice) || closePrice <= 0) continue;

            // Update marketState for BOTH formats (some code uses "INJ/USDT", some uses "INJUSDT")
            const updatePrice = (key: string) => {
              if (this.marketState[key]) {
                const lastPrice = this.marketState[key].price;
                this.marketState[key].lastChange = lastPrice > 0 ? closePrice - lastPrice : 0;
                this.marketState[key].price = closePrice;
              }
            };

            updatePrice(normalizedSymbol);
            updatePrice(slashSymbol);

            // Also initialize if this symbol is in our tracked set
            if (this.trackedSymbols.has(normalizedSymbol)) {
              if (!this.marketState[slashSymbol]) {
                this.marketState[slashSymbol] = { price: closePrice, lastChange: 0 };
              }
              if (!this.marketState[normalizedSymbol]) {
                this.marketState[normalizedSymbol] = { price: closePrice, lastChange: 0 };
              }
            }

            // Only emit events for symbols we actually care about
            if (this.marketState[normalizedSymbol] || this.marketState[slashSymbol]) {
              this.lastPriceUpdate = Date.now();
              
              // Emit the price update event (Sentry Engine listens to this)
              this.emit('price_update', {
                symbol: slashSymbol,
                rawSymbol: normalizedSymbol,
                price: closePrice,
              });
            }
          }
        } catch (err: any) {
          // Silently handle parse errors — don't crash the feed
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        console.log(`[PRICE FEED] ⚠️ Disconnected (code: ${code}, reason: ${reason.toString() || 'none'})`);
        this.isConnected = false;
        this.stopHeartbeat();
        this.emit('disconnected');

        if (this.isMounted) {
          this.reconnect();
        }
      });

      this.ws.on('error', (err: Error) => {
        console.error('[PRICE FEED] ❌ WebSocket error:', err.message);
        // The 'close' event will fire after this, triggering reconnect
      });

    } catch (err: any) {
      console.error('[PRICE FEED] Failed to create WebSocket:', err.message);
      if (this.isMounted) {
        this.reconnect();
      }
    }
  }

  /**
   * Reconnect with exponential backoff
   */
  private reconnect() {
    const delay = this.reconnectAttempts === 0
      ? 0 // Instant first retry
      : Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);

    this.reconnectAttempts++;
    console.log(`[PRICE FEED] 🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    setTimeout(() => {
      if (this.isMounted) {
        this.connect();
      }
    }, delay);
  }

  /**
   * Heartbeat — detect silent disconnections
   */
  private startHeartbeat() {
    this.stopHeartbeat();

    this.heartbeatInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.log('[PRICE FEED] ❌ Heartbeat detected dead connection');
        this.ws?.terminate();
        return;
      }

      // Send ping
      this.ws.ping();

      // If no pong within 10 seconds, force reconnect
      const pongTimeout = setTimeout(() => {
        console.log('[PRICE FEED] ❌ No pong received within 10s — forcing reconnect');
        this.ws?.terminate();
      }, 10000);

      this.ws.once('pong', () => clearTimeout(pongTimeout));
    }, 30000); // Every 30 seconds
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Proactive reconnect at 23h50m to avoid Binance's 24h forced kill
   * This creates a seamless handoff — no price gap
   */
  private scheduleProactiveReconnect() {
    if (this.proactiveReconnectTimer) {
      clearTimeout(this.proactiveReconnectTimer);
    }

    const reconnectDelay = (23 * 60 + 50) * 60 * 1000; // 23h 50m in ms

    this.proactiveReconnectTimer = setTimeout(() => {
      if (!this.isMounted) return;

      console.log('[PRICE FEED] 🔄 Proactive reconnect (23h50m reached) — seamless handoff...');

      const oldWs = this.ws;
      this.stopHeartbeat();

      // Open NEW connection first
      this.connect();

      // Close old one after 5 seconds (new one is already receiving data by then)
      setTimeout(() => {
        try {
          if (oldWs && oldWs.readyState === WebSocket.OPEN) {
            oldWs.close();
          }
        } catch {}
      }, 5000);
    }, reconnectDelay);
  }

  // ─── MAINTENANCE WINDOW SYSTEM ──────────────────────────────────

  /**
   * Schedule daily maintenance checks
   * Maintenance window: 3:30 AM IST = 22:00 UTC
   */
  private startMaintenanceScheduler() {
    // Check every minute
    this.maintenanceCheckInterval = setInterval(() => {
      this.checkMaintenanceWindow();
    }, 60 * 1000);

    // Also check immediately
    this.checkMaintenanceWindow();
  }

  /**
   * Check if we're approaching the maintenance window
   */
  private checkMaintenanceWindow() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMinute = now.getUTCMinutes();

    // Calculate minutes until maintenance (22:00 UTC = 3:30 AM IST)
    // Note: 22:00 UTC on May 2 = 3:30 AM IST on May 3
    let minutesUntilMaintenance: number;

    const currentMinutesInDay = utcHour * 60 + utcMinute;
    const maintenanceMinutesInDay = MAINTENANCE_HOUR_UTC * 60 + MAINTENANCE_MINUTE_UTC;

    if (currentMinutesInDay <= maintenanceMinutesInDay) {
      minutesUntilMaintenance = maintenanceMinutesInDay - currentMinutesInDay;
    } else {
      minutesUntilMaintenance = (24 * 60 - currentMinutesInDay) + maintenanceMinutesInDay;
    }

    // T-20 minutes: Warning phase
    if (minutesUntilMaintenance <= 20 && minutesUntilMaintenance > 10) {
      if (!this._isMaintenanceWarning) {
        this._isMaintenanceWarning = true;
        this._maintenanceCountdownMinutes = minutesUntilMaintenance;
        console.log(`[MAINTENANCE] ⚠️ Maintenance in ${minutesUntilMaintenance} minutes — warning active`);
        this.emit('maintenance_warning', { minutesRemaining: minutesUntilMaintenance });
      } else {
        this._maintenanceCountdownMinutes = minutesUntilMaintenance;
      }
    }
    // T-10 minutes: Trade freeze
    else if (minutesUntilMaintenance <= 10 && minutesUntilMaintenance > 0) {
      if (!this._isTradeFrozen) {
        this._isTradeFrozen = true;
        this._isMaintenanceWarning = true;
        this._maintenanceCountdownMinutes = minutesUntilMaintenance;
        console.log(`[MAINTENANCE] 🧊 TRADE FREEZE ACTIVATED — ${minutesUntilMaintenance} minutes until reconnect`);
        this.emit('trade_frozen', { minutesRemaining: minutesUntilMaintenance });
      } else {
        this._maintenanceCountdownMinutes = minutesUntilMaintenance;
      }
    }
    // Maintenance time: perform the reconnect
    else if (minutesUntilMaintenance === 0 || (utcHour === MAINTENANCE_HOUR_UTC && utcMinute === MAINTENANCE_MINUTE_UTC)) {
      console.log('[MAINTENANCE] 🔄 Performing scheduled maintenance reconnect...');
      this.performMaintenanceReconnect();
    }
    // Outside window: clear all flags
    else {
      if (this._isTradeFrozen || this._isMaintenanceWarning) {
        this._isTradeFrozen = false;
        this._isMaintenanceWarning = false;
        this._maintenanceCountdownMinutes = null;
        this.emit('maintenance_clear');
      }
    }
  }

  /**
   * Perform the actual scheduled reconnect during maintenance window
   */
  private performMaintenanceReconnect() {
    const oldWs = this.ws;
    this.stopHeartbeat();

    // Open new connection first
    this.connect();

    // Close old one after 5 seconds
    setTimeout(() => {
      try {
        if (oldWs && oldWs.readyState === WebSocket.OPEN) {
          oldWs.close();
        }
      } catch {}

      // Clear maintenance flags after successful reconnect
      setTimeout(() => {
        this._isTradeFrozen = false;
        this._isMaintenanceWarning = false;
        this._maintenanceCountdownMinutes = null;
        this.emit('maintenance_clear');
        console.log('[MAINTENANCE] ✅ Reconnect complete — all systems operational');
      }, 2000);
    }, 5000);
  }

  // ─── PUBLIC API ──────────────────────────────────────────────────

  /**
   * Is the trade freeze active? (10 min before maintenance)
   * Sentry Engine must check this before opening new trades
   */
  get isTradeFrozen(): boolean {
    return this._isTradeFrozen;
  }

  /**
   * Is the maintenance warning active? (20 min before maintenance)
   */
  get isMaintenanceWarning(): boolean {
    return this._isMaintenanceWarning;
  }

  /**
   * Get the full status for the frontend dashboard
   */
  getStatus(): PriceFeedStatus {
    return {
      isConnected: this.isConnected,
      isTradeFrozen: this._isTradeFrozen,
      isMaintenanceWarning: this._isMaintenanceWarning,
      maintenanceCountdownMinutes: this._maintenanceCountdownMinutes,
      reconnectAttempts: this.reconnectAttempts,
      lastPriceUpdate: this.lastPriceUpdate,
      connectionUptime: this.connectionStartTime > 0 ? Math.floor((Date.now() - this.connectionStartTime) / 1000) : 0,
      symbolsTracked: Object.keys(this.marketState).length,
    };
  }

  /**
   * Gracefully stop the price feed
   */
  stop() {
    console.log('[PRICE FEED] 🛑 Stopping Binance price feed...');
    this.isMounted = false;
    this.stopHeartbeat();

    if (this.maintenanceCheckInterval) {
      clearInterval(this.maintenanceCheckInterval);
      this.maintenanceCheckInterval = null;
    }

    if (this.proactiveReconnectTimer) {
      clearTimeout(this.proactiveReconnectTimer);
      this.proactiveReconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }
}

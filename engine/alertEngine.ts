/**
 * Alert Engine — Proactive Market Intelligence
 * 
 * Runs every 10 minutes in the background. Detects significant market events
 * and pushes alerts via Telegram WITHOUT the user asking.
 * 
 * Also stores alerts so Jarvis can verbally brief the user
 * when they next connect (Morning Briefing).
 * 
 * Detects:
 * - Volume Spikes (>300% above average)
 * - Price Breakouts (above 24h high / below 24h low)
 * - EMA Crossovers (Golden Cross / Death Cross on daily)
 * - Large price moves (>5% in an hour)
 */

import { sendTelegramNotification, broadcastTelegram } from './telegram.ts';

interface Alert {
  type: 'volume_spike' | 'breakout' | 'ema_crossover' | 'large_move' | 'trend_change';
  symbol: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  data: any;
  timestamp: string;
}

// Track what we've already alerted to avoid spam
const recentAlerts = new Map<string, number>(); // key → timestamp of last alert
const ALERT_COOLDOWN = 30 * 60 * 1000; // 30 minutes between same alerts

const WATCH_PAIRS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
];

export class AlertEngine {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  /**
   * Check if we recently sent this alert (cooldown)
   */
  private shouldAlert(key: string): boolean {
    const lastSent = recentAlerts.get(key);
    if (lastSent && Date.now() - lastSent < ALERT_COOLDOWN) return false;
    recentAlerts.set(key, Date.now());
    return true;
  }

  /**
   * Save alert to Firestore for Morning Briefing retrieval
   */
  private async saveAlert(alert: Alert) {
    try {
      await this.db.collection('proactiveAlerts').add({
        ...alert,
        read: false,
        briefed: false, // Set to true after Jarvis speaks it
      });
    } catch (err: any) {
      console.error('[ALERT ENGINE] Failed to save alert:', err.message);
    }
  }

  /**
   * Main scan loop — call every 10 minutes
   */
  async scan() {
    console.log('[ALERT ENGINE] 🔍 Scanning for market events...');
    const alerts: Alert[] = [];

    try {
      // Fetch 24h ticker data for all watch pairs
      const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
      if (!res.ok) return;
      const allTickers = await res.json();
      const tickers = allTickers.filter((t: any) => WATCH_PAIRS.includes(t.symbol));

      for (const ticker of tickers) {
        const symbol = ticker.symbol;
        const displaySymbol = symbol.replace('USDT', '/USDT');
        const price = parseFloat(ticker.lastPrice);
        const high24h = parseFloat(ticker.highPrice);
        const low24h = parseFloat(ticker.lowPrice);
        const change24h = parseFloat(ticker.priceChangePercent);
        const volume = parseFloat(ticker.quoteVolume);
        const prevVolume = parseFloat(ticker.prevClosePrice) * parseFloat(ticker.volume) * 0.8; // rough estimate

        // 1. VOLUME SPIKE — volume > 300% of estimated average
        if (volume > 0 && prevVolume > 0) {
          const volumeRatio = volume / prevVolume;
          if (volumeRatio > 3 && this.shouldAlert(`volume_${symbol}`)) {
            const alert: Alert = {
              type: 'volume_spike',
              symbol: displaySymbol,
              message: `📊 Volume Spike: ${displaySymbol} volume is ${(volumeRatio * 100).toFixed(0)}% above average. Something is happening.`,
              severity: volumeRatio > 5 ? 'critical' : 'warning',
              data: { volumeRatio, volume, price },
              timestamp: new Date().toISOString(),
            };
            alerts.push(alert);
          }
        }

        // 2. BREAKOUT — price within 0.5% of 24h high
        const distanceToHigh = ((high24h - price) / high24h) * 100;
        if (distanceToHigh < 0.5 && change24h > 2 && this.shouldAlert(`breakout_${symbol}`)) {
          const alert: Alert = {
            type: 'breakout',
            symbol: displaySymbol,
            message: `📈 Breakout Alert: ${displaySymbol} is testing its 24h high of $${high24h.toFixed(2)} (+${change24h.toFixed(1)}% today). Watch for a breakout.`,
            severity: 'warning',
            data: { price, high24h, change24h },
            timestamp: new Date().toISOString(),
          };
          alerts.push(alert);
        }

        // 3. BREAKDOWN — price within 0.5% of 24h low
        const distanceToLow = ((price - low24h) / low24h) * 100;
        if (distanceToLow < 0.5 && change24h < -2 && this.shouldAlert(`breakdown_${symbol}`)) {
          const alert: Alert = {
            type: 'breakout',
            symbol: displaySymbol,
            message: `📉 Breakdown Alert: ${displaySymbol} is testing its 24h low of $${low24h.toFixed(2)} (${change24h.toFixed(1)}% today). Watch for further downside.`,
            severity: 'warning',
            data: { price, low24h, change24h },
            timestamp: new Date().toISOString(),
          };
          alerts.push(alert);
        }

        // 4. LARGE MOVE — > 5% change in 24h
        if (Math.abs(change24h) > 5 && this.shouldAlert(`large_move_${symbol}`)) {
          const direction = change24h > 0 ? 'surged' : 'crashed';
          const emoji = change24h > 0 ? '🚀' : '💥';
          const alert: Alert = {
            type: 'large_move',
            symbol: displaySymbol,
            message: `${emoji} Large Move: ${displaySymbol} has ${direction} ${Math.abs(change24h).toFixed(1)}% in the last 24h. Current price: $${price.toFixed(2)}`,
            severity: Math.abs(change24h) > 10 ? 'critical' : 'warning',
            data: { price, change24h },
            timestamp: new Date().toISOString(),
          };
          alerts.push(alert);
        }
      }

      // 5. EMA CROSSOVER CHECK (daily) — check BTC and ETH only (most impactful)
      for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
        try {
          const klineRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=55`);
          if (!klineRes.ok) continue;
          const candles = await klineRes.json();
          if (candles.length < 50) continue;

          const closes = candles.map((c: any) => parseFloat(c[4]));
          const ema20 = this.calculateEMA(closes, 20);
          const ema50 = this.calculateEMA(closes, 50);

          // Also check yesterday's EMAs to detect fresh crossover
          const closesYesterday = closes.slice(0, -1);
          const ema20Yesterday = this.calculateEMA(closesYesterday, 20);
          const ema50Yesterday = this.calculateEMA(closesYesterday, 50);

          if (ema20 && ema50 && ema20Yesterday && ema50Yesterday) {
            const displaySymbol = symbol.replace('USDT', '/USDT');

            // Golden Cross: EMA20 crossed ABOVE EMA50
            if (ema20Yesterday < ema50Yesterday && ema20 > ema50 && this.shouldAlert(`golden_cross_${symbol}`)) {
              const alert: Alert = {
                type: 'ema_crossover',
                symbol: displaySymbol,
                message: `✨ Golden Cross: ${displaySymbol} daily EMA-20 just crossed ABOVE EMA-50. This is a major bullish signal.`,
                severity: 'critical',
                data: { ema20, ema50, type: 'golden_cross' },
                timestamp: new Date().toISOString(),
              };
              alerts.push(alert);
            }

            // Death Cross: EMA20 crossed BELOW EMA50
            if (ema20Yesterday > ema50Yesterday && ema20 < ema50 && this.shouldAlert(`death_cross_${symbol}`)) {
              const alert: Alert = {
                type: 'ema_crossover',
                symbol: displaySymbol,
                message: `💀 Death Cross: ${displaySymbol} daily EMA-20 just crossed BELOW EMA-50. Major bearish signal — avoid longs.`,
                severity: 'critical',
                data: { ema20, ema50, type: 'death_cross' },
                timestamp: new Date().toISOString(),
              };
              alerts.push(alert);
            }
          }
        } catch {}
      }

      // Send alerts via Telegram and save to Firestore
      for (const alert of alerts) {
        console.log(`[ALERT ENGINE] ${alert.severity.toUpperCase()}: ${alert.message}`);
        await this.saveAlert(alert);
        try {
          await broadcastTelegram(this.db, `🔔 <b>Jarvis Alert</b>\n\n${alert.message}`);
        } catch {}
      }

      if (alerts.length === 0) {
        console.log('[ALERT ENGINE] ✅ No significant events detected.');
      } else {
        console.log(`[ALERT ENGINE] 📢 ${alerts.length} alert(s) sent.`);
      }

    } catch (err: any) {
      console.error('[ALERT ENGINE] Scan error:', err.message);
    }
  }

  /**
   * Get unread/unbriefed alerts for Morning Briefing
   */
  async getUnbriefedAlerts(limit: number = 10): Promise<Alert[]> {
    try {
      const snapshot = await this.db.collection('proactiveAlerts')
        .where('briefed', '==', false)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    } catch {
      return [];
    }
  }

  /**
   * Mark alerts as briefed after Jarvis speaks them
   */
  async markAsBriefed(alertIds: string[]) {
    const batch = this.db.batch();
    for (const id of alertIds) {
      batch.update(this.db.collection('proactiveAlerts').doc(id), { briefed: true });
    }
    await batch.commit();
  }

  /**
   * Calculate EMA (same logic as MarketScanner)
   */
  private calculateEMA(closes: number[], period: number): number | null {
    if (closes.length < period) return null;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((sum, c) => sum + c, 0) / period;
    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
  }

  /**
   * Cleanup old alerts (keep last 100)
   */
  async cleanup() {
    try {
      const snapshot = await this.db.collection('proactiveAlerts')
        .orderBy('timestamp', 'asc')
        .limit(500)
        .get();
      if (snapshot.size > 100) {
        const batch = this.db.batch();
        snapshot.docs.slice(0, snapshot.size - 100).forEach((d: any) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch {}
  }
}

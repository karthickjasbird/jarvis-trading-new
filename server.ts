import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import admin from "firebase-admin";
import ccxt from "ccxt";
import { KiteConnect } from "kiteconnect";
import { WebSocketServer } from "ws";
import fs from "fs";
import { TradeExecutor } from "./engine/tradeExecutor.ts";
import { SentryEngine } from "./engine/sentry.ts";
import { RSI, MACD, EMA } from "technicalindicators";

// Simple file logger
const logFile = fs.createWriteStream("startup.log", { flags: "a" });
const log = (msg: string) => {
  logFile.write(`[${new Date().toISOString()}] ${msg}\n`);
  console.log(msg);
};

log("Starting server.ts...");

// Initialize Firebase Admin for the backend
let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    log("Successfully loaded serviceAccount from environment variable.");
  } else {
    serviceAccount = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'serviceAccountKey.json'), 'utf8'));
    log("Successfully loaded serviceAccountKey.json.");
  }
} catch (error) {
  log("WARNING: serviceAccountKey.json not found or invalid! Firebase Admin operations will fail.");
}

if (!admin.apps.length) {
  const config: admin.AppOptions = {
    projectId: "jarvis-trading-terminal", // from firebase-applet-config.json
  };
  
  if (serviceAccount) {
    config.credential = admin.credential.cert(serviceAccount);
  } else {
    // Attempt default but print warning instead of error
    log("No service account provided. API queries to Firestore will use mock data.");
  }
  
  admin.initializeApp(config);
}

const db = admin.firestore();
// Use the named database from the config
db.settings({ databaseId: "ai-studio-fc057d01-a1ff-4b62-a9e8-e1c62f9f3a10" });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Sentry Mode Backend is running" });
  });

  // --- BROKER INTEGRATION ROUTES ---

  // 1. Zerodha (Kite Connect) OAuth Callback (Popup Handler)
  app.get("/api/broker/zerodha/callback", async (req, res) => {
    const { request_token, action, status } = req.query;
    
    // We render a simple HTML page that posts the token back to the parent window (our React app)
    // This avoids cross-origin cookie issues in the iframe environment.
    res.send(`
      <html>
        <head><title>Authenticating...</title></head>
        <body style="background: #18181b; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh;">
          <div style="text-align: center;">
            <h2>Authentication Successful</h2>
            <p>Redirecting back to Jarvis...</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'ZERODHA_AUTH', 
                  request_token: '${request_token}', 
                  status: '${status}' 
                }, '*');
                setTimeout(() => window.close(), 1000);
              } else {
                document.body.innerHTML += "<p>Error: Please close this window and try again.</p>";
              }
            </script>
          </div>
        </body>
      </html>
    `);
  });

  // 1b. Exchange Request Token for Access Token
  app.post("/api/broker/zerodha/exchange-token", async (req, res) => {
    const { userId, requestToken, configId } = req.body;
    
    if (!userId || !requestToken || !configId) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      // Fetch the broker config from Firestore
      const configRef = db.collection("users").doc(userId).collection("brokerConfigs").doc(configId);
      const configDoc = await configRef.get();
      
      if (!configDoc.exists) {
        return res.status(404).json({ error: "Broker configuration not found" });
      }
      
      const config = configDoc.data()!;
      
      // Initialize KiteConnect and generate session
      const kc = new KiteConnect({ api_key: config.apiKey });
      const session = await kc.generateSession(requestToken, config.apiSecret);
      
      // Save the daily access token to Firestore
      await configRef.update({
        accessToken: session.access_token,
        publicToken: session.public_token,
        lastLogin: new Date().toISOString()
      });

      res.json({ status: "success", message: "Daily access token generated successfully" });
    } catch (error: any) {
      console.error("Zerodha Token Exchange Error:", error);
      res.status(500).json({ error: error.message || "Failed to exchange token" });
    }
  });

  // 2. Test CCXT Connection
  app.post("/api/broker/ccxt/test", async (req, res) => {
    const { exchangeId, apiKey, secret } = req.body;
    try {
      if (!ccxt.exchanges.includes(exchangeId)) {
        return res.status(400).json({ error: "Unsupported exchange" });
      }
      
      const exchangeClass = (ccxt as any)[exchangeId];
      const exchange = new exchangeClass({
        apiKey: apiKey,
        secret: secret,
      });

      // Test the connection by fetching balance
      const balance = await exchange.fetchBalance();
      res.json({ status: "success", message: "Connected to " + exchangeId, balance: balance.total });
    } catch (error: any) {
      console.error("CCXT Test Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- LIVE MARKET DATA (HTTP POLLING MATRIX) ---
  // Global state to simulate the market across all clients
  const marketState: Record<string, { price: number, lastChange: number }> = {};

  // --- TRADE EXECUTION ENGINE ---
  const tradeExecutor = new TradeExecutor(db, marketState);
  const sentryEngine = new SentryEngine(db, tradeExecutor, marketState);

  // Run Sentry Engine every 5 seconds
  setInterval(() => sentryEngine.monitor(), 5000);

  // --- SENTRY MODE ROUTES ---
  app.post("/api/sentry/activate", async (req, res) => {
    const { userId, maxDailyLoss, targetDailyProfit } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      await db.collection('sentryConfigs').doc(userId).set({
        active: true,
        maxDailyLoss: Number(maxDailyLoss),
        targetDailyProfit: targetDailyProfit ? Number(targetDailyProfit) : null,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      res.json({ status: "success" });
    } catch (error: any) {
      console.error("Failed to activate Sentry Mode:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/sentry/deactivate", async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      await db.collection('sentryConfigs').doc(userId).set({
        active: false,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      res.json({ status: "success" });
    } catch (error: any) {
      console.error("Failed to deactivate Sentry Mode:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- RISK MANAGEMENT ROUTES ---
  app.get("/api/risk-settings", async (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      const doc = await db.collection('riskSettings').doc(userId).get();
      if (!doc.exists) {
        // Return defaults
        return res.json({
          status: "success",
          settings: {
            maxDailyLoss: 1000,
            maxPositionSizePct: 20,
            autoLiquidateThreshold: 500,
            requireConfirmation: false
          }
        });
      }
      res.json({ status: "success", settings: doc.data() });
    } catch (error: any) {
      if (!serviceAccount && error.message?.includes('default credentials')) {
        return res.json({
          status: "success",
          settings: { maxDailyLoss: 1000, maxPositionSizePct: 20, autoLiquidateThreshold: 500, requireConfirmation: false }
        });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/risk-settings", async (req, res) => {
    const { userId, settings } = req.body;
    if (!userId || !settings) return res.status(400).json({ error: "userId and settings are required" });

    try {
      await db.collection('riskSettings').doc(userId).set({
        ...settings,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      res.json({ status: "success" });
    } catch (error: any) {
      if (!serviceAccount && error.message?.includes('default credentials')) {
        return res.json({ status: "success" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Execute a real trade (via CCXT / paper trading)
  app.post("/api/trade", async (req, res) => {
    const { userId, symbol, side, quantity, market, mode, stopLossPrice, takeProfitPrice, trailingStopDistance, isPractice } = req.body;
    
    if (!userId || !symbol || !side || !quantity) {
      return res.status(400).json({ error: "Missing required fields: userId, symbol, side, quantity" });
    }

    if (!['buy', 'sell'].includes(side)) {
      return res.status(400).json({ error: "Side must be 'buy' or 'sell'" });
    }

    try {
      const result = await tradeExecutor.execute({
        userId,
        symbol,
        side,
        quantity: parseFloat(quantity),
        market: market || 'crypto',
        mode: mode || 'copilot',
        isPractice: isPractice || false,
        stopLossPrice: stopLossPrice ? parseFloat(stopLossPrice) : undefined,
        takeProfitPrice: takeProfitPrice ? parseFloat(takeProfitPrice) : undefined,
        trailingStopDistance: trailingStopDistance ? parseFloat(trailingStopDistance) : undefined,
      });

      res.json({ status: "success", ...result });
    } catch (error: any) {
      if (!serviceAccount && error.message?.includes('default credentials')) {
        return res.json({
          tradeId: `mock-${Date.now()}`,
          orderId: `mock-order-${Date.now()}`,
          symbol,
          side,
          quantity: parseFloat(quantity),
          fillPrice: marketState[symbol] ? marketState[symbol].price : 100,
          filledQuantity: parseFloat(quantity),
          status: "filled",
          market: market || 'crypto',
          mode: mode || 'copilot',
          timestamp: new Date().toISOString(),
        });
      }
      console.error("Trade execution failed:", error);
      res.status(500).json({ error: error.message || "Trade execution failed" });
    }
  });

  // Close a position
  app.post("/api/trade/close", async (req, res) => {
    const { userId, tradeId } = req.body;
    
    if (!userId || !tradeId) {
      return res.status(400).json({ error: "Missing required fields: userId, tradeId" });
    }

    try {
      const result = await tradeExecutor.closePosition(userId, tradeId);
      res.json({ status: "success", ...result });
    } catch (error: any) {
      console.error("Trade close failed:", error);
      res.status(500).json({ error: error.message || "Trade close failed" });
    }
  });

  // Get open positions with live P&L
  app.get("/api/positions", async (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      const positions = await tradeExecutor.getOpenPositions(userId);
      res.json({ status: "success", positions });
    } catch (error: any) {
      if (!serviceAccount && error.message?.includes('default credentials')) {
        return res.json({ status: "success", positions: [] });
      }
      console.error("Failed to fetch positions:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Close a specific position
  app.post("/api/positions/close", async (req, res) => {
    const { userId, tradeId } = req.body;
    if (!userId || !tradeId) return res.status(400).json({ error: "userId and tradeId are required" });

    try {
      const result = await tradeExecutor.closePosition(userId, tradeId);
      res.json({ status: "success", ...result });
    } catch (error: any) {
      if (!serviceAccount && error.message?.includes('default credentials')) {
        return res.json({ tradeId, exitPrice: 100, realizedPnl: 0, status: "closed" });
      }
      console.error("Failed to close position:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Phase C: Market Intel (News & Whale Alerts) ---
  
  // Mock News Data Generator
  const generateMockNews = () => {
    const symbols = ['BTC', 'ETH', 'SOL', 'AAPL', 'TSLA', 'NVDA'];
    const sentiments = ['bullish', 'bearish', 'neutral'];
    const headlines = [
      "Institutional inflows reach new monthly high for {symbol}",
      "{symbol} faces regulatory scrutiny in the EU",
      "Major protocol upgrade announced for {symbol}",
      "{symbol} breaks key resistance level amid high volume",
      "Whales are accumulating {symbol} at current price levels",
      "Market sentiment shifts as {symbol} shows weakness",
      "New partnership could drive {symbol} adoption",
      "Macro factors weighing heavily on {symbol} performance"
    ];

    return Array.from({ length: 8 }).map((_, i) => {
      const symbol = symbols[Math.floor(Math.random() * symbols.length)];
      const sentiment = sentiments[Math.floor(Math.random() * sentiments.length)];
      const headlineTemplate = headlines[Math.floor(Math.random() * headlines.length)];
      
      return {
        id: `news-${Date.now()}-${i}`,
        title: headlineTemplate.replace('{symbol}', symbol),
        symbol,
        sentiment,
        source: ['CoinDesk', 'Bloomberg', 'Reuters', 'CryptoPanic'][Math.floor(Math.random() * 4)],
        publishedAt: new Date(Date.now() - Math.random() * 86400000).toISOString(), // Past 24h
        url: '#'
      };
    }).sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  };

  // Mock Whale Alerts Generator
  const generateWhaleAlerts = () => {
    const symbols = ['BTC', 'ETH', 'SOL', 'USDT', 'USDC'];
    const actions = ['transferred', 'bought', 'sold', 'staked', 'unstaked'];
    const locations = ['Unknown Wallet', 'Binance', 'Coinbase', 'Kraken', 'Bitfinex'];

    return Array.from({ length: 5 }).map((_, i) => {
      const symbol = symbols[Math.floor(Math.random() * symbols.length)];
      const action = actions[Math.floor(Math.random() * actions.length)];
      const amount = Math.floor(Math.random() * 10000) + (symbol === 'BTC' ? 100 : 1000);
      const valueUsd = amount * (marketState[symbol]?.price || 50000);
      
      return {
        id: `whale-${Date.now()}-${i}`,
        symbol,
        action,
        amount,
        valueUsd,
        from: locations[Math.floor(Math.random() * locations.length)],
        to: locations[Math.floor(Math.random() * locations.length)],
        timestamp: new Date(Date.now() - Math.random() * 3600000).toISOString(), // Past hour
        urgency: valueUsd > 50000000 ? 'high' : valueUsd > 10000000 ? 'medium' : 'low'
      };
    }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  app.get("/api/data/news", (req, res) => {
    // In a real app, this would fetch from CryptoPanic API, NewsAPI, etc.
    res.json({ status: "success", data: generateMockNews() });
  });

  app.get("/api/data/whales", (req, res) => {
    // In a real app, this would fetch from Whale Alert API or on-chain indexers
    res.json({ status: "success", data: generateWhaleAlerts() });
  });

  // PANIC: Close ALL open positions immediately
  app.post("/api/panic-close-all", async (req, res) => {
    const { userId, isPracticeMode } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    log(`⚠️ PANIC CLOSE ALL triggered for user ${userId} (Practice: ${isPracticeMode})`);

    try {
      const results = await tradeExecutor.panicCloseAll(userId, isPracticeMode);
      const totalPnl = results.reduce((sum, r) => sum + (r.realizedPnl || 0), 0);
      
      res.json({ 
        status: "success", 
        message: `Closed ${results.length} positions`,
        results,
        totalRealizedPnl: parseFloat(totalPnl.toFixed(2)),
      });
    } catch (error: any) {
      if (!serviceAccount && error.message?.includes('default credentials')) {
        return res.json({ status: "success", message: "Closed 0 positions (mock)", results: [], totalRealizedPnl: 0 });
      }
      console.error("PANIC CLOSE FAILED:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get trade history (closed trades)
  app.get("/api/trades/history", async (req, res) => {
    const userId = req.query.userId as string;
    const limit = parseInt(req.query.limit as string) || 50;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      const trades = await tradeExecutor.getTradeHistory(userId, limit);
      res.json({ status: "success", trades });
    } catch (error: any) {
      if (!serviceAccount && error.message?.includes('default credentials')) {
        return res.json({ status: "success", trades: [] });
      }
      console.error("Failed to fetch trade history:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get daily P&L summary
  app.get("/api/daily-pnl", async (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      const pnl = await tradeExecutor.getDailyPnl(userId);
      res.json({ status: "success", ...pnl });
    } catch (error: any) {
      if (!serviceAccount && error.message?.includes('default credentials')) {
        return res.json({ status: "success", realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0, tradesCount: 0, winCount: 0, lossCount: 0 });
      }
      console.error("Failed to fetch daily P&L:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Initialize Binance Testnet
  const binance = new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_SECRET_KEY,
  });
  binance.setSandboxMode(true);

  // --- WEBSOCKET SERVER FOR REAL-TIME DATA ---
  // (WebSocketServer will be attached at the end of the file)
  const wss = new WebSocketServer({ noServer: true });
  
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const symbol = url.searchParams.get('symbol');
    const replayDate = url.searchParams.get('replayDate');
    const speed = parseInt(url.searchParams.get('speed') || '1');
    
    if (symbol) {
      // Initialize symbol if it doesn't exist
      if (!marketState[symbol]) {
        marketState[symbol] = { 
          price: symbol.includes('BTC') ? 65000 : (symbol.includes('ETH') ? 3500 : 2500), 
          lastChange: 0 
        };
      }
      
      // Store symbol on the connection object for filtering later
      (ws as any).symbol = symbol;
      (ws as any).isReplay = !!replayDate;
      
      if (replayDate) {
        // Handle Replay Mode
        let currentReplayTime = new Date(replayDate).getTime();
        let currentPrice = marketState[symbol].price;
        
        // Start a dedicated interval for this replay client
        const replayInterval = setInterval(() => {
          if (ws.readyState !== 1) {
            clearInterval(replayInterval);
            return;
          }
          
          // Simulate historical price movement
          const volatility = currentPrice * 0.001;
          const change = (Math.random() - 0.5) * volatility;
          currentPrice += change;
          
          // Advance time based on speed (e.g., 1 real second = 1 minute if speed=60)
          currentReplayTime += (1000 * speed);
          
          ws.send(JSON.stringify({
            type: 'tick',
            symbol,
            timestamp: currentReplayTime,
            price: parseFloat(currentPrice.toFixed(2)),
            change: parseFloat(change.toFixed(2)),
            volume: Math.floor(Math.random() * 500) + 50,
            isReplay: true
          }));
        }, 1000); // Tick every 1 real second
        
        (ws as any).replayInterval = replayInterval;
      } else {
        // Send initial tick for live mode
        ws.send(JSON.stringify({
          type: 'tick',
          symbol,
          timestamp: Date.now(),
          price: parseFloat(marketState[symbol].price.toFixed(2)),
          change: parseFloat(marketState[symbol].lastChange.toFixed(2)),
          volume: Math.floor(Math.random() * 100) + 1,
        }));
      }
    }
    
    ws.on('close', () => {
      if ((ws as any).replayInterval) {
        clearInterval((ws as any).replayInterval);
      }
    });
  });

  // Update prices in the background (parallel fetches)
  setInterval(async () => {
    const symbols = Object.keys(marketState);
    
    // Separate crypto (real fetch) from simulated symbols
    const cryptoSymbols = symbols.filter(s => s.includes('BTC') || s.includes('ETH'));
    const simulatedSymbols = symbols.filter(s => !s.includes('BTC') && !s.includes('ETH'));

    // Fetch all crypto tickers in parallel
    const cryptoPromises = cryptoSymbols.map(async (symbol) => {
      try {
        const ticker = await binance.fetchTicker(symbol);
        if (ticker && ticker.last !== undefined) {
          const currentPrice = ticker.last;
          const lastPrice = marketState[symbol].price;
          marketState[symbol].lastChange = lastPrice > 0 ? currentPrice - lastPrice : 0;
          marketState[symbol].price = currentPrice;
        }
      } catch (e) {
        console.error(`Failed to fetch ticker for ${symbol}:`, e);
      }
    });

    await Promise.allSettled(cryptoPromises);

    // Simulate non-crypto symbols (instant, no awaiting needed)
    for (const symbol of simulatedSymbols) {
      const volatility = marketState[symbol].price * 0.0005;
      const change = (Math.random() - 0.5) * volatility;
      marketState[symbol].price += change;
      marketState[symbol].lastChange = change;
    }
    
    // Broadcast to WebSocket clients
    wss.clients.forEach((client) => {
      if (client.readyState === 1 && !(client as any).isReplay) { // WebSocket.OPEN and not replay
        const symbol = (client as any).symbol;
        if (symbol && marketState[symbol]) {
          client.send(JSON.stringify({
            type: 'tick',
            symbol,
            timestamp: Date.now(),
            price: parseFloat(marketState[symbol].price.toFixed(2)),
            change: parseFloat(marketState[symbol].lastChange.toFixed(2)),
            volume: Math.floor(Math.random() * 100) + 1,
          }));
        }
      }
    });
  }, 2000); // Poll every 2 seconds to respect rate limits

  app.get('/api/market-data', (req, res) => {
    const symbol = req.query.symbol as string;
    
    if (!symbol) {
      return res.status(400).json({ error: "Symbol is required" });
    }

    // Initialize symbol if it doesn't exist
    if (!marketState[symbol]) {
      marketState[symbol] = { 
        price: symbol.includes('BTC') ? 65000 : (symbol.includes('ETH') ? 3500 : 2500), 
        lastChange: 0 
      };
    }

    const tick = {
      type: 'tick',
      symbol,
      timestamp: Date.now(),
      price: parseFloat(marketState[symbol].price.toFixed(2)),
      change: parseFloat(marketState[symbol].lastChange.toFixed(2)),
      volume: Math.floor(Math.random() * 100) + 1,
    };
    
    res.json(tick);
  });

  // --- TECHNICAL ANALYSIS ENGINE ---
  app.get('/api/analysis', async (req, res) => {
    const symbol = req.query.symbol as string;
    const timeframe = (req.query.timeframe as string) || '1h';
    
    if (!symbol) {
      return res.status(400).json({ error: "Symbol is required" });
    }

    try {
      // Fetch OHLCV data from Binance
      // Format: [ timestamp, open, high, low, close, volume ]
      const ohlcv = await binance.fetchOHLCV(symbol, timeframe, undefined, 250);
      
      if (!ohlcv || ohlcv.length === 0) {
        return res.status(404).json({ error: "No data found for symbol" });
      }

      const closes = ohlcv.map(candle => candle[4]);
      const currentPrice = closes[closes.length - 1];

      // Calculate RSI (14)
      const rsiInput = { values: closes, period: 14 };
      const rsiResult = RSI.calculate(rsiInput);
      const currentRsi = rsiResult.length > 0 ? rsiResult[rsiResult.length - 1] : null;

      // Calculate MACD
      const macdInput = {
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
      };
      const macdResult = MACD.calculate(macdInput);
      const currentMacd = macdResult.length > 0 ? macdResult[macdResult.length - 1] : null;

      // Calculate EMAs
      const ema20Result = EMA.calculate({ values: closes, period: 20 });
      const ema50Result = EMA.calculate({ values: closes, period: 50 });
      const ema200Result = EMA.calculate({ values: closes, period: 200 });

      const currentEma20 = ema20Result.length > 0 ? ema20Result[ema20Result.length - 1] : null;
      const currentEma50 = ema50Result.length > 0 ? ema50Result[ema50Result.length - 1] : null;
      const currentEma200 = ema200Result.length > 0 ? ema200Result[ema200Result.length - 1] : null;

      // Determine basic trend
      let trend = "Neutral";
      if (currentEma20 && currentEma50) {
        if (currentPrice > currentEma20 && currentEma20 > currentEma50) {
          trend = "Bullish";
        } else if (currentPrice < currentEma20 && currentEma20 < currentEma50) {
          trend = "Bearish";
        }
      }

      // Candlestick Pattern Recognition (Last 2 candles)
      const lastCandle = ohlcv[ohlcv.length - 1];
      const prevCandle = ohlcv[ohlcv.length - 2];
      
      const [lTime, lOpen, lHigh, lLow, lClose] = lastCandle;
      const [pTime, pOpen, pHigh, pLow, pClose] = prevCandle;
      
      const patterns = [];
      
      // Doji
      const bodySize = Math.abs(lOpen - lClose);
      const totalSize = lHigh - lLow;
      if (bodySize <= totalSize * 0.1) {
        patterns.push("Doji");
      }
      
      // Hammer / Hanging Man
      const lowerShadow = Math.min(lOpen, lClose) - lLow;
      const upperShadow = lHigh - Math.max(lOpen, lClose);
      if (lowerShadow >= bodySize * 2 && upperShadow <= bodySize * 0.2) {
        patterns.push("Hammer");
      }
      
      // Shooting Star / Inverted Hammer
      if (upperShadow >= bodySize * 2 && lowerShadow <= bodySize * 0.2) {
        patterns.push("Shooting Star");
      }
      
      // Bullish Engulfing
      if (pClose < pOpen && lClose > lOpen && lClose > pOpen && lOpen < pClose) {
        patterns.push("Bullish Engulfing");
      }
      
      // Bearish Engulfing
      if (pClose > pOpen && lClose < lOpen && lClose < pOpen && lOpen > pClose) {
        patterns.push("Bearish Engulfing");
      }

      res.json({
        status: "success",
        symbol,
        timeframe,
        currentPrice,
        indicators: {
          rsi: currentRsi,
          macd: currentMacd,
          ema20: currentEma20,
          ema50: currentEma50,
          ema200: currentEma200
        },
        analysis: {
          trend,
          isOverbought: currentRsi ? currentRsi > 70 : false,
          isOversold: currentRsi ? currentRsi < 30 : false,
          candlestickPatterns: patterns.length > 0 ? patterns : ["None detected"]
        }
      });
    } catch (error: any) {
      console.error("Analysis error:", error);
      res.status(500).json({ error: error.message || "Failed to perform technical analysis" });
    }
  });

  // --- BACKTESTING SIMULATOR ---
  app.post('/api/backtest', async (req, res) => {
    const { symbol, timeframe = '1h', strategy, initialBalance = 10000 } = req.body;
    
    if (!symbol || !strategy) {
      return res.status(400).json({ error: "Symbol and strategy are required" });
    }

    try {
      // Fetch more historical data for backtesting
      const ohlcv = await binance.fetchOHLCV(symbol, timeframe, undefined, 1000);
      
      if (!ohlcv || ohlcv.length === 0) {
        return res.status(404).json({ error: "No data found for symbol" });
      }

      const closes = ohlcv.map(candle => candle[4]);
      const timestamps = ohlcv.map(candle => candle[0]);

      let balance = initialBalance;
      let position = 0; // 0 means no position, > 0 means long quantity
      let entryPrice = 0;
      const trades = [];
      
      // Strategy: RSI Oversold/Overbought
      if (strategy === 'rsi') {
        const rsiResult = RSI.calculate({ values: closes, period: 14 });
        // RSI array is shorter than closes array by 14
        const offset = closes.length - rsiResult.length;

        for (let i = offset; i < closes.length; i++) {
          const currentRsi = rsiResult[i - offset];
          const price = closes[i];
          const time = timestamps[i];

          // Buy condition: RSI < 30
          if (currentRsi < 30 && position === 0) {
            position = balance / price;
            entryPrice = price;
            balance = 0;
            trades.push({ type: 'buy', price, time, rsi: currentRsi });
          }
          // Sell condition: RSI > 70
          else if (currentRsi > 70 && position > 0) {
            balance = position * price;
            const pnl = balance - (position * entryPrice);
            trades.push({ type: 'sell', price, time, rsi: currentRsi, pnl });
            position = 0;
          }
        }
      } 
      // Strategy: MACD Crossover
      else if (strategy === 'macd') {
        const macdResult = MACD.calculate({
          values: closes,
          fastPeriod: 12,
          slowPeriod: 26,
          signalPeriod: 9,
          SimpleMAOscillator: false,
          SimpleMASignal: false
        });
        const offset = closes.length - macdResult.length;

        for (let i = offset + 1; i < closes.length; i++) {
          const prevMacd = macdResult[i - offset - 1];
          const currMacd = macdResult[i - offset];
          const price = closes[i];
          const time = timestamps[i];

          if (!prevMacd || !currMacd || prevMacd.MACD === undefined || prevMacd.signal === undefined || currMacd.MACD === undefined || currMacd.signal === undefined) continue;

          // Buy condition: MACD crosses above signal
          if (prevMacd.MACD <= prevMacd.signal && currMacd.MACD > currMacd.signal && position === 0) {
            position = balance / price;
            entryPrice = price;
            balance = 0;
            trades.push({ type: 'buy', price, time });
          }
          // Sell condition: MACD crosses below signal
          else if (prevMacd.MACD >= prevMacd.signal && currMacd.MACD < currMacd.signal && position > 0) {
            balance = position * price;
            const pnl = balance - (position * entryPrice);
            trades.push({ type: 'sell', price, time, pnl });
            position = 0;
          }
        }
      }
      else {
        return res.status(400).json({ error: "Unknown strategy" });
      }

      // Close open position at the end
      if (position > 0) {
        const finalPrice = closes[closes.length - 1];
        balance = position * finalPrice;
        const pnl = balance - (position * entryPrice);
        trades.push({ type: 'sell', price: finalPrice, time: timestamps[timestamps.length - 1], pnl, note: 'End of backtest' });
        position = 0;
      }

      const finalBalance = balance;
      const totalPnl = finalBalance - initialBalance;
      const pnlPercentage = (totalPnl / initialBalance) * 100;
      
      const sellTrades = trades.filter(t => t.type === 'sell');
      const winningTrades = sellTrades.filter(t => (t.pnl || 0) > 0).length;
      const totalClosedTrades = sellTrades.length;
      const winRate = totalClosedTrades > 0 ? (winningTrades / totalClosedTrades) * 100 : 0;

      // Generate equity curve
      let currentBalance = initialBalance;
      const equityCurve = [{ time: timestamps[0], balance: initialBalance }];
      for (const trade of sellTrades) {
        currentBalance += (trade.pnl || 0);
        equityCurve.push({ time: trade.time, balance: currentBalance });
      }

      res.json({
        status: "success",
        symbol,
        timeframe,
        strategy,
        results: {
          initialBalance,
          finalBalance,
          totalPnl,
          pnlPercentage,
          totalTrades: totalClosedTrades,
          winRate
        },
        equityCurve,
        trades: trades.slice(-20) // Send last 20 trades to avoid huge payload
      });

    } catch (error: any) {
      console.error("Backtest error:", error);
      res.status(500).json({ error: error.message || "Failed to perform backtest" });
    }
  });

  // --- STRATEGY OPTIMIZER ---
  app.post('/api/optimize', async (req, res) => {
    const { symbol, timeframe = '1h', strategy, initialBalance = 10000 } = req.body;
    
    if (!symbol || !strategy) {
      return res.status(400).json({ error: "Symbol and strategy are required" });
    }

    try {
      const ohlcv = await binance.fetchOHLCV(symbol, timeframe, undefined, 1000);
      if (!ohlcv || ohlcv.length === 0) {
        return res.status(404).json({ error: "No data found for symbol" });
      }

      const closes = ohlcv.map(candle => candle[4]);
      let bestResult = { pnl: -Infinity, params: {}, winRate: 0, totalTrades: 0 };

      if (strategy === 'rsi') {
        const periods = [10, 14, 21];
        const oversolds = [25, 30, 35];
        const overboughts = [65, 70, 75];

        for (const period of periods) {
          const rsiResult = RSI.calculate({ values: closes, period });
          const offset = closes.length - rsiResult.length;

          for (const oversold of oversolds) {
            for (const overbought of overboughts) {
              let balance = initialBalance;
              let position = 0;
              let entryPrice = 0;
              let winningTrades = 0;
              let totalClosed = 0;

              for (let i = offset; i < closes.length; i++) {
                const currentRsi = rsiResult[i - offset];
                const price = closes[i];

                if (currentRsi < oversold && position === 0) {
                  position = balance / price;
                  entryPrice = price;
                  balance = 0;
                } else if (currentRsi > overbought && position > 0) {
                  balance = position * price;
                  if (balance > position * entryPrice) winningTrades++;
                  totalClosed++;
                  position = 0;
                }
              }
              if (position > 0) {
                balance = position * closes[closes.length - 1];
                if (balance > position * entryPrice) winningTrades++;
                totalClosed++;
              }

              const pnl = balance - initialBalance;
              if (pnl > bestResult.pnl) {
                bestResult = {
                  pnl,
                  params: { period, oversold, overbought },
                  winRate: totalClosed > 0 ? (winningTrades / totalClosed) * 100 : 0,
                  totalTrades: totalClosed
                };
              }
            }
          }
        }
      } else if (strategy === 'macd') {
        const fastPeriods = [10, 12];
        const slowPeriods = [24, 26];
        const signalPeriods = [9];

        for (const fastPeriod of fastPeriods) {
          for (const slowPeriod of slowPeriods) {
            for (const signalPeriod of signalPeriods) {
              const macdResult = MACD.calculate({
                values: closes,
                fastPeriod,
                slowPeriod,
                signalPeriod,
                SimpleMAOscillator: false,
                SimpleMASignal: false
              });
              const offset = closes.length - macdResult.length;

              let balance = initialBalance;
              let position = 0;
              let entryPrice = 0;
              let winningTrades = 0;
              let totalClosed = 0;

              for (let i = offset + 1; i < closes.length; i++) {
                const prevMacd = macdResult[i - offset - 1];
                const currMacd = macdResult[i - offset];
                const price = closes[i];

                if (!prevMacd || !currMacd || prevMacd.MACD === undefined || prevMacd.signal === undefined || currMacd.MACD === undefined || currMacd.signal === undefined) continue;

                if (prevMacd.MACD <= prevMacd.signal && currMacd.MACD > currMacd.signal && position === 0) {
                  position = balance / price;
                  entryPrice = price;
                  balance = 0;
                } else if (prevMacd.MACD >= prevMacd.signal && currMacd.MACD < currMacd.signal && position > 0) {
                  balance = position * price;
                  if (balance > position * entryPrice) winningTrades++;
                  totalClosed++;
                  position = 0;
                }
              }
              if (position > 0) {
                balance = position * closes[closes.length - 1];
                if (balance > position * entryPrice) winningTrades++;
                totalClosed++;
              }

              const pnl = balance - initialBalance;
              if (pnl > bestResult.pnl) {
                bestResult = {
                  pnl,
                  params: { fastPeriod, slowPeriod, signalPeriod },
                  winRate: totalClosed > 0 ? (winningTrades / totalClosed) * 100 : 0,
                  totalTrades: totalClosed
                };
              }
            }
          }
        }
      } else {
        return res.status(400).json({ error: "Unknown strategy for optimization" });
      }

      res.json({
        status: "success",
        symbol,
        timeframe,
        strategy,
        bestParameters: bestResult.params,
        expectedPerformance: {
          totalPnl: bestResult.pnl,
          pnlPercentage: (bestResult.pnl / initialBalance) * 100,
          winRate: bestResult.winRate,
          totalTrades: bestResult.totalTrades
        }
      });
    } catch (error: any) {
      console.error("Optimize error:", error);
      res.status(500).json({ error: error.message || "Failed to optimize strategy" });
    }
  });

  // Vite middleware for development
  let vite: any;
  try {
    log("Initializing Vite middleware...");
    if (process.env.NODE_ENV !== "production") {
      vite = await createViteServer({
        server: { 
          middlewareMode: true, 
          hmr: process.env.DISABLE_HMR === 'true' ? false : { port: 0 }, // Use random port to avoid 24678 conflicts
        },
        appType: "spa",
      });
      app.use(vite.middlewares);
      log("Vite middleware initialized.");
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
      log("Production static serving initialized.");
    }

    log(`Attempting to listen on port ${PORT}...`);
    const server = app.listen(PORT, "0.0.0.0", () => {
      log(`Server running on http://localhost:${PORT}`);
    });

    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;
      if (pathname === '/ws/market-data') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    server.on('error', (e: any) => {
      if (e.code === 'EADDRINUSE') {
        log(`Port ${PORT} is in use, retrying...`);
        setTimeout(() => {
          server.close();
          server.listen(PORT, "0.0.0.0");
        }, 1000);
      } else {
        log(`Server error: ${e.message}`);
      }
    });

    const shutdown = async () => {
      log('Shutting down server...');
      if (vite) {
        await vite.close();
      }
      server.close(() => {
        log('Server closed gracefully');
      });
      // Force exit after a short delay or immediately to prevent SSE connections from keeping process alive
      setTimeout(() => {
        log('Force closing due to active connections');
        process.exit(0);
      }, 1000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (e: any) {
    log(`Failed to start server: ${e.message}`);
    if (vite) await vite.close();
    process.exit(1);
  }
}

startServer();

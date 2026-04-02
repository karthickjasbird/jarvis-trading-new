import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import admin from "firebase-admin";
import ccxt from "ccxt";
import { KiteConnect } from "kiteconnect";
import { WebSocketServer } from "ws";
import fs from "fs";

// Simple file logger
const logFile = fs.createWriteStream("startup.log", { flags: "a" });
const log = (msg: string) => {
  logFile.write(`[${new Date().toISOString()}] ${msg}\n`);
  console.log(msg);
};

log("Starting server.ts...");

// Initialize Firebase Admin for the backend
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "ridermesh", // from firebase-applet-config.json
  });
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

  // Example endpoint for Sentry Mode to execute a trade
  app.post("/api/trade", async (req, res) => {
    // In a real app, you would verify the Firebase ID token here
    const { userId, symbol, side, quantity, market } = req.body;
    
    if (!userId || !symbol || !side || !quantity) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      // 1. Fetch user's broker config securely
      const brokerConfigsSnapshot = await db.collection("users").doc(userId).collection("brokerConfigs").where("isActive", "==", true).get();
      
      if (brokerConfigsSnapshot.empty) {
        return res.status(400).json({ error: "No active broker configuration found" });
      }

      // 2. Execute trade via Broker API (Mocked for now)
      console.log(`Executing ${side} ${quantity} ${symbol} on ${market} for user ${userId}`);
      
      // 3. Record trade in Firestore
      const tradeRef = db.collection("trades").doc();
      await tradeRef.set({
        userId,
        symbol,
        market,
        side,
        quantity,
        entryPrice: 100.50, // Mock price
        status: "open",
        mode: "sentry",
        createdAt: new Date().toISOString()
      });

      res.json({ status: "success", tradeId: tradeRef.id, message: "Trade executed successfully" });
    } catch (error) {
      console.error("Trade execution failed:", error);
      res.status(500).json({ error: "Trade execution failed" });
    }
  });

  // --- LIVE MARKET DATA (HTTP POLLING MATRIX) ---
  // Global state to simulate the market across all clients
  const marketState: Record<string, { price: number, lastChange: number }> = {};

  // Initialize Binance Testnet
  const binance = new ccxt.binance({
    apiKey: process.env.BINANCE_API_KEY,
    secret: process.env.BINANCE_SECRET_KEY,
  });
  binance.setSandboxMode(true);

  // Update prices in the background
  setInterval(async () => {
    for (const symbol in marketState) {
      if (symbol.includes('BTC') || symbol.includes('ETH')) {
        try {
          // Fetch real data from Binance Testnet
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
      } else {
        // Simulate other markets (e.g. RELIANCE)
        const volatility = marketState[symbol].price * 0.0005; // 0.05% volatility per tick
        const change = (Math.random() - 0.5) * volatility;
        marketState[symbol].price += change;
        marketState[symbol].lastChange = change;
      }
    }
  }, 2000); // Poll every 2 seconds to respect rate limits

  app.get('/api/market-data', (req, res) => {
    log(`Received request for /api/market-data: ${req.url}`);
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

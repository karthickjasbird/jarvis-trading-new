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
import { MemoryManager } from "./engine/memory.ts";
import { MarketScraper } from "./engine/scraper.ts";
import { WebAgent } from "./engine/webAgent.ts";
import { GoalPlanner } from "./engine/goalPlanner.ts";
import { GoalExecutor } from "./engine/goalExecutor.ts";
import { RegimeDetector } from "./engine/regimeDetector.ts";
import { KellyCalculator } from "./engine/kellyCalculator.ts";
import { AgentSwarm } from "./engine/agentSwarm.ts";
import { MarketScanner } from "./engine/marketScanner.ts";
import { StrategyTracker } from "./engine/strategyTracker.ts";
import { ConfidenceEngine } from "./engine/confidenceEngine.ts";
import { PostMortemEngine } from "./engine/postMortem.ts";
import { TradeDiaryEngine } from "./engine/tradeDiary.ts";
import { getTradingViewBridge } from "./engine/tradingViewBridge.ts";
import { readTVIndicators } from "./engine/tvIndicators.ts";
import { analyzeChart, analyzeChartMultiTimeframe } from "./engine/tvVision.ts";
import { BinancePriceFeed } from "./engine/binancePriceFeed.ts";
import { UserSecretsManager } from "./engine/userSecrets.ts";
import { RSI, MACD, EMA } from "technicalindicators";
import { generateText } from "./engine/modelRouter.ts";
import { generateAppManifest, formatManifestForPrompt } from "./engine/manifestGenerator.ts";

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
    projectId: "jarvis-trading-terminal-bba57", // from firebase-applet-config.json
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
db.settings({ databaseId: "(default)", ignoreUndefinedProperties: true });

// ─── OWNER USER ID ────────────────────────────────────────
// When sharing Firebase across multiple localhost users, this scopes
// all background engines (Sentry, Scanner, Monitor) to ONLY process
// the local user's data — preventing cross-user trade interference.
const OWNER_USER_ID = process.env.OWNER_USER_ID || '';
if (OWNER_USER_ID) {
  log(`Owner scoping ACTIVE: All engines scoped to user ${OWNER_USER_ID.slice(0, 8)}...`);
} else {
  // Try to auto-detect from saved file
  try {
    const savedId = fs.readFileSync(path.join(process.cwd(), '.owner_user_id'), 'utf-8').trim();
    if (savedId) {
      (global as any).__OWNER_USER_ID = savedId;
      log(`Owner auto-detected from .owner_user_id: ${savedId.slice(0, 8)}...`);
    }
  } catch {
    log('WARNING: OWNER_USER_ID not set in .env. Will auto-detect on first sign-in.');
  }
}

// Mutable getter for auto-detection
function getOwnerId(): string {
  return OWNER_USER_ID || (global as any).__OWNER_USER_ID || '';
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // ─── AUTO-DETECT OWNER MIDDLEWARE ───────────────────────
  // When OWNER_USER_ID is not set, auto-capture the first userId from API calls
  app.use((req, _res, next) => {
    if (!OWNER_USER_ID && !(global as any).__OWNER_USER_ID) {
      const userId = (req.query?.userId as string) || (req.body?.userId as string);
      if (userId && userId !== 'autonomous-system' && userId.length > 10) {
        (global as any).__OWNER_USER_ID = userId;
        // Save to file so it persists across restarts
        try {
          fs.writeFileSync(path.join(process.cwd(), '.owner_user_id'), userId);
          log(`✅ Auto-detected owner: ${userId.slice(0, 8)}... (saved to .owner_user_id)`);
          log('   Tip: Add OWNER_USER_ID="' + userId + '" to your .env for explicit control.');
        } catch {}
      }
    }
    next();
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Sentry Mode Backend is running" });
  });

  // ─── SETUP STATUS (Onboarding Wizard) ─────────────────
  app.get("/api/setup-status", (req, res) => {
    const ownerId = getOwnerId();
    res.json({
      geminiKey: !!process.env.GEMINI_API_KEY,
      binanceKey: !!process.env.BINANCE_API_KEY,
      binanceSecret: !!process.env.BINANCE_SECRET_KEY,
      telegramBot: !!process.env.TELEGRAM_BOT_TOKEN,
      groqKey: !!process.env.GROQ_API_KEY,
      ownerUserId: !!ownerId,
      ownerIdValue: ownerId ? `${ownerId.slice(0, 8)}...` : '',
    });
  });

  // ─── VERSION & UPDATE CHECK ────────────────────────────
  //
  // Strict semver "is remote newer?" compare. Returns true only when remote
  // is greater than local; if local is ahead (dev branch, unreleased work)
  // or equal, the banner stays silent. Falsy/malformed versions degrade to
  // string inequality.
  const isRemoteNewer = (remote?: string, local?: string): boolean => {
    if (!remote || !local) return false;
    const parse = (v: string) => v.replace(/^v/, '').split('.').map(p => parseInt(p, 10) || 0);
    const [rMaj, rMin, rPatch] = parse(remote);
    const [lMaj, lMin, lPatch] = parse(local);
    if (rMaj !== lMaj) return rMaj > lMaj;
    if (rMin !== lMin) return rMin > lMin;
    return rPatch > lPatch;
  };

  app.get("/api/version", async (req, res) => {
    try {
      const versionFile = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'version.json'), 'utf-8'));

      // Try to fetch latest version from GitHub (non-blocking, cached)
      let remoteVersion = null;
      let updateAvailable = false;
      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 3000); // 3s timeout
        const ghRes = await fetch(
          'https://raw.githubusercontent.com/karthickjasbird/jarvis-trading-new/main/version.json',
          { signal: controller.signal }
        );
        if (ghRes.ok) {
          remoteVersion = await ghRes.json();
          updateAvailable = isRemoteNewer(remoteVersion.version, versionFile.version);
        }
      } catch {
        // GitHub unreachable or timeout — silently ignore
      }

      res.json({
        current: versionFile,
        remote: remoteVersion,
        updateAvailable,
      });
    } catch {
      res.json({ current: { version: 'unknown' }, remote: null, updateAvailable: false });
    }
  });

  // ─── APP MANIFEST (Self-Awareness) ────────────────────
  const appManifest = generateAppManifest(process.cwd());
  log(`App Manifest generated: v${appManifest.version}, ${appManifest.engines.length} engines, ${appManifest.apiRouteCount} API routes`);
  const manifestPromptText = formatManifestForPrompt(appManifest);

  app.get("/api/system-manifest", (_req, res) => {
    res.json(appManifest);
  });

  // --- JARVIS CONSCIOUS MIND ROUTES ---
  app.get("/api/jarvis-mind", (req, res) => {
    try {
      const soulPath = path.join(process.cwd(), 'soul.md');
      const lessonPath = path.join(process.cwd(), 'lesson.md');
      const memoryPath = path.join(process.cwd(), 'memory.md');
      
      const soul = fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf-8') : '';
      const lesson = fs.existsSync(lessonPath) ? fs.readFileSync(lessonPath, 'utf-8') : '';
      const memory = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf-8') : '';
      
      res.json({ status: "success", mind: { soul, lesson, memory, manifest: manifestPromptText } });
    } catch (e: any) {
      console.error("Error reading Jarvis mind files:", e);
      res.status(500).json({ error: e.message });
    }
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

  // --- LIVE MARKET DATA (WEBSOCKET-FED SINGLE SOURCE OF TRUTH) ---
  const marketState: Record<string, { price: number, lastChange: number }> = {};

  // --- BINANCE WEBSOCKET PRICE FEED ---
  const priceFeed = new BinancePriceFeed(marketState);
  priceFeed.start();

  // --- TRADE EXECUTION ENGINE & MEMORY BANK ---
  const tradeExecutor = new TradeExecutor(db, marketState);
  const memoryManager = new MemoryManager(db);
  const userSecrets = new UserSecretsManager(db);
  const sentryEngine = new SentryEngine(db, tradeExecutor, marketState, memoryManager, OWNER_USER_ID);
  const scraper = new MarketScraper(memoryManager, db);
  const webAgent = new WebAgent(memoryManager);
  const goalPlanner = new GoalPlanner(db);
  const strategyTracker = new StrategyTracker(db);
  const regimeDetector = new RegimeDetector();
  const kellyCalculator = new KellyCalculator(db);
  const tradeDiary = new TradeDiaryEngine(db);
  const agentSwarm = new AgentSwarm(db, marketState, strategyTracker, OWNER_USER_ID, regimeDetector, kellyCalculator, memoryManager, tradeDiary);
  const marketScanner = new MarketScanner(db);
  const goalExecutor = new GoalExecutor(db, tradeExecutor, marketScanner, marketState, OWNER_USER_ID);
  sentryEngine.setGoalExecutor(goalExecutor);
  const confidenceEngine = new ConfidenceEngine(db);
  const postMortemEngine = new PostMortemEngine(db, memoryManager, tradeDiary);

  // --- TRADINGVIEW BRIDGE (NEXUS Phase 4) ---
  // Lazy: doesn't attach until POST /api/tradingview/connect — so server boot
  // never depends on Chrome being open.
  const tvBridge = getTradingViewBridge(process.env.CHROME_DEBUG_URL);

  // --- EVENT-DRIVEN SENTRY: React to every price tick from WebSocket ---
  priceFeed.on('price_update', ({ symbol, rawSymbol, price }) => {
    // Only run sentry checks if trade freeze is NOT active
    if (priceFeed.isTradeFrozen) return;

    // Check all open trades for this symbol against TP/SL/profitTarget
    sentryEngine.onPriceUpdate(symbol, rawSymbol, price).catch(err => {
      // Silently handle — don't crash the price feed event loop
    });
  });

  // Maintenance window notifications via Telegram
  priceFeed.on('maintenance_warning', async ({ minutesRemaining }) => {
    try {
      // Check if there are open positions — warn users
      // Check if the OWNER has open positions — only warn them
      let maintQuery = db.collection('trades').where('status', '==', 'open');
      if (OWNER_USER_ID) maintQuery = maintQuery.where('userId', '==', OWNER_USER_ID);
      const openSnap = await maintQuery.get();
      if (!openSnap.empty) {
        const userIds = new Set<string>();
        openSnap.docs.forEach((d: any) => userIds.add(d.data().userId));
        const { sendTelegramNotification } = await import('./engine/telegram.ts');
        for (const uid of userIds) {
          await sendTelegramNotification(db, uid,
            `⚠️ <b>SCHEDULED MAINTENANCE IN ${minutesRemaining} MIN</b>\n\nJarvis will refresh its market connection at 3:30 AM IST.\nYour open positions are still protected.\nNo new trades will be opened after 3:20 AM IST.`
          );
        }
      }
    } catch {}
  });

  priceFeed.on('maintenance_clear', () => {
    console.log('[SERVER] ✅ Maintenance complete — all systems operational');
  });

  // Fallback: Keep the 5-second sentry poll as a safety net (catches edge cases)
  setInterval(() => sentryEngine.monitor(), 5000);
  // setInterval(() => sentryEngine.autonomousLoop(), 2 * 60 * 1000);

  // Reset circuit breaker at midnight every day
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      sentryEngine.resetDailyShutdown();
    }
  }, 60 * 1000); // Check every minute

  // ─── AUTONOMOUS PIPELINE ──────────────────────────────────
  // Scanner → evaluates → triggers Swarm → Monitor watches positions

  const { PositionMonitor } = await import('./engine/positionMonitor.ts');
  const positionMonitor = new PositionMonitor(db, strategyTracker, marketState, memoryManager, OWNER_USER_ID);
  setInterval(() => positionMonitor.monitor(), 60 * 1000); // Check stale trades every 60s
  setInterval(() => goalExecutor.monitor(), 60 * 1000); // Check campaign progress every 60s

  // Auto-expire stale pending approvals (time + price-drift). Cadence is
  // 30s so a 5-min TTL has tight resolution without becoming chatty.
  const { ApprovalExpiry } = await import('./engine/approvalExpiry.ts');
  const approvalExpiry = new ApprovalExpiry(db, marketState, OWNER_USER_ID);
  setInterval(() => approvalExpiry.sweep(), 30 * 1000);

  // Autonomous scan-and-trigger loop
  let autonomousEnabled = true; // Toggle via /api/autonomous/toggle

  const autonomousScan = async () => {
    try {
      // ─── CIRCUIT BREAKER CHECK ──────────────────────
      if (sentryEngine.isCircuitBreakerActive()) {
        console.log('[AUTONOMOUS] ⛔ Circuit breaker active — skipping this scan cycle.');
        return;
      }

      const scanResult = await marketScanner.scan();

      if (!autonomousEnabled) {
        console.log('[AUTONOMOUS] Mode disabled — scan-only (no swarm trigger)');
        return;
      }

      // ─── MACRO TREND FILTER ──────────────────────────
      // Only allow trades that align with the daily trend
      const qualifiedOpps = [];
      for (const opp of scanResult.topOpportunities) {
        if (opp.score < 75 || (opp.confluence !== 'buy' && opp.confluence !== 'strong_buy')) continue;

        // Check daily trend before allowing the trade
        try {
          const dailyTrend = await marketScanner.checkDailyTrend(opp.symbol.replace('/USDT', 'USDT'));
          if (dailyTrend === 'bearish' && (opp.confluence === 'buy' || opp.confluence === 'strong_buy')) {
            console.log(`[AUTONOMOUS] 🚫 MACRO FILTER blocked ${opp.symbol}: Daily trend is BEARISH, skipping buy signal.`);
            continue; // Don't trade against the daily trend
          }
          qualifiedOpps.push({ ...opp, dailyTrend });
        } catch {
          // If trend check fails, still allow the trade (fail-open for scanning)
          qualifiedOpps.push(opp);
        }
      }

      if (qualifiedOpps.length > 0) {
        console.log(`[AUTONOMOUS] 🚀 ${qualifiedOpps.length} pair(s) qualify for auto-trade: ${qualifiedOpps.map((o: any) => `${o.symbol}(${o.score})`).join(', ')}`);

        // Log trigger to brain activity
        await db.collection('brainActivity').add({
          agent: 'system',
          message: `🚀 AUTO-TRIGGER: ${qualifiedOpps.length} pair(s) hit threshold (score ≥ 75 + bullish TA + macro aligned). Activating Agent Swarm...`,
          type: 'signal',
          data: { triggers: qualifiedOpps.map((o: any) => ({ symbol: o.symbol, score: o.score, confluence: o.confluence, dailyTrend: o.dailyTrend })) },
          userId: OWNER_USER_ID || undefined,
          timestamp: new Date().toISOString(),
        });

        // Send Telegram alert for auto-trigger
        try {
          const { broadcastTelegram, formatAutoTrigger } = await import('./engine/telegram.ts');
          await broadcastTelegram(db, formatAutoTrigger(qualifiedOpps.map((o: any) => ({ symbol: o.symbol, score: o.score }))));
        } catch {}

        // Fire the Agent Swarm with APPROVAL REQUIRED — user must approve trades
        const swarmUserId = OWNER_USER_ID || 'autonomous-system';
        const result = await agentSwarm.runPipeline(swarmUserId, true, undefined, true); // requireApproval=true
        console.log(`[AUTONOMOUS] Swarm result: ${result.reason}`);
      } else {
        console.log(`[AUTONOMOUS] No pairs qualified (need score ≥ 75 + bullish confluence + macro aligned). Waiting for next scan.`);
      }
    } catch (err: any) {
      console.error('[AUTONOMOUS] Pipeline error:', err.message);
    }
  };

  // Scanner + auto-trigger every 15 minutes, first run after 15s
  setInterval(autonomousScan, 15 * 60 * 1000);
  setTimeout(autonomousScan, 15000);

  // Position Monitor — check open trades every 60 seconds
  setInterval(() => positionMonitor.monitor(), 60 * 1000);
  setTimeout(() => positionMonitor.monitor(), 30000);

  // Run Market Scraper (news) every 4 hours, and once on startup
  setInterval(() => scraper.runBackgroundScraping(), 4 * 60 * 60 * 1000);
  setTimeout(() => scraper.runBackgroundScraping(), 10000);

  // ─── PROACTIVE ALERT ENGINE ───────────────────────────────
  const { AlertEngine } = await import('./engine/alertEngine.ts');
  const alertEngine = new AlertEngine(db);
  
  // Scan for market events every 10 minutes
  setInterval(() => alertEngine.scan(), 10 * 60 * 1000);
  setTimeout(() => alertEngine.scan(), 20000); // First scan after 20s
  
  // Cleanup old alerts every 6 hours
  setInterval(() => alertEngine.cleanup(), 6 * 60 * 60 * 1000);

  // API: Get morning briefing data (unbriefed alerts + overnight summary)
  app.get("/api/briefing", async (req, res) => {
    try {
      const userId = req.query.userId as string;
      if (!userId) return res.status(400).json({ error: "userId required" });

      // 1. Get unbriefed alerts
      const alerts = await alertEngine.getUnbriefedAlerts(5);

      // 2. Get today's closed trades for P&L summary
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const closedToday = await db.collection('trades')
        .where('userId', '==', userId)
        .where('status', '==', 'closed')
        .where('closedAt', '>=', today.toISOString())
        .get();

      let totalPnl = 0;
      let wins = 0;
      let losses = 0;
      closedToday.docs.forEach((d: any) => {
        const pnl = d.data().pnl || 0;
        totalPnl += pnl;
        if (pnl > 0) wins++;
        else if (pnl < 0) losses++;
      });

      // 3. Get open positions count
      const openPositions = await db.collection('trades')
        .where('userId', '==', userId)
        .where('status', '==', 'open')
        .get();

      // 4. Get portfolio balance
      const portDoc = await db.collection('portfolios').doc(userId).get();
      const portfolio = portDoc.exists ? portDoc.data() : { paperBalance: 100000 };

      // 5. Get recent losing trades with PostMortem for debrief
      const recentLosses = await db.collection('trades')
        .where('userId', '==', userId)
        .where('status', '==', 'closed')
        .where('closedAt', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .get();

      const lossDebriefs: any[] = [];
      for (const d of recentLosses.docs) {
        const trade = d.data();
        if ((trade.pnl || 0) < 0) {
          // Check for PostMortem analysis
          try {
            const pm = await db.collection('postMortems').where('tradeId', '==', d.id).limit(1).get();
            if (!pm.empty) {
              lossDebriefs.push({
                symbol: trade.symbol,
                pnl: trade.pnl,
                lesson: pm.docs[0].data().lesson || pm.docs[0].data().summary || 'No lesson recorded.',
              });
            }
          } catch {}
        }
      }

      // Mark alerts as briefed
      if (alerts.length > 0) {
        await alertEngine.markAsBriefed(alerts.map((a: any) => a.id));
      }

      res.json({
        status: 'success',
        briefing: {
          alerts: alerts.map((a: any) => a.message),
          todayPnl: totalPnl,
          todayWins: wins,
          todayLosses: losses,
          openPositions: openPositions.size,
          paperBalance: portfolio?.paperBalance || 100000,
          lossDebriefs,
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- CHAT SESSION ROUTES ---
  app.post("/api/sessions/create", async (req, res) => {
    const { userId, firstMessage } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      // Auto-generate title from first message using Gemini Flash
      let title = "New Chat";
      if (firstMessage) {
        try {
          const { GoogleGenAI } = await import('@google/genai');
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
          const titleRes = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Generate a very short title (max 5 words) for a conversation that starts with: "${firstMessage}". Return ONLY the title, no quotes, no extra text.`,
          });
          if (titleRes.text) title = titleRes.text.trim().replace(/^["']|["']$/g, '');
        } catch (e) {
          // Fallback to first 30 chars of the message
          title = firstMessage.substring(0, 30) + (firstMessage.length > 30 ? '...' : '');
        }
      }

      const sessionRef = db.collection('chatSessions').doc();
      await sessionRef.set({
        userId,
        title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Enforce 50-session cap — delete oldest if over limit
      const allSessions = await db.collection('chatSessions')
        .where('userId', '==', userId)
        .get();
      
      if (allSessions.size > 50) {
        // Sort in memory instead of orderBy to avoid needing composite index
        const sortedDocs = allSessions.docs.sort((a: any, b: any) => 
          new Date(b.data().createdAt).getTime() - new Date(a.data().createdAt).getTime()
        );
        const toDelete = sortedDocs.slice(50);
        const batch = db.batch();
        for (const doc of toDelete) {
          // Delete messages subcollection first
          const msgs = await doc.ref.collection('messages').get();
          msgs.docs.forEach(m => batch.delete(m.ref));
          batch.delete(doc.ref);
        }
        await batch.commit();
      }

      res.json({ status: "success", sessionId: sessionRef.id, title });
    } catch (error: any) {
      console.error("Failed to create session:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sessions/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
      // Fetch without orderBy to avoid composite index requirement, then sort in memory
      const snapshot = await db.collection('chatSessions')
        .where('userId', '==', userId)
        .get();

      let sessions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as any[];

      // Sort by updatedAt descending
      sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      
      // Limit to 50
      sessions = sessions.slice(0, 50);

      res.json({ status: "success", sessions });
    } catch (error: any) {
      console.error("Failed to list sessions:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/sessions/:sessionId/message", async (req, res) => {
    const { sessionId } = req.params;
    const { role, text, source } = req.body;
    if (!role || !text) return res.status(400).json({ error: "role and text are required" });

    try {
      const sessionRef = db.collection('chatSessions').doc(sessionId);
      await sessionRef.collection('messages').add({
        role,
        text,
        source: source || 'text',
        timestamp: new Date().toISOString(),
      });
      // Update the session's updatedAt
      await sessionRef.update({ updatedAt: new Date().toISOString() });
      res.json({ status: "success" });
    } catch (error: any) {
      console.error("Failed to save message:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sessions/:sessionId/messages", async (req, res) => {
    const { sessionId } = req.params;
    try {
      const snapshot = await db.collection('chatSessions').doc(sessionId)
        .collection('messages')
        .orderBy('timestamp', 'asc')
        .get();

      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      res.json({ status: "success", messages });
    } catch (error: any) {
      console.error("Failed to load messages:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/sessions/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    try {
      const sessionRef = db.collection('chatSessions').doc(sessionId);
      // Delete messages subcollection
      const msgs = await sessionRef.collection('messages').get();
      const batch = db.batch();
      msgs.docs.forEach(m => batch.delete(m.ref));
      batch.delete(sessionRef);
      await batch.commit();
      res.json({ status: "success" });
    } catch (error: any) {
      console.error("Failed to delete session:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/sessions/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: "title is required" });
    try {
      await db.collection('chatSessions').doc(sessionId).update({ title });
      res.json({ status: "success" });
    } catch (error: any) {
      console.error("Failed to rename session:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- BROKER WALLET ROUTES ---

  // Test broker connection — verify API keys work
  app.post("/api/broker/test/:userId", async (req, res) => {
    const { userId } = req.params;
    try {
      const brokerSnap = await db.collection('users').doc(userId)
        .collection('brokerConfigs').where('isActive', '==', true).get();
      
      if (brokerSnap.empty) {
        return res.json({ connected: false, error: "No active broker configured. Go to Settings → Broker to add your exchange API keys." });
      }

      const config = brokerSnap.docs[0].data();

      if (['binance', 'bybit'].includes(config.brokerName)) {
        const exchangeClass = (ccxt as any)[config.brokerName];
        const exchange = new exchangeClass({
          apiKey: config.apiKey,
          secret: config.apiSecret,
          enableRateLimit: true,
        });

        const balance = await exchange.fetchBalance();
        const usdtBalance = balance?.USDT?.total || balance?.USDT?.free || 0;

        return res.json({
          connected: true,
          exchange: config.brokerName,
          totalBalance: usdtBalance,
          currency: 'USDT',
          message: `Successfully connected to ${config.brokerName.charAt(0).toUpperCase() + config.brokerName.slice(1)}!`
        });
      } else if (config.brokerName === 'zerodha') {
        if (!config.accessToken) {
          return res.json({ connected: false, error: "Zerodha access token missing. Please login via Kite." });
        }
        const kc = new KiteConnect({ api_key: config.apiKey });
        kc.setAccessToken(config.accessToken);
        const margins = await kc.getMargins();
        const available = margins?.equity?.available?.live_balance || 0;

        return res.json({
          connected: true,
          exchange: 'zerodha',
          totalBalance: available,
          currency: 'INR',
          message: 'Successfully connected to Zerodha!'
        });
      }

      return res.json({ connected: false, error: `Unsupported broker: ${config.brokerName}` });
    } catch (error: any) {
      console.error("[BROKER TEST] Failed:", error.message);
      res.json({ connected: false, error: `Connection failed: ${error.message}` });
    }
  });

  // Get real wallet balance from connected exchange
  app.get("/api/broker/balance/:userId", async (req, res) => {
    const { userId } = req.params;
    const isPractice = req.query.practice === 'true';

    try {
      if (isPractice) {
        // Return paper balance from portfolio
        const portfolioDoc = await db.collection('portfolios').doc(userId).get();
        const portfolio = portfolioDoc.exists ? portfolioDoc.data() : { paperBalance: 100000 };
        return res.json({
          mode: 'practice',
          totalBalance: portfolio?.paperBalance || 100000,
          availableBalance: portfolio?.paperBalance || 100000,
          currency: 'USD (Paper)',
          connected: true
        });
      }

      // Real mode — fetch from exchange
      const brokerSnap = await db.collection('users').doc(userId)
        .collection('brokerConfigs').where('isActive', '==', true).get();
      
      if (brokerSnap.empty) {
        return res.json({
          mode: 'real',
          totalBalance: 0,
          availableBalance: 0,
          currency: 'USDT',
          connected: false,
          error: 'No broker connected'
        });
      }

      const config = brokerSnap.docs[0].data();

      if (['binance', 'bybit'].includes(config.brokerName)) {
        const exchangeClass = (ccxt as any)[config.brokerName];
        const exchange = new exchangeClass({
          apiKey: config.apiKey,
          secret: config.apiSecret,
          enableRateLimit: true,
        });

        const balance = await exchange.fetchBalance();
        const total = balance?.USDT?.total || 0;
        const free = balance?.USDT?.free || 0;

        return res.json({
          mode: 'real',
          totalBalance: total,
          availableBalance: free,
          currency: 'USDT',
          exchange: config.brokerName,
          connected: true
        });
      } else if (config.brokerName === 'zerodha') {
        const kc = new KiteConnect({ api_key: config.apiKey });
        kc.setAccessToken(config.accessToken);
        const margins = await kc.getMargins();
        const available = margins?.equity?.available?.live_balance || 0;

        return res.json({
          mode: 'real',
          totalBalance: available,
          availableBalance: available,
          currency: 'INR',
          exchange: 'zerodha',
          connected: true
        });
      }

      res.json({ mode: 'real', totalBalance: 0, connected: false, error: 'Unsupported broker' });
    } catch (error: any) {
      console.error("[BROKER BALANCE] Failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // --- TELEGRAM NOTIFICATION ROUTES ---

  // Get notification config for a user
  app.get("/api/notifications/:userId", async (req, res) => {
    try {
      const doc = await db.collection('notificationConfigs').doc(req.params.userId).get();
      if (!doc.exists) return res.json({ enabled: false, telegramChatId: '' });
      res.json(doc.data());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Save notification config
  app.post("/api/notifications/:userId", async (req, res) => {
    const { telegramChatId, enabled } = req.body;
    try {
      await db.collection('notificationConfigs').doc(req.params.userId).set({
        telegramChatId: telegramChatId || '',
        enabled: enabled !== false,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      res.json({ status: 'success' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send a test notification
  app.post("/api/notifications/:userId/test", async (req, res) => {
    try {
      const { sendTelegramNotification } = await import('./engine/telegram.ts');
      const ok = await sendTelegramNotification(db, req.params.userId,
        '✅ <b>Test Alert</b>\n\nYour Jarvis Telegram notifications are working!\n\n<i>Jarvis Autonomous Trading</i>'
      );
      res.json({ status: ok ? 'sent' : 'failed', message: ok ? 'Check your Telegram!' : 'Failed — check bot token and chat ID.' });
    } catch (err: any) {
      res.json({ status: 'failed', message: err.message });
    }
  });

  // --- PORTFOLIO INTELLIGENCE ROUTES ---
  const { PortfolioIntelligence } = await import('./engine/portfolioIntel.ts');
  const portfolioIntel = new PortfolioIntelligence(db);

  app.get("/api/portfolio/snapshot", async (_req, res) => {
    try {
      const snapshot = await portfolioIntel.getSnapshot();
      res.json(snapshot);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/portfolio/check", async (req, res) => {
    const { symbol, riskPercent } = req.body;
    try {
      const result = await portfolioIntel.checkTradeAllowed(symbol || 'BTC/USDT', riskPercent || 2);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- POST-MORTEM ROUTES ---
  app.get("/api/postmortems", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const reports = await postMortemEngine.getRecent(limit);
      res.json({ reports });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/postmortems/grades", async (_req, res) => {
    try {
      const grades = await postMortemEngine.getGradeSummary();
      res.json(grades);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- MARKET INTELLIGENCE ROUTES ---
  const { MarketIntelligenceEngine } = await import('./engine/marketIntel.ts');
  const intelEngine = new MarketIntelligenceEngine();
  let cachedIntel: any = null;
  let intelLastFetch = 0;

  app.get("/api/intel", async (_req, res) => {
    try {
      // Cache intel for 5 minutes to avoid rate limits
      if (cachedIntel && Date.now() - intelLastFetch < 5 * 60 * 1000) {
        return res.json(cachedIntel);
      }
      cachedIntel = await intelEngine.gather();
      intelLastFetch = Date.now();
      res.json(cachedIntel);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- AUTONOMOUS MODE ROUTES ---

  app.get("/api/autonomous/status", (_req, res) => {
    res.json({
      enabled: autonomousEnabled,
      scanInterval: '15 minutes',
      monitorInterval: '60 seconds',
      triggerThreshold: 'score ≥ 75 + bullish TA confluence',
    });
  });

  app.patch("/api/autonomous/toggle", (_req, res) => {
    autonomousEnabled = !autonomousEnabled;
    console.log(`[AUTONOMOUS] Mode ${autonomousEnabled ? 'ENABLED ✅' : 'DISABLED ⛔'}`);
    res.json({ enabled: autonomousEnabled });
  });

  // --- TRADINGVIEW BRIDGE ROUTES (NEXUS Phase 4) ---

  app.get("/api/tradingview/status", async (_req, res) => {
    try {
      res.json(await tvBridge.healthCheck());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tradingview/connect", async (_req, res) => {
    try {
      await tvBridge.connect();
      res.json(await tvBridge.healthCheck());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tradingview/disconnect", async (_req, res) => {
    try {
      await tvBridge.disconnect();
      res.json({ disconnected: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tradingview/symbol", async (req, res) => {
    try {
      const { symbol, exchange } = req.body ?? {};
      if (!symbol) return res.status(400).json({ error: "symbol required (e.g. 'BTC/USDT')" });
      await tvBridge.setSymbol(symbol, exchange ?? "BINANCE");
      res.json({ ok: true, symbol, exchange: exchange ?? "BINANCE" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tradingview/timeframe", async (req, res) => {
    try {
      const { tf } = req.body ?? {};
      if (!tf) return res.status(400).json({ error: "tf required (e.g. '1h', '4h', '1d')" });
      await tvBridge.setTimeframe(tf);
      res.json({ ok: true, tf });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/tradingview/screenshot", async (req, res) => {
    try {
      const chartOnly = req.query.chartOnly === "1" || req.query.chartOnly === "true";
      const buffer = await tvBridge.screenshot({ chartOnly, type: "png" });
      res.set("Content-Type", "image/png");
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Phase 5: read indicator values from the chart legend ---

  app.get("/api/tradingview/legend", async (_req, res) => {
    try {
      const items = await tvBridge.getChartLegend();
      res.json({ count: items.length, items });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/tradingview/indicator", async (req, res) => {
    try {
      const name = String(req.query.name ?? "");
      if (!name) return res.status(400).json({ error: "name query param required (e.g. ?name=RSI)" });
      const item = await tvBridge.getIndicatorValue(name);
      if (!item) return res.status(404).json({ error: `Indicator '${name}' not found in chart legend. Add it to your TV chart first.` });
      res.json(item);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 5b — return parsed/typed indicator values (RSI, Ichimoku, Supertrend, Volume)
  app.get("/api/tradingview/indicators", async (_req, res) => {
    try {
      res.json(await readTVIndicators(tvBridge));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 6 — Gemini Vision analysis of the current TradingView chart
  app.get("/api/tradingview/vision", async (req, res) => {
    try {
      const symbol = req.query.symbol ? String(req.query.symbol) : undefined;
      const timeframe = req.query.timeframe ? String(req.query.timeframe) : undefined;
      const chartOnly = req.query.chartOnly !== "0" && req.query.chartOnly !== "false";
      res.json(await analyzeChart(tvBridge, { symbol, timeframe, chartOnly }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 6 — Multi-timeframe vision analysis (cycles the chart through TFs)
  app.post("/api/tradingview/vision/multi", async (req, res) => {
    try {
      const { symbol, timeframes, chartOnly } = req.body ?? {};
      if (!Array.isArray(timeframes) || timeframes.length === 0) {
        return res.status(400).json({ error: "timeframes array required (e.g. ['1h','4h','1d'])" });
      }
      res.json(await analyzeChartMultiTimeframe(tvBridge, timeframes, { symbol, chartOnly }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Temporary diagnostic for tuning legend selectors against the live TV DOM.
  app.get("/api/tradingview/_debug-legend", async (_req, res) => {
    try {
      res.json(await tvBridge._debugLegend());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/tradingview/_debug-legend-children", async (_req, res) => {
    try {
      res.json(await tvBridge._debugLegendChildren());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/tradingview/_debug-geometry", async (_req, res) => {
    try {
      res.json(await tvBridge._debugChartGeometry());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- STRATEGY TRACKER ROUTES ---

  // Get all strategy stats
  app.get("/api/strategies/stats", async (_req, res) => {
    try {
      const stats = await strategyTracker.getAllStats();
      res.json({ stats });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get performance summary
  app.get("/api/strategies/summary", async (_req, res) => {
    try {
      const summary = await strategyTracker.getPerformanceSummary();
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Record a trade outcome
  app.post("/api/strategies/outcome", async (req, res) => {
    try {
      const stats = await strategyTracker.recordOutcome(req.body);
      res.json({ status: "recorded", stats });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Toggle strategy pause/active
  app.patch("/api/strategies/:name/toggle", async (req, res) => {
    try {
      const stats = await strategyTracker.toggleStrategy(req.params.name);
      res.json({ status: "toggled", stats });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- MARKET SCANNER ROUTES ---

  // Trigger a manual scan
  app.post("/api/scanner/scan", async (_req, res) => {
    try {
      const result = await marketScanner.scan();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get latest scan results (cached, or trigger fresh if none)
  app.get("/api/scanner/latest", async (_req, res) => {
    try {
      let scan = marketScanner.getLastScan();
      if (!scan || scan.totalPairs === 0) {
        // No cached scan — run one now
        scan = await marketScanner.scan();
      }
      res.json(scan);
    } catch (error: any) {
      res.status(500).json({ error: error.message, totalPairs: 0, allResults: [], topOpportunities: [] });
    }
  });

  // Get scan history
  app.get("/api/scanner/history", async (_req, res) => {
    try {
      const history = await marketScanner.getScanHistory(10);
      res.json({ history });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Trigger a stock scan via Alpaca (Phase 8.2)
  app.post("/api/scanner/scan-stocks", async (_req, res) => {
    try {
      const ownerId = getOwnerId();
      if (!ownerId) return res.status(400).json({ error: 'OWNER_USER_ID not set yet — sign in first.' });
      const result = await marketScanner.scanStocks(ownerId);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- ALPACA SMOKE TEST ---
  // Quick "is the connector wired?" check. GETs Alpaca's market clock —
  // also tells you whether US equities are currently tradable.
  app.get("/api/alpaca/clock", async (_req, res) => {
    try {
      const ownerId = getOwnerId();
      if (!ownerId) return res.status(400).json({ error: 'OWNER_USER_ID not set yet — sign in first.' });
      const { AlpacaConnector } = await import('./engine/alpacaConnector.ts');
      const doc = await db.collection('users').doc(ownerId).collection('secrets').doc('apiKeys').get();
      const data: any = doc.exists ? (doc.data() || {}) : {};
      const apiKeyId = data.alpacaApiKeyId || process.env.ALPACA_API_KEY_ID || '';
      const secretKey = data.alpacaSecretKey || process.env.ALPACA_SECRET_KEY || '';
      if (!apiKeyId || !secretKey) {
        return res.status(400).json({ error: 'Alpaca credentials not configured. Add them under Broker Settings or set ALPACA_API_KEY_ID / ALPACA_SECRET_KEY in .env.' });
      }
      const alpaca = new AlpacaConnector({ apiKeyId, secretKey, paper: true });
      const clock = await alpaca.getClock();
      res.json(clock);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- KELLY POSITION SIZING ROUTES ---

  // Get full Kelly report for a user
  app.get("/api/kelly/:userId", async (req, res) => {
    try {
      const report = await kellyCalculator.getKellyReport(req.params.userId);
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get optimal position size for a specific trade
  app.post("/api/kelly/size", async (req, res) => {
    const { userId, capital, symbol, confidence } = req.body;
    if (!userId || !capital) return res.status(400).json({ error: "userId and capital are required" });
    try {
      const result = await kellyCalculator.getOptimalPositionSize(userId, capital, symbol, confidence);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- MARKET SENTIMENT ROUTES ---

  // Get latest sentiment analysis
  app.get("/api/sentiment", async (_req, res) => {
    try {
      // Try in-memory cache first
      const cached = scraper.getLastResult();
      if (cached) return res.json(cached);

      // Fallback: read from Firestore
      const doc = await db.collection('marketSentiment').doc('latest').get();
      if (doc.exists) return res.json(doc.data());

      res.json({ sentimentScore: 50, classification: 'neutral', narrative: 'Sentiment pipeline has not run yet.', drivers: [], sources: [], headlineCount: 0, timestamp: new Date().toISOString() });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- MARKET REGIME DETECTION ROUTES ---

  // Get regime for a specific symbol
  app.get("/api/regime/:symbol", async (req, res) => {
    try {
      const symbol = req.params.symbol.includes('/') ? req.params.symbol : req.params.symbol.replace('USDT', '/USDT');
      const timeframe = (req.query.tf as string) || '4h';
      const result = await regimeDetector.detectRegime(symbol, timeframe);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get overall market regime (scans top coins)
  app.get("/api/regime", async (_req, res) => {
    try {
      const { SCAN_PAIRS } = await import('./engine/marketScanner.ts');
      const symbols = SCAN_PAIRS.slice(0, 10).map(s => s.replace('USDT', '/USDT'));
      const summary = await regimeDetector.scanMarketRegime(symbols);
      res.json(summary);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- AGENT SWARM ROUTES ---

  // Trigger the full agent pipeline
  app.post("/api/swarm/run", async (req, res) => {
    const { userId, isPractice, targetSymbol } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });
    try {
      const result = await agentSwarm.runPipeline(userId, isPractice ?? true, targetSymbol, true); // ALWAYS require approval
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get recent brain activity feed
  app.get("/api/swarm/activity", async (_req, res) => {
    try {
      const activity = await agentSwarm.getRecentActivity(30);
      res.json({ activity });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Cleanup old activity
  app.post("/api/swarm/cleanup", async (_req, res) => {
    try {
      await agentSwarm.cleanupActivity();
      res.json({ status: "cleaned" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- GOAL PLANNER ROUTES ---

  // Create a new trading goal
  app.post("/api/goals/create", async (req, res) => {
    const { userId, targetProfit, capital, isPractice, deadlineDays, maxSlots } = req.body;
    if (!userId || !targetProfit || !capital) {
      return res.status(400).json({ error: "userId, targetProfit, and capital are required" });
    }
    try {
      const campaign = await goalExecutor.createCampaign(
        userId, 
        Number(targetProfit), 
        Number(capital), 
        deadlineDays ? Number(deadlineDays) : 7, 
        isPractice ?? true, 
        maxSlots ? Number(maxSlots) : 3
      );
      res.json({ status: "success", goal: campaign, tradeInfo: null });
    } catch (error: any) {
      console.error("Failed to create campaign:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get goals for a user
  app.get("/api/goals/:userId", async (req, res) => {
    try {
      const goals = await goalPlanner.getGoals(req.params.userId);
      res.json({ goals });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update goal progress
  app.patch("/api/goals/:goalId/progress", async (req, res) => {
    const { currentPnl } = req.body;
    try {
      const goal = await goalPlanner.updateProgress(req.params.goalId, Number(currentPnl));
      res.json({ status: "success", goal });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Toggle goal pause/resume
  app.patch("/api/goals/:goalId/toggle", async (req, res) => {
    try {
      await goalPlanner.toggleGoal(req.params.goalId);
      res.json({ status: "success" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a goal permanently
  app.delete("/api/goals/:goalId", async (req, res) => {
    try {
      await db.collection('tradingGoals').doc(req.params.goalId).delete();
      res.json({ status: "success", message: "Goal deleted" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- CAMPAIGN MANAGEMENT ROUTES ---
  
  // Get all campaigns for a user
  app.get("/api/campaigns/:userId", async (req, res) => {
    try {
      const campaigns = await goalExecutor.getUserCampaigns(req.params.userId);
      res.json({ campaigns });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get a specific campaign
  app.get("/api/campaigns/detail/:campaignId", async (req, res) => {
    try {
      const campaign = await goalExecutor.getCampaign(req.params.campaignId);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      res.json({ campaign });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Pause a campaign
  app.patch("/api/campaigns/:campaignId/pause", async (req, res) => {
    try {
      await goalExecutor.pauseCampaign(req.params.campaignId);
      res.json({ status: "success", message: "Campaign paused" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Resume a campaign
  app.patch("/api/campaigns/:campaignId/resume", async (req, res) => {
    try {
      await goalExecutor.resumeCampaign(req.params.campaignId);
      res.json({ status: "success", message: "Campaign resumed" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- USER SECRETS ROUTES ---
  app.get("/api/secrets/:userId", async (req, res) => {
    try {
      const secrets = await userSecrets.getSecrets(req.params.userId);
      // Mask sensitive values for the frontend
      res.json({
        status: 'success',
        secrets: {
          geminiApiKey: secrets.geminiApiKey ? '••••' + secrets.geminiApiKey.slice(-4) : '',
          binanceApiKey: secrets.binanceApiKey ? '••••' + secrets.binanceApiKey.slice(-4) : '',
          binanceSecretKey: secrets.binanceSecretKey ? '••••' + secrets.binanceSecretKey.slice(-4) : '',
          telegramBotToken: secrets.telegramBotToken ? '••••' + secrets.telegramBotToken.slice(-6) : '',
          telegramChatId: secrets.telegramChatId || '',
          // Flags so frontend knows which keys are set
          hasGemini: !!secrets.geminiApiKey,
          hasBinance: !!(secrets.binanceApiKey && secrets.binanceSecretKey),
          hasTelegram: !!(secrets.telegramBotToken && secrets.telegramChatId),
        }
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/secrets/:userId", async (req, res) => {
    try {
      const { geminiApiKey, binanceApiKey, binanceSecretKey, telegramBotToken, telegramChatId } = req.body;
      await userSecrets.saveSecrets(req.params.userId, {
        geminiApiKey,
        binanceApiKey,
        binanceSecretKey,
        telegramBotToken,
        telegramChatId,
      });
      res.json({ status: 'success' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- MEMORY MIGRATION (one-time) ---
  // Moves orphaned PostMortem lessons + vectorMemory docs into the real user memory bank
  app.post("/api/memory/migrate/:userId", async (req, res) => {
    const userId = req.params.userId;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    let migrated = 0;
    let skipped = 0;
    const errors: string[] = [];

    try {
      // 1. Migrate from postMortems collection (has userId indirectly via trades)
      console.log(`[MIGRATION] Starting memory migration for user ${userId}...`);

      const pmSnap = await db.collection('postMortems').get();
      for (const doc of pmSnap.docs) {
        const pm = doc.data();
        try {
          // Build the lesson text
          const lessons = pm.lessons?.join('. ') || '';
          const memoryText = `[TRADE LESSON] ${pm.symbol} ${pm.side} — Grade: ${pm.grade} — ${pm.analysis || ''} Lessons: ${lessons}`;
          
          if (memoryText.length < 20) {
            skipped++;
            continue;
          }

          await memoryManager.saveMemory(userId, memoryText, 'semantic');
          migrated++;
          console.log(`[MIGRATION] ✅ PostMortem ${doc.id} → memory bank (${pm.symbol} Grade ${pm.grade})`);
        } catch (err: any) {
          errors.push(`PostMortem ${doc.id}: ${err.message}`);
        }
      }

      // 2. Migrate from vectorMemory collection (the old dead-end collection)
      const vmSnap = await db.collection('vectorMemory').get();
      for (const doc of vmSnap.docs) {
        const vm = doc.data();
        try {
          const text = vm.text || '';
          if (text.length < 20) {
            skipped++;
            continue;
          }

          // Check if this was already for this user or global
          const targetUser = (vm.userId && vm.userId !== 'global_knowledge_base') ? vm.userId : userId;
          
          await memoryManager.saveMemory(targetUser, text, 'semantic');
          migrated++;
          console.log(`[MIGRATION] ✅ vectorMemory ${doc.id} → memory bank`);
        } catch (err: any) {
          errors.push(`vectorMemory ${doc.id}: ${err.message}`);
        }
      }

      console.log(`[MIGRATION] 🎉 Migration complete! ${migrated} memories migrated, ${skipped} skipped, ${errors.length} errors`);
      res.json({ 
        status: "success", 
        migrated, 
        skipped, 
        errors: errors.length,
        errorDetails: errors.slice(0, 5) // Only return first 5 errors
      });
    } catch (error: any) {
      console.error("[MIGRATION] Fatal error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- MEMORY BANK ROUTES ---
  app.post("/api/memory/save", async (req, res) => {
    const { userId, text, type } = req.body;
    if (!userId || !text) return res.status(400).json({ error: "userId and text are required" });

    try {
      await memoryManager.saveMemory(userId, text, type || 'episodic');
      res.json({ status: "success" });
    } catch (error: any) {
      console.error("Failed to save memory:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/memory/recall", async (req, res) => {
    const { userId, query, limit } = req.body;
    if (!userId || !query) return res.status(400).json({ error: "userId and query are required" });

    try {
      const userMemories = await memoryManager.recallMemories(userId, query, limit || 5);
      const globalMemories = await memoryManager.recallMemories('global_knowledge_base', query, 2);
      
      const combinedMemories = [...userMemories, ...globalMemories];
      
      res.json({ status: "success", memories: combinedMemories });
    } catch (error: any) {
      console.error("Failed to recall memory:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/memory/list/:userId", async (req, res) => {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      const memories = await memoryManager.listMemories(userId);
      res.json({ status: "success", memories });
    } catch (error: any) {
      console.error("Failed to list memories:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/memory/clear/:userId", async (req, res) => {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      const count = await memoryManager.clearAllMemories(userId);
      res.json({ status: "success", deletedCount: count });
    } catch (error: any) {
      console.error("Failed to clear all memories:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/memory/:userId/:memoryId", async (req, res) => {
    const { userId, memoryId } = req.params;
    if (!userId || !memoryId) return res.status(400).json({ error: "userId and memoryId are required" });

    try {
      await memoryManager.deleteMemory(userId, memoryId);
      res.json({ status: "success" });
    } catch (error: any) {
      console.error("Failed to delete memory:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/memory/study", async (req, res) => {
    const { userId, url, model } = req.body;
    if (!userId || !url) return res.status(400).json({ error: "userId and url are required" });

    try {
      const summary = await memoryManager.studyUrl(userId, url, undefined, model);
      res.json({ status: "success", summary });
    } catch (error: any) {
      console.error("Failed to study URL:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // SSE streaming study endpoint — sends real-time progress events
  app.post("/api/memory/study-stream", async (req, res) => {
    const { userId, url, model } = req.body;
    console.log(`[study-stream] Received request: userId=${userId}, url=${url}, model=${model || 'default'}`);
    if (!userId || !url) return res.status(400).json({ error: "userId and url are required" });

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      console.log('[study-stream] Starting studyUrl...');
      const summary = await memoryManager.studyUrl(userId, url, (stage, progress, message) => {
        console.log(`[study-stream] Progress: ${stage} ${progress}% - ${message}`);
        res.write(`data: ${JSON.stringify({ stage, progress, message })}\n\n`);
      }, model);

      // Send final event with summary
      res.write(`data: ${JSON.stringify({ stage: 'complete', progress: 100, message: '✓ Knowledge stored!', summary })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("Failed to study URL (stream):", error);
      res.write(`data: ${JSON.stringify({ stage: 'error', progress: 0, message: `Error: ${error.message}` })}\n\n`);
      res.end();
    }
  });

  // Deep study endpoint — crawls entire website and streams progress
  app.post("/api/memory/deep-study-stream", async (req, res) => {
    const { userId, url, model } = req.body;
    console.log(`[deep-study-stream] Received: userId=${userId}, url=${url}, model=${model || 'default'}`);
    if (!userId || !url) return res.status(400).json({ error: "userId and url are required" });

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      const result = await memoryManager.deepStudyUrl(userId, url, (stage, progress, message, meta) => {
        console.log(`[deep-study] ${stage} ${progress}% — ${message}`);
        res.write(`data: ${JSON.stringify({ stage, progress, message, meta })}\n\n`);
      }, model);

      res.write(`data: ${JSON.stringify({ stage: 'complete', progress: 100, message: `✓ Deep study complete! Studied ${result.pagesStudied} pages.`, meta: result })}\n\n`);
      res.end();
    } catch (error: any) {
      console.error("Deep study failed:", error);
      res.write(`data: ${JSON.stringify({ stage: 'error', progress: 0, message: `Error: ${error.message}` })}\n\n`);
      res.end();
    }
  });

  // Backwards-compatible study-website endpoint
  app.post("/api/study-website", async (req, res) => {
    const { userId, url, model } = req.body;
    if (!userId || !url) return res.status(400).json({ error: "userId and url are required" });

    try {
      const summary = await memoryManager.studyUrl(userId, url, undefined, model);
      res.json({ status: "success", summary });
    } catch (error: any) {
      console.error("Failed to study URL:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- AUTONOMOUS AGENT ROUTES ---
  app.post("/api/agent/research", async (req, res) => {
    const { userId, topic, durationMinutes } = req.body;
    if (!userId || !topic) return res.status(400).json({ error: "userId and topic are required" });

    const minutes = durationMinutes ? parseInt(durationMinutes) : 30;

    // We do NOT await this. It runs autonomously in the background.
    webAgent.startResearch(userId, topic, minutes).catch(e => {
      console.error("[WebAgent] Background loop error:", e);
    });

    res.json({ 
      status: "success", 
      message: `Jarvis Autonomous Research initiated. Topic: '${topic}'. Max duration: ${minutes}m.` 
    });
  });

  // --- SENTRY MODE ROUTES ---
  app.post("/api/sentry/activate", async (req, res) => {
    const { userId, symbol, autonomousPrompt, maxDailyLoss, targetDailyProfit, isPractice, market } = req.body;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      await db.collection('sentryConfigs').doc(userId).set({
        active: true,
        isAutonomous: true,
        symbol: symbol || 'BTC/USDT',
        autonomousPrompt: autonomousPrompt || '',
        maxDailyLoss: maxDailyLoss ? Number(maxDailyLoss) : null,
        targetDailyProfit: targetDailyProfit ? Number(targetDailyProfit) : null,
        isPractice: isPractice !== undefined ? isPractice : true,
        market: market || 'crypto',
        updatedAt: new Date().toISOString()
      }, { merge: true });
      console.log(`[SENTRY] Activated for user ${userId}: ${symbol} — "${autonomousPrompt}"`);
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
        // Sane defaults — 1% daily loss, 10% max position, 5 open trades, $300 auto-liquidate
        return res.json({
          status: "success",
          settings: {
            maxDailyLoss: 1000,
            maxPositionSizePct: 10,
            autoLiquidateThreshold: 300,
            maxOpenPositions: 5,
            capitalPerTrade: 8000,
            profitTarget: 50,
          }
        });
      }
      res.json({ status: "success", settings: doc.data() });
    } catch (error: any) {
      if (!serviceAccount && error.message?.includes('default credentials')) {
        return res.json({
          status: "success",
          settings: { maxDailyLoss: 1000, maxPositionSizePct: 10, autoLiquidateThreshold: 300, maxOpenPositions: 5, capitalPerTrade: 8000, profitTarget: 50 }
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

  // --- LIVE RISK DASHBOARD ---
  app.get("/api/risk-dashboard", async (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      // 1. Get risk settings
      const settingsDoc = await db.collection('riskSettings').doc(userId).get();
      const settings = settingsDoc.exists ? settingsDoc.data() : {
        maxDailyLoss: 1000, maxPositionSizePct: 10, autoLiquidateThreshold: 300, maxOpenPositions: 5
      };

      // 2. Get open positions
      const openSnapshot = await db.collection('trades').where('status', '==', 'open').where('userId', '==', userId).get();
      const openTrades = openSnapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));

      // 3. Calculate worst-case loss (if all SLs hit)
      let worstCaseLoss = 0;
      const positionDetails = openTrades.map((t: any) => {
        const entry = t.entryPrice || 0;
        const sl = t.stopLossPrice || 0;
        const qty = t.quantity || 0;
        const isLong = t.side === 'buy';
        const slLoss = sl > 0
          ? (isLong ? (entry - sl) * qty : (sl - entry) * qty)
          : entry * qty * 0.02; // assume 2% loss if no SL
        worstCaseLoss += Math.abs(slLoss);

        // Get current price from marketState
        const rawSymbol = (t.symbol || '').replace('/', '').toUpperCase();
        const currentPrice = marketState.prices?.[rawSymbol]?.price
          || marketState.prices?.[t.symbol]?.price
          || entry;
        const priceDiff = currentPrice - entry;
        const unrealizedPnl = isLong ? priceDiff * qty : -priceDiff * qty;

        return {
          symbol: t.symbol,
          side: t.side,
          entryPrice: entry,
          currentPrice,
          quantity: qty,
          stopLoss: sl,
          takeProfit: t.takeProfitPrice || 0,
          unrealizedPnl,
          riskPercent: t.riskPercent || 2,
        };
      });

      // 4. Get today's realized P&L
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      let todayPnl = 0;
      let todayTrades = 0;
      let todayWins = 0;
      let todayLosses = 0;
      try {
        const closedToday = await db.collection('trades')
          .where('status', '==', 'closed')
          .where('userId', '==', userId)
          .where('closedAt', '>=', todayStart.toISOString())
          .get();
        closedToday.docs.forEach((d: any) => {
          const data = d.data();
          todayPnl += data.realizedPnl || data.pnl || 0;
          todayTrades++;
          if ((data.realizedPnl || data.pnl || 0) > 0) todayWins++;
          else todayLosses++;
        });
      } catch {}

      // 5. Get recent risk events (vetoes, circuit breakers)
      let riskEvents: any[] = [];
      try {
        const eventsSnap = await db.collection('brainActivity')
          .where('userId', '==', userId)
          .where('type', 'in', ['veto', 'error'])
          .orderBy('timestamp', 'desc')
          .limit(10)
          .get();
        riskEvents = eventsSnap.docs.map((d: any) => ({
          id: d.id,
          agent: d.data().agent,
          message: d.data().message,
          type: d.data().type,
          timestamp: d.data().timestamp,
        }));
      } catch {
        // Index might not exist — fallback to simpler query
        try {
          const eventsSnap = await db.collection('brainActivity')
            .where('userId', '==', userId)
            .orderBy('timestamp', 'desc')
            .limit(30)
            .get();
          riskEvents = eventsSnap.docs
            .map((d: any) => ({ id: d.id, ...d.data() }))
            .filter((e: any) => e.type === 'veto' || e.type === 'error')
            .slice(0, 10);
        } catch {}
      }

      // 6. Calculate portfolio heat
      const portfolioHeat = openTrades.reduce((sum: number, t: any) => sum + (t.riskPercent || 2), 0);

      // 7. Calculate daily loss progress
      const dailyLossProgress = settings.maxDailyLoss > 0
        ? Math.min(100, Math.abs(Math.min(0, todayPnl)) / settings.maxDailyLoss * 100)
        : 0;

      // 8. Calculate risk grade
      let grade = 'A';
      let gradeColor = 'emerald';
      const issues: string[] = [];

      if (dailyLossProgress > 80) { grade = 'F'; gradeColor = 'red'; issues.push('Dangerously close to daily loss limit'); }
      else if (dailyLossProgress > 50) { grade = 'C'; gradeColor = 'amber'; issues.push('Over 50% of daily loss limit used'); }

      if (openTrades.length >= (settings.maxOpenPositions || 5)) { issues.push('At maximum open positions'); if (grade > 'C') { grade = 'C'; gradeColor = 'amber'; } }
      if (portfolioHeat > 6) { issues.push(`Portfolio heat ${portfolioHeat.toFixed(1)}% exceeds safe limit`); if (grade > 'B') { grade = 'B'; gradeColor = 'blue'; } }
      if (worstCaseLoss > settings.maxDailyLoss * 0.8) { issues.push('Worst-case loss is close to daily limit'); grade = 'D'; gradeColor = 'orange'; }

      const noSLTrades = openTrades.filter((t: any) => !t.stopLossPrice);
      if (noSLTrades.length > 0) { issues.push(`${noSLTrades.length} position(s) without stop-loss!`); grade = 'F'; gradeColor = 'red'; }

      res.json({
        settings,
        portfolio: {
          openPositions: positionDetails,
          openCount: openTrades.length,
          maxPositions: settings.maxOpenPositions || 5,
          portfolioHeat,
          worstCaseLoss,
          totalUnrealized: positionDetails.reduce((s: number, p: any) => s + p.unrealizedPnl, 0),
        },
        today: {
          realizedPnl: todayPnl,
          trades: todayTrades,
          wins: todayWins,
          losses: todayLosses,
          dailyLossProgress,
          dailyLossLimit: settings.maxDailyLoss,
        },
        riskGrade: { grade, color: gradeColor, issues },
        riskEvents,
      });
    } catch (error: any) {
      console.error("Risk dashboard error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- JARVIS RISK AUDIT ---
  app.get("/api/risk-audit", async (req, res) => {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      // Fetch dashboard data internally
      const settingsDoc = await db.collection('riskSettings').doc(userId).get();
      const settings = settingsDoc.exists ? settingsDoc.data() : {
        maxDailyLoss: 1000, maxPositionSizePct: 10, autoLiquidateThreshold: 300, maxOpenPositions: 5
      };

      let openQuery = db.collection('trades').where('status', '==', 'open');
      if (userId) openQuery = openQuery.where('userId', '==', userId);
      const openSnapshot = await openQuery.get();
      const openCount = openSnapshot.size;

      // Get today's P&L
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      let todayPnl = 0;
      try {
        const closedToday = await db.collection('trades')
          .where('status', '==', 'closed')
          .where('closedAt', '>=', todayStart.toISOString())
          .get();
        closedToday.docs.forEach((d: any) => {
          todayPnl += d.data().realizedPnl || d.data().pnl || 0;
        });
      } catch {}

      const { generateText } = await import('./engine/modelRouter.ts');
      const prompt = `You are Jarvis Risk Auditor. You ONLY recommend TIGHTENING risk, NEVER increasing it.

Current Risk Settings:
- Max Daily Loss: $${settings.maxDailyLoss}
- Max Position Size: ${settings.maxPositionSizePct}%
- Auto-Liquidate Threshold: $${settings.autoLiquidateThreshold}
- Max Open Positions: ${settings.maxOpenPositions || 5}

Current State:
- Open positions: ${openCount}
- Today's realized P&L: $${todayPnl.toFixed(2)}
- Account size: ~$100,000 (paper)

Provide a brief risk assessment (3-4 bullet points max). Grade the settings A/B/C/D/F.
Format: Start with "GRADE: X" on first line, then bullet points.
Be specific. Reference the actual numbers.`;

      const audit = await generateText('gemini-2.5-flash', prompt);
      res.json({ audit });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Approve a pending autonomous trade
  app.post("/api/trade/approve", async (req, res) => {
    const { userId, tradeId } = req.body;
    if (!userId || !tradeId) return res.status(400).json({ error: "userId and tradeId required" });

    try {
      const docRef = db.collection('trades').doc(tradeId);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ error: "Trade not found" });

      const pendingTrade = docSnap.data()!;
      if (pendingTrade.userId !== userId) return res.status(403).json({ error: "Unauthorized" });
      if (pendingTrade.status !== 'pending') return res.status(400).json({ error: "Trade is not pending" });

      // Cap quantity using user's capitalPerTrade setting
      let safeQuantity = pendingTrade.quantity;
      try {
        // Read user's trade parameters
        const riskDoc = await db.collection('riskSettings').doc(userId).get();
        const capitalPerTrade = riskDoc.exists ? (riskDoc.data()?.capitalPerTrade || 8000) : 8000;
        
        // Get current price for accurate notional calc
        let currentPrice = pendingTrade.entryPrice || 1;
        try {
          const cleanSym = (pendingTrade.symbol || '').replace('/', '');
          const priceRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cleanSym}`);
          const priceData = await priceRes.json() as any;
          if (priceData.price) currentPrice = parseFloat(priceData.price);
        } catch {}

        const notional = safeQuantity * currentPrice;
        if (notional > capitalPerTrade) {
          safeQuantity = parseFloat((capitalPerTrade / currentPrice).toFixed(4));
          log(`[TRADE] Capped quantity from ${pendingTrade.quantity} to ${safeQuantity} (user capital: $${capitalPerTrade})`);
        }
      } catch {}

      // Execute actual trade
      const result = await tradeExecutor.execute({
        userId,
        symbol: pendingTrade.symbol,
        side: pendingTrade.side,
        quantity: safeQuantity,
        market: pendingTrade.market || 'crypto',
        mode: 'autonomous',
        isPractice: true, // Hard-locked safety net
        stopLossPrice: pendingTrade.stopLossPrice,
        takeProfitPrice: pendingTrade.takeProfitPrice,
        profitTarget: pendingTrade.profitTarget || null,
      });

      // Mark old pending as resolved/deleted
      await docRef.update({ status: 'approved', executedTradeId: result.tradeId });

      res.json({ status: "success", executedTrade: result });
    } catch (error: any) {
      if (!serviceAccount && error.message?.includes('default credentials')) {
        return res.json({ status: "success", mockExecuted: true });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Decline a pending trade
  app.post("/api/trade/decline", async (req, res) => {
    const { userId, tradeId } = req.body;
    if (!userId || !tradeId) return res.status(400).json({ error: "userId and tradeId required" });

    try {
      const docRef = db.collection('trades').doc(tradeId);
      const docSnap = await docRef.get();
      if (!docSnap.exists) return res.status(404).json({ error: "Trade not found" });

      const pendingTrade = docSnap.data()!;
      if (pendingTrade.userId !== userId) return res.status(403).json({ error: "Unauthorized" });
      if (pendingTrade.status !== 'pending') return res.status(400).json({ error: "Trade is not pending" });

      // Mark as declined
      await docRef.update({
        status: 'declined',
        declinedAt: new Date().toISOString(),
      });

      // Log to brain activity
      await db.collection('brainActivity').add({
        agent: 'executor',
        message: `❌ Trade DECLINED by user: ${pendingTrade.side?.toUpperCase()} ${pendingTrade.symbol} @ $${pendingTrade.entryPrice}`,
        type: 'action',
        userId,
        timestamp: new Date().toISOString(),
      });

      log(`[TRADE] ❌ User declined trade: ${pendingTrade.symbol}`);
      res.json({ status: "success", message: `Declined ${pendingTrade.symbol} trade` });
    } catch (error: any) {
      if (!serviceAccount && error.message?.includes('default credentials')) {
        return res.json({ status: "success", mockDeclined: true });
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
      const profitTargetValue = req.body.profitTarget ? parseFloat(req.body.profitTarget) : undefined;
      
      const result = await tradeExecutor.execute({
        userId,
        symbol,
        side,
        quantity: parseFloat(quantity),
        market: market || 'crypto',
        mode: mode || 'copilot',
        isPractice: isPractice !== undefined ? isPractice : true, // Safe default = practice
        stopLossPrice: stopLossPrice ? parseFloat(stopLossPrice) : undefined,
        takeProfitPrice: takeProfitPrice ? parseFloat(takeProfitPrice) : undefined,
        trailingStopDistance: trailingStopDistance ? parseFloat(trailingStopDistance) : undefined,
        profitTarget: profitTargetValue,
      });

      // Auto-create a Mission Objective if a direct trade has a profit target
      if (profitTargetValue) {
        try {
          const capital = result.filledQuantity * result.fillPrice;
          await goalPlanner.createGoal(userId, profitTargetValue, capital, isPractice || false);
          console.log(`[TRADE API] Auto-created goal for direct trade ${result.tradeId} (Target: $${profitTargetValue})`);
        } catch (goalErr) {
          console.error("[TRADE API] Failed to auto-create goal for direct trade:", goalErr);
        }
      }

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
      
      // FIRE POST-TRADE AUTOMATIONS
      setImmediate(async () => {
        try {
          const tradeData: any = result.trade || {};
          const pnlPercent = tradeData.entryPrice > 0 ? ((result.realizedPnl || 0) / (tradeData.entryPrice * tradeData.quantity)) * 100 : 0;

          // 1. PostMortem Analysis — Jarvis learns WHY it won or lost
          await postMortemEngine.analyze({
            tradeId: result.tradeId || tradeId,
            symbol: tradeData.symbol,
            side: tradeData.side,
            entryPrice: tradeData.entryPrice,
            exitPrice: result.exitPrice || tradeData.entryPrice,
            pnl: result.realizedPnl || 0,
            pnlPercent,
            closeReason: 'manual_close',
          });

          // 2. StrategyTracker — Record win/loss to auto-ban bad strategies
          await strategyTracker.recordOutcome({
            tradeId: result.tradeId || tradeId,
            symbol: tradeData.symbol,
            side: tradeData.side as 'buy' | 'sell',
            entryPrice: tradeData.entryPrice,
            exitPrice: result.exitPrice || tradeData.entryPrice,
            quantity: tradeData.quantity,
            pnl: result.realizedPnl || 0,
            pnlPercent,
            strategy: tradeData.mode || 'copilot',
            source: 'manual',
            closedAt: new Date().toISOString(),
          });

          // 3. GoalPlanner — Update Mission Objective progress
          const activeGoals = await goalPlanner.getGoals(userId);
          const activeGoal = activeGoals.find(g => g.status === 'active');
          if (activeGoal) {
            const newProgress = (activeGoal.currentProgress || 0) + (result.realizedPnl || 0);
            await goalPlanner.updateProgress(activeGoal.id, newProgress);
          }
          
          // GoalExecutor - Chain trades
          await goalExecutor.onTradeClosed(result.tradeId || tradeId, result.realizedPnl || 0, tradeData.symbol);

          // 4. ConfidenceEngine — Re-evaluate if it was a practice trade
          if (tradeData.isPractice) {
            await confidenceEngine.evaluateAndNotify(userId);
          }
        } catch (e: any) {
          console.error('[TRADE PIPELINE ERROR] Failed post-trade automations:', e.message);
        }
      });
      
      res.json({ status: "success", ...result });
    } catch (error: any) {
      console.error("Trade close failed:", error);
      res.status(500).json({ error: error.message || "Trade close failed" });
    }
  });

  // Get open positions with live P&L
  app.get("/api/positions", async (req, res) => {
    const userId = req.query.userId as string;
    const isPractice = req.query.isPractice === 'true';
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      const positions = await tradeExecutor.getOpenPositions(userId, isPractice);
      res.json({ status: "success", positions });
    } catch (error: any) {
      if (!serviceAccount && error.message?.includes('default credentials')) {
        return res.json({ status: "success", positions: [] });
      }
      console.error("Failed to fetch positions:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // (Removed duplicate /api/positions/close — use /api/trade/close instead)

  // --- CONFIDENCE ENGINE ROUTES ---

  // Per-user learning loop state (Phase 3: Multi-User Engine Instances)
  interface LearningLoopConfig {
    enabled: boolean;
    capital: number;
    profitTarget: number;
    symbol: string;
    userId: string;
    timer: ReturnType<typeof setTimeout> | null;
  }
  const learningLoops = new Map<string, LearningLoopConfig>();

  const getLearningLoop = (userId: string): LearningLoopConfig => {
    if (!learningLoops.has(userId)) {
      learningLoops.set(userId, {
        enabled: false,
        capital: 6000,
        profitTarget: 15,
        symbol: 'AUTO',
        userId,
        timer: null,
      });
    }
    return learningLoops.get(userId)!;
  };

  const runLearningCycle = async (userId: string) => {
    const loop = getLearningLoop(userId);
    if (!loop.enabled || !loop.userId) return;

    try {
      // Check if there's already an open paper position (don't stack)
      const openSnap = await db.collection('trades')
        .where('userId', '==', loop.userId)
        .where('status', '==', 'open')
        .where('isPractice', '==', true)
        .get();

      if (!openSnap.empty) {
        console.log(`[LEARNING LOOP] [${loop.userId.slice(0, 8)}] Open position exists — skipping this cycle`);
      } else {
        let bestPick;

        if (loop.symbol !== 'AUTO') {
          // If a specific symbol is forced, fetch its current price directly
          const latestPrice = await marketScanner.getPriceForSymbol(loop.symbol);
          if (latestPrice) {
            bestPick = { symbol: loop.symbol, price: latestPrice, score: 100, confluence: 'forced' };
          } else {
            console.warn(`[LEARNING LOOP] [${loop.userId.slice(0, 8)}] Could not get price for ${loop.symbol}, skipping cycle`);
          }
        } else {
          // Scan market for best coin
          const scanResult = await marketScanner.scan();
          bestPick = scanResult.topOpportunities.find(
            opp => opp.confluence === 'buy' || opp.confluence === 'strong_buy' || opp.score >= 60
          ) || scanResult.topOpportunities[0]; // fallback to #1 scored pair
        }

        if (bestPick) {
          const quantity = loop.capital / bestPick.price;
          const tpPrice = bestPick.price + (loop.profitTarget / quantity);
          const slPrice = bestPick.price * 0.985; // 1.5% stop loss

          await tradeExecutor.execute({
            userId: loop.userId,
            symbol: bestPick.symbol,
            side: 'buy',
            quantity,
            mode: 'sentry',
            isPractice: true,
            profitTarget: loop.profitTarget,
            takeProfitPrice: tpPrice,
            stopLossPrice: slPrice,
          });

          console.log(`[LEARNING LOOP] [${loop.userId.slice(0, 8)}] 📚 Auto-paper-trade: BUY ${bestPick.symbol} qty=${quantity.toFixed(2)} TP=$${tpPrice.toFixed(6)} (target: +$${loop.profitTarget})`);
        }
      }
    } catch (err: any) {
      console.error(`[LEARNING LOOP] [${loop.userId.slice(0, 8)}] Cycle error:`, err.message);
    }

    // Re-schedule next cycle (15 min)
    if (loop.enabled) {
      loop.timer = setTimeout(() => runLearningCycle(userId), 15 * 60 * 1000);
    }
  };

  // Get Jarvis confidence report
  app.get("/api/confidence/:userId", async (req, res) => {
    try {
      const userId = req.params.userId;
      const report = await confidenceEngine.getConfidenceReport(userId);
      const loop = getLearningLoop(userId);
      res.json({ status: "success", report, learningLoopEnabled: loop.enabled, learningLoopCapital: loop.capital, learningLoopProfitTarget: loop.profitTarget, learningSymbol: loop.symbol });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Trigger a confidence re-evaluation manually
  app.post("/api/confidence/:userId/evaluate", async (req, res) => {
    try {
      const report = await confidenceEngine.evaluateAndNotify(req.params.userId);
      res.json({ status: "success", report });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- TIME MACHINE SANDBOX ENDPOINTS ---

  app.post("/api/simulate-tick", async (req, res) => {
    const { userId, symbol, currentPrice, rsi, ema12, ema26, position, capital = 5000, profitTarget = 100 } = req.body;
    
    if (!symbol || currentPrice === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      // Create a specific prompt for the simulation decision
      const prompt = `You are Jarvis, an advanced AI Trading Agent operating in a historical Time Machine Sandbox.
      
SIMULATION CONSTRAINTS:
Capital: $${capital}
Target Profit: $${profitTarget}
      
CURRENT MARKET DATA:
Symbol: ${symbol}
Current Price: $${currentPrice.toFixed(2)}
RSI (14): ${rsi ? rsi.toFixed(2) : 'N/A'}
EMA(12): $${ema12 ? ema12.toFixed(2) : 'N/A'}
EMA(26): $${ema26 ? ema26.toFixed(2) : 'N/A'}
EMA Spread: ${ema12 && ema26 ? (((ema12 - ema26) / ema26) * 100).toFixed(4) + '%' : 'N/A'}
      
CURRENT POSITION:
${position ? `Direction: ${position.side.toUpperCase()}\nEntry Price: $${position.price.toFixed(2)}\nUnrealized P&L: ${(position.side === 'long' ? currentPrice - position.price : position.price - currentPrice) >= 0 ? '+' : '-'}$${Math.abs(position.side === 'long' ? currentPrice - position.price : position.price - currentPrice).toFixed(2)}` : 'No active position.'}

DECISION RULES:
1. If you hold NO position: Respond with EXACTLY 'LONG', 'SHORT', or 'HOLD'.
2. If you hold an active position: Respond with EXACTLY 'HOLD' (to keep it open) or 'EXIT' (to close it and take profit/loss).
3. Do not open a new position if one is already open.
4. After your action keyword, provide a 1-sentence reasoning starting with a dash (e.g. "HOLD - RSI is neutral").

Your response must start with LONG, SHORT, HOLD, or EXIT.`;

      const response = await generateText('gemini-2.5-flash', prompt);
      const cleaned = response.trim().toUpperCase();
      
      let action = 'HOLD';
      let reasoning = response.trim();
      
      if (cleaned.startsWith('LONG')) action = 'LONG';
      else if (cleaned.startsWith('SHORT')) action = 'SHORT';
      else if (cleaned.startsWith('EXIT')) action = 'EXIT';
      else if (cleaned.startsWith('HOLD')) action = 'HOLD';

      res.json({
        status: "success",
        action,
        reasoning,
        price: currentPrice
      });
    } catch (error: any) {
      console.error("[SIMULATE] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/simulate-lesson", async (req, res) => {
    const { userId, trade } = req.body;
    
    if (!userId || !trade) {
      return res.status(400).json({ error: "Missing userId or trade data" });
    }

    try {
      // Mock a closed trade object
      const mockTrade = {
        id: `sim_${Date.now()}`,
        tradeId: `sim_${Date.now()}`,
        symbol: trade.symbol,
        side: trade.side,
        quantity: 1, // Normalized
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        pnl: trade.pnl,
        closedAt: new Date(trade.timestamp * 1000).toISOString(),
        mode: 'paper',
        source: 'time-machine-simulation',
        userId: userId
      };

      // Force PostMortem Engine to analyze the simulated trade
      // This will permanently write the lesson to memory.md via memoryManager
      await postMortemEngine.analyze(mockTrade as any);

      res.json({ status: "success", message: "Lesson analyzed and stored in memory bank." });
    } catch (error: any) {
      console.error("[SIMULATE LESSON] Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Reset confidence (clear all paper trades + flags)
  app.post("/api/confidence/:userId/reset", async (req, res) => {
    const userId = req.params.userId;
    try {
      // Delete cached report and notification flag
      await db.collection('confidenceReports').doc(userId).delete().catch(() => {});
      await db.collection('confidenceFlags').doc(userId).delete().catch(() => {});
      // Delete all closed practice trades so score starts from 0
      const closedSnap = await db.collection('trades')
        .where('userId', '==', userId)
        .where('isPractice', '==', true)
        .where('status', '==', 'closed')
        .get();
      const batch = db.batch();
      closedSnap.docs.forEach((doc: any) => batch.delete(doc.ref));
      await batch.commit();
      console.log(`[CONFIDENCE ENGINE] Reset for user ${userId} — deleted ${closedSnap.size} closed paper trades`);
      res.json({ status: "success", message: `Confidence reset. Deleted ${closedSnap.size} closed paper trades.` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Start / stop the autonomous learning loop (per-user)
  app.post("/api/confidence/:userId/learning", async (req, res) => {
    const userId = req.params.userId;
    const { enabled, capital, profitTarget, symbol } = req.body;
    const loop = getLearningLoop(userId);

    loop.enabled = enabled ?? true;
    if (capital) loop.capital = Number(capital);
    if (profitTarget) loop.profitTarget = Number(profitTarget);
    if (symbol) loop.symbol = symbol;

    if (loop.timer) { clearTimeout(loop.timer); loop.timer = null; }

    if (loop.enabled) {
      console.log(`[LEARNING LOOP] Started for ${userId.slice(0, 8)} — Capital: $${loop.capital}, Target: +$${loop.profitTarget}, Symbol: ${loop.symbol}`);
      runLearningCycle(userId); // Start immediately
    } else {
      console.log(`[LEARNING LOOP] Stopped for ${userId.slice(0, 8)}`);
    }
    res.json({ status: "success", learningLoopEnabled: loop.enabled, learningLoopCapital: loop.capital, learningLoopProfitTarget: loop.profitTarget, learningSymbol: loop.symbol });
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

  // Clean up orphaned trades (missing isPractice field from old code)
  app.post("/api/admin/cleanup-orphaned-trades", async (req, res) => {
    try {
      const snapshot = await db.collection('trades')
        .where('status', '==', 'open')
        .get();
      
      let cleaned = 0;
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.isPractice === undefined || data.isPractice === null) {
          // Old trade missing isPractice — close it as cancelled
          await doc.ref.update({
            status: 'closed',
            isPractice: true,
            closedAt: new Date().toISOString(),
            closeReason: 'admin_cleanup_orphaned',
            pnl: 0,
          });
          cleaned++;
          log(`[CLEANUP] Closed orphaned trade ${doc.id}: ${data.symbol} (missing isPractice field)`);
        }
      }
      
      res.json({ status: 'success', cleaned, message: `Cleaned ${cleaned} orphaned trade(s)` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get trade history (closed trades)
  app.get("/api/trades/history", async (req, res) => {
    const userId = req.query.userId as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const isPractice = req.query.isPractice === 'true';
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      const trades = await tradeExecutor.getTradeHistory(userId, limit, isPractice);
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
    const isPractice = req.query.isPractice === 'true';
    if (!userId) return res.status(400).json({ error: "userId is required" });

    try {
      const pnl = await tradeExecutor.getDailyPnl(userId, isPractice);
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
  
  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const symbol = url.searchParams.get('symbol');
    const replayDate = url.searchParams.get('replayDate');
    const speed = parseInt(url.searchParams.get('speed') || '1');
    
    if (symbol) {
      // Initialize symbol if it doesn't exist
      if (!marketState[symbol]) {
        let realPrice = symbol.includes('BTC') ? 65000 : (symbol.includes('ETH') ? 3500 : 100);
        try {
          const cleanSym = symbol.replace('/', '');
          const bRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cleanSym}`);
          const bData = await bRes.json();
          const p = parseFloat(bData.price);
          if (p && !isNaN(p)) realPrice = p;
        } catch {}
        marketState[symbol] = { price: realPrice, lastChange: 0 };
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

  // Simulate non-crypto symbols only (crypto is now fed by BinancePriceFeed WebSocket)
  // Also broadcast latest prices to connected frontend WebSocket clients
  setInterval(() => {
    const symbols = Object.keys(marketState);
    const simulatedSymbols = symbols.filter(s => !s.includes('USDT') && !s.includes('BTC') && !s.includes('ETH'));

    // Simulate non-crypto symbols
    for (const symbol of simulatedSymbols) {
      const volatility = marketState[symbol].price * 0.0005;
      const change = (Math.random() - 0.5) * volatility;
      marketState[symbol].price += change;
      marketState[symbol].lastChange = change;
    }
    
    // Broadcast to WebSocket clients (frontend LiveMarketData widget)
    wss.clients.forEach((client) => {
      if (client.readyState === 1 && !(client as any).isReplay) {
        const symbol = (client as any).symbol;
        if (symbol && marketState[symbol]) {
          client.send(JSON.stringify({
            type: 'tick',
            symbol,
            timestamp: Date.now(),
            price: parseFloat(marketState[symbol].price.toFixed(6)),
            change: parseFloat(marketState[symbol].lastChange.toFixed(6)),
            volume: Math.floor(Math.random() * 100) + 1,
          }));
        }
      }
    });
  }, 2000); // Broadcast every 2 seconds (prices are already live from WebSocket)

  // ─── TRADE DIARY API ────────────────────────────────────────
  app.get('/api/diary/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const limit = parseInt(req.query.limit as string) || 20;
      const symbol = req.query.symbol as string | undefined;

      const entries = await tradeDiary.getEntries(userId, limit, symbol);
      res.json({ entries, count: entries.length });
    } catch (err: any) {
      console.error('[API] Diary fetch error:', err.message);
      res.status(500).json({ error: 'Failed to fetch diary entries' });
    }
  });

  app.get('/api/market-data', async (req, res) => {
    const symbol = req.query.symbol as string;
    
    if (!symbol) {
      return res.status(400).json({ error: "Symbol is required" });
    }

    // Initialize symbol if it doesn't exist — fetch REAL price from Binance
    if (!marketState[symbol]) {
      let realPrice = symbol.includes('BTC') ? 65000 : (symbol.includes('ETH') ? 3500 : 100);
      try {
        const cleanSymbol = symbol.replace('/', '');
        const binanceRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cleanSymbol}`);
        const binanceData = await binanceRes.json();
        const parsed = parseFloat(binanceData.price);
        if (parsed && !isNaN(parsed)) realPrice = parsed;
      } catch {}
      marketState[symbol] = { price: realPrice, lastChange: 0 };
      priceFeed.trackSymbol(symbol); // Ensure WebSocket tracks this symbol
    }

    const tick = {
      type: 'tick',
      symbol,
      timestamp: Date.now(),
      price: parseFloat(marketState[symbol].price.toFixed(6)),
      change: parseFloat(marketState[symbol].lastChange.toFixed(2)),
      volume: Math.floor(Math.random() * 100) + 1,
    };
    
    res.json(tick);
  });

  // --- PRICE FEED STATUS (for frontend maintenance banner) ---
  app.get('/api/price-feed/status', (req, res) => {
    res.json({ status: 'success', ...priceFeed.getStatus() });
  });

  // --- HISTORICAL REPLAY DATA ---
  app.get('/api/replay/candles', async (req, res) => {
    const symbol = req.query.symbol as string;
    const date = req.query.date as string;
    const interval = (req.query.interval as string) || '1m';

    if (!symbol || !date) {
      return res.status(400).json({ error: "Symbol and date are required" });
    }

    try {
      // ── Robust date parsing — handles YYYY-MM-DD and DD/MM/YYYY ──────
      let startDate: Date;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
        // DD/MM/YYYY → rewrite as YYYY-MM-DD so JS parses it correctly
        const [day, month, year] = date.split('/');
        startDate = new Date(`${year}-${month}-${day}`);
      } else {
        startDate = new Date(date);
      }

      if (isNaN(startDate.getTime())) {
        console.error(`[REPLAY] Invalid date received: "${date}"`);
        return res.status(400).json({ error: `Invalid date format: "${date}". Use YYYY-MM-DD.` });
      }

      startDate.setUTCHours(0, 0, 0, 0);
      const startTime = startDate.getTime();
      const endTime = startTime + 24 * 60 * 60 * 1000; // end of that day

      const cleanSymbol = symbol.replace('/', '').replace('BINANCE:', '').toUpperCase();

      console.log(`[REPLAY] Fetching ${cleanSymbol} candles for ${startDate.toISOString().split('T')[0]} (${interval})`);

      // Use the REAL Binance public API (no API key needed for klines)
      const url = `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1000`;
      const response = await fetch(url);

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[REPLAY] Binance API error ${response.status}: ${errText}`);
        return res.status(502).json({ error: `Binance API error: ${response.status} — ${errText}` });
      }

      const klines = await response.json();

      if (!Array.isArray(klines) || klines.length === 0) {
        console.warn(`[REPLAY] No candles returned for ${cleanSymbol} on ${date}`);
        return res.status(404).json({ error: "No historical data found for this symbol and date. The market may have been closed or data is unavailable." });
      }

      console.log(`[REPLAY] Got ${klines.length} candles for ${cleanSymbol}`);

      // Binance klines: [openTime, open, high, low, close, volume, closeTime, ...]
      const formattedCandles = klines.map((k: any) => ({
        time: Math.floor(k[0] / 1000), // lightweight-charts expects UNIX seconds
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        value: parseFloat(k[5]), // volume — for histogram series
        color: parseFloat(k[4]) >= parseFloat(k[1]) ? '#26a69a' : '#ef5350',
      }));

      res.json({ status: "success", data: formattedCandles });
    } catch (error: any) {
      console.error("[REPLAY] Failed to fetch historical candles:", error);
      res.status(500).json({ error: error.message || "Failed to fetch historical candles" });
    }
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
    const server = app.listen(PORT, "0.0.0.0", async () => {
      log(`Server running on http://localhost:${PORT}`);
      
      // Start Telegram Listener
      try {
        const { TelegramListener } = await import('./engine/telegramListener.ts');
        const telegramListener = new TelegramListener(db, tradeExecutor);
        telegramListener.start();
      } catch (err: any) {
        console.error('[TELEGRAM] Failed to start listener:', err.message);
      }
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

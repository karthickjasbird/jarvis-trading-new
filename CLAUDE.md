# CLAUDE.md — Jarvis AI Trading Platform

Codebase map for Claude. Read this instead of re-exploring the repo.

## What this is

Jarvis is an autonomous AI crypto-trading platform. A multi-agent "swarm" scans
crypto pairs, proposes trades, runs risk checks, and either auto-executes
(Sentry mode) or asks the user to approve (Copilot mode). Background engines
monitor open positions, grade closed trades, and learn from outcomes.

Single-user app, scoped throughout by `OWNER_USER_ID`. Currently runs in
Practice (paper) mode.

## Tech stack

- Frontend: React 19 + TypeScript, Vite, Tailwind v4, Motion, lightweight-charts, Recharts
- Backend: Express 4 + TypeScript, run via `tsx`
- DB: Firebase Firestore (`firebase-admin` backend, `firebase` web SDK frontend); Firebase Auth (Google sign-in)
- AI: Google Gemini (`@google/genai`) primary, Groq Llama fallback
- Exchanges: `ccxt` (Binance/Bybit), `kiteconnect` (Zerodha)
- Mobile: Capacitor (Android/iOS wrappers)

## Dev commands

- `npm run dev` / `npm start` → `tsx server.ts`, serves on **http://localhost:3000** (Vite middleware serves the frontend)
- `npm run build` → `vite build`
- `npm run lint` → `tsc --noEmit` (typecheck only — there is no test suite)
- Server logs to `startup.log` (gitignored). `find_port.ts` kills a running `tsx server.ts`.

## Layout

- `server.ts` — ~3,200-line Express app: ~94 API routes, WebSocket market feed, engine init, background loops
- `engine/` — 29 backend engine modules (map below)
- `src/` — React frontend (`App.tsx` root, `components/`, `hooks/`, `services/`, `utils/`)
- `scratch/` — throwaway debug/inspection scripts (NOT app code)
- `android/`, `ios/`, `dist/` — Capacitor mobile wrappers + build output

## Engine map (`engine/`)

**Trade lifecycle**
- `agentSwarm.ts` — multi-agent pipeline (Scout→Analyst→Scholar→Strategist→Sentinel→Executor); logs to `brainActivity`
- `tradeExecutor.ts` — places/closes trades (paper + live), risk checks, position sizing
- `sentry.ts` — real-time position monitor: SL/TP, trailing stops, partial closes, circuit breaker
- `positionMonitor.ts` — closes stale trades (>4h), records outcomes
- `postMortem.ts` — grades closed trades A–F, extracts lessons
- `tradeDiary.ts` — decision audit trail: logs every swarm decision incl. vetoes/rejections

**Market analysis**
- `technicalAnalysis.ts` — OHLCV indicators (RSI, MACD, EMA, BB, ATR, ADX, OBV, VWAP), multi-timeframe
- `regimeDetector.ts` — classifies trending/ranging/volatile via ADX/ATR/BB/EMA
- `marketScanner.ts` — ranks ~20 crypto pairs; TA signal is the primary score driver
- `scraper.ts` — news RSS + Fear&Greed → sentiment score + narrative
- `marketIntel.ts` — fundamentals (BTC dominance, funding rates, whale alerts)
- `binancePriceFeed.ts` — Binance WebSocket live price stream
- `atrCalculator.ts` — ATR helper for SL/TP placement

**Risk & sizing**
- `kellyCalculator.ts` — Kelly Criterion position sizing from trade history
- `correlationGuard.ts` — blocks correlated overexposure
- `strategyTracker.ts` — per-strategy stats; auto-disables losing strategies
- `confidenceEngine.ts` — scores user "live-ready" readiness 0–100%
- `portfolioIntel.ts` — portfolio heat / exposure snapshot

**Goals / campaigns**
- `goalExecutor.ts` — autonomous multi-trade campaigns (chaining, compounding, slots)
- `goalPlanner.ts` — goal CRUD + progress tracking

**Browser automation**
- `tradingViewBridge.ts` — (NEXUS Phase 4) puppeteer-core CDP bridge to a user-launched Chrome running TradingView. `setSymbol` / `setTimeframe` / `screenshot` / `evaluate`. Requires Chrome started with `--remote-debugging-port=9222 --user-data-dir=$HOME/chrome-debug`. Override URL via `CHROME_DEBUG_URL` env var.

**Learning / infra**
- `memory.ts` — vector memory bank (Gemini embeddings, semantic recall)
- `modelRouter.ts` — Gemini↔Groq routing with fallback
- `userSecrets.ts` — per-user encrypted API keys
- `manifestGenerator.ts` — auto-generates the self-awareness manifest
- `alertEngine.ts` — proactive alerts
- `telegram.ts` / `telegramListener.ts` — Telegram notifications + approval replies
- `backtestEngine.ts` — simple RSI/MACD backtester
- `webAgent.ts` — web search (placeholder)

## Frontend map (`src/`)

- `App.tsx` — root: auth gate, app-mode routing, copilot/sentry + practice/live toggles
- Components: `Dashboard` (positions/history/approvals), `JarvisBrain` (agent activity monitor),
  `ChatSidebar` (chat), `RiskManager` + `TradeParameters` (risk/capital settings),
  `BrokerSettings` (Binance/Zerodha config), `MarketWatchlist`, `LiveJarvisChart` /
  `TradingViewChart` / `ReplayChart`, `AnalyticsDashboard`, `JarvisMemories`,
  `OnboardingWizard`, `BacktestSimulator`, `Orb`, `ActivityPipeline`, `HomeInsights`,
  `LiveMarketData`, `Login`, `MaintenanceBanner` / `UpdateBanner`, `TimeMachineControls`
- Hooks: `useJarvisLive` (Gemini Live voice + tool calls), `useTrades` (Firestore trade
  listeners), `useMarketData` (WS prices), `useMarketIntel`
- `services/memoryService.ts`, `utils/commandDispatcher.ts`, `utils/audioUtils.ts`, `firebase.ts`

## Where to look for X

- Trade went wrong / not executed → `agentSwarm.ts` (decision), `tradeExecutor.ts` (execution)
- Position not closing / SL-TP issue → `sentry.ts`, `positionMonitor.ts`
- Position sizing / capital amount → `kellyCalculator.ts`, `tradeExecutor.ts`, `RiskManager.tsx` / `TradeParameters.tsx`
- Market scan / watchlist ranking → `marketScanner.ts`, `technicalAnalysis.ts`, `MarketWatchlist.tsx`
- Sentiment / news → `scraper.ts`, `marketIntel.ts`
- Agent activity UI → `JarvisBrain.tsx` + `brainActivity` Firestore collection
- Voice / chat behavior → `useJarvisLive.ts`, `ChatSidebar.tsx`, server `/api/sessions/*`
- An API route → search the route path in `server.ts`
- Risk limits / circuit breaker → `sentry.ts`, `tradeExecutor.ts`, `RiskManager.tsx`
- Campaigns / goals → `goalExecutor.ts`, `goalPlanner.ts`
- TradingView automation (symbol/TF/screenshot) → `tradingViewBridge.ts`; routes under `/api/tradingview/*` in `server.ts`

## External config (`.env`, see `.env.example`)

`OWNER_USER_ID`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `BINANCE_API_KEY` / `BINANCE_SECRET_KEY`,
`TELEGRAM_BOT_TOKEN`. Firestore auth via `serviceAccountKey.json`. Per-user keys also
stored at runtime via `userSecrets.ts`.

## Conventions & gotchas

- **`soul.md`, `memory.md`, `lesson.md` are Jarvis's IN-APP data** (his personality +
  runtime memory/heuristics) — they are app data, not project docs and not Claude's
  memory. Do not edit them as documentation.
- `scratch/` holds disposable debug scripts — ignore for app behavior.
- No automated tests; `npm run lint` (tsc) is the only check. Root `test-*.js` files are old ad-hoc API probes.
- Firestore collections: `trades`, `portfolios`, `goals`, `memories`, `brainActivity`,
  `postmortems`, `riskSettings`, `sentryConfigs`, `tradeDiary`.
- All background engines filter by `OWNER_USER_ID` (multi-tenant scoping).

## Current phase

Last commit: `v1.2.0`. Large uncommitted WIP — Agent Swarm overhaul + new Trade Diary
system + JarvisBrain UI expansion. Claude's memory file `project_phase.md` holds the
live snapshot; verify against `git status` each session.

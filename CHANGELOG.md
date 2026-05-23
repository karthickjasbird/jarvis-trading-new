# Changelog

All notable changes to Jarvis Trading Platform will be documented in this file.

## [1.4.0] - 2026-05-23

### Project NEXUS — Phase 8: Multi-Market Expansion

### Added
- **Alpaca Connector (`engine/alpacaConnector.ts`)** — REST client for US stocks and commodity ETFs (paper + live). Mirrors ccxt's `createMarketOrder` return shape so the trade executor's broker switch stays symmetric. Methods: `getClock` (market open/close), `getQuote` (latest trade + bid/ask), `getBars` (OHLCV), `placeMarketOrder` / `createMarketOrder`, `getPosition`, `closePosition`, `getAccount`. Paper vs live decided by the existing `isPractice` flag.
- **Stock + commodity scanner** — `STOCK_SCAN_PAIRS` adds 33 US tickers across mega-cap tech, semis, SaaS, finance, consumer, index ETFs (SPY/QQQ/IWM/DIA) and 6 commodity ETFs (GLD, SLV, USO, UNG, DBA, COPX). `marketScanner.scanStocks(userId)` uses Alpaca batched snapshots and returns the same `ScanSummary` shape as the crypto scan.
- **Crypto scanner growth** — `SCAN_PAIRS` expanded from 20 → 48 across L1, L2, DeFi, AI, Meme, RWA, Gaming, Utility, DEX/Oracle infra sectors.
- **Asset-class tabs on MarketWatchlist** — 🪙 Crypto / 📈 Stocks / 🛢️ Commodities. Switching swaps the data source and resets the table immediately.
- **Market-hours badge** — pulsing green "MARKET OPEN" / gray "MARKET CLOSED" pill on the stocks and commodities tabs, fed by `/api/alpaca/clock` polled every 60s.
- **Alpaca in Broker Settings** — added to the broker dropdown ("Alpaca (US Stocks + Commodity ETFs)"). The same `apiKey` + `apiSecret` form is reused; both the scanner and trade executor fall back through personal secrets vault → brokerConfigs → `.env`.
- **Asset-class routing in `tradeExecutor`** — `alpaca` case added in execute/closePosition/partialClose. Trades now carry a `market: 'crypto' | 'stock'` field derived from explicit param or symbol shape. Stock orders pre-check Alpaca's market clock and refuse cleanly when US session is closed.
- **Deadline-Aware Strategy Router (`engine/goalExecutor.ts`)** — `StrategyProfile` + `resolveStrategy()` map a campaign's remaining time-to-deadline to one of 4 buckets:
  - `scalp` (<6h): crypto only, 1H timeframe, Kelly ×1.3, min score 55
  - `day` (6h-3d): + stocks when US open, 1H/4H timeframe, Kelly ×1.0–1.15
  - `swing` (3-14d): + commodities, 4H, Kelly ×0.9
  - `position` (>14d): all classes, 1D, Kelly ×0.8
  `scanAndDeploy` rewritten to gather candidates across selected markets, sort merged by score, skip Binance-only regime detection for stocks (uses neutral defaults), apply `strategy.kellyMultiplier` on top of Kelly + regime sizing, and tag each trade with `market` so the executor routes to the right broker.
- **`/api/scanner/scan-stocks`** + **`/api/alpaca/clock`** — new endpoints (stock scan + connector smoke test).
- **Self-awareness manifest sync** — `manifestGenerator.ts` updated so Jarvis knows about all 33 engines (descriptions for `alpacaConnector`, `tradeDiary`, `tradingViewBridge`, `tvIndicators`, `tvVision` filled in) and the `capabilities` narrative now covers multi-market trading, deadline router, TradingView Vision, and Trade Diary.

### Known follow-ups
- `TechnicalAnalysisEngine` is still Binance-only — stock scoring is momentum-only until TA goes source-agnostic.
- Asset-class filter on `Dashboard.tsx` deferred (trade records already carry the `market` field; chip-set filter is trivial when first live stock positions appear).

## [1.1.0] - 2026-05-14

### Added
- **Campaign Manager (GoalExecutor)** — Multi-trade autonomous campaigns with:
  - Trade chaining (auto-deploys into next opportunity after each close)
  - Multi-coin slot allocation (up to 3 simultaneous trades)
  - Auto-compounding (profits reinvested into subsequent trades)
  - Deadline urgency system (adjusts aggression based on time remaining)
  - Telegram progress notifications
  - Campaign management API (list, detail, pause, resume)
- **Market Regime Detection** — Classifies markets as trending/ranging/volatile using ADX, ATR, BB Width, and EMA alignment
  - Regime-aware position sizing (campaigns auto-adjust based on conditions)
  - Regime-specific SL/TP multipliers
  - Automatic trade skipping in extreme volatility
  - `checkMarketRegime` voice tool — "Jarvis, is the market trending?"
  - REST API: `/api/regime` and `/api/regime/:symbol`
- **Kelly Position Sizing** — Mathematically optimal bet sizing based on trade history:
  - Full Kelly Criterion with Half-Kelly safety cap
  - Per-symbol Kelly fractions (bet more on coins with proven edge)
  - Confidence-scaled sizing (high TA confidence = larger position)
  - Win/loss streak tracking
  - `getKellyStats` voice tool — "Jarvis, what should my position size be?"
  - REST API: `/api/kelly/:userId` and `/api/kelly/size`
- **Scanner Intelligence Rewrite** — TA-driven scoring system:
  - TA signal is now PRIMARY driver of score (±40 points)
  - Bearish coins hard-capped at 45/100 (can never appear in Jarvis Picks)
  - BUY/SELL/NEUTRAL badges on all watchlist entries
  - "Scan Now" button for on-demand market analysis
  - Jarvis Picks filtered to BUY signals only

### Changed
- `createTradingGoal` tool now launches full campaigns instead of single trades
- Sentry Engine now chains into GoalExecutor on every trade close
- GoalExecutor now uses Kelly sizing instead of equal capital splitting

## [1.0.0] - 2026-05-14

### Added
- Multi-tenant OWNER_USER_ID scoping across all background engines
- Auto-detect owner middleware (captures UID on first sign-in)
- Onboarding Wizard — floating setup checklist for new users
- Version Update Banner — checks GitHub for updates, shows notification
- Firestore security rules for per-user data isolation
- Copy User ID button in Broker Settings
- Jarvis Self-Awareness System — auto-generated app manifest injected into AI context
- `inspectSystem` tool — Jarvis can query his own capabilities mid-conversation

### Fixed
- Logout confirmation modal (replaced broken `window.confirm` with React modal)
- Firestore composite index for `sentryConfigs` collection

### Security
- Deployed strict Firestore rules preventing cross-user data access
- Background engines now filter all queries by OWNER_USER_ID

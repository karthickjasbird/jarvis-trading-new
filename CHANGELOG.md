# Changelog

All notable changes to Jarvis Trading Platform will be documented in this file.

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

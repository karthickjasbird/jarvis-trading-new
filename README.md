# Jarvis AI Trading Terminal

**An AI-powered autonomous trading assistant.** A multi-agent swarm scans markets (crypto + US stocks + commodity ETFs), runs risk checks, and either auto-executes trades or asks you to approve — controlled by voice or chat. Background engines monitor open positions, grade closed trades, and learn from outcomes.

Single-user, runs locally. Built on Gemini AI + Firebase + Express + React.

---

## Setup

Two paths to get running:

- **Manual install** — follow [INSTALL.md](INSTALL.md). Target time: under 30 minutes from cloning to first scan.
- **AI-assisted install** — open the cloned repo in any LLM IDE (Antigravity, Cursor, Claude Code, GitHub Copilot Chat) and paste [ANTIGRAVITY_SETUP.md](ANTIGRAVITY_SETUP.md) as your first prompt. The agent will ask you for each credential and configure everything.

You'll need a Firebase project (free), a Gemini API key (free), and a Google account. Optional: Binance, Alpaca, Telegram, Groq.

---

## What Jarvis Does

### Agent Swarm
Each trade goes through a multi-agent pipeline before execution:

- **Scout** — scans 87 pairs (48 crypto + 33 stocks + 6 commodity ETFs) with real technical analysis
- **Analyst** — deep multi-timeframe analysis on top candidates
- **Scholar** — gathers live intel (Fear & Greed, BTC dominance, funding rates, news)
- **Holistic** — synthesizes signals into a unified view
- **Strategist** — builds ATR-based trade plans with position sizing
- **Sentinel** — risk gatekeeper (portfolio heat, correlation, backtest validation)
- **Executor** — places trades with Kelly Criterion sizing + deadline-aware strategy

Every decision (including vetoes) is logged to the **Trade Diary** for full audit.

### Autonomous Features
- **Sentry Engine** — monitors open positions for SL/TP/trailing stops
- **Campaign Manager** — autonomous multi-trade campaigns toward a target (e.g. "make $200 from $5000 in 24 hours")
- **Deadline-Aware Strategy Router** — maps remaining time to scalp/day/swing/position buckets
- **Kill Switch** — daily loss limit with auto-close
- **Post-Mortem AI** — grades every closed trade, stores lessons in vector memory
- **Strategy Tracker** — auto-disables underperforming strategies

### Interaction
- Voice chat via Gemini Live (the orb)
- Text chat in the sidebar
- TradingView bridge — Jarvis can read the chart you're looking at
- Telegram alerts (optional)

---

## Modes

- **Practice** (default) — paper trading, no real money, all engines run normally
- **Copilot** — Jarvis proposes, you approve every trade
- **Sentry** — fully autonomous within risk limits (live trading)

Toggle Practice/Live and Copilot/Sentry independently from the top bar.

---

## Disclaimer

> Jarvis is an AI-assisted trading tool, not a financial advisor.
>
> - Past performance does not guarantee future results
> - Crypto and equity trading carry significant risk of loss
> - Never trade with money you can't afford to lose
> - Start in Practice mode. Move to Live only after you've watched the bot's decisions long enough to trust them
> - You're responsible for monitoring your positions — AI is not infallible

---

## Stack

- Frontend: React 19 + TypeScript, Vite, Tailwind v4, Motion, lightweight-charts
- Backend: Express + TypeScript (`tsx`)
- DB: Firebase Firestore + Firebase Auth (Google sign-in)
- AI: Google Gemini primary, Groq Llama fallback
- Exchanges: ccxt (Binance), Alpaca REST (US equities), KiteConnect (Zerodha)
- Mobile: Capacitor (Android/iOS wrappers)

## Project Structure

```
├── server.ts                 # Express server + API routes + background engines
├── engine/                   # 29 backend modules (trade lifecycle, risk, ML)
├── src/
│   ├── App.tsx
│   ├── components/           # React UI
│   └── hooks/                # voice (useJarvisLive), trades, market data
├── INSTALL.md                # full setup guide
└── ANTIGRAVITY_SETUP.md      # AI-assisted setup prompt
```

For a complete map of which file handles what, see [CLAUDE.md](CLAUDE.md).

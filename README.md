# Jarvis AI Trading Terminal

**An AI-powered autonomous trading assistant** that uses Gemini AI, real-time Binance market data, and a 6-agent swarm intelligence system to analyze markets, execute trades, and learn from every outcome.

---

## 🚀 Quick Start (5 minutes)

### Prerequisites

- **Node.js v18+** — [Download here](https://nodejs.org/)
- **A Google account** — for signing into the app
- **A Gemini API Key** (free) — [Get one here](https://aistudio.google.com/apikey)

### Step 1: Clone & Install

```bash
git clone <repo-url> jarvis-trading
cd jarvis-trading
npm install
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in your **Gemini API key** (minimum required):

```env
GEMINI_API_KEY="your-gemini-api-key-here"
```

### Step 3: Add Firebase Credentials

Place the `serviceAccountKey.json` file in the project root. *(You should have received this file from the project admin.)*

### Step 4: Launch

```bash
npm run dev
```

Open **http://localhost:3000** in your browser.

### Step 5: Set Your Owner ID

1. Sign in with Google
2. Click the **gear icon** (⚙️) to open Settings
3. Find your **User ID** at the top — click **Copy**
4. Paste it into your `.env` file:
   ```env
   OWNER_USER_ID="your-uid-here"
   ```
5. Restart the server (`Ctrl+C` then `npm run dev`)

> **Why?** This ensures Jarvis only monitors YOUR trades. Without it, background engines may process other users' data if you're sharing the Firebase project.

---

## 📋 Full Configuration

| Variable | Required | Where to Get It | What It Does |
|----------|----------|-----------------|--------------|
| `OWNER_USER_ID` | ✅ Yes | Settings page → Copy button | Scopes all background engines to YOUR data |
| `GEMINI_API_KEY` | ✅ Yes | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Powers all AI features (chat, analysis, autonomous trading) |
| `BINANCE_API_KEY` | ❌ Optional | [Binance API Management](https://www.binance.com/en/my/settings/api-management) | Required for live trading (paper trading works without it) |
| `BINANCE_SECRET_KEY` | ❌ Optional | Same as above | Paired with Binance API Key |
| `TELEGRAM_BOT_TOKEN` | ❌ Optional | [@BotFather](https://t.me/botfather) → `/newbot` | Personal trade alerts via Telegram |
| `GROQ_API_KEY` | ❌ Optional | [console.groq.com](https://console.groq.com) | Fast fallback AI model (Llama 3.3) |

---

## 🧠 What Jarvis Does

### Agent Swarm (6 AI Agents)
- **Scout** — Scans markets with real technical analysis (RSI, MACD, EMA, ATR)
- **Analyst** — Deep-dives into the top opportunity with multi-timeframe confluence
- **Scholar** — Gathers live market intelligence (Fear & Greed, BTC dominance, funding rates)
- **Strategist** — Builds ATR-based trade plans with position sizing
- **Sentinel** — Risk management gatekeeper (portfolio heat, correlation guard, backtest validation)
- **Executor** — Places trades with Kelly Criterion sizing + session quality adjustments

### Autonomous Features
- **Sentry Engine** — Monitors all open positions for SL/TP/trailing stops
- **Position Monitor** — Closes stale trades, adjusts trailing stops
- **Kill Switch** — Daily loss limit protection with automatic position closure
- **Post-Mortem AI** — Analyzes every closed trade and stores lessons in memory
- **Strategy Tracker** — Auto-disables strategies that underperform

### Chat & Voice
- Live conversational AI via Gemini
- Voice interaction support
- Personal memory bank (Jarvis learns your preferences)

---

## ⚠️ Important Disclaimer

> **Jarvis is an AI-assisted trading tool, not a financial advisor.**
>
> - Past performance does not guarantee future results
> - Cryptocurrency trading carries significant risk of loss
> - Never trade with money you can't afford to lose
> - Always start with paper trading mode before going live
> - Monitor your positions — AI is not infallible

---

## 🛠️ Troubleshooting

### "Sentry index error" in console
This is normal on first run. Click the Firebase index link printed in the error to create the required composite index. It takes ~2 minutes to build.

### App stuck on "Connecting"
- Check your Gemini API key is valid
- Ensure you haven't hit the free tier rate limit (10 RPM for free keys)

### Port 3000 already in use
```bash
lsof -ti :3000 | xargs kill -9
npm run dev
```

---

## 📁 Project Structure

```
├── server.ts           # Express server + all background engines
├── engine/
│   ├── sentry.ts       # Real-time trade monitoring
│   ├── agentSwarm.ts   # 6-agent AI trading pipeline
│   ├── modelRouter.ts  # Gemini/Groq API routing
│   ├── memory.ts       # Vector memory bank
│   ├── telegram.ts     # Telegram notifications
│   ├── userSecrets.ts  # Per-user API key management
│   └── ...
├── src/
│   ├── components/     # React UI components
│   └── hooks/          # React hooks (live connection, etc.)
├── .env.example        # Environment template
└── serviceAccountKey.json  # Firebase credentials (not in git)
```

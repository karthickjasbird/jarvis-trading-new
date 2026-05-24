# Jarvis Trading Platform — Installation Guide

A complete, zero-to-running setup for a fresh machine. Target time: under 30 minutes.

> **Prefer an AI to walk you through this?** Open the repo in any LLM-powered IDE (Antigravity, Cursor, Claude Code, GitHub Copilot Chat) and paste the contents of [ANTIGRAVITY_SETUP.md](ANTIGRAVITY_SETUP.md) as your first prompt. The agent will ask you for credentials and configure everything.

---

## Quick Start

You'll need to create **4 accounts**, fill in **3 files**, and run **1 command**:

| What | Where | Required? |
|---|---|---|
| Google account | (you already have one) | Yes — for app sign-in |
| Firebase project | console.firebase.google.com | Yes — database + auth |
| Gemini API key | aistudio.google.com/apikey | Yes — powers all AI |
| Groq / Binance / Alpaca / Telegram | various | Optional features |

| File | What goes in it |
|---|---|
| `.env` | Your API keys (Gemini etc.) |
| `firebase-applet-config.json` | Firebase web client config |
| `serviceAccountKey.json` | Firebase admin SDK key |

Run command: `npm run dev` → open http://localhost:3000.

---

## Prerequisites

| Requirement | Version | How to Install (macOS) |
|---|---|---|
| Node.js | v20+ | `brew install node@20` — or use [nvm](https://github.com/nvm-sh/nvm) and run `nvm use` in repo (picks `.nvmrc`) |
| Git | Any recent | `brew install git` or [git-scm.com](https://git-scm.com) |
| Google Chrome | Any recent | [google.com/chrome](https://www.google.com/chrome) |
| Firebase CLI | Latest | `npm install -g firebase-tools` (we'll use it in Step 3) |

> **Heads up:** `npm install` will download a ~200MB Chromium binary for `puppeteer-core` (used by the TradingView bridge). First install can take 3–5 minutes on slow internet — don't kill it.

---

## Step 1 — Clone the Repository

```bash
git clone https://github.com/karthickjasbird/jarvis-trading-new.git
cd jarvis-trading-new
```

If you're using nvm:
```bash
nvm install   # installs Node version from .nvmrc
nvm use
```

---

## Step 2 — Install Dependencies

```bash
npm install
```

This installs ~30 packages and downloads the Chromium for puppeteer-core. Grab a coffee. Expected output ends with `added N packages`.

---

## Step 3 — Firebase Project Setup

Jarvis uses Firebase Firestore (database) and Firebase Auth (Google sign-in). **You need your own Firebase project** — do not use someone else's.

### 3a. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it anything (e.g., `jarvis-trading-yourname`)
3. Disable Google Analytics (not needed)
4. Click **Create project** → wait for provisioning → **Continue**

### 3b. Enable Firestore

1. Left sidebar → **Build** → **Firestore Database**
2. Click **Create database**
3. **Important:** select **Start in production mode** (not test mode — test mode expires in 30 days and breaks everything silently)
4. Pick your nearest region → **Enable**
5. Wait for provisioning (~1 minute)

### 3c. Enable Authentication

1. Left sidebar → **Build** → **Authentication**
2. Click **Get started**
3. Select **Google** provider → toggle **Enable**
4. Pick a support email (yours) → **Save**
5. Go to **Settings** tab → **Authorized domains** → confirm `localhost` is in the list (it's added by default)

### 3d. Download the service account key

1. Click the ⚙️ gear icon (top-left, next to "Project Overview") → **Project settings**
2. Open the **Service accounts** tab
3. Click **Generate new private key** → confirm → a JSON file downloads
4. Rename the downloaded file to **`serviceAccountKey.json`**
5. Move it into the project root (same folder as `package.json`)

You can compare your file to `serviceAccountKey.example.json` to confirm it has the right shape (fields: `type`, `project_id`, `private_key`, `client_email`, etc.).

### 3e. Copy the Firebase web config

1. In **Project settings** → **General** tab
2. Scroll to **Your apps** → click the **Web** icon `</>` → register app (call it `jarvis-web`)
3. Firebase shows a `firebaseConfig` object — keep this tab open
4. In your local repo:
   ```bash
   cp firebase-applet-config.example.json firebase-applet-config.json
   ```
5. Open `firebase-applet-config.json` and replace each value with the matching one from the Firebase tab:
   - `projectId`, `apiKey`, `authDomain`, `storageBucket`, `messagingSenderId`, `appId`
   - Leave `firestoreDatabaseId` as `"(default)"`
   - `measurementId` is optional (Google Analytics — fine to leave as-is)

> The file `firebase-applet-config.json` is gitignored — your credentials stay local.

### 3f. Deploy security rules + composite indexes

This is a step the old install guide didn't have. Without it, Firestore queries silently return empty or fail.

```bash
firebase login                                # opens browser, sign in with the same Google account
firebase use --add                            # pick your new project from the list
firebase deploy --only firestore              # deploys both firestore.rules AND firestore.indexes.json
```

Expected output ends with `Deploy complete!`. Index builds run async (~2 minutes); they'll be ready before you finish Step 4.

> **What did this do?** It locked down your database with the rules in `firestore.rules` (each user can only read/write their own data) and created 5 composite indexes for collections that Jarvis queries by `userId + createdAt` (tradingGoals, campaigns, brainActivity, trades, sentryConfigs). Without these, the Goals and Campaigns tabs in JarvisBrain would appear blank forever.

---

## Step 4 — Sign Up for API Keys

Get the required key (Gemini) and any optionals you want.

### Gemini AI Studio (Required)

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with the same Google account
3. Click **Create API key** → copy it (starts with `AIzaSy...`)

Free tier is generous (10 RPM). You're done.

### Groq Cloud (Optional, fallback AI)

1. [console.groq.com](https://console.groq.com) → sign up free
2. **API Keys** → **Create API Key** → copy

Used as a fast fallback when Gemini rate-limits.

### Binance API (Optional, live crypto trading)

> Skip this for first run — paper trading works without it.

1. [Binance API Management](https://www.binance.com/en/my/settings/api-management) → **Create API**
2. Permissions: **Enable Reading** + **Enable Spot & Margin Trading**. Leave **Withdrawals** OFF.
3. IP whitelist your home IP for safety
4. Copy the API key and secret

### Alpaca (Optional, US stocks / commodity ETFs)

> Skip this for first run unless you want US equity scans.

1. [alpaca.markets](https://alpaca.markets) → sign up free
2. Dashboard → **Paper Trading** → **View / Generate API Keys**
3. Copy the **Key ID** and **Secret Key**

Paper keys work immediately. Live keys require a brokerage application (1–3 business days).

### Telegram Bot (Optional, notifications)

1. Open Telegram → message [@BotFather](https://t.me/BotFather) → `/newbot` → follow prompts → copy bot token
2. Message [@userinfobot](https://t.me/userinfobot) → copy your numeric **Chat ID** (you'll set this in-app later under Settings → Alerts)

---

## Step 5 — Configure `.env`

```bash
cp .env.example .env
```

Open `.env` and fill in:

```env
OWNER_USER_ID=""                      # leave blank for now — fill after first login
GEMINI_API_KEY="AIzaSy...your-key"    # required
APP_URL="http://localhost:3000"       # leave as-is

# All optional — leave blank if not using
BINANCE_API_KEY=""
BINANCE_SECRET_KEY=""
ALPACA_API_KEY_ID=""
ALPACA_SECRET_KEY=""
TELEGRAM_BOT_TOKEN=""
GROQ_API_KEY=""
CHROME_DEBUG_URL=""                   # only if using TradingView automation
```

`OWNER_USER_ID` gets filled in Step 7 after you sign in.

---

## Step 6 — Start the Server

```bash
npm run dev
```

A successful boot looks like this in your terminal (and in `startup.log`):

```
[STARTUP] tsx server.ts...
[STARTUP] Successfully loaded serviceAccountKey.json
[STARTUP] Vite middleware initialized
[STARTUP] Sentry Engine started
[STARTUP] Market Scanner initialized
[STARTUP] Approval expiry sweeper armed (30s)
Server running on http://localhost:3000
```

Open **[http://localhost:3000](http://localhost:3000)** in Chrome.

> **Troubleshooting boot failures**: see the table at the bottom of this doc. Most common: missing `serviceAccountKey.json`, port 3000 in use, or `firebase-applet-config.json` not filled in.

---

## Step 7 — First Login + Onboarding

1. The login screen shows **"Authenticate with Google"** — click it
2. Sign in with the same Google account
3. The dashboard loads. A floating **Onboarding** card appears bottom-right with a 5-item checklist:
   - ✅ Gemini API Key (already done — green)
   - ⚠️ Owner User ID (needs you to set — red)
   - Binance Keys (optional, gray)
   - Telegram Bot Token (optional, gray)
   - Groq API Key (optional, gray)

4. Click the ⚙️ Settings icon (top-right) → your **User ID** is shown at the top of the modal → click **Copy**
5. Paste it into `.env` as `OWNER_USER_ID="..."`
6. In your terminal: `Ctrl+C` → `npm run dev` → wait for "Server running" → refresh browser
7. The onboarding card should now show all required items as green

---

## Step 8 — Configure Brokers In-App

Per-broker credentials live in Firestore (encrypted at rest), not in `.env`. The exception is the Alpaca keys above which can fall back to `.env`.

1. Settings icon → **Brokers** tab
2. Click **Add Broker** → choose:
   - **Paper Trading** — add this first; it's the safe sandbox
   - **Binance** — paste API key + secret if you set them up
   - **Alpaca** — paste Key ID + Secret if you set them up
   - **Zerodha** (Indian equities) — requires daily OAuth re-auth
3. Save. The keys go to `users/{yourUid}/secrets/apiKeys` in Firestore.

---

## Step 9 — Verify Everything Works

Quick smoke test:

1. **MarketWatchlist** widget loads with ranked crypto pairs (BTC, ETH, etc.) — scores update every ~30 seconds
2. **Switch to Stocks tab** — shows US tickers (works in paper mode even without Alpaca keys)
3. **JarvisBrain** sidebar → **Goals** and **Campaigns** tabs show "No active goals / campaigns" (NOT a perpetual spinner — spinner means indexes didn't deploy)
4. **No red banners** at the top of the dashboard
5. **Sentry** widget says "Sentry is watching, no events yet"

Everything green? You're done. Try a voice command like *"Hey Jarvis, scan the market"* via the orb to confirm AI is wired up.

---

## Troubleshooting

| Problem | Cause + Fix |
|---|---|
| `Error: Cannot find module 'serviceAccountKey.json'` | Step 3d skipped — download from Firebase Console → Service Accounts → Generate new private key |
| `firebase-applet-config.json: no such file` | Step 3e skipped — `cp firebase-applet-config.example.json firebase-applet-config.json` then fill in values |
| Login screen flashes then errors with `auth/unauthorized-domain` | In Firebase Console → Auth → Settings → Authorized domains, add `localhost` |
| Dashboard loads but Goals/Campaigns spinner never stops | Composite indexes not built — `firebase deploy --only firestore:indexes` and wait 2 minutes |
| All Firestore reads/writes fail with `PERMISSION_DENIED` | Rules not deployed OR you picked "test mode" and the 30-day window expired — `firebase deploy --only firestore:rules` |
| `GEMINI_API_KEY not set` warning at boot | Step 5 — add it to `.env` and restart server |
| `Port 3000 already in use` | `lsof -ti:3000 \| xargs kill -9` then `npm run dev` |
| Scanner returns no data | Binance is geo-blocked in some regions. Try a VPN, or just use paper trading + stocks tab |
| Voice not working | Mic permission for Chrome at localhost — chrome://settings/content/microphone |
| `npm install` hangs forever | Puppeteer Chromium download. Wait 5 min, or `PUPPETEER_SKIP_DOWNLOAD=1 npm install` (TradingView bridge will be unavailable) |
| Telegram alerts not arriving | Both bot token (in `.env`) AND your Chat ID (in Settings → Alerts) must be set |
| App says "v1.2.0 update available" | False positive from old caches — refresh the page or clear localStorage |
| Onboarding card never disappears | One of the required items is still missing — expand the card to see which |

---

## Updating to the Latest Version

```bash
git pull origin main
npm install          # picks up any new dependencies
firebase deploy --only firestore   # only needed if rules/indexes changed
npm run dev          # restart server
```

---

## Security Notes

These files are gitignored — **never commit them**:

- `.env` — your API keys
- `serviceAccountKey.json` — Firebase admin credentials (server-side full access)
- `firebase-applet-config.json` — your Firebase project identifiers

The `.example.json` versions of those last two ARE committed — they're empty templates with no secrets.

Firebase web API keys are public by design (they're sent to every visitor of your app), but treat your `projectId` as semi-private — sharing it lets others target their Firebase Auth at your project.

---

## File Reference

```
jarvis-trading-new/
├── INSTALL.md                          # this file
├── ANTIGRAVITY_SETUP.md                # AI-assisted setup prompt
├── README.md                           # project overview
├── server.ts                           # main Express server
├── package.json
├── .nvmrc                              # Node v20
├── .env.example                        # env template
├── firebase.json                       # Firebase CLI config (rules + indexes pointer)
├── firestore.rules                     # Firestore security rules (deploy via CLI)
├── firestore.indexes.json              # 5 composite indexes (deploy via CLI)
├── serviceAccountKey.example.json      # template
├── firebase-applet-config.example.json # template
│
│   ─── you create these locally (gitignored) ───
├── .env
├── serviceAccountKey.json
├── firebase-applet-config.json
│
├── engine/                             # 29 backend engines
│   ├── agentSwarm.ts                   # multi-agent decision pipeline
│   ├── tradeExecutor.ts                # places paper + live trades
│   ├── sentry.ts                       # real-time SL/TP monitor
│   ├── marketScanner.ts                # 48 crypto + 33 stocks + 6 commodity ETFs
│   ├── alpacaConnector.ts              # US equities connector
│   ├── kellyCalculator.ts              # position sizing
│   ├── goalExecutor.ts                 # autonomous campaign manager
│   ├── tradingViewBridge.ts            # puppeteer-core Chrome bridge
│   └── ... (20+ more)
└── src/
    ├── App.tsx
    ├── firebase.ts                     # imports firebase-applet-config.json
    ├── components/                     # React UI
    └── hooks/
```

---

## Quick Command Reference

```bash
npm run dev          # start dev server (tsx server.ts, port 3000)
npm run build        # build production frontend
npm run lint         # typecheck (tsc --noEmit)
firebase deploy      # deploy rules + indexes after edits
git pull             # get latest code
```

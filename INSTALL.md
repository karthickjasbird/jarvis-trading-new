# Jarvis Trading Platform — Installation Guide

## Prerequisites

Before you begin, make sure you have:

| Requirement | Version | How to Get |
|------------|---------|-----------|
| **Node.js** | v20+ (recommended v24) | [nodejs.org](https://nodejs.org) or `brew install node` |
| **Git** | Any recent version | [git-scm.com](https://git-scm.com) or `brew install git` |
| **Gemini API Key** | Free | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **Firebase Project** | Free Spark plan works | [console.firebase.google.com](https://console.firebase.google.com) |

**Optional (for extra features):**
- Binance API key — for live trading
- Telegram Bot Token — for notifications
- Groq API key — for fast AI fallback

---

## Step 1: Clone the Repository

```bash
git clone https://github.com/karthickjasbird/jarvis-trading-new.git
cd jarvis-trading-new
```

---

## Step 2: Install Dependencies

```bash
npm install
```

This installs all 30+ packages (React, Express, Gemini AI, TradingView charts, etc.)

---

## Step 3: Firebase Setup

Jarvis uses Firebase Firestore for data storage. You need your own Firebase project.

### 3a. Create a Firebase Project
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **"Add project"** → Name it anything (e.g., "jarvis-trading")
3. Disable Google Analytics (not needed)
4. Click **Create project**

### 3b. Enable Firestore
1. In your Firebase project → Click **"Build" → "Firestore Database"**
2. Click **"Create database"**
3. Select **Start in test mode** (you can add security rules later)
4. Choose your nearest region → Click **Enable**

### 3c. Enable Authentication
1. In Firebase Console → **"Build" → "Authentication"**
2. Click **"Get started"**
3. Enable **Google** sign-in provider
4. Add your email as authorized → Save

### 3d. Get Service Account Key
1. In Firebase Console → Click the **⚙️ gear icon** → **"Project Settings"**
2. Go to **"Service accounts"** tab
3. Click **"Generate new private key"** → Download the JSON file
4. Rename it to `serviceAccountKey.json`
5. Place it in the project root: `jarvis-trading-new/serviceAccountKey.json`

### 3e. Get Firebase Web Config
1. In Project Settings → **"General"** tab → scroll to **"Your apps"**
2. Click the **Web (</>)** icon → Register app (name: "jarvis-web")
3. Copy the `firebaseConfig` object
4. Create file `src/firebaseConfig.ts`:

```typescript
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
```

---

## Step 4: Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` with your keys:

```bash
# REQUIRED
OWNER_USER_ID=""          # You'll get this after first login (Settings page)
GEMINI_API_KEY="your-gemini-api-key-here"

# OPTIONAL — for live trading
BINANCE_API_KEY=""
BINANCE_SECRET_KEY=""

# OPTIONAL — for Telegram notifications
TELEGRAM_BOT_TOKEN=""

# OPTIONAL — for fast AI fallback
GROQ_API_KEY=""
```

> **Note:** Leave `OWNER_USER_ID` empty for now. After you log in for the first time, go to Settings and copy your User ID, then paste it here and restart.

---

## Step 5: Start Jarvis

```bash
npm run dev
```

You should see:
```
[SERVER] Jarvis Trading Server v1.2.0 starting...
[SERVER] Firebase connected ✅
[SERVER] Sentry Engine started ✅
[SERVER] Market Scanner initialized ✅
[SERVER] Listening on http://localhost:3000
```

Open your browser to **http://localhost:3000**

---

## Step 6: First Login

1. Click the profile icon (top-right) → **Sign in with Google**
2. After login, go to **Settings** (gear icon)
3. Copy your **User ID** (a long string like `abc123xyz`)
4. Paste it into your `.env` file as `OWNER_USER_ID`
5. Restart the server (`Ctrl+C` → `npm run dev`)

This ensures Jarvis only monitors YOUR trades, not other users'.

---

## Folder Structure (Key Files)

```
jarvis-trading-new/
├── server.ts                    # Main server (Express + API routes)
├── soul.md                      # Jarvis personality + knowledge
├── version.json                 # Version info
├── .env                         # Your secret keys (NOT in git)
├── serviceAccountKey.json       # Firebase admin key (NOT in git)
├── engine/
│   ├── sentry.ts                # Real-time trade monitor
│   ├── agentSwarm.ts            # 6-agent AI pipeline
│   ├── tradeExecutor.ts         # Paper + Live trade execution
│   ├── marketScanner.ts         # 20-pair scanner with TA scoring
│   ├── technicalAnalysis.ts     # RSI, MACD, EMA, ADX, BBands
│   ├── kellyCalculator.ts       # Kelly Criterion position sizing
│   ├── regimeDetector.ts        # Market regime classification
│   ├── goalExecutor.ts          # Campaign manager
│   ├── memory.ts                # Vector Memory Bank
│   ├── postMortem.ts            # Trade grading + lessons
│   └── ... (20+ more engines)
├── src/
│   ├── App.tsx                  # Main React app
│   ├── firebaseConfig.ts        # Firebase web config (NOT in git)
│   ├── components/              # UI components
│   └── hooks/
│       └── useJarvisLive.ts     # Gemini Live voice connection
└── package.json
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Error: Cannot find module 'serviceAccountKey.json'` | You forgot Step 3d — download the Firebase service account key |
| `Error: Firebase not configured` | You forgot Step 3e — create `src/firebaseConfig.ts` |
| `GEMINI_API_KEY not set` | Edit your `.env` file and add your Gemini API key |
| Blank white screen | Check browser console (F12). Usually a missing import or Firebase config issue |
| `Port 3000 already in use` | Another process is using port 3000. Kill it: `lsof -i :3000` then `kill <PID>` |
| Scanner shows no data | Binance API might be blocked in your region. Try a VPN |
| Voice not working | Requires HTTPS in production. Works on localhost. Also check microphone permissions |

---

## Security Notes

⚠️ **Never commit these files to git:**
- `.env` — contains your API keys
- `serviceAccountKey.json` — Firebase admin credentials
- `src/firebaseConfig.ts` — Firebase web config (contains API keys)

These are all listed in `.gitignore` and will not be tracked.

---

## Updating to Latest Version

```bash
git pull origin main
npm install        # in case new packages were added
npm run dev        # restart the server
```

---

## Quick Reference: Available Commands

```bash
npm run dev        # Start server (development)
npm run build      # Build production frontend
npm run lint       # Check TypeScript for errors
npm start          # Start server (production)
```

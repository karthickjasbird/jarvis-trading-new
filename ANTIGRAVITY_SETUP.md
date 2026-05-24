# AI-Assisted Setup for Jarvis Trading Platform

This file is a single prompt you can paste into any LLM-powered IDE (Antigravity, Cursor, Claude Code, GitHub Copilot Chat, Windsurf) to have the agent walk you through setting up Jarvis on your machine.

## How to use this

1. Clone the repo and open it in your IDE:
   ```bash
   git clone https://github.com/karthickjasbird/jarvis-trading-new.git
   cd jarvis-trading-new
   ```
2. Open your IDE's chat panel.
3. Copy **everything below the `--- PROMPT STARTS BELOW ---` line** in this file and paste it as your first message.
4. The agent will guide you through each step, ask you for credentials when needed, and run commands on your behalf.
5. When the agent says "setup complete, open http://localhost:3000" — you're done.

Expected duration: 25–40 minutes (most of it waiting on you to create accounts in your browser).

---

## --- PROMPT STARTS BELOW ---

You are helping me set up the **Jarvis AI Trading Platform** on a fresh machine. I'm running this in my IDE so you have access to the cloned repository at the current working directory. Your job is to walk me through every step, run commands on my behalf, write files when needed, and verify each phase before moving on.

**Ground rules for you:**
- Do **not** invent credentials — if you need a value (API key, Firebase config field, user ID), ask me for it and wait for my answer
- Do **not** modify existing source code under `engine/`, `src/`, or `server.ts` — only the config files listed below
- After each phase, run a verification command and report the result before moving on
- If a step fails, stop and tell me the exact error rather than guessing or skipping
- All files you'll create/edit are at the repo root: `.env`, `serviceAccountKey.json`, `firebase-applet-config.json`. Templates exist as `.env.example`, `serviceAccountKey.example.json`, `firebase-applet-config.example.json`

---

### Phase 0 — Verify environment

Run these commands and report back to me:

```bash
node --version
npm --version
git --version
pwd
ls -1 package.json INSTALL.md .env.example firebase-applet-config.example.json
```

**Expected:** Node v20 or higher, npm present, git present, you are inside the `jarvis-trading-new` (or similarly-named) repo, all five files exist.

If Node is older than v20, stop and tell me — I need to install/upgrade Node before continuing. If a file is missing, the clone may have failed — tell me which file.

---

### Phase 1 — Install dependencies

Run:
```bash
npm install
```

This downloads ~30 packages including a ~200MB Chromium binary for `puppeteer-core`. Expect 3–5 minutes. If it appears to hang, that's normal — do not kill it.

When done, confirm with:
```bash
ls node_modules/.bin/tsx
```
File should exist.

---

### Phase 2 — Tell me when these manual account-creation steps are done

I need to do these in my browser. Do **not** continue until I confirm each one is done. Tell me to open these tabs in this order, then wait:

1. **Firebase Console** — https://console.firebase.google.com
   - Click **Add project**, name it anything (e.g., `jarvis-trading-<my-name>`)
   - Disable Google Analytics, click **Create project**, wait for provisioning
2. **Enable Firestore** in that project
   - Left sidebar → **Build → Firestore Database → Create database**
   - Pick **"Start in production mode"** (NOT test mode)
   - Pick the nearest region, click **Enable**
3. **Enable Authentication** in that project
   - Left sidebar → **Build → Authentication → Get started**
   - Select **Google** provider → toggle Enable → pick my email → Save
4. **Generate service account key**
   - Click ⚙️ → **Project settings → Service accounts tab → Generate new private key**
   - Save the downloaded JSON file — I'll tell you the contents in Phase 4
5. **Get Firebase web config**
   - In **Project settings → General tab → Your apps → Web (`</>`) → Register app** (call it `jarvis-web`)
   - Copy the `firebaseConfig` object — I'll paste it in Phase 4
6. **Gemini API key** — https://aistudio.google.com/apikey
   - Sign in with same Google account → **Create API key** → copy it

Tell me to do all six steps, then wait for me to say "done" before continuing.

---

### Phase 3 — Configure environment file

When I confirm Phase 2 is done, run:

```bash
cp .env.example .env
```

Then ask me, one at a time:

1. **"Paste your Gemini API key (starts with `AIzaSy...`):"** → use the Edit tool to set `GEMINI_API_KEY="<value>"` in `.env`

2. **"Do you want to set up Binance for live crypto trading now? (yes/skip)"**
   - If yes: ask for `BINANCE_API_KEY` and `BINANCE_SECRET_KEY` separately, set them in `.env`
   - If skip: leave blank

3. **"Do you want to set up Alpaca for US stocks/ETFs now? (yes/skip)"**
   - If yes: ask for `ALPACA_API_KEY_ID` and `ALPACA_SECRET_KEY` separately
   - If skip: leave blank

4. **"Do you want Telegram alerts? (yes/skip)"**
   - If yes: ask for `TELEGRAM_BOT_TOKEN` (from @BotFather on Telegram)
   - If skip: leave blank

5. **"Do you want the Groq fallback model? (yes/skip)"**
   - If yes: ask for `GROQ_API_KEY` from console.groq.com
   - If skip: leave blank

Leave `OWNER_USER_ID` blank — we fill it after first login.
Leave `APP_URL` as `http://localhost:3000`.
Leave `CHROME_DEBUG_URL` blank (advanced feature, TradingView bridge).

Then verify by reading `.env` and confirming `GEMINI_API_KEY` is populated. Don't print the key value to me — just confirm "Gemini key is set, length N".

---

### Phase 4 — Firebase config files

Run:
```bash
cp firebase-applet-config.example.json firebase-applet-config.json
```

Then ask me to paste my Firebase web config object (the one I copied in Phase 2 step 5). It looks like:
```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "...firebaseapp.com",
  projectId: "...",
  storageBucket: "...firebasestorage.app",
  messagingSenderId: "...",
  appId: "1:...:web:..."
};
```

Extract each value and write into `firebase-applet-config.json`. Keep `firestoreDatabaseId` as `"(default)"`. `measurementId` is optional — set it if I provided one, otherwise leave the placeholder.

Then ask me to paste the **entire contents** of the service account key JSON file I downloaded in Phase 2 step 4. Use the Write tool to save it as `serviceAccountKey.json` at the repo root, exactly as pasted. Do not modify the values.

Verify both files exist and are valid JSON:
```bash
node -e "JSON.parse(require('fs').readFileSync('firebase-applet-config.json','utf8')); console.log('firebase-applet-config.json OK')"
node -e "JSON.parse(require('fs').readFileSync('serviceAccountKey.json','utf8')); console.log('serviceAccountKey.json OK')"
```

Both should print "OK".

---

### Phase 5 — Deploy Firestore rules + indexes

Check if Firebase CLI is installed:
```bash
firebase --version
```

If not installed:
```bash
npm install -g firebase-tools
```

Then ask me to run these commands myself in a separate terminal (they require interactive browser login):

```bash
firebase login
firebase use --add
```

Tell me to pick my new project from the list when `firebase use --add` prompts me.

Once I confirm I've done both, you run:
```bash
firebase deploy --only firestore
```

This deploys both `firestore.rules` and `firestore.indexes.json` (5 composite indexes). Expected output ends with **"Deploy complete!"**.

If you see an error about not being logged in, ask me to run `firebase login` first.

---

### Phase 6 — Start the server

Run in the background:
```bash
npm run dev
```

Wait ~10 seconds, then tail the startup log:
```bash
tail -50 startup.log
```

Look for the line **`Server running on http://localhost:3000`**. If you see it, tell me to open http://localhost:3000 in Chrome and report back what I see.

If you see an error in the log, tell me the exact error message and the most likely fix from this list:
- `Cannot find module 'serviceAccountKey.json'` → Phase 4 not done
- `firebase-applet-config.json: no such file` → Phase 4 not done
- `EADDRINUSE :::3000` → something else is on port 3000; suggest `lsof -ti:3000 | xargs kill -9` then retry
- `GEMINI_API_KEY not set` → Phase 3 step 1 wasn't completed; ask me for the key again

---

### Phase 7 — Sign in and grab the owner user ID

I'll go to http://localhost:3000 in Chrome and click "Authenticate with Google". After I sign in, I'll see a dashboard. Tell me:

1. Click the ⚙️ Settings icon (top-right of the dashboard)
2. Copy the **User ID** shown at the top of the settings modal
3. Paste it back to you here

Then use the Edit tool to set `OWNER_USER_ID="<value>"` in `.env`.

Tell me to:
1. Press `Ctrl+C` in the terminal running the dev server
2. Run `npm run dev` again
3. Refresh the browser tab

---

### Phase 8 — Verify everything works

Tell me to perform these visual checks in the dashboard and report back yes/no for each:

- [ ] MarketWatchlist widget shows ranked crypto pairs (BTC, ETH, etc.) with scores
- [ ] Switching to "Stocks" tab shows US tickers
- [ ] JarvisBrain sidebar shows tabs for **Goals** and **Campaigns** — both showing empty state (NOT a perpetual spinner)
- [ ] No red error banners at the top of the dashboard
- [ ] Sentry widget says "Sentry is watching, no events yet"
- [ ] Onboarding card bottom-right shows green checkmarks for Gemini + Owner User ID

If all six pass: **setup complete**. Tell me Jarvis is ready, and that I should start in Practice mode (the default — paper trading, no real money).

If any fail: tell me which, and check the most likely cause:
- Spinner forever on Goals/Campaigns → indexes didn't finish building (wait 2 min and refresh, or re-run `firebase deploy --only firestore:indexes`)
- Red banner → expand it and tell me the exact text
- Watchlist empty → Binance might be geo-blocked; suggest switching to stocks tab and confirming that works

---

### When done

Tell me:
1. To bookmark http://localhost:3000
2. To read [INSTALL.md](INSTALL.md) sections **Step 8 (Configure Brokers In-App)** and **Step 9 (Verify Everything Works)** to add a Paper Trading broker config
3. To start everything in **Practice mode** until I trust the bot enough to switch to Live
4. If I want to come back later: `npm run dev` from the repo root is all I need

That's it. Don't continue past this point — wait for me to ask follow-up questions.

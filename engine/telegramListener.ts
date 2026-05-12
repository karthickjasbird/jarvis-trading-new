/**
 * Telegram Listener — Two-Way Control for Jarvis
 * 
 * Implements Long Polling to listen for incoming Telegram messages
 * without needing a public Webhook URL.
 * 
 * Commands:
 * - /start - Show help menu
 * - /status - Get portfolio snapshot
 * - /intel - Get live market intelligence
 * - /stop - Activate circuit breaker (halt trading)
 */

import { sendTelegramNotification } from './telegram.ts';
import { PortfolioIntelligence } from './portfolioIntel.ts';
import { MarketIntelligenceEngine } from './marketIntel.ts';
import { generateText } from './modelRouter.ts';

const TELEGRAM_API = 'https://api.telegram.org/bot';

export class TelegramListener {
  private db: any;
  private token: string;
  private lastUpdateId = 0;
  private isRunning = false;
  private portfolioIntel: PortfolioIntelligence;
  private intelEngine: MarketIntelligenceEngine;
  private tradeExecutor: any;

  constructor(db: any, tradeExecutor: any) {
    this.db = db;
    this.tradeExecutor = tradeExecutor;
    this.token = process.env.TELEGRAM_BOT_TOKEN || '';
    this.portfolioIntel = new PortfolioIntelligence(db);
    this.intelEngine = new MarketIntelligenceEngine();
  }

  async start() {
    if (!this.token) {
      console.log('[TELEGRAM LISTENER] Bot token not found, listener disabled.');
      return;
    }
    
    this.isRunning = true;
    console.log('[TELEGRAM LISTENER] Started listening for commands...');
    
    // Start long-polling loop
    this.poll();
  }

  stop() {
    this.isRunning = false;
  }

  private async poll() {
    if (!this.isRunning) return;

    try {
      const res = await fetch(`${TELEGRAM_API}${this.token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=30`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.result.length > 0) {
          for (const update of data.result) {
            this.lastUpdateId = update.update_id;
            if (update.message && update.message.text) {
              await this.handleMessage(update.message);
            }
          }
        }
      }
    } catch (err: any) {
      console.error('[TELEGRAM LISTENER] Polling error:', err.message);
    }

    // Loop immediately; long-polling will block server-side for 30s if no updates
    if (this.isRunning) {
      setTimeout(() => this.poll(), 1000);
    }
  }

  private async handleMessage(message: any) {
    const chatId = message.chat.id.toString();
    const text = message.text.trim();

    console.log(`[TELEGRAM LISTENER] Received command from ${chatId}: ${text}`);

    // Verify user (only respond to registered chat IDs)
    const userSnapshot = await this.db.collection('notificationConfigs')
      .where('telegramChatId', '==', chatId)
      .where('enabled', '==', true)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      // Unauthorized user
      await this.sendMessage(chatId, "⛔ Unauthorized. Please link this Chat ID in your Jarvis Dashboard.");
      return;
    }

    const userId = userSnapshot.docs[0].id;

    if (text === '/start' || text === '/help') {
      await this.sendMessage(chatId, `🤖 <b>Jarvis Command Center</b>\n\nAvailable commands:\n/status - View Portfolio & Risk\n/intel - Live Market Intelligence\n/stop - ⛔ Halt Trading (Circuit Breaker)`);
    } 
    else if (text === '/status') {
      await this.handleStatus(chatId);
    } 
    else if (text === '/intel') {
      await this.handleIntel(chatId);
    } 
    else if (text === '/stop') {
      await this.handleStop(chatId, userId);
    } 
    else if (text.toUpperCase() === 'YES' || text.toUpperCase() === 'CLOSE') {
      await this.handleCopilotApproval(chatId, userId, true);
    }
    else if (text.toUpperCase() === 'HOLD') {
      await this.handleCopilotApproval(chatId, userId, false);
    }
    else {
      // It's not a command, pipe it to Gemini so the user can chat with Jarvis
      try {
        await this.sendMessage(chatId, "<i>Thinking...</i>");
        
        const systemPrompt = `You are Jarvis, an elite, hyper-intelligent AI Trading Assistant communicating via Telegram. 
Keep your answers concise, actionable, and formatted for a mobile chat app (use short paragraphs, bold text, and emojis). 
Do NOT use markdown code blocks unless writing code. Just answer the user's question directly.
User's message: "${text}"`;

        const reply = await generateText('gemini-2.5-flash', systemPrompt);
        
        // Remove markdown formatting like ``` or ** that Telegram might choke on if it's too complex
        // Actually Telegram supports basic <b>, <i>, <code>, <pre>. Gemini usually outputs **bold**.
        // Let's convert **bold** to <b>bold</b>.
        let formattedReply = reply.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
        formattedReply = formattedReply.replace(/\*(.*?)\*/g, '<i>$1</i>');
        
        await this.sendMessage(chatId, formattedReply);
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Failed to connect to AI Brain: ${err.message}`);
      }
    }
  }

  private async handleStatus(chatId: string) {
    await this.sendMessage(chatId, "🔄 Fetching portfolio snapshot...");
    try {
      const snap = await this.portfolioIntel.getSnapshot();
      let msg = `📊 <b>Portfolio Snapshot</b>\n\n`;
      msg += `Open Positions: <b>${snap.openPositions.length}</b>\n`;
      msg += `Total Risk Heat: <b>${snap.totalHeat.toFixed(1)}%</b>\n`;
      msg += `Daily P&L: <b>${snap.dailyPnl >= 0 ? '+' : ''}${snap.dailyPnl.toFixed(2)}%</b>\n\n`;
      
      if (snap.circuitBreakerActive) {
        msg += `⛔ <b>CIRCUIT BREAKER IS ACTIVE</b>\nTrading is currently halted.\n\n`;
      }

      if (snap.openPositions.length > 0) {
        msg += `<b>Active Trades:</b>\n`;
        snap.openPositions.forEach(p => {
          msg += `• ${p.symbol} (${p.side.toUpperCase()}) - Risk: ${p.riskPercent}%\n`;
        });
      }
      await this.sendMessage(chatId, msg);
    } catch (err: any) {
      await this.sendMessage(chatId, `❌ Failed to fetch status: ${err.message}`);
    }
  }

  private async handleIntel(chatId: string) {
    await this.sendMessage(chatId, "🧠 Gathering live market intelligence...");
    try {
      const intel = await this.intelEngine.gather();
      let msg = `🧠 <b>Market Intelligence</b>\n\n`;
      msg += `Fear & Greed: <b>${intel.fearGreed.value} (${intel.fearGreed.label})</b>\n`;
      msg += `BTC Dominance: <b>${intel.btcDominance.value.toFixed(2)}%</b> (${intel.btcDominance.trend})\n\n`;
      
      msg += `<b>Funding Rates:</b>\n`;
      intel.fundingRates.forEach(f => {
        msg += `• ${f.symbol}: ${(f.rate * 100).toFixed(4)}% (${f.interpretation})\n`;
      });

      await this.sendMessage(chatId, msg);
    } catch (err: any) {
      await this.sendMessage(chatId, `❌ Failed to fetch intel: ${err.message}`);
    }
  }

  private async handleStop(chatId: string, userId: string) {
    try {
      await this.sendMessage(chatId, "⚠️ <b>CIRCUIT BREAKER INITIATED</b>\n\nHalting all Sentry configurations and disabling autonomous trading modes...");
      
      const batch = this.db.batch();
      
      const sentryDocs = await this.db.collection('sentryConfigs').where('active', '==', true).get();
      sentryDocs.forEach((doc: any) => batch.update(doc.ref, { active: false }));
      
      await batch.commit();
      
      await this.sendMessage(chatId, "✅ <b>Trading Halted Successfully</b>\n\nAll automated systems are now offline. No new trades will be placed until manually restarted via the dashboard.");
    } catch (e: any) {
      await this.sendMessage(chatId, `❌ Failed to halt trading: ${e.message}`);
    }
  }

  private async handleCopilotApproval(chatId: string, userId: string, closePosition: boolean) {
    try {
      // Find the pending approval trade
      const pendingTrades = await this.db.collection('trades')
        .where('userId', '==', userId)
        .where('status', '==', 'open')
        .where('awaitingApproval', '==', true)
        .get();

      if (pendingTrades.empty) {
        await this.sendMessage(chatId, "I couldn't find any pending Copilot trades awaiting approval.");
        return;
      }

      const tradeDoc = pendingTrades.docs[0];
      const tradeId = tradeDoc.id;

      if (closePosition) {
        await this.sendMessage(chatId, `Roger that. Closing position...`);
        // Remove the flag so sentry monitor picks it up immediately OR close it here directly.
        // It's cleaner to close it here to give immediate feedback.
        if (this.tradeExecutor) {
          await this.tradeExecutor.closePosition(userId, tradeId);
          await this.sendMessage(chatId, `✅ <b>Position Closed.</b>`);
          
          // Trigger post mortem (Sentry won't catch it if we close it here, so let's just use the server /api/trade/close endpoint internally)
          fetch('http://localhost:5173/api/trade/close', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, tradeId })
          }).catch(() => {});
        } else {
           // Fallback if tradeExecutor not passed correctly, let Sentry handle it on next tick by setting a flag
           await tradeDoc.ref.update({ awaitingApproval: false, forceClose: true });
           await this.sendMessage(chatId, `✅ <b>Closing Position...</b>`);
        }
      } else {
        await this.sendMessage(chatId, `Holding position open. I'll keep monitoring it.`);
        await tradeDoc.ref.update({ awaitingApproval: false, approvalRequestedAt: null });
      }
    } catch (e: any) {
      await this.sendMessage(chatId, `❌ Error processing approval: ${e.message}`);
    }
  }

  private async sendMessage(chatId: string, text: string) {
    try {
      await fetch(`${TELEGRAM_API}${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
    } catch (err) {
      console.error('[TELEGRAM LISTENER] Failed to send reply:', err);
    }
  }
}

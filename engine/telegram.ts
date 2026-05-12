/**
 * Telegram Alert System — Real-Time Trading Notifications
 * 
 * Sends structured alerts to users via Telegram:
 * - 📡 Scanner signals (high-score opportunities)
 * - 🎯 Trade placed (entry details)
 * - ✅ Trade closed (with P&L)
 * - ⛔ Strategy disabled (feedback loop)
 * - 📊 Daily summary (end-of-day report)
 * - 🚀 Autonomous triggers
 * 
 * Setup: Users set their Telegram Chat ID in Settings.
 * Bot token is stored in .env as TELEGRAM_BOT_TOKEN.
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

/**
 * Core send function — delivers a message to a specific chat
 */
async function sendToChat(botToken: string, chatId: string, message: string): Promise<boolean> {
  try {
    const res = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[TELEGRAM] API error ${res.status}:`, err);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[TELEGRAM] Send failed:', err.message);
    return false;
  }
}

/**
 * Send a notification to a specific user (checks per-user secrets first, then legacy config)
 */
export async function sendTelegramNotification(db: any, userId: string, message: string): Promise<boolean> {
  try {
    // 1. Try per-user secrets (new system)
    const secretsDoc = await db.collection('users').doc(userId).collection('secrets').doc('apiKeys').get();
    if (secretsDoc.exists) {
      const secrets = secretsDoc.data();
      if (secrets?.telegramBotToken && secrets?.telegramChatId) {
        return await sendToChat(secrets.telegramBotToken, secrets.telegramChatId, message);
      }
    }

    // 2. Fallback to legacy notificationConfigs
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return false;

    const doc = await db.collection('notificationConfigs').doc(userId).get();
    if (!doc.exists) return false;

    const config = doc.data();
    if (!config?.enabled || !config?.telegramChatId) return false;

    return await sendToChat(token, config.telegramChatId, message);
  } catch {
    return false;
  }
}

/**
 * Broadcast to ALL users who have Telegram enabled
 */
export async function broadcastTelegram(db: any, message: string): Promise<number> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return 0;

  try {
    const snapshot = await db.collection('notificationConfigs').where('enabled', '==', true).get();
    let sent = 0;

    for (const doc of snapshot.docs) {
      const config = doc.data();
      if (config?.telegramChatId) {
        const ok = await sendToChat(token, config.telegramChatId, message);
        if (ok) sent++;
      }
    }

    return sent;
  } catch {
    return 0;
  }
}

// ─── Pre-formatted Alert Templates ──────────────────────────

export function formatSignalAlert(symbol: string, score: number, confluence: string, signal: string): string {
  return `📡 <b>Signal Detected</b>

Asset: <b>${symbol}</b>
Score: <b>${score}/100</b>
TA Confluence: <b>${confluence.toUpperCase()}</b>
Signal: ${signal}

<i>Jarvis Autonomous Trading</i>`;
}

export function formatTradeAlert(
  action: 'opened' | 'closed',
  symbol: string,
  side: string,
  entryPrice: number,
  quantity: number,
  pnl?: number,
  reason?: string
): string {
  if (action === 'opened') {
    return `🎯 <b>Trade Opened</b>

Asset: <b>${symbol}</b>
Side: <b>${side.toUpperCase()}</b>
Entry: <b>$${entryPrice.toLocaleString()}</b>
Size: ${quantity}

<i>Jarvis Autonomous Trading</i>`;
  }

  const emoji = (pnl || 0) >= 0 ? '✅' : '❌';
  const pnlStr = pnl !== undefined ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : 'N/A';

  return `${emoji} <b>Trade Closed</b>

Asset: <b>${symbol}</b>
Side: <b>${side.toUpperCase()}</b>
Entry: $${entryPrice.toLocaleString()}
P&L: <b>${pnlStr}</b>
Reason: ${reason || 'manual'}

<i>Jarvis Autonomous Trading</i>`;
}

export function formatStrategyAlert(strategyName: string, reason: string): string {
  return `⛔ <b>Strategy Disabled</b>

Strategy: <b>${strategyName}</b>
Reason: ${reason}

The Sentinel has automatically disabled this strategy to protect your capital.

<i>Jarvis Autonomous Trading</i>`;
}

export function formatCopilotApproval(symbol: string, pnl: number, reason: string): string {
  return `🎯 <b>Copilot: Target Hit!</b>

Asset: <b>${symbol}</b>
P&L: <b>+$${pnl.toFixed(2)}</b>
Reason: ${reason}

Reply <b>YES</b> to close now
Reply <b>HOLD</b> to keep position open

⏰ Auto-closes in 10 minutes if no response.`;
}

export function formatAutoTrigger(pairs: Array<{ symbol: string; score: number }>): string {
  const pairList = pairs.map(p => `• ${p.symbol} (${p.score}/100)`).join('\n');
  return `🚀 <b>Autonomous Scan Triggered</b>

${pairList}

The Agent Swarm is now analyzing these opportunities...

<i>Jarvis Autonomous Trading</i>`;
}

export function formatDailySummary(stats: {
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  bestTrade?: string;
  worstTrade?: string;
  winRate: number;
}): string {
  const emoji = stats.totalPnl >= 0 ? '📈' : '📉';
  return `${emoji} <b>Daily Summary</b>

Trades: <b>${stats.totalTrades}</b> (${stats.wins}W / ${stats.losses}L)
Win Rate: <b>${stats.winRate.toFixed(1)}%</b>
Total P&L: <b>${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl.toFixed(2)}</b>
${stats.bestTrade ? `Best: ${stats.bestTrade}` : ''}
${stats.worstTrade ? `Worst: ${stats.worstTrade}` : ''}

<i>Jarvis Autonomous Trading — End of Day</i>`;
}

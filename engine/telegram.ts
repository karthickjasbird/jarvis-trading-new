import admin from 'firebase-admin';

export async function sendTelegramNotification(db: FirebaseFirestore.Firestore, userId: string, message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("Telegram notification skipped: TELEGRAM_BOT_TOKEN not configured.");
    return;
  }

  try {
    const doc = await db.collection('notificationConfigs').doc(userId).get();
    if (!doc.exists) return;
    
    const config = doc.data();
    if (!config?.enabled || !config?.telegramChatId) return;

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text: message,
        parse_mode: 'HTML'
      })
    });

    if (!response.ok) {
      console.error(`Telegram API error: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error("Failed to send Telegram notification:", error);
  }
}

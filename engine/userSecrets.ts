/**
 * User Secrets Manager
 * 
 * Fetches and caches per-user API keys from Firestore.
 * Falls back to .env defaults when user hasn't provided their own keys.
 * Cache has a 5-minute TTL to avoid excessive Firestore reads.
 */

export interface UserSecrets {
  geminiApiKey?: string;
  binanceApiKey?: string;
  binanceSecretKey?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  alpacaApiKeyId?: string;
  alpacaSecretKey?: string;
}

interface CacheEntry {
  secrets: UserSecrets;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class UserSecretsManager {
  private db: any;
  private cache: Map<string, CacheEntry> = new Map();

  constructor(db: any) {
    this.db = db;
  }

  /**
   * Get all secrets for a user (cached, with .env fallback)
   */
  async getSecrets(userId: string): Promise<UserSecrets> {
    // Check cache first
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.secrets;
    }

    // Fetch from Firestore
    let userSecrets: UserSecrets = {};
    try {
      const doc = await this.db.collection('users').doc(userId).collection('secrets').doc('apiKeys').get();
      if (doc.exists) {
        userSecrets = doc.data() as UserSecrets;
      }
    } catch (err: any) {
      console.warn(`[USER SECRETS] Failed to fetch secrets for ${userId}:`, err.message);
    }

    // Cache the result
    this.cache.set(userId, { secrets: userSecrets, fetchedAt: Date.now() });
    return userSecrets;
  }

  /**
   * Get Gemini API key — user's own key, or fallback to .env
   */
  async getGeminiKey(userId?: string): Promise<string> {
    if (userId) {
      const secrets = await this.getSecrets(userId);
      if (secrets.geminiApiKey) return secrets.geminiApiKey;
    }
    return process.env.GEMINI_API_KEY || '';
  }

  /**
   * Get Binance credentials — user's own, or fallback to .env
   */
  async getBinanceCredentials(userId?: string): Promise<{ apiKey: string; secret: string }> {
    if (userId) {
      const secrets = await this.getSecrets(userId);
      if (secrets.binanceApiKey && secrets.binanceSecretKey) {
        return { apiKey: secrets.binanceApiKey, secret: secrets.binanceSecretKey };
      }
    }
    return {
      apiKey: process.env.BINANCE_API_KEY || '',
      secret: process.env.BINANCE_SECRET_KEY || '',
    };
  }

  /**
   * Get Alpaca credentials — user's own key/secret, or fallback to .env.
   * Paper-vs-live is decided by the trade's `isPractice` flag at execution
   * time, not by the credential pair (a single Alpaca account works for both).
   */
  async getAlpacaCredentials(userId?: string): Promise<{ apiKeyId: string; secretKey: string }> {
    if (userId) {
      const secrets = await this.getSecrets(userId);
      if (secrets.alpacaApiKeyId && secrets.alpacaSecretKey) {
        return { apiKeyId: secrets.alpacaApiKeyId, secretKey: secrets.alpacaSecretKey };
      }
    }
    return {
      apiKeyId: process.env.ALPACA_API_KEY_ID || '',
      secretKey: process.env.ALPACA_SECRET_KEY || '',
    };
  }

  /**
   * Get Telegram config — user's own bot token + chat ID, or fallback to .env + Firestore notificationConfigs
   */
  async getTelegramConfig(userId?: string): Promise<{ botToken: string; chatId: string }> {
    if (userId) {
      const secrets = await this.getSecrets(userId);
      if (secrets.telegramBotToken && secrets.telegramChatId) {
        return { botToken: secrets.telegramBotToken, chatId: secrets.telegramChatId };
      }
      // Fallback: try legacy notificationConfigs collection for chatId
      try {
        const notifDoc = await this.db.collection('notificationConfigs').doc(userId).get();
        if (notifDoc.exists) {
          const data = notifDoc.data();
          if (data?.telegramChatId) {
            return {
              botToken: secrets.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '',
              chatId: data.telegramChatId,
            };
          }
        }
      } catch {}
    }
    return {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: '',
    };
  }

  /**
   * Save secrets for a user
   */
  async saveSecrets(userId: string, secrets: Partial<UserSecrets>): Promise<void> {
    try {
      const ref = this.db.collection('users').doc(userId).collection('secrets').doc('apiKeys');
      const existing = await ref.get();
      if (existing.exists) {
        // Merge — only update fields that are provided
        const filtered: Record<string, any> = {};
        for (const [key, value] of Object.entries(secrets)) {
          if (value !== undefined && value !== '') {
            filtered[key] = value;
          }
        }
        await ref.update({ ...filtered, updatedAt: new Date().toISOString() });
      } else {
        await ref.set({ ...secrets, updatedAt: new Date().toISOString() });
      }
      // Invalidate cache
      this.cache.delete(userId);
      console.log(`[USER SECRETS] Saved secrets for user ${userId}`);
    } catch (err: any) {
      console.error(`[USER SECRETS] Failed to save secrets for ${userId}:`, err.message);
      throw err;
    }
  }

  /**
   * Clear cache for a user (call after they update keys)
   */
  invalidateCache(userId: string): void {
    this.cache.delete(userId);
  }
}

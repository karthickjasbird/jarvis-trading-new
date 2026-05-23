/**
 * Trade Diary Engine — Structured Decision Audit Trail
 * 
 * Logs every major decision point during Agent Swarm runs:
 * - Regime gate blocks
 * - Scout "no opportunity" results
 * - Sentinel vetoes (risk or AI-driven)
 * - Executed trades
 * 
 * Also supports querying past failures to feed Sentinel's
 * "Lessons Learned Injection" — active veto based on historical mistakes.
 */

export interface TradeDiaryEntry {
  id?: string;
  timestamp: string;
  userId: string;
  symbol: string;
  side: 'buy' | 'sell' | 'none';
  decision: 'executed' | 'pending_approval' | 'vetoed_sentinel_risk' | 'vetoed_sentinel_ai' | 'vetoed_regime_gate' | 'vetoed_backtest' | 'no_opportunity' | 'pipeline_error';
  reasoning: string;

  // Indicator snapshot at decision time
  indicators: {
    price: number;
    rsi: number | null;
    macdHistogram: number | null;
    ema9: number | null;
    ema21: number | null;
    vwap: number | null;
    obvSlope: 'up' | 'down' | 'flat' | null;
    adx: number | null;
    atr: number | null;
  };

  // Market regime at decision time
  regime: 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'unknown';

  // Portfolio risk state
  riskCheck: {
    portfolioHeat: number;
    openPositions: number;
    dailyPnl: number;
  };

  confidence: number;
  kellySize?: string;

  // Linked trade (populated when executed, updated by PostMortem)
  tradeId?: string;
  outcome?: 'win' | 'loss' | 'pending';
  pnl?: number;
  pnlPercent?: number;
  grade?: 'A' | 'B' | 'C' | 'D' | 'F';
  lessons?: string[];
}

export class TradeDiaryEngine {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  /**
   * Log a structured decision-point entry to the user's trade diary
   */
  async logDecision(userId: string, entry: Omit<TradeDiaryEntry, 'id'>): Promise<string> {
    try {
      const docRef = await this.db
        .collection('users')
        .doc(userId)
        .collection('tradeDiary')
        .add(entry);

      console.log(`[DIARY] 📝 Logged ${entry.decision} for ${entry.symbol} (${docRef.id})`);
      return docRef.id;
    } catch (err: any) {
      console.error('[DIARY] Failed to log decision:', err.message);
      return '';
    }
  }

  /**
   * Fetch recent failed decisions for a specific symbol.
   * Used by Sentinel for "Lessons Learned Injection" — 
   * checking if current conditions match past losing patterns.
   */
  async getRecentLosses(userId: string, symbol: string, limit: number = 5): Promise<TradeDiaryEntry[]> {
    try {
      // Query all diary entries for this user, then filter in memory
      // to avoid requiring complex composite Firestore indexes
      const snapshot = await this.db
        .collection('users')
        .doc(userId)
        .collection('tradeDiary')
        .orderBy('timestamp', 'desc')
        .limit(100) // Fetch a reasonable chunk
        .get();

      const entries: TradeDiaryEntry[] = snapshot.docs
        .map((d: any) => ({ id: d.id, ...d.data() } as TradeDiaryEntry));

      // In-memory filter: losses or D/F grades for this symbol
      const failures = entries.filter(e =>
        e.symbol === symbol &&
        (e.outcome === 'loss' || e.grade === 'D' || e.grade === 'F')
      );

      return failures.slice(0, limit);
    } catch (err: any) {
      console.error('[DIARY] Failed to fetch recent losses:', err.message);
      return [];
    }
  }

  /**
   * Link an executed trade ID to a diary entry
   */
  async updateEntryWithTrade(userId: string, diaryEntryId: string, tradeId: string): Promise<void> {
    try {
      await this.db
        .collection('users')
        .doc(userId)
        .collection('tradeDiary')
        .doc(diaryEntryId)
        .update({
          tradeId,
          outcome: 'pending',
        });

      console.log(`[DIARY] 🔗 Linked trade ${tradeId} to diary entry ${diaryEntryId}`);
    } catch (err: any) {
      console.error('[DIARY] Failed to update entry with trade:', err.message);
    }
  }

  /**
   * Update a diary entry with post-mortem results (outcome, grade, lessons, P&L)
   */
  async updateWithPostMortem(
    userId: string,
    tradeId: string,
    outcome: 'win' | 'loss',
    pnl: number,
    pnlPercent: number,
    grade: 'A' | 'B' | 'C' | 'D' | 'F',
    lessons: string[]
  ): Promise<void> {
    try {
      // Find the diary entry that matches this tradeId
      const snapshot = await this.db
        .collection('users')
        .doc(userId)
        .collection('tradeDiary')
        .limit(50)
        .get();

      const matchingDoc = snapshot.docs.find((d: any) => d.data().tradeId === tradeId);

      if (matchingDoc) {
        await matchingDoc.ref.update({
          outcome,
          pnl,
          pnlPercent,
          grade,
          lessons,
        });
        console.log(`[DIARY] 📊 Updated diary entry ${matchingDoc.id} with post-mortem: ${grade} (${outcome})`);
      } else {
        console.warn(`[DIARY] No diary entry found for tradeId ${tradeId}`);
      }
    } catch (err: any) {
      console.error('[DIARY] Failed to update with post-mortem:', err.message);
    }
  }

  /**
   * Get all diary entries for a user, optionally filtered by symbol
   */
  async getEntries(userId: string, limit: number = 20, symbol?: string): Promise<TradeDiaryEntry[]> {
    try {
      const snapshot = await this.db
        .collection('users')
        .doc(userId)
        .collection('tradeDiary')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      let entries: TradeDiaryEntry[] = snapshot.docs
        .map((d: any) => ({ id: d.id, ...d.data() } as TradeDiaryEntry));

      // In-memory symbol filter to avoid composite indexes
      if (symbol) {
        entries = entries.filter(e => e.symbol === symbol);
      }

      return entries;
    } catch (err: any) {
      console.error('[DIARY] Failed to get entries:', err.message);
      return [];
    }
  }

  /**
   * Build a structured "PAST FAILURE HISTORY" context block for Sentinel injection.
   * Returns a formatted string for the LLM prompt, or null if no failures found.
   */
  async buildFailureContext(userId: string, symbol: string): Promise<string | null> {
    const failures = await this.getRecentLosses(userId, symbol, 5);
    if (failures.length === 0) return null;

    const lines = failures.map((f, i) => {
      const ind = f.indicators;
      return `  ${i + 1}. [${f.timestamp}] ${f.symbol} ${f.side} — ${f.decision}
     Regime: ${f.regime} | RSI: ${ind.rsi ?? 'N/A'} | VWAP: ${ind.vwap ? (ind.price > ind.vwap ? 'above' : 'below') : 'N/A'} | OBV: ${ind.obvSlope ?? 'N/A'}
     Outcome: ${f.outcome} | P&L: ${f.pnl !== undefined ? `$${f.pnl.toFixed(2)}` : 'N/A'} | Grade: ${f.grade || 'N/A'}
     Lessons: ${f.lessons?.join('; ') || 'None recorded'}`;
    });

    return `⚠️ PAST FAILURE HISTORY for ${symbol} (${failures.length} recent losses/poor grades):
${lines.join('\n')}

INSTRUCTION: If current indicator conditions (regime, RSI, VWAP alignment, OBV) closely match any of these failed setups, you MUST issue a VETO to prevent repeating past mistakes.`;
  }
}

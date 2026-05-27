/**
 * AI Post-Mortem — Learns From Every Trade
 * 
 * After every closed trade, runs a Gemini analysis to understand
 * WHY it won or lost, extracts lessons, and stores them in the
 * Vector Memory Bank so the Scholar can retrieve past mistakes
 * when evaluating similar setups in the future.
 * 
 * This is what makes Jarvis truly adaptive — it never repeats
 * the same mistake twice.
 */

import { generateTextForPurpose } from './modelRouter.ts';
import { TechnicalAnalysisEngine } from './technicalAnalysis.ts';
import { MemoryManager } from './memory.ts';
import { TradeDiaryEngine } from './tradeDiary.ts';

export interface PostMortemReport {
  tradeId: string;
  userId?: string;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  reason: string;
  analysis: string;
  lessons: string[];
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  timestamp: string;
}

export class PostMortemEngine {
  private db: any;
  private taEngine: TechnicalAnalysisEngine;
  private memoryManager: MemoryManager | null;
  private tradeDiary: TradeDiaryEngine | null;

  constructor(db: any, memoryManager?: MemoryManager, tradeDiary?: TradeDiaryEngine) {
    this.db = db;
    this.taEngine = new TechnicalAnalysisEngine();
    this.memoryManager = memoryManager || null;
    this.tradeDiary = tradeDiary || null;
  }

  /**
   * Run post-mortem analysis on a closed trade
   */
  async analyze(trade: {
    tradeId: string;
    symbol: string;
    side: string;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    pnlPercent: number;
    closeReason: string;
    strategy?: string;
    userId?: string;
  }): Promise<PostMortemReport> {
    console.log(`[POST-MORTEM] 🔬 Analyzing ${trade.symbol} trade (${trade.pnl >= 0 ? 'WIN' : 'LOSS'})...`);

    // Fetch current TA to see what the indicators look like now
    let currentTA = '';
    try {
      const report = await this.taEngine.analyzeSymbol(trade.symbol);
      const h1 = report.analyses.find(a => a.timeframe === '1H');
      if (h1) {
        const ind = h1.indicators;
        currentTA = `Current state: RSI=${ind.rsi?.toFixed(1) || 'N/A'}, `;
        currentTA += `MACD hist=${ind.macd?.histogram.toFixed(4) || 'N/A'}, `;
        currentTA += `EMA9=${ind.ema9?.toFixed(2) || 'N/A'} vs EMA21=${ind.ema21?.toFixed(2) || 'N/A'}, `;
        currentTA += `Price=$${ind.price}, Confluence=${h1.signal.bias}`;
      }
    } catch {}

    const prompt = `You are a trading post-mortem analyst. Analyze this completed trade:

Symbol: ${trade.symbol}
Side: ${trade.side.toUpperCase()}
Entry: $${trade.entryPrice}
Exit: $${trade.exitPrice}
P&L: ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)} (${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%)
Close Reason: ${trade.closeReason}
${currentTA}

Respond in this EXACT JSON format (no markdown):
{
  "analysis": "2-3 sentence analysis of what happened and why",
  "lessons": ["lesson 1", "lesson 2"],
  "grade": "A"
}

Grading:
- A: Excellent execution, proper entry/exit
- B: Good trade, minor issues
- C: Average, some mistakes
- D: Poor execution, should have been avoided
- F: Terrible, clear signal was ignored

Be specific. Reference the actual numbers.`;

    try {
      const response = await generateTextForPurpose('post-mortem', prompt);
      const cleaned = response.replace(/```json?|```/g, '').trim();
      const result = JSON.parse(cleaned);

      const report: PostMortemReport = {
        tradeId: trade.tradeId,
        userId: trade.userId,
        symbol: trade.symbol,
        side: trade.side,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        pnl: trade.pnl,
        pnlPercent: trade.pnlPercent,
        reason: trade.closeReason,
        analysis: result.analysis,
        lessons: result.lessons || [],
        grade: result.grade || 'C',
        timestamp: new Date().toISOString(),
      };

      // Save to Firestore
      await this.saveReport(report);

      // Store lessons in Vector Memory Bank for future retrieval
      await this.storeInMemory(report, trade.userId);

      // TRADE DIARY: Update the diary entry with outcome, grade, and lessons
      if (this.tradeDiary && trade.userId) {
        try {
          const outcome = trade.pnl >= 0 ? 'win' as const : 'loss' as const;
          await this.tradeDiary.updateWithPostMortem(
            trade.userId,
            trade.tradeId,
            outcome,
            trade.pnl,
            trade.pnlPercent,
            report.grade,
            report.lessons
          );
        } catch (diaryErr: any) {
          console.error('[POST-MORTEM] Diary update failed:', diaryErr.message);
        }
      }

      // Log to brain activity
      await this.logActivity(report);

      console.log(`[POST-MORTEM] ✅ Grade: ${report.grade} | ${report.lessons.length} lessons extracted`);

      return report;
    } catch (err: any) {
      console.error('[POST-MORTEM] Analysis failed:', err.message);

      // Fallback report
      const fallback: PostMortemReport = {
        tradeId: trade.tradeId,
        userId: trade.userId,
        symbol: trade.symbol,
        side: trade.side,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        pnl: trade.pnl,
        pnlPercent: trade.pnlPercent,
        reason: trade.closeReason,
        analysis: `Trade ${trade.pnl >= 0 ? 'won' : 'lost'} ${Math.abs(trade.pnlPercent).toFixed(2)}%. Closed via ${trade.closeReason}.`,
        lessons: [trade.pnl >= 0 ? 'Profitable execution' : 'Review entry criteria for this setup'],
        grade: trade.pnl >= 0 ? 'B' : 'D',
        timestamp: new Date().toISOString(),
      };

      await this.saveReport(fallback);
      return fallback;
    }
  }

  /**
   * Get recent post-mortems for review
   */
  async getRecent(limit = 10): Promise<PostMortemReport[]> {
    try {
      const snapshot = await this.db.collection('postMortems')
        .limit(limit)
        .get();

      const reports = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() })) as PostMortemReport[];
      // Sort in memory
      reports.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return reports;
    } catch {
      return [];
    }
  }

  /**
   * Get performance summary from post-mortems
   */
  async getGradeSummary(): Promise<Record<string, number>> {
    try {
      const reports = await this.getRecent(50);
      const grades: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
      for (const r of reports) {
        grades[r.grade] = (grades[r.grade] || 0) + 1;
      }
      return grades;
    } catch {
      return { A: 0, B: 0, C: 0, D: 0, F: 0 };
    }
  }

  // ─── Private ──────────────────────────────────────────────

  private async saveReport(report: PostMortemReport): Promise<void> {
    try {
      await this.db.collection('postMortems').add(report);
    } catch (err: any) {
      console.error('[POST-MORTEM] Failed to save report:', err.message);
    }
  }

  private async storeInMemory(report: PostMortemReport, userId?: string): Promise<void> {
    // Phase 9 (0a) — Memory writes PAUSED. Grade + display still happen, but
    // outcome-graded lessons no longer feed Scholar's semantic recall. Reason:
    // grading by outcome (not process) was teaching outcome-bias into the
    // closed loop. Full process-based grader (item #8) will replace this.
    // Pre-pause cohort (~207 entries) still needs quarantine/re-grade — Tier C.
    console.log(`[POST-MORTEM] ⏸️  Memory write SKIPPED for ${report.symbol} (grade ${report.grade}). Phase 9 (0a) pause active — see plan.`);
    return;

    // eslint-disable-next-line no-unreachable
    try {
      const memoryText = `[TRADE LESSON] ${report.symbol} ${report.side} — Grade: ${report.grade} — ${report.analysis} Lessons: ${report.lessons.join('. ')}.`;

      // Save to the REAL user memory bank with embeddings (if MemoryManager is available)
      if (this.memoryManager && userId) {
        await this.memoryManager.saveMemory(userId, memoryText, 'semantic');
        console.log(`[POST-MORTEM] 🧠 Lesson saved to user ${userId} memory bank via embeddings.`);
      } else {
        // Fallback: save to legacy vectorMemory collection (no embeddings)
        await this.db.collection('vectorMemory').add({
          userId: userId || 'global_knowledge_base',
          text: memoryText,
          category: 'trade_lessons',
          metadata: {
            symbol: report.symbol,
            grade: report.grade,
            pnl: report.pnl,
            tradeId: report.tradeId,
          },
          timestamp: new Date().toISOString(),
        });
        console.log(`[POST-MORTEM] 🧠 Lesson stored in legacy vectorMemory: "${memoryText.slice(0, 80)}..."`);
      }
    } catch (err: any) {
      console.error('[POST-MORTEM] Failed to store in memory:', err.message);
    }
  }

  private async logActivity(report: PostMortemReport): Promise<void> {
    try {
      const emoji = report.pnl >= 0 ? '✅' : '❌';
      const gradeEmoji = { A: '🏆', B: '👍', C: '🤔', D: '👎', F: '💀' }[report.grade] || '📝';

      await this.db.collection('brainActivity').add({
        agent: 'post-mortem',
        message: `${emoji} ${gradeEmoji} POST-MORTEM: ${report.symbol} — Grade ${report.grade} | ${report.analysis.slice(0, 100)}`,
        type: 'analysis',
        data: { grade: report.grade, lessons: report.lessons },
        userId: report.userId || undefined,
        timestamp: new Date().toISOString(),
      });
    } catch {}
  }
}

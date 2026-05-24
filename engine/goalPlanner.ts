import { generateTextForPurpose } from './modelRouter.ts';

export interface TradingGoal {
  id?: string;
  userId: string;
  targetProfit: number;
  capital: number;
  currency: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  currentProgress: number;
  strategy: string;
  riskLevel: 'conservative' | 'moderate' | 'aggressive';
  milestones: GoalMilestone[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  isPractice: boolean;
}

export interface GoalMilestone {
  target: number;
  label: string;
  reached: boolean;
  reachedAt?: string;
}

export class GoalPlanner {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  /**
   * Create a new trading goal from a user command.
   * Uses Gemini to generate a strategy breakdown.
   */
  async createGoal(
    userId: string,
    targetProfit: number,
    capital: number,
    isPractice: boolean
  ): Promise<TradingGoal> {
    // Ask Gemini to generate a strategy
    const strategyPrompt = `You are a professional trading strategist. A trader wants to make $${targetProfit} profit starting with $${capital} capital trading crypto on Binance.

Generate a brief, actionable trading strategy in 3-4 sentences. Include:
1. Recommended approach (swing trading, scalping, etc.)
2. Risk per trade (% of capital)
3. Target win rate needed
4. Estimated timeframe

Be realistic and conservative. This is ${isPractice ? 'paper trading practice' : 'real money'}.
Keep your response under 100 words. No markdown, no bullet points — just clean text.`;

    let strategy: string;
    try {
      strategy = await generateTextForPurpose('goal-strategy', strategyPrompt);
    } catch (err) {
      strategy = `Target: $${targetProfit} from $${capital} capital. Strategy: Diversified swing trading across top-10 crypto pairs. Risk max 2% per trade. Estimated timeframe: 2-4 weeks with moderate market conditions.`;
    }

    // Determine risk level from ratio
    const returnPercent = (targetProfit / capital) * 100;
    let riskLevel: TradingGoal['riskLevel'] = 'moderate';
    if (returnPercent <= 5) riskLevel = 'conservative';
    else if (returnPercent >= 20) riskLevel = 'aggressive';

    // Generate milestones (25%, 50%, 75%, 100%)
    const milestones: GoalMilestone[] = [
      { target: targetProfit * 0.25, label: '25% — First Quarter', reached: false },
      { target: targetProfit * 0.5, label: '50% — Halfway', reached: false },
      { target: targetProfit * 0.75, label: '75% — Final Stretch', reached: false },
      { target: targetProfit, label: '100% — Goal Reached! 🎉', reached: false },
    ];

    const goal: TradingGoal = {
      userId,
      targetProfit,
      capital,
      currency: 'USDT',
      status: 'active',
      currentProgress: 0,
      strategy,
      riskLevel,
      milestones,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isPractice,
    };

    // Save to Firestore
    const docRef = await this.db.collection('tradingGoals').add(goal);
    goal.id = docRef.id;

    console.log(`[GOAL PLANNER] Created goal: $${targetProfit} from $${capital} for user ${userId} (${riskLevel})`);
    return goal;
  }

  /**
   * Get active goals for a user
   */
  async getGoals(userId: string): Promise<TradingGoal[]> {
    try {
      const snapshot = await this.db
        .collection('tradingGoals')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();

      return snapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data(),
      }));
    } catch (err: any) {
      console.error('[GOAL PLANNER] Failed to fetch goals:', err.message);
      return [];
    }
  }

  /**
   * Update goal progress based on current P&L
   */
  async updateProgress(goalId: string, currentPnl: number): Promise<TradingGoal | null> {
    try {
      const docRef = this.db.collection('tradingGoals').doc(goalId);
      const doc = await docRef.get();
      if (!doc.exists) return null;

      const goal = { id: doc.id, ...doc.data() } as TradingGoal;
      goal.currentProgress = currentPnl;
      goal.updatedAt = new Date().toISOString();

      // Check milestones
      for (const milestone of goal.milestones) {
        if (!milestone.reached && currentPnl >= milestone.target) {
          milestone.reached = true;
          milestone.reachedAt = new Date().toISOString();
          console.log(`[GOAL PLANNER] 🎯 Milestone reached: ${milestone.label}`);
        }
      }

      // Check if goal completed
      if (currentPnl >= goal.targetProfit && goal.status === 'active') {
        goal.status = 'completed';
        goal.completedAt = new Date().toISOString();
        console.log(`[GOAL PLANNER] 🏆 GOAL COMPLETED: $${goal.targetProfit}!`);
      }

      await docRef.update({
        currentProgress: goal.currentProgress,
        milestones: goal.milestones,
        status: goal.status,
        updatedAt: goal.updatedAt,
        ...(goal.completedAt ? { completedAt: goal.completedAt } : {}),
      });

      return goal;
    } catch (err: any) {
      console.error('[GOAL PLANNER] Failed to update progress:', err.message);
      return null;
    }
  }

  /**
   * Pause or resume a goal
   */
  async toggleGoal(goalId: string): Promise<void> {
    const docRef = this.db.collection('tradingGoals').doc(goalId);
    const doc = await docRef.get();
    if (!doc.exists) return;

    const current = doc.data().status;
    const newStatus = current === 'active' ? 'paused' : 'active';
    await docRef.update({ status: newStatus, updatedAt: new Date().toISOString() });
  }

  /**
   * Parse a natural language goal command
   * e.g. "Make me $5000 with $50000 capital"
   */
  parseGoalCommand(text: string): { targetProfit: number; capital: number } | null {
    // Match patterns like "make $5000 with $50000" or "profit of 5000 capital 50000"
    const patterns = [
      /(?:make|earn|profit|target)[^\d]*\$?([\d,]+)[^\d]*(?:with|from|using|capital)[^\d]*\$?([\d,]+)/i,
      /\$?([\d,]+)\s*(?:profit|target)[^\d]*\$?([\d,]+)\s*(?:capital)/i,
      /(?:goal|target)[^\d]*\$?([\d,]+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const profit = parseFloat(match[1].replace(/,/g, ''));
        const capital = match[2] ? parseFloat(match[2].replace(/,/g, '')) : profit * 10; // Default 10x capital
        if (profit > 0 && capital > 0) {
          return { targetProfit: profit, capital };
        }
      }
    }
    return null;
  }
}

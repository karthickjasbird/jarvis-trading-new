/**
 * Agent Swarm — The AI Trading Firm
 * 
 * 6 specialized agents that work together to find and execute trades:
 * Scout → Analyst → Scholar → Strategist → Sentinel → Executor
 * 
 * Each agent calls Gemini, logs its decision to the activity feed,
 * and passes context to the next agent in the pipeline.
 */

import { generateText } from './modelRouter.ts';
import { StrategyTracker } from './strategyTracker.ts';
import { TechnicalAnalysisEngine, MultiTimeframeReport } from './technicalAnalysis.ts';
import { MarketIntelligenceEngine } from './marketIntel.ts';
import { PortfolioIntelligence } from './portfolioIntel.ts';
import { CorrelationGuard } from './correlationGuard.ts';
import { MarketScanner } from './marketScanner.ts';
import { runBacktest } from './backtestEngine.ts';

export interface AgentMessage {
  id?: string;
  agent: string;
  message: string;
  type: 'info' | 'signal' | 'analysis' | 'action' | 'approval' | 'veto' | 'execution' | 'error';
  data?: any;
  timestamp: string;
}

export interface TradeProposal {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  reasoning: string;
  confidence: number;
  riskPercent: number;
}

export class AgentSwarm {
  private db: any;
  private marketState: any;
  private isRunning = false;
  private currentUserId = ''; // Set during pipeline run for brainActivity tagging
  private strategyTracker?: StrategyTracker;
  private taEngine: TechnicalAnalysisEngine;
  private intelEngine: MarketIntelligenceEngine;
  private portfolioIntel: PortfolioIntelligence;
  private correlationGuard: CorrelationGuard;
  private marketScanner: MarketScanner;

  constructor(db: any, marketState: any, strategyTracker?: StrategyTracker, ownerId?: string) {
    this.db = db;
    this.marketState = marketState;
    this.strategyTracker = strategyTracker;
    this.taEngine = new TechnicalAnalysisEngine();
    this.intelEngine = new MarketIntelligenceEngine();
    this.portfolioIntel = new PortfolioIntelligence(db, ownerId);
    this.correlationGuard = new CorrelationGuard(db);
    this.marketScanner = new MarketScanner(db);
  }

  /**
   * Log an agent's activity to Firestore for the Brain page to display
   */
  private async log(agent: string, message: string, type: AgentMessage['type'], data?: any): Promise<void> {
    const entry: AgentMessage = {
      agent,
      message,
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.db.collection('brainActivity').add({ ...entry, userId: this.currentUserId || undefined });
    } catch (err) {
      console.error(`[SWARM] Failed to log activity:`, err);
    }

    console.log(`[${agent.toUpperCase()}] ${message}`);
  }

  /**
   * Get recent market data for agent context
   */
  private getMarketContext(): string {
    const prices = this.marketState.prices || {};
    const pairs = Object.entries(prices)
      .slice(0, 10)
      .map(([symbol, data]: [string, any]) => 
        `${symbol}: $${data.price?.toLocaleString() || 'N/A'} (${data.change24h > 0 ? '+' : ''}${data.change24h?.toFixed(2) || 0}%)`
      )
      .join('\n');

    return pairs || 'No live market data available. Use general crypto market knowledge.';
  }

  /**
   * Run the full agent pipeline
   * @param targetSymbol — Optional. If provided, Scout will ONLY analyze this symbol instead of scanning 5 pairs.
   *                       Pass "INJ/USDT" or "INJUSDT" format — both work.
   */
  async runPipeline(userId: string, isPractice: boolean, targetSymbol?: string): Promise<{
    executed: boolean;
    proposal?: TradeProposal;
    reason: string;
  }> {
    if (this.isRunning) {
      return { executed: false, reason: 'Pipeline already running' };
    }

    this.isRunning = true;
    this.currentUserId = userId; // Tag all brain activity during this run
    const targetLabel = targetSymbol ? ` (target: ${targetSymbol})` : '';
    await this.log('system', `🧠 Agent Swarm pipeline initiated${targetLabel}...`, 'info');

    try {
      // 1. SCOUT — Scan markets (or just the target symbol)
      const scoutResult = await this.runScout(targetSymbol);
      if (!scoutResult.opportunities.length) {
        await this.log('scout', '🔍 No strong opportunities found after TA analysis.', 'info');
        return { executed: false, reason: 'No opportunities found by Scout' };
      }

      const topPick = scoutResult.opportunities[0];
      const cachedTA = scoutResult.taReports?.[topPick.symbol]; // ✅ CACHED — no re-fetch

      // 2 + 3. ANALYST + SCHOLAR — Run in PARALLEL (they don't depend on each other)
      const [analystResult, scholarResult] = await Promise.all([
        this.runAnalyst(topPick, cachedTA),        // Uses cached TA — no HTTP calls
        this.runScholar(topPick.symbol),            // Fetches intel independently
      ]);

      // 4. STRATEGIST — Build trade plan (uses cached TA for ATR data)
      const proposal = await this.runStrategist(topPick, analystResult, scholarResult, cachedTA);
      if (!proposal) {
        await this.log('strategist', '⚠️ Could not formulate a viable trade plan.', 'info');
        return { executed: false, reason: 'Strategist could not create a plan' };
      }

      // 5. SENTINEL — Risk check, APPROVE or VETO
      const sentinelDecision = await this.runSentinel(proposal, isPractice);
      if (!sentinelDecision.approved) {
        return { executed: false, proposal, reason: `Sentinel VETO: ${sentinelDecision.reason}` };
      }

      // 6. EXECUTOR — Place the trade
      await this.runExecutor(proposal, userId, isPractice);

      return { executed: true, proposal, reason: 'Trade executed successfully' };

    } catch (err: any) {
      await this.log('system', `❌ Pipeline error: ${err.message}`, 'error');
      return { executed: false, reason: err.message };
    } finally {
      this.isRunning = false;
    }
  }

  // ─── AGENT 1: SCOUT (DATA-DRIVEN) ─────────────────────────

  private async runScout(targetSymbol?: string): Promise<{ opportunities: Array<{ symbol: string; reason: string; score: number }>; taReports?: Record<string, MultiTimeframeReport> }> {
    // If a target symbol is given, ONLY analyze that one — skip the 5-pair scan
    const scanPairs = targetSymbol
      ? [targetSymbol.includes('/') ? targetSymbol : targetSymbol.replace(/USDT$/, '/USDT')]
      : ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'];

    await this.log('scout', targetSymbol
      ? `🎯 Targeted analysis on ${scanPairs[0]}...`
      : `🔍 Running TA on ${scanPairs.length} pairs...`, 'info');

    const taReports: Record<string, MultiTimeframeReport> = {};
    const opportunities: Array<{ symbol: string; reason: string; score: number }> = [];

    // Run TA analysis on all pairs in parallel (instead of sequentially)
    const taResults = await Promise.allSettled(
      scanPairs.map(async (symbol) => {
        const report = await this.taEngine.analyzeSymbol(symbol);
        return { symbol, report };
      })
    );

    for (const result of taResults) {
      if (result.status !== 'fulfilled') continue;
      const { symbol, report } = result.value;
      taReports[symbol] = report;

      const conf = report.confluence;

      // For targeted symbol: include it regardless of bias (user specifically asked for it)
      if (targetSymbol) {
        opportunities.push({
          symbol,
          reason: conf.reasons.join(' | '),
          score: conf.confidence,
        });
      } else if (conf.bias === 'strong_buy' || conf.bias === 'buy') {
        opportunities.push({
          symbol,
          reason: conf.reasons.join(' | '),
          score: conf.confidence,
        });
      }

      await this.log('scout',
        `📊 ${symbol}: ${conf.bias.toUpperCase()} (${conf.confidence}%) — ${report.analyses.map(a => `${a.timeframe}:${a.signal.bias}`).join(', ')}`,
        'signal',
        { symbol, confluence: conf.bias, confidence: conf.confidence }
      );
    }

    // Sort by confidence
    opportunities.sort((a, b) => b.score - a.score);

    if (opportunities.length > 0) {
      await this.log('scout', `✅ Found ${opportunities.length} TA-backed opportunities: ${opportunities.map(o => `${o.symbol} (${o.score}%)`).join(', ')}`, 'signal', opportunities);
    } else {
      await this.log('scout', '⚠️ No pairs have bullish confluence across timeframes.', 'info');
    }

    return { opportunities, taReports };
  }

  // ─── AGENT 2: ANALYST (DATA-DRIVEN) ─────────────────────────

  private async runAnalyst(opportunity: { symbol: string; reason: string }, taReport?: MultiTimeframeReport): Promise<string> {
    await this.log('analyst', `📊 Deep analysis on ${opportunity.symbol} with real indicator data...`, 'info');

    // If we already have TA data from Scout, use it. Otherwise fetch fresh.
    let report = taReport;
    if (!report) {
      report = await this.taEngine.analyzeSymbol(opportunity.symbol);
    }

    const taSummary = this.taEngine.formatForAgent(report);

    const prompt = `You are Analyst, a technical analysis AI. You have REAL indicator data (not guesses). Analyze this data and provide a trading assessment:

${taSummary}

Based on this REAL data, provide:
1. Your directional bias and why
2. Key support/resistance levels you can infer
3. Whether this is a good entry point RIGHT NOW
4. Risk level (low/medium/high)

Keep it under 100 words. Plain text only. Be specific — reference the actual numbers.`;

    try {
      const analysis = await generateText('gemini-2.5-flash', prompt);
      await this.log('analyst', `📊 ${analysis.slice(0, 150)}...`, 'analysis', {
        symbol: opportunity.symbol,
        analysis,
        indicators: report.analyses.map(a => ({
          tf: a.timeframe,
          rsi: a.indicators.rsi?.toFixed(1),
          bias: a.signal.bias,
        }))
      });
      return `${analysis}\n\n--- RAW TA DATA ---\n${taSummary}`;
    } catch (err) {
      // Even if AI fails, return the raw TA data — it's still real
      await this.log('analyst', `📊 AI analysis failed, using raw TA data for ${opportunity.symbol}`, 'analysis');
      return taSummary;
    }
  }

  // ─── AGENT 3: SCHOLAR (INTELLIGENCE-DRIVEN) ─────────────────

  private async runScholar(symbol: string): Promise<string> {
    await this.log('scholar', `📚 Gathering live market intelligence for ${symbol}...`, 'info');

    // Fetch real market intelligence
    let intelSummary = '';
    try {
      const intel = await this.intelEngine.gather();
      intelSummary = intel.summary;

      await this.log('scholar',
        `📡 Fear: ${intel.fearGreed.value} (${intel.fearGreed.label}) | BTC.D: ${intel.btcDominance.value}% | Funding: ${intel.fundingRates.length} pairs tracked`,
        'info',
        { fearGreed: intel.fearGreed, btcDominance: intel.btcDominance }
      );
    } catch (err: any) {
      console.error('[SCHOLAR] Intel fetch failed:', err.message);
    }

    // Also check memory bank for recent knowledge
    let memoryContext = '';
    try {
      const snapshot = await this.db.collection('vectorMemory')
        .where('userId', '==', 'global_knowledge_base')
        .limit(3)
        .get();

      if (!snapshot.empty) {
        memoryContext = snapshot.docs.map((d: any) => d.data().text).join(' | ');
      }
    } catch (err) {
      // No memory available
    }

    const prompt = `You are Scholar, a crypto research AI with access to REAL live market data. Analyze ${symbol}:

${intelSummary}

Recent memory bank knowledge: ${memoryContext || 'No recent data.'}

Based on this REAL intelligence, provide:
1. Overall market sentiment and what it means for ${symbol}
2. Whether funding rates suggest a potential squeeze
3. Whether BTC dominance trend favors this trade
4. Your fundamental verdict: FAVORABLE or UNFAVORABLE

Keep under 80 words. Plain text. Reference the actual data.`;

    try {
      const research = await generateText('gemini-2.5-flash', prompt);
      await this.log('scholar', `📚 ${research.slice(0, 150)}...`, 'analysis', { symbol, research });
      return `${research}\n\n--- RAW INTELLIGENCE ---\n${intelSummary}`;
    } catch (err) {
      // Even if AI fails, return the raw intel — it's still valuable
      await this.log('scholar', `📚 AI research failed, using raw intelligence feed`, 'analysis');
      return intelSummary || `${symbol} shows neutral fundamental outlook. No intelligence data available.`;
    }
  }

  // ─── AGENT 4: STRATEGIST (ATR-BASED SIZING) ─────────────────

  private async runStrategist(
    opportunity: { symbol: string; score: number },
    analystReport: string,
    scholarReport: string,
    cachedTA?: MultiTimeframeReport
  ): Promise<TradeProposal | null> {
    await this.log('strategist', `🎯 Building ATR-based trade plan for ${opportunity.symbol}...`, 'info');

    // Use CACHED TA data from Scout (no re-fetch needed!)
    let atrData = '';
    try {
      const report = cachedTA || await this.taEngine.analyzeSymbol(opportunity.symbol);
      const h1 = report.analyses.find(a => a.timeframe === '1H');
      const h4 = report.analyses.find(a => a.timeframe === '4H');

      if (h1?.indicators.atr) {
        const atr1h = h1.indicators.atr;
        const price = h1.indicators.price;
        const atrPercent = ((atr1h / price) * 100).toFixed(2);
        atrData = `\nATR(14) 1H: $${atr1h.toFixed(4)} (${atrPercent}% of price)`;
        atrData += `\nCurrent Price: $${price}`;
        if (h4?.indicators.atr) {
          atrData += `\nATR(14) 4H: $${h4.indicators.atr.toFixed(4)}`;
        }
        atrData += `\n\nSL RULE: Place stop-loss at 1.5x ATR(1H) from entry.`;
        atrData += `\nTP1 RULE: Take-profit 1 at 1.5x ATR (1:1 R/R) — close 50%.`;
        atrData += `\nTP2 RULE: Take-profit 2 at 3x ATR (2:1 R/R) — let remaining run.`;
        atrData += `\nSIZING RULE: Risk max 2% of $100,000 capital = $2,000 risk per trade.`;
        atrData += `\nPosition size = $2,000 / (1.5 × ATR) = quantity in base asset.`;
      }
    } catch {}

    const prompt = `You are Strategist, a trade planning AI with ATR-based risk management.

Symbol: ${opportunity.symbol}
Scout Score: ${opportunity.score}/100
Technical Analysis: ${analystReport.slice(0, 500)}
Fundamental Research: ${scholarReport.slice(0, 300)}
${atrData}

Create a trade proposal in this EXACT JSON format (no markdown):
{"symbol":"${opportunity.symbol}","side":"buy","quantity":0.01,"entryPrice":0,"stopLoss":0,"takeProfit":0,"reasoning":"brief reason","confidence":75,"riskPercent":2}

Rules:
- Use ATR data for SL/TP if available. SL = entry ∓ 1.5 × ATR.
- TP = entry ± 3 × ATR (2:1 R/R minimum).
- Position size based on $2,000 max risk (2% of $100K).
- Confidence 0-100 based on how aligned TA + fundamentals are.
- Set REAL current prices, not 0.`;

    try {
      const response = await generateText('gemini-2.5-flash', prompt);
      const cleaned = response.replace(/```json?|```/g, '').trim();
      const proposal = JSON.parse(cleaned) as TradeProposal;

      await this.log('strategist',
        `🎯 PROPOSAL: ${proposal.side.toUpperCase()} ${proposal.quantity} ${proposal.symbol} @ $${proposal.entryPrice} | SL: $${proposal.stopLoss} | TP: $${proposal.takeProfit} | Risk: ${proposal.riskPercent}% | Confidence: ${proposal.confidence}%`,
        'action', proposal
      );

      return proposal;
    } catch (err) {
      await this.log('strategist', '⚠️ Failed to build a structured trade plan.', 'error');
      return null;
    }
  }

  // ─── AGENT 5: SENTINEL ──────────────────────────────────────

  private async runSentinel(
    proposal: TradeProposal,
    isPractice: boolean
  ): Promise<{ approved: boolean; reason: string }> {
    await this.log('sentinel', `🛡️ Reviewing trade: ${proposal.side.toUpperCase()} ${proposal.symbol}...`, 'info');

    // Hard rules (no AI needed)
    const hardChecks: string[] = [];

    // Portfolio-level risk check (correlation, heat, circuit breaker)
    try {
      const portfolioCheck = await this.portfolioIntel.checkTradeAllowed(
        proposal.symbol,
        proposal.riskPercent || 2
      );
      if (!portfolioCheck.allowed) {
        const reason = `VETO (Portfolio) — ${portfolioCheck.reason}`;
        await this.log('sentinel', `🛡️ ${reason}`, 'veto', { portfolioCheck: portfolioCheck.details });
        return { approved: false, reason };
      }
      await this.log('sentinel',
        `📊 Portfolio check passed: Heat=${portfolioCheck.details.portfolioHeat.toFixed(1)}%, Positions=${portfolioCheck.details.openPositions}, DailyPnl=${portfolioCheck.details.dailyPnl.toFixed(2)}%`,
        'info'
      );
    } catch (err: any) {
      console.error('[SENTINEL] Portfolio check error:', err.message);
    }

    // Correlation Guard — prevent betting the same direction in correlated assets
    try {
      const corrCheck = await this.correlationGuard.checkTradeAllowed(proposal.symbol, proposal.side);
      if (!corrCheck.allowed) {
        const reason = `VETO (Correlation) — ${corrCheck.reason}`;
        await this.log('sentinel', `🛡️ ${reason}`, 'veto', { correlationGroup: corrCheck.group, existingSymbol: corrCheck.existingSymbol });
        return { approved: false, reason };
      }
      if (corrCheck.group) {
        await this.log('sentinel', `✅ Correlation check passed: No conflicting positions in '${corrCheck.group}' group`, 'info');
      }
    } catch (err: any) {
      console.error('[SENTINEL] Correlation check error:', err.message);
    }

    // Check strategy health via StrategyTracker
    if (this.strategyTracker) {
      const stratCheck = await this.strategyTracker.isStrategyAllowed('agent-swarm');
      if (!stratCheck.allowed) {
        const reason = `VETO — Strategy disabled: ${stratCheck.reason}`;
        await this.log('sentinel', `🚫 ${reason}`, 'veto', { strategyCheck: stratCheck });
        return { approved: false, reason };
      }
    }

    if (proposal.riskPercent > 5) {
      hardChecks.push(`Risk too high: ${proposal.riskPercent}% (max 5%)`);
    }
    if (proposal.confidence < 50) {
      hardChecks.push(`Confidence too low: ${proposal.confidence}% (min 50%)`);
    }
    if (proposal.stopLoss <= 0 || proposal.takeProfit <= 0) {
      hardChecks.push('Missing stop-loss or take-profit');
    }

    // Check risk-reward ratio
    if (proposal.side === 'buy') {
      const risk = proposal.entryPrice - proposal.stopLoss;
      const reward = proposal.takeProfit - proposal.entryPrice;
      if (risk > 0 && reward / risk < 1.5) {
        hardChecks.push(`Poor R/R ratio: ${(reward / risk).toFixed(1)}:1 (min 1.5:1)`);
      }
    }

    if (hardChecks.length > 0) {
      const reason = `VETO — ${hardChecks.join('; ')}`;
      await this.log('sentinel', `🚫 ${reason}`, 'veto', { checks: hardChecks });
      return { approved: false, reason };
    }

    // ─── HISTORICAL BACKTEST VALIDATION ────────────────────────
    // Run a quick backtest to check if this pattern has historically worked
    try {
      await this.log('sentinel', `📈 Running historical validation on ${proposal.symbol}...`, 'info');
      const btResult = await runBacktest(proposal.symbol, 'rsi', '1h');

      await this.log('sentinel',
        `📊 Backtest: ${btResult.totalTrades} trades, ${btResult.winRate.toFixed(1)}% win rate, ${btResult.pnlPercent >= 0 ? '+' : ''}${btResult.pnlPercent.toFixed(1)}% P&L → ${btResult.verdict.toUpperCase()}`,
        btResult.verdict === 'failing' ? 'veto' : 'info',
        { backtest: btResult }
      );

      // VETO if the pattern is historically a consistent loser
      if (btResult.verdict === 'failing') {
        const reason = `VETO (Backtest) — This pattern has historically FAILED on ${proposal.symbol}: ${btResult.winRate.toFixed(1)}% win rate, ${btResult.pnlPercent.toFixed(1)}% P&L over ${btResult.totalTrades} trades.`;
        await this.log('sentinel', `🚫 ${reason}`, 'veto');
        return { approved: false, reason };
      }
    } catch (err: any) {
      // Backtest failure is non-blocking — log it but continue
      console.error('[SENTINEL] Backtest validation error:', err.message);
      await this.log('sentinel', `⚠️ Historical validation skipped: ${err.message}`, 'info');
    }

    // AI assessment for edge cases
    const prompt = `You are Sentinel, a risk management AI. Review this trade proposal and respond with ONLY "APPROVED" or "REJECTED: reason".

${proposal.side.toUpperCase()} ${proposal.quantity} ${proposal.symbol}
Entry: $${proposal.entryPrice} | SL: $${proposal.stopLoss} | TP: $${proposal.takeProfit}
Risk: ${proposal.riskPercent}% | Confidence: ${proposal.confidence}%
Mode: ${isPractice ? 'PAPER TRADING' : 'REAL MONEY'}
Reasoning: ${proposal.reasoning}

Be strict. Approve only if risk management is sound.`;

    try {
      const decision = await generateText('gemini-2.5-flash', prompt);
      const approved = decision.toUpperCase().includes('APPROVED');

      if (approved) {
        await this.log('sentinel', `✅ Trade APPROVED — Risk assessment passed`, 'approval');
      } else {
        await this.log('sentinel', `🚫 ${decision.slice(0, 150)}`, 'veto');
      }

      return { approved, reason: decision };
    } catch (err) {
      // If AI fails, default to APPROVE for paper, REJECT for real
      if (isPractice) {
        await this.log('sentinel', '✅ Approved (default — paper trading mode)', 'approval');
        return { approved: true, reason: 'Default approved for practice' };
      }
      await this.log('sentinel', '🚫 REJECTED — Sentinel check failed, blocking real trade', 'veto');
      return { approved: false, reason: 'Sentinel check failed — safety block' };
    }
  }

  // ─── AGENT 6: EXECUTOR ──────────────────────────────────────

  private async runExecutor(proposal: TradeProposal, userId: string, isPractice: boolean): Promise<void> {
    const mode = isPractice ? 'PAPER' : 'LIVE';

    // ─── KELLY CRITERION POSITION SIZING ──────────────────
    // Scale position size based on setup confidence score
    // High confidence = bigger bet, low confidence = smaller bet
    let kellyMultiplier = 0.5; // default: half size for weak setups
    if (proposal.confidence >= 90) {
      kellyMultiplier = 1.25; // Only the absolute best setups get extra capital
    } else if (proposal.confidence >= 85) {
      kellyMultiplier = 1.0;  // Full size for strong setups
    } else if (proposal.confidence >= 80) {
      kellyMultiplier = 0.75; // 75% for decent setups
    } else {
      kellyMultiplier = 0.5;  // 50% for marginal setups (still above sentinel threshold)
    }

    // Apply Time-of-Day session quality multiplier
    const sessionInfo = this.marketScanner.getSessionQuality();

    // Combined multiplier: Kelly × Session Quality
    const combinedMultiplier = kellyMultiplier * sessionInfo.multiplier;
    const adjustedQuantity = parseFloat((proposal.quantity * combinedMultiplier).toFixed(8));

    if (kellyMultiplier !== 1.0) {
      await this.log('executor', `🎲 Kelly sizing: ${proposal.confidence}% confidence → ${kellyMultiplier * 100}% of base size`, 'info');
    }
    if (sessionInfo.multiplier < 1.0) {
      await this.log('executor', `⏰ Session: ${sessionInfo.session} (${sessionInfo.multiplier * 100}% size) — ${sessionInfo.description}`, 'info');
    }
    if (combinedMultiplier !== 1.0) {
      await this.log('executor', `📐 Final size: ${(combinedMultiplier * 100).toFixed(0)}% of base (Kelly ${kellyMultiplier * 100}% × Session ${sessionInfo.multiplier * 100}%)`, 'info');
    }

    await this.log('executor', `⚡ Executing: ${proposal.side.toUpperCase()} ${adjustedQuantity} ${proposal.symbol} (${mode})`, 'execution');

    try {
      // Save trade to Firestore
      await this.db.collection('trades').add({
        userId,
        symbol: proposal.symbol,
        side: proposal.side,
        quantity: adjustedQuantity,
        entryPrice: proposal.entryPrice,
        stopLossPrice: proposal.stopLoss,
        takeProfitPrice: proposal.takeProfit,
        reasoning: proposal.reasoning,
        confidence: proposal.confidence,
        mode: isPractice ? 'paper' : 'live',
        status: 'open',
        source: 'agent-swarm',
        sessionQuality: sessionInfo.session,
        sizeMultiplier: sessionInfo.multiplier,
        createdAt: new Date().toISOString(),
      });

      await this.log('executor',
        `✅ Order placed: ${proposal.side.toUpperCase()} ${adjustedQuantity} ${proposal.symbol} @ $${proposal.entryPrice} (${mode} | Session: ${sessionInfo.session})`,
        'execution', { ...proposal, adjustedQuantity, session: sessionInfo }
      );
    } catch (err: any) {
      await this.log('executor', `❌ Execution failed: ${err.message}`, 'error');
    }
  }

  /**
   * Get recent activity for the Brain page
   */
  async getRecentActivity(limit = 20): Promise<AgentMessage[]> {
    try {
      const snapshot = await this.db.collection('brainActivity')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs
        .map((doc: any) => ({ id: doc.id, ...doc.data() }))
        .reverse(); // oldest first for feed display
    } catch (err) {
      return [];
    }
  }

  /**
   * Clear old activity logs (keep last 100)
   */
  async cleanupActivity(): Promise<void> {
    try {
      const snapshot = await this.db.collection('brainActivity')
        .orderBy('timestamp', 'asc')
        .limit(500)
        .get();

      if (snapshot.size > 100) {
        const batch = this.db.batch();
        const toDelete = snapshot.docs.slice(0, snapshot.size - 100);
        toDelete.forEach((doc: any) => batch.delete(doc.ref));
        await batch.commit();
      }
    } catch (err) {
      // cleanup is best-effort
    }
  }
}

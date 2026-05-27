/**
 * Agent Swarm — The AI Trading Firm
 * 
 * 8 specialized agents that work together to find and execute trades:
 * Regime → Scout → Analyst + Scholar → Holistic → Strategist → Sentinel → Executor
 * 
 * Each agent calls Gemini, logs its decision to the activity feed,
 * and passes context to the next agent in the pipeline.
 * 
 * Phase 0 Wiring:
 *   - RegimeDetector: gates trades and adjusts SL/TP multipliers
 *   - KellyCalculator: mathematically optimal position sizing
 *   - MemoryManager: Scholar queries real trade lessons from PostMortem
 *   - MarketScanner: Scout uses ranked scan results instead of hardcoded pairs
 * 
 * Jarvis Identity System:
 *   - Every AI agent receives a shared identity context
 *   - Jarvis knows its architecture, current state, and capabilities
 *   - Identity is rebuilt at each pipeline run with live telemetry
 */

import { generateTextForPurpose } from './modelRouter.ts';
import { StrategyTracker } from './strategyTracker.ts';
import { TechnicalAnalysisEngine, MultiTimeframeReport } from './technicalAnalysis.ts';
import { MarketIntelligenceEngine } from './marketIntel.ts';
import { PortfolioIntelligence } from './portfolioIntel.ts';
import { CorrelationGuard } from './correlationGuard.ts';
import { MarketScanner } from './marketScanner.ts';
import { RegimeDetector, RegimeResult } from './regimeDetector.ts';
import { KellyCalculator } from './kellyCalculator.ts';
import { MemoryManager } from './memory.ts';
import { runBacktest } from './backtestEngine.ts';
import { TradeDiaryEngine, TradeDiaryEntry } from './tradeDiary.ts';
// NEXUS Phase 5b + Phase 6 wiring — TV indicators + Gemini Vision into the swarm
import { getTradingViewBridge } from './tradingViewBridge.ts';
import { readTVIndicators } from './tvIndicators.ts';
import { analyzeChart } from './tvVision.ts';

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
  // Phase 9 (0b) — organic R/R baseline captured BEFORE any auto-widen.
  // Lets us measure how often the LLM naturally proposes a 1.5:1+ R/R, so
  // when the widen block is deleted (#4) we can distinguish "no edge"
  // from "gates too tight" by comparing pre- vs post-deletion pass rates.
  organicRR?: number;
  wouldPassOrganicRR?: boolean;
}

// Phase 9 (0b) — Per-proposal observability. Logged into `scanMetrics`
// collection so we can quantify gate-by-gate pass rates over time.
export type VetoCategory =
  | 'low_confidence'
  | 'poor_rr'
  | 'risk_gate'
  | 'correlation'
  | 'portfolio_heat'
  | 'backtest_weak'
  | 'strategist_failed'
  | 'other';

export interface ProposalMetric {
  symbol: string;
  scoutScore: number;
  holisticConviction: number | null;   // parsed "CONFIDENCE: NN" from holistic assessment
  organicRR: number | null;             // R/R as LLM proposed it (pre-widen)
  wouldPassOrganicRR: boolean;          // would the LLM's original R/R have cleared 1.5:1?
  postWidenRR: number | null;           // R/R after auto-widen runs (currently always >=1.5; trivial once #4 ships)
  proposalConfidence: number | null;    // Strategist's reported confidence on the final proposal
  sentinelApproved: boolean;
  sentinelVetoReason?: string;
  vetoCategory?: VetoCategory;
}

function categorizeVeto(reason: string): VetoCategory {
  if (/Confidence too low/i.test(reason)) return 'low_confidence';
  if (/Poor R\/R/i.test(reason)) return 'poor_rr';
  if (/Kill Switch|Daily loss|Live capital|Notional cap|Concurrent cap|Leverage cap/i.test(reason)) return 'risk_gate';
  if (/Correlation/i.test(reason)) return 'correlation';
  if (/Portfolio/i.test(reason)) return 'portfolio_heat';
  if (/Backtest/i.test(reason)) return 'backtest_weak';
  return 'other';
}

function parseHolisticConfidence(assessment: string): number | null {
  const m = assessment.match(/CONFIDENCE:\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
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
  private regimeDetector: RegimeDetector;
  private kellyCalculator: KellyCalculator;
  private memoryManager: MemoryManager;
  private tradeDiary: TradeDiaryEngine;

  constructor(
    db: any,
    marketState: any,
    strategyTracker?: StrategyTracker,
    ownerId?: string,
    regimeDetector?: RegimeDetector,
    kellyCalculator?: KellyCalculator,
    memoryManager?: MemoryManager,
    tradeDiary?: TradeDiaryEngine
  ) {
    this.db = db;
    this.marketState = marketState;
    this.strategyTracker = strategyTracker;
    this.taEngine = new TechnicalAnalysisEngine();
    this.intelEngine = new MarketIntelligenceEngine();
    this.portfolioIntel = new PortfolioIntelligence(db, ownerId);
    this.correlationGuard = new CorrelationGuard(db);
    this.marketScanner = new MarketScanner(db);
    this.regimeDetector = regimeDetector || new RegimeDetector();
    this.kellyCalculator = kellyCalculator || new KellyCalculator(db);
    this.memoryManager = memoryManager || new MemoryManager(db);
    this.tradeDiary = tradeDiary || new TradeDiaryEngine(db);
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
  async runPipeline(userId: string, isPractice: boolean, targetSymbol?: string, requireApproval: boolean = true): Promise<{
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
      // 0. REGIME DETECTION — Classify market conditions BEFORE scanning.
      //
      // Phase 9 (#7) — Asset-class-aware. Stocks/ETFs are gated by SPY 4H
      // regime (not BTC). The Alpaca market clock is checked FIRST: if the
      // US session is closed, return a `market_closed` block WITHOUT
      // computing indicators — zero-volume flat off-hours bars make
      // ATR/ADX degenerate (ATR → ~0), which then poisons SL/TP sizing
      // downstream, not just the regime call.
      let regimeContext: RegimeResult | null = null;
      try {
        // Detect asset class from the target symbol
        const symbolUpper = (targetSymbol || '').toUpperCase();
        const isStock = !!targetSymbol && !symbolUpper.includes('USDT') && !symbolUpper.includes('/') && /^[A-Z]{1,5}$/.test(symbolUpper);

        // Stocks: clock-guard first, then SPY regime
        if (isStock) {
          const marketOpen = await this.marketScanner.isUSMarketOpen(userId);
          if (marketOpen === false) {
            const reason = 'US market is closed — skipping pipeline (off-hours bars produce degenerate ATR/ADX)';
            await this.log('regime', `🕒 ${reason}`, 'veto');
            await this.tradeDiary.logDecision(userId, {
              timestamp: new Date().toISOString(),
              userId,
              symbol: targetSymbol || 'STOCK',
              side: 'none',
              decision: 'vetoed_regime_gate',
              reasoning: reason,
              indicators: { price: 0, rsi: null, macdHistogram: null, ema9: null, ema21: null, vwap: null, obvSlope: null, adx: null, atr: null },
              regime: 'unknown',
              riskCheck: { portfolioHeat: 0, openPositions: 0, dailyPnl: 0 },
              confidence: 0,
            });
            return { executed: false, reason };
          }
          // marketOpen === null means creds unavailable — proceed with regime detection
          // (degraded mode); marketOpen === true is the happy path.
        }

        const regimeSymbol = isStock
          ? 'SPY' // US equities benchmark
          : (targetSymbol
              ? (targetSymbol.includes('/') ? targetSymbol : targetSymbol.replace(/USDT$/, '/USDT'))
              : 'BTC/USDT'); // crypto-wide proxy

        regimeContext = await this.regimeDetector.detectRegime(regimeSymbol, '4h');

        await this.log('regime', 
          `📊 Market Regime: ${regimeContext.regime.toUpperCase()} (${regimeContext.confidence}%) | ` +
          `ADX: ${regimeContext.adx} | ATR: ${regimeContext.atrPercent}% | EMA: ${regimeContext.emaAlignment} | ` +
          `Strategy: ${regimeContext.recommendations.strategyType} | ShouldTrade: ${regimeContext.recommendations.shouldTrade}`,
          'info', { regime: regimeContext }
        );

        // HARD GATE: If regime says don't trade, abort early
        if (!regimeContext.recommendations.shouldTrade) {
          const reason = `Regime BLOCK — ${regimeContext.recommendations.reason}`;
          await this.log('regime', `🚫 ${reason}`, 'veto');

          // DIARY: Log regime gate block
          await this.tradeDiary.logDecision(userId, {
            timestamp: new Date().toISOString(),
            userId,
            symbol: targetSymbol || 'BTC/USDT',
            side: 'none',
            decision: 'vetoed_regime_gate',
            reasoning: reason,
            indicators: { price: 0, rsi: null, macdHistogram: null, ema9: null, ema21: null, vwap: null, obvSlope: null, adx: regimeContext.adx, atr: null },
            regime: (regimeContext.regime as TradeDiaryEntry['regime']) || 'unknown',
            riskCheck: { portfolioHeat: 0, openPositions: 0, dailyPnl: 0 },
            confidence: 0,
          });

          return { executed: false, reason };
        }
      } catch (err: any) {
        console.error('[SWARM] Regime detection failed (non-blocking):', err.message);
        await this.log('regime', `⚠️ Regime detection failed: ${err.message}. Proceeding with defaults.`, 'info');
      }

      // Read user's profit target from risk settings (used when saving trades)
      let pipelineProfitTarget = 0;
      try {
        const riskDoc = await this.db.collection('riskSettings').doc(userId).get();
        if (riskDoc.exists) {
          const rs = riskDoc.data();
          if (rs?.profitTarget && rs.profitTarget > 0) pipelineProfitTarget = rs.profitTarget;
        }
      } catch {}

      // BUILD JARVIS IDENTITY — Self-awareness context for all AI agents
      const identityContext = await this.buildIdentityContext(userId, isPractice, regimeContext);

      // 1. SCOUT — Scan markets (or just the target symbol)
      const scoutResult = await this.runScout(targetSymbol, regimeContext?.regime);
      if (!scoutResult.opportunities.length) {
        await this.log('scout', '🔍 No strong opportunities found after TA analysis.', 'info');

        // DIARY: Log no opportunity
        await this.tradeDiary.logDecision(userId, {
          timestamp: new Date().toISOString(),
          userId,
          symbol: targetSymbol || 'MARKET',
          side: 'none',
          decision: 'no_opportunity',
          reasoning: 'Scout found no strong opportunities after TA analysis.',
          indicators: { price: 0, rsi: null, macdHistogram: null, ema9: null, ema21: null, vwap: null, obvSlope: null, adx: null, atr: null },
          regime: (regimeContext?.regime as TradeDiaryEntry['regime']) || 'unknown',
          riskCheck: { portfolioHeat: 0, openPositions: 0, dailyPnl: 0 },
          confidence: 0,
        });

        return { executed: false, reason: 'No opportunities found by Scout' };
      }

      // Phase 8 Fix — Multi-pick fallback loop. Previously only opportunities[0]
      // reached Analyst→Sentinel; one veto killed the whole scan and the next 4
      // ranked picks were discarded. Now we evaluate the top N (capped) and
      // surface every Sentinel-approved candidate as a pending approval so
      // Karthick can pick which to execute.
      const MAX_PICKS_TO_TRY = 3;
      const MIN_SCOUT_CONFIDENCE = 45;

      const picksToTry = scoutResult.opportunities
        .filter(o => o.score >= MIN_SCOUT_CONFIDENCE)
        .slice(0, MAX_PICKS_TO_TRY);

      if (picksToTry.length === 0) {
        await this.log('scout', `🔍 No picks above ${MIN_SCOUT_CONFIDENCE}% Scout confidence — skipping deep analysis.`, 'info');
        return { executed: false, reason: `No picks above ${MIN_SCOUT_CONFIDENCE}% Scout confidence` };
      }

      await this.log('system',
        `🎯 Evaluating top ${picksToTry.length} pick${picksToTry.length > 1 ? 's' : ''}: ${picksToTry.map(p => `${p.symbol} (${p.score}%)`).join(', ')}`,
        'info'
      );

      const approvedProposals: Array<{ proposal: TradeProposal; cachedTA: any }> = [];
      const vetoReasons: string[] = [];
      const proposalMetrics: ProposalMetric[] = []; // Phase 9 (0b) — per-pick observability

      for (let i = 0; i < picksToTry.length; i++) {
        const pick = picksToTry[i];
        const cachedTA = scoutResult.taReports?.[pick.symbol]; // CACHED — no re-fetch

        if (i > 0) {
          await this.log('system',
            `🔄 Evaluating pick #${i + 1} of ${picksToTry.length} — ${pick.symbol} (Scout ${pick.score}%)`,
            'info'
          );
        }

        // Phase 7 Fix B — per-symbol regime override (per-pick, not just top pick).
        // Symbol may be in a different regime than overall market (e.g., NEAR
        // VOLATILE while market is RANGING). Use symbol's own regime for SL/TP.
        let effectiveRegime: RegimeResult | null = regimeContext;
        try {
          const symbolRegime = await this.regimeDetector.detectRegime(pick.symbol, '4h');
          if (symbolRegime && (symbolRegime.confidence ?? 0) > 30) {
            effectiveRegime = symbolRegime;
            if (regimeContext && symbolRegime.regime !== regimeContext.regime) {
              await this.log('regime',
                `🔀 Per-symbol regime override: ${pick.symbol} is ${symbolRegime.regime.toUpperCase()} (${symbolRegime.confidence}%) — using this for SL/TP sizing instead of overall ${regimeContext.regime.toUpperCase()}`,
                'info', { symbolRegime, overallRegime: regimeContext }
              );
            }
          }
        } catch (err: any) {
          console.warn('[SWARM] Per-symbol regime detection failed, falling back to overall:', err?.message);
        }

        // ANALYST + SCHOLAR (parallel)
        const [analystResult, scholarResult] = await Promise.all([
          this.runAnalyst(pick, cachedTA, identityContext),
          this.runScholar(pick.symbol, this.currentUserId, identityContext),
        ]);

        // HOLISTIC — full-context conviction
        const holisticAssessment = await this.runHolistic(
          pick,
          analystResult,
          scholarResult,
          cachedTA,
          effectiveRegime,
          userId,
          identityContext
        );

        // Phase 9 (0b/0c) — start building this pick's metric. holisticConviction
        // is parsed from the "CONFIDENCE: NN" line in the assessment string.
        const holisticConviction = parseHolisticConfidence(holisticAssessment);
        const metric: ProposalMetric = {
          symbol: pick.symbol,
          scoutScore: pick.score,
          holisticConviction,
          organicRR: null,
          wouldPassOrganicRR: false,
          postWidenRR: null,
          proposalConfidence: null,
          sentinelApproved: false,
        };

        // STRATEGIST — build trade plan
        const proposal = await this.runStrategist(pick, analystResult, scholarResult, cachedTA, effectiveRegime, identityContext, holisticAssessment);
        if (!proposal) {
          await this.log('strategist', `⚠️ Could not formulate a viable trade plan for ${pick.symbol}.`, 'info');
          vetoReasons.push(`${pick.symbol}: Strategist could not create a plan`);
          metric.sentinelVetoReason = 'Strategist could not build a plan';
          metric.vetoCategory = 'strategist_failed';
          proposalMetrics.push(metric);
          continue;
        }

        // Populate proposal-derived metrics. organicRR was set inside runStrategist
        // BEFORE the auto-widen ran, so this captures the LLM's actual proposal.
        metric.organicRR = proposal.organicRR ?? null;
        metric.wouldPassOrganicRR = proposal.wouldPassOrganicRR ?? false;
        const finalSl = Math.abs(proposal.entryPrice - proposal.stopLoss);
        const finalTp = Math.abs(proposal.takeProfit - proposal.entryPrice);
        metric.postWidenRR = finalSl > 0 ? parseFloat((finalTp / finalSl).toFixed(2)) : null;
        metric.proposalConfidence = proposal.confidence;

        // SENTINEL — risk + AI confidence gate
        const sentinelDecision = await this.runSentinel(proposal, isPractice, regimeContext, identityContext, userId);
        if (!sentinelDecision.approved) {
          // DIARY: Log sentinel veto with indicator snapshot
          const vetoIndicators = this.extractIndicatorsFromTA(cachedTA);
          await this.tradeDiary.logDecision(userId, {
            timestamp: new Date().toISOString(),
            userId,
            symbol: proposal.symbol,
            side: proposal.side,
            decision: sentinelDecision.reason.includes('Backtest') ? 'vetoed_backtest' : sentinelDecision.reason.includes('Portfolio') || sentinelDecision.reason.includes('Correlation') ? 'vetoed_sentinel_risk' : 'vetoed_sentinel_ai',
            reasoning: sentinelDecision.reason,
            indicators: vetoIndicators,
            regime: (regimeContext?.regime as TradeDiaryEntry['regime']) || 'unknown',
            riskCheck: { portfolioHeat: 0, openPositions: 0, dailyPnl: 0 },
            confidence: proposal.confidence,
          });

          vetoReasons.push(`${pick.symbol}: ${sentinelDecision.reason}`);
          metric.sentinelVetoReason = sentinelDecision.reason;
          metric.vetoCategory = categorizeVeto(sentinelDecision.reason);
          proposalMetrics.push(metric);

          // Hard stops — system-wide bans. Retrying with the next pick won't help.
          if (/Kill Switch|Daily loss|Live capital cap|Notional cap|Concurrent cap/i.test(sentinelDecision.reason)) {
            await this.writeScanMetrics(userId, regimeContext, picksToTry.length, proposalMetrics, 0);
            return { executed: false, proposal, reason: `Sentinel VETO (hard stop): ${sentinelDecision.reason}` };
          }

          continue; // Per-symbol veto — try next pick
        }

        // APPROVED — collect, don't break. Keep evaluating remaining picks.
        metric.sentinelApproved = true;
        proposalMetrics.push(metric);
        approvedProposals.push({ proposal, cachedTA });
        await this.log('sentinel',
          `✅ ${pick.symbol} APPROVED — added to candidate slate (${approvedProposals.length} so far)`,
          'info'
        );
      }

      // Phase 9 (0b) — Persist scan metrics for filter-pass-rate analysis
      await this.writeScanMetrics(userId, regimeContext, picksToTry.length, proposalMetrics, approvedProposals.length);

      // All picks evaluated. Process results.
      if (approvedProposals.length === 0) {
        return { executed: false, reason: `All ${picksToTry.length} picks vetoed: ${vetoReasons.join(' | ')}` };
      }

      if (requireApproval) {
        // Copilot mode: save EVERY approved proposal as pending
        for (const { proposal, cachedTA } of approvedProposals) {
          await this.savePendingApproval(proposal, cachedTA, userId, isPractice, regimeContext, pipelineProfitTarget);
        }
        await this.log('executor',
          `⏳ ${approvedProposals.length} APPROVAL CANDIDATE(S) AWAITING REVIEW: ${approvedProposals.map(a => a.proposal.symbol).join(', ')}`,
          'info'
        );
        return {
          executed: false,
          proposal: approvedProposals[0].proposal,
          reason: `${approvedProposals.length} trade${approvedProposals.length > 1 ? 's' : ''} pending user approval`
        };
      }

      // Sentry mode: auto-execute only the FIRST approved (highest Scout score)
      const first = approvedProposals[0];
      return await this.executeProposal(first.proposal, first.cachedTA, userId, isPractice, regimeContext, pipelineProfitTarget);

    } catch (err: any) {
      await this.log('system', `❌ Pipeline error: ${err.message}`, 'error');
      return { executed: false, reason: err.message };
    } finally {
      this.isRunning = false;
    }
  }

  // Save a Sentinel-approved proposal as a pending approval. Logs to diary,
  // sends Telegram notification. Called per-proposal in Copilot mode so multiple
  // candidates can surface from a single scan.
  private async savePendingApproval(
    proposal: TradeProposal,
    cachedTA: any,
    userId: string,
    isPractice: boolean,
    regimeContext: RegimeResult | null,
    pipelineProfitTarget: number
  ): Promise<void> {
    await this.log('executor',
      `⏳ AWAITING APPROVAL: ${proposal.side.toUpperCase()} ${proposal.symbol} @ $${proposal.entryPrice} | SL: $${proposal.stopLoss} | TP: $${proposal.takeProfit}`,
      'info'
    );

    await this.db.collection('trades').add({
      userId,
      symbol: proposal.symbol,
      side: proposal.side,
      quantity: proposal.quantity,
      entryPrice: proposal.entryPrice,
      stopLossPrice: proposal.stopLoss,
      takeProfitPrice: proposal.takeProfit,
      reasoning: proposal.reasoning,
      confidence: proposal.confidence,
      mode: isPractice ? 'paper' : 'live',
      isPractice: isPractice,
      status: 'pending',
      source: 'agent-swarm-auto',
      regimeAtEntry: regimeContext?.regime || 'unknown',
      profitTarget: pipelineProfitTarget > 0 ? pipelineProfitTarget : null,
      createdAt: new Date().toISOString(),
    });

    const pendingIndicators = this.extractIndicatorsFromTA(cachedTA);
    await this.tradeDiary.logDecision(userId, {
      timestamp: new Date().toISOString(),
      userId,
      symbol: proposal.symbol,
      side: proposal.side,
      decision: 'pending_approval',
      reasoning: `Auto-detected opportunity awaiting user approval: ${proposal.reasoning}`,
      indicators: pendingIndicators,
      regime: (regimeContext?.regime as TradeDiaryEntry['regime']) || 'unknown',
      riskCheck: { portfolioHeat: 0, openPositions: 0, dailyPnl: 0 },
      confidence: proposal.confidence,
    });

    try {
      const { sendTelegramNotification } = await import('./telegram.ts');
      const rrRatio = proposal.stopLoss > 0
        ? ((proposal.takeProfit - proposal.entryPrice) / (proposal.entryPrice - proposal.stopLoss)).toFixed(1)
        : '?';
      await sendTelegramNotification(this.db, userId,
        `⏳ <b>Trade Awaiting Your Approval</b>\n\n` +
        `Asset: <b>${proposal.symbol}</b>\n` +
        `Side: <b>${proposal.side.toUpperCase()}</b>\n` +
        `Entry: <b>$${proposal.entryPrice}</b>\n` +
        `Stop Loss: <b>$${proposal.stopLoss}</b>\n` +
        `Take Profit: <b>$${proposal.takeProfit}</b>\n` +
        `R/R: <b>${rrRatio}:1</b>\n` +
        `Confidence: <b>${proposal.confidence}%</b>\n` +
        `Regime: <b>${regimeContext?.regime || 'unknown'}</b>\n\n` +
        `<i>${proposal.reasoning}</i>\n\n` +
        `Open your dashboard to <b>Approve</b> or <b>Decline</b>.`
      );
    } catch {}
  }

  // Auto-execute a Sentinel-approved proposal in Sentry mode. Logs the diary
  // entry then runs the Executor. Returns the runPipeline-shaped result.
  private async executeProposal(
    proposal: TradeProposal,
    cachedTA: any,
    userId: string,
    isPractice: boolean,
    regimeContext: RegimeResult | null,
    pipelineProfitTarget: number
  ): Promise<{ executed: boolean; proposal?: TradeProposal; reason: string }> {
    const executedIndicators = this.extractIndicatorsFromTA(cachedTA);
    const diaryEntryId = await this.tradeDiary.logDecision(userId, {
      timestamp: new Date().toISOString(),
      userId,
      symbol: proposal.symbol,
      side: proposal.side,
      decision: 'executed',
      reasoning: proposal.reasoning,
      indicators: executedIndicators,
      regime: (regimeContext?.regime as TradeDiaryEntry['regime']) || 'unknown',
      riskCheck: { portfolioHeat: 0, openPositions: 0, dailyPnl: 0 },
      confidence: proposal.confidence,
    });

    await this.runExecutor(proposal, userId, isPractice, regimeContext || undefined, diaryEntryId, pipelineProfitTarget);

    return { executed: true, proposal, reason: 'Trade executed successfully' };
  }

  // Phase 9 (0b/0c) — Persist per-scan gate-by-gate metrics to Firestore for
  // filter-pass-rate analysis over time. Fire-and-forget; never blocks the
  // pipeline if the write fails.
  private async writeScanMetrics(
    userId: string,
    regimeContext: RegimeResult | null,
    picksEvaluated: number,
    proposals: ProposalMetric[],
    approvedCount: number
  ): Promise<void> {
    try {
      // Roll up gate-by-gate aggregates so dashboard queries don't need to
      // re-aggregate the array every read.
      //
      // Naming carefully: holisticConviction is the Holistic AGENT's "CONFIDENCE: NN"
      // output (advisory, no hard gate). proposalConfidence is the STRATEGIST's
      // number on the final trade plan (this is what Sentinel actually gates on
      // at the 60% floor). They are different measurements at different points
      // in the pipeline and they DISAGREE OFTEN. Separating them here so the
      // vetoBreakdown is internally consistent — and exposing the gap as its
      // own metric, since Holistic-vs-Strategist divergence is the real signal.
      const holisticPass = proposals.filter(p => (p.holisticConviction ?? 0) >= 60).length;
      const strategistPass = proposals.filter(p => (p.proposalConfidence ?? 0) >= 60).length;
      const holisticHighStrategistLow = proposals.filter(
        p => (p.holisticConviction ?? 0) >= 60 && (p.proposalConfidence ?? 100) < 60
      ).length;
      const aggregates = {
        proposalsGenerated: proposals.filter(p => p.organicRR !== null).length,
        passedOrganicRR: proposals.filter(p => p.wouldPassOrganicRR).length,
        passedHolisticConviction: holisticPass, // advisory, doesn't actually gate
        passedStrategistConfidence: strategistPass, // this is the real Sentinel gate
        holisticHighStrategistLow, // Strategist disagrees: Holistic >= 60 but Strategist < 60
        passedSentinel: proposals.filter(p => p.sentinelApproved).length,
        vetoBreakdown: proposals.reduce<Record<string, number>>((acc, p) => {
          if (p.vetoCategory) acc[p.vetoCategory] = (acc[p.vetoCategory] || 0) + 1;
          return acc;
        }, {}),
      };

      await this.db.collection('scanMetrics').add({
        userId,
        timestamp: new Date().toISOString(),
        regimeOverall: regimeContext?.regime || 'unknown',
        regimeConfidence: regimeContext?.confidence ?? null,
        picksEvaluated,
        approvedCount,
        proposals,
        aggregates,
      });
    } catch (err: any) {
      console.warn('[SWARM] writeScanMetrics failed (non-blocking):', err?.message);
    }
  }

  // ─── AGENT 1: SCOUT (DATA-DRIVEN + SCANNER-RANKED) ─────────

  private async runScout(targetSymbol?: string, regime?: string): Promise<{ opportunities: Array<{ symbol: string; reason: string; score: number }>; taReports?: Record<string, MultiTimeframeReport> }> {
    let scanPairs: string[];

    if (targetSymbol) {
      // If a target symbol is given, ONLY analyze that one
      scanPairs = [targetSymbol.includes('/') ? targetSymbol : targetSymbol.replace(/USDT$/, '/USDT')];
    } else {
      // FIX #4: Use MarketScanner rankings instead of hardcoded pairs
      try {
        const scanResult = await this.marketScanner.scan();
        if (scanResult.topOpportunities && scanResult.topOpportunities.length > 0) {
          // Pick top 5 ranked pairs from the scanner
          scanPairs = scanResult.topOpportunities.slice(0, 5).map((o: any) => o.symbol);
          await this.log('scout', `📡 Scanner ranked top 5: ${scanPairs.join(', ')}`, 'info');
        } else {
          // Fallback to defaults if scanner returns nothing
          scanPairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'];
          await this.log('scout', `📡 Scanner returned no results — using default pairs`, 'info');
        }
      } catch (err: any) {
        // Fallback to defaults if scanner fails
        scanPairs = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'];
        await this.log('scout', `⚠️ Scanner failed (${err.message}) — using default pairs`, 'info');
      }
    }

    await this.log('scout', targetSymbol
      ? `🎯 Targeted analysis on ${scanPairs[0]}...`
      : `🔍 Running TA on ${scanPairs.length} pairs...`, 'info');

    if (regime) {
      await this.log('scout', `⚖️ Regime-aware weights active: ${regime} — indicator scoring adjusted`, 'info');
    }

    const taReports: Record<string, MultiTimeframeReport> = {};
    const opportunities: Array<{ symbol: string; reason: string; score: number }> = [];

    // Run TA analysis on all pairs in parallel (instead of sequentially)
    const taResults = await Promise.allSettled(
      scanPairs.map(async (symbol) => {
        const report = await this.taEngine.analyzeSymbol(symbol, regime);
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

  private async runAnalyst(opportunity: { symbol: string; reason: string }, taReport?: MultiTimeframeReport, identity?: string): Promise<string> {
    await this.log('analyst', `📊 Deep analysis on ${opportunity.symbol} with real indicator data...`, 'info');

    // If we already have TA data from Scout, use it. Otherwise fetch fresh.
    let report = taReport;
    if (!report) {
      report = await this.taEngine.analyzeSymbol(opportunity.symbol);
    }

    const taSummary = this.taEngine.formatForAgent(report);

    // NEXUS Phase 5b — overlay TradingView native indicators if bridge is connected
    // AND TV is showing the same symbol we're analyzing. Falls back silently otherwise.
    let tvSection = '';
    try {
      const bridge = getTradingViewBridge();
      if (bridge.isConnected()) {
        const tv = await readTVIndicators(bridge);
        const wanted = opportunity.symbol.replace('/', '').toUpperCase();
        if (tv.symbol === wanted) {
          const parts: string[] = [];
          if (tv.rsi) parts.push(`RSI(${tv.rsi.period ?? '?'}) ${tv.rsi.value.toFixed(2)}${tv.rsi.signalMA != null ? ` (MA ${tv.rsi.signalMA.toFixed(2)})` : ''}`);
          if (tv.ichimoku) parts.push(`Ichimoku: Tenkan ${tv.ichimoku.tenkan?.toFixed(2)}, Kijun ${tv.ichimoku.kijun?.toFixed(2)}, Senkou A ${tv.ichimoku.senkouA?.toFixed(2)}, Senkou B ${tv.ichimoku.senkouB?.toFixed(2)}`);
          if (tv.supertrend) parts.push(`Supertrend ${tv.supertrend.value.toFixed(2)}`);
          if (parts.length > 0) {
            tvSection = `\n--- TRADINGVIEW LIVE READ (${tv.timeframe ?? '?'} ${tv.exchange ?? ''}) ---\n${parts.join('\n')}\n`;
            await this.log('analyst', `📊 TV indicators sourced (${parts.length} fields)`, 'info');
          }
        } else if (tv.symbol) {
          await this.log('analyst', `📊 TV chart on ${tv.symbol}, swarm analyzing ${wanted} — skipping TV overlay`, 'info');
        }
      }
    } catch (err: any) {
      // Degraded mode — log but don't block the swarm
      await this.log('analyst', `📊 TV indicator fetch failed (${err.message?.slice(0, 80)}); continuing with local TA only`, 'info');
    }

    const prompt = `${identity || ''}
You are Analyst, Jarvis's technical analysis agent. You have REAL indicator data (not guesses). Analyze this data and provide a trading assessment:

${taSummary}${tvSection}

Based on this REAL data, provide:
1. Your directional bias and why
2. Key support/resistance levels you can infer
3. Whether this is a good entry point RIGHT NOW
4. Risk level (low/medium/high)

Keep it under 100 words. Plain text only. Be specific — reference the actual numbers.`;

    try {
      const analysis = await generateTextForPurpose('analyst', prompt, { userId: this.currentUserId ?? undefined });
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

  // ─── AGENT 3: SCHOLAR (INTELLIGENCE-DRIVEN + TRADE LESSONS) ──

  private async runScholar(symbol: string, userId?: string, identity?: string): Promise<string> {
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

    // FIX #3: Query REAL user memory bank (where PostMortem stores trade lessons)
    // instead of the legacy vectorMemory collection
    let memoryContext = '';
    let tradeLessons = '';
    try {
      // First: get global knowledge base narratives
      const snapshot = await this.db.collection('vectorMemory')
        .where('userId', '==', 'global_knowledge_base')
        .limit(3)
        .get();
      if (!snapshot.empty) {
        memoryContext = snapshot.docs.map((d: any) => d.data().text).join(' | ');
      }

      // Second: query REAL trade lessons from user's MemoryManager (PostMortem writes here)
      if (userId) {
        const lessonQuery = `${symbol} trade lesson outcome grade`;
        const lessons = await this.memoryManager.recallMemories(userId, lessonQuery, 3);
        if (lessons.length > 0) {
          tradeLessons = lessons.join('\n');
          await this.log('scholar',
            `🧠 Found ${lessons.length} past trade lesson(s) for ${symbol} — injecting into analysis`,
            'info'
          );
        }
      }
    } catch (err: any) {
      console.error('[SCHOLAR] Memory recall error (non-blocking):', err.message);
    }

    const prompt = `${identity || ''}
You are Scholar, Jarvis's research and memory agent. You have access to REAL live market data and past trade lessons. Analyze ${symbol}:

${intelSummary}

Recent memory bank knowledge: ${memoryContext || 'No recent data.'}

${tradeLessons ? `PAST TRADE LESSONS (from PostMortem analysis):\n${tradeLessons}\n\nIMPORTANT: If past lessons show repeated failures on ${symbol} with similar setups, flag this clearly.` : ''}

Based on this REAL intelligence, provide:
1. Overall market sentiment and what it means for ${symbol}
2. Whether funding rates suggest a potential squeeze
3. Whether BTC dominance trend favors this trade
4. ${tradeLessons ? 'Whether past trade lessons suggest caution or confidence' : 'Your fundamental verdict'}: FAVORABLE or UNFAVORABLE

Keep under 100 words. Plain text. Reference the actual data.`;

    try {
      const research = await generateTextForPurpose('scholar', prompt, { userId: this.currentUserId ?? undefined });
      await this.log('scholar', `📚 ${research.slice(0, 150)}...`, 'analysis', { symbol, research });
      return `${research}\n\n--- RAW INTELLIGENCE ---\n${intelSummary}`;
    } catch (err) {
      // Even if AI fails, return the raw intel — it's still valuable
      await this.log('scholar', `📚 AI research failed, using raw intelligence feed`, 'analysis');
      return intelSummary || `${symbol} shows neutral fundamental outlook. No intelligence data available.`;
    }
  }

  // ─── AGENT 3.5: HOLISTIC (FULL-CONTEXT CONVICTION) ───────

  private async runHolistic(
    opportunity: { symbol: string; score: number },
    analystReport: string,
    scholarReport: string,
    cachedTA?: MultiTimeframeReport,
    regime?: RegimeResult | null,
    userId?: string,
    identity?: string
  ): Promise<string> {
    await this.log('holistic', `🧠 Full-context analysis for ${opportunity.symbol}...`, 'info');

    // 1. Build complete TA summary from cached report
    let taSummary = 'No TA data available.';
    if (cachedTA) {
      const lines = cachedTA.analyses.map(a => {
        const ind = a.indicators;
        return `${a.timeframe}: ${a.signal.bias} (${a.signal.confidence}%) | RSI=${ind.rsi?.toFixed(1) ?? 'N/A'} | MACD hist=${ind.macd?.histogram.toFixed(4) ?? 'N/A'} | EMA9=${ind.ema9?.toFixed(2) ?? 'N/A'} vs EMA21=${ind.ema21?.toFixed(2) ?? 'N/A'} | VWAP=${ind.vwap?.toFixed(2) ?? 'N/A'} (price ${ind.vwap ? (ind.price > ind.vwap ? 'ABOVE' : 'BELOW') : 'N/A'}) | OBV=${ind.obvSlope ?? 'N/A'} | ADX=${ind.adx?.toFixed(1) ?? 'N/A'} | ATR=${ind.atr?.toFixed(4) ?? 'N/A'}`;
      });
      taSummary = `Confluence: ${cachedTA.confluence.bias} (${cachedTA.confluence.confidence}%)\n${lines.join('\n')}`;
    }

    // 2. Portfolio state
    let portfolioState = 'Portfolio state unavailable.';
    try {
      const snapshot = await this.portfolioIntel.getSnapshot();
      const positions = snapshot.openPositions.map(p => `${p.symbol} ${p.side} @ $${p.entryPrice}`).join(', ') || 'None';
      portfolioState = `Open Positions: ${snapshot.openPositions.length} [${positions}] | Portfolio Heat: ${snapshot.totalHeat.toFixed(1)}% | Daily P&L: ${snapshot.dailyPnl.toFixed(2)}% | Circuit Breaker: ${snapshot.circuitBreakerActive ? 'ACTIVE' : 'off'}`;
    } catch {}

    // 3. Kelly sizing info
    let kellyInfo = 'Kelly data unavailable.';
    if (userId) {
      try {
        const kellyResult = await this.kellyCalculator.getOptimalPositionSize(
          userId, 100000, opportunity.symbol, opportunity.score
        );
        kellyInfo = `Kelly Recommendation: ${kellyResult.reason} | Fraction: ${(kellyResult.fraction * 100).toFixed(2)}% of capital`;
      } catch {}
    }

    // 4. Regime context
    const regimeInfo = regime
      ? `Market Regime: ${regime.regime} (${regime.confidence}%) | ADX: ${regime.adx} | ATR%: ${regime.atrPercent}% | Strategy: ${regime.recommendations.strategyType} | SL mult: ${regime.recommendations.stopLossMultiplier} | TP mult: ${regime.recommendations.takeProfitMultiplier}`
      : 'Regime: unknown';

    // 5. Recent diary entries (last 3 decisions for this symbol)
    let diaryContext = 'No prior decisions for this asset.';
    if (userId) {
      try {
        const entries = await this.tradeDiary.getEntries(userId, 3, opportunity.symbol);
        if (entries.length > 0) {
          diaryContext = entries.map((e, i) =>
            `${i + 1}. [${e.timestamp}] ${e.decision} | ${e.side} | Regime: ${e.regime} | Confidence: ${e.confidence} | Outcome: ${e.outcome ?? 'pending'} | Grade: ${e.grade ?? 'N/A'}`
          ).join('\n');
        }
      } catch {}
    }

    // 6. NEXUS Phase 6 — Gemini Vision read of the live TradingView chart.
    //    Option C: if bridge is connected, auto-navigate to the analyzed symbol
    //    (controlled by user's autoNavigateTV setting, default ON). Without
    //    auto-navigate, vision rarely fires — user has to manually keep TV
    //    on the same symbol the swarm picks.
    let visionContext = 'Visual chart read unavailable.';
    try {
      const bridge = getTradingViewBridge();
      if (bridge.isConnected()) {
        // Check user's auto-navigate preference (default ON)
        let autoNav = true;
        try {
          const rs = await this.db.collection('riskSettings').doc(this.currentUserId || '').get();
          if (rs.exists) {
            const data: any = rs.data() || {};
            if (data.autoNavigateTV === false) autoNav = false;
          }
        } catch {}

        const health = await bridge.healthCheck();
        const tvTicker = health.tabTitle?.match(/^([A-Z]+(?:\/[A-Z]+)?)\s/)?.[1];
        const wanted = opportunity.symbol.replace('/', '').toUpperCase();

        // If symbols don't match AND autoNav is on, flip the TV chart
        if (tvTicker !== wanted && autoNav) {
          try {
            await this.log('holistic', `👁️ Navigating TV to ${opportunity.symbol} for vision (was on ${tvTicker || 'unknown'})`, 'info');
            await bridge.setSymbol(opportunity.symbol);
            // Tiny pause so the chart finishes rendering before screenshot
            await new Promise(r => setTimeout(r, 1500));
          } catch (navErr: any) {
            await this.log('holistic', `👁️ Auto-navigate failed (${navErr?.message?.slice(0, 60)}); skipping vision`, 'info');
          }
        }

        // Re-check after potential navigation
        const finalHealth = autoNav && tvTicker !== wanted ? await bridge.healthCheck() : health;
        const finalTicker = finalHealth.tabTitle?.match(/^([A-Z]+(?:\/[A-Z]+)?)\s/)?.[1];

        if (finalTicker === wanted) {
          await this.log('holistic', `👁️ Running Gemini Vision on chart (~15s)...`, 'info');
          const v = await analyzeChart(bridge, { symbol: opportunity.symbol });
          // Phase 9 (#6) — distinguish "sanity-skipped" from "Vision ran and
          // returned neutral". Both yield bias=neutral / conviction=0, but
          // they're different conditions: the skip means we have NO Vision
          // signal at all (don't inject into Holistic prompt), the run-neutral
          // means Vision genuinely couldn't read the chart.
          if (v.parseError === 'sanity_skipped') {
            await this.log('holistic', `👁️ Vision SANITY-SKIPPED — TV bridge URL/symbol mismatch; Holistic will run without vision context.`, 'info', { vision: v });
            visionContext = null;
          } else {
            const patternStr = v.patterns.length > 0
              ? v.patterns.map(p => `${p.name} (${p.direction}, ${p.confidence})`).join('; ')
              : 'none clearly visible';
            visionContext = [
              `Bias: ${v.bias} (conviction ${v.conviction}%)`,
              `Structure: ${v.structure}`,
              `Patterns: ${patternStr}`,
              `Support: ${v.support.length > 0 ? '$' + v.support.join(', $') : 'n/a'}`,
              `Resistance: ${v.resistance.length > 0 ? '$' + v.resistance.join(', $') : 'n/a'}`,
              `Reasoning: ${v.reasoning}`,
            ].join('\n');
            await this.log('holistic', `👁️ Vision: ${v.bias} ${v.conviction}% | ${v.patterns.length} pattern(s)`, 'analysis', { vision: v });
          }
        } else if (finalTicker) {
          await this.log('holistic', `👁️ TV on ${finalTicker}, analyzing ${wanted} — auto-nav ${autoNav ? 'failed' : 'OFF'}, skipping vision`, 'info');
        }
      }
    } catch (err: any) {
      await this.log('holistic', `👁️ Vision unavailable (${err.message?.slice(0, 80)}); continuing without visual context`, 'info');
    }

    const prompt = `${identity || ''}
You are the Holistic Agent, Jarvis's full-context decision synthesizer. Unlike other agents who each see only a slice of data, YOU see EVERYTHING simultaneously — like a human trader looking at all their screens at once.

Your job: Produce a single, definitive conviction assessment. Should we trade ${opportunity.symbol}? How confident are you?

─── COMPLETE DATA DUMP ───

SCOUT SCORE: ${opportunity.score}/100

TECHNICAL ANALYSIS (Multi-Timeframe):
${taSummary}

VISUAL CHART READ (Gemini Vision on live TV chart):
${visionContext}

ANALYST VERDICT:
${analystReport.slice(0, 400)}

SCHOLAR RESEARCH (Fundamentals + Intel):
${scholarReport.slice(0, 400)}

PORTFOLIO STATE:
${portfolioState}

KELLY SIZING:
${kellyInfo}

MARKET REGIME:
${regimeInfo}

RECENT DECISIONS ON ${opportunity.symbol}:
${diaryContext}

─── YOUR TASK ───

Analyze ALL the data above holistically. Look for:
1. ALIGNMENT: Do TA, fundamentals, regime, and portfolio state ALL agree?
2. CONFLICTS: Any red flags or contradictions between data sources?
3. TIMING: Is this the right moment given regime and portfolio heat?
4. MEMORY: Do past decisions on this asset suggest caution?

Respond in this format (plain text, no markdown):
CONVICTION: [STRONG_BUY | BUY | WEAK_BUY | PASS | WEAK_SELL | SELL | STRONG_SELL]
CONFIDENCE: [0-100]
RATIONALE: [2-3 sentences explaining your holistic read. Be specific about what aligns and what conflicts.]
KEY_RISK: [The single biggest risk to this trade in one sentence.]`;

    try {
      const assessment = await generateTextForPurpose('holistic', prompt, { userId: this.currentUserId ?? undefined });
      
      // Parse conviction level for logging
      const convictionMatch = assessment.match(/CONVICTION:\s*(\S+)/i);
      const confidenceMatch = assessment.match(/CONFIDENCE:\s*(\d+)/i);
      const conviction = convictionMatch?.[1] || 'UNKNOWN';
      const confidence = confidenceMatch?.[1] || '?';

      await this.log('holistic',
        `🧠 Conviction: ${conviction} (${confidence}%) | ${assessment.slice(assessment.indexOf('RATIONALE:'), assessment.indexOf('RATIONALE:') + 150).replace('RATIONALE:', '').trim()}...`,
        'analysis', { symbol: opportunity.symbol, conviction, confidence, fullAssessment: assessment }
      );

      return assessment;
    } catch (err: any) {
      await this.log('holistic', `⚠️ Full-context analysis failed: ${err.message}. Proceeding without holistic assessment.`, 'info');
      return `CONVICTION: NEUTRAL\nCONFIDENCE: 50\nRATIONALE: Holistic analysis unavailable. Proceed with standard pipeline data.\nKEY_RISK: Decision made without full-context synthesis.`;
    }
  }

  // ─── AGENT 4: STRATEGIST (ATR + REGIME-AWARE SIZING) ────────

  private async runStrategist(
    opportunity: { symbol: string; score: number },
    analystReport: string,
    scholarReport: string,
    cachedTA?: MultiTimeframeReport,
    regime?: RegimeResult | null,
    identity?: string,
    holisticAssessment?: string
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

        // FIX #1: Apply regime-aware SL/TP multipliers
        const slMultiplier = regime?.recommendations.stopLossMultiplier || 1.0;
        const tpMultiplier = regime?.recommendations.takeProfitMultiplier || 1.0;

        atrData = `\nATR(14) 1H: $${atr1h.toFixed(4)} (${atrPercent}% of price)`;
        atrData += `\nCurrent Price: $${price}`;
        if (h4?.indicators.atr) {
          atrData += `\nATR(14) 4H: $${h4.indicators.atr.toFixed(4)}`;
        }
        atrData += `\n\nSL: Place stop-loss at ${(1.5 * slMultiplier).toFixed(1)}x ATR(1H) from entry.`;
        atrData += `\n\nTAKE PROFIT (set this as \`takeProfit\` in your JSON):`;
        atrData += `\nUse ${(3.0 * tpMultiplier).toFixed(1)}x ATR — the "let it run" target.`;
        atrData += `\n(Note: Sentry will fire a 50% partial close automatically when profit hits the user's profitTarget — you do NOT need a separate TP1. Set the final \`takeProfit\` at the 3x ATR target.)`;
        atrData += `\n\nR/R MINIMUM: Your proposal MUST satisfy (TP - entry) / (entry - SL) >= 1.5.`;
        atrData += `\nIf you cannot construct a setup that meets this floor with the current indicators, set confidence to 0 and Sentinel will skip the trade. Do NOT propose a sub-1.5:1 R/R trade — it will be auto-vetoed.`;
        atrData += `\n\nSIZING RULE: Risk max 2% of $100,000 capital = $2,000 risk per trade.`;
        atrData += `\nPosition size = $2,000 / (${(1.5 * slMultiplier).toFixed(1)} × ATR) = quantity in base asset.`;

        if (regime) {
          atrData += `\n\nMARKET REGIME: ${regime.regime} (${regime.confidence}% confidence)`;
          atrData += `\nStrategy type: ${regime.recommendations.strategyType}`;
          atrData += `\nSL/TP adjusted by regime: SL×${slMultiplier}, TP×${tpMultiplier}`;
        }
      }
    } catch {}

    // Determine TA direction from the report confluence
    let taDirection = 'buy';
    try {
      const report = cachedTA || await this.taEngine.analyzeSymbol(opportunity.symbol);
      const bias = report.confluence?.bias || 'buy';
      taDirection = (bias === 'buy' || bias === 'strong_buy') ? 'buy' : (bias === 'sell' || bias === 'strong_sell') ? 'sell' : 'buy';
    } catch {}

    // Load user's trade parameters from Firestore (used by both AI prompt and deterministic fallback)
    let userCapital = 15000; // Default $15K
    let userProfitTarget = 0; // 0 = use ATR-based TP
    try {
      const settingsDoc = await this.db.collection('riskSettings').doc(this.currentUserId || '').get();
      if (settingsDoc.exists) {
        const s = settingsDoc.data();
        if (s?.capitalPerTrade && s.capitalPerTrade > 0) userCapital = s.capitalPerTrade;
        if (s?.profitTarget && s.profitTarget > 0) userProfitTarget = s.profitTarget;
      }
    } catch {}

    const prompt = `${identity || ''}
You are Strategist, Jarvis's trade planning agent with ATR-based risk management.

Symbol: ${opportunity.symbol}
Scout Score: ${opportunity.score}/100
Scout TA Direction: ${taDirection.toUpperCase()} (${opportunity.score}% confidence across timeframes)
Technical Analysis: ${analystReport.slice(0, 500)}
Fundamental Research: ${scholarReport.slice(0, 300)}
${holisticAssessment ? `\nHOLISTIC AGENT ASSESSMENT (full-context conviction):\n${holisticAssessment.slice(0, 400)}\n` : ''}
${atrData}

Create a trade proposal in this EXACT JSON format (no markdown):
{"symbol":"${opportunity.symbol}","side":"buy","quantity":0.01,"entryPrice":0,"stopLoss":0,"takeProfit":0,"reasoning":"brief reason","confidence":75,"riskPercent":2}

USER TRADE PARAMETERS:
- Capital Per Trade: $${userCapital}
- Profit Target: $${userProfitTarget > 0 ? userProfitTarget : 'ATR-based (no fixed target)'}

Rules:
- CRITICAL: The trade direction (side) MUST follow the Scout TA Direction above. If Scout says BUY, you MUST propose a BUY. If Scout says SELL, propose a SELL. The regime strategy (mean_reversion, momentum) adjusts SL/TP sizing only — it does NOT flip the trade direction.
- Use ATR data for SL/TP if available. Follow the SL/TP RULES above (regime-adjusted).
- **Minimum 1.5:1 R/R ratio.** A 1:1 R/R is a coin-flip with extra steps — at our 56% win rate that's a slow bleed.
- Position size: Use the user's Capital Per Trade ($${userCapital}) divided by current price to calculate quantity.
- **Confidence 0-100 based on FULL alignment** — TA + fundamentals + holistic + past lessons. Skip marginal setups by setting confidence below 60 (Sentinel will veto, no harm done). Forcing a trade you don't believe in is how losing systems are born. The bar is "would I bet my own money on this?" — if no, drop confidence.
- If the Holistic Agent says WEAK, PASS, or shows hesitation → confidence MUST be < 60.
- If past lessons (Scholar's report) show repeated failures on this symbol with similar setup → confidence MUST be < 60.
- Set REAL current prices, not 0.`;

    try {
      const response = await generateTextForPurpose('strategist', prompt, { userId: this.currentUserId ?? undefined });
      const cleaned = response.replace(/```json?|```/g, '').trim();
      const proposal = JSON.parse(cleaned) as TradeProposal;

      // ─── HARD OVERRIDES — AI cannot be trusted for direction & sizing ───
      // Force direction to match Scout TA (AI keeps ignoring the prompt instruction)
      if (proposal.side !== taDirection) {
        await this.log('strategist', `⚠️ AI proposed ${proposal.side.toUpperCase()} but Scout TA says ${taDirection.toUpperCase()} — overriding direction to ${taDirection.toUpperCase()}`, 'info');
        // Swap SL and TP when flipping direction
        const oldSL = proposal.stopLoss;
        const oldTP = proposal.takeProfit;
        proposal.side = taDirection as 'buy' | 'sell';
        proposal.stopLoss = oldTP < proposal.entryPrice ? oldTP : oldSL;
        proposal.takeProfit = oldTP > proposal.entryPrice ? oldTP : oldSL;
        // Recalculate SL/TP based on same distance but correct direction
        const slDist = Math.abs(proposal.entryPrice - oldSL);
        const tpDist = Math.abs(oldTP - proposal.entryPrice);
        if (taDirection === 'buy') {
          proposal.stopLoss = parseFloat((proposal.entryPrice - slDist).toFixed(4));
          proposal.takeProfit = parseFloat((proposal.entryPrice + tpDist).toFixed(4));
        } else {
          proposal.stopLoss = parseFloat((proposal.entryPrice + slDist).toFixed(4));
          proposal.takeProfit = parseFloat((proposal.entryPrice - tpDist).toFixed(4));
        }
      }

      // Force quantity to use user's capital per trade
      const correctQty = parseFloat((userCapital / proposal.entryPrice).toFixed(4));
      if (Math.abs(proposal.quantity - correctQty) / correctQty > 0.1) {
        await this.log('strategist', `⚠️ AI used qty ${proposal.quantity} but user capital is $${userCapital} → correcting to ${correctQty}`, 'info');
        proposal.quantity = correctQty;
      }

      // Phase 3 fix — DON'T override AI's low confidence with Scout's surface-level TA score.
      // Scout sees price+indicators; the AI Strategist sees regime, fundamentals, past lessons.
      // When the AI says 35%, that's a meaningful "I don't like this trade" — letting Sentinel
      // veto it (min 60%) is correct. We only repair clearly-broken AI output (null/NaN/0).
      if (proposal.confidence === undefined || proposal.confidence === null || Number.isNaN(proposal.confidence) || proposal.confidence === 0) {
        const repaired = Math.min(opportunity.score, 50); // Conservative repair, NOT inflation
        await this.log('strategist', `⚠️ AI returned invalid confidence (${proposal.confidence}) — repairing to ${repaired}% from Scout score`, 'info');
        proposal.confidence = repaired;
      } else if (proposal.confidence < 50 && opportunity.score >= 80) {
        // Edge case: log the divergence but TRUST THE AI. This is the signal Karthick was missing.
        await this.log('strategist', `🤔 Scout ${opportunity.score}% but AI Strategist only ${proposal.confidence}% — trusting AI's full-context view (Sentinel will gate at 60%)`, 'info');
      }

      // Phase 9 (0b/#4) — Capture organic R/R. The previous auto-widen block
      // was deleted (Phase 7 Fix C) — it was gaming the 1.5:1 gate by inflating
      // TP rather than rejecting weak setups. Now sub-1.5:1 proposals fall
      // through to Sentinel, which vetoes them cleanly; Phase 8's multi-pick
      // loop then tries the next pick. Both AI peer reviewers (Gemini + Claude)
      // independently flagged the auto-widen as the worst kind of fix.
      const slDist = Math.abs(proposal.entryPrice - proposal.stopLoss);
      const tpDist = Math.abs(proposal.takeProfit - proposal.entryPrice);
      const rr = slDist > 0 ? tpDist / slDist : 0;
      proposal.organicRR = parseFloat(rr.toFixed(2));
      proposal.wouldPassOrganicRR = rr >= 1.5;
      if (rr < 1.5 && slDist > 0) {
        await this.log('strategist',
          `⚠️ Strategist proposed sub-1.5:1 R/R (${rr.toFixed(2)}:1) — Sentinel will veto, falling through to next pick in the loop.`,
          'info'
        );
      }

      await this.log('strategist',
        `🎯 PROPOSAL: ${proposal.side.toUpperCase()} ${proposal.quantity} ${proposal.symbol} @ $${proposal.entryPrice} | SL: $${proposal.stopLoss} | TP: $${proposal.takeProfit} | Risk: ${proposal.riskPercent}% | Confidence: ${proposal.confidence}%`,
        'action', proposal
      );

      return proposal;
    } catch (err) {
      // LLM failed (rate limit, etc.) — build a DETERMINISTIC fallback plan from raw TA data
      await this.log('strategist', '⚠️ AI unavailable — building deterministic trade plan from TA data...', 'info');

      try {
        const report = cachedTA || await this.taEngine.analyzeSymbol(opportunity.symbol);
        const h1 = report.analyses.find(a => a.timeframe === '1H');

        if (h1?.indicators.atr && h1.indicators.price) {
          const price = h1.indicators.price;
          const atr = h1.indicators.atr;
          const slMultiplier = regime?.recommendations.stopLossMultiplier || 1.0;
          const tpMultiplier = regime?.recommendations.takeProfitMultiplier || 1.0;

          // Determine side from confluence
          const isBullish = report.confluence.bias === 'buy' || report.confluence.bias === 'strong_buy';
          const side = isBullish ? 'buy' : 'sell';

          // ATR-based SL/TP with minimum 1.5:1 R/R enforcement
          const slDistance = atr * 1.5 * slMultiplier;
          const rawTpDistance = atr * 3.0 * tpMultiplier;
          // Ensure TP distance is at least 1.0× SL distance (Sentinel minimum)
          const tpDistance = Math.max(rawTpDistance, slDistance * 1.05);

          let stopLoss = side === 'buy'
            ? parseFloat((price - slDistance).toFixed(4))
            : parseFloat((price + slDistance).toFixed(4));
          let takeProfit = side === 'buy'
            ? parseFloat((price + tpDistance).toFixed(4))
            : parseFloat((price - tpDistance).toFixed(4));

          // Position sizing: userCapital and userProfitTarget already loaded above

          // Quantity from user's capital allocation
          let quantity = parseFloat((userCapital / price).toFixed(4));

          // If user set a profit target, override TP to hit that exact $ amount
          if (userProfitTarget > 0) {
            const tpPerUnit = userProfitTarget / quantity;
            const userTpDistance = tpPerUnit;
            // Only override if user's TP is tighter than ATR TP (take profit sooner)
            // but still maintain minimum R/R of 1.0:1
            const minTpForRR = slDistance * 1.05;
            if (userTpDistance >= minTpForRR) {
              if (side === 'buy') {
                takeProfit = parseFloat((price + userTpDistance).toFixed(4));
              } else {
                takeProfit = parseFloat((price - userTpDistance).toFixed(4));
              }
            }
          }

          // Confidence from confluence
          const confidence = Math.min(80, report.confluence.confidence);

          const fallbackProposal: TradeProposal = {
            symbol: opportunity.symbol,
            side: side as 'buy' | 'sell',
            quantity,
            entryPrice: parseFloat(price.toFixed(4)),
            stopLoss,
            takeProfit,
            reasoning: `[DETERMINISTIC] ${report.confluence.bias} confluence (${report.confluence.confidence}%). ATR-based SL=${slDistance.toFixed(4)}, TP=${tpDistance.toFixed(4)}. Built without AI — pure math from TA data.`,
            confidence,
            riskPercent: 2,
          };

          await this.log('strategist',
            `🎯 FALLBACK PROPOSAL: ${fallbackProposal.side.toUpperCase()} ${fallbackProposal.quantity} ${fallbackProposal.symbol} @ $${fallbackProposal.entryPrice} | SL: $${fallbackProposal.stopLoss} | TP: $${fallbackProposal.takeProfit} | Confidence: ${fallbackProposal.confidence}% [DETERMINISTIC]`,
            'action', fallbackProposal
          );

          return fallbackProposal;
        }
      } catch (fallbackErr: any) {
        await this.log('strategist', `⚠️ Deterministic fallback also failed: ${fallbackErr.message}`, 'error');
      }

      await this.log('strategist', '⚠️ Failed to build a structured trade plan.', 'error');
      return null;
    }
  }

  // ─── AGENT 5: SENTINEL (REGIME-AWARE) ───────────────────────

  private async runSentinel(
    proposal: TradeProposal,
    isPractice: boolean,
    regime?: RegimeResult | null,
    identity?: string,
    userId?: string
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
      const corrCheck = await this.correlationGuard.checkTradeAllowed(proposal.symbol, proposal.side, userId);
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
    // Phase 3 — raised from 50% to 60%. Track record showed 55-65% is the
    // "honest weak" zone where Holistic + Strategist consistently flag uncertainty.
    // Skipping these marginal setups is what experienced traders do.
    if (proposal.confidence < 60) {
      hardChecks.push(`Confidence too low: ${proposal.confidence}% (min 60%)`);
    }
    if (proposal.stopLoss <= 0 || proposal.takeProfit <= 0) {
      hardChecks.push('Missing stop-loss or take-profit');
    }

    // Phase 3 — symmetric R/R floor at 1.5:1 for BOTH sides. Previously BUY was
    // 1.0:1 (way too lenient — track record showed the 1:1 scalps dominated and
    // averaged +0.25R per win). 1.5:1 forces the swarm to find setups with real
    // edge, and 67% of past wins were already at >1.5R so this barely cuts winners.
    if (proposal.side === 'buy') {
      const risk = proposal.entryPrice - proposal.stopLoss;
      const reward = proposal.takeProfit - proposal.entryPrice;
      const rr = risk > 0 ? Math.round((reward / risk) * 100) / 100 : 0;
      if (risk > 0 && rr < 1.5) {
        hardChecks.push(`Poor R/R ratio: ${rr.toFixed(1)}:1 (min 1.5:1)`);
      }
    } else if (proposal.side === 'sell') {
      const risk = proposal.stopLoss - proposal.entryPrice;
      const reward = proposal.entryPrice - proposal.takeProfit;
      const rr = risk > 0 ? Math.round((reward / risk) * 100) / 100 : 0;
      if (risk > 0 && rr < 1.5) {
        hardChecks.push(`Poor R/R ratio: ${rr.toFixed(1)}:1 (min 1.5:1)`);
      }
    }

    // Phase 9 (#10) — Bleed-hour filter DEMOTED from hard gate to advisory log.
    // Original rule (5 PM - 12 AM IST requires ≥75% confidence) was derived
    // from ~45 trades in that window — too small a sample per (hour × symbol
    // × regime) bucket to justify a hard veto. Claude's peer review flagged
    // this as overfitting. Default is now OFF; if a user explicitly opts in,
    // it emits an advisory log only — no hardChecks push.
    try {
      const settingsDoc = await this.db.collection('riskSettings').doc(userId || '').get();
      const settings: any = settingsDoc.exists ? settingsDoc.data() : {};
      const enabled = settings.bleedHoursEnabled === true; // default OFF now
      if (enabled) {
        const startIST = Number.isFinite(settings.bleedStartHourIST) ? settings.bleedStartHourIST : 17;
        const endIST = Number.isFinite(settings.bleedEndHourIST) ? settings.bleedEndHourIST : 0;
        const floor = Number.isFinite(settings.bleedConfidenceFloor) ? settings.bleedConfidenceFloor : 75;
        const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
        const istHour = new Date(istMs).getUTCHours();
        const inWindow = startIST <= endIST
          ? (istHour >= startIST && istHour <= endIST)
          : (istHour >= startIST || istHour <= endIST);
        if (inWindow && proposal.confidence < floor) {
          const fmtH = (h: number) => {
            const period = h < 12 ? 'AM' : 'PM';
            const h12 = h % 12 === 0 ? 12 : h % 12;
            return `${h12} ${period}`;
          };
          await this.log('sentinel',
            `📒 Advisory only (not a veto): in bleed window ${fmtH(istHour)} IST (set ${fmtH(startIST)}-${fmtH(endIST)}), confidence ${proposal.confidence}% below ${floor}%. User opted into this advisory.`,
            'info'
          );
        }
      }
    } catch (err: any) {
      console.error('[SENTINEL] Bleed-hour advisory failed (non-blocking):', err?.message);
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

      // VETO only if the pattern has enough data AND is historically a consistent loser
      if (btResult.verdict === 'failing' && btResult.totalTrades >= 5) {
        const reason = `VETO (Backtest) — This pattern has historically FAILED on ${proposal.symbol}: ${btResult.winRate.toFixed(1)}% win rate, ${btResult.pnlPercent.toFixed(1)}% P&L over ${btResult.totalTrades} trades.`;
        await this.log('sentinel', `🚫 ${reason}`, 'veto');
        return { approved: false, reason };
      }
    } catch (err: any) {
      // Backtest failure is non-blocking — log it but continue
      console.error('[SENTINEL] Backtest validation error:', err.message);
      await this.log('sentinel', `⚠️ Historical validation skipped: ${err.message}`, 'info');
    }

    // Regime info excluded from Sentinel — regime influences Strategist SL/TP only, not Sentinel's approval decision
    const regimeInfo = '';

    // LESSONS LEARNED INJECTION — Query past failures for this symbol
    let failureContext = '';
    if (userId) {
      try {
        const failureHistory = await this.tradeDiary.buildFailureContext(userId, proposal.symbol);
        if (failureHistory) {
          failureContext = `\n\n${failureHistory}`;
          await this.log('sentinel', `📚 Injected ${failureHistory.split('\n').length - 2} past failure(s) for ${proposal.symbol} into risk assessment`, 'info');
        }
      } catch (err: any) {
        console.error('[SENTINEL] Diary injection error:', err.message);
      }
    }

    // AI assessment — focused on RISK MANAGEMENT only, not trade direction
    const prompt = `${identity || ''}
You are Sentinel, Jarvis's risk guardian agent. Review this trade proposal and respond with ONLY "APPROVED" or "REJECTED: reason".

${proposal.side.toUpperCase()} ${proposal.quantity} ${proposal.symbol}
Entry: $${proposal.entryPrice} | SL: $${proposal.stopLoss} | TP: $${proposal.takeProfit}
Risk: ${proposal.riskPercent}% | Confidence: ${proposal.confidence}%
Mode: ${isPractice ? 'PAPER TRADING' : 'REAL MONEY'}
Reasoning: ${proposal.reasoning}${failureContext}

Your job is to verify RISK MANAGEMENT only:
- Is the stop-loss placed at a reasonable level (not too tight, not too far)?
- Is position sizing appropriate (risk % not too high)?
- Does the trade have a valid stop-loss and take-profit?
- Are there any past failures on this symbol that suggest caution?

Do NOT reject trades based on:
- Market regime or overall market direction (the Scout and Analyst already evaluated this)
- Whether the trade is "counter-trend" (direction was chosen by the TA pipeline)
- General market fear/greed sentiment

Approve if the risk parameters are sound.`;

    try {
      const decision = await generateTextForPurpose('sentinel', prompt, { userId: this.currentUserId ?? undefined });
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

  // ─── AGENT 6: EXECUTOR (KELLY + REGIME SIZING) ──────────────

  private async runExecutor(proposal: TradeProposal, userId: string, isPractice: boolean, regime?: RegimeResult | null, diaryEntryId?: string, profitTarget?: number | null): Promise<void> {
    const mode = isPractice ? 'PAPER' : 'LIVE';

    // ─── FIX #2: REAL KELLY CRITERION POSITION SIZING ─────
    // Use the actual KellyCalculator engine instead of hardcoded brackets
    let kellyMultiplier = 0.5; // conservative default
    let kellySizeReason = 'default (insufficient data)';
    try {
      const kellyResult = await this.kellyCalculator.getOptimalPositionSize(
        userId,
        100000, // $100K capital base
        proposal.symbol,
        proposal.confidence
      );
      // Convert Kelly's recommended fraction to a multiplier relative to the proposal's base quantity
      // Kelly returns a fraction of capital; we use it as a multiplier for the AI-proposed quantity
      kellyMultiplier = Math.max(0.25, Math.min(1.5, kellyResult.fraction * 50)); // Scale fraction to 0.25-1.5x
      kellySizeReason = kellyResult.reason;
      await this.log('executor', `🎲 Kelly sizing: ${kellySizeReason}`, 'info');
    } catch (err: any) {
      // Fallback to confidence-based brackets if Kelly fails
      if (proposal.confidence >= 90) kellyMultiplier = 1.25;
      else if (proposal.confidence >= 85) kellyMultiplier = 1.0;
      else if (proposal.confidence >= 80) kellyMultiplier = 0.75;
      else kellyMultiplier = 0.5;
      await this.log('executor', `🎲 Kelly fallback: ${proposal.confidence}% confidence → ${kellyMultiplier * 100}% of base size`, 'info');
    }

    // FIX #1: Apply regime position size multiplier
    const regimeMultiplier = regime?.recommendations.positionSizeMultiplier || 1.0;
    if (regimeMultiplier !== 1.0) {
      await this.log('executor', `📊 Regime sizing: ${regime?.regime} → ${(regimeMultiplier * 100).toFixed(0)}% position multiplier`, 'info');
    }

    // Apply Time-of-Day session quality multiplier
    const sessionInfo = this.marketScanner.getSessionQuality();

    // Combined multiplier: Kelly × Regime × Session Quality
    const combinedMultiplier = kellyMultiplier * regimeMultiplier * sessionInfo.multiplier;
    const adjustedQuantity = parseFloat((proposal.quantity * combinedMultiplier).toFixed(8));

    if (sessionInfo.multiplier < 1.0) {
      await this.log('executor', `⏰ Session: ${sessionInfo.session} (${sessionInfo.multiplier * 100}% size) — ${sessionInfo.description}`, 'info');
    }
    await this.log('executor', `📐 Final size: ${(combinedMultiplier * 100).toFixed(0)}% of base (Kelly ${(kellyMultiplier * 100).toFixed(0)}% × Regime ${(regimeMultiplier * 100).toFixed(0)}% × Session ${sessionInfo.multiplier * 100}%)`, 'info');

    await this.log('executor', `⚡ Executing: ${proposal.side.toUpperCase()} ${adjustedQuantity} ${proposal.symbol} (${mode})`, 'execution');

    try {
      // Save trade to Firestore
      const tradeRef = await this.db.collection('trades').add({
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
        isPractice: isPractice,
        status: 'open',
        source: 'agent-swarm',
        sessionQuality: sessionInfo.session,
        sizeMultiplier: combinedMultiplier,
        regimeAtEntry: regime?.regime || 'unknown',
        kellyFraction: kellySizeReason,
        profitTarget: profitTarget && profitTarget > 0 ? profitTarget : null,
        createdAt: new Date().toISOString(),
      });

      // DIARY: Link the executed trade to the diary entry
      if (diaryEntryId && tradeRef.id) {
        await this.tradeDiary.updateEntryWithTrade(userId, diaryEntryId, tradeRef.id);
      }

      await this.log('executor',
        `✅ Order placed: ${proposal.side.toUpperCase()} ${adjustedQuantity} ${proposal.symbol} @ $${proposal.entryPrice} (${mode} | Regime: ${regime?.regime || 'N/A'} | Session: ${sessionInfo.session})`,
        'execution', { ...proposal, adjustedQuantity, session: sessionInfo, regime: regime?.regime }
      );
    } catch (err: any) {
      await this.log('executor', `❌ Execution failed: ${err.message}`, 'error');
    }
  }

  /**
   * Extract indicator snapshot from cached TA report for diary logging
   */
  private extractIndicatorsFromTA(cachedTA?: MultiTimeframeReport): TradeDiaryEntry['indicators'] {
    const defaults: TradeDiaryEntry['indicators'] = {
      price: 0, rsi: null, macdHistogram: null, ema9: null, ema21: null,
      vwap: null, obvSlope: null, adx: null, atr: null,
    };
    if (!cachedTA) return defaults;

    const h1 = cachedTA.analyses.find(a => a.timeframe === '1H');
    if (!h1) return defaults;

    const ind = h1.indicators;
    return {
      price: ind.price,
      rsi: ind.rsi,
      macdHistogram: ind.macd?.histogram ?? null,
      ema9: ind.ema9,
      ema21: ind.ema21,
      vwap: ind.vwap,
      obvSlope: ind.obvSlope,
      adx: ind.adx,
      atr: ind.atr,
    };
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

  // ─── JARVIS IDENTITY SYSTEM ─────────────────────────────────
  // Builds a self-awareness context that is prepended to every AI agent's prompt.
  // This makes every agent aware of Jarvis's full architecture, current state,
  // capabilities, and past performance — creating a unified "self" across all agents.

  private async buildIdentityContext(
    userId: string,
    isPractice: boolean,
    regime: RegimeResult | null
  ): Promise<string> {
    const lines: string[] = [];

    // ── Core Identity ──
    lines.push('=== JARVIS IDENTITY ===');
    lines.push('You are JARVIS — an autonomous AI-powered crypto trading system.');
    lines.push('You are NOT a generic chatbot. You are a specialized trading AI with real engines, real data, and real consequences.');
    lines.push(`Mode: ${isPractice ? 'PAPER TRADING (learning phase)' : 'LIVE TRADING (real money)'}`);
    lines.push('');

    // ── Architecture Awareness ──
    lines.push('YOUR ARCHITECTURE (7 agents working as a unified mind):');
    lines.push('  Regime → Scout → Analyst + Scholar (parallel) → Strategist → Sentinel → Executor');
    lines.push('  • RegimeDetector: Classifies market as trending/ranging/volatile, gates trades');
    lines.push('  • MarketScanner: Ranks 20 coins by TA + AI score every 3 minutes');
    lines.push('  • TechnicalAnalysis: RSI, MACD, EMA, ATR, Bollinger Bands across 1H/4H/1D');
    lines.push('  • KellyCalculator: Math-based position sizing from your actual win rate');
    lines.push('  • MemoryManager: Stores and recalls past trade lessons (PostMortem writes here)');
    lines.push('  • ConfidenceEngine: Tracks your performance score for live-trading readiness');
    lines.push('  • PortfolioIntelligence: Checks correlation, heat, circuit breakers');
    lines.push('  • CorrelationGuard: Prevents double-betting on correlated assets');
    lines.push('  • BacktestEngine: Validates patterns against historical data before executing');
    lines.push('');

    // ── Current Market Regime ──
    if (regime) {
      lines.push('CURRENT MARKET REGIME:');
      lines.push(`  Classification: ${regime.regime.toUpperCase()} (${regime.confidence.toFixed(0)}% confidence)`);
      lines.push(`  ADX: ${regime.adx.toFixed(1)} (${regime.adx >= 25 ? 'strong trend' : regime.adx >= 20 ? 'moderate' : 'weak/no trend'})`);
      lines.push(`  ATR: ${regime.atrPercent.toFixed(2)}% (${regime.atrPercent >= 3 ? 'high volatility' : regime.atrPercent >= 1.5 ? 'moderate' : 'low volatility'})`);
      lines.push(`  EMA Alignment: ${regime.emaAlignment}`);
      lines.push(`  Recommended Strategy: ${regime.recommendations.strategyType}`);
      lines.push(`  Position Size Multiplier: ${regime.recommendations.positionSizeMultiplier}x`);
      lines.push(`  SL Multiplier: ${regime.recommendations.stopLossMultiplier}x | TP Multiplier: ${regime.recommendations.takeProfitMultiplier}x`);
      lines.push('');
    }

    // ── Kelly Performance Stats ──
    try {
      const kellyReport = await this.kellyCalculator.getKellyReport(userId);
      if (kellyReport?.overall?.totalTrades > 0) {
        const o = kellyReport.overall;
        lines.push('YOUR PERFORMANCE (Kelly Criterion):');
        lines.push(`  Total Trades: ${o.totalTrades} | Wins: ${o.wins} | Losses: ${o.losses}`);
        lines.push(`  Win Rate: ${(o.winRate * 100).toFixed(1)}%`);
        lines.push(`  Payoff Ratio: ${o.payoffRatio?.toFixed(2)}x (avg win / avg loss)`);
        lines.push(`  Edge per Trade: $${o.edge?.toFixed(2)}`);
        lines.push(`  Recommended Risk: ${o.recommendedRiskPercent}% per trade (Half-Kelly)`);
        if (o.streakData?.currentStreak) {
          lines.push(`  Current Streak: ${o.streakData.currentStreak > 0 ? `${o.streakData.currentStreak} wins 🔥` : `${Math.abs(o.streakData.currentStreak)} losses ❄️`}`);
        }
        lines.push('');
      }
    } catch {
      // Kelly data unavailable — skip silently
    }

    // ── Confidence Score ──
    try {
      const confSnap = await this.db.collection('confidenceReports')
        .where('userId', '==', userId)
        .limit(1)
        .get();
      if (!confSnap.empty) {
        const conf = confSnap.docs[0].data();
        if (conf.report?.score !== undefined) {
          lines.push(`CONFIDENCE SCORE: ${conf.report.score}% ${conf.report.isReadyForLive ? '(LIVE READY ✅)' : '(still learning)'}`);
          lines.push(`  ${conf.report.message || ''}`);
          lines.push('');
        }
      }
    } catch {
      // Confidence data unavailable — skip silently
    }

    // ── Market Scanner Status (LIVE) ──
    try {
      const lastScan = this.marketScanner.getLastScan();
      if (lastScan) {
        lines.push('MARKET SCANNER (last scan):');
        lines.push(`  Sentiment: ${lastScan.marketSentiment} | Bullish: ${lastScan.bullish} | Bearish: ${lastScan.bearish} | Neutral: ${lastScan.neutral}`);
        if (lastScan.topOpportunities?.length > 0) {
          const topCoins = lastScan.topOpportunities.slice(0, 5)
            .map(c => `${c.symbol} (score: ${c.score}, RSI: ${c.rsi?.toFixed(0) || '?'})`)
            .join(', ');
          lines.push(`  Top Opportunities: ${topCoins}`);
        }
        lines.push('');
      }
    } catch {
      // Scanner data unavailable — skip silently
    }

    // ── Portfolio Intelligence (LIVE) ──
    try {
      const portfolio = await this.portfolioIntel.getSnapshot();
      lines.push('PORTFOLIO STATUS:');
      lines.push(`  Open Positions: ${portfolio.openPositions.length}/5`);
      lines.push(`  Portfolio Heat: ${portfolio.totalHeat.toFixed(1)}%/6% max`);
      lines.push(`  Daily P&L: ${portfolio.dailyPnl >= 0 ? '+' : ''}${portfolio.dailyPnl.toFixed(2)}%`);
      lines.push(`  Circuit Breaker: ${portfolio.circuitBreakerActive ? '⛔ ACTIVE — trading halted' : '✅ Normal'}`);
      if (portfolio.openPositions.length > 0) {
        const positions = portfolio.openPositions
          .map(p => `${p.symbol} (${p.side}, ${p.sector})`)
          .join(', ');
        lines.push(`  Current Trades: ${positions}`);
        const sectors = Object.entries(portfolio.sectorExposure)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        lines.push(`  Sector Exposure: ${sectors}`);
      }
      lines.push('');
    } catch {
      // Portfolio data unavailable — skip silently
    }

    // ── Correlation Guard (LIVE) ──
    try {
      const openTradesSnap = await this.db.collection('trades')
        .where('status', '==', 'open')
        .get();
      if (!openTradesSnap.empty) {
        const occupiedGroups = new Set<string>();
        for (const doc of openTradesSnap.docs) {
          const trade = doc.data();
          const group = this.correlationGuard.getGroup(trade.symbol);
          if (group) {
            occupiedGroups.add(`${group.groupName} (${trade.symbol} ${trade.side})`);
          }
        }
        if (occupiedGroups.size > 0) {
          lines.push('CORRELATION GROUPS OCCUPIED:');
          for (const g of occupiedGroups) {
            lines.push(`  ⚠️ ${g}`);
          }
          lines.push('  Rule: No same-direction trades allowed in the same group.');
          lines.push('');
        }
      }
    } catch {
      // Correlation data unavailable — skip silently
    }

    // ── Trading Session (LIVE) ──
    const session = this.marketScanner.getSessionQuality();
    lines.push(`TRADING SESSION: ${session.session} (${(session.multiplier * 100).toFixed(0)}% sizing) — ${session.description}`);
    lines.push('');

    // ── Behavioral Directives ──
    lines.push('BEHAVIORAL RULES:');
    lines.push('  • You make decisions based on DATA, not emotions or hype.');
    lines.push('  • Always reference the actual numbers (RSI, ADX, ATR, win rate) in your reasoning.');
    lines.push('  • If your past trade lessons show repeated failures on a symbol, be MORE cautious.');
    lines.push('  • Respect the regime: in trending markets use momentum, in ranging use mean-reversion, in volatile reduce size.');
    lines.push('  • You learn from every trade. Your PostMortem engine grades each trade and writes lessons to memory.');
    if (isPractice) {
      lines.push('  • You are in PRACTICE MODE — focus on learning and building confidence. Take calculated risks.');
    } else {
      lines.push('  • You are in LIVE MODE — real money is at stake. Be conservative and protect capital above all.');
    }
    lines.push('=== END IDENTITY ===');
    lines.push('');

    return lines.join('\n');
  }
}

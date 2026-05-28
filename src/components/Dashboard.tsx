import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronUp,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  X,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Target,
  Wallet,
  Newspaper,
  Waves,
  Bot,
  User
} from 'lucide-react';
import { Position, ClosedTrade, DailyPnl, SentryLog } from '../hooks/useTrades';
import { useMarketIntel } from '../hooks/useMarketIntel';
import { toast } from 'sonner';
import { TimeMachineControls } from './TimeMachineControls';

interface DashboardProps {
  activeTab: 'positions' | 'pending' | 'history' | 'sentry' | 'intel';
  setActiveTab: (t: 'positions' | 'pending' | 'history' | 'sentry' | 'intel') => void;
  positions: Position[];
  pendingTrades?: any[];
  tradeHistory: ClosedTrade[];
  dailyPnl: DailyPnl;
  portfolio: { paperBalance: number; realizedPnl: number; liveBalance?: number; liveRealizedPnl?: number };
  userId?: string;
  sentryConfig?: { active: boolean, symbol?: string, condition?: string, targetPrice?: number, side?: string, quantity?: number, isAutonomous?: boolean, autonomousPrompt?: string };
  sentryLogs?: SentryLog[];
  onClosePosition: (tradeId: string) => Promise<any>;
  onApproveTrade?: (tradeId: string) => Promise<any>;
  onDeclineTrade?: (tradeId: string) => Promise<any>;
  isLoading: boolean;
  isPracticeMode?: boolean;
  tradingMode?: 'sentry' | 'copilot';
  showTimeMachine?: boolean;
  isReplaying?: boolean;
  onStartReplay?: (date: string, speed: number, symbol: string, jarvisEnabled: boolean, capital: number, profitTarget: number) => void;
  onStopReplay?: () => void;
}

export function Dashboard({
  activeTab,
  setActiveTab,
  positions,
  pendingTrades = [],
  tradeHistory,
  dailyPnl,
  portfolio,
  userId = '',
  sentryConfig,
  sentryLogs = [],
  onClosePosition,
  onApproveTrade,
  onDeclineTrade,
  isLoading,
  isPracticeMode = true,
  tradingMode = 'copilot',
  showTimeMachine = false,
  isReplaying = false,
  onStartReplay,
  onStopReplay,
}: DashboardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const { news, whaleAlerts, isLoading: intelLoading } = useMarketIntel();

  const handleClosePosition = async (tradeId: string, symbol: string) => {
    setClosingId(tradeId);
    try {
      const result = await onClosePosition(tradeId);
      toast.success(`Closed ${symbol} — P&L: ${result.realizedPnl >= 0 ? '+' : ''}$${result.realizedPnl.toFixed(2)}`, {
        style: {
          backgroundColor: result.realizedPnl >= 0 ? '#22c55e' : '#ef4444',
          color: 'white',
          border: 'none',
        },
      });
    } catch (err: any) {
      toast.error(err.message || 'Failed to close position');
    } finally {
      setClosingId(null);
    }
  };

  const handleApproveTrade = async (tradeId: string) => {
    if (!onApproveTrade) return;
    setApprovingId(tradeId);
    try {
      await onApproveTrade(tradeId);
      toast.success('Trade Approved and Executed Successfully!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve trade');
    } finally {
      setApprovingId(null);
    }
  };

  const handleDeclineTrade = async (tradeId: string) => {
    if (!onDeclineTrade) return;
    setDecliningId(tradeId);
    try {
      await onDeclineTrade(tradeId);
      toast.success('Trade Declined', { style: { backgroundColor: '#ef4444', color: 'white', border: 'none' } });
    } catch (err: any) {
      toast.error(err.message || 'Failed to decline trade');
    } finally {
      setDecliningId(null);
    }
  };

  const pnlColor = dailyPnl.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400';
  const pnlBgColor = dailyPnl.totalPnl >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10';

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40">

      {/* ── Time Machine Dock (sits above the main dock) ────────────── */}
      <AnimatePresence>
        {isPracticeMode && showTimeMachine && onStartReplay && onStopReplay && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <TimeMachineControls 
              isReplaying={isReplaying}
              onStartReplay={onStartReplay}
              onStopReplay={onStopReplay}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Summary Bar (Always Visible) ─────────────────────────────── */}
      <motion.div
        id="dashboard-summary"
        onClick={() => setIsExpanded(!isExpanded)}
        className="cursor-pointer bg-zinc-900/90 backdrop-blur-xl border-t border-zinc-800/80 px-6 py-3 flex items-center justify-between hover:bg-zinc-800/90 transition-colors"
      >
        <div className="flex items-center gap-6">
          {/* Trading Mode Badge */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
            isPracticeMode
              ? 'bg-amber-500/15 border-amber-500/30'
              : 'bg-cyan-500/15 border-cyan-500/30'
          }`}>
            <div className={`w-2 h-2 rounded-full animate-pulse ${
              isPracticeMode ? 'bg-amber-400' : 'bg-cyan-400'
            }`} />
            <span className={`text-xs font-semibold tracking-wider uppercase ${
              isPracticeMode ? 'text-amber-400' : 'text-cyan-400'
            }`}>
              {isPracticeMode ? '🧪 Practice' : '🔴 Live'}
            </span>
          </div>

          {/* Execution Mode Status */}
          {tradingMode === 'sentry' ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/15 border border-purple-500/30">
              <Bot className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
              <span className="text-xs font-semibold text-purple-400 tracking-wider uppercase">
                Sentry
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/15 border border-cyan-500/30">
              <User className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs font-semibold text-cyan-400 tracking-wider uppercase">
                Co-pilot
              </span>
            </div>
          )}

          {/* Portfolio Balance */}
          <div className="flex items-center gap-2">
            <Wallet className={`w-3.5 h-3.5 ${isPracticeMode ? 'text-amber-500/60' : 'text-cyan-500/60'}`} />
            <span className={`text-sm font-bold font-mono ${isPracticeMode ? 'text-zinc-200' : 'text-cyan-200'}`}>
              ${(isPracticeMode ? portfolio.paperBalance : portfolio.liveBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${isPracticeMode ? 'bg-amber-500/10 text-amber-500/70' : 'bg-cyan-500/10 text-cyan-500/70'}`}>
              {isPracticeMode ? 'PAPER' : 'USDT'}
            </span>
            {!isPracticeMode && !(portfolio.liveBalance) && (
              <span className="text-[10px] text-red-400/70 font-medium">No Broker</span>
            )}
          </div>

          {/* Today's P&L */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 font-medium">Today's P&L</span>
            <span className={`text-sm font-bold font-mono ${pnlColor}`}>
              {dailyPnl.totalPnl >= 0 ? '+' : ''}${dailyPnl.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {/* Open Positions Count */}
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs text-zinc-400">
              <span className="font-bold text-zinc-200">{positions.length}</span> open
            </span>
          </div>

          {/* Win/Loss */}
          {dailyPnl.tradesCount > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-emerald-400">{dailyPnl.winCount}W</span>
              <span className="text-zinc-600">/</span>
              <span className="text-red-400">{dailyPnl.lossCount}L</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Realized vs Unrealized Breakdown */}
          <div className="hidden md:flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <Target className="w-3 h-3 text-zinc-500" />
              <span className="text-zinc-500">Realized</span>
              <span className={`font-mono font-medium ${dailyPnl.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {dailyPnl.realizedPnl >= 0 ? '+' : ''}${dailyPnl.realizedPnl.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-zinc-500" />
              <span className="text-zinc-500">Unrealized</span>
              <span className={`font-mono font-medium ${dailyPnl.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {dailyPnl.unrealizedPnl >= 0 ? '+' : ''}${dailyPnl.unrealizedPnl.toFixed(2)}
              </span>
            </div>
          </div>

          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-zinc-400" />
          ) : (
            <ChevronUp className="w-5 h-5 text-zinc-400" />
          )}
        </div>
      </motion.div>

      {/* ── Expanded Panel ────────────────────────────────────────────── */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="bg-zinc-950/95 backdrop-blur-xl border-t border-zinc-800/50 overflow-hidden"
          >
            <div className="max-h-[45vh] overflow-y-auto">
              {/* Tabs */}
              <div className="flex items-center gap-1 px-6 pt-4 pb-2">
                <button
                  onClick={() => setActiveTab('positions')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeTab === 'positions'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Active Positions
                    {positions.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold">
                        {positions.length}
                      </span>
                    )}
                  </span>
                </button>
                {pendingTrades.length > 0 && (
                <button
                  onClick={() => setActiveTab('pending')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeTab === 'pending'
                      ? 'bg-zinc-800 text-amber-500'
                      : 'text-zinc-500 hover:text-amber-500 hover:bg-zinc-800/50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Zap className="w-4 h-4 animate-pulse text-amber-500" />
                    Pending Approvals
                    <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-500 text-xs font-bold">
                      {pendingTrades.length}
                    </span>
                  </span>
                </button>
                )}
                <button
                  onClick={() => setActiveTab('history')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeTab === 'history'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Trade History
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab('sentry')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeTab === 'sentry'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Sentry Logs
                    {sentryConfig?.active && (
                      <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                    )}
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab('intel')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeTab === 'intel'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Newspaper className="w-4 h-4" />
                    Market Intel
                  </span>
                </button>
              </div>

              {/* ── Active Positions Tab ──────────────────────────────── */}
              {activeTab === 'positions' && (
                <div className="px-6 pb-4">
                  {positions.length === 0 ? (
                    <div className="text-center py-10">
                      <Activity className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                      <p className="text-zinc-500 text-sm">No open positions</p>
                      <p className="text-zinc-600 text-xs mt-1">
                        Say "Jarvis, buy 0.01 BTC" to start trading
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {positions.map((pos) => {
                        const isProfit = pos.unrealizedPnl >= 0;
                        return (
                          <motion.div
                            key={pos.tradeId}
                            layout
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 flex items-center justify-between group hover:border-zinc-700/60 transition-colors"
                          >
                            <div className="flex items-center gap-4">
                              {/* Side Badge */}
                              <div
                                className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
                                  pos.side === 'buy'
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-red-500/15 text-red-400 border border-red-500/30'
                                }`}
                              >
                                {pos.side}
                              </div>

                              {/* Symbol & Details */}
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-bold text-zinc-100">
                                    {pos.symbol}
                                  </span>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 uppercase">
                                    {pos.mode}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                                  <span>Qty: <span className="text-zinc-300 font-mono">{pos.quantity}</span></span>
                                  <span>Entry: <span className="text-zinc-300 font-mono">${pos.entryPrice.toLocaleString()}</span></span>
                                  <span>
                                    Now:{' '}
                                    <span className={`font-mono ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                                      ${pos.currentPrice.toLocaleString()}
                                    </span>
                                  </span>
                                </div>
                                {/* Risk Management Info */}
                                {(pos as any).stopLossPrice || (pos as any).takeProfitPrice || (pos as any).trailingStopDistance ? (
                                  <div className="flex items-center gap-3 mt-1">
                                    {(pos as any).stopLossPrice && (
                                      <div className="text-[10px] text-red-400/80 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                                        SL: ${(pos as any).stopLossPrice.toLocaleString()}
                                      </div>
                                    )}
                                    {(pos as any).takeProfitPrice && (
                                      <div className="text-[10px] text-emerald-400/80 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                        TP: ${(pos as any).takeProfitPrice.toLocaleString()}
                                      </div>
                                    )}
                                    {(pos as any).trailingStopDistance && (
                                      <div className="text-[10px] text-purple-400/80 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
                                        Trail: ${(pos as any).trailingStopDistance.toLocaleString()}
                                      </div>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex items-center gap-4">
                              {/* P&L */}
                              <div className="text-right">
                                <div
                                  className={`text-sm font-bold font-mono flex items-center gap-1 ${
                                    isProfit ? 'text-emerald-400' : 'text-red-400'
                                  }`}
                                >
                                  {isProfit ? (
                                    <ArrowUpRight className="w-3.5 h-3.5" />
                                  ) : (
                                    <ArrowDownRight className="w-3.5 h-3.5" />
                                  )}
                                  {isProfit ? '+' : ''}${pos.unrealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                                <span
                                  className={`text-xs font-mono ${isProfit ? 'text-emerald-500/70' : 'text-red-500/70'}`}
                                >
                                  {isProfit ? '+' : ''}{pos.unrealizedPnlPercent.toFixed(2)}%
                                </span>
                              </div>

                              {/* Close Button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleClosePosition(pos.tradeId, pos.symbol);
                                }}
                                disabled={closingId === pos.tradeId}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                                title="Close Position"
                              >
                                {closingId === pos.tradeId ? (
                                  <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <X className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Pending Approvals Tab ──────────────────────────────── */}
              {activeTab === 'pending' && (
                <div className="px-6 pb-4">
                  {pendingTrades.length === 0 ? (
                    <div className="text-center py-10">
                       <Zap className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                       <p className="text-zinc-500 text-sm">No trades pending approval</p>
                    </div>
                  ) : (
                    <div className="space-y-4 pt-2">
                      {pendingTrades.map((trade) => (
                        <div key={trade.id} className="bg-amber-950/20 border border-amber-500/30 rounded-xl p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs font-bold uppercase rounded border border-amber-500/30">
                                {trade.side}
                              </span>
                              <span className="text-zinc-100 font-bold">{trade.symbol}</span>
                              <span className="text-sm font-mono text-zinc-400">Qty: {trade.quantity?.toFixed?.(2) || trade.quantity}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => handleDeclineTrade(trade.id)}
                                disabled={decliningId === trade.id || approvingId === trade.id}
                                className="px-4 py-1.5 bg-red-500/20 hover:bg-red-500/40 text-red-400 hover:text-red-300 font-bold text-sm rounded border border-red-500/30 transition-colors disabled:opacity-50"
                              >
                                {decliningId === trade.id ? 'Declining...' : 'Decline'}
                              </button>
                              <button 
                                onClick={() => handleApproveTrade(trade.id)}
                                disabled={approvingId === trade.id || decliningId === trade.id}
                                className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm rounded transition-colors disabled:opacity-50"
                              >
                                {approvingId === trade.id ? 'Approving...' : '✅ Approve'}
                              </button>
                            </div>
                          </div>

                          {/* Trade Details */}
                          <div className="grid grid-cols-4 gap-3 mb-3">
                            <div className="bg-black/20 rounded-lg p-2 text-center">
                              <p className="text-[9px] text-zinc-500 uppercase">Entry</p>
                              <p className="text-xs font-mono text-zinc-200">${trade.entryPrice?.toFixed?.(4) || trade.entryPrice}</p>
                            </div>
                            <div className="bg-black/20 rounded-lg p-2 text-center">
                              <p className="text-[9px] text-zinc-500 uppercase">Stop Loss</p>
                              <p className="text-xs font-mono text-red-400">${trade.stopLossPrice?.toFixed?.(4) || trade.stopLossPrice || '—'}</p>
                            </div>
                            <div className="bg-black/20 rounded-lg p-2 text-center">
                              <p className="text-[9px] text-zinc-500 uppercase">Take Profit</p>
                              <p className="text-xs font-mono text-emerald-400">${trade.takeProfitPrice?.toFixed?.(4) || trade.takeProfitPrice || '—'}</p>
                            </div>
                            <div className="bg-black/20 rounded-lg p-2 text-center">
                              <p className="text-[9px] text-zinc-500 uppercase">Confidence</p>
                              <p className="text-xs font-mono text-amber-400">{trade.confidence || '—'}%</p>
                            </div>
                          </div>
                          
                          <div className="bg-black/20 p-3 rounded-lg border border-black/40">
                            <p className="text-xs text-zinc-400 mb-1 font-semibold uppercase tracking-wider">Jarvis Reasoning</p>
                            <p className="text-sm text-zinc-300 italic">"{trade.reasoning}"</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Trade History Tab ─────────────────────────────────── */}
              {activeTab === 'history' && (
                <div className="px-6 pb-4">
                  {tradeHistory.length === 0 ? (
                    <div className="text-center py-10">
                      <Clock className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                      <p className="text-zinc-500 text-sm">No trade history yet</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {/* Header */}
                      <div className="grid grid-cols-7 gap-4 px-4 py-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
                        <span>Symbol</span>
                        <span>Side</span>
                        <span className="text-right">Entry</span>
                        <span className="text-right">Exit</span>
                        <span className="text-right">Qty</span>
                        <span className="text-right">P&L</span>
                        <span className="text-right">Time</span>
                      </div>

                      {tradeHistory.map((trade) => {
                        const isProfit = (trade.pnl || 0) >= 0;
                        return (
                          <div
                            key={trade.tradeId}
                            className="grid grid-cols-7 gap-4 px-4 py-2.5 rounded-lg hover:bg-zinc-900/50 text-sm transition-colors"
                          >
                            <span className="text-zinc-200 font-medium">{trade.symbol}</span>
                            <span
                              className={`font-bold uppercase text-xs ${
                                trade.side === 'buy' ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              {trade.side}
                            </span>
                            <span className="text-right text-zinc-400 font-mono">
                              ${trade.entryPrice?.toLocaleString()}
                            </span>
                            <span className="text-right text-zinc-400 font-mono">
                              ${trade.exitPrice?.toLocaleString()}
                            </span>
                            <span className="text-right text-zinc-400 font-mono">
                              {trade.quantity}
                            </span>
                            <span
                              className={`text-right font-bold font-mono ${
                                isProfit ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              {isProfit ? '+' : ''}${(trade.pnl || 0).toFixed(2)}
                            </span>
                            <span className="text-right text-zinc-600 text-xs">
                              {trade.closedAt
                                ? new Date(trade.closedAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : '—'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Sentry Logs Tab ─────────────────────────────────── */}
              {activeTab === 'sentry' && (
                <div className="px-6 pb-4">
                  <div className="bg-zinc-950 rounded-xl border border-zinc-800/80 p-4 font-mono text-xs h-[300px] overflow-y-auto flex flex-col gap-2">
                    {sentryLogs.length === 0 ? (
                      <div className="text-zinc-600 flex flex-col items-center justify-center h-full gap-1 text-center">
                        <span>👁️ Sentry is watching — no events yet.</span>
                        <span className="text-[10px] text-zinc-700">Logs appear here when a position triggers SL/TP, trailing stop, or circuit-breaker actions.</span>
                      </div>
                    ) : (
                      sentryLogs.map((log) => (
                        <div key={log.id} className="flex items-start gap-3">
                          <span className="text-zinc-600 shrink-0">
                            [{new Date(log.timestamp).toLocaleTimeString()}]
                          </span>
                          <span className={`
                            ${log.type === 'info' ? 'text-zinc-400' : ''}
                            ${log.type === 'action' ? 'text-purple-400 font-bold' : ''}
                            ${log.type === 'success' ? 'text-emerald-400 font-bold' : ''}
                            ${log.type === 'error' ? 'text-red-400 font-bold' : ''}
                          `}>
                            {log.message}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* ── Market Intel Tab ─────────────────────────────────── */}
              {activeTab === 'intel' && (
                <div className="px-6 pb-4 grid grid-cols-2 gap-6 h-[300px]">
                  {/* News Feed */}
                  <div className="flex flex-col h-full">
                    <h3 className="text-sm font-bold text-zinc-400 mb-3 flex items-center gap-2">
                      <Newspaper className="w-4 h-4" /> Live News Sentiment
                    </h3>
                    <div className="bg-zinc-950 rounded-xl border border-zinc-800/80 p-4 overflow-y-auto flex-1 space-y-3">
                      {intelLoading ? (
                        <div className="text-zinc-600 text-sm text-center py-4">Loading news...</div>
                      ) : news.length === 0 ? (
                        <div className="text-zinc-600 text-sm text-center py-4">No recent news</div>
                      ) : (
                        news.map((item) => (
                          <div key={item.id} className="border-b border-zinc-800/50 pb-3 last:border-0 last:pb-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold text-zinc-300">{item.symbol}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold ${
                                item.sentiment === 'bullish' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                item.sentiment === 'bearish' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                'bg-zinc-800 text-zinc-400 border border-zinc-700'
                              }`}>
                                {item.sentiment}
                              </span>
                            </div>
                            <p className="text-sm text-zinc-200 leading-snug">{item.title}</p>
                            <div className="flex items-center justify-between mt-2 text-[10px] text-zinc-500">
                              <span>{item.source}</span>
                              <span>{new Date(item.publishedAt).toLocaleTimeString()}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Whale Alerts */}
                  <div className="flex flex-col h-full">
                    <h3 className="text-sm font-bold text-zinc-400 mb-3 flex items-center gap-2">
                      <Waves className="w-4 h-4" /> Whale Tracker
                    </h3>
                    <div className="bg-zinc-950 rounded-xl border border-zinc-800/80 p-4 overflow-y-auto flex-1 space-y-3">
                      {intelLoading ? (
                        <div className="text-zinc-600 text-sm text-center py-4">Loading whale data...</div>
                      ) : whaleAlerts.length === 0 ? (
                        <div className="text-zinc-600 text-sm text-center py-4">No recent whale activity</div>
                      ) : (
                        whaleAlerts.map((alert) => (
                          <div key={alert.id} className="border-b border-zinc-800/50 pb-3 last:border-0 last:pb-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-bold text-zinc-300">
                                {alert.amount.toLocaleString()} {alert.symbol}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold ${
                                alert.urgency === 'high' ? 'bg-red-500/10 text-red-400 border border-red-500/20 animate-pulse' :
                                alert.urgency === 'medium' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' :
                                'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                              }`}>
                                {alert.urgency}
                              </span>
                            </div>
                            <p className="text-xs text-zinc-400">
                              <span className="text-zinc-300 font-medium capitalize">{alert.action}</span> from <span className="text-zinc-300">{alert.from}</span> to <span className="text-zinc-300">{alert.to}</span>
                            </p>
                            <div className="flex items-center justify-between mt-2 text-[10px] text-zinc-500">
                              <span className="font-mono text-zinc-400">${alert.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                              <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

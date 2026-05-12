import { motion } from 'motion/react';
import { TrendingUp, TrendingDown, Activity, Zap, Newspaper, AlertTriangle, Target, Flame, BarChart2, Clock } from 'lucide-react';

interface HomeInsightsProps {
  positions: any[];
  dailyPnl: any;
  portfolio: any;
  news: any[];
  whaleAlerts: any[];
  sentryConfig: any;
  tradeHistory: any[];
  isPracticeMode?: boolean;
}

export function HomeInsights({ positions, dailyPnl, portfolio, news, whaleAlerts, sentryConfig, tradeHistory, isPracticeMode = true }: HomeInsightsProps) {
  const hasPositions = positions && positions.length > 0;
  const recentTrades = (tradeHistory || []).slice(0, 3);
  const recentNews = (news || []).slice(0, 2);
  const recentWhales = (whaleAlerts || []).slice(0, 2);
  const winRate = dailyPnl?.winCount != null && dailyPnl?.tradesCount > 0
    ? Math.round((dailyPnl.winCount / dailyPnl.tradesCount) * 100)
    : null;

  return (
    <div className="w-full max-w-3xl grid grid-cols-3 gap-3 mt-2">

      {/* ─── LEFT COLUMN ─── */}
      <div className="flex flex-col gap-3">

        {/* Portfolio Snapshot */}
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 backdrop-blur-sm"
        >
          <div className="flex items-center gap-1.5 mb-2">
            <BarChart2 className="w-3 h-3 text-zinc-500" />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-500">Portfolio</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-zinc-500">Balance</span>
              <span className="text-xs font-mono font-bold text-zinc-200">
                ${(isPracticeMode ? (portfolio?.paperBalance ?? 100000) : (portfolio?.liveBalance ?? 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-zinc-500">Today</span>
              <span className={`text-xs font-mono font-bold ${(dailyPnl?.totalPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(dailyPnl?.totalPnl ?? 0) >= 0 ? '+' : ''}${(dailyPnl?.totalPnl ?? 0).toFixed(2)}
              </span>
            </div>
            {winRate !== null && (
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-zinc-500">Win Rate</span>
                <span className={`text-xs font-mono font-bold ${winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {winRate}%
                </span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-zinc-500">Open</span>
              <span className="text-xs font-mono font-bold text-zinc-300">
                {positions?.length ?? 0} trade{(positions?.length ?? 0) !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Sentry Status */}
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className={`bg-zinc-900/50 border rounded-xl p-3 backdrop-blur-sm ${
            sentryConfig?.active ? 'border-purple-500/30' : 'border-zinc-800/60'
          }`}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <Activity className={`w-3 h-3 ${sentryConfig?.active ? 'text-purple-400' : 'text-zinc-500'}`} />
            <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-500">Sentry</span>
            <div className={`ml-auto w-1.5 h-1.5 rounded-full ${sentryConfig?.active ? 'bg-purple-400 animate-pulse' : 'bg-zinc-700'}`} />
          </div>
          <div className="text-[10px] text-zinc-400 leading-relaxed">
            {sentryConfig?.active
              ? <span className="text-purple-300">Autonomous mode active. Monitoring markets.</span>
              : <span className="text-zinc-600">Sentry offline. Enable for autonomous trading.</span>
            }
          </div>
        </motion.div>

        {/* Recent Trades */}
        {recentTrades.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 backdrop-blur-sm"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <Clock className="w-3 h-3 text-zinc-500" />
              <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-500">Recent Trades</span>
            </div>
            <div className="space-y-1.5">
              {recentTrades.map((t: any) => {
                const pnl = t.realizedPnl ?? t.pnl ?? 0;
                const isWin = pnl >= 0;
                return (
                  <div key={t.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      {isWin
                        ? <TrendingUp className="w-2.5 h-2.5 text-emerald-500" />
                        : <TrendingDown className="w-2.5 h-2.5 text-red-500" />
                      }
                      <span className="text-[10px] font-mono text-zinc-400">{(t.symbol || '').replace('/USDT', '')}</span>
                    </div>
                    <span className={`text-[10px] font-mono font-bold ${isWin ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isWin ? '+' : ''}{pnl.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </div>

      {/* ─── MIDDLE COLUMN: Open Positions (or empty state) ─── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 backdrop-blur-sm"
      >
        <div className="flex items-center gap-1.5 mb-2">
          <Target className="w-3 h-3 text-zinc-500" />
          <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-500">Open Positions</span>
        </div>
        {hasPositions ? (
          <div className="space-y-2">
            {positions.slice(0, 5).map((p: any) => {
              const pnl = p.unrealizedPnl ?? 0;
              const isUp = pnl >= 0;
              return (
                <div key={p.id} className="flex flex-col gap-0.5 py-1.5 border-b border-zinc-800/40 last:border-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${
                        p.side === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                      }`}>{p.side?.toUpperCase()}</span>
                      <span className="text-[10px] font-mono text-zinc-200">{(p.symbol || '').replace('/USDT', '')}</span>
                    </div>
                    <span className={`text-[10px] font-mono font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isUp ? '+' : ''}${pnl.toFixed(2)}
                    </span>
                  </div>
                  {/* mini progress bar showing distance from SL to TP */}
                  {p.stopLossPrice && p.takeProfitPrice && p.entryPrice && (
                    <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${isUp ? 'bg-emerald-500' : 'bg-red-500'}`}
                        style={{
                          width: `${Math.min(100, Math.max(0,
                            ((p.currentPrice ?? p.entryPrice) - p.stopLossPrice) / (p.takeProfitPrice - p.stopLossPrice) * 100
                          ))}%`
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-24 text-center">
            <Flame className="w-5 h-5 text-zinc-700 mb-1.5" />
            <p className="text-[10px] text-zinc-600">No open positions</p>
            <p className="text-[9px] text-zinc-700 mt-0.5">Say "Jarvis, scan the market"</p>
          </div>
        )}
      </motion.div>

      {/* ─── RIGHT COLUMN ─── */}
      <div className="flex flex-col gap-3">

        {/* Whale Alerts */}
        {recentWhales.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-zinc-900/50 border border-amber-500/10 rounded-xl p-3 backdrop-blur-sm"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangle className="w-3 h-3 text-amber-500" />
              <span className="text-[9px] uppercase tracking-widest font-semibold text-amber-500/70">Whale Activity</span>
            </div>
            <div className="space-y-2">
              {recentWhales.map((w: any, i: number) => (
                <div key={i} className="text-[10px] text-zinc-400 leading-relaxed border-b border-zinc-800/30 last:border-0 pb-1.5 last:pb-0">
                  <span className="text-amber-400 font-mono font-bold">{w.symbol || 'BTC'}</span>
                  {' · '}
                  <span>{w.side === 'buy' ? '🐋 Accumulating' : '🔴 Dumping'}</span>
                  {w.amount && <span className="text-zinc-500"> · ${(w.amount / 1e6).toFixed(1)}M</span>}
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Market News */}
        {recentNews.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 backdrop-blur-sm"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <Newspaper className="w-3 h-3 text-zinc-500" />
              <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-500">Market Intel</span>
            </div>
            <div className="space-y-2">
              {recentNews.map((n: any, i: number) => (
                <div key={i} className="text-[10px] text-zinc-400 leading-snug border-b border-zinc-800/30 last:border-0 pb-1.5 last:pb-0">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${
                    n.sentiment === 'bullish' ? 'bg-emerald-400' :
                    n.sentiment === 'bearish' ? 'bg-red-400' : 'bg-zinc-500'
                  }`} />
                  {n.headline || n.title || n.summary}
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Market Pulse — always visible if no news/whales */}
        {recentNews.length === 0 && recentWhales.length === 0 && (
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 backdrop-blur-sm"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <Zap className="w-3 h-3 text-zinc-500" />
              <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-500">Quick Commands</span>
            </div>
            <div className="space-y-1.5">
              {[
                '"Scan the market"',
                '"What should I trade?"',
                '"Check my positions"',
                '"Show risk report"',
              ].map((cmd, i) => (
                <div key={i} className="text-[10px] font-mono text-zinc-600 py-0.5">
                  {cmd}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

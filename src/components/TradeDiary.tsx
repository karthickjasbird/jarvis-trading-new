import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen,
  Search,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Minus,
} from 'lucide-react';
import { toast } from 'sonner';

interface DiaryEntry {
  id: string;
  timestamp: string;
  userId: string;
  symbol: string;
  side: 'buy' | 'sell' | 'none';
  decision: 'executed' | 'pending_approval' | 'vetoed_sentinel_risk' | 'vetoed_sentinel_ai' | 'vetoed_regime_gate' | 'vetoed_backtest' | 'no_opportunity' | 'pipeline_error';
  reasoning: string;
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
  regime: 'trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'unknown';
  riskCheck: {
    portfolioHeat: number;
    openPositions: number;
    dailyPnl: number;
  };
  confidence: number;
  kellySize?: string;
  tradeId?: string;
  outcome?: 'win' | 'loss' | 'pending';
  pnl?: number;
  pnlPercent?: number;
  grade?: 'A' | 'B' | 'C' | 'D' | 'F';
  lessons?: string[];
}

const DECISION_META: Record<DiaryEntry['decision'], { label: string; color: string; icon: any }> = {
  executed: { label: 'EXECUTED', color: 'emerald', icon: CheckCircle2 },
  pending_approval: { label: 'PENDING', color: 'amber', icon: Clock },
  vetoed_sentinel_risk: { label: 'VETO · RISK', color: 'red', icon: XCircle },
  vetoed_sentinel_ai: { label: 'VETO · AI', color: 'red', icon: XCircle },
  vetoed_regime_gate: { label: 'VETO · REGIME', color: 'orange', icon: AlertTriangle },
  vetoed_backtest: { label: 'VETO · BACKTEST', color: 'orange', icon: AlertTriangle },
  no_opportunity: { label: 'NO OPP', color: 'zinc', icon: Minus },
  pipeline_error: { label: 'ERROR', color: 'red', icon: AlertTriangle },
};

const GRADE_COLORS: Record<string, string> = {
  A: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
  B: 'text-cyan-400 bg-cyan-500/15 border-cyan-500/30',
  C: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
  D: 'text-orange-400 bg-orange-500/15 border-orange-500/30',
  F: 'text-red-400 bg-red-500/15 border-red-500/30',
};

function colorClasses(color: string) {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
    amber:   { bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/30'   },
    red:     { bg: 'bg-red-500/10',     text: 'text-red-400',     border: 'border-red-500/30'     },
    orange:  { bg: 'bg-orange-500/10',  text: 'text-orange-400',  border: 'border-orange-500/30'  },
    zinc:    { bg: 'bg-zinc-800',       text: 'text-zinc-400',    border: 'border-zinc-700'       },
  };
  return map[color] || map.zinc;
}

export function TradeDiary({ userId }: { userId: string }) {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [decisionFilter, setDecisionFilter] = useState<string>('all');
  const [symbolFilter, setSymbolFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchEntries = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/diary/${userId}?limit=300`);
      const data = await res.json();
      if (data.entries) {
        setEntries(data.entries);
      } else if (data.error) {
        toast.error(`Diary fetch failed: ${data.error}`);
      }
    } catch {
      toast.error('Failed to load trade diary');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
    const interval = setInterval(fetchEntries, 30000);
    return () => clearInterval(interval);
  }, [userId]);

  // Derive symbol list for filter dropdown
  const symbols = useMemo(() => {
    const s = new Set<string>();
    entries.forEach((e) => s.add(e.symbol));
    return Array.from(s).sort();
  }, [entries]);

  // Apply filters
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (decisionFilter !== 'all' && e.decision !== decisionFilter) return false;
      if (symbolFilter !== 'all' && e.symbol !== symbolFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!e.symbol.toLowerCase().includes(q) && !(e.reasoning || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [entries, decisionFilter, symbolFilter, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    const counts: Record<string, number> = { executed: 0, pending: 0, vetoed: 0, no_opp: 0, error: 0 };
    entries.forEach((e) => {
      if (e.decision === 'executed') counts.executed++;
      else if (e.decision === 'pending_approval') counts.pending++;
      else if (e.decision.startsWith('vetoed_')) counts.vetoed++;
      else if (e.decision === 'no_opportunity') counts.no_opp++;
      else if (e.decision === 'pipeline_error') counts.error++;
    });
    return counts;
  }, [entries]);

  const fmtTime = (ts: string) => {
    try {
      const d = new Date(ts);
      const now = new Date();
      const diffHr = (now.getTime() - d.getTime()) / 3_600_000;
      if (diffHr < 1) return `${Math.floor(diffHr * 60)}m ago`;
      if (diffHr < 24) return `${Math.floor(diffHr)}h ago`;
      if (diffHr < 24 * 7) return `${Math.floor(diffHr / 24)}d ago`;
      return d.toLocaleDateString();
    } catch {
      return ts;
    }
  };

  return (
    <div className="flex flex-col h-full bg-black overflow-hidden relative p-6">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-cyan-900/10 via-black to-black opacity-60" />

      {/* Header */}
      <div className="flex items-center justify-between mb-6 relative z-10">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-cyan-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Trade Diary</h1>
            <p className="text-xs text-zinc-500">Structured audit trail of every swarm decision</p>
          </div>
        </div>
        <button
          onClick={fetchEntries}
          disabled={loading}
          className="px-4 py-2 bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 rounded-lg text-xs font-bold hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-5 gap-3 mb-6 relative z-10">
        <StatCard label="Total" value={entries.length} accent="zinc" />
        <StatCard label="Executed" value={stats.executed} accent="emerald" />
        <StatCard label="Pending" value={stats.pending} accent="amber" />
        <StatCard label="Vetoed" value={stats.vetoed} accent="red" />
        <StatCard label="No Opp" value={stats.no_opp} accent="zinc" />
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-3 mb-4 relative z-10">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            value={searchQuery}
            onChange={(e: any) => setSearchQuery(e.target.value)}
            placeholder="Search symbol or reasoning..."
            className="w-full bg-zinc-900/80 border border-zinc-800 rounded-lg pl-10 pr-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500/40"
          />
        </div>
        <select
          value={decisionFilter}
          onChange={(e: any) => setDecisionFilter(e.target.value)}
          className="bg-zinc-900/80 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-cyan-500/40"
        >
          <option value="all">All decisions</option>
          {Object.entries(DECISION_META).map(([key, meta]) => (
            <option key={key} value={key}>{meta.label}</option>
          ))}
        </select>
        <select
          value={symbolFilter}
          onChange={(e: any) => setSymbolFilter(e.target.value)}
          className="bg-zinc-900/80 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-cyan-500/40 max-w-[180px]"
        >
          <option value="all">All symbols ({symbols.length})</option>
          {symbols.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="text-[11px] text-zinc-500 mb-2 relative z-10">
        Showing {filtered.length} of {entries.length} entries
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto relative z-10 space-y-2 pb-12">
        {filtered.length === 0 && !loading && (
          <div className="text-center py-12 text-zinc-500 text-sm">No entries match your filters.</div>
        )}
        {filtered.map((entry) => {
          const meta = DECISION_META[entry.decision] || DECISION_META.no_opportunity;
          const colors = colorClasses(meta.color);
          const Icon = meta.icon;
          const isExpanded = expandedId === entry.id;

          return (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-zinc-900/40 border ${colors.border} rounded-xl overflow-hidden`}
            >
              {/* Row header (always visible, click to expand) */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                className="w-full text-left p-4 hover:bg-zinc-800/30 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Icon className={`w-4 h-4 flex-shrink-0 ${colors.text}`} />
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${colors.bg} ${colors.text} ${colors.border} flex-shrink-0`}>
                      {meta.label}
                    </span>
                    <span className="text-sm font-bold text-white flex-shrink-0">{entry.symbol}</span>
                    {entry.side && entry.side !== 'none' && (
                      <span className={`text-[10px] font-bold ${entry.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {entry.side === 'buy' ? <TrendingUp className="w-3 h-3 inline" /> : <TrendingDown className="w-3 h-3 inline" />}
                        {entry.side.toUpperCase()}
                      </span>
                    )}
                    <span className="text-xs text-zinc-400 truncate min-w-0 flex-1">{entry.reasoning || '—'}</span>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {entry.grade && (
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${GRADE_COLORS[entry.grade]}`}>
                        {entry.grade}
                      </span>
                    )}
                    {entry.pnl !== undefined && (
                      <span className={`text-xs font-mono font-bold ${entry.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {entry.pnl >= 0 ? '+' : ''}${entry.pnl.toFixed(2)}
                      </span>
                    )}
                    {entry.confidence !== undefined && entry.confidence > 0 && (
                      <span className="text-[10px] text-zinc-500 font-mono">{entry.confidence}%</span>
                    )}
                    <span className="text-[10px] text-zinc-600 font-mono">{fmtTime(entry.timestamp)}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-zinc-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-t border-zinc-800/60"
                  >
                    <div className="p-4 space-y-3 bg-zinc-950/40">
                      {/* Full reasoning */}
                      <div>
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">Reasoning</div>
                        <div className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">{entry.reasoning || '—'}</div>
                      </div>

                      {/* Indicators */}
                      <div>
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">Indicators at decision time</div>
                        <div className="grid grid-cols-4 gap-2 text-[11px] font-mono">
                          {entry.indicators?.price !== undefined && <KV k="Price" v={`$${entry.indicators.price}`} />}
                          {entry.indicators?.rsi !== null && entry.indicators?.rsi !== undefined && <KV k="RSI" v={entry.indicators.rsi.toFixed(1)} />}
                          {entry.indicators?.macdHistogram !== null && entry.indicators?.macdHistogram !== undefined && <KV k="MACD H" v={entry.indicators.macdHistogram.toFixed(4)} />}
                          {entry.indicators?.adx !== null && entry.indicators?.adx !== undefined && <KV k="ADX" v={entry.indicators.adx.toFixed(1)} />}
                          {entry.indicators?.ema9 !== null && entry.indicators?.ema9 !== undefined && <KV k="EMA9" v={entry.indicators.ema9.toFixed(2)} />}
                          {entry.indicators?.ema21 !== null && entry.indicators?.ema21 !== undefined && <KV k="EMA21" v={entry.indicators.ema21.toFixed(2)} />}
                          {entry.indicators?.vwap !== null && entry.indicators?.vwap !== undefined && <KV k="VWAP" v={entry.indicators.vwap.toFixed(2)} />}
                          {entry.indicators?.atr !== null && entry.indicators?.atr !== undefined && <KV k="ATR" v={entry.indicators.atr.toFixed(4)} />}
                          {entry.indicators?.obvSlope && <KV k="OBV" v={entry.indicators.obvSlope} />}
                        </div>
                      </div>

                      {/* Context */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">Regime</div>
                          <div className="text-xs text-zinc-300 font-mono">{entry.regime || 'unknown'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">Risk State</div>
                          <div className="text-xs text-zinc-300 font-mono">
                            Heat: {entry.riskCheck?.portfolioHeat?.toFixed(1) ?? 0}% · Open: {entry.riskCheck?.openPositions ?? 0} · Daily: {entry.riskCheck?.dailyPnl?.toFixed(2) ?? 0}%
                          </div>
                        </div>
                      </div>

                      {/* Post-mortem outcome (if linked) */}
                      {entry.outcome && entry.outcome !== 'pending' && (
                        <div className="border-t border-zinc-800/40 pt-3">
                          <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">Outcome</div>
                          <div className="flex items-center gap-3 text-xs">
                            <span className={`font-bold ${entry.outcome === 'win' ? 'text-emerald-400' : 'text-red-400'}`}>
                              {entry.outcome.toUpperCase()}
                            </span>
                            {entry.pnl !== undefined && (
                              <span className={`font-mono ${entry.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {entry.pnl >= 0 ? '+' : ''}${entry.pnl.toFixed(2)} ({entry.pnlPercent !== undefined ? `${entry.pnlPercent >= 0 ? '+' : ''}${entry.pnlPercent.toFixed(2)}%` : ''})
                              </span>
                            )}
                            {entry.grade && (
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${GRADE_COLORS[entry.grade]}`}>
                                Grade {entry.grade}
                              </span>
                            )}
                          </div>
                          {entry.lessons && entry.lessons.length > 0 && (
                            <div className="mt-2">
                              <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">Lessons</div>
                              <ul className="text-xs text-zinc-300 space-y-1 list-disc list-inside">
                                {entry.lessons.map((l, i) => (
                                  <li key={i}>{l}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="text-[10px] text-zinc-600 font-mono pt-2 border-t border-zinc-800/40">
                        {new Date(entry.timestamp).toLocaleString()}
                        {entry.tradeId && <span className="ml-2">· Trade: {entry.tradeId.slice(0, 8)}</span>}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  const colors = colorClasses(accent);
  return (
    <div className={`bg-zinc-900/60 border border-zinc-800 rounded-xl p-3`}>
      <div className={`text-[10px] uppercase tracking-wider font-semibold mb-1 ${colors.text}`}>{label}</div>
      <div className="text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="bg-zinc-900/40 rounded px-2 py-1">
      <span className="text-zinc-500">{k}: </span>
      <span className="text-zinc-200">{v}</span>
    </div>
  );
}

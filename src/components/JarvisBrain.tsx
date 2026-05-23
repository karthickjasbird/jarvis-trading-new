import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Brain,
  Search,
  BarChart3,
  Target,
  Shield,
  ShieldCheck,
  BookOpen,
  Zap,
  Activity,
  Wifi,
  WifiOff,
  ChevronRight,
  Clock,
  MessageSquare,
  Crosshair,
  Plus,
  Pause,
  Play,
  Trophy,
  TrendingUp,
  TrendingDown,
  Radio,
  RefreshCw,
  Power,
  Trash2,
  Gauge,
  PieChart,
  Newspaper,
} from 'lucide-react';
import { toast } from 'sonner';
import { db } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';

// Agent definitions
const AGENTS = [
  {
    id: 'scout',
    name: 'Scout',
    role: 'Market Scanner',
    icon: Search,
    color: '#3b82f6',
    colorClass: 'blue',
    description: 'Scans 20+ markets every 15 min for opportunities',
    gridPos: 'col-start-1 row-start-1',
  },
  {
    id: 'analyst',
    name: 'Analyst',
    role: 'Technical Analysis',
    icon: BarChart3,
    color: '#8b5cf6',
    colorClass: 'violet',
    description: 'Deep RSI, MACD, EMA analysis on flagged pairs',
    gridPos: 'col-start-2 row-start-1',
  },
  {
    id: 'strategist',
    name: 'Strategist',
    role: 'Trade Planner',
    icon: Target,
    color: '#f59e0b',
    colorClass: 'amber',
    description: 'Builds entry/exit plans with backtest validation',
    gridPos: 'col-start-3 row-start-1',
  },
  {
    id: 'sentinel',
    name: 'Sentinel',
    role: 'Risk Guardian',
    icon: Shield,
    color: '#ef4444',
    colorClass: 'red',
    description: 'VETO power — enforces risk limits on every trade',
    gridPos: 'col-start-1 row-start-2',
  },
  {
    id: 'scholar',
    name: 'Scholar',
    role: 'Research Engine',
    icon: BookOpen,
    color: '#10b981',
    colorClass: 'emerald',
    description: 'Reads news, scrapes data, searches for alpha',
    gridPos: 'col-start-2 row-start-2',
  },
  {
    id: 'executor',
    name: 'Executor',
    role: 'Trade Execution',
    icon: Zap,
    color: '#06b6d4',
    colorClass: 'cyan',
    description: 'Places orders on connected exchange accounts',
    gridPos: 'col-start-3 row-start-2',
  },
  {
    id: 'regime',
    name: 'Regime',
    role: 'Market Classifier',
    icon: Gauge,
    color: '#a855f7',
    colorClass: 'purple',
    description: 'Classifies market conditions and gates trades',
    gridPos: '',
  },
];

// Mock activity feed (replaced with real Firestore data in Phase 4)
const MOCK_ACTIVITY = [
  { id: '1', agent: 'scout', message: 'Scanning BTC/USDT, ETH/USDT, SOL/USDT...', time: Date.now() - 30000, type: 'info' as const },
  { id: '2', agent: 'analyst', message: 'RSI divergence detected on ETH/USDT (4H)', time: Date.now() - 25000, type: 'signal' as const },
  { id: '3', agent: 'scholar', message: 'CoinDesk: "ETH staking yields hit 5.2%"', time: Date.now() - 20000, type: 'info' as const },
  { id: '4', agent: 'strategist', message: 'Proposing LONG ETH @ $3,241 — SL: $3,180, TP: $3,380', time: Date.now() - 15000, type: 'action' as const },
  { id: '5', agent: 'sentinel', message: '✅ Trade APPROVED — Risk within 2% threshold', time: Date.now() - 10000, type: 'approval' as const },
  { id: '6', agent: 'executor', message: 'Order placed: BUY 0.5 ETH @ $3,241 (Paper)', time: Date.now() - 5000, type: 'execution' as const },
];

interface JarvisBrainProps {
  isPracticeMode: boolean;
  userId?: string;
}

// ─── Market Regime Sub-Component (Multi-Coin) ───────────────
function RegimeWidget() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRegime = async () => {
      try {
        const res = await fetch('/api/regime');
        if (res.ok) setData(await res.json());
      } catch {}
      finally { setLoading(false); }
    };
    fetchRegime();
    const interval = setInterval(fetchRegime, 3 * 60 * 1000); // Refresh every 3 min
    return () => clearInterval(interval);
  }, []);

  if (loading || !data) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 text-center text-zinc-600 text-xs">
        {loading ? 'Scanning market regime across 10 coins...' : 'Regime data unavailable'}
      </div>
    );
  }

  const regimeConfig: Record<string, { color: string; bg: string; icon: string; label: string }> = {
    trending_up: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/25', icon: '📈', label: 'TRENDING UP' },
    trending_down: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/25', icon: '📉', label: 'TRENDING DOWN' },
    ranging: { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/25', icon: '↔️', label: 'RANGING' },
    volatile: { color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/25', icon: '⚡', label: 'VOLATILE' },
  };

  const healthConfig: Record<string, { color: string; label: string }> = {
    excellent: { color: 'text-emerald-400', label: '🟢 EXCELLENT' },
    good: { color: 'text-lime-400', label: '🟢 GOOD' },
    caution: { color: 'text-amber-400', label: '🟡 CAUTION' },
    danger: { color: 'text-red-400', label: '🔴 DANGER' },
  };

  const overallCfg = regimeConfig[data.overallRegime] || regimeConfig.ranging;
  const healthCfg = healthConfig[data.marketHealth] || healthConfig.caution;

  return (
    <div className="space-y-3">
      {/* Overall Market Regime Header */}
      <div className={`rounded-xl border p-4 ${overallCfg.bg}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">{overallCfg.icon}</span>
            <div>
              <div className={`text-sm font-black tracking-wide ${overallCfg.color}`}>{overallCfg.label}</div>
              <div className="text-[10px] text-zinc-500">Overall Market · 4H Timeframe</div>
            </div>
          </div>
          <div className="text-right">
            <div className={`text-sm font-bold ${healthCfg.color}`}>{healthCfg.label}</div>
            <div className="text-[9px] text-zinc-600 uppercase tracking-wider">Market Health</div>
          </div>
        </div>

        {/* Regime Distribution */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-black/20 p-2 text-center">
            <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Trending</div>
            <div className={`text-lg font-black font-mono ${data.trendingCount > 0 ? 'text-emerald-400' : 'text-zinc-600'}`}>
              {data.trendingCount}
            </div>
            <div className="text-[8px] text-zinc-600">coins</div>
          </div>
          <div className="rounded-lg bg-black/20 p-2 text-center">
            <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Ranging</div>
            <div className={`text-lg font-black font-mono ${data.rangingCount > 0 ? 'text-amber-400' : 'text-zinc-600'}`}>
              {data.rangingCount}
            </div>
            <div className="text-[8px] text-zinc-600">coins</div>
          </div>
          <div className="rounded-lg bg-black/20 p-2 text-center">
            <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Volatile</div>
            <div className={`text-lg font-black font-mono ${data.volatileCount > 0 ? 'text-purple-400' : 'text-zinc-600'}`}>
              {data.volatileCount}
            </div>
            <div className="text-[8px] text-zinc-600">coins</div>
          </div>
        </div>
      </div>

      {/* Per-Coin Regime Breakdown */}
      {data.regimes?.length > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-12 gap-1 px-4 py-2 border-b border-zinc-800/50 text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
            <span className="col-span-2">Coin</span>
            <span className="col-span-2 text-center">Regime</span>
            <span className="col-span-1 text-center">ADX</span>
            <span className="col-span-1 text-center">ATR%</span>
            <span className="col-span-1 text-center">EMA</span>
            <span className="col-span-2 text-center">Strategy</span>
            <span className="col-span-1 text-center">Trade</span>
            <span className="col-span-2 text-center">Size ×</span>
          </div>
          {data.regimes.map((r: any, i: number) => {
            const coinCfg = regimeConfig[r.regime] || regimeConfig.ranging;
            const rec = r.recommendations || {};
            return (
              <motion.div
                key={r.symbol}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="grid grid-cols-12 gap-1 px-4 py-2 items-center border-b border-zinc-800/30 hover:bg-zinc-800/30 transition-colors"
              >
                <span className="col-span-2 text-xs font-bold text-zinc-200">
                  {r.symbol?.replace('/USDT', '') || '—'}
                </span>
                <div className="col-span-2 flex justify-center">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${coinCfg.bg.split(' ')[0]} ${coinCfg.color}`}>
                    {coinCfg.icon} {r.regime?.replace('trending_', '↕').replace('_', ' ').toUpperCase() || '—'}
                  </span>
                </div>
                <span className={`col-span-1 text-center text-[10px] font-bold font-mono ${
                  r.adx >= 25 ? 'text-emerald-400' : r.adx >= 20 ? 'text-amber-400' : 'text-zinc-500'
                }`}>{r.adx?.toFixed(0) || '—'}</span>
                <span className={`col-span-1 text-center text-[10px] font-bold font-mono ${
                  r.atrPercent >= 3 ? 'text-red-400' : r.atrPercent >= 1.5 ? 'text-amber-400' : 'text-zinc-400'
                }`}>{r.atrPercent?.toFixed(1) || '—'}%</span>
                <span className={`col-span-1 text-center text-xs font-black ${
                  r.emaAlignment === 'bullish' ? 'text-emerald-400' :
                  r.emaAlignment === 'bearish' ? 'text-red-400' : 'text-zinc-500'
                }`}>
                  {r.emaAlignment === 'bullish' ? '↑' : r.emaAlignment === 'bearish' ? '↓' : '→'}
                </span>
                <span className="col-span-2 text-center text-[9px] font-bold text-cyan-400 capitalize">
                  {rec.strategyType || '—'}
                </span>
                <div className="col-span-1 flex justify-center">
                  <span className={`text-[9px] font-bold ${rec.shouldTrade ? 'text-emerald-400' : 'text-red-400'}`}>
                    {rec.shouldTrade ? '✓' : '✕'}
                  </span>
                </div>
                <span className="col-span-2 text-center text-[10px] font-mono text-zinc-400">
                  {rec.positionSizeMultiplier?.toFixed(1) || '1.0'}
                </span>
              </motion.div>
            );
          })}
          <div className="px-4 py-2 flex items-center justify-between text-[10px] text-zinc-600">
            <span>{data.regimes.length} coins scanned</span>
            <span>{new Date(data.timestamp).toLocaleTimeString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Kelly Position Sizing Sub-Component ────────────────────
function KellyWidget({ userId }: { userId?: string }) {
  const [kelly, setKelly] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    const fetchKelly = async () => {
      try {
        const res = await fetch(`/api/kelly/${userId}`);
        if (res.ok) setKelly(await res.json());
      } catch {}
      finally { setLoading(false); }
    };
    fetchKelly();
    const interval = setInterval(fetchKelly, 5 * 60 * 1000); // Refresh every 5 min
    return () => clearInterval(interval);
  }, [userId]);

  if (!userId || loading) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 text-center text-zinc-600 text-xs">
        {loading ? 'Calculating Kelly sizing...' : 'Log in to see Kelly data'}
      </div>
    );
  }

  const o = kelly?.overall;
  if (!o || o.totalTrades === 0) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 text-center">
        <PieChart className="w-5 h-5 text-zinc-700 mx-auto mb-2" />
        <p className="text-zinc-600 text-xs">No closed trades yet — Kelly sizing activates after your first trades</p>
      </div>
    );
  }

  const edgeColor = o.edge > 0 ? 'text-emerald-400' : o.edge < 0 ? 'text-red-400' : 'text-zinc-500';
  const streakColor = o.streakData?.currentStreak > 0 ? 'text-emerald-400' : o.streakData?.currentStreak < 0 ? 'text-red-400' : 'text-zinc-500';
  const streakIcon = o.streakData?.currentStreak > 0 ? '🔥' : o.streakData?.currentStreak < 0 ? '❄️' : '➖';

  return (
    <div className="rounded-xl border bg-zinc-900/60 border-zinc-800 p-4">
      {/* Top Row: Kelly Fraction + Recommended Risk */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Recommended Risk</div>
          <div className="text-2xl font-black font-mono text-cyan-400">{o.recommendedRiskPercent || 2}%</div>
          <div className="text-[9px] text-zinc-600">Half-Kelly per trade</div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-black font-mono ${edgeColor}`}>
            {o.edge >= 0 ? '+' : ''}${o.edge?.toFixed(2) || '0.00'}
          </div>
          <div className="text-[9px] text-zinc-500 uppercase tracking-wider">Edge / Trade</div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <div className="rounded-lg bg-black/20 p-2 text-center">
          <div className="text-[9px] text-zinc-500 uppercase mb-0.5">Win Rate</div>
          <div className={`text-sm font-black font-mono ${o.winRate >= 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>
            {(o.winRate * 100).toFixed(1)}%
          </div>
          <div className="text-[8px] text-zinc-600">{o.wins}W / {o.losses}L</div>
        </div>
        <div className="rounded-lg bg-black/20 p-2 text-center">
          <div className="text-[9px] text-zinc-500 uppercase mb-0.5">Payoff</div>
          <div className={`text-sm font-black font-mono ${o.payoffRatio >= 1.5 ? 'text-emerald-400' : o.payoffRatio >= 1 ? 'text-amber-400' : 'text-red-400'}`}>
            {o.payoffRatio?.toFixed(2) || '—'}x
          </div>
          <div className="text-[8px] text-zinc-600">Win/Loss</div>
        </div>
        <div className="rounded-lg bg-black/20 p-2 text-center">
          <div className="text-[9px] text-zinc-500 uppercase mb-0.5">Trades</div>
          <div className="text-sm font-black font-mono text-zinc-300">{o.totalTrades}</div>
          <div className="text-[8px] text-zinc-600">{kelly?.dataWindow}</div>
        </div>
        <div className="rounded-lg bg-black/20 p-2 text-center">
          <div className="text-[9px] text-zinc-500 uppercase mb-0.5">Streak</div>
          <div className={`text-sm font-black font-mono ${streakColor}`}>
            {streakIcon} {Math.abs(o.streakData?.currentStreak || 0)}
          </div>
          <div className="text-[8px] text-zinc-600">
            {o.streakData?.currentStreak > 0 ? 'Wins' : o.streakData?.currentStreak < 0 ? 'Losses' : 'Flat'}
          </div>
        </div>
      </div>

      {/* Best Coins */}
      {kelly?.bySymbol?.length > 0 && (
        <div className="border-t border-zinc-800 pt-2">
          <div className="text-[9px] text-zinc-500 uppercase tracking-wider font-semibold mb-1.5">Best Performing Coins</div>
          <div className="flex gap-2">
            {kelly.bySymbol.slice(0, 3).map((s: any) => (
              <div key={s.symbol} className={`flex-1 rounded-lg p-1.5 text-center ${
                s.stats.edge > 0 ? 'bg-emerald-500/5 border border-emerald-500/15' : 'bg-red-500/5 border border-red-500/15'
              }`}>
                <div className="text-[10px] font-bold text-zinc-300">{s.symbol.replace('/USDT', '')}</div>
                <div className={`text-[9px] font-mono font-bold ${
                  s.stats.edge > 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {s.stats.edge >= 0 ? '+' : ''}${s.stats.edge?.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sentiment & News Sub-Component ─────────────────────────
function SentimentWidget() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSentiment = async () => {
      try {
        const res = await fetch('/api/sentiment');
        if (res.ok) {
          const result = await res.json();
          setData(result);
        }
      } catch {} finally { setLoading(false); }
    };
    fetchSentiment();
    const interval = setInterval(fetchSentiment, 4 * 60 * 1000); // Refresh every 4 min
    return () => clearInterval(interval);
  }, []);

  if (loading || !data) return (
    <div className="text-xs text-zinc-600 animate-pulse py-3">
      {loading ? 'Analyzing market sentiment across 3 news sources...' : 'Sentiment data unavailable'}
    </div>
  );

  const score = data.sentimentScore ?? 50;
  const classification = data.classification || 'neutral';

  // Color scheme based on sentiment
  const sentimentConfig: Record<string, { color: string; bg: string; border: string; glow: string; emoji: string }> = {
    extreme_fear:  { color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30', glow: 'shadow-purple-500/20', emoji: '😱' },
    fear:          { color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/30',    glow: 'shadow-red-500/20',    emoji: '😰' },
    neutral:       { color: 'text-zinc-400',   bg: 'bg-zinc-500/10',   border: 'border-zinc-500/30',   glow: 'shadow-zinc-500/20',   emoji: '😐' },
    greed:         { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', glow: 'shadow-emerald-500/20', emoji: '🤑' },
    extreme_greed: { color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/30',  glow: 'shadow-amber-500/20',  emoji: '🔥' },
  };
  const cfg = sentimentConfig[classification] || sentimentConfig.neutral;

  // Gradient bar position (0-100%)
  const barPosition = `${score}%`;

  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-3 shadow-lg ${cfg.glow}`} style={{ backdropFilter: 'blur(8px)' }}>
      {/* Top Row: Score gauge + Classification */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{cfg.emoji}</span>
          <div>
            <div className={`text-xl font-black ${cfg.color} font-mono`}>{score}</div>
            <div className="text-[9px] text-zinc-500 uppercase tracking-wider">{classification.replace(/_/g, ' ')}</div>
          </div>
        </div>
        {data.fearGreedIndex !== null && data.fearGreedIndex !== undefined && (
          <div className="text-right">
            <div className="text-[10px] text-zinc-500">Fear & Greed</div>
            <div className={`text-sm font-bold ${cfg.color} font-mono`}>{data.fearGreedIndex}/100</div>
            <div className="text-[9px] text-zinc-600">{data.fearGreedLabel}</div>
          </div>
        )}
      </div>

      {/* Sentiment Gradient Bar */}
      <div className="relative w-full h-2 rounded-full mb-3" style={{ background: 'linear-gradient(to right, #a855f7, #ef4444, #71717a, #10b981, #f59e0b)' }}>
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-zinc-900 shadow-lg transition-all duration-500"
          style={{ left: barPosition, transform: 'translate(-50%, -50%)' }}
        />
      </div>
      <div className="flex justify-between text-[8px] text-zinc-600 mb-3">
        <span>EXTREME FEAR</span>
        <span>NEUTRAL</span>
        <span>EXTREME GREED</span>
      </div>

      {/* AI Narrative */}
      {data.narrative && (
        <div className="text-[11px] text-zinc-400 leading-relaxed mb-2 border-l-2 border-zinc-700 pl-2">
          {data.narrative}
        </div>
      )}

      {/* Drivers */}
      {data.drivers && data.drivers.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {data.drivers.map((d: string, i: number) => (
            <span key={i} className="text-[9px] px-2 py-0.5 rounded-full bg-zinc-800/80 text-zinc-400 border border-zinc-700/50">
              {d}
            </span>
          ))}
        </div>
      )}

      {/* Footer: Sources + Timestamp */}
      <div className="flex items-center justify-between text-[9px] text-zinc-600 mt-1">
        <span>{data.sources?.join(' · ') || 'No sources'} ({data.headlineCount || 0} headlines)</span>
        <span>{data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : ''}</span>
      </div>
    </div>
  );
}

// ─── Market Intelligence Sub-Component ──────────────────────
function IntelWidget() {
  const [intel, setIntel] = useState<any>(null);

  useEffect(() => {
    const fetchIntel = async () => {
      try {
        const res = await fetch('/api/intel');
        if (res.ok) setIntel(await res.json());
      } catch {}
    };
    fetchIntel();
    const interval = setInterval(fetchIntel, 5 * 60 * 1000); // Refresh every 5 min
    return () => clearInterval(interval);
  }, []);

  if (!intel) {
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 text-center text-zinc-600 text-xs">
        Loading intelligence feed...
      </div>
    );
  }

  const fg = intel.fearGreed;
  const fgColor = fg.value <= 25 ? 'text-red-400' : fg.value <= 40 ? 'text-orange-400' : fg.value <= 60 ? 'text-amber-400' : fg.value <= 75 ? 'text-lime-400' : 'text-emerald-400';
  const fgBg = fg.value <= 25 ? 'bg-red-500/10 border-red-500/20' : fg.value <= 40 ? 'bg-orange-500/10 border-orange-500/20' : fg.value <= 60 ? 'bg-amber-500/10 border-amber-500/20' : fg.value <= 75 ? 'bg-lime-500/10 border-lime-500/20' : 'bg-emerald-500/10 border-emerald-500/20';

  return (
    <div className="grid grid-cols-3 gap-3">
      {/* Fear & Greed */}
      <div className={`rounded-xl border p-3 ${fgBg}`}>
        <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">Fear & Greed</div>
        <div className={`text-2xl font-black font-mono ${fgColor}`}>{fg.value}</div>
        <div className={`text-[11px] font-bold ${fgColor}`}>{fg.label}</div>
        <div className="text-[9px] text-zinc-600 mt-1">
          {fg.trend === 'rising' ? '↑' : fg.trend === 'falling' ? '↓' : '→'} Yesterday: {fg.yesterday}
        </div>
      </div>

      {/* BTC Dominance */}
      <div className="rounded-xl border bg-zinc-900/60 border-zinc-800 p-3">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">BTC Dominance</div>
        <div className="text-2xl font-black font-mono text-cyan-400">{intel.btcDominance?.value || '—'}%</div>
        <div className={`text-[11px] font-bold ${
          intel.btcDominance?.trend === 'rising' ? 'text-amber-400' :
          intel.btcDominance?.trend === 'falling' ? 'text-emerald-400' : 'text-zinc-500'
        }`}>
          {intel.btcDominance?.trend === 'rising' ? '↑ BTC Season' :
           intel.btcDominance?.trend === 'falling' ? '↓ Alt Season' : '→ Stable'}
        </div>
      </div>

      {/* Funding Rates */}
      <div className="rounded-xl border bg-zinc-900/60 border-zinc-800 p-3">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">Funding Rates</div>
        {intel.fundingRates?.slice(0, 3).map((f: any) => (
          <div key={f.symbol} className="flex justify-between items-center text-[10px] py-0.5">
            <span className="text-zinc-400 font-mono">{f.symbol.replace('/USDT', '')}</span>
            <span className={`font-bold font-mono ${
              f.rate > 0.03 ? 'text-red-400' : f.rate < -0.03 ? 'text-emerald-400' : 'text-zinc-500'
            }`}>
              {f.rate > 0 ? '+' : ''}{f.rate}%
            </span>
          </div>
        )) || <span className="text-zinc-700 text-[10px]">No data</span>}
      </div>
    </div>
  );
}

export function JarvisBrain({ isPracticeMode, userId }: JarvisBrainProps) {
  const [activeAgent, setActiveAgent] = useState('scout');
  const [activity, setActivity] = useState(MOCK_ACTIVITY);
  const [swarmStatus, setSwarmStatus] = useState<'idle' | 'scanning' | 'analyzing' | 'executing'>('idle');
  const feedRef = useRef<HTMLDivElement>(null);

  // Goal state
  const [goals, setGoals] = useState<any[]>([]);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalTarget, setGoalTarget] = useState('');
  const [goalCapital, setGoalCapital] = useState('');
  const [creatingGoal, setCreatingGoal] = useState(false);

  // Campaign state (autonomous multi-trade campaigns from Phase 8.5)
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [showHiddenCampaigns, setShowHiddenCampaigns] = useState(false);

  // Scanner state
  const [scanData, setScanData] = useState<any>(null);
  const [scanning, setScanning] = useState(false);

  // Autonomous mode state
  const [autoMode, setAutoMode] = useState(true);

  // Confidence Engine state
  const [confidence, setConfidence] = useState<any>(null);
  const [loadingConfidence, setLoadingConfidence] = useState(false);
  const [learningLoopEnabled, setLearningLoopEnabled] = useState(false);
  const [learningCapital, setLearningCapital] = useState('6000');
  const [learningTarget, setLearningTarget] = useState('15');
  const [learningSymbol, setLearningSymbol] = useState('AUTO'); // 'AUTO' means let Scanner pick
  const [resettingConfidence, setResettingConfidence] = useState(false);

  const fetchAutoStatus = async () => {
    try {
      const res = await fetch('/api/autonomous/status');
      const data = await res.json();
      setAutoMode(data.enabled);
    } catch {}
  };

  const toggleAutoMode = async () => {
    try {
      const res = await fetch('/api/autonomous/toggle', { method: 'PATCH' });
      const data = await res.json();
      setAutoMode(data.enabled);
      toast.success(`Autonomous mode ${data.enabled ? 'ENABLED ✅' : 'DISABLED ⛔'}`);
    } catch {
      toast.error('Failed to toggle autonomous mode');
    }
  };

  const fetchScan = async () => {
    try {
      const res = await fetch('/api/scanner/latest');
      const data = await res.json();
      if (data.allResults) setScanData(data);
    } catch {}
  };

  const triggerScan = async () => {
    setScanning(true);
    toast.loading('🔍 Scanning markets...', { id: 'scan' });
    try {
      const res = await fetch('/api/scanner/scan', { method: 'POST' });
      const data = await res.json();
      if (data.allResults) {
        setScanData(data);
        toast.success(`✅ Scan complete: ${data.marketSentiment}`, { id: 'scan', duration: 4000 });
      }
    } catch {
      toast.error('Scan failed', { id: 'scan' });
    } finally {
      setScanning(false);
    }
  };

  // Real-time goals listener (no orderBy to avoid composite index requirement)
  useEffect(() => {
    if (!userId) return;

    const q = query(
      collection(db, 'tradingGoals'),
      where('userId', '==', userId),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const liveGoals = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      // Sort client-side (newest first)
      liveGoals.sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setGoals(liveGoals);
    }, (error) => {
      console.error('[BRAIN] Goals listener error, falling back to API:', error.message);
      // Fallback: fetch from API if Firestore listener fails
      fetch(`/api/goals/${userId}`)
        .then(r => r.json())
        .then(data => setGoals(data.goals || []))
        .catch(() => {});
    });

    return () => unsubscribe();
  }, [userId]);

  // Real-time campaigns listener (autonomous campaigns from Phase 8.5).
  // No orderBy — sort client-side to avoid a composite-index requirement
  // (same pattern as the goals listener above).
  useEffect(() => {
    if (!userId) return;

    const q = query(
      collection(db, 'campaigns'),
      where('userId', '==', userId),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const liveCampaigns = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      // Newest first, active campaigns float above paused/completed/expired
      const statusRank: Record<string, number> = { active: 0, paused: 1, completed: 2, expired: 3 };
      liveCampaigns.sort((a: any, b: any) => {
        const sa = statusRank[a.status] ?? 9;
        const sb = statusRank[b.status] ?? 9;
        if (sa !== sb) return sa - sb;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
      setCampaigns(liveCampaigns);
    }, (error) => {
      console.error('[BRAIN] Campaigns listener error, falling back to API:', error.message);
      fetch(`/api/campaigns/${userId}`)
        .then(r => r.json())
        .then(data => setCampaigns(data.campaigns || []))
        .catch(() => {});
    });

    return () => unsubscribe();
  }, [userId]);

  // Fetch confidence report
  const fetchConfidence = async () => {
    if (!userId) return;
    setLoadingConfidence(true);
    try {
      const res = await fetch(`/api/confidence/${userId}`);
      const data = await res.json();
      if (data.report) setConfidence(data.report);
      if (typeof data.learningLoopEnabled === 'boolean') setLearningLoopEnabled(data.learningLoopEnabled);
      if (data.learningLoopCapital) setLearningCapital(String(data.learningLoopCapital));
      if (data.learningLoopProfitTarget) setLearningTarget(String(data.learningLoopProfitTarget));
      if (data.learningSymbol) setLearningSymbol(data.learningSymbol);
    } catch {}
    finally { setLoadingConfidence(false); }
  };

  const resetConfidence = async () => {
    if (!userId) return;
    setResettingConfidence(true);
    try {
      await fetch(`/api/confidence/${userId}/reset`, { method: 'POST' });
      setConfidence(null);
      toast.success('Confidence reset to 0% — starting fresh!');
    } catch { toast.error('Reset failed'); }
    finally { setResettingConfidence(false); await fetchConfidence(); }
  };

  const toggleLearningLoop = async (enable: boolean) => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/confidence/${userId}/learning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          enabled: enable, 
          capital: Number(learningCapital), 
          profitTarget: Number(learningTarget),
          symbol: learningSymbol
        }),
      });
      const data = await res.json();
      setLearningLoopEnabled(data.learningLoopEnabled);
      toast.success(enable ? `🎓 Jarvis is now learning autonomously! ($${learningCapital} / $${learningTarget} target on ${learningSymbol})` : 'Learning loop stopped.');
    } catch { toast.error('Failed to toggle learning loop'); }
  };

  useEffect(() => {
    fetchConfidence();
    const interval = setInterval(fetchConfidence, 60 * 1000); // refresh every minute
    return () => clearInterval(interval);
  }, [userId]);

  const createGoal = async () => {
    if (!userId || !goalTarget || !goalCapital) return;
    setCreatingGoal(true);
    try {
      const res = await fetch('/api/goals/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          targetProfit: Number(goalTarget),
          capital: Number(goalCapital),
          isPractice: isPracticeMode,
        }),
      });
      const data = await res.json();
      if (data.goal) {
        setGoals(prev => [data.goal, ...prev]);
        setShowGoalForm(false);
        setGoalTarget('');
        setGoalCapital('');
        toast.success(`🎯 Goal created: $${Number(goalTarget).toLocaleString()} profit!`);
      }
    } catch (err: any) {
      toast.error('Failed to create goal');
    } finally {
      setCreatingGoal(false);
    }
  };

  const deleteGoal = async (goalId: string) => {
    try {
      await fetch(`/api/goals/${goalId}`, { method: 'DELETE' });
      setGoals(prev => prev.filter(g => g.id !== goalId));
      toast.success('Goal deleted');
    } catch (err) {
      toast.error('Failed to delete goal');
    }
  };

  // Campaign control handlers (Phase 8.5 — pause / resume / cancel).
  // The Firestore listener reconciles state, so we just call the API and
  // surface a toast — no local mutation needed.
  const handlePauseCampaign = async (campaignId: string) => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/pause`, { method: 'PATCH' });
      if (!res.ok) throw new Error('pause failed');
      toast.success('Campaign paused');
    } catch {
      toast.error('Failed to pause campaign');
    }
  };
  const handleResumeCampaign = async (campaignId: string) => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/resume`, { method: 'PATCH' });
      if (!res.ok) throw new Error('resume failed');
      toast.success('Campaign resumed');
    } catch {
      toast.error('Failed to resume campaign');
    }
  };
  const handleCancelCampaign = async (campaignId: string, activeCount: number) => {
    const confirmMsg = activeCount > 0
      ? `Cancel this campaign? This will CLOSE ${activeCount} open position${activeCount === 1 ? '' : 's'} and release the capital. This cannot be undone.`
      : 'Cancel this campaign? It has no open positions but will be marked cancelled.';
    if (!window.confirm(confirmMsg)) return;
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'cancel failed');
      toast.success(data.message || 'Campaign cancelled');
    } catch (err: any) {
      toast.error(`Failed to cancel campaign: ${err.message}`);
    }
  };

  // Swarm state
  const [runningSwarm, setRunningSwarm] = useState(false);

  const fetchActivity = async () => {
    try {
      const res = await fetch('/api/swarm/activity');
      const data = await res.json();
      if (data.activity?.length > 0) {
        setActivity(data.activity.map((a: any) => ({
          id: a.id,
          agent: a.agent,
          message: a.message,
          time: new Date(a.timestamp).getTime(),
          type: a.type,
        })));
        // Set active agent to the latest non-system agent
        const latest = [...data.activity].reverse().find((a: any) => a.agent !== 'system');
        if (latest) setActiveAgent(latest.agent);
      }
    } catch {}
  };

  const runSwarm = async () => {
    if (!userId || runningSwarm) return;
    setRunningSwarm(true);
    setSwarmStatus('scanning');
    toast.loading('🧠 Agent Swarm running...', { id: 'swarm-run' });
    try {
      const res = await fetch('/api/swarm/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, isPractice: isPracticeMode }),
      });
      const result = await res.json();
      if (result.executed) {
        toast.success('✅ Trade executed by Agent Swarm!', { id: 'swarm-run', duration: 5000 });
      } else {
        toast.info(`🧠 ${result.reason}`, { id: 'swarm-run', duration: 5000 });
      }
      await fetchActivity();
    } catch (err: any) {
      toast.error('Swarm pipeline failed', { id: 'swarm-run' });
    } finally {
      setRunningSwarm(false);
      setSwarmStatus('idle');
    }
  };

  // Fetch real activity + scanner data + auto status on mount
  useEffect(() => {
    fetchActivity();
    fetchScan();
    fetchAutoStatus();
    const interval = setInterval(() => {
      fetchActivity();
      fetchScan();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Cycle orb through agents if no real activity
  useEffect(() => {
    if (activity.length > 0 && activity[0].id !== '1') return; // skip if real data loaded
    const agentIds = AGENTS.map(a => a.id);
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % agentIds.length;
      setActiveAgent(agentIds[idx]);
    }, 4000);
    return () => clearInterval(interval);
  }, [activity]);

  // Auto-scroll activity feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [activity]);

  const getAgentColor = (agentId: string) => {
    return AGENTS.find(a => a.id === agentId)?.color || '#888';
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'signal': return '📡';
      case 'action': return '🎯';
      case 'approval': return '✅';
      case 'veto': return '🚫';
      case 'execution': return '⚡';
      default: return '💬';
    }
  };

  return (
    <div className="brain-container">
      {/* Scan Line Effect */}
      <div className="brain-scanline" />

      {/* Header */}
      <div className="brain-header">
        <div className="brain-header-left">
          <Brain className="w-6 h-6 text-cyan-400" />
          <h1 className="brain-title">JARVIS BRAIN</h1>
          <span className="brain-subtitle">Mission Control</span>
        </div>
        <div className="brain-header-right">
          <button
            onClick={runSwarm}
            disabled={runningSwarm}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
              runningSwarm
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 animate-pulse cursor-not-allowed'
                : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/20'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            {runningSwarm ? 'RUNNING...' : 'RUN SWARM'}
          </button>
          <button
            onClick={toggleAutoMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              autoMode
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                : 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20'
            }`}
          >
            <Power className={`w-3 h-3 ${autoMode ? 'animate-pulse' : ''}`} />
            {autoMode ? 'AUTO: ON' : 'AUTO: OFF'}
          </button>
          <div className={`brain-status-pill ${swarmStatus !== 'idle' ? 'active' : ''}`}>
            {swarmStatus !== 'idle' ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-zinc-500" />
            )}
            <span className={swarmStatus !== 'idle' ? 'text-emerald-400' : 'text-zinc-500'}>
              {swarmStatus === 'idle' ? 'STANDBY' : swarmStatus.toUpperCase()}
            </span>
          </div>
          <div className={`brain-mode-pill ${isPracticeMode ? 'practice' : 'live'}`}>
            {isPracticeMode ? '🧪 PRACTICE' : '🔴 LIVE'}
          </div>
        </div>
      </div>

      {/* ─── Jarvis Confidence Widget ─── */}
      {isPracticeMode && (
        <div style={{ position: 'relative', zIndex: 2, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-semibold text-zinc-300 tracking-wide">JARVIS CONFIDENCE</span>
              {learningLoopEnabled && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  LEARNING
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={resetConfidence}
                disabled={resettingConfidence}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs hover:bg-red-500/20 transition-colors"
              >
                {resettingConfidence ? <RefreshCw className="w-3 h-3 animate-spin" /> : '↺'} Reset
              </button>
              <button
                onClick={fetchConfidence}
                disabled={loadingConfidence}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs hover:bg-zinc-700 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${loadingConfidence ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {confidence ? (
            <div className="rounded-xl border bg-zinc-900/60 border-zinc-800 p-4">
              {/* Score Ring + Label */}
              <div className="flex items-center gap-4 mb-4">
                <div className="relative flex-shrink-0" style={{ width: 72, height: 72 }}>
                  <svg width="72" height="72" viewBox="0 0 72 72">
                    <circle cx="36" cy="36" r="30" fill="none" stroke="#27272a" strokeWidth="7" />
                    <circle
                      cx="36" cy="36" r="30" fill="none"
                      stroke={confidence.score >= 100 ? '#10b981' : confidence.score >= 75 ? '#f59e0b' : confidence.score >= 50 ? '#3b82f6' : '#ef4444'}
                      strokeWidth="7"
                      strokeDasharray={`${(confidence.score / 100) * 188.5} 188.5`}
                      strokeLinecap="round"
                      transform="rotate(-90 36 36)"
                      style={{ transition: 'stroke-dasharray 0.8s ease' }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-black text-white">{confidence.score}%</span>
                  </div>
                </div>
                <div className="flex-1">
                  {confidence.isReadyForLive ? (
                    <div className="text-emerald-400 font-bold text-sm mb-1">🏆 LIVE TRADING READY</div>
                  ) : (
                    <div className="text-zinc-300 font-semibold text-sm mb-1">Paper Trading Mode</div>
                  )}
                  <p className="text-zinc-500 text-xs leading-relaxed">{confidence.message}</p>
                </div>
              </div>

              {/* Metric breakdown */}
              <div className="space-y-2">
                {confidence.breakdown?.map((b: any) => (
                  <div key={b.name}>
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-[11px] text-zinc-400 font-medium">{b.name}</span>
                      <span className={`text-[11px] font-bold ${
                        b.status === 'pass' ? 'text-emerald-400' :
                        b.status === 'partial' ? 'text-amber-400' : 'text-red-400'
                      }`}>{b.detail}</span>
                    </div>
                    <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.min(100, b.score)}%`,
                          background: b.status === 'pass' ? '#10b981' : b.status === 'partial' ? '#f59e0b' : '#ef4444'
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Key stats row */}
              <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-zinc-800">
                <div className="text-center">
                  <div className="text-xs font-black text-white">{confidence.metrics?.totalTrades || 0}</div>
                  <div className="text-[9px] text-zinc-500 uppercase tracking-wide">Trades</div>
                </div>
                <div className="text-center">
                  <div className="text-xs font-black text-emerald-400">{confidence.metrics?.winRate || 0}%</div>
                  <div className="text-[9px] text-zinc-500 uppercase tracking-wide">Win Rate</div>
                </div>
                <div className="text-center">
                  <div className={`text-xs font-black ${(confidence.metrics?.totalPnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    ${confidence.metrics?.totalPnl || 0}
                  </div>
                  <div className="text-[9px] text-zinc-500 uppercase tracking-wide">Total P&L</div>
                </div>
              </div>

              {/* Learning loop controls */}
              <div className="mt-4 pt-3 border-t border-zinc-800">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Autonomous Learning</div>
                <div className="flex gap-2 mb-2">
                  <div className="flex-1">
                    <div className="text-[9px] text-zinc-600 mb-1">Capital ($)</div>
                    <input
                      type="number"
                      value={learningCapital}
                      onChange={e => setLearningCapital(e.target.value)}
                      disabled={learningLoopEnabled}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="text-[9px] text-zinc-600 mb-1">Target ($)</div>
                    <input
                      type="number"
                      value={learningTarget}
                      onChange={e => setLearningTarget(e.target.value)}
                      disabled={learningLoopEnabled}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  <div className="flex-1">
                    <div className="text-[9px] text-zinc-600 mb-1">Coin</div>
                    <select
                      value={learningSymbol}
                      onChange={e => setLearningSymbol(e.target.value)}
                      disabled={learningLoopEnabled}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500/50 appearance-none"
                    >
                      <option value="AUTO">Auto-Scan</option>
                      <option value="BTCUSDT">BTCUSDT</option>
                      <option value="ETHUSDT">ETHUSDT</option>
                      <option value="SOLUSDT">SOLUSDT</option>
                      <option value="SUIUSDT">SUIUSDT</option>
                      <option value="XRPUSDT">XRPUSDT</option>
                      <option value="DOGEUSDT">DOGEUSDT</option>
                    </select>
                  </div>
                </div>
                <button
                  onClick={() => toggleLearningLoop(!learningLoopEnabled)}
                  className={`w-full py-2 rounded-lg text-xs font-bold transition-all ${
                    learningLoopEnabled
                      ? 'bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25'
                      : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25'
                  }`}
                >
                  {learningLoopEnabled ? '⛔ Stop Learning' : '🎓 Start Autonomous Learning'}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border bg-zinc-900/60 border-zinc-800 p-4 text-center text-zinc-600 text-xs">
              {loadingConfidence ? 'Evaluating Jarvis performance...' : 'No confidence data yet. Complete paper trades to start.'}
            </div>
          )}
        </div>
      )}

      {/* Goal Tracker Widget */}
      <div className="brain-goal-section" style={{ position: 'relative', zIndex: 2, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-zinc-300 tracking-wide">MISSION OBJECTIVES</span>
          </div>
          <button
            onClick={() => setShowGoalForm(!showGoalForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold hover:bg-amber-500/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Goal
          </button>
        </div>

        {/* Goal Creation Form */}
        <AnimatePresence>
          {showGoalForm && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 mb-3 flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1 block">Target Profit ($)</label>
                  <input
                    type="number"
                    value={goalTarget}
                    onChange={e => setGoalTarget(e.target.value)}
                    placeholder="5000"
                    className="w-full bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono focus:border-amber-500/50 outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1 block">Starting Capital ($)</label>
                  <input
                    type="number"
                    value={goalCapital}
                    onChange={e => setGoalCapital(e.target.value)}
                    placeholder="50000"
                    className="w-full bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono focus:border-amber-500/50 outline-none"
                  />
                </div>
                <button
                  onClick={createGoal}
                  disabled={creatingGoal || !goalTarget || !goalCapital}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm rounded-lg transition-colors disabled:opacity-40"
                >
                  {creatingGoal ? 'Creating...' : '🚀 Set Goal'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active Goals */}
        {goals.length > 0 ? (
          <div className="space-y-3">
            {goals.slice(0, 3).map((goal: any) => {
              const progress = Math.max(0, Math.min(100, (goal.currentProgress / goal.targetProfit) * 100));
              const isComplete = goal.status === 'completed';
              return (
                <motion.div
                  key={goal.id}
                  className={`bg-zinc-900/60 border rounded-xl p-4 ${
                    isComplete ? 'border-emerald-500/40' : 'border-zinc-800'
                  }`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {isComplete ? (
                        <Trophy className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Target className="w-4 h-4 text-amber-400" />
                      )}
                      <span className="text-sm font-bold text-zinc-200 font-mono">
                        ${goal.currentProgress?.toLocaleString() || '0'} / ${goal.targetProfit?.toLocaleString()}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                        goal.riskLevel === 'conservative' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                        goal.riskLevel === 'aggressive' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                        'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}>
                        {goal.riskLevel}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-mono font-bold ${
                        isComplete ? 'text-emerald-400' : 'text-zinc-400'
                      }`}>
                        {progress.toFixed(1)}%
                      </span>
                      <button
                        onClick={() => deleteGoal(goal.id)}
                        className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete Goal"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden mb-3">
                    <motion.div
                      className={`absolute inset-y-0 left-0 rounded-full ${
                        isComplete ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-500 to-amber-400'
                      }`}
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 1, ease: 'easeOut' }}
                    />
                    {goal.milestones?.map((m: any, i: number) => (
                      <div
                        key={i}
                        className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full ${
                          m.reached ? 'bg-emerald-400' : 'bg-zinc-600'
                        }`}
                        style={{ left: `${(m.target / goal.targetProfit) * 100}%` }}
                      />
                    ))}
                  </div>

                  <p className="text-xs text-zinc-500 leading-relaxed" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {goal.strategy}
                  </p>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 bg-zinc-900/40 border border-zinc-800/50 rounded-xl">
            <Crosshair className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
            <p className="text-zinc-600 text-xs">No active goals. Click "New Goal" to set a profit target!</p>
          </div>
        )}
      </div>

      {/* Active Campaigns (Phase 8.5 — autonomous multi-trade campaigns) */}
      {campaigns.length > 0 && (() => {
        const activeList = campaigns.filter((c: any) => c.status === 'active');
        const hiddenList = campaigns.filter((c: any) => c.status !== 'active');

        const renderCampaign = (c: any) => {
          const realized = c.realizedProfit ?? 0;
          const target = c.targetProfit ?? 1;
          const progress = Math.max(0, Math.min(100, (realized / target) * 100));
          const isActive    = c.status === 'active';
          const isComplete  = c.status === 'completed';
          const isPaused    = c.status === 'paused';
          const isExpired   = c.status === 'expired';
          const isCancelled = c.status === 'cancelled';
          const isTerminal  = isComplete || isExpired || isCancelled;
          const activeCount = (c.activeTradeIds || []).length;
          const completedCount = (c.completedTradeIds || []).length;

          const msLeft = c.deadline ? new Date(c.deadline).getTime() - Date.now() : 0;
          const hoursLeft = msLeft / 3_600_000;
          const deadlineStr = msLeft <= 0
            ? 'expired'
            : hoursLeft < 24
              ? `${hoursLeft.toFixed(1)}h left`
              : `${(hoursLeft / 24).toFixed(1)}d left`;

          const urgencyConfig: Record<string, { color: string; bg: string }> = {
            relaxed:  { color: 'text-blue-400',  bg: 'bg-blue-500/10 border-blue-500/20' },
            normal:   { color: 'text-zinc-400',  bg: 'bg-zinc-700/30 border-zinc-600/30' },
            urgent:   { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
            critical: { color: 'text-red-400',   bg: 'bg-red-500/10 border-red-500/20' },
          };
          const urgCfg = urgencyConfig[c.urgency] || urgencyConfig.normal;

          return (
            <motion.div
              key={c.id}
              className={`bg-zinc-900/60 border rounded-xl p-4 ${
                isComplete  ? 'border-emerald-500/40' :
                isExpired   ? 'border-red-500/30' :
                isCancelled ? 'border-zinc-700 opacity-60' :
                isPaused    ? 'border-zinc-700' :
                              'border-cyan-500/20'
              }`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {isComplete  ? <Trophy className="w-4 h-4 text-emerald-400" /> :
                   isPaused    ? <Pause className="w-4 h-4 text-zinc-500" /> :
                   isCancelled ? <Trash2 className="w-4 h-4 text-zinc-600" /> :
                                 <Zap className="w-4 h-4 text-cyan-400" />}
                  <span className="text-sm font-bold text-zinc-200 font-mono">
                    ${realized.toFixed(2)} / ${target.toLocaleString()}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider border ${urgCfg.bg} ${urgCfg.color}`}>
                    {c.urgency || 'normal'}
                  </span>
                  {!isActive && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wider bg-zinc-800 text-zinc-500 border border-zinc-700">
                      {c.status}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-mono font-bold ${
                    isComplete    ? 'text-emerald-400' :
                    realized < 0  ? 'text-red-400' :
                                    'text-zinc-400'
                  }`}>
                    {progress.toFixed(1)}%
                  </span>
                  {/* Action buttons — terminal states get none */}
                  {!isTerminal && (
                    <div className="flex items-center gap-1 ml-2">
                      {isActive ? (
                        <button
                          onClick={() => handlePauseCampaign(c.id)}
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                          title="Pause — stops new deployments, keeps existing positions running"
                        >
                          <Pause className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleResumeCampaign(c.id)}
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                          title="Resume — start opening new trades again"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => handleCancelCampaign(c.id, activeCount)}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title={`Cancel — closes ${activeCount} open position${activeCount === 1 ? '' : 's'} and frees the capital`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden mb-3">
                <motion.div
                  className={`absolute inset-y-0 left-0 rounded-full ${
                    isComplete   ? 'bg-emerald-500' :
                    realized < 0 ? 'bg-red-500/60' :
                                   'bg-gradient-to-r from-cyan-500 to-cyan-400'
                  }`}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.abs(progress)}%` }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                />
              </div>

              {/* Stats row */}
              <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                <span>
                  <span className="text-cyan-400">{activeCount}</span> active /
                  <span className="text-zinc-400"> {completedCount}</span> closed
                </span>
                <span>${(c.availableCapital ?? 0).toFixed(0)} free</span>
                <span className={msLeft > 0 && msLeft <= 6 * 3_600_000 ? 'text-amber-400' : 'text-zinc-500'}>
                  ⏳ {deadlineStr}
                </span>
              </div>
            </motion.div>
          );
        };

        return (
          <div style={{ position: 'relative', zIndex: 2, marginBottom: 16 }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-semibold text-zinc-300 tracking-wide">ACTIVE CAMPAIGNS</span>
                <span className="text-[10px] text-zinc-600">
                  ({activeList.length} running{hiddenList.length > 0 ? `, ${hiddenList.length} hidden` : ''})
                </span>
              </div>
            </div>

            {activeList.length > 0 ? (
              <div className="space-y-3">
                {activeList.slice(0, 5).map(renderCampaign)}
              </div>
            ) : (
              <div className="text-center py-4 bg-zinc-900/40 border border-zinc-800/50 rounded-xl">
                <p className="text-zinc-600 text-xs">No active campaigns. Start one via voice: <span className="text-zinc-400">"Hey Jarvis, make me $200 from $5000 by tomorrow."</span></p>
              </div>
            )}

            {hiddenList.length > 0 && (
              <div className="mt-3">
                <button
                  onClick={() => setShowHiddenCampaigns(v => !v)}
                  className="w-full py-2 text-[11px] text-zinc-500 hover:text-zinc-300 border border-dashed border-zinc-800 hover:border-zinc-700 rounded-lg transition-colors"
                >
                  {showHiddenCampaigns ? '▲ Hide' : '▼ Show'} {hiddenList.length} paused / completed / cancelled
                </button>
                {showHiddenCampaigns && (
                  <div className="space-y-3 mt-3">
                    {hiddenList.slice(0, 10).map(renderCampaign)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Market Intelligence Widget */}
      <div style={{ position: 'relative', zIndex: 2, marginBottom: 16 }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-semibold text-zinc-300 tracking-wide">📡 MARKET INTELLIGENCE</span>
        </div>
        <IntelWidget />
      </div>

      {/* Market Regime Widget */}
      <div style={{ position: 'relative', zIndex: 2, marginBottom: 16 }}>
        <div className="flex items-center gap-2 mb-3">
          <Gauge className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-semibold text-zinc-300 tracking-wide">MARKET REGIME</span>
        </div>
        <RegimeWidget />
      </div>

      {/* Kelly Position Sizing Widget */}
      <div style={{ position: 'relative', zIndex: 2, marginBottom: 16 }}>
        <div className="flex items-center gap-2 mb-3">
          <PieChart className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-zinc-300 tracking-wide">KELLY POSITION SIZING</span>
        </div>
        <KellyWidget userId={userId} />
      </div>

      {/* Sentiment & News Widget */}
      <div style={{ position: 'relative', zIndex: 2, marginBottom: 16 }}>
        <div className="flex items-center gap-2 mb-3">
          <Newspaper className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-zinc-300 tracking-wide">MARKET SENTIMENT</span>
        </div>
        <SentimentWidget />
      </div>

      {/* Market Scanner Widget */}
      <div style={{ position: 'relative', zIndex: 2, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-zinc-300 tracking-wide">MARKET SCANNER</span>
            {scanData && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500 font-mono">
                {scanData.totalPairs} pairs
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {scanData && (
              <span className={`text-xs font-bold px-2 py-1 rounded-lg ${
                scanData.marketSentiment?.includes('Bullish') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                scanData.marketSentiment?.includes('Bearish') ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                'bg-zinc-800 text-zinc-400 border border-zinc-700'
              }`}>
                {scanData.marketSentiment}
              </span>
            )}
            <button
              onClick={triggerScan}
              disabled={scanning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Scanning...' : 'Scan Now'}
            </button>
          </div>
        </div>

        {scanData?.topOpportunities?.length > 0 ? (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-zinc-800/50 text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
              <span className="col-span-2">Pair</span>
              <span className="col-span-2 text-right">Price</span>
              <span className="col-span-1 text-right">24h</span>
              <span className="col-span-1 text-center">RSI</span>
              <span className="col-span-1 text-center">TA</span>
              <span className="col-span-1 text-center">Score</span>
              <span className="col-span-4">Signal</span>
            </div>
            {scanData.topOpportunities.slice(0, 5).map((opp: any, i: number) => (
              <motion.div
                key={opp.symbol}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center border-b border-zinc-800/30 hover:bg-zinc-800/30 transition-colors"
              >
                <div className="col-span-2 flex flex-col justify-center">
                  <div className="flex items-center gap-1.5">
                    {opp.change24h >= 0 ? (
                      <TrendingUp className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <TrendingDown className="w-3 h-3 text-red-400" />
                    )}
                    <span className="text-xs font-bold text-zinc-200">{opp.symbol}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5 ml-[18px]">
                    {opp.vwap !== undefined && (
                      opp.price > opp.vwap ? (
                        <span className="text-[8px] font-bold text-emerald-400">
                          VWAP ▲
                        </span>
                      ) : (
                        <span className="text-[8px] font-medium text-zinc-500">
                          VWAP ▼
                        </span>
                      )
                    )}
                    {opp.obvSlope && (
                      opp.obvSlope === 'up' ? (
                        <span className="text-[8px] font-bold text-emerald-400 ml-1">
                          OBV ▲
                        </span>
                      ) : opp.obvSlope === 'down' ? (
                        <span className="text-[8px] font-medium text-zinc-500 ml-1">
                          OBV ▼
                        </span>
                      ) : (
                        <span className="text-[8px] font-medium text-zinc-500 ml-1">
                          OBV ▬
                        </span>
                      )
                    )}
                  </div>
                </div>
                <span className="col-span-2 text-right text-xs font-mono text-zinc-300">
                  ${opp.price >= 1000 ? opp.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : opp.price.toFixed(4)}
                </span>
                <span className={`col-span-1 text-right text-xs font-mono font-bold ${
                  opp.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {opp.change24h >= 0 ? '+' : ''}{opp.change24h.toFixed(1)}%
                </span>
                <div className="col-span-1 flex justify-center">
                  {opp.rsi ? (
                    <span className={`text-[10px] font-bold font-mono ${
                      opp.rsi < 30 ? 'text-emerald-400' :
                      opp.rsi > 70 ? 'text-red-400' :
                      'text-zinc-400'
                    }`}>
                      {opp.rsi}
                    </span>
                  ) : <span className="text-[10px] text-zinc-700">—</span>}
                </div>
                <div className="col-span-1 flex justify-center">
                  {opp.confluence ? (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      opp.confluence.includes('buy') ? 'bg-emerald-500/15 text-emerald-400' :
                      opp.confluence.includes('sell') ? 'bg-red-500/15 text-red-400' :
                      'bg-zinc-700/50 text-zinc-500'
                    }`}>
                      {opp.confluence.replace('strong_', '↑').replace('_', ' ').toUpperCase()}
                    </span>
                  ) : <span className="text-[10px] text-zinc-700">—</span>}
                </div>
                <div className="col-span-1 flex justify-center">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    opp.score >= 80 ? 'bg-emerald-500/15 text-emerald-400' :
                    opp.score >= 65 ? 'bg-amber-500/15 text-amber-400' :
                    'bg-zinc-700 text-zinc-400'
                  }`}>
                    {opp.score}
                  </span>
                </div>
                <span className="col-span-4 text-[11px] text-zinc-500 truncate">
                  {opp.signal || `${opp.momentum} momentum`}
                </span>
              </motion.div>
            ))}
            {scanData && (
              <div className="px-4 py-2 flex items-center justify-between text-[10px] text-zinc-600">
                <span>🟢 {scanData.bullish} bullish · 🔴 {scanData.bearish} bearish · ⚪ {scanData.neutral} neutral</span>
                <span>{new Date(scanData.timestamp).toLocaleTimeString()}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6 bg-zinc-900/40 border border-zinc-800/50 rounded-xl">
            <Radio className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
            <p className="text-zinc-600 text-xs">Scanner initializing... first scan runs 15s after startup</p>
          </div>
        )}
      </div>

      {/* Main Grid: Agent Cards + Center Orb */}
      <div className="brain-grid">
        {/* Top Row Agents */}
        <div className="brain-agents-row">
          {AGENTS.slice(0, 3).map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isActive={activeAgent === agent.id}
              onClick={() => setActiveAgent(agent.id)}
            />
          ))}
        </div>

        {/* Center Jarvis Orb */}
        <div className="brain-center">
          <motion.div
            className="brain-orb-container"
            animate={{
              boxShadow: `0 0 60px ${getAgentColor(activeAgent)}40, 0 0 120px ${getAgentColor(activeAgent)}20`,
            }}
            transition={{ duration: 1.5, ease: 'easeInOut' }}
          >
            <motion.div
              className="brain-orb"
              animate={{
                background: `radial-gradient(circle at 40% 40%, ${getAgentColor(activeAgent)}80, ${getAgentColor(activeAgent)}20, transparent)`,
              }}
              transition={{ duration: 1.5, ease: 'easeInOut' }}
            >
              <motion.div
                className="brain-orb-ring"
                animate={{ rotate: 360 }}
                transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                style={{ borderColor: `${getAgentColor(activeAgent)}40` }}
              />
              <motion.div
                className="brain-orb-ring-2"
                animate={{ rotate: -360 }}
                transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
                style={{ borderColor: `${getAgentColor(activeAgent)}25` }}
              />
              <div className="brain-orb-label">
                <Brain className="w-5 h-5" style={{ color: getAgentColor(activeAgent) }} />
                <span style={{ color: getAgentColor(activeAgent) }}>
                  {AGENTS.find(a => a.id === activeAgent)?.name || 'JARVIS'}
                </span>
              </div>
            </motion.div>

            {/* Connection Lines */}
            {AGENTS.map((agent, i) => (
              <motion.div
                key={agent.id}
                className="brain-connection-line"
                style={{
                  transform: `rotate(${i * 60 - 90}deg)`,
                  transformOrigin: '0% 50%',
                }}
                animate={{
                  opacity: activeAgent === agent.id ? 1 : 0.15,
                  background: activeAgent === agent.id
                    ? `linear-gradient(90deg, ${agent.color}60, transparent)`
                    : 'linear-gradient(90deg, rgba(255,255,255,0.1), transparent)',
                }}
                transition={{ duration: 0.8 }}
              />
            ))}
          </motion.div>
        </div>

        {/* Bottom Row Agents */}
        <div className="brain-agents-row">
          {AGENTS.slice(3, 6).map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isActive={activeAgent === agent.id}
              onClick={() => setActiveAgent(agent.id)}
            />
          ))}
        </div>
      </div>

      {/* Activity Feed */}
      <div className="brain-feed">
        <div className="brain-feed-header">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span>Decision Feed</span>
          <div className="brain-feed-live">
            <div className="brain-feed-live-dot" />
            LIVE
          </div>
        </div>
        <div className="brain-feed-content" ref={feedRef}>
          {activity.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="brain-feed-item"
            >
              <span className="brain-feed-time">
                {new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span
                className="brain-feed-agent"
                style={{ color: getAgentColor(item.agent) }}
              >
                [{AGENTS.find(a => a.id === item.agent)?.name?.toUpperCase() || 'SYSTEM'}]
              </span>
              <span className="brain-feed-icon">{getActivityIcon(item.type)}</span>
              <span className="brain-feed-message">{item.message}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Agent Card sub-component
function AgentCard({
  agent,
  isActive,
  onClick,
}: {
  agent: typeof AGENTS[0];
  isActive: boolean;
  onClick: () => any;
  key?: string;
}) {
  const Icon = agent.icon;

  return (
    <motion.div
      onClick={onClick}
      className={`brain-agent-card ${isActive ? 'active' : ''}`}
      style={{
        '--agent-color': agent.color,
        borderColor: isActive ? `${agent.color}60` : undefined,
        boxShadow: isActive ? `0 0 30px ${agent.color}20, inset 0 0 30px ${agent.color}08` : undefined,
      } as React.CSSProperties}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      layout
    >
      {/* Active indicator pulse */}
      {isActive && (
        <motion.div
          className="brain-agent-pulse"
          style={{ backgroundColor: agent.color }}
          animate={{ opacity: [0.6, 0.2, 0.6] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}

      <div className="brain-agent-header">
        <div className="brain-agent-icon" style={{ backgroundColor: `${agent.color}15`, borderColor: `${agent.color}30` }}>
          <Icon className="w-5 h-5" style={{ color: agent.color }} />
        </div>
        <div>
          <h3 className="brain-agent-name" style={{ color: isActive ? agent.color : undefined }}>
            {agent.name}
          </h3>
          <p className="brain-agent-role">{agent.role}</p>
        </div>
      </div>

      <p className="brain-agent-desc">{agent.description}</p>

      <div className="brain-agent-status">
        <div className={`brain-agent-status-dot ${isActive ? 'active' : ''}`} style={{ backgroundColor: isActive ? agent.color : undefined }} />
        <span>{isActive ? 'ACTIVE' : 'STANDBY'}</span>
      </div>
    </motion.div>
  );
}

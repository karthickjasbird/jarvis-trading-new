import { useState, useEffect, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldAlert, Save, AlertTriangle, ShieldCheck, Activity,
  TrendingDown, Crosshair, Flame, Ban, Brain, RefreshCw,
  ChevronDown, ChevronUp, Eye, DollarSign, Target
} from 'lucide-react';
import { toast } from 'sonner';

interface RiskSettings {
  maxDailyLoss: number;
  maxPositionSizePct: number;
  autoLiquidateThreshold: number;
  maxOpenPositions: number;
  capitalPerTrade: number;
  profitTarget: number;
  approvalTtlMinutes: number;
  approvalMaxDriftPercent: number;
  maxLiveCapital: number;
  maxLeverage?: { crypto?: number; stock?: number };
  bleedHoursEnabled?: boolean;
  bleedStartHourIST?: number;  // 0-23
  bleedEndHourIST?: number;    // 0-23
  bleedConfidenceFloor?: number; // 60-100
  autoNavigateTV?: boolean;    // Auto-flip TV chart to symbol swarm is analyzing
  autoProtectOrphans?: boolean; // Phase 9 (Tier B #2): auto-place 3% SL on orphan positions discovered at boot
  // v1.7.0 — rules-engine timeframe enables. Persisted to riskSettings; the
  // orchestrator reads them at scan time. Swing/intraday default OFF until the
  // user has paper-watched a few clean lifecycles.
  strategies?: {
    position?: { enabled?: boolean };
    swing?: { enabled?: boolean; timeframe?: '4h' | '1h' };
    intraday?: { enabled?: boolean };
  };
}

interface DashboardData {
  settings: RiskSettings;
  portfolio: {
    openPositions: any[];
    openCount: number;
    maxPositions: number;
    portfolioHeat: number;
    worstCaseLoss: number;
    totalUnrealized: number;
  };
  today: {
    realizedPnl: number;
    trades: number;
    wins: number;
    losses: number;
    dailyLossProgress: number;
    dailyLossLimit: number;
  };
  riskGrade: { grade: string; color: string; issues: string[] };
  riskEvents: any[];
}

const gradeColors: Record<string, string> = {
  emerald: '#10b981',
  blue: '#3b82f6',
  amber: '#f59e0b',
  orange: '#f97316',
  red: '#ef4444',
};

export function RiskManager({ userId }: { userId: string }) {
  const [settings, setSettings] = useState<RiskSettings>({
    maxDailyLoss: 1000,
    maxPositionSizePct: 10,
    autoLiquidateThreshold: 300,
    maxOpenPositions: 5,
    capitalPerTrade: 8000,
    profitTarget: 0,
    approvalTtlMinutes: 5,
    approvalMaxDriftPercent: 0.5,
    maxLiveCapital: 50,
    maxLeverage: { crypto: 10, stock: 1 },
    bleedHoursEnabled: false, // Phase 9 (#10) — demoted to advisory; default OFF
    bleedStartHourIST: 17, // 5 PM IST
    bleedEndHourIST: 0,    // 12 AM IST
    bleedConfidenceFloor: 75,
    autoNavigateTV: true,
    autoProtectOrphans: true, // Phase 9 (Tier B #2) — auto-place 3% SL on discovered orphan positions at boot
  });
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [audit, setAudit] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isAuditing, setIsAuditing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showEvents, setShowEvents] = useState(false);

  // Fetch dashboard data
  const fetchDashboard = async () => {
    try {
      const res = await fetch(`/api/risk-dashboard?userId=${userId}`);
      const data = await res.json();
      if (data.settings) {
        setDashboard(data);
        setSettings(data.settings);
      }
    } catch (err) {
      console.error('Failed to fetch risk dashboard:', err);
    }
  };

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, [userId]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await fetch('/api/risk-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, settings }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success('Risk parameters saved');
      fetchDashboard();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const runAudit = async () => {
    setIsAuditing(true);
    setAudit(null);
    try {
      const res = await fetch(`/api/risk-audit?userId=${userId}`);
      const data = await res.json();
      if (data.audit) setAudit(data.audit);
    } catch {
      toast.error('Audit failed');
    } finally {
      setIsAuditing(false);
    }
  };

  const d = dashboard;
  const gradeColor = d ? gradeColors[d.riskGrade.color] || '#71717a' : '#71717a';

  return (
    <div className="w-full max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
            <ShieldAlert className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-zinc-100">Risk Command Center</h2>
            <p className="text-zinc-500 text-xs">Live portfolio protection & guardrails</p>
          </div>
        </div>
        <button
          onClick={fetchDashboard}
          className="p-2 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* ─── TOP ROW: Risk Grade + Live Stats ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Risk Grade */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 flex items-center gap-3"
        >
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-black"
            style={{ background: `${gradeColor}15`, border: `1px solid ${gradeColor}40`, color: gradeColor }}
          >
            {d?.riskGrade.grade || '—'}
          </div>
          <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Risk Grade</div>
            <div className="text-sm text-zinc-300 font-medium">
              {!d ? 'Loading...' : (d.riskGrade.issues?.length || 0) === 0 ? 'All Clear' : `${d.riskGrade.issues.length} issue${d.riskGrade.issues.length > 1 ? 's' : ''}`}
            </div>
          </div>
        </motion.div>

        {/* Open Positions */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4"
        >
          <div className="flex items-center gap-1.5 text-zinc-500 mb-1">
            <Crosshair className="w-3.5 h-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">Positions</span>
          </div>
          <div className="text-xl font-black text-zinc-100">
            {d?.portfolio.openCount || 0}<span className="text-sm text-zinc-500 font-normal">/{d?.portfolio.maxPositions || 5}</span>
          </div>
        </motion.div>

        {/* Portfolio Heat */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4"
        >
          <div className="flex items-center gap-1.5 text-zinc-500 mb-1">
            <Flame className="w-3.5 h-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">Portfolio Heat</span>
          </div>
          <div className={`text-xl font-black ${(d?.portfolio.portfolioHeat || 0) > 6 ? 'text-red-400' : 'text-emerald-400'}`}>
            {(d?.portfolio.portfolioHeat || 0).toFixed(1)}%
          </div>
        </motion.div>

        {/* Worst Case */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4"
        >
          <div className="flex items-center gap-1.5 text-zinc-500 mb-1">
            <TrendingDown className="w-3.5 h-3.5" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">Worst Case</span>
          </div>
          <div className="text-xl font-black text-red-400">
            -${(d?.portfolio.worstCaseLoss || 0).toFixed(0)}
          </div>
          <div className="text-[9px] text-zinc-600">if all SLs hit</div>
        </motion.div>
      </div>

      {/* ─── DAILY LOSS PROGRESS BAR ─── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Ban className="w-4 h-4 text-zinc-500" />
            <span className="text-xs font-semibold text-zinc-400">Daily Loss Limit</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className={`font-bold font-mono ${(d?.today.realizedPnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              Today: {(d?.today.realizedPnl || 0) >= 0 ? '+' : ''}${(d?.today.realizedPnl || 0).toFixed(2)}
            </span>
            <span className="text-zinc-500">|</span>
            <span className="text-zinc-400 font-mono">
              {d?.today.wins || 0}W / {d?.today.losses || 0}L
            </span>
            <span className="text-zinc-500">|</span>
            <span className="text-zinc-500 font-mono">Limit: ${d?.today.dailyLossLimit || 1000}</span>
          </div>
        </div>
        <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${d?.today.dailyLossProgress || 0}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{
              background: (d?.today.dailyLossProgress || 0) > 80 ? '#ef4444'
                : (d?.today.dailyLossProgress || 0) > 50 ? '#f59e0b'
                : '#10b981'
            }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[9px] text-zinc-600">0% used</span>
          <span className="text-[9px] text-zinc-600">{(d?.today.dailyLossProgress || 0).toFixed(0)}% of daily limit</span>
          <span className="text-[9px] text-zinc-600">CIRCUIT BREAKER →</span>
        </div>
      </motion.div>

      {/* ─── RISK ISSUES ─── */}
      {d && (d.riskGrade.issues?.length || 0) > 0 && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="bg-red-500/5 border border-red-500/20 rounded-xl p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold text-red-400">Active Risk Warnings</span>
          </div>
          <ul className="space-y-1">
            {d.riskGrade.issues.map((issue, i) => (
              <li key={i} className="text-xs text-red-400/80 flex items-start gap-2">
                <span className="text-red-500 mt-0.5">•</span>
                {issue}
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* ─── OPEN POSITIONS TABLE ─── */}
      {d && d.portfolio.openPositions.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
            <Eye className="w-4 h-4 text-zinc-500" />
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Open Exposure</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500 border-b border-zinc-800/50">
                  <th className="text-left px-4 py-2 font-medium">Symbol</th>
                  <th className="text-left px-3 py-2 font-medium">Side</th>
                  <th className="text-right px-3 py-2 font-medium">Entry</th>
                  <th className="text-right px-3 py-2 font-medium">Current</th>
                  <th className="text-right px-3 py-2 font-medium">SL</th>
                  <th className="text-right px-3 py-2 font-medium">TP</th>
                  <th className="text-right px-4 py-2 font-medium">Unrealized</th>
                </tr>
              </thead>
              <tbody>
                {d.portfolio.openPositions.map((p: any, i: number) => (
                  <tr key={i} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                    <td className="px-4 py-2.5 font-mono font-bold text-zinc-200">{p.symbol}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        p.side === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                      }`}>{p.side}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-zinc-400">${p.entryPrice.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-zinc-200">${p.currentPrice.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-red-400/70">
                      {p.stopLoss > 0 ? `$${p.stopLoss.toFixed(2)}` : <span className="text-red-400 font-bold">NONE!</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-emerald-400/70">
                      {p.takeProfit > 0 ? `$${p.takeProfit.toFixed(2)}` : '—'}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono font-bold ${p.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {p.unrealizedPnl >= 0 ? '+' : ''}${p.unrealizedPnl.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* ─── JARVIS RISK AUDITOR ─── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
        className="bg-zinc-900/60 border border-cyan-500/20 rounded-xl p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-cyan-400" />
            <span className="text-sm font-semibold text-cyan-400">Jarvis Risk Auditor</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-semibold">AI</span>
          </div>
          <button
            onClick={runAudit}
            disabled={isAuditing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
          >
            {isAuditing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
            {isAuditing ? 'Analyzing...' : 'Run Audit'}
          </button>
        </div>

        {audit ? (
          <div className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line bg-zinc-950/50 rounded-lg p-4 border border-zinc-800">
            {audit}
          </div>
        ) : (
          <div className="text-xs text-zinc-600 text-center py-4">
            Click "Run Audit" for Jarvis to analyze your current risk posture.
            <br />
            <span className="text-zinc-700">Jarvis can only recommend <strong>tightening</strong> risk, never loosening it.</span>
          </div>
        )}
      </motion.div>

      {/* ─── RISK EVENTS LOG ─── */}
      <div>
        <button
          onClick={() => setShowEvents(!showEvents)}
          className="flex items-center gap-2 text-xs font-semibold text-zinc-500 hover:text-zinc-300 transition-colors mb-2"
        >
          {showEvents ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Recent Risk Events ({d?.riskEvents.length || 0})
        </button>
        <AnimatePresence>
          {showEvents && d?.riskEvents && d.riskEvents.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden space-y-1.5"
            >
              {d.riskEvents.map((ev: any) => (
                <div key={ev.id} className="flex items-start gap-2 bg-zinc-900/40 border border-zinc-800/50 rounded-lg px-3 py-2">
                  <span className="text-red-400 text-xs mt-0.5">{ev.type === 'veto' ? '🚫' : '❌'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-zinc-400 truncate">{ev.message}</p>
                    <p className="text-[9px] text-zinc-600 font-mono mt-0.5">
                      {ev.agent} • {new Date(ev.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── SETTINGS (Collapsible) ─── */}
      <div id="risk-settings">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="flex items-center gap-2 text-xs font-semibold text-zinc-500 hover:text-zinc-300 transition-colors mb-2"
        >
          {showSettings ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Edit Risk Parameters
        </button>
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <form onSubmit={handleSave} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 space-y-4">
                {/* v1.7.0 — Strategy timeframes (rules engine) */}
                <div className="border border-indigo-500/20 bg-indigo-500/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider">Strategy Timeframes</span>
                    <span className="text-[9px] text-zinc-600">(rules engine — no LLM cost)</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {/* Position — validated, default on */}
                    <label className={`relative flex flex-col gap-1 p-3 rounded-lg border cursor-pointer transition-colors ${
                      settings.strategies?.position?.enabled !== false
                        ? 'border-emerald-500/40 bg-emerald-500/10'
                        : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-zinc-200 uppercase tracking-wider">Position</span>
                        <input
                          type="checkbox"
                          checked={settings.strategies?.position?.enabled !== false}
                          onChange={e => setSettings({
                            ...settings,
                            strategies: { ...(settings.strategies || {}), position: { enabled: e.target.checked } },
                          })}
                          className="accent-emerald-500 w-3.5 h-3.5"
                        />
                      </div>
                      <span className="text-[9px] text-emerald-400 font-semibold">VALIDATED ✓</span>
                      <p className="text-[9px] text-zinc-500 leading-snug">Turtle 55-day breakout, daily bars. Weeks–months hold.</p>
                    </label>

                    {/* Swing — default off until backtest validates */}
                    <label className={`relative flex flex-col gap-1 p-3 rounded-lg border cursor-pointer transition-colors ${
                      settings.strategies?.swing?.enabled
                        ? 'border-amber-500/40 bg-amber-500/10'
                        : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-zinc-200 uppercase tracking-wider">Swing</span>
                        <input
                          type="checkbox"
                          checked={!!settings.strategies?.swing?.enabled}
                          onChange={e => setSettings({
                            ...settings,
                            strategies: {
                              ...(settings.strategies || {}),
                              swing: { enabled: e.target.checked, timeframe: settings.strategies?.swing?.timeframe ?? '4h' },
                            },
                          })}
                          className="accent-amber-500 w-3.5 h-3.5"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-amber-400 font-semibold">UNVALIDATED</span>
                        <select
                          value={settings.strategies?.swing?.timeframe ?? '4h'}
                          onChange={e => setSettings({
                            ...settings,
                            strategies: {
                              ...(settings.strategies || {}),
                              swing: { enabled: !!settings.strategies?.swing?.enabled, timeframe: e.target.value as '4h' | '1h' },
                            },
                          })}
                          className="text-[9px] bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-zinc-300"
                          onClick={e => e.stopPropagation()}
                        >
                          <option value="4h">4h</option>
                          <option value="1h">1h</option>
                        </select>
                      </div>
                      <p className="text-[9px] text-zinc-500 leading-snug">Same breakout, faster cadence. Days–2 weeks.</p>
                    </label>

                    {/* Intraday — default off, deliberately strict */}
                    <label className={`relative flex flex-col gap-1 p-3 rounded-lg border cursor-pointer transition-colors ${
                      settings.strategies?.intraday?.enabled
                        ? 'border-rose-500/40 bg-rose-500/10'
                        : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-zinc-200 uppercase tracking-wider">Intraday</span>
                        <input
                          type="checkbox"
                          checked={!!settings.strategies?.intraday?.enabled}
                          onChange={e => setSettings({
                            ...settings,
                            strategies: { ...(settings.strategies || {}), intraday: { enabled: e.target.checked } },
                          })}
                          className="accent-rose-500 w-3.5 h-3.5"
                        />
                      </div>
                      <span className="text-[9px] text-rose-400 font-semibold">UNVALIDATED</span>
                      <p className="text-[9px] text-zinc-500 leading-snug">Momentum + VWAP, 15m bars. Hours hold. No scalping.</p>
                    </label>
                  </div>
                  <p className="text-[9px] text-zinc-500 mt-3 leading-snug">
                    Validated = backtested with positive edge after fees. Unvalidated = code is there, edge not yet proven on your data. Enable only after running <code className="text-indigo-400">tsx scratch/turtle-backtest.ts --strategy swing</code> (or <code className="text-indigo-400">intraday</code>) and reviewing the metrics.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                      Max Daily Loss ($)
                    </label>
                    <input
                      type="number"
                      value={settings.maxDailyLoss}
                      onChange={e => setSettings({ ...settings, maxDailyLoss: Number(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-red-500/50"
                    />
                    <p className="text-[9px] text-zinc-600 mt-1">Trading halts if daily loss exceeds this.</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                      Max Position Size (%)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={settings.maxPositionSizePct}
                      onChange={e => setSettings({ ...settings, maxPositionSizePct: Number(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-red-500/50"
                    />
                    <p className="text-[9px] text-zinc-600 mt-1">Max % of portfolio in a single trade.</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                      Auto-Liquidate ($)
                    </label>
                    <input
                      type="number"
                      value={settings.autoLiquidateThreshold}
                      onChange={e => setSettings({ ...settings, autoLiquidateThreshold: Number(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-red-500/50"
                    />
                    <p className="text-[9px] text-zinc-600 mt-1">Force-close a position at this loss.</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                      Max Open Positions
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={settings.maxOpenPositions}
                      onChange={e => setSettings({ ...settings, maxOpenPositions: Number(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-red-500/50"
                    />
                    <p className="text-[9px] text-zinc-600 mt-1">Max simultaneous open trades.</p>
                  </div>

                {/* ─── Trade Parameters Section ─── */}
                <div className="border-t border-zinc-700/50 pt-4 mt-1">
                  <div className="flex items-center gap-2 mb-3">
                    <DollarSign className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Trade Parameters</span>
                    <span className="text-[9px] text-zinc-600">(used when Jarvis proposes trades)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                        Capital Per Trade ($)
                      </label>
                      <input
                        type="number"
                        min={100}
                        step={1}
                        value={settings.capitalPerTrade}
                        onChange={e => setSettings({ ...settings, capitalPerTrade: Number(e.target.value) })}
                        className="w-full bg-zinc-950 border border-amber-500/20 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                      />
                      <p className="text-[9px] text-zinc-600 mt-1">How much $ to allocate per trade.</p>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                        Profit Target ($)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={settings.profitTarget}
                        onChange={e => setSettings({ ...settings, profitTarget: Number(e.target.value) })}
                        className="w-full bg-zinc-950 border border-emerald-500/20 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                      />
                      <p className="text-[9px] text-zinc-600 mt-1">Fires a 50% partial close (then trailing stop on the remainder) when profit hits this $ amount. Set to 0 to disable — Strategist's takeProfit price controls exits instead.</p>
                    </div>
                  </div>
                </div>

                {/* ─── Live Money Cap Section ─── */}
                <div className="border-t border-red-500/30 pt-4 mt-1">
                  <div className="flex items-center gap-2 mb-3">
                    <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wider">Live Money Cap</span>
                    <span className="text-[9px] text-zinc-600">(hard ceiling on total LIVE exposure — ignored in Practice)</span>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                      Max Live Capital ($)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={settings.maxLiveCapital}
                      onChange={e => setSettings({ ...settings, maxLiveCapital: Number(e.target.value) })}
                      className="w-full bg-zinc-950 border border-red-500/40 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-red-500/50"
                    />
                    <p className="text-[9px] text-zinc-600 mt-1">Sum of all open live positions + this trade's notional must stay under this. Refuses orders that would breach it.</p>
                  </div>
                </div>

                {/* ─── Bleed-Hours Filter (Phase 3) ─── */}
                <div className="border-t border-purple-500/30 pt-4 mt-1">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider">Bleed-Hour Filter (Advisory only)</span>
                      <span className="text-[9px] text-zinc-600">(logs a note when conviction is below floor in window — no longer vetoes)</span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Enabled</span>
                      <input
                        type="checkbox"
                        checked={settings.bleedHoursEnabled !== false}
                        onChange={e => setSettings({ ...settings, bleedHoursEnabled: e.target.checked })}
                        className="w-4 h-4 accent-purple-500"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                        Start (IST)
                      </label>
                      <select
                        value={settings.bleedStartHourIST ?? 17}
                        onChange={e => setSettings({ ...settings, bleedStartHourIST: Number(e.target.value) })}
                        disabled={settings.bleedHoursEnabled === false}
                        className="w-full bg-zinc-950 border border-purple-500/40 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-40"
                      >
                        {Array.from({ length: 24 }, (_, h) => {
                          const period = h < 12 ? 'AM' : 'PM';
                          const h12 = h % 12 === 0 ? 12 : h % 12;
                          return <option key={h} value={h}>{h12}:00 {period}</option>;
                        })}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                        End (IST)
                      </label>
                      <select
                        value={settings.bleedEndHourIST ?? 0}
                        onChange={e => setSettings({ ...settings, bleedEndHourIST: Number(e.target.value) })}
                        disabled={settings.bleedHoursEnabled === false}
                        className="w-full bg-zinc-950 border border-purple-500/40 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-40"
                      >
                        {Array.from({ length: 24 }, (_, h) => {
                          const period = h < 12 ? 'AM' : 'PM';
                          const h12 = h % 12 === 0 ? 12 : h % 12;
                          return <option key={h} value={h}>{h12}:00 {period}</option>;
                        })}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                        Min Confidence
                      </label>
                      <input
                        type="number"
                        min={50}
                        max={100}
                        step={5}
                        value={settings.bleedConfidenceFloor ?? 75}
                        onChange={e => setSettings({ ...settings, bleedConfidenceFloor: Number(e.target.value) })}
                        disabled={settings.bleedHoursEnabled === false}
                        className="w-full bg-zinc-950 border border-purple-500/40 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-purple-500/50 disabled:opacity-40"
                      />
                    </div>
                  </div>
                  <p className="text-[9px] text-zinc-600 mt-2">
                    {settings.bleedHoursEnabled === false
                      ? 'Filter disabled — Sentinel uses standard 60% confidence floor at all times.'
                      : (() => {
                          const start = settings.bleedStartHourIST ?? 17;
                          const end = settings.bleedEndHourIST ?? 0;
                          const fmt = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
                          return `Active ${fmt(start)} → ${fmt(end)} IST. Trades during this window need ≥${settings.bleedConfidenceFloor ?? 75}% confidence. Your data: 5 PM–12 AM IST was your bleed (62 trades, net ~$-14).`;
                        })()
                    }
                  </p>
                </div>

                {/* ─── TradingView Vision Section (Option C) ─── */}
                <div className="border-t border-cyan-500/30 pt-4 mt-1">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider">TradingView Vision</span>
                      <span className="text-[9px] text-zinc-600">(let swarm flip your TV chart to match what it's analyzing)</span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Auto-Navigate</span>
                      <input
                        type="checkbox"
                        checked={settings.autoNavigateTV !== false}
                        onChange={e => setSettings({ ...settings, autoNavigateTV: e.target.checked })}
                        className="w-4 h-4 accent-cyan-500"
                      />
                    </label>
                  </div>
                  <p className="text-[9px] text-zinc-600">
                    {settings.autoNavigateTV !== false
                      ? '✅ ON — swarm will navigate your TV chart to the analyzed symbol before running Vision. Best vision coverage, but the bot will change your chart away from whatever you were looking at.'
                      : '⛔ OFF — Vision only fires when your TV chart happens to match what the swarm is analyzing. You stay in full control of your chart; vision rarely fires.'}
                  </p>
                </div>

                {/* ─── Auto-Protect Orphans (Phase 9 Tier B #2) ─── */}
                <div className="border-t border-emerald-500/30 pt-4 mt-1">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Auto-Protect Orphans</span>
                      <span className="text-[9px] text-zinc-600">(when boot reconciliation finds an unknown position on an exchange)</span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Enabled</span>
                      <input
                        type="checkbox"
                        checked={settings.autoProtectOrphans !== false}
                        onChange={e => setSettings({ ...settings, autoProtectOrphans: e.target.checked })}
                        className="w-4 h-4 accent-emerald-500"
                      />
                    </label>
                  </div>
                  <p className="text-[9px] text-zinc-600">
                    {settings.autoProtectOrphans !== false
                      ? '✅ ON — at boot, any unknown position on your exchange gets a protective 3% stop-loss placed automatically + flagged as "discovered orphan" for your review. Safest default for autonomous trading.'
                      : '⛔ OFF — orphan positions get flagged via Telegram but no auto-SL is placed. Pick this only if you trade manually on the same exchange and don\'t want surprise stop-losses on positions you opened yourself.'}
                  </p>
                </div>

                {/* ─── Leverage Caps Section (Phase 9.3) ─── */}
                <div className="border-t border-amber-500/30 pt-4 mt-1">
                  <div className="flex items-center gap-2 mb-3">
                    <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Leverage Caps</span>
                    <span className="text-[9px] text-zinc-600">(per asset class — only enforced when leverage &gt; 1)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                        Crypto Max Leverage
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={125}
                        step={1}
                        value={settings.maxLeverage?.crypto ?? 10}
                        onChange={e => setSettings({ ...settings, maxLeverage: { ...(settings.maxLeverage || {}), crypto: Number(e.target.value) } })}
                        className="w-full bg-zinc-950 border border-amber-500/40 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                      />
                      <p className="text-[9px] text-zinc-600 mt-1">Default 10x. Refuses orders requesting more.</p>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                        Stock Max Leverage
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={4}
                        step={1}
                        value={settings.maxLeverage?.stock ?? 1}
                        onChange={e => setSettings({ ...settings, maxLeverage: { ...(settings.maxLeverage || {}), stock: Number(e.target.value) } })}
                        className="w-full bg-zinc-950 border border-amber-500/40 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                      />
                      <p className="text-[9px] text-zinc-600 mt-1">Default 1x (cash). Margin accounts up to 4x.</p>
                    </div>
                  </div>
                </div>

                {/* ─── Approval Queue Section ─── */}
                <div className="border-t border-zinc-700/50 pt-4 mt-1">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider">Approval Queue</span>
                    <span className="text-[9px] text-zinc-600">(auto-expires stale pending trades)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                        Approval TTL (minutes)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        step={1}
                        value={settings.approvalTtlMinutes}
                        onChange={e => setSettings({ ...settings, approvalTtlMinutes: Number(e.target.value) })}
                        className="w-full bg-zinc-950 border border-cyan-500/20 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                      />
                      <p className="text-[9px] text-zinc-600 mt-1">Auto-decline approvals older than this.</p>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                        Max Price Drift (%)
                      </label>
                      <input
                        type="number"
                        min={0.1}
                        max={20}
                        step={0.1}
                        value={settings.approvalMaxDriftPercent}
                        onChange={e => setSettings({ ...settings, approvalMaxDriftPercent: Number(e.target.value) })}
                        className="w-full bg-zinc-950 border border-cyan-500/20 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                      />
                      <p className="text-[9px] text-zinc-600 mt-1">Auto-decline if price moves past this since the proposal.</p>
                    </div>
                  </div>
                </div>
                </div>

                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full py-2.5 rounded-lg bg-red-600/80 hover:bg-red-500 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSaving ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Risk Parameters
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

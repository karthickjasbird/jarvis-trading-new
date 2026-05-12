import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldAlert, Save, AlertTriangle, ShieldCheck, Activity,
  TrendingDown, Crosshair, Flame, Ban, Brain, RefreshCw,
  ChevronDown, ChevronUp, Eye
} from 'lucide-react';
import { toast } from 'sonner';

interface RiskSettings {
  maxDailyLoss: number;
  maxPositionSizePct: number;
  autoLiquidateThreshold: number;
  maxOpenPositions: number;
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

  const handleSave = async (e: React.FormEvent) => {
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
      <div>
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

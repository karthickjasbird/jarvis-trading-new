import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ShieldAlert, Save, AlertTriangle, ShieldCheck, Activity } from 'lucide-react';
import { toast } from 'sonner';

interface RiskSettings {
  maxDailyLoss: number;
  maxPositionSizePct: number;
  autoLiquidateThreshold: number;
  requireConfirmation: boolean;
}

export function RiskManager({ userId }: { userId: string }) {
  const [settings, setSettings] = useState<RiskSettings>({
    maxDailyLoss: 1000,
    maxPositionSizePct: 20,
    autoLiquidateThreshold: 500,
    requireConfirmation: false
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/risk-settings?userId=${userId}`);
        const data = await res.json();
        if (data.settings) {
          setSettings(data.settings);
        }
      } catch (error) {
        console.error("Failed to fetch risk settings", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, [userId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await fetch('/api/risk-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, settings })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success('Risk settings updated successfully', {
        style: { backgroundColor: '#10b981', color: 'white', border: 'none' }
      });
    } catch (error: any) {
      toast.error(error.message || 'Failed to update risk settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="w-full h-64 flex items-center justify-center">
        <Activity className="w-8 h-8 text-zinc-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <ShieldAlert className="w-6 h-6 text-red-400" />
        </div>
        <div>
          <h2 className="text-2xl font-light text-zinc-100">Risk Manager</h2>
          <p className="text-zinc-500 text-sm">Global guardrails and capital protection</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="md:col-span-2 bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-6 backdrop-blur-md"
        >
          <form onSubmit={handleSave} className="space-y-6">
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Max Daily Loss ($)</label>
                <p className="text-xs text-zinc-500 mb-2">Jarvis will halt trading if daily P&L drops below this amount.</p>
                <input 
                  type="number"
                  value={settings.maxDailyLoss}
                  onChange={(e) => setSettings({...settings, maxDailyLoss: Number(e.target.value)})}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-red-500/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Max Position Size (%)</label>
                <p className="text-xs text-zinc-500 mb-2">Maximum percentage of total portfolio allowed per trade.</p>
                <input 
                  type="number"
                  max="100"
                  min="1"
                  value={settings.maxPositionSizePct}
                  onChange={(e) => setSettings({...settings, maxPositionSizePct: Number(e.target.value)})}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-red-500/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Auto-Liquidate Threshold ($)</label>
                <p className="text-xs text-zinc-500 mb-2">Automatically close a position if it loses this much money.</p>
                <input 
                  type="number"
                  value={settings.autoLiquidateThreshold}
                  onChange={(e) => setSettings({...settings, autoLiquidateThreshold: Number(e.target.value)})}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-red-500/50"
                />
              </div>

              <div className="flex items-center gap-3 pt-4 border-t border-zinc-800/50">
                <input 
                  type="checkbox"
                  id="requireConfirmation"
                  checked={settings.requireConfirmation}
                  onChange={(e) => setSettings({...settings, requireConfirmation: e.target.checked})}
                  className="w-5 h-5 rounded border-zinc-700 bg-zinc-900 text-red-500 focus:ring-red-500/50 focus:ring-offset-zinc-950"
                />
                <div>
                  <label htmlFor="requireConfirmation" className="text-sm font-medium text-zinc-300">Require Manual Confirmation</label>
                  <p className="text-xs text-zinc-500">Jarvis must ask for permission before executing any live trade.</p>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSaving}
              className="w-full py-3 rounded-xl bg-red-600/90 hover:bg-red-500 text-white font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSaving ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Risk Parameters
                </>
              )}
            </button>
          </form>
        </motion.div>

        <div className="space-y-6">
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-6 backdrop-blur-md"
          >
            <div className="flex items-center gap-2 text-emerald-400 mb-4">
              <ShieldCheck className="w-5 h-5" />
              <h3 className="font-medium">System Status</h3>
            </div>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Risk Management Engine is <strong className="text-emerald-400">Active</strong>. 
              All trades executed by Jarvis or manually are routed through these guardrails.
            </p>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 backdrop-blur-md"
          >
            <div className="flex items-center gap-2 text-red-400 mb-4">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-medium">Warning</h3>
            </div>
            <p className="text-sm text-red-400/80 leading-relaxed">
              Disabling "Require Manual Confirmation" allows Jarvis to execute trades autonomously based on its analysis. Ensure your Max Daily Loss is set appropriately.
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Settings, DollarSign, Target, Save, Check } from 'lucide-react';
import { toast } from 'sonner';

interface TradeParametersProps {
  userId: string;
}

export function TradeParameters({ userId }: TradeParametersProps) {
  const [capital, setCapital] = useState(8000);
  const [profit, setProfit] = useState(50);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // Load settings on mount
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/risk-settings?userId=${userId}`)
      .then(r => r.json())
      .then(data => {
        if (data.settings) {
          if (data.settings.capitalPerTrade) setCapital(data.settings.capitalPerTrade);
          if (data.settings.profitTarget) setProfit(data.settings.profitTarget);
        }
      })
      .catch(() => {});
  }, [userId]);

  const handleSave = async () => {
    if (!userId) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/risk-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          settings: { capitalPerTrade: capital, profitTarget: profit }
        })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setSaved(true);
        toast.success(`Trade params saved — $${capital} capital, $${profit} profit target`);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      toast.error('Failed to save trade parameters');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-2"
      >
        <Settings className="w-3.5 h-3.5" />
        <span className="uppercase tracking-wider font-semibold">Trade Parameters</span>
        <span className="text-[10px] text-zinc-600">
          (${capital.toLocaleString()} capital • ${profit} profit target)
        </span>
      </button>

      {isOpen && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 flex items-center gap-4">
          {/* Capital Per Trade */}
          <div className="flex items-center gap-2 flex-1">
            <DollarSign className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] text-zinc-500 uppercase tracking-wider">Capital / Trade</label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">$</span>
                <input
                  type="number"
                  value={capital}
                  onChange={e => setCapital(Number(e.target.value))}
                  className="w-28 bg-black/40 border border-zinc-700 rounded px-2 pl-5 py-1 text-sm text-zinc-200 font-mono focus:border-amber-500/50 focus:outline-none"
                  min={100}
                  step={500}
                />
              </div>
            </div>
          </div>

          {/* Profit Target */}
          <div className="flex items-center gap-2 flex-1">
            <Target className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <label className="text-[9px] text-zinc-500 uppercase tracking-wider">Profit Target</label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">$</span>
                <input
                  type="number"
                  value={profit}
                  onChange={e => setProfit(Number(e.target.value))}
                  className="w-28 bg-black/40 border border-zinc-700 rounded px-2 pl-5 py-1 text-sm text-zinc-200 font-mono focus:border-emerald-500/50 focus:outline-none"
                  min={1}
                  step={10}
                />
              </div>
            </div>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className={`px-3 py-2 rounded text-xs font-bold transition-all flex items-center gap-1.5 ${
              saved
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30'
            } disabled:opacity-50`}
          >
            {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {isSaving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

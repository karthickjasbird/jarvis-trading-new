import { useState } from 'react';
import { Play, Pause, FastForward, Calendar, Clock, Brain, ChevronDown } from 'lucide-react';

const SCAN_PAIRS = [
  { value: 'BTCUSDT', label: 'BTC / USDT' },
  { value: 'ETHUSDT', label: 'ETH / USDT' },
  { value: 'SOLUSDT', label: 'SOL / USDT' },
  { value: 'BNBUSDT', label: 'BNB / USDT' },
  { value: 'XRPUSDT', label: 'XRP / USDT' },
  { value: 'DOGEUSDT', label: 'DOGE / USDT' },
  { value: 'ADAUSDT', label: 'ADA / USDT' },
  { value: 'AVAXUSDT', label: 'AVAX / USDT' },
  { value: 'DOTUSDT', label: 'DOT / USDT' },
  { value: 'LINKUSDT', label: 'LINK / USDT' },
  { value: 'MATICUSDT', label: 'MATIC / USDT' },
  { value: 'ATOMUSDT', label: 'ATOM / USDT' },
  { value: 'NEARUSDT', label: 'NEAR / USDT' },
  { value: 'APTUSDT', label: 'APT / USDT' },
  { value: 'ARBUSDT', label: 'ARB / USDT' },
  { value: 'OPUSDT', label: 'OP / USDT' },
  { value: 'SUIUSDT', label: 'SUI / USDT' },
  { value: 'INJUSDT', label: 'INJ / USDT' },
  { value: 'TIAUSDT', label: 'TIA / USDT' },
  { value: 'SEIUSDT', label: 'SEI / USDT' },
];

export function TimeMachineControls({ 
  onStartReplay, 
  onStopReplay, 
  isReplaying 
}: { 
  onStartReplay: (date: string, speed: number, symbol: string, jarvisEnabled: boolean, capital: number, profitTarget: number) => void;
  onStopReplay: () => void;
  isReplaying: boolean;
}) {
  const [date, setDate] = useState(new Date(Date.now() - 86400000).toISOString().split('T')[0]); // Yesterday
  const [speed, setSpeed] = useState(60); // 1 sec = 1 min
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [jarvisEnabled, setJarvisEnabled] = useState(false);
  
  // New simulation parameters
  const [capital, setCapital] = useState(5000);
  const [profitTarget, setProfitTarget] = useState(100);

  return (
    <div className="bg-zinc-900/95 backdrop-blur-xl border-t border-amber-500/20 px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-4 flex-wrap">
        {/* Label */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <Clock className="w-3.5 h-3.5 text-amber-500/70" />
          <span className="text-xs font-semibold text-amber-400 tracking-wider uppercase">Time Machine</span>
        </div>

        <div className="h-5 w-px bg-zinc-800 shrink-0" />

        {/* Coin Selector */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-zinc-500 font-mono">COIN</span>
          <div className="relative">
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              disabled={isReplaying}
              className="appearance-none bg-zinc-800/80 border border-zinc-700/60 rounded-md pl-2.5 pr-6 py-1 text-xs text-zinc-200 font-mono focus:outline-none focus:border-amber-500/60 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {SCAN_PAIRS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-zinc-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        <div className="h-5 w-px bg-zinc-800 shrink-0" />

        {/* Date Picker */}
        <div className="flex items-center gap-2 shrink-0">
          <Calendar className="w-3.5 h-3.5 text-zinc-500" />
          <input 
            type="date" 
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={isReplaying}
            className="bg-transparent border-none text-xs text-zinc-300 font-mono focus:ring-0 focus:outline-none p-0 w-[110px] disabled:opacity-50"
          />
        </div>

        <div className="h-5 w-px bg-zinc-800 shrink-0" />

        {/* Speed Selector */}
        <div className="flex items-center gap-2 shrink-0">
          <FastForward className="w-3.5 h-3.5 text-zinc-500" />
          <select 
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            disabled={isReplaying}
            className="bg-transparent border-none text-xs text-zinc-300 font-mono focus:ring-0 focus:outline-none p-0 disabled:opacity-50"
          >
            <option value={1}>1x (Real)</option>
            <option value={60}>60x (1s = 1m)</option>
            <option value={3600}>3600x (1s = 1h)</option>
          </select>
        </div>

        {/* Dynamic Simulation Inputs (Only visible if Jarvis is ON) */}
        {jarvisEnabled && (
          <>
            <div className="h-5 w-px bg-zinc-800 shrink-0" />
            
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-500 font-mono font-bold uppercase">Capital $</span>
                <input 
                  type="number"
                  value={capital}
                  onChange={e => setCapital(Number(e.target.value))}
                  disabled={isReplaying}
                  className="w-16 bg-zinc-950/50 border border-zinc-700/50 rounded px-1.5 py-0.5 text-xs text-violet-300 font-mono text-right focus:outline-none focus:border-violet-500/50"
                />
              </div>
              
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-500 font-mono font-bold uppercase">Goal $</span>
                <input 
                  type="number"
                  value={profitTarget}
                  onChange={e => setProfitTarget(Number(e.target.value))}
                  disabled={isReplaying}
                  className="w-16 bg-zinc-950/50 border border-zinc-700/50 rounded px-1.5 py-0.5 text-xs text-emerald-400 font-mono text-right focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>
          </>
        )}

        <div className="h-5 w-px bg-zinc-800 shrink-0" />

        {/* Jarvis AI Toggle */}
        <button
          onClick={() => setJarvisEnabled(prev => !prev)}
          disabled={isReplaying}
          title={jarvisEnabled ? 'Jarvis AI Pilot is ON — he will trade on this replay' : 'Enable Jarvis AI Pilot to see his entries/exits'}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold tracking-wide transition-all border disabled:opacity-50 shrink-0 ${
            jarvisEnabled
              ? 'bg-violet-500/20 text-violet-300 border-violet-500/40 shadow-[0_0_10px_rgba(139,92,246,0.2)]'
              : 'bg-zinc-800/60 text-zinc-500 border-zinc-700/50 hover:border-zinc-600'
          }`}
        >
          <Brain className={`w-3.5 h-3.5 ${jarvisEnabled ? 'animate-pulse' : ''}`} />
          JARVIS AI {jarvisEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Start / Stop Button */}
      <button
        onClick={() => isReplaying ? onStopReplay() : onStartReplay(date, speed, symbol, jarvisEnabled, capital, profitTarget)}
        className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold tracking-wider uppercase transition-all shrink-0 ${
          isReplaying 
            ? 'bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25' 
            : 'bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
        }`}
      >
        {isReplaying ? (
          <>
            <Pause className="w-3.5 h-3.5 fill-current" />
            Stop
          </>
        ) : (
          <>
            <Play className="w-3.5 h-3.5 fill-current" />
            Launch Replay
          </>
        )}
      </button>
    </div>
  );
}

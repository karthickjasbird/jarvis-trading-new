import React, { useState } from 'react';
import { Play, Pause, FastForward, Rewind, Calendar, Clock } from 'lucide-react';

export function TimeMachineControls({ 
  onStartReplay, 
  onStopReplay, 
  isReplaying 
}: { 
  onStartReplay: (date: string, speed: number) => void;
  onStopReplay: () => void;
  isReplaying: boolean;
}) {
  const [date, setDate] = useState(new Date(Date.now() - 86400000).toISOString().split('T')[0]); // Yesterday
  const [speed, setSpeed] = useState(60); // 1 sec = 1 min

  return (
    <div className="bg-zinc-900/90 backdrop-blur-md border border-amber-500/30 rounded-2xl p-4 shadow-[0_0_30px_rgba(245,158,11,0.1)] flex items-center gap-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-amber-500/10 rounded-lg">
          <Clock className="w-5 h-5 text-amber-500" />
        </div>
        <div>
          <div className="text-xs text-amber-500/70 font-bold tracking-wider uppercase">Time Machine</div>
          <div className="text-sm text-zinc-300 font-medium">Historical Replay</div>
        </div>
      </div>

      <div className="h-8 w-px bg-zinc-800" />

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 bg-zinc-950/50 px-3 py-1.5 rounded-lg border border-zinc-800">
          <Calendar className="w-4 h-4 text-zinc-400" />
          <input 
            type="date" 
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={isReplaying}
            className="bg-transparent border-none text-sm text-zinc-200 focus:ring-0 p-0 w-32"
          />
        </div>

        <div className="flex items-center gap-2 bg-zinc-950/50 px-3 py-1.5 rounded-lg border border-zinc-800">
          <FastForward className="w-4 h-4 text-zinc-400" />
          <select 
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            disabled={isReplaying}
            className="bg-transparent border-none text-sm text-zinc-200 focus:ring-0 p-0"
          >
            <option value={1}>1x (Realtime)</option>
            <option value={60}>60x (1s = 1m)</option>
            <option value={3600}>3600x (1s = 1h)</option>
          </select>
        </div>
      </div>

      <div className="h-8 w-px bg-zinc-800" />

      <button
        onClick={() => isReplaying ? onStopReplay() : onStartReplay(date, speed)}
        className={`flex items-center gap-2 px-6 py-2 rounded-xl font-bold transition-all ${
          isReplaying 
            ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' 
            : 'bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.3)]'
        }`}
      >
        {isReplaying ? (
          <>
            <Pause className="w-5 h-5 fill-current" />
            STOP REPLAY
          </>
        ) : (
          <>
            <Play className="w-5 h-5 fill-current" />
            START REPLAY
          </>
        )}
      </button>
    </div>
  );
}

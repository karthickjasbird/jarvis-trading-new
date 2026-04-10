import { useMarketData } from '../hooks/useMarketData';
import { TrendingUp, TrendingDown } from 'lucide-react';

export function LiveMarketData({ symbol, broker, replayDate, speed }: { symbol: string, broker: string, replayDate?: string, speed?: number }) {
  const { tick, history } = useMarketData(symbol, broker);

  if (!tick) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 animate-pulse w-64">
        <div className="h-4 bg-zinc-800 rounded w-24 mb-2"></div>
        <div className="h-8 bg-zinc-800 rounded w-32"></div>
      </div>
    );
  }

  const isPositive = tick.change >= 0;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 backdrop-blur-sm w-64 transition-all duration-300">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h3 className="text-zinc-400 text-sm font-medium">{symbol}</h3>
          <p className="text-xs text-zinc-600 capitalize">{broker}</p>
        </div>
        <div className={`p-1.5 rounded-md ${isPositive ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
          {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
        </div>
      </div>
      
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-zinc-100 font-mono">
          ${tick.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
        <span className={`text-sm font-medium font-mono ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
          {isPositive ? '+' : ''}{tick.change.toFixed(2)}
        </span>
      </div>

      {/* Mini Sparkline */}
      <div className="mt-4 h-12 flex items-end gap-0.5 overflow-hidden">
        {(() => {
          const min = Math.min(...history.map(x => x.price));
          const max = Math.max(...history.map(x => x.price));
          const range = max - min || 1;
          
          return history.map((h, i) => {
            const height = Math.max(10, ((h.price - min) / range) * 100);
            
            return (
              <div 
                key={i} 
                className={`flex-1 rounded-t-sm transition-all duration-300 ${h.change >= 0 ? 'bg-green-500/50' : 'bg-red-500/50'}`}
                style={{ height: `${height}%` }}
              />
            );
          });
        })()}
      </div>
    </div>
  );
}

import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useMarketData } from '../hooks/useMarketData';

export function ReplayChart({ symbol, broker, replayDate, speed }: { symbol: string, broker: string, replayDate?: string, speed?: number }) {
  const { history } = useMarketData(symbol, broker, replayDate, speed || 1);

  if (history.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-zinc-500 font-mono">
        Waiting for time machine data...
      </div>
    );
  }

  const currentPrice = history[history.length - 1].price;
  const minPrice = Math.min(...history.map(d => d.price));
  const maxPrice = Math.max(...history.map(d => d.price));
  const padding = (maxPrice - minPrice) * 0.1;

  return (
    <div className="w-full h-full p-6 flex flex-col">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-zinc-100">{symbol}</h2>
          <p className="text-amber-500 font-mono text-sm">HISTORICAL REPLAY</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-mono font-bold text-zinc-100">
            ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-zinc-500 font-mono text-sm">
            {new Date(history[history.length - 1].timestamp).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="flex-1 w-full min-h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history}>
            <XAxis 
              dataKey="timestamp" 
              type="number" 
              domain={['dataMin', 'dataMax']} 
              tickFormatter={(tick) => new Date(tick).toLocaleTimeString()}
              stroke="#52525b"
              tick={{ fill: '#a1a1aa', fontSize: 12 }}
            />
            <YAxis 
              domain={[minPrice - padding, maxPrice + padding]} 
              stroke="#52525b"
              tick={{ fill: '#a1a1aa', fontSize: 12, fontFamily: 'monospace' }}
              tickFormatter={(tick) => `$${tick.toLocaleString()}`}
              orientation="right"
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
              itemStyle={{ color: '#f4f4f5', fontFamily: 'monospace' }}
              labelFormatter={(label) => new Date(label).toLocaleString()}
              formatter={(value: number) => [`$${value.toLocaleString()}`, 'Price']}
            />
            <ReferenceLine y={currentPrice} stroke="#f59e0b" strokeDasharray="3 3" />
            <Line 
              type="monotone" 
              dataKey="price" 
              stroke="#3b82f6" 
              strokeWidth={2} 
              dot={false} 
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

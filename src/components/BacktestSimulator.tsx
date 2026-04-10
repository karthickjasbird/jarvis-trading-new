import { useState } from 'react';
import { motion } from 'motion/react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Play, Settings2, TrendingUp, Activity, DollarSign, Target } from 'lucide-react';
import { toast } from 'sonner';

interface BacktestResult {
  status: string;
  symbol: string;
  timeframe: string;
  strategy: string;
  results: {
    initialBalance: number;
    finalBalance: number;
    totalPnl: number;
    pnlPercentage: number;
    totalTrades: number;
    winRate: number;
  };
  equityCurve: { time: number; balance: number }[];
  trades: any[];
}

export function BacktestSimulator() {
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [timeframe, setTimeframe] = useState('1h');
  const [strategy, setStrategy] = useState('rsi');
  const [initialBalance, setInitialBalance] = useState(10000);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const handleRunBacktest = async (e: any) => {
    e.preventDefault();
    setIsLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, timeframe, strategy, initialBalance }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      setResult(data);
      toast.success('Backtest completed successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to run backtest');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOptimize = async () => {
    setIsOptimizing(true);
    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, timeframe, strategy, initialBalance }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      toast.success(`Optimization complete! Best PnL: $${data.bestResult.pnl.toFixed(2)}`, {
        description: `Optimal Parameters: ${JSON.stringify(data.bestResult.params)}`
      });
      
      // We could automatically apply these parameters if the UI supported it.
    } catch (error: any) {
      toast.error(error.message || 'Failed to optimize strategy');
    } finally {
      setIsOptimizing(false);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
          <Settings2 className="w-6 h-6 text-purple-400" />
        </div>
        <div>
          <h2 className="text-2xl font-light text-zinc-100">Strategy Backtester</h2>
          <p className="text-zinc-500 text-sm">Simulate and visualize trading strategies</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration Panel */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-6 backdrop-blur-md lg:col-span-1"
        >
          <h3 className="text-lg font-medium text-zinc-100 mb-6">Configuration</h3>
          <form onSubmit={handleRunBacktest} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Symbol</label>
              <select 
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
              >
                <option value="BTC/USDT">BTC/USDT</option>
                <option value="ETH/USDT">ETH/USDT</option>
                <option value="SOL/USDT">SOL/USDT</option>
                <option value="BNB/USDT">BNB/USDT</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Timeframe</label>
              <select 
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
              >
                <option value="15m">15 Minutes</option>
                <option value="1h">1 Hour</option>
                <option value="4h">4 Hours</option>
                <option value="1d">1 Day</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Strategy</label>
              <select 
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
              >
                <option value="rsi">RSI Oversold/Overbought</option>
                <option value="macd">MACD Crossover</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Initial Balance ($)</label>
              <input 
                type="number"
                value={initialBalance}
                onChange={(e) => setInitialBalance(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
              />
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="submit"
                disabled={isLoading || isOptimizing}
                className="flex-1 px-4 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Run Backtest
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleOptimize}
                disabled={isLoading || isOptimizing}
                className="flex-1 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isOptimizing ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Settings2 className="w-4 h-4" />
                    Optimize
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>

        {/* Results Panel */}
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="lg:col-span-2 space-y-6"
        >
          {result ? (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-4 backdrop-blur-md">
                  <div className="flex items-center gap-2 text-zinc-500 mb-2">
                    <DollarSign className="w-4 h-4" />
                    <span className="text-xs uppercase tracking-wider font-medium">Final Balance</span>
                  </div>
                  <div className="text-2xl font-light text-zinc-100">
                    ${result.results.finalBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-4 backdrop-blur-md">
                  <div className="flex items-center gap-2 text-zinc-500 mb-2">
                    <TrendingUp className="w-4 h-4" />
                    <span className="text-xs uppercase tracking-wider font-medium">Total P&L</span>
                  </div>
                  <div className={`text-2xl font-light ${result.results.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {result.results.totalPnl >= 0 ? '+' : ''}${result.results.totalPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-4 backdrop-blur-md">
                  <div className="flex items-center gap-2 text-zinc-500 mb-2">
                    <Target className="w-4 h-4" />
                    <span className="text-xs uppercase tracking-wider font-medium">Win Rate</span>
                  </div>
                  <div className="text-2xl font-light text-zinc-100">
                    {result.results.winRate.toFixed(1)}%
                  </div>
                </div>
                <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-4 backdrop-blur-md">
                  <div className="flex items-center gap-2 text-zinc-500 mb-2">
                    <Activity className="w-4 h-4" />
                    <span className="text-xs uppercase tracking-wider font-medium">Total Trades</span>
                  </div>
                  <div className="text-2xl font-light text-zinc-100">
                    {result.results.totalTrades}
                  </div>
                </div>
              </div>

              {/* Equity Curve Chart */}
              <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-6 backdrop-blur-md">
                <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-6">Equity Curve</h3>
                <div className="w-full h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={result.equityCurve}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis 
                        dataKey="time" 
                        stroke="#52525b" 
                        fontSize={12} 
                        tickLine={false} 
                        axisLine={false} 
                        tickFormatter={formatTime}
                        minTickGap={50}
                      />
                      <YAxis 
                        domain={['auto', 'auto']}
                        stroke="#52525b" 
                        fontSize={12} 
                        tickLine={false} 
                        axisLine={false} 
                        tickFormatter={(val) => `$${val.toLocaleString()}`} 
                        width={80}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                        itemStyle={{ color: '#e4e4e7' }}
                        labelFormatter={(label) => new Date(label).toLocaleString()}
                        formatter={(value: number) => [`$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, 'Balance']}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="balance" 
                        stroke="#a855f7" 
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 6, fill: '#c084fc' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          ) : (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-zinc-500 bg-zinc-900/30 border border-zinc-800/50 rounded-2xl border-dashed">
              <Activity className="w-12 h-12 mb-4 opacity-20" />
              <p>Configure and run a backtest to see results</p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

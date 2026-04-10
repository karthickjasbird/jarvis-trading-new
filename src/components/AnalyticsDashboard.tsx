import { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { ClosedTrade, DailyPnl } from '../hooks/useTrades';
import { Target, TrendingUp, TrendingDown, Activity, PieChart as PieChartIcon } from 'lucide-react';

interface AnalyticsDashboardProps {
  tradeHistory: ClosedTrade[];
  dailyPnl: DailyPnl;
}

export function AnalyticsDashboard({ tradeHistory, dailyPnl }: AnalyticsDashboardProps) {
  const pnlData = useMemo(() => {
    let cumulative = 0;
    return [...tradeHistory]
      .reverse()
      .map((trade, index) => {
        cumulative += trade.pnl || 0;
        return {
          name: `Trade ${index + 1}`,
          pnl: trade.pnl || 0,
          cumulative: cumulative,
        };
      });
  }, [tradeHistory]);

  const winLossData = [
    { name: 'Wins', value: dailyPnl.winCount },
    { name: 'Losses', value: dailyPnl.lossCount },
  ];
  const COLORS = ['#10b981', '#ef4444'];

  const winRate = dailyPnl.tradesCount > 0 
    ? ((dailyPnl.winCount / dailyPnl.tradesCount) * 100).toFixed(1) 
    : 0;

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
          <PieChartIcon className="w-6 h-6 text-blue-400" />
        </div>
        <div>
          <h2 className="text-2xl font-light text-zinc-100">Wealth Manager</h2>
          <p className="text-zinc-500 text-sm">Advanced Analytics & Risk Profiling</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Win Rate Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-6 backdrop-blur-md"
        >
          <div className="flex items-center gap-2 text-zinc-400 mb-4">
            <Target className="w-4 h-4" />
            <h3 className="text-sm font-medium uppercase tracking-wider">Win Rate</h3>
          </div>
          <div className="text-4xl font-light text-zinc-100">{winRate}%</div>
          <div className="text-sm text-zinc-500 mt-2">
            {dailyPnl.winCount} Wins / {dailyPnl.lossCount} Losses
          </div>
        </motion.div>

        {/* Total PnL Card */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-6 backdrop-blur-md"
        >
          <div className="flex items-center gap-2 text-zinc-400 mb-4">
            <Activity className="w-4 h-4" />
            <h3 className="text-sm font-medium uppercase tracking-wider">Total Realized P&L</h3>
          </div>
          <div className={`text-4xl font-light ${dailyPnl.realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {dailyPnl.realizedPnl >= 0 ? '+' : ''}${dailyPnl.realizedPnl.toFixed(2)}
          </div>
          <div className="text-sm text-zinc-500 mt-2">Across {dailyPnl.tradesCount} total trades</div>
        </motion.div>

        {/* Win/Loss Pie Chart */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-6 backdrop-blur-md flex items-center justify-center"
        >
          {dailyPnl.tradesCount > 0 ? (
            <div className="w-full h-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={winLossData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={60}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {winLossData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                    itemStyle={{ color: '#e4e4e7' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-zinc-500 text-sm">Not enough data</div>
          )}
        </motion.div>
      </div>

      {/* PnL Curve Chart */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-6 backdrop-blur-md"
      >
        <div className="flex items-center gap-2 text-zinc-400 mb-6">
          <TrendingUp className="w-4 h-4" />
          <h3 className="text-sm font-medium uppercase tracking-wider">Cumulative P&L Curve</h3>
        </div>
        <div className="w-full h-[300px]">
          {pnlData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pnlData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="name" stroke="#52525b" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#52525b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val}`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                  itemStyle={{ color: '#e4e4e7' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="cumulative" 
                  stroke="#3b82f6" 
                  strokeWidth={3}
                  dot={{ fill: '#3b82f6', strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: '#60a5fa' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-500">
              Execute trades to see your performance curve
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

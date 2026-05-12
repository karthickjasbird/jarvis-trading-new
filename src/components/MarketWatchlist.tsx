import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, ArrowUpDown, Flame, BarChart3, Zap, ChevronRight } from 'lucide-react';

interface CoinData {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  momentum: string;
  volatility: number;
  score: number;
  rsi?: number;
  confluence?: string;
  taSignal?: string;
  signal?: string;
}

type SortKey = 'score' | 'change24h' | 'volume24h' | 'price';

export function MarketWatchlist({ onSelectCoin }: { onSelectCoin: (symbol: string) => void }) {
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [sortAsc, setSortAsc] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/scanner/latest');
      const data = await res.json();
      if (data.allResults) {
        setCoins(data.allResults);
      } else if (data.topOpportunities) {
        setCoins(data.topOpportunities);
      }
      setLoading(false);
    } catch {
      // Fallback: fetch directly from Binance
      try {
        const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
        const allTickers = await res.json();
        const watchPairs = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
          'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
          'MATICUSDT', 'ATOMUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT',
          'OPUSDT', 'SUIUSDT', 'INJUSDT', 'TIAUSDT', 'SEIUSDT'];
        const filtered = allTickers.filter((t: any) => watchPairs.includes(t.symbol));
        const mapped: CoinData[] = filtered.map((t: any) => ({
          symbol: t.symbol.replace('USDT', '/USDT'),
          price: parseFloat(t.lastPrice),
          change24h: parseFloat(t.priceChangePercent),
          volume24h: parseFloat(t.quoteVolume),
          high24h: parseFloat(t.highPrice),
          low24h: parseFloat(t.lowPrice),
          momentum: parseFloat(t.priceChangePercent) > 1.5 ? 'bull' : parseFloat(t.priceChangePercent) < -1.5 ? 'bear' : 'neutral',
          volatility: ((parseFloat(t.highPrice) - parseFloat(t.lowPrice)) / parseFloat(t.lastPrice)) * 100,
          score: 50,
        }));
        setCoins(mapped);
        setLoading(false);
      } catch {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortAsc(!sortAsc);
    else { setSortBy(key); setSortAsc(false); }
  };

  const sorted = [...coins].sort((a, b) => {
    const mult = sortAsc ? 1 : -1;
    return (a[sortBy] - b[sortBy]) * mult;
  });

  // Separate into categories
  const hotPicks = sorted.filter(c => c.score >= 75);
  const allCoins = sorted;

  const getScoreBadge = (score: number) => {
    if (score >= 80) return { color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', label: 'HOT' };
    if (score >= 70) return { color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', label: 'WARM' };
    return { color: 'bg-zinc-700/30 text-zinc-500 border-zinc-600/30', label: '' };
  };

  const getMomentumIcon = (momentum: string) => {
    if (momentum === 'strong_bull' || momentum === 'bull') return <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />;
    if (momentum === 'strong_bear' || momentum === 'bear') return <TrendingDown className="w-3.5 h-3.5 text-red-400" />;
    return <ArrowUpDown className="w-3.5 h-3.5 text-zinc-500" />;
  };

  const formatVolume = (vol: number) => {
    if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(1)}B`;
    if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(0)}M`;
    return `$${(vol / 1_000).toFixed(0)}K`;
  };

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-500 text-sm">Loading market data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6 space-y-6 overflow-y-auto h-full">

      {/* Hot Picks Section */}
      {hotPicks.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Flame className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">Jarvis Picks — Score 75+</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {hotPicks.map(coin => (
              <button
                key={`hot-${coin.symbol}`}
                onClick={() => onSelectCoin(coin.symbol)}
                className="bg-gradient-to-br from-amber-500/10 to-zinc-900/80 border border-amber-500/20 rounded-xl p-4 text-left hover:border-amber-500/40 hover:from-amber-500/15 transition-all duration-200 group"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-white font-semibold text-sm">{coin.symbol}</p>
                    <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full px-1.5 py-0.5">
                      {coin.score}/100
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-amber-400 transition-colors" />
                </div>
                <p className="text-lg font-bold text-white font-mono">
                  ${coin.price >= 1 ? coin.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : coin.price.toFixed(6)}
                </p>
                <div className="flex items-center gap-1 mt-1">
                  {getMomentumIcon(coin.momentum)}
                  <span className={`text-xs font-mono font-medium ${coin.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {coin.change24h >= 0 ? '+' : ''}{coin.change24h.toFixed(2)}%
                  </span>
                </div>
                {coin.rsi && (
                  <p className="text-[10px] text-zinc-500 mt-1">RSI: {coin.rsi}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Full Watchlist Table */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-zinc-400" />
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">All Markets</h2>
          <span className="text-xs text-zinc-600">({coins.length} pairs)</span>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-zinc-800 text-xs text-zinc-500 font-medium uppercase tracking-wider">
            <div className="col-span-3">Asset</div>
            <button onClick={() => handleSort('price')} className="col-span-2 text-right hover:text-zinc-300 transition-colors flex items-center justify-end gap-1">
              Price {sortBy === 'price' && <Zap className="w-3 h-3 text-amber-400" />}
            </button>
            <button onClick={() => handleSort('change24h')} className="col-span-2 text-right hover:text-zinc-300 transition-colors flex items-center justify-end gap-1">
              24h {sortBy === 'change24h' && <Zap className="w-3 h-3 text-amber-400" />}
            </button>
            <button onClick={() => handleSort('volume24h')} className="col-span-2 text-right hover:text-zinc-300 transition-colors flex items-center justify-end gap-1">
              Volume {sortBy === 'volume24h' && <Zap className="w-3 h-3 text-amber-400" />}
            </button>
            <button onClick={() => handleSort('score')} className="col-span-2 text-right hover:text-zinc-300 transition-colors flex items-center justify-end gap-1">
              Score {sortBy === 'score' && <Zap className="w-3 h-3 text-amber-400" />}
            </button>
            <div className="col-span-1"></div>
          </div>

          {/* Table Rows */}
          {allCoins.map((coin, i) => {
            const badge = getScoreBadge(coin.score);
            return (
              <button
                key={coin.symbol}
                onClick={() => onSelectCoin(coin.symbol)}
                className={`grid grid-cols-12 gap-2 px-4 py-3 w-full text-left hover:bg-zinc-800/50 transition-all duration-150 group
                  ${i !== allCoins.length - 1 ? 'border-b border-zinc-800/50' : ''}`}
              >
                {/* Asset */}
                <div className="col-span-3 flex items-center gap-2.5">
                  {getMomentumIcon(coin.momentum)}
                  <div>
                    <p className="text-white font-medium text-sm">{coin.symbol.replace('/USDT', '')}</p>
                    <p className="text-[10px] text-zinc-600">{coin.momentum.replace('_', ' ')}</p>
                  </div>
                </div>

                {/* Price */}
                <div className="col-span-2 text-right">
                  <p className="text-white font-mono text-sm">
                    ${coin.price >= 1 ? coin.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : coin.price.toFixed(4)}
                  </p>
                </div>

                {/* 24h Change */}
                <div className="col-span-2 text-right">
                  <span className={`text-sm font-mono font-medium px-2 py-0.5 rounded ${
                    coin.change24h >= 0 ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'
                  }`}>
                    {coin.change24h >= 0 ? '+' : ''}{coin.change24h.toFixed(2)}%
                  </span>
                </div>

                {/* Volume */}
                <div className="col-span-2 text-right">
                  <p className="text-zinc-400 text-sm font-mono">{formatVolume(coin.volume24h)}</p>
                </div>

                {/* Score */}
                <div className="col-span-2 text-right flex items-center justify-end gap-1.5">
                  <span className={`text-xs font-bold border rounded-full px-2 py-0.5 ${badge.color}`}>
                    {coin.score}
                  </span>
                  {badge.label && (
                    <span className={`text-[9px] font-bold ${badge.color} rounded px-1`}>{badge.label}</span>
                  )}
                </div>

                {/* Arrow */}
                <div className="col-span-1 flex items-center justify-end">
                  <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-amber-400 transition-colors" />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

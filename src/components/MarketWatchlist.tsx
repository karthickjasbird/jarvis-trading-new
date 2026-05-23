import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Minus, BarChart3, ChevronRight, RefreshCw, Flame } from 'lucide-react';

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
  obv?: number;
  obvSlope?: 'up' | 'down' | 'flat';
  vwap?: number;
}

type SortKey = 'score' | 'change24h' | 'volume24h' | 'price';
type AssetClass = 'crypto' | 'stocks' | 'commodities';

// Subset of STOCK_SCAN_PAIRS that the Commodities tab filters down to.
// Kept in sync with engine/marketScanner.ts.
const COMMODITY_TICKERS = new Set(['GLD', 'SLV', 'USO', 'UNG', 'DBA', 'COPX']);

/**
 * Derive a unified verdict from the TA signal + score.
 * This is the SINGLE source of truth for display.
 */
function getVerdict(confluence?: string, score: number = 50): {
  label: string;
  icon: 'up' | 'down' | 'dash';
  color: string;        // text + border color classes
  bgColor: string;      // pill background
  rowTint: string;      // subtle row background tint
} {
  const isBuy = confluence === 'buy' || confluence === 'strong_buy';
  const isSell = confluence === 'sell' || confluence === 'strong_sell';

  if (isBuy && score >= 65) {
    return {
      label: confluence === 'strong_buy' ? 'STRONG BUY' : 'BUY',
      icon: 'up',
      color: 'text-emerald-400 border-emerald-500/40',
      bgColor: 'bg-emerald-500/20',
      rowTint: 'bg-emerald-500/[0.03]',
    };
  }

  if (isSell) {
    return {
      label: confluence === 'strong_sell' ? 'STRONG SELL' : 'SELL',
      icon: 'down',
      color: 'text-red-400 border-red-500/40',
      bgColor: 'bg-red-500/20',
      rowTint: 'bg-red-500/[0.03]',
    };
  }

  // Everything else = HOLD (neutral)
  return {
    label: 'HOLD',
    icon: 'dash',
    color: 'text-zinc-400 border-zinc-600/40',
    bgColor: 'bg-zinc-700/20',
    rowTint: '',
  };
}

function VerdictIcon({ type }: { type: 'up' | 'down' | 'dash' }) {
  if (type === 'up') return <TrendingUp className="w-3.5 h-3.5" />;
  if (type === 'down') return <TrendingDown className="w-3.5 h-3.5" />;
  return <Minus className="w-3.5 h-3.5" />;
}

export function MarketWatchlist({ onSelectCoin }: { onSelectCoin: (symbol: string) => void }) {
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [sortAsc, setSortAsc] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<string>('');
  const [assetClass, setAssetClass] = useState<AssetClass>('crypto');
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);

  // Equity-side data fetcher. POSTs to scan-stocks; for the Commodities tab
  // we filter the shared stock scan down to the commodity ETF set client-side
  // (same data, no second backend call needed).
  const fetchStocks = useCallback(async (filterCommodities: boolean) => {
    const res = await fetch('/api/scanner/scan-stocks', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Stock scan failed');
    const list: CoinData[] = (data.allResults || []) as CoinData[];
    return filterCommodities ? list.filter(c => COMMODITY_TICKERS.has(c.symbol)) : list;
  }, []);

  const fetchData = useCallback(async () => {
    setScanError(null);
    try {
      if (assetClass === 'crypto') {
        const res = await fetch('/api/scanner/latest');
        const data = await res.json();
        if (data.allResults) setCoins(data.allResults);
        else if (data.topOpportunities) setCoins(data.topOpportunities);
        if (data.timestamp) setLastScanTime(new Date(data.timestamp).toLocaleTimeString());
      } else {
        const list = await fetchStocks(assetClass === 'commodities');
        setCoins(list);
        setLastScanTime(new Date().toLocaleTimeString());
      }
      setLoading(false);
    } catch (err: any) {
      // For the crypto tab, fall back to a direct Binance read so the UI
      // still renders if our scanner endpoint is down. Stocks have no
      // equivalent free fallback — surface the failure inline so the
      // user knows why the table is empty instead of staring at blank space.
      if (assetClass !== 'crypto') {
        setCoins([]);
        setLoading(false);
        setScanError(
          assetClass === 'commodities'
            ? 'Commodities feed temporarily unavailable. Try the Crypto tab or hit Scan Now to retry.'
            : 'Stocks feed temporarily unavailable. Try the Crypto tab or hit Scan Now to retry.'
        );
        return;
      }
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
  }, [assetClass, fetchStocks]);

  const triggerScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      if (assetClass === 'crypto') {
        const res = await fetch('/api/scanner/scan', { method: 'POST' });
        const data = await res.json();
        if (data.allResults) setCoins(data.allResults);
        else if (data.topOpportunities) setCoins(data.topOpportunities);
        if (data.timestamp) setLastScanTime(new Date(data.timestamp).toLocaleTimeString());
      } else {
        const list = await fetchStocks(assetClass === 'commodities');
        setCoins(list);
        setLastScanTime(new Date().toLocaleTimeString());
      }
    } catch (e) {
      console.error('Scan failed:', e);
      if (assetClass !== 'crypto') {
        setScanError(
          assetClass === 'commodities'
            ? 'Commodities feed temporarily unavailable.'
            : 'Stocks feed temporarily unavailable.'
        );
      }
    }
    setScanning(false);
  }, [assetClass, fetchStocks]);

  // Re-run the data fetch whenever the user switches tabs so the table
  // populates immediately instead of waiting for the 30s interval tick.
  useEffect(() => {
    setLoading(true);
    setCoins([]);
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Equity market clock: only relevant for the stock/commodity tabs.
  // Refresh every 60s — the open/close transition is the only thing
  // worth chasing and it happens at well-known times.
  useEffect(() => {
    if (assetClass === 'crypto') {
      setMarketOpen(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/alpaca/clock');
        const data = await res.json();
        if (!cancelled && typeof data.is_open === 'boolean') setMarketOpen(data.is_open);
      } catch {}
    };
    tick();
    const interval = setInterval(tick, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [assetClass]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortAsc(!sortAsc);
    else { setSortBy(key); setSortAsc(false); }
  };

  const sorted = [...coins].sort((a, b) => {
    const mult = sortAsc ? 1 : -1;
    return (a[sortBy] - b[sortBy]) * mult;
  });

  // Jarvis Picks: ONLY coins with BUY/STRONG_BUY TA signal AND score >= 65
  const hotPicks = sorted.filter(c =>
    (c.confluence === 'buy' || c.confluence === 'strong_buy') && c.score >= 65
  );

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

      {/* Header with Scan Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-amber-400" />
          <h1 className="text-base font-semibold text-white">Market Scanner</h1>
          <span className="text-xs text-zinc-600">{coins.length} {assetClass === 'crypto' ? 'pairs' : 'tickers'}</span>
          {assetClass !== 'crypto' && marketOpen !== null && (
            <span
              className={`ml-2 inline-flex items-center gap-1 text-[10px] font-bold border rounded-full px-2 py-0.5 ${
                marketOpen
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-zinc-700/20 text-zinc-500 border-zinc-600/40'
              }`}
              title={marketOpen ? 'US equity market is open' : 'US equity market is closed — last-session data'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${marketOpen ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
              {marketOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastScanTime && (
            <span className="text-[10px] text-zinc-600">Last scan: {lastScanTime}</span>
          )}
          <button
            onClick={triggerScan}
            disabled={scanning}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-medium hover:bg-emerald-500/30 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning...' : 'Scan Now'}
          </button>
        </div>
      </div>

      {/* Asset-class tabs (Phase 8.4) */}
      <div className="flex items-center gap-1 bg-zinc-900/60 border border-zinc-800 rounded-lg p-1 w-fit">
        {(['crypto', 'stocks', 'commodities'] as AssetClass[]).map((cls) => {
          const active = assetClass === cls;
          const label = cls === 'crypto' ? '🪙 Crypto' : cls === 'stocks' ? '📈 Stocks' : '🛢️ Commodities';
          return (
            <button
              key={cls}
              onClick={() => setAssetClass(cls)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                active
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Feed-error banner (Phase 8.4 polish) */}
      {scanError && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-2">
          <span className="text-amber-400 text-sm">⚠️</span>
          <p className="text-amber-300 text-xs leading-relaxed">{scanError}</p>
        </div>
      )}

      {/* Hot Picks Section — ONLY BUY signals */}
      {hotPicks.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Flame className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">Jarvis Picks — Buy Signals</h2>
            <span className="text-[10px] text-zinc-600 ml-1">({hotPicks.length} found)</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {hotPicks.map(coin => {
              const verdict = getVerdict(coin.confluence, coin.score);
              return (
                <button
                  key={`hot-${coin.symbol}`}
                  onClick={() => onSelectCoin(coin.symbol)}
                  className="bg-gradient-to-br from-emerald-500/10 to-zinc-900/80 border border-emerald-500/20 rounded-xl p-4 text-left hover:border-emerald-500/40 hover:from-emerald-500/15 transition-all duration-200 group"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-white font-semibold text-sm">{coin.symbol}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={`inline-flex items-center gap-1 text-[9px] font-bold border rounded-full px-1.5 py-0.5 ${verdict.bgColor} ${verdict.color}`}>
                          <VerdictIcon type={verdict.icon} />
                          {verdict.label} {coin.score}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-emerald-400 transition-colors" />
                  </div>
                  <p className="text-lg font-bold text-white font-mono">
                    ${coin.price >= 1 ? coin.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : coin.price.toFixed(6)}
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    <span className={`text-xs font-mono font-medium ${coin.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {coin.change24h >= 0 ? '+' : ''}{coin.change24h.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 mt-2">
                    {coin.rsi && <span className="text-[10px] text-zinc-500 mr-1">RSI: {coin.rsi}</span>}
                    {coin.vwap !== undefined && (
                      coin.price > coin.vwap ? (
                        <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
                          VWAP ▲
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[9px] font-medium px-1.5 py-0.5 bg-zinc-800 text-zinc-500 border border-zinc-700/20 rounded">
                          VWAP ▼
                        </span>
                      )
                    )}
                    {coin.obvSlope && (
                      coin.obvSlope === 'up' ? (
                        <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
                          OBV ▲
                        </span>
                      ) : coin.obvSlope === 'down' ? (
                        <span className="inline-flex items-center text-[9px] font-medium px-1.5 py-0.5 bg-zinc-800 text-zinc-500 border border-zinc-700/20 rounded">
                          OBV ▼
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-[9px] font-medium px-1.5 py-0.5 bg-zinc-800 text-zinc-500 border border-zinc-700/20 rounded">
                          OBV ▬
                        </span>
                      )
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* No Picks Warning */}
      {hotPicks.length === 0 && (
        <div className="bg-zinc-900/50 border border-zinc-700/50 rounded-xl p-6 text-center">
          <p className="text-zinc-400 text-sm">🔍 No strong buy signals detected right now.</p>
          <p className="text-zinc-600 text-xs mt-1">Jarvis is waiting for better conditions. Check the full list below.</p>
        </div>
      )}

      {/* Full Watchlist Table */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-zinc-400" />
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            {assetClass === 'crypto' ? 'All Markets' : assetClass === 'stocks' ? 'All Stocks' : 'All Commodities'}
          </h2>
          <span className="text-xs text-zinc-600">({coins.length} {assetClass === 'crypto' ? 'pairs' : 'tickers'})</span>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2.5 border-b border-zinc-800 text-xs text-zinc-500 font-medium uppercase tracking-wider">
            <div className="col-span-3">Asset</div>
            <button onClick={() => handleSort('price')} className="col-span-2 text-right hover:text-zinc-300 transition-colors flex items-center justify-end gap-1">
              Price
            </button>
            <button onClick={() => handleSort('change24h')} className="col-span-2 text-right hover:text-zinc-300 transition-colors flex items-center justify-end gap-1">
              24h Change
            </button>
            <button onClick={() => handleSort('score')} className="col-span-4 text-right hover:text-zinc-300 transition-colors flex items-center justify-end gap-1">
              Verdict
            </button>
            <div className="col-span-1"></div>
          </div>

          {/* Table Rows */}
          {sorted.map((coin, i) => {
            const verdict = getVerdict(coin.confluence, coin.score);
            return (
              <button
                key={coin.symbol}
                onClick={() => onSelectCoin(coin.symbol)}
                className={`grid grid-cols-12 gap-2 px-4 py-3 w-full text-left hover:bg-zinc-800/50 transition-all duration-150 group
                  ${verdict.rowTint}
                  ${i !== sorted.length - 1 ? 'border-b border-zinc-800/50' : ''}`}
              >
                {/* Asset */}
                <div className="col-span-3 flex items-center gap-2.5">
                  <div className={`w-1.5 h-8 rounded-full ${
                    verdict.icon === 'up' ? 'bg-emerald-500/60' :
                    verdict.icon === 'down' ? 'bg-red-500/60' :
                    'bg-zinc-700/40'
                  }`} />
                  <div>
                    <p className="text-white font-medium text-sm">{coin.symbol.replace('/USDT', '')}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {coin.rsi && <span className="text-[10px] text-zinc-500 mr-1.5">RSI: {coin.rsi}</span>}
                      {coin.vwap !== undefined && (
                        coin.price > coin.vwap ? (
                          <span className="inline-flex items-center text-[9px] font-bold px-1 py-0.25 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
                            VWAP ▲
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[9px] font-medium px-1 py-0.25 bg-zinc-800 text-zinc-500 border border-zinc-700/20 rounded">
                            VWAP ▼
                          </span>
                        )
                      )}
                      {coin.obvSlope && (
                        coin.obvSlope === 'up' ? (
                          <span className="inline-flex items-center text-[9px] font-bold px-1 py-0.25 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
                            OBV ▲
                          </span>
                        ) : coin.obvSlope === 'down' ? (
                          <span className="inline-flex items-center text-[9px] font-medium px-1 py-0.25 bg-zinc-800 text-zinc-500 border border-zinc-700/20 rounded">
                            OBV ▼
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-[9px] font-medium px-1 py-0.25 bg-zinc-800 text-zinc-500 border border-zinc-700/20 rounded">
                            OBV ▬
                          </span>
                        )
                      )}
                    </div>
                  </div>
                </div>

                {/* Price */}
                <div className="col-span-2 text-right flex items-center justify-end">
                  <p className="text-white font-mono text-sm">
                    ${coin.price >= 1 ? coin.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : coin.price.toFixed(4)}
                  </p>
                </div>

                {/* 24h Change */}
                <div className="col-span-2 text-right flex items-center justify-end">
                  <span className={`text-sm font-mono font-medium px-2 py-0.5 rounded ${
                    coin.change24h >= 0 ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'
                  }`}>
                    {coin.change24h >= 0 ? '+' : ''}{coin.change24h.toFixed(2)}%
                  </span>
                </div>

                {/* Unified Verdict — Signal + Score combined */}
                <div className="col-span-4 flex items-center justify-end gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold border rounded-full px-3 py-1 ${verdict.bgColor} ${verdict.color}`}>
                    <VerdictIcon type={verdict.icon} />
                    {verdict.label}
                    <span className="opacity-70 ml-0.5">{coin.score}</span>
                  </span>
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

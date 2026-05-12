import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, SeriesMarker, ColorType } from 'lightweight-charts';
import { Brain, TrendingUp, TrendingDown, Minus } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────
interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  value: number;
  color: string;
}

interface JarvisSignal {
  timestamp: number;
  price: number;
  type: 'entry' | 'exit';
  side: 'long' | 'short';
  reason: string;
  pnl?: number;
}

interface ThoughtEntry {
  time: string;
  message: string;
  type: 'scan' | 'signal' | 'entry' | 'exit' | 'hold';
}

// ── Indicator helpers ─────────────────────────────────────────────────────────
function calcEMA(prices: number[], period: number): (number | null)[] {
  if (prices.length < period) return new Array(prices.length).fill(null);
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(period - 1).fill(null);
  let prev = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(prev);
  for (let i = period; i < prices.length; i++) {
    prev = prices[i] * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function calcRSI(prices: number[]): (number | null)[] {
  const result: (number | null)[] = new Array(14).fill(null);
  if (prices.length < 15) return result;
  let gains = 0, losses = 0;
  for (let i = 1; i <= 14; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  let avgGain = gains / 14, avgLoss = losses / 14;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = 15; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    avgGain = (avgGain * 13 + (d > 0 ? d : 0)) / 14;
    avgLoss = (avgLoss * 13 + (d < 0 ? Math.abs(d) : 0)) / 14;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function deriveSignal(rsi: number | null, ema12: number | null, ema26: number | null, price: number): 'LONG' | 'SHORT' | 'HOLD' {
  if (!rsi || !ema12 || !ema26) return 'HOLD';
  if (rsi > 95 || rsi < 5) return 'HOLD';
  if (ema12 > ema26 && price > ema12 && rsi > 45 && rsi < 72) return 'LONG';
  if (ema12 < ema26 && price < ema12 && rsi < 55 && rsi > 28) return 'SHORT';
  return 'HOLD';
}

// ── Component ─────────────────────────────────────────────────────────────────
export function ReplayChart({
  symbol, replayDate, speed, jarvisEnabled, capital = 5000, profitTarget = 100
}: {
  symbol: string;
  broker?: string;
  replayDate?: string;
  speed?: number;
  jarvisEnabled?: boolean;
  capital?: number;
  profitTarget?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ema12SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema26SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Playback state
  const allCandlesRef = useRef<Candle[]>([]);
  const playbackIdxRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const signalsRef = useRef<JarvisSignal[]>([]);
  const openPositionRef = useRef<{ price: number; side: 'long' | 'short'; timestamp: number } | null>(null);

  // Indicator accumulator (O(1) – we maintain running state)
  const pricesRef = useRef<number[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [currentCandle, setCurrentCandle] = useState<Candle | null>(null);
  const [thoughts, setThoughts] = useState<ThoughtEntry[]>([]);
  const [runningPnl, setRunningPnl] = useState(0);
  const [openPosition, setOpenPosition] = useState<{ price: number; side: 'long' | 'short' } | null>(null);
  const [playbackIdx, setPlaybackIdx] = useState(0);
  const thoughtsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { thoughtsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thoughts]);

  // ── 1. Init chart ONCE ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,                                    // ← fills container automatically
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#71717a',
      },
      grid: { vertLines: { color: '#27272a' }, horzLines: { color: '#27272a' } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#3f3f46' },
      rightPriceScale: { borderColor: '#3f3f46' },
      crosshair: { mode: 1 },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });

    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a33',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    // @ts-ignore
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      ema12SeriesRef.current = null;
      ema26SeriesRef.current = null;
    };
  }, []); // stable – never recreates

  // ── 2. Manage EMA series based on jarvisEnabled ────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    if (jarvisEnabled) {
      if (!ema12SeriesRef.current) {
        ema12SeriesRef.current = chartRef.current.addLineSeries({
          color: '#8b5cf6', lineWidth: 2, lineStyle: 0, crosshairMarkerVisible: false,
        });
      }
      if (!ema26SeriesRef.current) {
        ema26SeriesRef.current = chartRef.current.addLineSeries({
          color: '#f59e0b', lineWidth: 2, lineStyle: 0, crosshairMarkerVisible: false,
        });
      }
    } else {
      // Remove EMA series when Jarvis is off
      if (ema12SeriesRef.current && chartRef.current) {
        try { chartRef.current.removeSeries(ema12SeriesRef.current); } catch {}
        ema12SeriesRef.current = null;
      }
      if (ema26SeriesRef.current && chartRef.current) {
        try { chartRef.current.removeSeries(ema26SeriesRef.current); } catch {}
        ema26SeriesRef.current = null;
      }
    }
  }, [jarvisEnabled]);

  // ── 3. Fetch candles ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!symbol || !replayDate) return;
    let mounted = true;

    setLoading(true);
    setFetchError(null);
    setThoughts([]);
    setRunningPnl(0);
    setOpenPosition(null);
    setCurrentCandle(null);
    setPlaybackIdx(0);
    allCandlesRef.current = [];
    playbackIdxRef.current = 0;
    signalsRef.current = [];
    openPositionRef.current = null;
    pricesRef.current = [];

    // Clear chart
    candleSeriesRef.current?.setData([]);
    volumeSeriesRef.current?.setData([]);
    ema12SeriesRef.current?.setData([]);
    ema26SeriesRef.current?.setData([]);

    // Stop any running playback
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }

    fetch(`/api/replay/candles?symbol=${symbol}&date=${replayDate}&interval=1m`)
      .then(async (res) => {
        const data = await res.json();
        if (!mounted) return;
        if (res.ok && data.status === 'success' && Array.isArray(data.data) && data.data.length > 0) {
          allCandlesRef.current = data.data;
          setLoading(false);
        } else {
          setFetchError(data.error || `No data for ${symbol} on ${replayDate}`);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) { setFetchError(`Network error: ${err.message}`); setLoading(false); }
      });

    return () => { mounted = false; };
  }, [symbol, replayDate]);

  // ── 4. Start playback when candles arrive ──────────────────────────────────
  useEffect(() => {
    if (loading || fetchError || allCandlesRef.current.length === 0) return;
    if (!chartRef.current || !candleSeriesRef.current) return;

    const candles = allCandlesRef.current;
    const playbackSpeed = speed || 1;
    const intervalMs = Math.max(16, 1000 / playbackSpeed);

    // Seed with first candle so chart is not empty
    candleSeriesRef.current.setData([candles[0]]);
    volumeSeriesRef.current?.setData([{ time: candles[0].time as Time, value: candles[0].value, color: candles[0].color }]);
    chartRef.current.timeScale().fitContent();
    setCurrentCandle(candles[0]);
    playbackIdxRef.current = 1;
    pricesRef.current = [candles[0].close];

    intervalRef.current = setInterval(() => {
      const idx = playbackIdxRef.current;
      if (idx >= candles.length) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        return;
      }

      const candle = candles[idx];
      playbackIdxRef.current = idx + 1;

      // O(1) update — no slice, no setData on full array
      candleSeriesRef.current?.update({ ...candle, time: candle.time as Time });
      volumeSeriesRef.current?.update({ time: candle.time as Time, value: candle.value, color: candle.color });

      pricesRef.current.push(candle.close);
      setCurrentCandle(candle);
      setPlaybackIdx(idx + 1);

      if (!jarvisEnabled) return;

      // EMA indicators (O(n) but only called once per tick with small running array)
      const prices = pricesRef.current;
      const ema12Arr = calcEMA(prices, 12);
      const ema26Arr = calcEMA(prices, 26);
      const ema12Val = ema12Arr[ema12Arr.length - 1];
      const ema26Val = ema26Arr[ema26Arr.length - 1];

      if (ema12Val !== null && ema12SeriesRef.current) {
        ema12SeriesRef.current.update({ time: candle.time as Time, value: ema12Val });
      }
      if (ema26Val !== null && ema26SeriesRef.current) {
        ema26SeriesRef.current.update({ time: candle.time as Time, value: ema26Val });
      }

      // AI SIMULATION LOGIC (only after warmup)
      if (prices.length < 30) return;
      if ((window as any).isJarvisThinking) return; // Global flag to pause ticks

      const rsiArr = calcRSI(prices);
      const rsi = rsiArr[rsiArr.length - 1];
      const price = candle.close;
      const timeStr = new Date(candle.time * 1000).toLocaleTimeString();
      const spread = ema12Val && ema26Val ? ((ema12Val - ema26Val) / ema26Val * 100).toFixed(4) : '0';

      const pos = openPositionRef.current;

      // Ask Jarvis every 15 candles (if no position) or every 5 candles (if managing a position)
      const shouldAskJarvis = pos ? prices.length % 5 === 0 : prices.length % 15 === 0;

      if (shouldAskJarvis) {
        (window as any).isJarvisThinking = true;
        setThoughts(p => [...p.slice(-49), { time: timeStr, message: "🧠 Matrix connection established... Simulating decision...", type: 'hold' }]);

        fetch('/api/simulate-tick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: 'time_machine_user',
            symbol: symbol,
            currentPrice: price,
            rsi: rsi,
            ema12: ema12Val,
            ema26: ema26Val,
            position: pos ? { side: pos.side, price: pos.price } : null,
            capital,
            profitTarget
          })
        }).then(res => res.json()).then(async data => {
          if (data.status === 'success') {
            const signal = data.action;
            const reasoning = data.reasoning;

            if (signal === 'LONG' && !pos) {
              const msg = `📈 LONG entry @ $${price.toFixed(2)} | ${reasoning}`;
              signalsRef.current.push({ timestamp: candle.time, price, type: 'entry', side: 'long', reason: msg });
              openPositionRef.current = { price, side: 'long', timestamp: candle.time };
              setOpenPosition({ price, side: 'long' });
              setThoughts(p => [...p.slice(-49), { time: timeStr, message: msg, type: 'entry' }]);
            } else if (signal === 'SHORT' && !pos) {
              const msg = `📉 SHORT entry @ $${price.toFixed(2)} | ${reasoning}`;
              signalsRef.current.push({ timestamp: candle.time, price, type: 'entry', side: 'short', reason: msg });
              openPositionRef.current = { price, side: 'short', timestamp: candle.time };
              setOpenPosition({ price, side: 'short' });
              setThoughts(p => [...p.slice(-49), { time: timeStr, message: msg, type: 'entry' }]);
            } else if (pos && signal === 'EXIT') {
              const pnl = pos.side === 'long' ? price - pos.price : pos.price - price;
              const msg = `${pnl >= 0 ? '✅' : '❌'} EXIT ${pos.side.toUpperCase()} @ $${price.toFixed(2)} | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | ${reasoning}`;
              signalsRef.current.push({ timestamp: candle.time, price, type: 'exit', side: pos.side, reason: msg, pnl });
              
              setRunningPnl(prev => prev + pnl);
              setThoughts(p => [...p.slice(-49), { time: timeStr, message: msg, type: 'exit' }]);
              
              // Trigger post-mortem learning!
              const mockTrade = {
                symbol,
                side: pos.side,
                entryPrice: pos.price,
                exitPrice: price,
                pnl,
                timestamp: candle.time
              };
              try {
                await fetch('/api/simulate-lesson', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId: 'time_machine_user', trade: mockTrade })
                });
                setThoughts(p => [...p.slice(-49), { time: timeStr, message: "📚 Post-mortem complete. Lesson saved to Memory Bank.", type: 'hold' }]);
              } catch (e) {}
              
              openPositionRef.current = null;
              setOpenPosition(null);
            } else {
              // HOLD
              const unrealized = pos ? (pos.side === 'long' ? price - pos.price : pos.price - price) : null;
              const msg = pos
                ? `📊 Holding ${pos.side.toUpperCase()} | Unrealized: ${unrealized! >= 0 ? '+' : ''}$${unrealized!.toFixed(2)} | ${reasoning}`
                : `🔍 Scanning... | ${reasoning}`;
              setThoughts(p => [...p.slice(-49), { time: timeStr, message: msg, type: 'hold' }]);
            }
          }
          (window as any).isJarvisThinking = false;
        }).catch(() => {
          (window as any).isJarvisThinking = false;
        });
      }

      // Update markers
      const markers: SeriesMarker<Time>[] = signalsRef.current.map(sig => ({
        time: sig.timestamp as Time,
        position: sig.type === 'entry' ? (sig.side === 'long' ? 'belowBar' : 'aboveBar') : 'inBar',
        color: sig.type === 'entry' ? (sig.side === 'long' ? '#10b981' : '#ef4444') : '#f59e0b',
        shape: sig.type === 'entry' ? (sig.side === 'long' ? 'arrowUp' : 'arrowDown') : 'circle',
        text: sig.type === 'entry' ? `${sig.side.toUpperCase()}` : 'EXIT',
      }));
      candleSeriesRef.current?.setMarkers(markers);

    }, intervalMs);

    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [loading, fetchError, speed, jarvisEnabled]);

  // ── Computed values (safe even when no data yet) ─────────────────────────
  const total = allCandlesRef.current.length;
  const price = currentCandle?.close || 0;
  const pnlColor = runningPnl >= 0 ? 'text-emerald-400' : 'text-red-400';
  const unrealizedPnl = openPosition
    ? (openPosition.side === 'long' ? price - openPosition.price : openPosition.price - price)
    : 0;
  const progressPct = total > 0 ? Math.round((playbackIdx / total) * 100) : 0;

  // ── Render — ALWAYS render containerRef so the chart can init on mount ──
  return (
    <div className="w-full h-full flex flex-col bg-zinc-950 overflow-hidden">

      {/* Header */}
      <div className="shrink-0 flex justify-between items-center px-5 pt-4 pb-2 border-b border-zinc-800/60">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-zinc-100 font-mono">{symbol.replace('USDT', '/USDT')}</h2>
            <span className="text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full uppercase">
              Historical Replay
            </span>
            {jarvisEnabled && (
              <span className="text-xs font-semibold text-violet-300 bg-violet-500/10 border border-violet-500/30 px-2 py-0.5 rounded-full uppercase flex items-center gap-1">
                <Brain className="w-3 h-3 animate-pulse" /> AI Pilot
              </span>
            )}
          </div>
          <p className="text-zinc-600 font-mono text-xs">
            {currentCandle ? new Date(currentCandle.time * 1000).toLocaleString() : ''}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xl font-mono font-bold text-zinc-100">
              ${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-zinc-600 font-mono text-right">
              {playbackIdx}/{total} candles
            </div>
          </div>
          {jarvisEnabled && (
            <div className="text-right bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5">
              <div className="text-xs text-zinc-500 font-mono">JARVIS P&L</div>
              <div className={`text-base font-mono font-bold ${pnlColor}`}>
                {runningPnl >= 0 ? '+' : ''}${runningPnl.toFixed(2)}
              </div>
              {openPosition && (
                <div className={`text-xs font-mono ${unrealizedPnl >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
                  Open: {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="shrink-0 h-0.5 bg-zinc-900">
        <div
          className="h-full bg-amber-500/60 transition-all duration-100"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Chart — ALWAYS rendered so containerRef exists for useEffect([]) */}
      <div className={`min-h-0 ${jarvisEnabled ? 'flex-[2]' : 'flex-1'} relative`}>
        <div ref={containerRef} className="absolute inset-0" />

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 font-mono text-zinc-500 bg-zinc-950/90">
            <div className="w-8 h-8 border-2 border-amber-500/40 border-t-amber-500 rounded-full animate-spin" />
            <span className="text-sm">Fetching {symbol} · {replayDate}...</span>
          </div>
        )}

        {/* Error overlay */}
        {fetchError && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-8 font-mono bg-zinc-950/90">
            <div className="text-3xl">⚠️</div>
            <div className="text-sm font-bold text-red-400">Failed to load candle data</div>
            <div className="text-xs text-zinc-500 text-center max-w-md leading-relaxed bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
              {fetchError}
            </div>
            <div className="text-xs text-zinc-600">{symbol} · {replayDate}</div>
          </div>
        )}
      </div>

      {/* Legend */}
      {jarvisEnabled && (
        <div className="shrink-0 flex items-center gap-4 px-5 py-1.5 border-t border-zinc-800/40 bg-zinc-900/30">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 h-0 border-t-2 border-violet-500" />
            <span className="text-xs text-zinc-500">EMA 12</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 h-0 border-t-2 border-amber-500" />
            <span className="text-xs text-zinc-500">EMA 26</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-emerald-400 text-xs">▲</span>
            <span className="text-xs text-zinc-500">Long Entry</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-red-400 text-xs">▼</span>
            <span className="text-xs text-zinc-500">Short Entry</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-amber-400 text-xs">●</span>
            <span className="text-xs text-zinc-500">Exit</span>
          </span>
          {playbackIdx < 50 && (
            <span className="ml-auto text-xs text-zinc-600 italic">⏳ Warming up ({playbackIdx}/50)</span>
          )}
        </div>
      )}

      {/* Jarvis Thought Stream */}
      {jarvisEnabled && (
        <div className="shrink-0 h-44 flex flex-col border-t border-zinc-800/60 bg-zinc-900/40">
          <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-zinc-800/40">
            <Brain className="w-3.5 h-3.5 text-violet-400 animate-pulse" />
            <span className="text-xs font-semibold text-violet-300 tracking-wider uppercase">Jarvis Thought Stream</span>
            {openPosition ? (
              <span className={`ml-auto text-xs font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                openPosition.side === 'long'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                  : 'bg-red-500/15 text-red-400 border border-red-500/25'
              }`}>
                {openPosition.side === 'long' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {openPosition.side.toUpperCase()} OPEN @ ${openPosition.price.toFixed(2)}
              </span>
            ) : (
              <span className="ml-auto text-xs text-zinc-600 flex items-center gap-1">
                <Minus className="w-3 h-3" /> No Position
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-1.5 space-y-0.5 font-mono text-xs">
            {thoughts.length === 0 && (
              <div className="text-zinc-600 py-3 text-center">
                {playbackIdx < 28
                  ? `Collecting data... (${playbackIdx}/28 candles needed to start)`
                  : 'Jarvis is analyzing...'}
              </div>
            )}
            {thoughts.map((t, i) => (
              <div key={i} className={`flex items-start gap-2 py-0.5 ${
                t.type === 'entry' ? 'text-emerald-300' :
                t.type === 'exit' ? 'text-amber-300' : 'text-zinc-500'
              }`}>
                <span className="text-zinc-700 shrink-0">{t.time}</span>
                <span className="leading-relaxed">{t.message}</span>
              </div>
            ))}
            <div ref={thoughtsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}

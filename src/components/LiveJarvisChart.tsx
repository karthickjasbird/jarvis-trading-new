import React, { useState, useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, Time, SeriesMarker, ColorType } from 'lightweight-charts';
import { Brain, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Position {
  id: string;
  symbol: string;
  side: 'long' | 'short' | 'buy' | 'sell';
  entryPrice: number;
  quantity: number;
  pnl?: number;
  // Phase 7-D: optional SL/TP for in-chart trade visualization
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

interface Trade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  closedAt: string | number;
}

export function LiveJarvisChart({
  symbol,
  positions,
  tradeHistory,
  sentryLogs
}: {
  symbol: string;
  positions: Position[];
  tradeHistory: Trade[];
  sentryLogs: any[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [currentPrice, setCurrentPrice] = useState(0);
  // Phase 7-D: refs for the 3 trade-overlay price lines so we can remove them
  // cleanly when the trade changes / closes.
  const entryLineRef = useRef<any>(null);
  const slLineRef = useRef<any>(null);
  const tpLineRef = useRef<any>(null);

  const cleanSymbol = (symbol || '').replace('BINANCE:', '').replace('/', '').toLowerCase();

  // 1. Init chart ONCE
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
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
    };
  }, []);

  // 2. Fetch seed data & connect to live WebSocket
  useEffect(() => {
    if (!cleanSymbol || !chartRef.current || !candleSeriesRef.current) return;
    
    let isMounted = true;
    let ws: WebSocket;

    setLoading(true);

    // Fetch last 100 1-min candles
    fetch(`https://api.binance.com/api/v3/klines?symbol=${cleanSymbol.toUpperCase()}&interval=1m&limit=100`)
      .then(res => res.json())
      .then(klines => {
        if (!isMounted) return;
        
        const data = klines.map((k: any) => ({
          time: Math.floor(k[0] / 1000) as Time,
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          value: parseFloat(k[5]),
          color: parseFloat(k[4]) >= parseFloat(k[1]) ? '#26a69a' : '#ef5350',
        }));

        candleSeriesRef.current?.setData(data);
        volumeSeriesRef.current?.setData(data);
        chartRef.current?.timeScale().fitContent();
        
        if (data.length > 0) setCurrentPrice(data[data.length - 1].close);
        setLoading(false);

        // Connect to Binance live kline stream
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/${cleanSymbol}@kline_1m`);
        
        ws.onmessage = (event) => {
          if (!isMounted) return;
          const msg = JSON.parse(event.data);
          const k = msg.k;
          if (k) {
            const candle = {
              time: Math.floor(k.t / 1000) as Time,
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
            };
            candleSeriesRef.current?.update(candle);
            volumeSeriesRef.current?.update({
              time: candle.time,
              value: parseFloat(k.v),
              color: candle.close >= candle.open ? '#26a69a' : '#ef5350'
            });
            setCurrentPrice(candle.close);
          }
        };
      })
      .catch(console.error);

    return () => {
      isMounted = false;
      if (ws) ws.close();
    };
  }, [cleanSymbol]);

  // 3. Draw trade-overlay price lines (Entry / SL / TP) — Phase 7-D
  //    Entry = blue (neutral), SL = red, TP = green. Same colors regardless of
  //    side: SL is "where I lose" and TP is "where I win", which is what users
  //    actually care about. R:R is computed and shown on the entry line.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    // Cleanup any previously drawn lines
    const safeRemove = (ref: React.MutableRefObject<any>) => {
      if (ref.current) {
        try { series.removePriceLine(ref.current); } catch { /* already gone */ }
        ref.current = null;
      }
    };
    safeRemove(entryLineRef);
    safeRemove(slLineRef);
    safeRemove(tpLineRef);

    // Find active position for this symbol
    const pos = positions?.find(p => p?.symbol?.replace('/', '').toLowerCase() === cleanSymbol);
    if (!pos || !pos.entryPrice) return;

    const isBuy = pos.side === 'long' || pos.side === 'buy';
    const sideLabel = isBuy ? 'LONG' : 'SHORT';
    const sl = pos.stopLossPrice;
    const tp = pos.takeProfitPrice;

    // Risk/Reward ratio (1:X) — only computable when both SL and TP exist
    let rrLabel = '';
    if (sl && tp) {
      const risk = Math.abs(pos.entryPrice - sl);
      const reward = Math.abs(tp - pos.entryPrice);
      if (risk > 0) rrLabel = ` · R:R 1:${(reward / risk).toFixed(2)}`;
    }

    // Entry — blue, solid, prominent
    entryLineRef.current = series.createPriceLine({
      price: pos.entryPrice,
      color: '#3b82f6',
      lineWidth: 2,
      lineStyle: 0, // Solid
      axisLabelVisible: true,
      title: `${sideLabel} @ $${pos.entryPrice.toFixed(4)}${rrLabel}`,
    });

    // Stop Loss — red, dashed
    if (sl) {
      slLineRef.current = series.createPriceLine({
        price: sl,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: `SL $${sl.toFixed(4)}`,
      });
    }

    // Take Profit — green, dashed
    if (tp) {
      tpLineRef.current = series.createPriceLine({
        price: tp,
        color: '#22c55e',
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `TP $${tp.toFixed(4)}`,
      });
    }
  }, [positions, tradeHistory, cleanSymbol]);

  // Phase 7-D: show a brief "✅ Win" / "❌ Loss" badge after a trade just closed
  // (within the last 30 seconds) for the symbol currently on the chart.
  const recentlyClosed = (() => {
    if (!tradeHistory || tradeHistory.length === 0) return null;
    const matching = tradeHistory.filter(t =>
      t?.symbol?.replace('/', '').toLowerCase() === cleanSymbol && t.closedAt
    );
    if (matching.length === 0) return null;
    // Newest first
    matching.sort((a, b) => {
      const ta = typeof a.closedAt === 'string' ? new Date(a.closedAt).getTime() : (a.closedAt || 0);
      const tb = typeof b.closedAt === 'string' ? new Date(b.closedAt).getTime() : (b.closedAt || 0);
      return tb - ta;
    });
    const latest = matching[0];
    const closedMs = typeof latest.closedAt === 'string' ? new Date(latest.closedAt).getTime() : (latest.closedAt || 0);
    if (Date.now() - closedMs > 30_000) return null;
    return latest;
  })();

  const activePos = positions?.find(p => p?.symbol?.replace('/', '').toLowerCase() === cleanSymbol);
  const isLong = activePos?.side === 'long' || activePos?.side === 'buy';
  const unrealized = activePos ? (isLong ? currentPrice - (activePos.entryPrice || 0) : (activePos.entryPrice || 0) - currentPrice) * (activePos.quantity || 0) : 0;

  return (
    <div className="w-full h-full flex flex-col rounded-xl overflow-hidden border border-violet-500/30 shadow-[0_0_30px_rgba(139,92,246,0.1)] bg-zinc-950">
      {/* Header */}
      <div className="shrink-0 flex justify-between items-center px-4 py-3 border-b border-violet-500/20 bg-violet-950/20">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-violet-500 animate-pulse" />
          <h2 className="text-sm font-bold text-violet-100 font-mono">LIVE AI VISION</h2>
          <span className="text-xs font-semibold text-violet-300 bg-violet-500/20 px-2 py-0.5 rounded uppercase">
            {(symbol || '').replace('BINANCE:', '').replace('USDT', ' / USDT')}
          </span>
        </div>
        <div className="text-right">
          <div className="text-lg font-mono font-bold text-zinc-100">${(currentPrice || 0).toFixed(2)}</div>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-[2] relative min-h-0">
        <div ref={containerRef} className="absolute inset-0" />
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 font-mono text-violet-400 bg-zinc-950/90">
            <div className="w-8 h-8 border-2 border-violet-500/40 border-t-violet-500 rounded-full animate-spin" />
            <span className="text-sm">Connecting to Matrix...</span>
          </div>
        )}
        {/* Phase 7-D: brief result badge when a trade just closed */}
        {recentlyClosed && (
          <div className={`absolute top-3 left-3 z-20 px-3 py-1.5 rounded-lg font-mono text-sm font-bold shadow-lg backdrop-blur border ${
            (recentlyClosed.pnl || 0) >= 0
              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
              : 'bg-red-500/20 border-red-500/40 text-red-300'
          }`}>
            {(recentlyClosed.pnl || 0) >= 0 ? '✅ Win' : '❌ Loss'} · {(recentlyClosed.pnl || 0) >= 0 ? '+' : ''}${(recentlyClosed.pnl || 0).toFixed(2)}
          </div>
        )}
      </div>

      {/* Thought Stream */}
      <div className="shrink-0 h-40 flex flex-col border-t border-violet-500/20 bg-zinc-950">
        <div className="shrink-0 flex items-center px-4 py-2 border-b border-zinc-800/60 bg-zinc-900/50">
          <Brain className="w-3.5 h-3.5 text-violet-400 mr-2 animate-pulse" />
          <span className="text-xs font-bold text-violet-300 uppercase tracking-wider">Live Neural Stream</span>
          
          {activePos ? (
            <span className={`ml-auto text-xs font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
              isLong
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                : 'bg-red-500/15 text-red-400 border border-red-500/25'
            }`}>
              {isLong ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {(activePos.side || '').toUpperCase()} OPEN @ ${(activePos.entryPrice || 0).toFixed(2)}
              <span className="ml-2 text-zinc-500">|</span>
              <span className={unrealized >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {unrealized >= 0 ? '+' : ''}${unrealized.toFixed(2)}
              </span>
            </span>
          ) : (
            <span className="ml-auto text-xs text-zinc-600 flex items-center gap-1">
              <Minus className="w-3 h-3" /> No Active Position
            </span>
          )}
        </div>
        
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1 font-mono text-xs">
          {(!sentryLogs || sentryLogs.length === 0) ? (
            <div className="text-zinc-600 text-center py-4">Waiting for AI activity...</div>
          ) : (
            [...(sentryLogs || [])].reverse().slice(0, 50).map((log, i) => (
              <div key={i} className="flex items-start gap-2 py-0.5 text-zinc-400">
                <span className="text-zinc-600 shrink-0">{log?.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''}</span>
                <span className={`${
                  log?.message?.includes('LONG') ? 'text-emerald-400' : 
                  log?.message?.includes('SHORT') ? 'text-red-400' : 
                  log?.message?.includes('ERROR') ? 'text-red-500' : ''
                }`}>
                  {log?.message || ''}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

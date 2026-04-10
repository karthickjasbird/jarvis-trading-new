import { useEffect, useRef } from 'react';

let tvScriptLoadingPromise: Promise<void> | null = null;

export function TradingViewChart({ symbol = 'BINANCE:BTCUSDT' }: { symbol?: string }) {
  const onLoadScriptRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onLoadScriptRef.current = createWidget;

    if (!tvScriptLoadingPromise) {
      tvScriptLoadingPromise = new Promise((resolve) => {
        const script = document.createElement('script');
        script.id = 'tradingview-widget-loading-script';
        script.src = 'https://s3.tradingview.com/tv.js';
        script.type = 'text/javascript';
        script.onload = () => resolve();
        document.head.appendChild(script);
      });
    }

    tvScriptLoadingPromise.then(() => onLoadScriptRef.current && onLoadScriptRef.current());

    return () => {
      onLoadScriptRef.current = null;
    };

    function createWidget() {
      if (document.getElementById('tradingview_widget') && 'TradingView' in window) {
        new (window as any).TradingView.widget({
          autosize: true,
          symbol: symbol,
          interval: 'D',
          timezone: 'Etc/UTC',
          theme: 'dark',
          style: '1',
          locale: 'en',
          enable_publishing: false,
          backgroundColor: 'rgba(9, 9, 11, 1)',
          gridColor: 'rgba(39, 39, 42, 0.5)',
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          container_id: 'tradingview_widget',
        });
      }
    }
  }, [symbol]);

  return (
    <div className="w-full h-full rounded-xl overflow-hidden border border-zinc-800 shadow-2xl bg-zinc-950">
      <div id="tradingview_widget" className="w-full h-full" />
    </div>
  );
}

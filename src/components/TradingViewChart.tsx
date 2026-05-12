import { useEffect, useRef } from 'react';

let tvScriptLoadingPromise: Promise<void> | null = null;

export function TradingViewChart({ symbol = 'BINANCE:BTCUSDT' }: { symbol?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tvScriptLoadingPromise) {
      tvScriptLoadingPromise = new Promise((resolve) => {
        const script = document.createElement('script');
        script.id = 'tradingview-widget-loading-script';
        script.src = 'https://s3.tradingview.com/tv.js';
        script.type = 'text/javascript';
        script.onload = () => resolve();
        // If script already loaded
        if (document.getElementById('tradingview-widget-loading-script')) {
          resolve();
        } else {
          document.head.appendChild(script);
        }
      });
    }

    tvScriptLoadingPromise.then(() => {
      if (!containerRef.current || !('TradingView' in window)) return;

      // Clear previous widget
      containerRef.current.innerHTML = '';

      // Create a new widget container
      const widgetDiv = document.createElement('div');
      widgetDiv.id = `tv-widget-${Date.now()}`;
      widgetDiv.style.width = '100%';
      widgetDiv.style.height = '100%';
      containerRef.current.appendChild(widgetDiv);

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
        container_id: widgetDiv.id,
      });
    });
  }, [symbol]); // Re-create widget when symbol changes

  return (
    <div className="w-full h-full rounded-xl overflow-hidden border border-zinc-800 shadow-2xl bg-zinc-950">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

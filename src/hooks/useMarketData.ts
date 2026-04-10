import { useState, useEffect, useRef } from 'react';

export interface Tick {
  type: string;
  symbol: string;
  timestamp: number;
  price: number;
  change: number;
  volume: number;
}

export function useMarketData(symbol: string, broker: string, replayDate?: string, speed: number = 1) {
  const [tick, setTick] = useState<Tick | null>(null);
  const [history, setHistory] = useState<Tick[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!symbol) return;

    let isMounted = true;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let wsUrl = `${protocol}//${window.location.host}/ws/market-data?symbol=${encodeURIComponent(symbol)}&broker=${encodeURIComponent(broker)}`;
      
      if (replayDate) {
        wsUrl += `&replayDate=${encodeURIComponent(replayDate)}&speed=${speed}`;
      }
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'tick') {
            setTick(data);
            setHistory(prev => {
              const newHistory = [...prev, data];
              if (newHistory.length > 50) newHistory.shift();
              return newHistory;
            });
          }
        } catch (e) {
          console.error("Failed to parse market data", e);
        }
      };

      ws.onclose = () => {
        if (isMounted) {
          // Reconnect after 2 seconds
          reconnectTimeout = setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      isMounted = false;
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [symbol, broker, replayDate, speed]);

  return { tick, history };
}

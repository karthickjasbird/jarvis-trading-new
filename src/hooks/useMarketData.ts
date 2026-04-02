import { useState, useEffect } from 'react';

export interface Tick {
  type: string;
  symbol: string;
  timestamp: number;
  price: number;
  change: number;
  volume: number;
}

export function useMarketData(symbol: string, broker: string) {
  const [tick, setTick] = useState<Tick | null>(null);
  const [history, setHistory] = useState<Tick[]>([]);

  useEffect(() => {
    if (!symbol) return;

    let isMounted = true;

    const fetchTick = async () => {
      try {
        const response = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&broker=${encodeURIComponent(broker)}`);
        
        // If the server is restarting or returns a 502, it might return HTML.
        // Check content type before parsing JSON.
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
           // Ignore non-JSON responses (like 502 Bad Gateway HTML)
           return;
        }

        if (!response.ok) {
           // Ignore non-ok responses silently during polling
           return;
        }
        
        const data = await response.json();
        
        if (isMounted && data.type === 'tick') {
          setTick(data);
          setHistory(prev => {
            const newHistory = [...prev, data];
            if (newHistory.length > 50) newHistory.shift();
            return newHistory;
          });
        }
      } catch (err) {
        // Suppress network errors (Failed to fetch) during server restarts
        // console.error('Error fetching tick:', err);
      }
    };

    // Fetch immediately
    fetchTick();

    // Then poll every 1 second
    const interval = setInterval(fetchTick, 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [symbol, broker]);

  return { tick, history };
}

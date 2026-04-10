import { useState, useEffect } from 'react';

export interface NewsItem {
  id: string;
  title: string;
  symbol: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  source: string;
  publishedAt: string;
  url: string;
}

export interface WhaleAlert {
  id: string;
  symbol: string;
  action: string;
  amount: number;
  valueUsd: number;
  from: string;
  to: string;
  timestamp: string;
  urgency: 'high' | 'medium' | 'low';
}

export function useMarketIntel() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [whaleAlerts, setWhaleAlerts] = useState<WhaleAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchIntel = async () => {
    try {
      const [newsRes, whaleRes] = await Promise.all([
        fetch('/api/data/news'),
        fetch('/api/data/whales')
      ]);

      if (newsRes.ok) {
        const newsData = await newsRes.json();
        setNews(newsData.data);
      }

      if (whaleRes.ok) {
        const whaleData = await whaleRes.json();
        setWhaleAlerts(whaleData.data);
      }
    } catch (error) {
      console.error('Failed to fetch market intel:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchIntel();
    // Refresh every 30 seconds
    const interval = setInterval(fetchIntel, 30000);
    return () => clearInterval(interval);
  }, []);

  return { news, whaleAlerts, isLoading, refresh: fetchIntel };
}

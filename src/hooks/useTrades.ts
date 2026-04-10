import { useState, useEffect, useCallback } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, doc, setDoc, updateDoc, getDoc, orderBy, limit } from 'firebase/firestore';
import { memoryService } from '../services/memoryService';

export interface Position {
  id: string;
  tradeId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  mode: string;
}

export interface ClosedTrade {
  id: string;
  tradeId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  closedAt: string;
}

export interface DailyPnl {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  tradesCount: number;
  winCount: number;
  lossCount: number;
}

export interface SentryLog {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'action' | 'success' | 'error';
}

export function useTrades(userId: string, isPracticeMode: boolean = false) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [tradeHistory, setTradeHistory] = useState<ClosedTrade[]>([]);
  const [portfolio, setPortfolio] = useState({ paperBalance: 100000, realizedPnl: 0, liveBalance: 0, liveRealizedPnl: 0 });
  const [sentryConfig, setSentryConfig] = useState<any>({ active: false });
  const [sentryLogs, setSentryLogs] = useState<SentryLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const addSentryLog = useCallback((message: string, type: SentryLog['type'] = 'info') => {
    setSentryLogs(prev => [...prev.slice(-49), {
      id: Math.random().toString(36).substring(7),
      timestamp: new Date().toISOString(),
      message,
      type
    }]);
  }, []);

  // Initialize Portfolio
  useEffect(() => {
    if (!userId) return;
    const initPortfolio = async () => {
      const ref = doc(db, 'portfolios', userId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          userId,
          paperBalance: 100000,
          realizedPnl: 0,
          liveBalance: 0,
          liveRealizedPnl: 0,
          updatedAt: new Date().toISOString()
        });
      } else {
        setPortfolio({
          paperBalance: snap.data().paperBalance || 100000,
          realizedPnl: snap.data().realizedPnl || 0,
          liveBalance: snap.data().liveBalance || 0,
          liveRealizedPnl: snap.data().liveRealizedPnl || 0
        });
      }
    };
    initPortfolio();
  }, [userId]);

  // Listen to Open Positions
  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, 'trades'),
      where('userId', '==', userId),
      where('status', '==', 'open'),
      where('isPractice', '==', isPracticeMode)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const openTrades = snapshot.docs.map(doc => {
        const data = doc.data();
        // Mock current price for now, in a real app this comes from a websocket
        const currentPrice = data.entryPrice * (1 + (Math.random() * 0.02 - 0.01)); 
        const isLong = data.side === 'buy';
        const priceDiff = currentPrice - data.entryPrice;
        const unrealizedPnl = isLong ? (priceDiff * data.quantity) : (-priceDiff * data.quantity);
        const unrealizedPnlPercent = (unrealizedPnl / (data.entryPrice * data.quantity)) * 100;

        return {
          id: doc.id,
          tradeId: doc.id,
          ...data,
          currentPrice,
          unrealizedPnl,
          unrealizedPnlPercent
        };
      }) as Position[];
      setPositions(openTrades);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [userId, isPracticeMode]);

  // Listen to Trade History
  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, 'trades'),
      where('userId', '==', userId),
      where('status', '==', 'closed'),
      where('isPractice', '==', isPracticeMode),
      orderBy('closedAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const history = snapshot.docs.map(doc => ({
        id: doc.id,
        tradeId: doc.id,
        ...doc.data()
      })) as ClosedTrade[];
      setTradeHistory(history);
    });

    return () => unsubscribe();
  }, [userId, isPracticeMode]);

  // Listen to Portfolio Updates
  useEffect(() => {
    if (!userId) return;
    const unsubscribe = onSnapshot(doc(db, 'portfolios', userId), (doc) => {
      if (doc.exists()) {
        setPortfolio({
          paperBalance: doc.data().paperBalance || 100000,
          realizedPnl: doc.data().realizedPnl || 0,
          liveBalance: doc.data().liveBalance || 0,
          liveRealizedPnl: doc.data().liveRealizedPnl || 0
        });
      }
    });
    return () => unsubscribe();
  }, [userId]);

  // Listen to Sentry Config
  useEffect(() => {
    if (!userId) return;
    const unsubscribe = onSnapshot(doc(db, 'sentryConfigs', userId), (doc) => {
      if (doc.exists()) {
        setSentryConfig(doc.data() as any);
      } else {
        setSentryConfig({ active: false, maxDailyLoss: 0, targetDailyProfit: 0 });
      }
    });
    return () => unsubscribe();
  }, [userId]);

  const executeTrade = useCallback(async (params: { 
    symbol: string, 
    side: 'buy'|'sell', 
    quantity?: number, 
    market?: string, 
    mode?: 'copilot'|'sentry'|'live', 
    currentPrice: number,
    riskPercentage?: number,
    stopLossPrice?: number,
    takeProfitPrice?: number,
    trailingStopDistance?: number
  }) => {
    if (!userId) throw new Error("Not authenticated");
    
    let quantity = params.quantity;

    // Dynamic Position Sizing
    if (params.riskPercentage && params.stopLossPrice) {
      const riskAmount = portfolio.paperBalance * (Number(params.riskPercentage) / 100);
      const priceDiff = Math.abs(params.currentPrice - Number(params.stopLossPrice));
      if (priceDiff > 0) {
        quantity = riskAmount / priceDiff;
      }
    }

    if (!quantity || quantity <= 0) {
      throw new Error("Invalid quantity calculated or provided");
    }

    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        symbol: params.symbol,
        side: params.side,
        quantity,
        market: params.market || 'crypto',
        mode: params.mode || 'copilot',
        isPractice: isPracticeMode,
        stopLossPrice: params.stopLossPrice,
        takeProfitPrice: params.takeProfitPrice,
        trailingStopDistance: params.trailingStopDistance
      })
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }
    
    return data;
  }, [userId, portfolio.paperBalance, isPracticeMode]);

  // Sentry Engine Loop
  useEffect(() => {
    if (!sentryConfig?.active || !sentryConfig?.symbol) return;

    let isMounted = true;
    const interval = setInterval(async () => {
      if (!isMounted) return;
      
      try {
        addSentryLog(`Fetching live price for ${sentryConfig.symbol}...`, 'info');
        const res = await fetch(`/api/market-data?symbol=${encodeURIComponent(sentryConfig.symbol)}&broker=crypto`);
        const data = await res.json();
        
        if (!data.price) throw new Error('Invalid price data');
        
        const currentPrice = data.price;
        const targetPrice = sentryConfig.targetPrice;
        
        let conditionMet = false;
        if (sentryConfig.condition === 'above' && currentPrice >= targetPrice) conditionMet = true;
        if (sentryConfig.condition === 'below' && currentPrice <= targetPrice) conditionMet = true;

        if (conditionMet) {
          addSentryLog(`Condition met! ${sentryConfig.symbol} is ${currentPrice} (${sentryConfig.condition} ${targetPrice})`, 'action');
          addSentryLog(`Executing ${sentryConfig.side.toUpperCase()} ${sentryConfig.quantity} ${sentryConfig.symbol}...`, 'action');
          
          await executeTrade({
            symbol: sentryConfig.symbol,
            side: sentryConfig.side,
            quantity: sentryConfig.quantity,
            currentPrice,
            mode: 'sentry'
          });
          
          addSentryLog(`Trade executed successfully. Deactivating Sentry Mode.`, 'success');
          
          // Deactivate Sentry
          await updateDoc(doc(db, 'sentryConfigs', userId), { active: false });
        } else {
          addSentryLog(`Price is ${currentPrice}. Condition (${sentryConfig.condition} ${targetPrice}) not met. Waiting...`, 'info');
        }
        
      } catch (e: any) {
        addSentryLog(`Error in Sentry loop: ${e.message}`, 'error');
      }
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [sentryConfig, executeTrade, addSentryLog, userId]);

  const closePosition = useCallback(async (tradeId: string, currentPrice?: number) => {
    if (!userId) throw new Error("Not authenticated");
    
    const res = await fetch('/api/trade/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, tradeId })
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }

    // Analyze and save trade lesson to memory bank
    if (data.trade) {
      memoryService.analyzeAndSaveTrade(data.trade, userId).catch(err => {
        console.error("Failed to analyze trade for memory bank", err);
      });
    }

    return data;
  }, [userId]);

  const panicCloseAll = useCallback(async () => {
    if (!userId) return [];
    
    const res = await fetch('/api/panic-close-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, isPracticeMode })
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }

    // Analyze and save trade lessons
    if (data.results && Array.isArray(data.results)) {
      data.results.forEach((result: any) => {
        if (result.trade) {
          memoryService.analyzeAndSaveTrade(result.trade, userId).catch(err => {
            console.error("Failed to analyze panic closed trade", err);
          });
        }
      });
    }

    return data.results || [];
  }, [userId, isPracticeMode]);

  // Calculate Daily PnL
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString();
  
  const dailyTrades = tradeHistory.filter(t => t.closedAt && t.closedAt >= todayStr);
  const dailyRealizedPnl = dailyTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const winCount = dailyTrades.filter(t => (t.pnl || 0) > 0).length;
  const lossCount = dailyTrades.filter(t => (t.pnl || 0) < 0).length;
  const unrealizedPnl = positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);

  return {
    positions,
    tradeHistory,
    portfolio,
    sentryConfig,
    sentryLogs,
    dailyPnl: {
      realizedPnl: dailyRealizedPnl,
      unrealizedPnl: unrealizedPnl,
      totalPnl: dailyRealizedPnl + unrealizedPnl,
      tradesCount: dailyTrades.length,
      winCount,
      lossCount
    },
    executeTrade,
    closePosition,
    panicCloseAll,
    isLoading
  };
}

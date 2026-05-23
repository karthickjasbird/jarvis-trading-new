import { useState, useEffect, useCallback, useRef } from 'react';
import { db, auth } from '../firebase';
import { collection, query, where, onSnapshot, doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';
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
  const [pendingTrades, setPendingTrades] = useState<any[]>([]);
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

  // Listen to Open Positions (real-time Firestore updates for trade status)
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
        return {
          id: doc.id,
          tradeId: doc.id,
          ...data,
          currentPrice: data.entryPrice, // Stable default — no Math.random()
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0
        };
      }) as Position[];
      setPositions(openTrades);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [userId, isPracticeMode]);

  // Listen to Pending Approvals
  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, 'trades'),
      where('userId', '==', userId),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const pending = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setPendingTrades(pending);
    });

    return () => unsubscribe();
  }, [userId]);

  // Poll server for real market prices (every 3 seconds)
  useEffect(() => {
    if (!userId) return;
    const fetchPrices = async () => {
      try {
        const res = await fetch(`/api/positions?userId=${userId}&isPractice=${isPracticeMode}`);
        const data = await res.json();
        if (data.positions && data.positions.length > 0) {
          setPositions(prev => {
            if (prev.length === 0) return prev;
            return prev.map(pos => {
              const serverPos = data.positions.find((sp: any) => sp.id === pos.id);
              if (serverPos) {
                const unrealizedPnl = serverPos.unrealizedPnl || 0;
                return {
                  ...pos,
                  currentPrice: serverPos.currentPrice,
                  unrealizedPnl,
                  unrealizedPnlPercent: pos.entryPrice * pos.quantity !== 0
                    ? (unrealizedPnl / (pos.entryPrice * pos.quantity)) * 100
                    : 0
                };
              }
              return pos;
            });
          });
        }
      } catch (e) {
        // Silently fail — onSnapshot still provides base data
      }
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 3000);
    return () => clearInterval(interval);
  }, [userId, isPracticeMode]);

  // Listen to Trade History (no orderBy to avoid composite index requirement)
  useEffect(() => {
    if (!userId) return;
    const q = query(
      collection(db, 'trades'),
      where('userId', '==', userId),
      where('status', '==', 'closed'),
      where('isPractice', '==', isPracticeMode),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const history = snapshot.docs.map(doc => ({
        id: doc.id,
        tradeId: doc.id,
        ...doc.data()
      })) as ClosedTrade[];
      // Sort client-side (newest first)
      history.sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || ''));
      setTradeHistory(history);
    }, (error) => {
      console.error('[TRADES] History listener error, falling back to API:', error.message);
      fetch(`/api/trade-history?userId=${userId}&isPractice=${isPracticeMode}&limit=50`)
        .then(r => r.json())
        .then(data => {
          if (data.history) setTradeHistory(data.history);
        })
        .catch(() => {});
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
    trailingStopDistance?: number,
    profitTarget?: number
  }) => {
    const effectiveUserId = userId || auth.currentUser?.uid || '';
    console.log('[executeTrade] userId:', userId, 'effectiveUserId:', effectiveUserId, 'auth.currentUser?.uid:', auth.currentUser?.uid);
    if (!effectiveUserId) throw new Error("Not authenticated");
    
    let quantity = params.quantity;

    // Dynamic Position Sizing
    if (params.riskPercentage && params.stopLossPrice) {
      const activeBalance = isPracticeMode ? portfolio.paperBalance : (portfolio.liveBalance || 0);
      const riskAmount = activeBalance * (Number(params.riskPercentage) / 100);
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
        userId: effectiveUserId,
        symbol: params.symbol,
        side: params.side,
        quantity,
        market: params.market || 'crypto',
        mode: params.profitTarget ? 'sentry' : (params.mode || (sentryConfig?.active ? 'sentry' : 'copilot')),
        isPractice: isPracticeMode,
        stopLossPrice: params.stopLossPrice,
        takeProfitPrice: params.takeProfitPrice,
        trailingStopDistance: params.trailingStopDistance,
        profitTarget: params.profitTarget
      })
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }
    
    return data;
  }, [userId, portfolio.paperBalance, isPracticeMode, sentryConfig]);

  // UI-only Sentry Loop (Execution handled by backend Daemon)
  useEffect(() => {
    if (!sentryConfig?.active || !sentryConfig?.symbol) return;

    if (sentryConfig.isAutonomous) {
      addSentryLog('Autonomous Sentry Loop is running securely in the background Daemon...', 'info');
      return;
    }

    let isMounted = true;
    const interval = setInterval(async () => {
      if (!isMounted) return;
      
      try {
        addSentryLog(`Syncing Daemon status for ${sentryConfig.symbol}...`, 'info');
        const res = await fetch(`/api/market-data?symbol=${encodeURIComponent(sentryConfig.symbol)}&broker=crypto`);
        const data = await res.json();
        
        if (!data.price) return;
        
        const currentPrice = data.price;
        const targetPrice = sentryConfig.targetPrice;
        
        let conditionMet = false;
        if (sentryConfig.condition === 'above' && currentPrice >= targetPrice) conditionMet = true;
        if (sentryConfig.condition === 'below' && currentPrice <= targetPrice) conditionMet = true;

        if (conditionMet) {
          addSentryLog(`Condition met! Backend executing ${sentryConfig.side.toUpperCase()}...`, 'action');
          // Actual execution happens via engine/sentry.ts server-side.
        } else {
          addSentryLog(`Current: $${currentPrice}. Target: ${sentryConfig.condition} $${targetPrice}. Watching 24/7...`, 'info');
        }
        
      } catch (e: any) {
        // Silent catch for UI
      }
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [sentryConfig, addSentryLog]);

  const closePosition = useCallback(async (tradeId: string, currentPrice?: number) => {
    const effectiveUserId = userId || auth.currentUser?.uid || '';
    if (!effectiveUserId) throw new Error("Not authenticated");
    
    const res = await fetch('/api/trade/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: effectiveUserId, tradeId })
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
    const effectiveUserId = userId || auth.currentUser?.uid || '';
    if (!effectiveUserId) return [];
    
    const res = await fetch('/api/panic-close-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: effectiveUserId, isPracticeMode })
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

  const approveTrade = useCallback(async (tradeId: string) => {
    const effectiveUserId = userId || auth.currentUser?.uid || '';
    if (!effectiveUserId) throw new Error("Not authenticated");
    
    const res = await fetch('/api/trade/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: effectiveUserId, tradeId })
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }

    return data.executedTrade;
  }, [userId]);

  const declineTrade = useCallback(async (tradeId: string) => {
    const effectiveUserId = userId || auth.currentUser?.uid || '';
    if (!effectiveUserId) throw new Error("Not authenticated");
    
    const res = await fetch('/api/trade/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: effectiveUserId, tradeId })
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }

    return data;
  }, [userId]);

  // Calculate Daily P&L — tracks date changes for midnight rollover
  const [todayStr, setTodayStr] = useState(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now.toISOString();
  });

  useEffect(() => {
    const checkDate = () => {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const newStr = now.toISOString();
      if (newStr !== todayStr) {
        setTodayStr(newStr);
      }
    };
    const interval = setInterval(checkDate, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [todayStr]);

  const dailyTrades = tradeHistory.filter(t => t.closedAt && t.closedAt >= todayStr);
  const dailyRealizedPnl = dailyTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const winCount = dailyTrades.filter(t => (t.pnl || 0) > 0).length;
  const lossCount = dailyTrades.filter(t => (t.pnl || 0) < 0).length;
  const unrealizedPnl = positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);

  return {
    positions,
    pendingTrades,
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
    approveTrade,
    declineTrade,
    isLoading
  };
}

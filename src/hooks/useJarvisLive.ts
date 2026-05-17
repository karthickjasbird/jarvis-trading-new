import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { AudioRecorder, AudioPlayer } from '../utils/audioUtils';
import { toast } from 'sonner';
import { auth } from '../firebase';
import type { PipelineActivity } from '../components/ActivityPipeline';
import { memoryService } from '../services/memoryService';

const setAlarmTool: FunctionDeclaration = {
  name: 'setAlarm',
  description: 'Set an alarm for a specific time.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      time: { type: Type.STRING, description: 'The time for the alarm (e.g., "08:00 AM", "14:30")' },
      label: { type: Type.STRING, description: 'The label or name for the alarm' }
    },
    required: ['time']
  }
};

const setReminderTool: FunctionDeclaration = {
  name: 'setReminder',
  description: 'Set a reminder to notify the user about something after a certain delay.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      message: { type: Type.STRING, description: 'The reminder message' },
      delayMinutes: { type: Type.NUMBER, description: 'Delay in minutes from now' }
    },
    required: ['message', 'delayMinutes']
  }
};

const openAppTool: FunctionDeclaration = {
  name: 'openApp',
  description: 'Open a web application or website (e.g., Spotify, YouTube, Gmail).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      appName: { type: Type.STRING, description: 'The name of the app or website to open' },
      url: { type: Type.STRING, description: 'The URL of the app or website to open' }
    },
    required: ['appName', 'url']
  }
};

const activateSentryModeTool: FunctionDeclaration = {
  name: 'activateSentryMode',
  description: 'Activate Autonomous Sentry Mode. In this mode, Jarvis trades and exits positions FULLY AUTOMATICALLY with no user input required. No symbol or prompt is needed — Jarvis handles everything autonomously.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      maxDailyLoss: { type: Type.NUMBER, description: 'Optional maximum daily loss limit in dollars.' }
    },
    required: []
  }
};

const switchTradingModeTool: FunctionDeclaration = {
  name: 'switchTradingMode',
  description: 'Switch between Copilot Mode and Sentry Mode. Copilot = Jarvis asks you before placing or closing trades. Sentry = Jarvis acts fully autonomously. Use this when the user says "activate copilot mode", "switch to sentry", "turn on copilot", "go autonomous", etc.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      mode: { type: Type.STRING, description: 'The mode to switch to. Must be either "copilot" or "sentry".' }
    },
    required: ['mode']
  }
};

const getMarketPriceTool: FunctionDeclaration = {
  name: 'getMarketPrice',
  description: 'Get the real-time market price for a specific symbol (e.g., "BTC/USDT", "ETH/USDT", "RELIANCE").',
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: { type: Type.STRING, description: 'The trading symbol to look up' }
    },
    required: ['symbol']
  }
};

const executeTradeTool: FunctionDeclaration = {
  name: 'executeTrade',
  description: 'Execute a market order to buy or sell a specific symbol. Can include risk management parameters.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: { type: Type.STRING, description: 'The trading symbol (e.g., "BTC/USDT")' },
      side: { type: Type.STRING, description: 'The side of the trade: "buy" or "sell"' },
      quantity: { type: Type.NUMBER, description: 'The amount to trade. Optional if riskPercentage and stopLossPrice are provided.' },
      riskPercentage: { type: Type.NUMBER, description: 'Risk percentage of total portfolio (e.g., 1 for 1%). Used for dynamic position sizing.' },
      stopLossPrice: { type: Type.NUMBER, description: 'The hard stop loss price.' },
      takeProfitPrice: { type: Type.NUMBER, description: 'The take profit price.' },
      trailingStopDistance: { type: Type.NUMBER, description: 'The trailing stop distance in price units (e.g., 500 for a $500 trailing stop).' },
      profitTarget: { type: Type.NUMBER, description: 'The desired profit in dollars (e.g., 10 for $10 profit). The system will auto-calculate the exact take-profit exit price. ALWAYS use this when the user specifies a dollar profit target.' },
      investAmount: { type: Type.NUMBER, description: 'The dollar amount to invest in this trade (e.g., 5000 for $5000 worth). The system will auto-calculate the quantity. Use this when the user specifies a dollar amount to buy.' }
    },
    required: ['symbol', 'side']
  }
};

const closePositionTool: FunctionDeclaration = {
  name: 'closePosition',
  description: 'Close entirely, or a fraction of, an existing open position.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      tradeId: { type: Type.STRING, description: 'The unique ID of the open position to close' }
    },
    required: ['tradeId']
  }
};

const panicCloseAllTool: FunctionDeclaration = {
  name: 'panicCloseAll',
  description: 'Immediately liquidate and close ALL open positions across all markets. Use this ONLY in emergencies or when explicitly told to exit the market completely.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      dummy: { type: Type.STRING }
    },
    required: []
  }
};

const studyWebsiteTool: FunctionDeclaration = {
  name: 'studyWebsite',
  description: 'Study, learn from, read, or memorize a specific website URL. Scrapes the page content, distills it into key knowledge with AI, and permanently saves it to the Vector DB memory bank. Use when the user asks to study, learn, memorize, or read any URL.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: { type: Type.STRING, description: 'The fully qualified URL to scrape and study (e.g., "https://example.com/trading-guide")' }
    },
    required: ['url']
  }
};

const deepStudyWebsiteTool: FunctionDeclaration = {
  name: 'deepStudyWebsite',
  description: 'Deep study an entire website. Crawls ALL pages on the site, summarizes each one, and saves everything to memory. Use when the user says "deep study", "study the entire website", "learn everything from this site", "crawl the full website", or similar phrases indicating they want ALL pages studied, not just one.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      url: { type: Type.STRING, description: 'The starting URL of the website to deep crawl (e.g., "https://zerodha.com/varsity/")' }
    },
    required: ['url']
  }
};

const navigateAppTool: FunctionDeclaration = {
  name: 'navigateApp',
  description: 'Navigate the user to a different section or tab of the application.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      destination: { 
        type: Type.STRING, 
        description: 'The destination tab to navigate to.',
        enum: ['home', 'market', 'chart', 'history', 'settings']
      }
    },
    required: ['destination']
  }
};

const getCurrentAppStateTool: FunctionDeclaration = {
  name: 'getCurrentAppState',
  description: 'Get the current tab or section of the app the user is looking at.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      dummy: { type: Type.STRING, description: 'Optional dummy parameter' }
    },
    required: []
  }
};

const highlightElementTool: FunctionDeclaration = {
  name: 'highlightElement',
  description: 'Highlight a specific UI element on the screen to show the user where it is.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      elementId: { 
        type: Type.STRING, 
        description: 'The ID of the element to highlight (e.g., "panic-button", "settings-button", "memories-button", "mic-button", "screen-share-button", "tab-home", "tab-market", "tab-history", "tab-settings")' 
      }
    },
    required: ['elementId']
  }
};

const reviewPortfolioTool: FunctionDeclaration = {
  name: 'reviewPortfolio',
  description: 'Analyze the user\'s trading performance, win rate, and PnL. Use this when the user asks how they are doing or wants a performance review.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      dummy: { type: Type.STRING, description: 'Optional dummy parameter' }
    },
    required: []
  }
};

const analyzeSentimentTool: FunctionDeclaration = {
  name: 'analyzeSentiment',
  description: 'Consult the News Sentiment Analyst sub-agent to get the current market sentiment for a specific asset.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      asset: { type: Type.STRING, description: 'The asset to analyze (e.g., "Bitcoin", "Ethereum")' }
    },
    required: ['asset']
  }
};

const getWhaleActivityTool: FunctionDeclaration = {
  name: 'getWhaleActivity',
  description: 'Consult the Whale Tracker sub-agent to check for large transactions or unusual volume for a specific asset.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      asset: { type: Type.STRING, description: 'The asset to check (e.g., "BTC", "ETH")' }
    },
    required: ['asset']
  }
};

const analyzeMarketTool: FunctionDeclaration = {
  name: 'analyzeMarket',
  description: 'Get technical analysis (RSI, MACD, EMAs, Trend) for a specific crypto symbol and timeframe.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: { type: Type.STRING, description: 'The trading symbol (e.g., BTC/USDT)' },
      timeframe: { type: Type.STRING, description: 'The timeframe for candles (e.g., 5m, 15m, 1h, 4h, 1d)' }
    },
    required: ['symbol', 'timeframe']
  }
};

const backtestStrategyTool: FunctionDeclaration = {
  name: 'backtestStrategy',
  description: 'Backtest a trading strategy using historical data to see its performance.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: { type: Type.STRING, description: 'The trading symbol (e.g., "BTC/USDT")' },
      timeframe: { type: Type.STRING, description: 'The timeframe for backtesting (e.g., "1h", "4h", "1d"). Default is "1h".' },
      strategy: { type: Type.STRING, description: 'The strategy to backtest. Options: "rsi" (buy < 30, sell > 70) or "macd" (crossover).' },
      initialBalance: { type: Type.NUMBER, description: 'The initial balance for the backtest. Default is 10000.' }
    },
    required: ['symbol', 'strategy']
  }
};

const optimizeStrategyTool: FunctionDeclaration = {
  name: 'optimizeStrategy',
  description: 'Use the AI Strategy Optimizer to find the most profitable parameters for a given strategy on historical data.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: { type: Type.STRING, description: 'The trading symbol (e.g., "BTC/USDT")' },
      timeframe: { type: Type.STRING, description: 'The timeframe for optimization (e.g., "1h", "4h", "1d"). Default is "1h".' },
      strategy: { type: Type.STRING, description: 'The strategy to optimize. Options: "rsi" or "macd".' }
    },
    required: ['symbol', 'strategy']
  }
};

const updateRiskSettingsTool: FunctionDeclaration = {
  name: 'updateRiskSettings',
  description: 'Update the global risk management settings for the user (Max Daily Loss, Position Sizing, Auto-Liquidate).',
  parameters: {
    type: Type.OBJECT,
    properties: {
      maxDailyLoss: { type: Type.NUMBER, description: 'Maximum allowed daily loss in dollars before trading is halted.' },
      maxPositionSizePct: { type: Type.NUMBER, description: 'Maximum percentage of portfolio allowed per trade (1-100).' },
      autoLiquidateThreshold: { type: Type.NUMBER, description: 'Dollar amount loss threshold to automatically close a position.' },
      requireConfirmation: { type: Type.BOOLEAN, description: 'Whether Jarvis needs manual confirmation before executing trades.' }
    },
    required: ['maxDailyLoss', 'maxPositionSizePct', 'autoLiquidateThreshold', 'requireConfirmation']
  }
};

const createTradingGoalTool: FunctionDeclaration = {
  name: 'createTradingGoal',
  description: 'Launch an autonomous trading CAMPAIGN to reach a target profit. This creates a multi-trade campaign where Jarvis splits capital across multiple coins simultaneously, chains trades (when one closes, it automatically finds the next opportunity), compounds profits, and tracks progress against a deadline. Use this when the user says things like "make me X profit from Y capital" or "turn X into Y in Z days".',
  parameters: {
    type: Type.OBJECT,
    properties: {
      targetProfit: { type: Type.NUMBER, description: 'The target profit amount in dollars (e.g., 15 for $15).' },
      capital: { type: Type.NUMBER, description: 'The total capital to allocate to this goal in dollars (e.g., 10000).' },
      isPractice: { type: Type.BOOLEAN, description: 'Whether this goal should use practice money (paper wallet) or real money. Default is true (practice mode).' },
      deadlineDays: { type: Type.NUMBER, description: 'The deadline in days to achieve the goal (e.g., 7 for 1 week). Default is 7.' },
      maxSlots: { type: Type.NUMBER, description: 'The maximum number of simultaneous trades to run for this campaign. Default is 3.' }
    },
    required: ['targetProfit', 'capital', 'isPractice']
  }
};

const inspectSystemTool: FunctionDeclaration = {
  name: 'inspectSystem',
  description: 'Inspect the current state of the Jarvis application. Returns live details about engines, API routes, system health, version info, and recent code changes. Use when the user asks about your capabilities, features, system health, or recent updates.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      aspect: { 
        type: Type.STRING, 
        description: 'What to inspect: "all" for full manifest, "engines" for engine list, "version" for version info, "health" for system status, "changelog" for recent changes.'
      }
    },
    required: ['aspect']
  }
};

const checkMarketRegimeTool: FunctionDeclaration = {
  name: 'checkMarketRegime',
  description: 'Detect the current market regime (trending up, trending down, ranging, or volatile) for a specific coin or the overall market. Returns ADX, ATR, Bollinger Band width, EMA alignment, and trading recommendations. Use when the user asks "what is the market doing?", "should I trade right now?", or "is the market trending?".',
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: { type: Type.STRING, description: 'Optional. Specific symbol like "BTC/USDT". If omitted, scans the top 10 coins for overall market regime.' }
    },
    required: []
  }
};

const getKellyStatsTool: FunctionDeclaration = {
  name: 'getKellyStats',
  description: 'Get Kelly Criterion position sizing statistics based on trading history. Returns win rate, average win/loss, payoff ratio, optimal bet size, current streak, and per-coin performance. Use when the user asks "how much should I bet?", "what is my win rate?", "how are my stats?", or "what size position should I take?".',
  parameters: {
    type: Type.OBJECT,
    properties: {
      userId: { type: Type.STRING, description: 'The user ID to get stats for.' }
    },
    required: ['userId']
  }
};

export function useJarvisLive(
  executeTradeFn?: (params: any) => Promise<any>,
  closePositionFn?: (tradeId: string) => Promise<any>,
  panicCloseAllFn?: () => Promise<any>,
  getMarketPriceFn?: (symbol: string) => Promise<any>,
  onNavigate?: (destination: string) => void,
  getAppState?: () => string,
  onHighlight?: (elementId: string) => void,
  memoryModel?: string
) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [volume, setVolume] = useState(0);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<{role: string, text: string, timestamp: string}[]>([]);
  const [tradingMode, setTradingMode] = useState<'sentry' | 'copilot'>(() => {
    return (localStorage.getItem('jarvis_trading_mode') as 'sentry' | 'copilot') || 'copilot';
  });
  const currentSessionIdRef = useRef<string | null>(null);
  const [pipelineActivity, setPipelineActivity] = useState<PipelineActivity>({
    jarvis: 'idle',
    memory: 'idle',
    action: 'idle',
  });

  const sessionRef = useRef<any>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const lastSpeakerRef = useRef<'user' | 'jarvis' | null>(null);
  const lastInputSourceRef = useRef<'voice' | 'text'>('voice');
  const memoryModelRef = useRef<string>(memoryModel || 'gemini-2.0-flash');
  const jarvisTextAccumulatorRef = useRef<string>('');

  // Keep the ref in sync when the prop changes
  useEffect(() => {
    memoryModelRef.current = memoryModel || 'gemini-2.0-flash';
  }, [memoryModel]);

  // Helper to set pipeline activity with auto-clear
  const setPipelineAction = useCallback((action: PipelineActivity['action'], label?: string, color?: string) => {
    setPipelineActivity(prev => ({
      ...prev,
      action,
      actionLabel: label,
      actionColor: color,
      memory: action !== 'idle' ? 'recalling' : 'idle',
    }));
  }, []);

  const clearPipelineAction = useCallback((successLabel?: string) => {
    if (successLabel) {
      setPipelineActivity(prev => ({
        ...prev,
        memory: 'complete',
        memoryLabel: successLabel,
      }));
      setTimeout(() => {
        setPipelineActivity({
          jarvis: 'idle',
          memory: 'idle',
          action: 'idle',
        });
      }, 3000);
    } else {
      setPipelineActivity({
        jarvis: 'idle',
        memory: 'idle',
        action: 'idle',
      });
    }
  }, []);


  const toggleMic = useCallback(async () => {
    if (!isConnected || !recorderRef.current) return;
    
    if (isMicActive) {
      recorderRef.current.stop();
      setIsMicActive(false);
      setVolume(0);
    } else {
      try {
        await recorderRef.current.start();
        setIsMicActive(true);
      } catch (e) {
        console.error('Failed to start audio recording:', e);
        toast.error('Microphone access denied or failed.');
      }
    }
  }, [isConnected, isMicActive]);

  const saveMessageToSession = useCallback(async (role: string, text: string, source: string = 'text') => {
    const sid = currentSessionIdRef.current;
    if (!sid || !text.trim()) return;
    try {
      await fetch(`/api/sessions/${sid}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, text: text.trim(), source })
      });
    } catch (e) {
      console.warn('Failed to save message to session:', e);
    }
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/messages`);
      const data = await res.json();
      if (data.status === 'success') {
        setCurrentSessionId(sessionId);
        currentSessionIdRef.current = sessionId;
        setChatMessages(data.messages);
        // Rebuild transcript from messages
        const rebuilt = data.messages.map((m: any) => {
          const icon = m.role === 'user' ? (m.source === 'voice' ? '🎤' : '⌨️') : '🤖';
          return `${icon} ${m.role === 'user' ? 'You' : 'Jarvis'}: ${m.text}`;
        }).join('\n\n');
        setTranscript(rebuilt);
      }
    } catch (e) {
      console.error('Failed to load session:', e);
    }
  }, []);

  const sendSystemUpdate = useCallback((message: string) => {
    if (!isSessionReady || !sessionRef.current) return;
    // Send a silent system context update (not shown in transcript)
    try {
      sessionRef.current.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: `[SYSTEM UPDATE — Do not repeat this to the user, just silently update your internal state]: ${message}` }] }],
        turnComplete: true
      });
    } catch (e) {
      console.warn('[JARVIS] Failed to send system update:', e);
    }
  }, [isSessionReady]);

  const startSession = useCallback(async (memoryContext: string, enableScreenShare: boolean, enableSearch: boolean, personality: 'classic' | 'sarcastic' | 'scientific' = 'classic', initialMessage?: string, enableMic: boolean = true, liveModel?: string, isPracticeMode: boolean = true, currentTradingMode: string = 'copilot', portfolioState?: { balance: number; todayPnl: number; openPositions: number; realizedPnl: number; unrealizedPnl: number }, brokerStatus?: string) => {
    if (isConnected || isConnecting) return;

    setIsConnecting(true);
    lastSpeakerRef.current = null;
    jarvisTextAccumulatorRef.current = '';

    // Only create a new Firestore session if we don't have one yet
    if (!currentSessionIdRef.current) {
      try {
        const userId = (await import('../firebase')).auth.currentUser?.uid;
        if (userId) {
          const res = await fetch('/api/sessions/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, firstMessage: initialMessage || '' })
          });
          const data = await res.json();
          if (data.status === 'success') {
            setCurrentSessionId(data.sessionId);
            currentSessionIdRef.current = data.sessionId;
          }
        }
      } catch (e) {
        console.warn('Failed to create chat session:', e);
      }
    }

    recorderRef.current = new AudioRecorder();
    playerRef.current = new AudioPlayer();

    recorderRef.current.onVolumeChange = (vol) => {
      if (!isSpeaking) {
        setVolume(vol);
      }
    };

    playerRef.current.onVolumeChange = (vol) => {
      if (isSpeaking) {
        setVolume(vol);
      }
    };

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      let location = null;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch (e) {
        console.warn('Could not get location', e);
      }

      if (enableScreenShare) {
        try {
          videoStreamRef.current = await navigator.mediaDevices.getDisplayMedia({ video: true });
        } catch (e) {
          console.warn('Screen share cancelled or failed', e);
          toast.error('Screen sharing was cancelled or blocked.');
          setIsConnecting(false);
          return;
        }
      }

      if (enableMic) {
        try {
          await recorderRef.current.start();
          setIsMicActive(true);
        } catch (e) {
          console.error('Failed to start audio recording:', e);
          toast.error('Microphone access denied or failed. Please check permissions.');
          setIsConnecting(false);
          return;
        }
      } else {
        setIsMicActive(false);
      }

      const personalityInstructions = {
        classic: 'You are Jarvis, a highly advanced personal AI assistant. You are helpful, concise, and capable.',
        sarcastic: 'You are Jarvis, but with a sharp, sarcastic wit similar to Tony Stark. You are still helpful, but you make jokes and have a bit of an attitude.',
        scientific: 'You are Jarvis, acting as a deep scientific researcher. You are extremely analytical, use technical terminology, and focus on data and logic.'
      };

      // Fetch Jarvis's soul (full self-awareness document)
      let soulContent = '';
      try {
        const soulRes = await fetch('/api/jarvis-mind');
        const soulData = await soulRes.json();
      if (soulData.mind?.soul) soulContent = soulData.mind.soul;
        if (soulData.mind?.manifest) soulContent += '\n\n' + soulData.mind.manifest;
      } catch { }

      // Fetch Morning Briefing data (alerts, P&L, loss debriefs)
      let morningBriefing = '';
      try {
        const userId = (await import('../firebase')).auth.currentUser?.uid;
        if (userId) {
          const briefingRes = await fetch(`/api/briefing?userId=${userId}`);
          const briefingData = await briefingRes.json();
          if (briefingData.status === 'success' && briefingData.briefing) {
            const b = briefingData.briefing;
            const parts: string[] = [];

            // P&L summary
            if (b.todayWins > 0 || b.todayLosses > 0) {
              parts.push(`Today's trading: ${b.todayWins} wins, ${b.todayLosses} losses, total P&L: $${b.todayPnl.toFixed(2)}. ${b.isPracticeMode !== false ? `Paper balance: $${b.paperBalance.toFixed(2)}` : `Live USDT balance: $${(b.liveBalance || 0).toFixed(2)}`}.`);
            }
            if (b.openPositions > 0) {
              parts.push(`You have ${b.openPositions} open position(s) being monitored.`);
            }

            // Market alerts
            if (b.alerts && b.alerts.length > 0) {
              parts.push(`Market alerts while you were away: ${b.alerts.join(' | ')}`);
            }

            // Loss debriefs
            if (b.lossDebriefs && b.lossDebriefs.length > 0) {
              const debriefs = b.lossDebriefs.map((d: any) => 
                `Lost $${Math.abs(d.pnl).toFixed(2)} on ${d.symbol}. Lesson: ${d.lesson}`
              ).join(' ');
              parts.push(`Recent loss debrief: ${debriefs}`);
            }

            if (parts.length > 0) {
              morningBriefing = `\n\n[MORNING BRIEFING — Proactively share this with the user when they first speak to you. Keep it concise, 2-3 sentences max. Start with "Here's your update:" or "Quick briefing:"]\n${parts.join('\n')}`;
            }
          }
        }
      } catch (e) {
        console.warn('Failed to fetch briefing:', e);
      }

      const systemInstruction = `${personalityInstructions[personality]}

${soulContent}

You have access to the user's screen if they shared it, and you can see what they are looking at. You also have access to past conversation summaries to maintain context.
      
If the user shares their screen and asks you to analyze a chart, act as an expert technical analyst. Look at the candlestick patterns, trend lines, support/resistance levels, and indicators visible on the screen. Provide a detailed breakdown of the market structure (e.g., Bull Flags, Head and Shoulders, breakouts) and suggest potential trade setups based on the visual data.

[CURRENT MODE — CRITICAL: You MUST use these values. NEVER ask the user what mode they are in.]
Trading Mode: ${isPracticeMode ? 'PRACTICE (Paper Trading)' : 'LIVE (Real Money)'}
Execution Mode: ${currentTradingMode === 'sentry' ? 'SENTRY (Fully Automatic — execute and close trades without asking)' : 'COPILOT (Ask user before every trade)'}
When placing trades via executeTrade or createTradingGoal, ALWAYS set isPractice=${isPracticeMode}. Do NOT ask the user to confirm the mode — you already know it.

[LIVE PORTFOLIO STATE]
Current Balance: $${portfolioState ? portfolioState.balance.toFixed(2) : 'unknown'}
Today's P&L: $${portfolioState ? portfolioState.todayPnl.toFixed(2) : 'unknown'}
Open Positions: ${portfolioState ? portfolioState.openPositions : 'unknown'}
Realized P&L: $${portfolioState ? portfolioState.realizedPnl.toFixed(2) : 'unknown'}
Unrealized P&L: $${portfolioState ? portfolioState.unrealizedPnl.toFixed(2) : 'unknown'}

[BROKER STATUS]
${brokerStatus || 'No broker connected. Paper trading only.'}

User Location: ${location ? `Lat: ${location.lat}, Lng: ${location.lng}` : 'Unknown'}
Past Context:
${memoryContext}

Be conversational, smooth, and act like a real assistant. Keep responses relatively brief unless asked for details. If you need to search the web for real-time info like weather or news, use the Google Search tool. 
If the user asks about crypto or stock prices, ALWAYS use the getMarketPrice tool to fetch the live price before answering.
If the user asks for technical analysis, indicators (RSI, MACD, EMAs), or trend analysis on a specific coin, use the analyzeMarket tool. When analyzing the market, pay close attention to the \`candlestickPatterns\` returned. A 'Doji' indicates market indecision. A 'Hammer' or 'Bullish Engulfing' suggests a potential upward reversal. A 'Shooting Star' or 'Bearish Engulfing' suggests a potential downward reversal. Use these to time your trade recommendations.
If the user asks to backtest a strategy (like RSI or MACD) on historical data, use the backtestStrategy tool.
If the user asks to optimize a strategy or find the most profitable settings/parameters for a strategy, use the optimizeStrategy tool.
If the user asks to update their risk management settings (like max daily loss, position size, or auto-liquidate threshold), use the updateRiskSettings tool.
If the user asks to buy or sell, use the executeTrade tool. CRITICAL: When the user specifies a dollar profit target (e.g., "make me $10 profit"), you MUST pass it as the profitTarget parameter. When the user specifies a dollar amount to invest (e.g., "buy $5000 worth of DOGE"), you MUST pass it as the investAmount parameter.
TRADING MODES — CRITICAL: You have two trading modes. Do NOT ask for a symbol or any extra information to switch modes.
- SENTRY MODE: Jarvis trades and exits FULLY AUTOMATICALLY. No user approval needed. When the user says "activate sentry mode", "turn on sentry", "go autonomous", "trade automatically", or similar → call switchTradingMode with mode="sentry". Confirm: "Sentry mode activated. I'll handle everything automatically."
- COPILOT MODE: Jarvis asks the user before placing or closing any trade. When the user says "activate copilot mode", "turn on copilot", "ask me before trading", or similar → call switchTradingMode with mode="copilot". Confirm: "Copilot mode activated. I'll check with you before doing anything."
If the user asks to start an autonomous learning loop or practice trading session, use the activateSentryMode tool.
If the user asks to see their history, settings, market, chart, analytics, or home, use the navigateApp tool.
If you need to know what the user is currently looking at, use the getCurrentAppState tool.
If the user asks where something is or how to do something, use the highlightElement tool to point it out.
If the user asks to review their portfolio or trading performance, use the reviewPortfolio tool.
If the user asks for market sentiment or news about an asset, use the analyzeSentiment tool.
If the user asks about whale activity or large transactions, use the getWhaleActivity tool.
If the user asks you to study, learn, memorize, or read a website URL, use the studyWebsite tool. This scrapes the content and saves it to your memory.
If the user says "deep study", "study the entire website", "learn everything from this site", "crawl the full site", or anything indicating they want ALL pages on a website studied (not just one page), use the deepStudyWebsite tool. This crawls every page on the site, summarizes each one, and saves them all to memory. Warn the user this may take a few minutes for large sites.
If the user asks you to make a profit or reach a specific financial target using a set amount of capital WITHOUT specifying exactly when to enter (e.g., "make me a profit of $9 using $5,000", "make me $10 on DOGE"), use the createTradingGoal tool. The system will automatically scan the market, pick the best coin (if not specified), and execute the trade autonomously.
Available element IDs:
- "panic-button": The big red panic close all button
- "settings-button": The key icon for broker API settings
- "memories-button": The brain icon for core memories
- "mic-button": The microphone icon for wake word
- "screen-share-button": The monitor icon for screen vision
- "tab-home", "tab-market", "tab-chart", "tab-history", "tab-settings": The top navigation tabs
- "dashboard-summary": The bottom dashboard bar showing P&L and active positions
${morningBriefing}`;

      const sessionPromise = ai.live.connect({
        model: liveModel || 'gemini-3.1-flash-live-preview',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
          },
          contextWindowCompression: {
            triggerTokens: '80000' as any,
            slidingWindow: {
              targetTokens: '40000' as any,
            },
          },
          tools: [
            { functionDeclarations: [setAlarmTool, setReminderTool, openAppTool, activateSentryModeTool, switchTradingModeTool, getMarketPriceTool, executeTradeTool, closePositionTool, panicCloseAllTool, navigateAppTool, getCurrentAppStateTool, highlightElementTool, reviewPortfolioTool, analyzeSentimentTool, getWhaleActivityTool, analyzeMarketTool, backtestStrategyTool, optimizeStrategyTool, updateRiskSettingsTool, studyWebsiteTool, deepStudyWebsiteTool, createTradingGoalTool, inspectSystemTool, checkMarketRegimeTool, getKellyStatsTool] }
          ],
          systemInstruction: systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            setIsListening(true);

            // Mark session fully ready after promise resolves
            sessionPromise.then(() => setIsSessionReady(true)).catch(() => {});

            if (initialMessage) {
              lastInputSourceRef.current = 'text';
              const prefix = '\n';
              setTranscript((prev) => prev + (prev && prefix ? prefix : '') + '⌨️ You: ' + initialMessage);
              lastSpeakerRef.current = 'user';
              saveMessageToSession('user', initialMessage, 'text');
              sessionPromise.then((session) => {
                session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: initialMessage }] }], turnComplete: true });
              }).catch(() => {});
            }

            recorderRef.current!.onData = (base64Data) => {
              sessionPromise.then((session) => {
                session.sendRealtimeInput({
                  audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' },
                });
              }).catch(() => {});
            };

            if (videoStreamRef.current) {
              const video = document.createElement('video');
              video.muted = true;
              video.playsInline = true;
              video.srcObject = videoStreamRef.current;
              video.play();
              
              videoIntervalRef.current = window.setInterval(() => {
                try {
                  const canvas = document.createElement('canvas');
                  canvas.width = video.videoWidth || 640;
                  canvas.height = video.videoHeight || 480;
                  const ctx = canvas.getContext('2d');
                  if (ctx && video.videoWidth > 0) {
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const base64Data = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                    
                    sessionPromise.then((session) => {
                      session.sendRealtimeInput({
                        video: { data: base64Data, mimeType: 'image/jpeg' },
                      });
                    });
                  }
                } catch (e) {
                  console.error('Error capturing frame', e);
                }
              }, 2000); // Send frame every 2 seconds
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            // DEBUG: Log all message keys to find where function calls come through
            const msgKeys = Object.keys(message || {});
            if (msgKeys.length > 0) {
              const hasToolCall = !!(message as any).toolCall;
              const hasFunctionCall = message.serverContent?.modelTurn?.parts?.some((p: any) => p.functionCall);
              const hasTurnComplete = !!message.serverContent?.turnComplete;
              const hasAudio = message.serverContent?.modelTurn?.parts?.some((p: any) => p.inlineData?.data);
              const hasText = message.serverContent?.modelTurn?.parts?.some((p: any) => p.text);
              if (hasToolCall || hasFunctionCall || hasText || hasTurnComplete) {
                console.log('[MSG]', JSON.stringify({
                  keys: msgKeys,
                  hasToolCall,
                  hasFunctionCall,
                  hasTurnComplete,
                  hasText,
                  parts: message.serverContent?.modelTurn?.parts?.map((p: any) => ({
                    hasFunctionCall: !!p.functionCall,
                    hasText: !!p.text,
                    functionCallName: p.functionCall?.name,
                  })),
                }));
              }
            }

            // Handle toolCall at top level (newer API path)
            // The Live API sends tool calls through message.toolCall, NOT through
            // message.serverContent.modelTurn.parts[].functionCall
            if ((message as any).toolCall) {
              const toolCallMsg = (message as any).toolCall;
              console.log('[TOOL CALL via message.toolCall]', JSON.stringify(toolCallMsg));
              if (toolCallMsg.functionCalls) {
                // Synthesize into serverContent.modelTurn.parts so the existing handler below processes them
                if (!message.serverContent) {
                  (message as any).serverContent = {};
                }
                if (!message.serverContent!.modelTurn) {
                  (message as any).serverContent!.modelTurn = { parts: [] };
                }
                for (const fc of toolCallMsg.functionCalls) {
                  message.serverContent!.modelTurn!.parts!.push({ functionCall: fc } as any);
                }
              }
            }

            if (message.serverContent?.interrupted) {
              playerRef.current?.stop();
              setIsSpeaking(false);
              setVolume(0);
            }

            if (message.serverContent?.turnComplete) {
              // Save any accumulated Jarvis text to chat history
              if (jarvisTextAccumulatorRef.current.trim()) {
                saveMessageToSession('jarvis', jarvisTextAccumulatorRef.current.trim(), 'text');
                jarvisTextAccumulatorRef.current = '';
              }
              // Add a small delay to let the audio finish playing before stopping the animation
              setTimeout(() => setIsSpeaking(false), 1000);
            }

            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  setIsSpeaking(true);
                  playerRef.current?.playBase64Audio(part.inlineData.data);
                }
                if (part.text) {
                  const text = part.text;
                  const prefix = lastSpeakerRef.current !== 'jarvis' ? '\n\n🤖 Jarvis: ' : '';
                  setTranscript((prev) => prev + (prev && prefix ? prefix : (prefix ? '🤖 Jarvis: ' : '')) + text);
                  lastSpeakerRef.current = 'jarvis';
                  jarvisTextAccumulatorRef.current += text;
                }
                if (part.functionCall) {
                  const call = part.functionCall;
                  let response = {};
                  console.log('[TOOL CALL]', call.name, call.args);
                  
                  if (call.name === 'setAlarm') {
                    const { time, label } = call.args as any;
                    toast.success(`Alarm set for ${time} ${label ? `(${label})` : ''}`);
                    response = { status: 'success', message: `Alarm set for ${time}` };
                  } else if (call.name === 'setReminder') {
                    const { message, delayMinutes } = call.args as any;
                    toast.success(`Reminder set: "${message}" in ${delayMinutes} minutes`);
                    setTimeout(() => {
                      toast.info(`Reminder: ${message}`, { duration: 10000 });
                    }, delayMinutes * 60 * 1000);
                    response = { status: 'success', message: `Reminder set for ${delayMinutes} minutes` };
                  } else if (call.name === 'openApp') {
                    const { appName, url } = call.args as any;
                    toast.success(`Opening ${appName}...`);
                    window.open(url, '_blank');
                    response = { status: 'success', message: `Opened ${appName} at ${url}` };
                  } else if (call.name === 'activateSentryMode') {
                    setPipelineAction('sentry', 'Sentry activating...', '#ef4444');
                    const { symbol, autonomousPrompt, maxDailyLoss } = call.args as any;
                    try {
                      const effectiveUserId = auth.currentUser?.uid;
                      if (!effectiveUserId) throw new Error('Not logged in');

                      const res = await fetch('/api/sentry/activate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          userId: effectiveUserId,
                          symbol,
                          autonomousPrompt,
                          maxDailyLoss
                        })
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || 'Server error');

                      toast.success(`Sentry Mode Activated! Jarvis is now in autonomous mode.`, {
                        style: { backgroundColor: '#a855f7', color: 'white', border: 'none' },
                        duration: 5000
                      });
                      setPipelineActivity(prev => ({ ...prev, actionLabel: `Autonomous Mode` }));
                      response = { status: 'success', message: `Autonomous learning loop started.` };
                    } catch (e: any) {
                      console.error('Sentry Activation Error:', e);
                      toast.error(`Failed: ${e.message || 'Unknown error'}`);
                      clearPipelineAction();
                      response = { status: 'error', message: `Failed to activate Sentry Mode: ${e.message}` };
                    }
                  } else if (call.name === 'switchTradingMode') {
                    const { mode } = call.args as any;
                    try {
                      // Save the preference so new trades pick it up
                      localStorage.setItem('jarvis_trading_mode', mode);
                      setTradingMode(mode);
                      if (mode === 'sentry') {
                        setPipelineAction('sentry', 'Sentry Mode Active', '#a855f7');
                        toast.success('⚡ Sentry Mode activated. Jarvis will trade and exit fully automatically.', {
                          style: { backgroundColor: '#a855f7', color: 'white', border: 'none' },
                          duration: 5000
                        });
                      } else {
                        setPipelineAction('copilot', 'Copilot Mode Active', '#06b6d4');
                        toast.success('🧑‍✈️ Copilot Mode activated. Jarvis will ask before doing anything.', {
                          style: { backgroundColor: '#0e7490', color: 'white', border: 'none' },
                          duration: 5000
                        });
                      }
                      response = { status: 'success', mode, message: `Switched to ${mode} mode.` };
                    } catch (e: any) {
                      response = { status: 'error', message: e.message };
                    }
                  } else if (call.name === 'getMarketPrice') {
                    const { symbol } = call.args as any;
                    setPipelineAction('market-analysis', `Fetching ${symbol}...`, '#22c55e');
                    try {
                      const res = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&broker=crypto`);
                      const data = await res.json();
                      clearPipelineAction('✓ Price fetched');
                      response = { status: 'success', price: data.price, change: data.change, symbol: data.symbol };
                    } catch (e) {
                      clearPipelineAction();
                      response = { status: 'error', message: 'Failed to fetch market price' };
                    }
                  } else if (call.name === 'analyzeMarket') {
                    const { symbol, timeframe } = call.args as any;
                    setPipelineAction('market-analysis', `Analyzing ${symbol}...`, '#22c55e');
                    try {
                      const res = await fetch(`/api/analysis?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);
                      const data = await res.json();
                      clearPipelineAction('✓ Analysis done');
                      response = data;
                    } catch (e) {
                      clearPipelineAction();
                      response = { status: 'error', message: 'Failed to fetch market analysis' };
                    }
                  } else if (call.name === 'backtestStrategy') {
                    const { symbol, timeframe, strategy, initialBalance } = call.args as any;
                    setPipelineAction('backtesting', `Backtesting ${strategy}...`, '#f97316');
                    try {
                      const res = await fetch('/api/backtest', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symbol, timeframe, strategy, initialBalance })
                      });
                      const data = await res.json();
                      clearPipelineAction('✓ Backtest done');
                      response = data;
                    } catch (e) {
                      clearPipelineAction();
                      response = { status: 'error', message: 'Failed to run backtest' };
                    }
                  } else if (call.name === 'optimizeStrategy') {
                    const { symbol, timeframe, strategy } = call.args as any;
                    try {
                      const res = await fetch('/api/optimize', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symbol, timeframe, strategy })
                      });
                      const data = await res.json();
                      response = data;
                    } catch (e) {
                      response = { status: 'error', message: 'Failed to optimize strategy' };
                    }
                  } else if (call.name === 'updateRiskSettings') {
                    const { maxDailyLoss, maxPositionSizePct, autoLiquidateThreshold, requireConfirmation } = call.args as any;
                    try {
                      const { auth } = await import('../firebase');
                      if (auth.currentUser) {
                        // Fetch existing to merge
                        const res = await fetch(`/api/risk-settings?userId=${auth.currentUser.uid}`);
                        const data = await res.json();
                        const currentSettings = data.settings || {};
                        
                        const newSettings = {
                          ...currentSettings,
                          ...(maxDailyLoss !== undefined && { maxDailyLoss }),
                          ...(maxPositionSizePct !== undefined && { maxPositionSizePct }),
                          ...(autoLiquidateThreshold !== undefined && { autoLiquidateThreshold }),
                          ...(requireConfirmation !== undefined && { requireConfirmation }),
                        };

                        await fetch('/api/risk-settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ userId: auth.currentUser.uid, settings: newSettings })
                        });
                        
                        toast.success('Risk settings updated by Jarvis', {
                          style: { backgroundColor: '#10b981', color: 'white', border: 'none' }
                        });
                        response = { status: 'success', message: 'Risk settings updated successfully', settings: newSettings };
                      } else {
                        response = { status: 'error', message: 'User not authenticated' };
                      }
                    } catch (e) {
                      response = { status: 'error', message: 'Failed to update risk settings' };
                    }
                  } else if (call.name === 'createTradingGoal') {
                    const { targetProfit, capital, isPractice, deadlineDays, maxSlots } = call.args as any;
                    setPipelineAction('trading', `Creating Campaign: $${targetProfit} in ${deadlineDays || 7}d...`, '#a855f7');
                    try {
                      const { auth } = await import('../firebase');
                      if (auth.currentUser) {
                        const res = await fetch('/api/goals/create', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ 
                            userId: auth.currentUser.uid, 
                            targetProfit, 
                            capital, 
                            isPractice,
                            deadlineDays: deadlineDays || 7,
                            maxSlots: maxSlots || 3
                          })
                        });
                        const data = await res.json();
                        if (res.ok && data.status === 'success') {
                          const msg = `Campaign Created: $${targetProfit} profit using $${capital} in ${deadlineDays || 7} days (${isPractice ? 'Practice' : 'Real'} Mode)`;
                          toast.success(msg, {
                            style: { backgroundColor: '#a855f7', color: 'white', border: 'none', whiteSpace: 'pre-line' }
                          });
                          clearPipelineAction('✓ Campaign Active');
                          response = { status: 'success', message: `Trading campaign started successfully. I will autonomously manage multiple trades to reach the target within ${deadlineDays || 7} days.` };
                        } else {
                          throw new Error(data.error || 'Failed to create goal');
                        }
                      } else {
                        response = { status: 'error', message: 'User not authenticated' };
                      }
                    } catch (e: any) {
                      toast.error(`Failed to create goal: ${e.message}`);
                      clearPipelineAction();
                      response = { status: 'error', message: `Failed to create trading goal: ${e.message}` };
                    }
                  } else if (call.name === 'executeTrade') {
                    const { symbol, side, riskPercentage, stopLossPrice, takeProfitPrice, trailingStopDistance, profitTarget, investAmount } = call.args as any;
                    let { quantity } = call.args as any;
                    setPipelineAction('trading', `${side?.toUpperCase()} ${symbol}...`, '#f59e0b');
                    try {
                      if (executeTradeFn) {
                        // Fetch current price first
                        let currentPrice = 100;
                        try {
                          const priceRes = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&broker=crypto`);
                          const priceData = await priceRes.json();
                          if (priceData.price) currentPrice = priceData.price;
                        } catch (e) {
                          console.warn('Failed to fetch real price for trade, using mock', e);
                        }

                        // Auto-calculate quantity from investAmount
                        if (investAmount && currentPrice > 0 && !quantity) {
                           quantity = investAmount / currentPrice;
                           console.log(`[TRADE] Auto-calculated quantity from $${investAmount} investAmount: ${quantity}`);
                        }

                        // Auto-calculate takeProfitPrice from dollar profitTarget
                        let effectiveTakeProfitPrice = takeProfitPrice;
                        if (profitTarget && !takeProfitPrice && quantity && currentPrice) {
                          if (side === 'buy') {
                            effectiveTakeProfitPrice = currentPrice + (profitTarget / quantity);
                          } else {
                            effectiveTakeProfitPrice = currentPrice - (profitTarget / quantity);
                          }
                          console.log(`[TRADE] Auto-calculated TP from $${profitTarget} profit target: $${effectiveTakeProfitPrice.toFixed(4)}`);
                        }

                        const result = await executeTradeFn({
                          symbol,
                          side,
                          quantity,
                          riskPercentage,
                          stopLossPrice,
                          takeProfitPrice: effectiveTakeProfitPrice,
                          trailingStopDistance,
                          currentPrice,
                          profitTarget
                        });
                        toast.success(`Trade Executed: ${side.toUpperCase()} ${result.quantity} ${symbol} @ $${currentPrice}`, {
                          style: { backgroundColor: side.toLowerCase() === 'buy' ? '#22c55e' : '#ef4444', color: 'white', border: 'none' },
                          duration: 5000
                        });
                        clearPipelineAction('✓ Order filled!');
                        response = { status: 'success', message: `Trade executed: ${side} ${result.quantity} ${symbol} at $${currentPrice}` };
                      } else {
                        throw new Error('Trade execution not available on client');
                      }
                    } catch (e: any) {
                      toast.error(`Trade Failed: ${e.message}`);
                      clearPipelineAction();
                      response = { status: 'error', message: `Failed to execute trade: ${e.message}` };
                    }
                  } else if (call.name === 'navigateApp') {
                    const { destination } = call.args as any;
                    if (onNavigate) {
                      onNavigate(destination);
                      response = { status: 'success', message: `Navigated to ${destination}` };
                    } else {
                      response = { status: 'error', message: 'Navigation not supported' };
                    }
                  } else if (call.name === 'getCurrentAppState') {
                    if (getAppState) {
                      const state = getAppState();
                      response = { status: 'success', currentState: state };
                    } else {
                      response = { status: 'error', message: 'App state not available' };
                    }
                  } else if (call.name === 'highlightElement') {
                    const { elementId } = call.args as any;
                    if (onHighlight) {
                      onHighlight(elementId);
                      response = { status: 'success', message: `Highlighted element ${elementId}` };
                    } else {
                      response = { status: 'error', message: 'Highlighting not supported' };
                    }
                  } else if (call.name === 'reviewPortfolio') {
                    setPipelineAction('portfolio-review', 'Reviewing...', '#14b8a6');
                    if (onNavigate) {
                      onNavigate('analytics');
                    }
                    clearPipelineAction('✓ Portfolio reviewed');
                    response = { status: 'success', message: 'Navigated to analytics dashboard. Please analyze the user\'s performance based on the data you see on the screen.' };
                  } else if (call.name === 'closePosition') {
                    const { tradeId } = call.args as any;
                    setPipelineAction('trading', 'Closing position...', '#f59e0b');
                    try {
                      if (closePositionFn) {
                        const result = await closePositionFn(tradeId);
                        toast.success(`Position ${tradeId} closed.`, {
                          style: { backgroundColor: '#f59e0b', color: 'white', border: 'none' },
                        });
                        clearPipelineAction('✓ Position closed');
                        response = { status: 'success', message: `Position ${tradeId} closed successfully`, result };
                      } else {
                        response = { status: 'error', message: 'Close position function not available' };
                      }
                    } catch (e: any) {
                      toast.error(`Failed to close position: ${e.message}`);
                      clearPipelineAction();
                      response = { status: 'error', message: `Failed to close position: ${e.message}` };
                    }
                  } else if (call.name === 'panicCloseAll') {
                    try {
                      if (panicCloseAllFn) {
                        await panicCloseAllFn();
                        toast.error('PANIC: All positions closed!', {
                          style: { backgroundColor: '#ef4444', color: 'white', border: 'none' },
                          duration: 5000
                        });
                        response = { status: 'success', message: 'All positions have been closed' };
                      } else {
                        response = { status: 'error', message: 'Panic close function not available' };
                      }
                    } catch (e: any) {
                      response = { status: 'error', message: `Failed to close all positions: ${e.message}` };
                    }
                  } else if (call.name === 'studyWebsite') {
                    const { url } = call.args as any;
                    const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
                    setPipelineAction('web-learning', `Scraping ${hostname}...`, '#22d3ee');
                    toast.info(`Studying ${url}...`);
                    try {
                      const { auth } = await import('../firebase');
                      if (auth.currentUser) {
                        // Use AbortController for timeout safety
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

                        try {
                          console.log('[studyWebsite] Fetching /api/memory/study-stream...');
                          const res = await fetch('/api/memory/study-stream', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url, userId: auth.currentUser.uid, model: memoryModelRef.current }),
                            signal: controller.signal,
                          });

                          console.log('[studyWebsite] fetch returned status=', res.status, 'body=', !!res.body);

                          if (!res.ok) throw new Error(`HTTP ${res.status}`);
                          if (!res.body) throw new Error('No response body for SSE stream');

                          const reader = res.body.getReader();
                          const decoder = new TextDecoder();
                          let summary = '';
                          let hadError = false;

                          try {
                            while (true) {
                              const { done, value } = await reader.read();
                              console.log('[studyWebsite] reader.read() done=', done, 'bytes=', value?.length);
                              if (done) break;
                              const text = decoder.decode(value, { stream: true });
                              console.log('[studyWebsite] SSE chunk:', text.substring(0, 200));
                              const lines = text.split('\n').filter(l => l.startsWith('data: '));
                              for (const line of lines) {
                                try {
                                  const progress = JSON.parse(line.replace('data: ', ''));
                                  // Handle error stage from server
                                  if (progress.stage === 'error') {
                                    hadError = true;
                                    throw new Error(progress.message || 'Study failed on server');
                                  }
                                  setPipelineActivity(prev => ({
                                    ...prev,
                                    action: 'web-learning',
                                    memory: progress.stage === 'complete' ? 'complete' : 'storing',
                                    memoryProgress: progress.progress,
                                    memoryLabel: progress.stage === 'complete'
                                      ? '✓ Learned!'
                                      : `Learning ${progress.progress}%`,
                                    actionLabel: progress.message,
                                  }));
                                  if (progress.summary) summary = progress.summary;
                                } catch (parseErr: any) {
                                  if (hadError) throw parseErr;
                                  /* skip malformed SSE lines */
                                }
                              }
                            }
                          } finally {
                            reader.releaseLock();
                          }

                          clearTimeout(timeoutId);
                          toast.success(`Learned from ${url}!`);
                          
                          // Push to UI cache so it appears in the Brain modal immediately
                          memoryService.localCache.unshift({
                            id: crypto.randomUUID(),
                            timestamp: Date.now(),
                            summary: `Knowledge acquired from [${url}]:\n${summary}`,
                            type: 'conversation' // Or create a new type like 'web_knowledge' if you prefer, but 'conversation' matches the CSS styles
                          });

                          clearPipelineAction('✓ Learned!');
                          response = { status: 'success', summary, message: `Successfully studied and memorized content from ${url}` };
                          console.log('[studyWebsite] SUCCESS, summary length=', summary.length);
                        } catch (streamErr: any) {
                          clearTimeout(timeoutId);
                          console.error('[studyWebsite] Stream error:', streamErr.message);
                          throw streamErr;
                        }
                      } else {
                        console.warn('[studyWebsite] No current user!');
                        clearPipelineAction();
                        response = { status: 'error', message: 'User not authenticated' };
                      }
                    } catch (e: any) {
                      clearPipelineAction();
                      console.error('[studyWebsite] FINAL catch:', e.message);
                      response = { status: 'error', message: `Failed to study website: ${e.message}` };
                    }
                  } else if (call.name === 'deepStudyWebsite') {
                    const { url } = call.args as any;
                    const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
                    setPipelineAction('web-learning', `Deep Study: Scanning ${hostname}...`, '#22d3ee');
                    toast.info(`Deep studying entire website: ${hostname}...`);
                    try {
                      const { auth } = await import('../firebase');
                      if (auth.currentUser) {
                        // Deep study can take a long time — no timeout
                        try {
                          console.log('[deepStudyWebsite] Fetching /api/memory/deep-study-stream...');
                          const res = await fetch('/api/memory/deep-study-stream', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url, userId: auth.currentUser.uid, model: memoryModelRef.current }),
                          });

                          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
                          const reader = res.body.getReader();
                          const decoder = new TextDecoder();
                          let pagesStudied = 0;
                          let totalPages = 0;

                          try {
                            while (true) {
                              const { done, value } = await reader.read();
                              if (done) break;
                              const text = decoder.decode(value, { stream: true });
                              const lines = text.split('\n').filter(l => l.startsWith('data: '));
                              for (const line of lines) {
                                try {
                                  const progress = JSON.parse(line.slice(6));

                                  // Extract page counts from meta
                                  if (progress.meta?.totalPages) totalPages = progress.meta.totalPages;
                                  if (progress.meta?.pagesStudied) pagesStudied = progress.meta.pagesStudied;

                                  // Update pipeline bar with detailed progress
                                  setPipelineActivity((prev: PipelineActivity) => ({
                                    ...prev,
                                    action: 'web-learning',
                                    memory: progress.stage === 'complete' ? 'complete' : 'storing',
                                    memoryProgress: progress.progress,
                                    memoryLabel: progress.stage === 'complete'
                                      ? `✓ ${pagesStudied} pages!`
                                      : totalPages > 0
                                        ? `Page ${pagesStudied} of ${totalPages}`
                                        : progress.message,
                                    actionLabel: progress.message,
                                  }));

                                  if (progress.stage === 'error') {
                                    throw new Error(progress.message);
                                  }
                                } catch (parseErr: any) {
                                  // skip malformed SSE
                                }
                              }
                            }
                          } finally {
                            reader.releaseLock();
                          }

                          toast.success(`Deep study complete! Learned ${pagesStudied} pages from ${hostname}`);
                          clearPipelineAction(`✓ ${pagesStudied} pages learned!`);

                          // Push to local memory cache
                          memoryService.localCache.unshift({
                            id: crypto.randomUUID(),
                            timestamp: Date.now(),
                            summary: `Deep study of [${url}]: Crawled and memorized ${pagesStudied} pages from ${hostname}`,
                            type: 'conversation'
                          });

                          response = { status: 'success', message: `Deep study complete! Studied ${pagesStudied} pages from ${hostname}` };
                        } catch (streamErr: any) {
                          console.error('[deepStudyWebsite] Stream error:', streamErr.message);
                          throw streamErr;
                        }
                      } else {
                        clearPipelineAction();
                        response = { status: 'error', message: 'User not authenticated' };
                      }
                    } catch (e: any) {
                      clearPipelineAction();
                      console.error('[deepStudyWebsite] Error:', e.message);
                      response = { status: 'error', message: `Deep study failed: ${e.message}` };
                    }
                  } else if (call.name === 'analyzeSentiment') {
                    const { asset } = call.args as any;
                    setPipelineAction('sentiment', `Sentiment: ${asset}...`, '#a855f7');
                    toast.info(`Consulting News Sentiment Analyst for ${asset}...`);
                    try {
                      const res = await fetch('/api/data/sentiment');
                      const data = await res.json();
                      const relevantArticles = (data.data || []).filter((a: any) =>
                        a.title.toLowerCase().includes(asset.toLowerCase()) ||
                        a.summary.toLowerCase().includes(asset.toLowerCase())
                      );
                      const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
                      relevantArticles.forEach((a: any) => {
                        if (a.sentiment === 'Positive') sentimentCounts.positive++;
                        else if (a.sentiment === 'Negative') sentimentCounts.negative++;
                        else sentimentCounts.neutral++;
                      });
                      const overallSentiment = sentimentCounts.positive > sentimentCounts.negative ? 'Bullish' : sentimentCounts.negative > sentimentCounts.positive ? 'Bearish' : 'Neutral';
                      clearPipelineAction(`✓ ${overallSentiment}`);
                      response = {
                        status: 'success',
                        sentiment: overallSentiment,
                        articleCount: relevantArticles.length,
                        breakdown: sentimentCounts,
                        topArticles: relevantArticles.slice(0, 3).map((a: any) => ({ title: a.title, sentiment: a.sentiment, source: a.source })),
                        message: `The News Sentiment Analyst reports that the current sentiment for ${asset} is ${overallSentiment} based on ${relevantArticles.length} articles.`
                      };
                    } catch (e) {
                      clearPipelineAction();
                      response = { status: 'error', message: `Failed to fetch sentiment data for ${asset}` };
                    }
                  } else if (call.name === 'getWhaleActivity') {
                    const { asset } = call.args as any;
                    setPipelineAction('whale-tracking', `Tracking ${asset}...`, '#3b82f6');
                    toast.info(`Consulting Whale Tracker for ${asset}...`);
                    try {
                      const res = await fetch('/api/data/whales');
                      const data = await res.json();
                      const relevantAlerts = (data.data || []).filter((w: any) =>
                        w.symbol.toLowerCase().includes(asset.toLowerCase())
                      );
                      const totalVolume = relevantAlerts.reduce((sum: number, w: any) => sum + w.valueUsd, 0);
                      clearPipelineAction(`✓ ${relevantAlerts.length} alerts`);
                      response = {
                        status: 'success',
                        alertCount: relevantAlerts.length,
                        totalVolumeUsd: totalVolume,
                        alerts: relevantAlerts.slice(0, 5).map((w: any) => ({
                          action: w.action,
                          amount: w.amount,
                          symbol: w.symbol,
                          valueUsd: w.valueUsd,
                          from: w.from,
                          to: w.to,
                          urgency: w.urgency
                        })),
                        message: `The Whale Tracker found ${relevantAlerts.length} recent whale movements for ${asset} totaling $${totalVolume.toLocaleString()}.`
                      };
                    } catch (e) {
                      clearPipelineAction();
                      response = { status: 'error', message: `Failed to fetch whale data for ${asset}` };
                    }
                  } else if (call.name === 'inspectSystem') {
                    const { aspect } = call.args as any;
                    setPipelineAction('system-inspect', 'Inspecting system...', '#06b6d4');
                    try {
                      const res = await fetch('/api/system-manifest');
                      const manifest = await res.json();
                      clearPipelineAction('✓ System inspected');
                      
                      if (aspect === 'engines') {
                        response = { status: 'success', engines: manifest.engines, message: `${manifest.engines.length} engines active.` };
                      } else if (aspect === 'version') {
                        response = { status: 'success', version: manifest.version, buildDate: manifest.buildDate, changelog: manifest.changelog };
                      } else if (aspect === 'changelog') {
                        response = { status: 'success', recentChanges: manifest.recentChanges, changelog: manifest.changelog };
                      } else if (aspect === 'health') {
                        response = { status: 'success', version: manifest.version, engineCount: manifest.engines.length, apiRouteCount: manifest.apiRouteCount, generatedAt: manifest.generatedAt, message: 'All systems operational.' };
                      } else {
                        response = { status: 'success', ...manifest };
                      }
                    } catch (e: any) {
                      clearPipelineAction();
                      response = { status: 'error', message: `Failed to inspect system: ${e.message}` };
                    }
                  } else if (call.name === 'checkMarketRegime') {
                    const { symbol } = call.args as any;
                    setPipelineAction('regime', symbol ? `Detecting regime: ${symbol}...` : 'Scanning market regime...', '#f97316');
                    try {
                      if (symbol) {
                        const cleanSymbol = symbol.replace('/', '');
                        const res = await fetch(`/api/regime/${cleanSymbol}`);
                        const data = await res.json();
                        clearPipelineAction(`✓ ${data.regime}`);
                        response = {
                          status: 'success',
                          symbol: data.symbol,
                          regime: data.regime,
                          confidence: data.confidence,
                          adx: data.adx,
                          atrPercent: data.atrPercent,
                          bbWidth: data.bbWidth,
                          emaAlignment: data.emaAlignment,
                          shouldTrade: data.recommendations?.shouldTrade,
                          strategyType: data.recommendations?.strategyType,
                          recommendation: data.recommendations?.reason,
                          message: `${data.symbol} is currently in a ${data.regime.replace('_', ' ')} regime with ${data.confidence}% confidence. ${data.recommendations?.reason || ''}`
                        };
                      } else {
                        const res = await fetch('/api/regime');
                        const data = await res.json();
                        clearPipelineAction(`✓ ${data.overallRegime}`);
                        const regimeSummary = data.regimes?.slice(0, 5).map((r: any) =>
                          `${r.symbol}: ${r.regime.replace('_', ' ')} (ADX: ${r.adx})`
                        ).join(', ');
                        response = {
                          status: 'success',
                          overallRegime: data.overallRegime,
                          marketHealth: data.marketHealth,
                          trendingCount: data.trendingCount,
                          rangingCount: data.rangingCount,
                          volatileCount: data.volatileCount,
                          topRegimes: regimeSummary,
                          message: `Market is ${data.overallRegime.replace('_', ' ')} (health: ${data.marketHealth}). ${data.trendingCount} trending, ${data.rangingCount} ranging, ${data.volatileCount} volatile out of ${data.regimes?.length || 0} coins scanned.`
                        };
                      }
                    } catch (e: any) {
                      clearPipelineAction();
                      response = { status: 'error', message: `Failed to detect market regime: ${e.message}` };
                    }
                  } else if (call.name === 'getKellyStats') {
                    const { userId } = call.args as any;
                    setPipelineAction('kelly', 'Calculating Kelly sizing...', '#8b5cf6');
                    try {
                      const res = await fetch(`/api/kelly/${userId}`);
                      const data = await res.json();
                      clearPipelineAction('✓ Stats ready');
                      const o = data.overall || {};
                      const topCoins = (data.bySymbol || []).slice(0, 3).map((s: any) =>
                        `${s.symbol}: ${(s.stats.winRate * 100).toFixed(0)}% WR, $${s.stats.edge?.toFixed(2)} edge`
                      ).join(' | ');
                      response = {
                        status: 'success',
                        totalTrades: o.totalTrades,
                        winRate: `${(o.winRate * 100).toFixed(1)}%`,
                        wins: o.wins,
                        losses: o.losses,
                        avgWin: `$${o.avgWin?.toFixed(2)}`,
                        avgLoss: `$${o.avgLoss?.toFixed(2)}`,
                        payoffRatio: `${o.payoffRatio?.toFixed(2)}x`,
                        recommendedRisk: `${o.recommendedRiskPercent}%`,
                        edge: `$${o.edge?.toFixed(2)} per trade`,
                        currentStreak: o.streakData?.currentStreak,
                        longestWinStreak: o.streakData?.longestWinStreak,
                        longestLossStreak: o.streakData?.longestLossStreak,
                        topCoins,
                        message: `Based on ${o.totalTrades} trades: ${(o.winRate * 100).toFixed(1)}% win rate, ${o.payoffRatio?.toFixed(2)}x payoff ratio. Kelly recommends risking ${o.recommendedRiskPercent}% per trade. Edge: $${o.edge?.toFixed(2)} per trade. ${o.streakData?.currentStreak > 0 ? `Currently on a ${o.streakData.currentStreak}-trade win streak!` : o.streakData?.currentStreak < 0 ? `Currently on a ${Math.abs(o.streakData.currentStreak)}-trade loss streak.` : ''}`
                      };
                    } catch (e: any) {
                      clearPipelineAction();
                      response = { status: 'error', message: `Failed to get Kelly stats: ${e.message}` };
                    }
                  }

                  console.log('[TOOL CALL] Sending tool response for', call.name, 'response=', JSON.stringify(response).substring(0, 200));
                  sessionPromise.then(session => {
                    console.log('[TOOL CALL] sendToolResponse executing for', call.name);
                    session.sendToolResponse({
                      functionResponses: [{
                        name: call.name,
                        id: call.id,
                        response: response
                      }]
                    });
                    console.log('[TOOL CALL] sendToolResponse DONE for', call.name);
                  });
                }
              }
            }

            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              const finished = message.serverContent.inputTranscription.finished;
              lastInputSourceRef.current = 'voice';
              if (text) {
                const icon = '🎤';
                const prefix = lastSpeakerRef.current !== 'user' ? `\n\n${icon} You: ` : '';
                setTranscript((prev) => prev + (prev && prefix ? prefix : (prefix ? `${icon} You: ` : '')) + text);
                lastSpeakerRef.current = 'user';
              }
              if (finished) {
                // Save the complete user voice message to session
                // We need to capture the accumulated text - use the transcript state
                saveMessageToSession('user', text || '', 'voice');
                lastSpeakerRef.current = null;
              }
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              const finished = message.serverContent.outputTranscription.finished;
              if (text) {
                const prefix = lastSpeakerRef.current !== 'jarvis' ? '\n\n🤖 Jarvis: ' : '';
                setTranscript((prev) => prev + (prev && prefix ? prefix : (prefix ? '🤖 Jarvis: ' : '')) + text);
                lastSpeakerRef.current = 'jarvis';
                jarvisTextAccumulatorRef.current += text;
              }
              if (finished) {
                // Save the complete accumulated Jarvis voice response to session
                if (jarvisTextAccumulatorRef.current.trim()) {
                  saveMessageToSession('jarvis', jarvisTextAccumulatorRef.current.trim(), 'voice');
                  jarvisTextAccumulatorRef.current = '';
                }
                lastSpeakerRef.current = null;
              }
            }
          },
          onclose: () => {
            stopSession();
          },
          onerror: (error) => {
            console.error('Live API Error:', error);
            if (error instanceof Error && error.message.includes('Network error')) {
              toast.error('Network error: Connection to Jarvis was lost or blocked. Please try again.');
            } else {
              toast.error('An error occurred with the Jarvis connection.');
            }
            stopSession();
          },
        },
      });

      // Catch the initial connect promise here too so it doesn't leak unhandled rejections
      sessionPromise.catch((error) => {
        console.error('ai.live.connect promise rejected:', error);
        setIsConnecting(false);
        stopSession();
      });

      sessionRef.current = sessionPromise;
    } catch (error) {
      console.error('Failed to start session synchronously:', error);
      setIsConnecting(false);
      stopSession();
    }
  }, [isConnected, isConnecting]);

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.then((session: any) => session.close()).catch(() => {});
      sessionRef.current = null;
    }
    if (recorderRef.current) {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.stop();
      playerRef.current = null;
    }
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach(t => t.stop());
      videoStreamRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    setIsSessionReady(false);
    setIsListening(false);
    setIsMicActive(false);
    setIsSpeaking(false);
    setVolume(0);
    // NOTE: We intentionally do NOT clear transcript, sessionId, or chatMessages here.
    // The session persists until endSession() is called.
  }, []);

  // Full session termination — clears everything
  const endSession = useCallback(() => {
    stopSession();
    setTranscript('');
    setChatMessages([]);
    setCurrentSessionId(null);
    currentSessionIdRef.current = null;
    jarvisTextAccumulatorRef.current = '';
    lastSpeakerRef.current = null;
  }, [stopSession]);

  const sendTextMessage = useCallback((text: string, memoryModel?: string) => {
    if (!isSessionReady || !sessionRef.current) return;

    lastInputSourceRef.current = 'text';
    const icon = '⌨️';
    const prefix = lastSpeakerRef.current !== 'user' ? `\n\n${icon} You: ` : '\n';
    setTranscript((prev) => prev + (prev && prefix ? prefix : (prefix ? `${icon} You: ` : '')) + text);
    lastSpeakerRef.current = 'user';
    saveMessageToSession('user', text, 'text');

    // Client-side detection: if user says memorize/study/learn + URL, handle directly
    const studyMatch = text.match(/(?:memorize|study|learn\s*from|read\s*and\s*save|remember)\s+(https?:\/\/\S+)/i);
    if (studyMatch) {
      const url = studyMatch[1].replace(/[.,!?;]+$/, ''); // Strip trailing punctuation
      console.log('[CLIENT] Detected study intent, URL:', url);
      const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
      setPipelineAction('web-learning', `Scraping ${hostname}...`, '#22d3ee');
      toast.info(`Studying ${url}...`);

      // Execute the study flow directly
      (async () => {
        try {
          const { auth } = await import('../firebase');
          if (!auth.currentUser) {
            clearPipelineAction();
            toast.error('Not authenticated');
            return;
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);

          const res = await fetch('/api/memory/study-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, userId: auth.currentUser.uid, model: memoryModel }),
            signal: controller.signal,
          });

          console.log('[CLIENT study] fetch status=', res.status);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (!res.body) throw new Error('No response body');

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let summary = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              console.log('[CLIENT study] chunk:', chunk.substring(0, 200));
              const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
              for (const line of lines) {
                try {
                  const progress = JSON.parse(line.replace('data: ', ''));
                  if (progress.stage === 'error') {
                    throw new Error(progress.message || 'Study failed');
                  }
                  setPipelineActivity(prev => ({
                    ...prev,
                    action: 'web-learning',
                    memory: progress.stage === 'complete' ? 'complete' : 'storing',
                    memoryProgress: progress.progress,
                    memoryLabel: progress.stage === 'complete' ? '✓ Learned!' : `Learning ${progress.progress}%`,
                    actionLabel: progress.message,
                  }));
                  if (progress.summary) summary = progress.summary;
                } catch (e: any) {
                  if (e.message.includes('Study failed')) throw e;
                }
              }
            }
          } finally {
            reader.releaseLock();
          }

          clearTimeout(timeoutId);
          toast.success(`Learned from ${url}!`);
          clearPipelineAction('✓ Learned!');

          // Tell Jarvis about what was learned
          sessionRef.current?.then((session: any) => {
            session.sendClientContent({
              turns: [{ role: 'user', parts: [{ text: `[SYSTEM: I just studied ${url}. Here's a summary of what I learned: ${summary || 'Content was saved to memory.'}. Please acknowledge to the user that you've memorized this page.]` }] }],
              turnComplete: true
            });
          });
        } catch (e: any) {
          clearPipelineAction();
          console.error('[CLIENT study] Error:', e.message);
          toast.error(`Failed to study: ${e.message}`);
          // Still tell Jarvis
          sessionRef.current?.then((session: any) => {
            session.sendClientContent({
              turns: [{ role: 'user', parts: [{ text: `[SYSTEM: I tried to study ${url} but it failed with error: ${e.message}. Please inform the user.]` }] }],
              turnComplete: true
            });
          });
        }
      })();
      return; // Don't send the original text to Gemini
    }

    // Normal text message — send via sendClientContent
    sessionRef.current.then((session: any) => {
      session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: text }] }], turnComplete: true });
    }).catch(() => {});
  }, [isSessionReady]);

  return {
    isConnecting,
    isConnected,
    isSessionReady,
    isListening,
    isSpeaking,
    transcript,
    volume,
    pipelineActivity,
    startSession,
    stopSession,
    endSession,
    micActive: isMicActive,
    isTexting: false,
    setIsTexting: (() => {}) as any,
    toggleMic,
    sendTextMessage,
    sendSystemUpdate,
    currentSessionId,
    chatMessages,
    loadSession,
    tradingMode,
  };
}

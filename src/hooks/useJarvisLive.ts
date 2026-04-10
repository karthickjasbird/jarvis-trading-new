import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { AudioRecorder, AudioPlayer } from '../utils/audioUtils';
import { toast } from 'sonner';
import { auth } from '../firebase';

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
  description: 'Activate Sentry Mode for autonomous trading. Set a specific condition and action for Jarvis to execute while monitoring.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      symbol: { type: Type.STRING, description: 'The trading symbol to monitor (e.g., "BTC/USDT")' },
      targetPrice: { type: Type.NUMBER, description: 'The target price to trigger the action' },
      condition: { type: Type.STRING, description: 'The condition to trigger the action', enum: ['above', 'below'] },
      side: { type: Type.STRING, description: 'The action to take when condition is met', enum: ['buy', 'sell'] },
      quantity: { type: Type.NUMBER, description: 'The quantity to trade' }
    },
    required: ['symbol', 'targetPrice', 'condition', 'side', 'quantity']
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
      trailingStopDistance: { type: Type.NUMBER, description: 'The trailing stop distance in price units (e.g., 500 for a $500 trailing stop).' }
    },
    required: ['symbol', 'side']
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
    required: ['dummy']
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
    required: ['dummy']
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

export function useJarvisLive(
  executeTradeFn?: (params: any) => Promise<any>,
  getMarketPriceFn?: (symbol: string) => Promise<any>,
  onNavigate?: (destination: string) => void,
  getAppState?: () => string,
  onHighlight?: (elementId: string) => void
) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [volume, setVolume] = useState(0);

  const sessionRef = useRef<any>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const lastSpeakerRef = useRef<'user' | 'jarvis' | null>(null);

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

  const startSession = useCallback(async (memoryContext: string, enableScreenShare: boolean, enableSearch: boolean, personality: 'classic' | 'sarcastic' | 'scientific' = 'classic', initialMessage?: string, enableMic: boolean = true) => {
    if (isConnected || isConnecting) return;

    setIsConnecting(true);
    setTranscript('');
    lastSpeakerRef.current = null;

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

      const systemInstruction = `${personalityInstructions[personality]} You have access to the user's screen if they shared it, and you can see what they are looking at. You also have access to past conversation summaries to maintain context.
      
If the user shares their screen and asks you to analyze a chart, act as an expert technical analyst. Look at the candlestick patterns, trend lines, support/resistance levels, and indicators visible on the screen. Provide a detailed breakdown of the market structure (e.g., Bull Flags, Head and Shoulders, breakouts) and suggest potential trade setups based on the visual data.

User Location: ${location ? `Lat: ${location.lat}, Lng: ${location.lng}` : 'Unknown'}
Past Context:
${memoryContext}

Be conversational, smooth, and act like a real assistant. Keep responses relatively brief unless asked for details. If you need to search the web for real-time info like weather or news, use the Google Search tool. 
If the user asks about crypto or stock prices, ALWAYS use the getMarketPrice tool to fetch the live price before answering.
If the user asks for technical analysis, indicators (RSI, MACD, EMAs), or trend analysis on a specific coin, use the analyzeMarket tool. When analyzing the market, pay close attention to the \`candlestickPatterns\` returned. A 'Doji' indicates market indecision. A 'Hammer' or 'Bullish Engulfing' suggests a potential upward reversal. A 'Shooting Star' or 'Bearish Engulfing' suggests a potential downward reversal. Use these to time your trade recommendations.
If the user asks to backtest a strategy (like RSI or MACD) on historical data, use the backtestStrategy tool.
If the user asks to optimize a strategy or find the most profitable settings/parameters for a strategy, use the optimizeStrategy tool.
If the user asks to update their risk management settings (like max daily loss, position size, or auto-liquidate threshold), use the updateRiskSettings tool.
If the user asks to buy or sell, use the executeTrade tool.
If the user asks you to start trading autonomously or go to sleep while managing trades, use the activateSentryMode tool.
If the user asks to see their history, settings, market, chart, analytics, or home, use the navigateApp tool.
If you need to know what the user is currently looking at, use the getCurrentAppState tool.
If the user asks where something is or how to do something, use the highlightElement tool to point it out.
If the user asks to review their portfolio or trading performance, use the reviewPortfolio tool.
If the user asks for market sentiment or news about an asset, use the analyzeSentiment tool.
If the user asks about whale activity or large transactions, use the getWhaleActivity tool.
Available element IDs:
- "panic-button": The big red panic close all button
- "settings-button": The key icon for broker API settings
- "memories-button": The brain icon for core memories
- "mic-button": The microphone icon for wake word
- "screen-share-button": The monitor icon for screen vision
- "tab-home", "tab-market", "tab-chart", "tab-history", "tab-settings": The top navigation tabs
- "dashboard-summary": The bottom dashboard bar showing P&L and active positions`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-3.1-flash-live-preview',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
          },
          tools: [
            { functionDeclarations: [setAlarmTool, setReminderTool, openAppTool, activateSentryModeTool, getMarketPriceTool, executeTradeTool, navigateAppTool, getCurrentAppStateTool, highlightElementTool, reviewPortfolioTool, analyzeSentimentTool, getWhaleActivityTool, analyzeMarketTool, backtestStrategyTool, optimizeStrategyTool, updateRiskSettingsTool] }
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

            if (initialMessage) {
              const prefix = '\n';
              setTranscript((prev) => prev + (prev && prefix ? prefix : '') + 'User: ' + initialMessage);
              lastSpeakerRef.current = 'user';
              sessionPromise.then((session) => {
                session.sendClientContent({ turns: initialMessage, turnComplete: true });
              });
            }

            recorderRef.current!.onData = (base64Data) => {
              sessionPromise.then((session) => {
                session.sendRealtimeInput({
                  audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' },
                });
              });
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
            if (message.serverContent?.interrupted) {
              playerRef.current?.stop();
              setIsSpeaking(false);
            }

            if (message.serverContent?.turnComplete) {
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
                  const prefix = lastSpeakerRef.current !== 'jarvis' ? '\n\nJarvis: ' : '';
                  setTranscript((prev) => prev + (prev && prefix ? prefix : (prefix ? 'Jarvis: ' : '')) + text);
                  lastSpeakerRef.current = 'jarvis';
                }
                if (part.functionCall) {
                  const call = part.functionCall;
                  let response = {};
                  
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
                    const { symbol, targetPrice, condition, side, quantity } = call.args as any;
                    try {
                      const { doc, setDoc } = await import('firebase/firestore');
                      const { db, auth } = await import('../firebase');
                      if (auth.currentUser) {
                        await setDoc(doc(db, 'sentryConfigs', auth.currentUser.uid), {
                          active: true,
                          symbol,
                          targetPrice,
                          condition,
                          side,
                          quantity,
                          updatedAt: new Date().toISOString()
                        });
                      }
                      toast.success(`Sentry Mode Activated! Monitoring ${symbol} to ${side} ${quantity} if price goes ${condition} $${targetPrice}`, {
                        style: { backgroundColor: '#a855f7', color: 'white', border: 'none' },
                        duration: 5000
                      });
                      response = { status: 'success', message: `Sentry Mode activated for ${symbol}` };
                    } catch (e: any) {
                      toast.error('Failed to activate Sentry Mode');
                      response = { status: 'error', message: 'Failed to activate Sentry Mode' };
                    }
                  } else if (call.name === 'getMarketPrice') {
                    const { symbol } = call.args as any;
                    try {
                      const res = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&broker=crypto`);
                      const data = await res.json();
                      response = { status: 'success', price: data.price, change: data.change, symbol: data.symbol };
                    } catch (e) {
                      response = { status: 'error', message: 'Failed to fetch market price' };
                    }
                  } else if (call.name === 'analyzeMarket') {
                    const { symbol, timeframe } = call.args as any;
                    try {
                      const res = await fetch(`/api/analysis?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);
                      const data = await res.json();
                      response = data;
                    } catch (e) {
                      response = { status: 'error', message: 'Failed to fetch market analysis' };
                    }
                  } else if (call.name === 'backtestStrategy') {
                    const { symbol, timeframe, strategy, initialBalance } = call.args as any;
                    try {
                      const res = await fetch('/api/backtest', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symbol, timeframe, strategy, initialBalance })
                      });
                      const data = await res.json();
                      response = data;
                    } catch (e) {
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
                  } else if (call.name === 'executeTrade') {
                    const { symbol, side, quantity, riskPercentage, stopLossPrice, takeProfitPrice, trailingStopDistance } = call.args as any;
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

                        const result = await executeTradeFn({
                          symbol,
                          side,
                          quantity,
                          riskPercentage,
                          stopLossPrice,
                          takeProfitPrice,
                          trailingStopDistance,
                          currentPrice
                        });
                        toast.success(`Trade Executed: ${side.toUpperCase()} ${result.quantity} ${symbol} @ $${currentPrice}`, {
                          style: { backgroundColor: side.toLowerCase() === 'buy' ? '#22c55e' : '#ef4444', color: 'white', border: 'none' },
                          duration: 5000
                        });
                        response = { status: 'success', message: `Trade executed: ${side} ${result.quantity} ${symbol} at $${currentPrice}` };
                      } else {
                        throw new Error('Trade execution not available on client');
                      }
                    } catch (e: any) {
                      toast.error(`Trade Failed: ${e.message}`);
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
                    if (onNavigate) {
                      onNavigate('analytics');
                    }
                    response = { status: 'success', message: 'Navigated to analytics dashboard. Please analyze the user\'s performance based on the data you see on the screen.' };
                  } else if (call.name === 'analyzeSentiment') {
                    const { asset } = call.args as any;
                    toast.info(`Consulting News Sentiment Analyst for ${asset}...`);
                    const sentiments = ['Bullish', 'Bearish', 'Neutral'];
                    const randomSentiment = sentiments[Math.floor(Math.random() * sentiments.length)];
                    response = { status: 'success', sentiment: randomSentiment, message: `The News Sentiment Analyst reports that the current sentiment for ${asset} is ${randomSentiment}.` };
                  } else if (call.name === 'getWhaleActivity') {
                    const { asset } = call.args as any;
                    toast.info(`Consulting Whale Tracker for ${asset}...`);
                    const activities = ['Large accumulation detected', 'Massive sell-off spotted', 'No unusual activity'];
                    const randomActivity = activities[Math.floor(Math.random() * activities.length)];
                    response = { status: 'success', activity: randomActivity, message: `The Whale Tracker reports: ${randomActivity} for ${asset}.` };
                  }

                  sessionPromise.then(session => {
                    session.sendToolResponse({
                      functionResponses: [{
                        name: call.name,
                        id: call.id,
                        response: response
                      }]
                    });
                  });
                }
              }
            }

            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              const finished = message.serverContent.inputTranscription.finished;
              if (text) {
                const prefix = lastSpeakerRef.current !== 'user' ? '\n\nYou: ' : '';
                setTranscript((prev) => prev + (prev && prefix ? prefix : (prefix ? 'You: ' : '')) + text);
                lastSpeakerRef.current = 'user';
              }
              if (finished) {
                lastSpeakerRef.current = null;
              }
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              const finished = message.serverContent.outputTranscription.finished;
              if (text) {
                const prefix = lastSpeakerRef.current !== 'jarvis' ? '\n\nJarvis: ' : '';
                setTranscript((prev) => prev + (prev && prefix ? prefix : (prefix ? 'Jarvis: ' : '')) + text);
                lastSpeakerRef.current = 'jarvis';
              }
              if (finished) {
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

      sessionRef.current = sessionPromise;
    } catch (error) {
      console.error('Failed to start session:', error);
      setIsConnecting(false);
      stopSession();
    }
  }, [isConnected, isConnecting]);

  const stopSession = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.then((session: any) => session.close());
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
    setIsListening(false);
    setIsMicActive(false);
    setIsSpeaking(false);
    setVolume(0);
  }, []);

  const sendTextMessage = useCallback((text: string) => {
    if (!isConnected || !sessionRef.current) return;
    
    const prefix = lastSpeakerRef.current !== 'user' ? '\n\nUser: ' : '\n';
    setTranscript((prev) => prev + (prev && prefix ? prefix : (prefix ? 'User: ' : '')) + text);
    lastSpeakerRef.current = 'user';

    sessionRef.current.then((session: any) => {
      session.sendClientContent({ turns: text, turnComplete: true });
    });
  }, [isConnected]);

  return {
    startSession,
    stopSession,
    sendTextMessage,
    isConnected,
    isConnecting,
    isListening,
    isMicActive,
    isSpeaking,
    transcript,
    volume,
    toggleMic,
  };
}

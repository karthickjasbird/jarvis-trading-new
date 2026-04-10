import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, MonitorUp, MonitorOff, BrainCircuit, X, Globe, Palette, LogOut, Settings, ArrowUpRight, ArrowDownRight, Send, ShieldAlert, FlaskConical } from 'lucide-react';
import { Orb, OrbVariant } from './components/Orb';
import { useWakeWord } from './hooks/useWakeWord';
import { useJarvisLive } from './hooks/useJarvisLive';
import { memoryService } from './services/memoryService';
import { Toaster } from 'sonner';
import { Login } from './components/Login';
import { BrokerSettings } from './components/BrokerSettings';
import { LiveMarketData } from './components/LiveMarketData';
import { Dashboard } from './components/Dashboard';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { BacktestSimulator } from './components/BacktestSimulator';
import { RiskManager } from './components/RiskManager';
import { useTrades } from './hooks/useTrades';
import { useMarketIntel } from './hooks/useMarketIntel';
import { auth } from './firebase';
import { User } from 'firebase/auth';

import { TradingViewChart } from './components/TradingViewChart';
import { TimeMachineControls } from './components/TimeMachineControls';
import { ReplayChart } from './components/ReplayChart';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [showBrokerSettings, setShowBrokerSettings] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(true);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [personality, setPersonality] = useState<'classic' | 'sarcastic' | 'scientific'>('classic');
  const [orbVariant, setOrbVariant] = useState<OrbVariant>('liquid');
  const [showMemories, setShowMemories] = useState(false);
  const [memories, setMemories] = useState(memoryService.getMemories());
  const [appState, setAppState] = useState<'home' | 'market' | 'history' | 'settings' | 'chart' | 'analytics' | 'backtest' | 'risk'>('home');
  const [textInput, setTextInput] = useState('');
  const [isPracticeMode, setIsPracticeMode] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayConfig, setReplayConfig] = useState<{date: string, speed: number} | null>(null);

  const { positions, tradeHistory, dailyPnl, portfolio, sentryConfig, sentryLogs, closePosition, panicCloseAll, executeTrade, isLoading } = useTrades(user?.uid || '', isPracticeMode);
  const { news, whaleAlerts } = useMarketIntel();

  const handleNavigate = useCallback((destination: string) => {
    if (['home', 'market', 'history', 'settings', 'chart', 'analytics', 'backtest', 'risk'].includes(destination)) {
      setAppState(destination as any);
      if (destination === 'settings') {
        setShowBrokerSettings(true);
      } else {
        setShowBrokerSettings(false);
      }
    }
  }, []);

  const getAppState = useCallback(() => {
    return JSON.stringify({
      appState,
      portfolio,
      openPositions: positions,
      sentryStatus: sentryConfig?.active ? 'Active' : 'Inactive',
      recentTrades: tradeHistory.slice(0, 5),
      marketIntel: { news: news.slice(0, 3), whaleAlerts: whaleAlerts.slice(0, 3) }
    });
  }, [appState, portfolio, positions, sentryConfig, tradeHistory, news, whaleAlerts]);

  const handleHighlight = useCallback((elementId: string) => {
    const el = document.getElementById(elementId);
    if (el) {
      el.classList.add('ghost-highlight');
      setTimeout(() => {
        el.classList.remove('ghost-highlight');
      }, 5000);
    }
  }, []);

  const {
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
  } = useJarvisLive(executeTrade, undefined, handleNavigate, getAppState, handleHighlight);

  const transcriptRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const handleWake = useCallback(() => {
    if (!isConnected && !isConnecting) {
      const context = memoryService.getFormattedContext({ news, whaleAlerts });
      startSession(context, screenShareEnabled, searchEnabled, personality, undefined, true);
    } else if (isConnected) {
      toggleMic();
    }
  }, [isConnected, isConnecting, screenShareEnabled, searchEnabled, personality, startSession, toggleMic, news, whaleAlerts]);

  const { startListening, stopListening, isListening: isWakeWordListening, error: wakeWordError } = useWakeWord('jarvis', handleWake);

  useEffect(() => {
    if (wakeWordError) {
      setWakeWordEnabled(false);
    }
  }, [wakeWordError]);

  useEffect(() => {
    if (wakeWordEnabled && !isConnected && !isConnecting) {
      const stop = startListening();
      return () => {
        if (stop) stop();
      };
    } else {
      stopListening();
    }
  }, [wakeWordEnabled, isConnected, isConnecting, startListening, stopListening]);

  // Save memory when session ends
  const prevIsConnected = useRef(isConnected);
  useEffect(() => {
    if (prevIsConnected.current && !isConnected && transcript) {
      memoryService.summarizeAndSave(transcript).then(() => {
        setMemories(memoryService.getMemories());
      });
    }
    prevIsConnected.current = isConnected;
  }, [isConnected, transcript]);

  const getOrbState = () => {
    if (isConnecting) return 'connecting';
    if (isSpeaking) return 'speaking';
    if (isMicActive) return 'listening';
    return 'idle';
  };

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <div className={`min-h-screen ${isPracticeMode ? 'bg-zinc-950' : 'bg-zinc-950'} text-zinc-100 flex flex-col items-center justify-center relative overflow-hidden font-sans transition-colors duration-500`}>
      <Toaster theme="dark" position="top-center" />
      {/* Background ambient glow */}
      <div className={`absolute inset-0 bg-[radial-gradient(circle_at_center,${isPracticeMode ? 'rgba(245,158,11,0.05)' : 'rgba(0,150,255,0.05)'}_0%,transparent_70%)] pointer-events-none transition-colors duration-1000`} />
      
      {/* Practice Mode Watermark */}
      <AnimatePresence>
        {isPracticeMode && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[15vw] font-black text-amber-500/5 pointer-events-none whitespace-nowrap z-0 select-none"
          >
            PRACTICE
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header Controls */}
      <div className="absolute top-0 left-0 right-0 p-6 z-20 flex items-center justify-between pointer-events-none">
        
        {/* Left: Panic Button & Practice Toggle */}
        <div className="pointer-events-auto flex items-center gap-3 flex-shrink-0">
          <button
            id="panic-button"
            onClick={async () => {
              import('sonner').then(({ toast }) => {
                toast.error('PANIC INITIATED: Liquidating all open positions across all markets...', {
                  style: { backgroundColor: '#ef4444', color: 'white', border: 'none' },
                  duration: 5000
                });
              });
              if (user?.uid) {
                try {
                  const results = await panicCloseAll();
                  const closedCount = results.length;
                  if (closedCount > 0) {
                    import('sonner').then(({ toast }) => toast.success(`Successfully closed ${closedCount} positions.`));
                  } else {
                    import('sonner').then(({ toast }) => toast.info('No open positions to close.'));
                  }
                } catch (err) {
                  console.error('Panic close failed', err);
                  import('sonner').then(({ toast }) => toast.error('Failed to close some positions. Check dashboard.'));
                }
              }
            }}
            className="group p-3 rounded-xl bg-red-600/90 hover:bg-red-500 border border-red-500/50 text-white font-bold tracking-wider shadow-[0_0_30px_rgba(239,68,68,0.3)] transition-all hover:shadow-[0_0_50px_rgba(239,68,68,0.5)] flex items-center gap-2 overflow-hidden"
            title="PANIC CLOSE ALL"
          >
            <X className="w-5 h-5 flex-shrink-0" />
            <span className="max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 transition-all duration-300 ease-in-out whitespace-nowrap">
              PANIC CLOSE ALL
            </span>
          </button>

          <button
            onClick={() => setIsPracticeMode(!isPracticeMode)}
            className={`group p-3 rounded-xl border transition-all flex items-center gap-2 overflow-hidden ${
              isPracticeMode
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.2)]'
                : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
            }`}
            title={isPracticeMode ? 'Practice Mode Active' : 'Enable Practice Mode'}
          >
            <FlaskConical className="w-5 h-5 flex-shrink-0" />
            <span className={`max-w-0 opacity-0 group-hover:max-w-xs group-hover:opacity-100 transition-all duration-300 ease-in-out whitespace-nowrap font-medium ${isPracticeMode ? 'text-amber-400' : 'text-zinc-300'}`}>
              {isPracticeMode ? 'PRACTICE MODE' : 'ENTER PRACTICE'}
            </span>
          </button>
        </div>

        {/* Center: Navigation */}
        <div className="pointer-events-auto flex items-center gap-1 bg-zinc-900/80 backdrop-blur-md border border-zinc-800 p-1.5 rounded-full mx-4 overflow-x-auto hide-scrollbar">
          {(['home', 'market', 'chart', 'analytics', 'backtest', 'risk', 'history'] as const).map((tab) => (
            <button
              key={tab}
              id={`tab-${tab}`}
              onClick={() => handleNavigate(tab)}
              className={`px-4 py-2 rounded-full text-sm font-medium capitalize transition-all whitespace-nowrap ${
                appState === tab
                  ? 'bg-zinc-100 text-zinc-900 shadow-md'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Right: Controls */}
        <div className="pointer-events-auto flex items-center gap-3 flex-shrink-0">
          <button
            id="settings-button"
            onClick={() => setShowBrokerSettings(true)}
            className="p-3 rounded-full bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-800 transition-colors text-zinc-400"
            title="Settings & Preferences"
          >
            <Settings className="w-5 h-5" />
          </button>
          
          <button
            id="memories-button"
            onClick={() => {
              setMemories(memoryService.getMemories());
              setShowMemories(true);
            }}
            className="p-3 rounded-full bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-800 transition-colors"
            title="View Memories"
          >
            <BrainCircuit className="w-5 h-5 text-zinc-400" />
          </button>

          <button
            id="mic-button"
            onClick={() => setWakeWordEnabled(!wakeWordEnabled)}
            className={`p-3 rounded-full border transition-colors ${
              wakeWordEnabled
                ? 'bg-green-500/20 border-green-500/50 text-green-400'
                : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
            }`}
            title={wakeWordEnabled ? 'Wake Word Enabled' : 'Enable Wake Word'}
          >
            {wakeWordEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>

          <button
            onClick={() => setSearchEnabled(!searchEnabled)}
            className={`p-3 rounded-full border transition-colors ${
              searchEnabled
                ? 'bg-orange-500/20 border-orange-500/50 text-orange-400'
                : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
            }`}
            title={searchEnabled ? 'Search Grounding Enabled' : 'Enable Search Grounding'}
          >
            <Globe className="w-5 h-5" />
          </button>

          <button
            id="screen-share-button"
            onClick={() => setScreenShareEnabled(!screenShareEnabled)}
            className={`p-3 rounded-full border transition-colors ${
              screenShareEnabled
                ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
            }`}
            title={screenShareEnabled ? 'Screen Vision Enabled' : 'Enable Screen Vision'}
          >
            {screenShareEnabled ? <MonitorUp className="w-5 h-5" /> : <MonitorOff className="w-5 h-5" />}
          </button>

          <button
            id="logout-button"
            onClick={() => auth.signOut().then(() => setUser(null))}
            className="p-3 rounded-full bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-800 transition-colors text-zinc-400"
            title="Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showBrokerSettings && (
          <BrokerSettings 
            user={user} 
            onClose={() => setShowBrokerSettings(false)} 
            personality={personality}
            setPersonality={setPersonality}
            orbVariant={orbVariant}
            setOrbVariant={setOrbVariant}
          />
        )}
      </AnimatePresence>

      {/* Live Market Data Matrix */}
      <AnimatePresence mode="wait">
        {appState === 'market' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute inset-0 flex items-center justify-center z-10 pt-20 pb-32"
          >
            <div className="flex flex-wrap items-center justify-center gap-6 p-6 overflow-y-auto w-full h-full">
              <LiveMarketData symbol="BTC/USDT" broker="crypto" replayDate={replayConfig?.date} speed={replayConfig?.speed} />
              <LiveMarketData symbol="ETH/USDT" broker="crypto" replayDate={replayConfig?.date} speed={replayConfig?.speed} />
              <LiveMarketData symbol="RELIANCE" broker="zerodha" replayDate={replayConfig?.date} speed={replayConfig?.speed} />
              <LiveMarketData symbol="SOL/USDT" broker="crypto" replayDate={replayConfig?.date} speed={replayConfig?.speed} />
            </div>
          </motion.div>
        )}

        {appState === 'chart' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute inset-0 flex items-center justify-center z-10 pt-24 pb-32 px-6"
          >
            <div className="w-full max-w-6xl h-[70vh] bg-zinc-950 rounded-xl border border-zinc-800 shadow-2xl overflow-hidden">
              {isPracticeMode && isReplaying ? (
                <ReplayChart symbol="BTCUSDT" broker="crypto" replayDate={replayConfig?.date} speed={replayConfig?.speed} />
              ) : (
                <TradingViewChart symbol="BINANCE:BTCUSDT" />
              )}
            </div>
          </motion.div>
        )}

        {appState === 'analytics' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute inset-0 flex flex-col items-center z-10 pt-32 pb-32 px-6 overflow-y-auto"
          >
            <AnalyticsDashboard tradeHistory={tradeHistory} dailyPnl={dailyPnl} />
          </motion.div>
        )}

        {appState === 'backtest' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute inset-0 flex flex-col items-center z-10 pt-32 pb-32 px-6 overflow-y-auto"
          >
            <BacktestSimulator />
          </motion.div>
        )}

        {appState === 'risk' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute inset-0 flex flex-col items-center z-10 pt-32 pb-32 px-6 overflow-y-auto"
          >
            <RiskManager userId={user.uid} />
          </motion.div>
        )}

        {appState === 'history' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute inset-0 flex flex-col items-center z-10 pt-32 pb-32 px-6 overflow-y-auto"
          >
            <div className="w-full max-w-4xl bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 backdrop-blur-md">
              <h2 className="text-2xl font-light text-zinc-100 mb-6">Trade History</h2>
              {tradeHistory.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">No trade history available.</div>
              ) : (
                <div className="space-y-3">
                  {tradeHistory.map(trade => (
                    <div key={trade.id} className="flex items-center justify-between p-4 rounded-xl bg-zinc-950/50 border border-zinc-800/50">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${trade.side === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                          {trade.side === 'buy' ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                        </div>
                        <div>
                          <div className="font-bold text-zinc-200">{trade.symbol}</div>
                          <div className="text-xs text-zinc-500">{new Date(trade.closedAt || trade.createdAt).toLocaleString()}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono font-bold ${trade.pnl && trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {trade.pnl && trade.pnl >= 0 ? '+' : ''}{trade.pnl?.toFixed(2)}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {trade.quantity} @ ${trade.entryPrice} → ${trade.exitPrice}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Main Content (Home) */}
        {appState === 'home' && (
          <motion.main 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center w-full max-w-3xl mx-auto px-6 z-10 h-full pt-20 pb-32"
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="mb-12"
            >
              <h1 className="text-4xl font-light tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-zinc-100 to-zinc-500 uppercase">
                Jarvis
              </h1>
            </motion.div>

            <div className="mb-8 cursor-pointer" onClick={handleWake}>
              <Orb state={getOrbState()} volume={volume} variant={orbVariant} />
            </div>

            {/* Real-time Transcript */}
            <div className="w-full max-w-xl h-32 mb-4 relative">
              <div 
                ref={transcriptRef}
                className="w-full h-full overflow-y-auto p-4 rounded-xl bg-zinc-900/30 border border-zinc-800/50 backdrop-blur-sm scrollbar-hide"
              >
                <AnimatePresence mode="popLayout">
                  {transcript ? (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-sm font-mono text-zinc-400 leading-relaxed whitespace-pre-wrap"
                    >
                      {transcript}
                    </motion.p>
                  ) : (
                    <p className="text-xs font-mono text-zinc-600 text-center mt-8 italic">
                      {isConnected ? "Waiting for response..." : ""}
                    </p>
                  )}
                </AnimatePresence>
              </div>
              {/* Gradient mask for top/bottom fade */}
              <div className="absolute inset-0 pointer-events-none rounded-xl ring-1 ring-inset ring-zinc-800/20 shadow-[inset_0_8px_16px_-8px_rgba(0,0,0,0.5),inset_0_-8px_16px_-8px_rgba(0,0,0,0.5)]" />
            </div>

            {/* Text Input Field - ALWAYS VISIBLE */}
            <form 
              className="w-full max-w-xl mb-8 relative"
              onSubmit={(e) => {
                e.preventDefault();
                if (textInput.trim()) {
                  if (isConnected) {
                    sendTextMessage(textInput.trim());
                  } else {
                    const context = memoryService.getFormattedContext();
                    startSession(context, screenShareEnabled, searchEnabled, personality, textInput.trim(), false);
                  }
                  setTextInput('');
                }
              }}
            >
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Ask Jarvis..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 pl-6 pr-24 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 transition-all shadow-lg"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleWake}
                  className={`p-2 rounded-full transition-colors ${
                    isMicActive 
                      ? 'text-cyan-400 bg-cyan-500/10' 
                      : 'text-zinc-400 hover:text-cyan-400 hover:bg-cyan-500/10'
                  }`}
                  title={isMicActive ? "Mute Microphone" : "Start Voice Session"}
                >
                  {isMicActive ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                </button>
                <button
                  type="submit"
                  disabled={!textInput.trim()}
                  className="p-2 rounded-full text-zinc-400 hover:text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-50 disabled:hover:text-zinc-400 disabled:hover:bg-transparent transition-colors"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </form>

            {/* Status Text */}
            <div className="h-12 flex items-center justify-center">
              <AnimatePresence mode="wait">
                {!isConnected && !isConnecting && (
                  <motion.p
                    key="idle"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="text-zinc-500 font-mono text-sm tracking-wider"
                  >
                    {wakeWordError ? `Error: ${wakeWordError}` : (wakeWordEnabled ? 'Say "Jarvis" or tap orb to wake' : 'Tap orb to wake or enable mic')}
                  </motion.p>
                )}
                {isConnecting && (
                  <motion.p
                    key="connecting"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="text-cyan-400 font-mono text-sm tracking-wider animate-pulse"
                  >
                    Connecting to core...
                  </motion.p>
                )}
                {isConnected && (
                  <motion.div
                    key="active"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex flex-col items-center gap-4"
                  >
                    <p className="text-zinc-300 font-mono text-sm tracking-wider">
                      {isSpeaking ? 'Jarvis is speaking...' : (isMicActive ? 'Listening...' : 'Connected')}
                    </p>
                    <button
                      onClick={stopSession}
                      className="px-6 py-2 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors text-sm font-medium tracking-wide"
                    >
                      End Session
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.main>
        )}
      </AnimatePresence>

      {/* Time Machine Controls (Practice Mode Only) */}
      <AnimatePresence>
        {isPracticeMode && (appState === 'market' || appState === 'chart') && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40"
          >
            <TimeMachineControls 
              isReplaying={isReplaying}
              onStartReplay={(date, speed) => {
                setReplayConfig({ date, speed });
                setIsReplaying(true);
              }}
              onStopReplay={() => {
                setReplayConfig(null);
                setIsReplaying(false);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Memories Modal */}
      <AnimatePresence>
        {showMemories && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden shadow-2xl"
            >
              <div className="flex items-center justify-between p-6 border-b border-zinc-800">
                <h2 className="text-xl font-medium text-zinc-100 flex items-center gap-2">
                  <BrainCircuit className="w-5 h-5 text-blue-400" />
                  Core Memories
                </h2>
                <button
                  onClick={() => setShowMemories(false)}
                  className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto flex-1 space-y-4">
                {memories.length === 0 ? (
                  <p className="text-zinc-500 text-center py-8">No memories stored yet.</p>
                ) : (
                  memories.map((memory) => (
                    <div key={memory.id} className="bg-zinc-950/50 border border-zinc-800/50 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        {memory.type === 'trade_lesson' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            TRADE LESSON
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                            CONVERSATION
                          </span>
                        )}
                        <p className="text-xs text-zinc-500 font-mono">
                          {new Date(memory.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <p className="text-sm text-zinc-300 leading-relaxed">
                        {memory.summary}
                      </p>
                    </div>
                  ))
                )}
              </div>
              
              {memories.length > 0 && (
                <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 flex justify-end">
                  <button
                    onClick={() => {
                      memoryService.clearMemories();
                      setMemories([]);
                    }}
                    className="text-xs text-red-400 hover:text-red-300 px-4 py-2 rounded-lg hover:bg-red-400/10 transition-colors"
                  >
                    Clear All Memories
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dashboard 
        positions={positions}
        tradeHistory={tradeHistory}
        dailyPnl={dailyPnl}
        portfolio={portfolio}
        sentryConfig={sentryConfig}
        sentryLogs={sentryLogs}
        onClosePosition={closePosition}
        isLoading={isLoading}
      />
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MonitorUp, MonitorOff, BrainCircuit, X, Globe, Palette, LogOut, Settings, ArrowUpRight, ArrowDownRight, Send, ShieldAlert, FlaskConical, Cpu, Zap, Trash2, Loader2, Menu, ChevronDown, MoreVertical, Brain, BarChart2, Activity, Target, TrendingUp, TrendingDown, AlertTriangle, Newspaper, Clock } from 'lucide-react';
import { Orb, OrbVariant } from './components/Orb';
import { ActivityPipeline } from './components/ActivityPipeline';
import { useJarvisLive } from './hooks/useJarvisLive';
import { memoryService } from './services/memoryService';
import { Toaster, toast } from 'sonner';
import { Login } from './components/Login';
import { BrokerSettings } from './components/BrokerSettings';
import { LiveMarketData } from './components/LiveMarketData';
import { MarketWatchlist } from './components/MarketWatchlist';
import { HomeInsights } from './components/HomeInsights';
import { Dashboard } from './components/Dashboard';
import ChatSidebar from './components/ChatSidebar';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';

import { RiskManager } from './components/RiskManager';
import { JarvisBrain } from './components/JarvisBrain';
import { JarvisMemories } from './components/JarvisMemories';
import { TradeDiary } from './components/TradeDiary';
import { useTrades } from './hooks/useTrades';
import { useMarketIntel } from './hooks/useMarketIntel';
import { auth } from './firebase';
import { User } from 'firebase/auth';

import { TradingViewChart } from './components/TradingViewChart';
import { TimeMachineControls } from './components/TimeMachineControls';
import { ReplayChart } from './components/ReplayChart';
import { LiveJarvisChart } from './components/LiveJarvisChart';
import { MaintenanceBanner } from './components/MaintenanceBanner';
import { UpdateBanner } from './components/UpdateBanner';
import { OnboardingWizard } from './components/OnboardingWizard';

// Maps an app symbol to a TradingView widget symbol. Crypto → BINANCE: prefix;
// stocks/commodities → bare ticker (the TV widget resolves AAPL/TSLA/GLD itself).
function toTradingViewSymbol(symbol: string, assetClass?: string): string {
  const isCrypto = assetClass === 'crypto' || symbol.includes('/') || /USDT?$/i.test(symbol);
  return isCrypto ? `BINANCE:${symbol.replace('/', '').toUpperCase()}` : symbol.toUpperCase();
}

function isCryptoTvSymbol(tv: string): boolean {
  return tv.startsWith('BINANCE:');
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [showBrokerSettings, setShowBrokerSettings] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(true);
  const [personality, setPersonality] = useState<'classic' | 'sarcastic' | 'scientific'>('classic');
  const [orbVariant, setOrbVariant] = useState<OrbVariant>('liquid');
  const [showMemories, setShowMemories] = useState(false);
  const [memories, setMemories] = useState(memoryService.getMemories());
  const [isFetchingMemories, setIsFetchingMemories] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Onboarding gate: check if user has provided their own Gemini key
  const [hasGeminiKey, setHasGeminiKey] = useState<boolean | null>(null); // null = loading
  const [onboardingKey, setOnboardingKey] = useState('');
  const [savingOnboardingKey, setSavingOnboardingKey] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    const checkKeys = async () => {
      try {
        const res = await fetch(`/api/secrets/${user.uid}`);
        const data = await res.json();
        setHasGeminiKey(data.secrets?.hasGemini ?? false);
      } catch {
        setHasGeminiKey(false);
      }
    };
    checkKeys();
  }, [user?.uid]);

  const saveOnboardingKey = async () => {
    if (!user?.uid || !onboardingKey) return;
    setSavingOnboardingKey(true);
    try {
      const res = await fetch(`/api/secrets/${user.uid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geminiApiKey: onboardingKey }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setHasGeminiKey(true);
        toast.success('Welcome to Jarvis! Your AI is now powered by your own key.');
      } else {
        toast.error('Failed to save key');
      }
    } catch {
      toast.error('Connection error');
    } finally {
      setSavingOnboardingKey(false);
    }
  };

  const handleDeleteMemory = async (memoryId: string) => {
    if (!user?.uid) return;
    const success = await memoryService.deleteBackendMemory(user.uid, memoryId);
    if (success) {
      setMemories(prev => prev.filter(m => m.id !== memoryId));
    }
  };
  const [appState, setAppState] = useState<'home' | 'market' | 'history' | 'settings' | 'chart' | 'analytics' | 'risk' | 'brain' | 'memories' | 'diary'>('home');
  const [textInput, setTextInput] = useState('');
  const [isPracticeMode, setIsPracticeMode] = useState(true); // Default to PRACTICE for safety

  // v1.7.0 — system-level safety state (LIVE_TRADING_DISABLED env flag).
  // Separate from isPracticeMode (user toggle) because this is enforced in
  // the trade executor regardless of what the user clicks.
  const [systemSafety, setSystemSafety] = useState<{ liveTradingDisabled: boolean; engine: string; version: string } | null>(null);
  useEffect(() => {
    fetch('/api/system/safety').then(r => r.json()).then(setSystemSafety).catch(() => {});
  }, []);
  const [selectedChartSymbol, setSelectedChartSymbol] = useState('BINANCE:BTCUSDT');
  const [liveVisionEnabled, setLiveVisionEnabled] = useState(false);
  // Sub-tab state lifted here so voice navigation (navigateApp view) can switch them.
  const [marketAssetClass, setMarketAssetClass] = useState<'crypto' | 'stocks' | 'commodities'>('crypto');
  const [dashboardTab, setDashboardTab] = useState<'positions' | 'pending' | 'history' | 'sentry' | 'intel'>('positions');
  const [settingsTab, setSettingsTab] = useState<'brokers' | 'notifications' | 'preferences' | 'apikeys'>('brokers');
  const [showRealModeConfirm, setShowRealModeConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Safe toggle with confirmation when switching to REAL mode
  const togglePracticeMode = () => {
    if (isPracticeMode) {
      // Switching from Practice → Real: show confirmation
      setShowRealModeConfirm(true);
    } else {
      // Switching from Real → Practice: no confirmation needed
      setIsPracticeMode(true);
    }
  };
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayConfig, setReplayConfig] = useState<{date: string, speed: number, symbol: string, jarvisEnabled: boolean} | null>(null);
  const [jarvisAnalysis, setJarvisAnalysis] = useState<any>(null);
  const [jarvisAnalysisLoading, setJarvisAnalysisLoading] = useState(false);
  const jarvisAnalysisSymbolRef = useRef('');

  // Collapsible menu groups
  const [leftMenuOpen, setLeftMenuOpen] = useState(false);
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const [rightMenuOpen, setRightMenuOpen] = useState(false);

  // Model selectors
  const LIVE_MODELS = [
    { id: 'gemini-3.1-flash-live-preview', label: '3.1 Flash Live' },
    { id: 'gemini-2.5-flash-preview-native-audio-dialog', label: '2.5 Flash Audio' },
    { id: 'gemini-2.5-flash-exp-native-audio-thinking-dialog', label: '2.5 Thinking' },
  ];
  const MEM_MODELS = [
    { id: 'gemini-2.0-flash', label: '2.0 Flash' },
    { id: 'gemini-2.5-flash-lite', label: '2.5 Flash Lite' },
    { id: 'gemini-2.5-flash-preview-05-20', label: '2.5 Flash' },
    { id: 'gemma-4-31b-it', label: 'Gemma 4 31B' },
    { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B MoE' },
    { id: 'groq/llama-3.3-70b-versatile', label: '⚡ Llama 3.3 70B' },
    { id: 'groq/llama-3.1-8b-instant', label: '⚡ Llama 3.1 8B' },
    { id: 'groq/meta-llama/llama-4-scout-17b-16e-instruct', label: '⚡ Llama 4 Scout' },
    { id: 'groq/qwen/qwen3-32b', label: '⚡ Qwen3 32B' },
  ];
  const [liveModel, setLiveModel] = useState(() => localStorage.getItem('jarvis-live-model') || 'gemini-3.1-flash-live-preview');
  const [memoryModel, setMemoryModel] = useState(() => localStorage.getItem('jarvis-memory-model') || 'gemini-2.0-flash');
  const [showLiveModelMenu, setShowLiveModelMenu] = useState(false);
  const [showMemModelMenu, setShowMemModelMenu] = useState(false);
  const liveModelRef = useRef<HTMLDivElement>(null);
  const memModelRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (liveModelRef.current && !liveModelRef.current.contains(e.target as Node)) setShowLiveModelMenu(false);
      if (memModelRef.current && !memModelRef.current.contains(e.target as Node)) setShowMemModelMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { positions, pendingTrades, tradeHistory, dailyPnl, portfolio, sentryConfig, sentryLogs, closePosition, panicCloseAll, executeTrade, approveTrade, declineTrade, isLoading } = useTrades(user?.uid || '', isPracticeMode);
  const { news, whaleAlerts } = useMarketIntel();

  const handleNavigate = useCallback((destination: string, symbol?: string, view?: string) => {
    if (['home', 'market', 'history', 'settings', 'chart', 'analytics', 'risk', 'brain', 'memories', 'diary'].includes(destination)) {
      if (destination === 'chart' && symbol) {
        setSelectedChartSymbol(toTradingViewSymbol(symbol));
      }
      setAppState(destination as any);
      if (destination === 'settings') {
        setShowBrokerSettings(true);
      } else {
        setShowBrokerSettings(false);
      }
      // Route an optional sub-tab request to the right surface. Accepts the
      // model's natural words (synonyms mapped) so "open alerts"/"trade history" land.
      if (view) {
        const v = view.toLowerCase();
        if (['crypto', 'stocks', 'commodities'].includes(v)) {
          setMarketAssetClass(v as any);
        } else if (['brokers', 'apikeys', 'api keys', 'notifications', 'alerts', 'preferences', 'style'].includes(v)) {
          setSettingsTab((v === 'api keys' ? 'apikeys' : v === 'alerts' ? 'notifications' : v === 'style' ? 'preferences' : v) as any);
        } else if (['positions', 'pending', 'approvals', 'sentry', 'intel', 'history', 'trades'].includes(v)) {
          setDashboardTab((v === 'approvals' ? 'pending' : v === 'trades' ? 'history' : v) as any);
        }
      }
    }
  }, []);

  const getAppState = useCallback(() => {
    const pageLabels: Record<string, string> = {
      home: 'Home (Dashboard)', market: 'Market Watchlist', chart: 'Chart',
      history: 'Trade History', settings: 'Settings', analytics: 'Analytics',
      risk: 'Risk Manager', brain: 'Jarvis Brain', memories: 'Core Memories', diary: 'Decision Diary',
    };
    const subTab = appState === 'market' ? marketAssetClass
      : appState === 'settings' ? settingsTab
      : appState === 'home' ? `dashboard dock: ${dashboardTab}`
      : appState === 'chart' ? selectedChartSymbol
      : null;
    return JSON.stringify({
      page: pageLabels[appState] || appState,
      activeSubTab: subTab,
      portfolio,
      openPositions: positions,
      sentryStatus: sentryConfig?.active ? 'Active' : 'Inactive',
      recentTrades: tradeHistory.slice(0, 5),
      marketIntel: { news: news.slice(0, 3), whaleAlerts: whaleAlerts.slice(0, 3) }
    });
  }, [appState, marketAssetClass, settingsTab, dashboardTab, selectedChartSymbol, portfolio, positions, sentryConfig, tradeHistory, news, whaleAlerts]);

  const handleHighlight = useCallback((elementId: string) => {
    const el = document.getElementById(elementId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ghost-highlight');
      setTimeout(() => {
        el.classList.remove('ghost-highlight');
      }, 5000);
    }
  }, []);

  const {
    startSession,
    stopSession,
    endSession,
    sendTextMessage,
    sendSystemUpdate,
    isConnected,
    isConnecting,
    isSessionReady,
    isListening,
    isSpeaking,
    transcript,
    volume,
    pipelineActivity,
    micActive,
    isTexting,
    setIsTexting,
    toggleMic,
    currentSessionId,
    chatMessages,
    loadSession,
    tradingMode,
  } = useJarvisLive(executeTrade, closePosition, panicCloseAll, undefined, handleNavigate, getAppState, handleHighlight, memoryModel);

  // Helper: build portfolio snapshot for Jarvis system context
  const getPortfolioSnapshot = useCallback(() => ({
    balance: isPracticeMode ? (portfolio?.paperBalance ?? 100000) : (portfolio?.liveBalance ?? 0),
    todayPnl: dailyPnl?.totalPnl ?? 0,
    openPositions: positions?.length ?? 0,
    realizedPnl: dailyPnl?.realizedPnl ?? 0,
    unrealizedPnl: dailyPnl?.unrealizedPnl ?? 0,
  }), [isPracticeMode, portfolio, dailyPnl, positions]);

  // Helper: build broker status string
  const getBrokerStatus = useCallback(() => {
    if (isPracticeMode) return 'Paper trading mode — no live broker required.';
    if (portfolio?.liveBalance && portfolio.liveBalance > 0) return `Broker connected. Live USDT balance: $${portfolio.liveBalance.toFixed(2)}.`;
    return 'No broker connected. The user needs to configure their exchange API keys in Settings before live trading can work.';
  }, [isPracticeMode, portfolio]);

  // Gap 2: Push mid-session mode changes to Jarvis
  const prevPracticeModeRef = useRef(isPracticeMode);
  useEffect(() => {
    if (prevPracticeModeRef.current !== isPracticeMode && isSessionReady) {
      sendSystemUpdate(`Mode changed to ${isPracticeMode ? 'PRACTICE (Paper Trading)' : 'LIVE (Real Money)'}. All future trades must use isPractice=${isPracticeMode}.`);
    }
    prevPracticeModeRef.current = isPracticeMode;
  }, [isPracticeMode, isSessionReady, sendSystemUpdate]);

  const prevTradingModeRef = useRef(tradingMode);
  useEffect(() => {
    if (prevTradingModeRef.current !== tradingMode && isSessionReady) {
      sendSystemUpdate(`Execution mode changed to ${tradingMode === 'sentry' ? 'SENTRY (Fully Automatic — execute and close without asking)' : 'COPILOT (Ask the user before every trade)'}. Update your behavior immediately.`);
    }
    prevTradingModeRef.current = tradingMode;
  }, [tradingMode, isSessionReady, sendSystemUpdate]);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const transcriptRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  // Builds context + snapshots and opens a Jarvis live session with the CURRENT
  // screen-vision setting. Reused by wake and by the mid-session reconnect effect.
  const connectJarvis = useCallback(async () => {
    const context = await memoryService.getFormattedContext(user?.uid, "user rules, preferences and recent trading behavior", { news, whaleAlerts });
    const portfolioSnapshot = getPortfolioSnapshot();
    const brokerStatus = getBrokerStatus();
    startSession(context, screenShareEnabled, searchEnabled, personality, undefined, true, liveModel, isPracticeMode, tradingMode, portfolioSnapshot, brokerStatus);
    toggleMic(true);
  }, [screenShareEnabled, searchEnabled, personality, startSession, news, whaleAlerts, toggleMic, user, liveModel, isPracticeMode, tradingMode, getPortfolioSnapshot, getBrokerStatus]);

  const handleWake = useCallback(async () => {
    if (!isConnected && !isConnecting) {
      await connectJarvis();
    } else if (isConnected) {
      toggleMic();
    }
  }, [isConnected, isConnecting, connectJarvis, toggleMic]);

  // Screen Vision only takes effect at session start. If the user flips it while
  // Jarvis is connected, reconnect so the change applies immediately (stopSession
  // preserves the transcript/sessionId, so the conversation continues).
  const prevScreenShareRef = useRef(screenShareEnabled);
  useEffect(() => {
    if (prevScreenShareRef.current !== screenShareEnabled) {
      prevScreenShareRef.current = screenShareEnabled;
      if (isConnected) {
        toast(screenShareEnabled ? 'Reconnecting to enable screen vision…' : 'Reconnecting to disable screen vision…');
        stopSession();
        connectJarvis();
      }
    }
  }, [screenShareEnabled, isConnected, stopSession, connectJarvis]);

  // Save memory when session is fully ended (endSession clears transcript)
  const prevTranscriptRef = useRef('');
  useEffect(() => {
    // When transcript goes from having content to empty, the session was ended
    if (prevTranscriptRef.current && !transcript && user?.uid) {
      memoryService.summarizeAndSave(prevTranscriptRef.current, user.uid).then(() => {
        setMemories(memoryService.getMemories());
      });
    }
    prevTranscriptRef.current = transcript;
  }, [transcript, user]);

  const getOrbState = () => {
    if (isConnecting) return 'connecting';
    if (isTexting) return 'texting';
    if (micActive) return 'mic-active';
    if (isSpeaking) return 'speaking';
    return 'idle';
  };

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  // Onboarding gate: require Gemini key before accessing dashboard
  if (hasGeminiKey === null) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-500 text-sm">Loading your profile...</p>
        </div>
      </div>
    );
  }

  if (!hasGeminiKey) {
    return (
      <div className="h-screen bg-zinc-950 flex items-center justify-center p-4">
        <Toaster theme="dark" position="top-center" />
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <span className="text-3xl">🔑</span>
            </div>
            <h1 className="text-2xl font-bold text-zinc-100 mb-2">Welcome to Jarvis, {user.displayName?.split(' ')[0] || 'Trader'}!</h1>
            <p className="text-zinc-400 text-sm leading-relaxed">To get started, you need your own Gemini API key. This powers Jarvis&apos;s AI brain — reasoning, analysis, conversation, and trading intelligence.</p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Your Gemini API Key</label>
              <input
                type="password"
                value={onboardingKey}
                onChange={e => setOnboardingKey(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-zinc-200 focus:outline-none focus:border-amber-500 font-mono text-sm"
                placeholder="AIzaSy..."
                autoFocus
              />
            </div>

            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              className="block text-center text-sm text-blue-400 hover:text-blue-300 hover:underline"
            >
              Get your free key at aistudio.google.com →
            </a>

            <button
              onClick={saveOnboardingKey}
              disabled={savingOnboardingKey || !onboardingKey}
              className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black rounded-lg font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {savingOnboardingKey ? (
                <><div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" /> Saving...</>
              ) : (
                'Activate Jarvis'
              )}
            </button>
          </div>

          <div className="mt-6 text-center">
            <button
              onClick={() => { auth.signOut().then(() => setUser(null)); }}
              className="text-zinc-600 text-xs hover:text-zinc-400 transition-colors"
            >
              Sign out ({user.email})
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center relative overflow-hidden font-sans transition-colors duration-500 ${isPracticeMode ? 'ring-2 ring-amber-500/30 ring-inset' : 'ring-2 ring-cyan-500/20 ring-inset'}`}>
      <Toaster theme="dark" position="top-center" />
      <MaintenanceBanner />
      <UpdateBanner />

      {/* Chat History Sidebar */}
      <ChatSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        userId={user?.uid || ''}
        currentSessionId={currentSessionId}
        onSelectSession={(sessionId) => loadSession(sessionId)}
        onNewChat={() => {
          // Will start fresh on next orb click or text input
        }}
      />
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

      {/* v1.7.0 — system-level safety pill. Reflects LIVE_TRADING_DISABLED env
          flag (NOT the user-toggleable practice mode). Always visible when the
          flag is on; tells the user no real-money trade can leave this machine. */}
      {systemSafety?.liveTradingDisabled && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-auto"
          title="LIVE_TRADING_DISABLED is set in .env — every trade is paper. Voice cannot turn this off; only manual .env edit can."
        >
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold tracking-wider shadow-[0_0_20px_rgba(16,185,129,0.15)] backdrop-blur-md">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            🔒 PAPER ONLY
            <span className="text-emerald-500/60 font-mono normal-case">{systemSafety.version}</span>
          </div>
        </div>
      )}

      {/* Header Controls — 3 Collapsible Icons */}
      <div className="absolute top-0 left-0 right-0 p-4 z-20 flex items-start justify-between pointer-events-none">
        
        {/* LEFT: Trading Controls & Chat History */}
        <div className="pointer-events-auto flex flex-col items-start gap-3">
          
          {/* Panic + Practice Menu */}
          <div className="relative">
            <button
              onClick={() => { setLeftMenuOpen(!leftMenuOpen); setNavMenuOpen(false); setRightMenuOpen(false); }}
              className={`p-3 rounded-xl border transition-all ${
                leftMenuOpen || isPracticeMode
                  ? 'bg-red-600/20 border-red-500/50 text-red-400 shadow-[0_0_20px_rgba(239,68,68,0.2)]'
                  : 'bg-zinc-900/80 backdrop-blur-md border-zinc-800 text-zinc-400 hover:bg-zinc-800'
              }`}
              title="Trading Controls"
            >
              <ShieldAlert className="w-5 h-5" />
            </button>

            <AnimatePresence>
              {leftMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-0 mt-2 flex flex-col gap-2 min-w-[200px]"
              >
                <button
                  id="panic-button"
                  onClick={async () => {
                    setLeftMenuOpen(false);
                    toast.error('PANIC INITIATED: Liquidating all open positions...', {
                      style: { backgroundColor: '#ef4444', color: 'white', border: 'none' },
                      duration: 5000
                    });
                    if (user?.uid) {
                      try {
                        const results = await panicCloseAll();
                        const closedCount = results.length;
                        if (closedCount > 0) toast.success(`Closed ${closedCount} positions.`);
                        else toast.info('No open positions to close.');
                      } catch (err) {
                        console.error('Panic close failed', err);
                        toast.error('Failed to close some positions.');
                      }
                    }
                  }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-600/90 hover:bg-red-500 border border-red-500/50 text-white font-bold shadow-[0_0_20px_rgba(239,68,68,0.3)] transition-all"
                >
                  <X className="w-5 h-5" />
                  <span>PANIC CLOSE ALL</span>
                </button>

                <button
                  onClick={() => { togglePracticeMode(); setLeftMenuOpen(false); }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all font-medium ${
                    isPracticeMode
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                      : 'bg-zinc-900/90 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <FlaskConical className="w-5 h-5" />
                  <span>{isPracticeMode ? '🧪 PRACTICE MODE' : '🔴 LIVE MODE'}</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Chat History Menu */}
          <button 
            onClick={() => setSidebarOpen(true)} 
            title="Chat History"
            className="p-3 rounded-xl border border-zinc-800 bg-zinc-900/80 backdrop-blur-md text-zinc-400 hover:bg-zinc-800 transition-all shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* CENTER: Navigation Menu */}
        <div className="pointer-events-auto relative">
          <button
            onClick={() => { setNavMenuOpen(!navMenuOpen); setLeftMenuOpen(false); setRightMenuOpen(false); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full border transition-all ${
              navMenuOpen
                ? 'bg-zinc-100 text-zinc-900 border-zinc-200'
                : 'bg-zinc-900/80 backdrop-blur-md border-zinc-800 text-zinc-400 hover:bg-zinc-800'
            }`}
          >
            <Menu className="w-5 h-5" />
            <span className="text-sm font-medium capitalize">{appState}</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${navMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          <AnimatePresence>
            {navMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-1/2 -translate-x-1/2 mt-2 flex flex-col gap-1 bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-2xl p-2 min-w-[160px] shadow-2xl"
              >
                {(['home', 'market', 'chart', 'analytics', 'risk', 'brain', 'memories', 'diary', 'history'] as const).map((tab) => (
                  <button
                    key={tab}
                    id={`tab-${tab}`}
                    onClick={() => { handleNavigate(tab); setNavMenuOpen(false); }}
                    className={`px-4 py-2.5 rounded-xl text-sm font-medium capitalize transition-all text-left ${
                      appState === tab
                        ? 'bg-zinc-100 text-zinc-900 shadow-md'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* RIGHT: Settings & Tools */}
        <div className="pointer-events-auto relative">
          <button
            onClick={() => { setRightMenuOpen(!rightMenuOpen); setLeftMenuOpen(false); setNavMenuOpen(false); }}
            className={`flex items-center gap-2 px-2 py-2 rounded-xl border transition-all ${
              rightMenuOpen
                ? 'bg-zinc-100 border-zinc-200'
                : 'bg-zinc-900/80 backdrop-blur-md border-zinc-800 hover:bg-zinc-800'
            }`}
            title="Profile & Settings"
          >
            {user.photoURL ? (
              <img 
                src={user.photoURL} 
                alt="Profile" 
                className="w-7 h-7 rounded-full border border-zinc-700"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
                {(user.displayName || user.email || 'U')[0].toUpperCase()}
              </div>
            )}
          </button>

          <AnimatePresence>
            {rightMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full right-0 mt-2 flex flex-col gap-1 bg-zinc-900/95 backdrop-blur-md border border-zinc-800 rounded-2xl p-2 min-w-[240px] shadow-2xl"
              >
                {/* User Profile Card */}
                <div className="px-4 py-3 flex items-center gap-3 border-b border-zinc-800 mb-1">
                  {user.photoURL ? (
                    <img 
                      src={user.photoURL} 
                      alt="Profile" 
                      className="w-9 h-9 rounded-full border border-zinc-700"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-sm font-bold">
                      {(user.displayName || user.email || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="overflow-hidden">
                    <div className="text-sm font-semibold text-zinc-200 truncate">{user.displayName || 'Trader'}</div>
                    <div className="text-[11px] text-zinc-500 truncate">{user.email}</div>
                  </div>
                </div>

                <button
                  id="settings-button"
                  onClick={() => { setShowBrokerSettings(true); setRightMenuOpen(false); }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-zinc-300 hover:bg-zinc-800/70 transition-colors text-left"
                >
                  <Settings className="w-5 h-5 text-zinc-400" />
                  <span className="text-sm font-medium">Settings</span>
                </button>

                <button
                  id="memories-button"
                  onClick={async () => {
                    setRightMenuOpen(false);
                    setShowMemories(true);
                    setIsFetchingMemories(true);
                    const backendMemories = await memoryService.fetchBackendMemories(user?.uid || '');
                    setMemories(backendMemories);
                    setIsFetchingMemories(false);
                  }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-zinc-300 hover:bg-zinc-800/70 transition-colors text-left"
                >
                  <BrainCircuit className="w-5 h-5 text-zinc-400" />
                  <span className="text-sm font-medium">Core Memories</span>
                </button>

                <div className="h-px bg-zinc-800 mx-2 my-1" />

                <button
                  onClick={() => { setSearchEnabled(!searchEnabled); setRightMenuOpen(false); }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left ${
                    searchEnabled ? 'text-orange-400 bg-orange-500/10' : 'text-zinc-300 hover:bg-zinc-800/70'
                  }`}
                >
                  <Globe className="w-5 h-5" />
                  <span className="text-sm font-medium">Search Grounding</span>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${searchEnabled ? 'bg-orange-500/20 text-orange-400' : 'bg-zinc-800 text-zinc-500'}`}>
                    {searchEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>

                <button
                  id="screen-share-button"
                  onClick={() => { setScreenShareEnabled(!screenShareEnabled); setRightMenuOpen(false); }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left ${
                    screenShareEnabled ? 'text-blue-400 bg-blue-500/10' : 'text-zinc-300 hover:bg-zinc-800/70'
                  }`}
                >
                  {screenShareEnabled ? <MonitorUp className="w-5 h-5" /> : <MonitorOff className="w-5 h-5" />}
                  <span className="text-sm font-medium">Screen Vision</span>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${screenShareEnabled ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-800 text-zinc-500'}`}>
                    {screenShareEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>

                <div className="h-px bg-zinc-800 mx-2 my-1" />

                <button
                  id="logout-button"
                  onClick={() => { 
                    setRightMenuOpen(false);
                    setShowLogoutConfirm(true);
                  }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-red-400 hover:bg-red-500/10 transition-colors text-left"
                >
                  <LogOut className="w-5 h-5" />
                  <span className="text-sm font-medium">Logout</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Backdrop to close menus when clicking outside */}
      {(leftMenuOpen || navMenuOpen || rightMenuOpen) && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => { setLeftMenuOpen(false); setNavMenuOpen(false); setRightMenuOpen(false); }}
        />
      )}

      <AnimatePresence>
        {showBrokerSettings && (
          <BrokerSettings
            user={user}
            onClose={() => setShowBrokerSettings(false)}
            personality={personality}
            setPersonality={setPersonality}
            orbVariant={orbVariant}
            setOrbVariant={setOrbVariant}
            activeTab={settingsTab}
            setActiveTab={setSettingsTab}
          />
        )}
      </AnimatePresence>

      {/* Live Market Data Matrix */}
      <AnimatePresence mode="wait">
        {appState === 'market' && (
          <motion.div 
            key="market"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute inset-0 z-10 pt-20 pb-32 overflow-hidden"
          >
            <MarketWatchlist
              assetClass={marketAssetClass}
              setAssetClass={setMarketAssetClass}
              onSelectCoin={(symbol, assetClass) => {
                setSelectedChartSymbol(toTradingViewSymbol(symbol, assetClass));
                setAppState('chart');
              }}
            />
          </motion.div>
        )}

        {appState === 'chart' && (
          <motion.div 
            key="chart"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute inset-0 flex z-10 pt-20 pb-32 px-6 gap-4 items-start justify-center"
          >
            {/* Main Chart Area */}
            <div className="flex flex-col flex-1 max-w-5xl h-full">
              {/* Coin Selector — hidden during replay, shows replay coin instead */}
              <div className="flex items-center gap-3 mb-3">
                {isReplaying ? (
                  <div className="flex items-center gap-3">
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-sm font-bold font-mono text-amber-300">
                        {(replayConfig?.symbol || 'BTCUSDT').replace('USDT', ' / USDT')}
                      </span>
                      <span className="text-xs text-amber-500/60 ml-1">TIME MACHINE</span>
                    </div>
                    <span className="text-xs text-zinc-600">Change coin in the dock below ↓</span>
                  </div>
                ) : (
                  <>
                    <select
                      value={selectedChartSymbol}
                      onChange={(e) => {
                        setSelectedChartSymbol(e.target.value);
                        // The Jarvis Analysis side-panel is crypto-only TA — skip it for stocks.
                        if (!isCryptoTvSymbol(e.target.value)) return;
                        const sym = e.target.value.replace('BINANCE:', '');
                        if (jarvisAnalysisSymbolRef.current !== sym) {
                          jarvisAnalysisSymbolRef.current = sym;
                          setJarvisAnalysisLoading(true);
                          fetch(`/api/analysis?symbol=${sym.replace('/', '')}&timeframe=1h`)
                            .then(r => r.json())
                            .then(d => { setJarvisAnalysis(d); setJarvisAnalysisLoading(false); })
                            .catch(() => setJarvisAnalysisLoading(false));
                        }
                      }}
                      className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-amber-500 transition-colors"
                    >
                      {[
                        { value: 'BINANCE:BTCUSDT', label: 'BTC / USDT' },
                        { value: 'BINANCE:ETHUSDT', label: 'ETH / USDT' },
                        { value: 'BINANCE:SOLUSDT', label: 'SOL / USDT' },
                        { value: 'BINANCE:BNBUSDT', label: 'BNB / USDT' },
                        { value: 'BINANCE:XRPUSDT', label: 'XRP / USDT' },
                        { value: 'BINANCE:DOGEUSDT', label: 'DOGE / USDT' },
                        { value: 'BINANCE:ADAUSDT', label: 'ADA / USDT' },
                        { value: 'BINANCE:AVAXUSDT', label: 'AVAX / USDT' },
                        { value: 'BINANCE:DOTUSDT', label: 'DOT / USDT' },
                        { value: 'BINANCE:LINKUSDT', label: 'LINK / USDT' },
                        { value: 'BINANCE:MATICUSDT', label: 'MATIC / USDT' },
                        { value: 'BINANCE:ATOMUSDT', label: 'ATOM / USDT' },
                        { value: 'BINANCE:NEARUSDT', label: 'NEAR / USDT' },
                        { value: 'BINANCE:APTUSDT', label: 'APT / USDT' },
                        { value: 'BINANCE:ARBUSDT', label: 'ARB / USDT' },
                        { value: 'BINANCE:OPUSDT', label: 'OP / USDT' },
                        { value: 'BINANCE:SUIUSDT', label: 'SUI / USDT' },
                        { value: 'BINANCE:INJUSDT', label: 'INJ / USDT' },
                        { value: 'BINANCE:TIAUSDT', label: 'TIA / USDT' },
                        { value: 'BINANCE:SEIUSDT', label: 'SEI / USDT' },
                        { value: 'AAPL', label: 'AAPL (stock)' },
                        { value: 'TSLA', label: 'TSLA (stock)' },
                        { value: 'NVDA', label: 'NVDA (stock)' },
                        { value: 'MSFT', label: 'MSFT (stock)' },
                        { value: 'AMZN', label: 'AMZN (stock)' },
                        { value: 'GOOGL', label: 'GOOGL (stock)' },
                      ].map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    
                    {/* Chart renderer toggle — Jarvis's custom chart vs standard TradingView.
                        Crypto-only (LiveJarvisChart pulls Binance data); hidden for stocks. */}
                    {isCryptoTvSymbol(selectedChartSymbol) && (
                      <button
                        onClick={() => setLiveVisionEnabled(!liveVisionEnabled)}
                        className={`ml-4 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-all border ${
                          liveVisionEnabled
                            ? 'bg-violet-500/20 text-violet-300 border-violet-500/40 shadow-[0_0_10px_rgba(139,92,246,0.2)]'
                            : 'bg-zinc-800/60 text-zinc-500 border-zinc-700/50 hover:border-zinc-600 hover:text-zinc-300'
                        }`}
                      >
                        <Brain className={`w-3.5 h-3.5 ${liveVisionEnabled ? 'animate-pulse text-violet-400' : ''}`} />
                        {liveVisionEnabled ? 'JARVIS CHART' : 'STANDARD CHART'}
                      </button>
                    )}

                    {!liveVisionEnabled && <span className="text-xs text-zinc-500 ml-2">Select a coin or click one in Market tab</span>}
                  </>
                )}
              </div>
              <div className="flex-1 bg-zinc-950 rounded-xl border border-zinc-800 shadow-2xl overflow-hidden">
                {isPracticeMode && isReplaying ? (
                  <ReplayChart
                    symbol={replayConfig?.symbol || 'BTCUSDT'}
                    broker="crypto"
                    replayDate={replayConfig?.date}
                    speed={replayConfig?.speed}
                    jarvisEnabled={replayConfig?.jarvisEnabled}
                    capital={replayConfig?.capital}
                    profitTarget={replayConfig?.profitTarget}
                  />
                ) : (liveVisionEnabled && isCryptoTvSymbol(selectedChartSymbol)) ? (
                  <LiveJarvisChart
                    symbol={selectedChartSymbol}
                    positions={positions}
                    tradeHistory={tradeHistory}
                    sentryLogs={sentryLogs}
                  />
                ) : (
                  <TradingViewChart symbol={selectedChartSymbol} />
                )}
              </div>
            </div>

            {/* Jarvis Analysis Panel */}
            {!isReplaying && (
              <div className="w-64 shrink-0 h-full flex flex-col gap-3">
                <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                    <span className="text-xs font-bold text-violet-300 tracking-wider uppercase">Jarvis Analysis</span>
                  </div>
                  {jarvisAnalysisLoading && (
                    <div className="flex items-center gap-2 text-zinc-500 text-xs">
                      <div className="w-4 h-4 border border-violet-500/40 border-t-violet-500 rounded-full animate-spin" />
                      Analyzing {selectedChartSymbol.replace('BINANCE:', '').replace('USDT', '/USDT')}...
                    </div>
                  )}
                  {!jarvisAnalysisLoading && !jarvisAnalysis && (
                    <div className="text-zinc-600 text-xs text-center py-2">
                      Select a coin to see<br />Jarvis's live analysis
                    </div>
                  )}
                  {jarvisAnalysis && jarvisAnalysis.status === 'success' && (() => {
                    const { indicators, analysis, currentPrice } = jarvisAnalysis;
                    const rsi = indicators?.rsi;
                    const ema20 = indicators?.ema20;
                    const ema50 = indicators?.ema50;
                    const trend = analysis?.trend || 'Neutral';
                    const overbought = analysis?.isOverbought;
                    const oversold = analysis?.isOversold;

                    let signal = 'HOLD';
                    let signalColor = 'text-zinc-400';
                    let signalBg = 'bg-zinc-800/50 border-zinc-700';
                    if (trend === 'Bullish' && !overbought) { signal = 'LONG'; signalColor = 'text-emerald-300'; signalBg = 'bg-emerald-500/10 border-emerald-500/30'; }
                    else if (trend === 'Bearish' && !oversold) { signal = 'SHORT'; signalColor = 'text-red-300'; signalBg = 'bg-red-500/10 border-red-500/30'; }

                    const reasoning = trend === 'Bullish'
                      ? `Price above EMA20 & EMA50. RSI at ${rsi?.toFixed(1)} — ${overbought ? 'overbought, caution' : 'healthy range'}.`
                      : trend === 'Bearish'
                      ? `Price below EMA20 & EMA50. RSI at ${rsi?.toFixed(1)} — ${oversold ? 'oversold, watch for bounce' : 'bearish momentum'}.`
                      : `EMAs mixed, no clear directional bias. RSI ${rsi?.toFixed(1)}.`;

                    return (
                      <>
                        {/* Signal Badge */}
                        <div className={`border rounded-lg p-3 text-center ${signalBg}`}>
                          <div className={`text-2xl font-black font-mono ${signalColor}`}>{signal}</div>
                          <div className="text-xs text-zinc-500 mt-1">{trend} Trend</div>
                        </div>

                        {/* Indicators */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-zinc-500">RSI (14)</span>
                            <span className={`text-xs font-mono font-bold ${
                              rsi > 70 ? 'text-red-400' : rsi < 30 ? 'text-emerald-400' : 'text-zinc-200'
                            }`}>{rsi?.toFixed(1) ?? 'N/A'} {rsi > 70 ? '⚠ OB' : rsi < 30 ? '⚠ OS' : ''}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-zinc-500">EMA 20</span>
                            <span className="text-xs font-mono text-zinc-300">${ema20?.toFixed(2) ?? 'N/A'}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-zinc-500">EMA 50</span>
                            <span className="text-xs font-mono text-zinc-300">${ema50?.toFixed(2) ?? 'N/A'}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-zinc-500">Price</span>
                            <span className="text-xs font-mono text-amber-300 font-bold">${currentPrice?.toFixed(2) ?? 'N/A'}</span>
                          </div>
                        </div>

                        {/* Reasoning */}
                        <div className="border border-zinc-800 rounded-lg p-2.5 bg-zinc-950/60">
                          <p className="text-xs text-zinc-400 leading-relaxed">{reasoning}</p>
                        </div>

                        {/* Patterns */}
                        {analysis?.candlestickPatterns?.filter((p: string) => p !== 'None detected').length > 0 && (
                          <div>
                            <div className="text-xs text-zinc-600 mb-1">Patterns</div>
                            <div className="flex flex-wrap gap-1">
                              {analysis.candlestickPatterns.map((p: string) => (
                                <span key={p} className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded">{p}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        <button
                          onClick={() => {
                            const sym = selectedChartSymbol.replace('BINANCE:', '');
                            setJarvisAnalysisLoading(true);
                            fetch(`/api/analysis?symbol=${sym}&timeframe=1h`)
                              .then(r => r.json())
                              .then(d => { setJarvisAnalysis(d); setJarvisAnalysisLoading(false); })
                              .catch(() => setJarvisAnalysisLoading(false));
                          }}
                          className="w-full text-xs text-zinc-600 hover:text-zinc-400 transition-colors py-1 border border-zinc-800 rounded-lg hover:border-zinc-700"
                        >
                          ↻ Refresh Analysis
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {appState === 'analytics' && (
          <motion.div 
            key="analytics"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute inset-0 flex flex-col items-center z-10 pt-32 pb-32 px-6 overflow-y-auto"
          >
            <AnalyticsDashboard tradeHistory={tradeHistory} dailyPnl={dailyPnl} />
          </motion.div>
        )}



        {appState === 'risk' && (
          <motion.div 
            key="risk"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute inset-0 flex flex-col items-center z-10 pt-32 pb-32 px-6 overflow-y-auto"
          >
            <RiskManager userId={user.uid} />
          </motion.div>
        )}

        {appState === 'brain' && (
          <motion.div 
            key="brain"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute inset-0 z-10"
          >
            <JarvisBrain isPracticeMode={isPracticeMode} userId={user.uid} />
          </motion.div>
        )}

        {appState === 'memories' && (
          <motion.div
            key="memories"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute inset-0 z-10 pt-16 pb-32"
          >
            <JarvisMemories userId={user.uid} />
          </motion.div>
        )}

        {appState === 'diary' && (
          <motion.div
            key="diary"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute inset-0 z-10 pt-16 pb-32"
          >
            <TradeDiary userId={user.uid} />
          </motion.div>
        )}

        {appState === 'history' && (
          <motion.div 
            key="history"
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
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-start pt-16 pb-32 px-4 overflow-y-auto scrollbar-hide"
          >
            {/* Title */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              className="text-4xl font-light tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-zinc-100 to-zinc-500 uppercase mb-6"
            >
              Jarvis
            </motion.h1>

            {/* ─── 3-COLUMN LAYOUT ─── */}
            <div className="w-full max-w-5xl grid grid-cols-[1fr_auto_1fr] gap-4 items-start">

              {/* ── LEFT COLUMN ── */}
              <div className="flex flex-col gap-3">
                {/* Portfolio Snapshot */}
                <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}
                  className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 backdrop-blur-sm">
                  <div className="flex items-center gap-1.5 mb-2">
                    <BarChart2 className="w-3 h-3 text-zinc-500" />
                    <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-500">Portfolio</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between"><span className="text-[10px] text-zinc-500">Balance</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono font-bold text-zinc-200">${(isPracticeMode ? (portfolio?.paperBalance ?? 100000) : (portfolio?.liveBalance ?? 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        <span className={`text-[8px] px-1 py-0.5 rounded font-bold ${isPracticeMode ? 'bg-amber-500/10 text-amber-400' : 'bg-cyan-500/10 text-cyan-400'}`}>{isPracticeMode ? 'PAPER' : 'USDT'}</span>
                      </div>
                    </div>
                    <div className="flex justify-between"><span className="text-[10px] text-zinc-500">Today P&L</span>
                      <span className={`text-xs font-mono font-bold ${(dailyPnl?.totalPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {(dailyPnl?.totalPnl ?? 0) >= 0 ? '+' : ''}${(dailyPnl?.totalPnl ?? 0).toFixed(2)}
                      </span>
                    </div>
                    {dailyPnl?.tradesCount > 0 && (
                      <div className="flex justify-between"><span className="text-[10px] text-zinc-500">Win Rate</span>
                        <span className={`text-xs font-mono font-bold ${Math.round((dailyPnl.winCount / dailyPnl.tradesCount) * 100) >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {Math.round((dailyPnl.winCount / dailyPnl.tradesCount) * 100)}%
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between"><span className="text-[10px] text-zinc-500">Open</span>
                      <span className="text-xs font-mono font-bold text-zinc-300">{positions?.length ?? 0} trade{(positions?.length ?? 0) !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                </motion.div>

                {/* Sentry Status */}
                <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}
                  className={`bg-zinc-900/50 border rounded-xl p-3 backdrop-blur-sm ${sentryConfig?.active ? 'border-purple-500/30' : 'border-zinc-800/60'}`}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Activity className={`w-3 h-3 ${sentryConfig?.active ? 'text-purple-400' : 'text-zinc-500'}`} />
                    <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-500">Sentry</span>
                    <div className={`ml-auto w-1.5 h-1.5 rounded-full ${sentryConfig?.active ? 'bg-purple-400 animate-pulse' : 'bg-zinc-700'}`} />
                  </div>
                  <p className="text-[10px] leading-relaxed">
                    {sentryConfig?.active
                      ? <span className="text-purple-300">Autonomous mode active. Monitoring markets.</span>
                      : <span className="text-zinc-600">Sentry offline. Enable for autonomous trading.</span>}
                  </p>
                </motion.div>

                {/* Open Positions */}
                <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
                  className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 backdrop-blur-sm">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Target className="w-3 h-3 text-zinc-500" />
                    <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-500">Open Positions</span>
                  </div>
                  {positions && positions.length > 0 ? (
                    <div className="space-y-2">
                      {positions.slice(0, 4).map((p: any) => {
                        const pnl = p.unrealizedPnl ?? 0;
                        return (
                          <div key={p.id} className="flex flex-col gap-0.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1">
                                <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${p.side === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>{p.side?.toUpperCase()}</span>
                                <span className="text-[10px] font-mono text-zinc-200">{(p.symbol || '').replace('/USDT', '')}</span>
                              </div>
                              <span className={`text-[10px] font-mono font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>
                            </div>
                            {p.stopLossPrice && p.takeProfitPrice && (
                              <div className="w-full h-0.5 bg-zinc-800 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${pnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                                  style={{ width: `${Math.min(100, Math.max(0, ((p.currentPrice ?? p.entryPrice) - p.stopLossPrice) / (p.takeProfitPrice - p.stopLossPrice) * 100))}%` }} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-3">
                      <p className="text-[10px] text-zinc-600">No open positions</p>
                      <p className="text-[9px] text-zinc-700 mt-0.5">Say "Jarvis, scan the market"</p>
                    </div>
                  )}
                </motion.div>

                {/* Trading Stats */}
                <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}
                  className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 backdrop-blur-sm">
                  <div className="flex items-center gap-1.5 mb-2">
                    <TrendingUp className="w-3 h-3 text-zinc-500" />
                    <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-500">Trading Stats</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between"><span className="text-[10px] text-zinc-500">Total Trades</span>
                      <span className="text-xs font-mono font-bold text-zinc-300">{tradeHistory?.length ?? 0}</span>
                    </div>
                    <div className="flex justify-between"><span className="text-[10px] text-zinc-500">Win Rate</span>
                      <span className={`text-xs font-mono font-bold ${tradeHistory?.length > 0 ? (tradeHistory.filter((t: any) => (t.pnl ?? t.realizedPnl ?? 0) >= 0).length / tradeHistory.length * 100 >= 50 ? 'text-emerald-400' : 'text-red-400') : 'text-zinc-600'}`}>
                        {tradeHistory?.length > 0 ? `${Math.round(tradeHistory.filter((t: any) => (t.pnl ?? t.realizedPnl ?? 0) >= 0).length / tradeHistory.length * 100)}%` : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between"><span className="text-[10px] text-zinc-500">Best Trade</span>
                      <span className="text-xs font-mono font-bold text-emerald-400">
                        {tradeHistory?.length > 0 ? `+$${Math.max(...tradeHistory.map((t: any) => t.pnl ?? t.realizedPnl ?? 0)).toFixed(2)}` : '—'}
                      </span>
                    </div>
                  </div>
                </motion.div>

                {/* Pending Approvals */}
                {pendingTrades && pendingTrades.length > 0 && (
                  <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}
                    className="bg-zinc-900/50 border border-amber-500/20 rounded-xl p-3 backdrop-blur-sm">
                    <div className="flex items-center gap-1.5 mb-2">
                      <AlertTriangle className="w-3 h-3 text-amber-400" />
                      <span className="text-[9px] uppercase tracking-widest font-semibold text-amber-400/70">Pending Approval</span>
                      <span className="ml-auto text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-bold">{pendingTrades.length}</span>
                    </div>
                    <div className="space-y-1.5">
                      {pendingTrades.slice(0, 3).map((t: any) => (
                        <div key={t.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${t.side === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>{t.side?.toUpperCase()}</span>
                            <span className="text-[10px] font-mono text-zinc-300">{(t.symbol || '').replace('/USDT', '')}</span>
                          </div>
                          <button onClick={() => approveTrade(t.id)} className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors font-bold">APPROVE</button>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* System Status */}
                <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}
                  className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 backdrop-blur-sm">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Cpu className="w-3 h-3 text-zinc-500" />
                    <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-500">System</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-zinc-500">Mode</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isPracticeMode ? 'bg-amber-500/10 text-amber-400' : 'bg-cyan-500/10 text-cyan-400'}`}>{isPracticeMode ? '🧪 Paper' : '🔴 Live'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-zinc-500">Connection</span>
                      <span className={`text-[10px] font-bold ${isConnected ? 'text-emerald-400' : 'text-zinc-600'}`}>{isConnected ? '● Active' : '○ Idle'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-zinc-500">Live Model</span>
                      <span className="text-[10px] font-mono text-cyan-400/70">{LIVE_MODELS.find(m => m.id === liveModel)?.label ?? 'N/A'}</span>
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* ── CENTER: Orb + Unified Input ── */}
              <div className="flex flex-col items-center gap-4 w-[360px]">
                {/* Orb */}
                <div className="cursor-pointer" onClick={handleWake}>
                  <Orb state={getOrbState()} volume={volume} variant={orbVariant} tradingMode={tradingMode} />
                </div>

                {/* Activity Pipeline */}
                <ActivityPipeline activity={pipelineActivity} isConnected={isConnected} />

                {/* Unified Transcript + Input */}
                <form
                  className="w-full relative"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (textInput.trim()) {
                      if (isSessionReady) {
                        sendTextMessage(textInput.trim(), memoryModel);
                      } else if (!isConnected && !isConnecting) {
                        const context = await memoryService.getFormattedContext(user?.uid, "user rules, preferences and recent trading behavior", { news, whaleAlerts });
                        const portfolioSnapshot = getPortfolioSnapshot();
                        const brokerStatus = getBrokerStatus();
                        startSession(context, screenShareEnabled, searchEnabled, personality, textInput.trim(), true, liveModel, isPracticeMode, tradingMode, portfolioSnapshot, brokerStatus);
                      }
                      setTextInput('');
                    }
                  }}
                >
                  <div className="w-full bg-zinc-900/80 border border-zinc-800/70 rounded-2xl backdrop-blur-sm overflow-hidden shadow-xl focus-within:ring-1 focus-within:ring-cyan-500/40 transition-all">
                    {/* Transcript area — only visible when there's content */}
                    {(transcript || (isConnected && !textInput)) && (
                      <div
                        ref={transcriptRef}
                        className="w-full max-h-48 overflow-y-auto px-5 pt-4 pb-2 scrollbar-hide border-b border-zinc-800/50"
                      >
                        <AnimatePresence mode="popLayout">
                          {transcript ? (
                            <motion.p key="transcript" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                              className="text-xs font-mono text-zinc-400 leading-relaxed whitespace-pre-wrap">
                              {transcript}
                            </motion.p>
                          ) : (
                            <motion.p key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                              className="text-xs font-mono text-zinc-600 italic">
                              Waiting for response...
                            </motion.p>
                          )}
                        </AnimatePresence>
                      </div>
                    )}

                    {/* Input row */}
                    <div className="flex items-center px-4 py-2.5 gap-2">
                      <input
                        type="text"
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        placeholder={isConnected ? "Reply to Jarvis..." : "Ask Jarvis..."}
                        className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                      />
                      <button type="submit" disabled={!textInput.trim()}
                        className="p-1.5 rounded-full text-zinc-500 hover:text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-30 transition-colors">
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </form>

                {/* Model Selectors Row */}
                <div className="flex items-center justify-center gap-3 w-full">
                  <div ref={liveModelRef} className="relative">
                    <button type="button" onClick={() => { setShowLiveModelMenu(p => !p); setShowMemModelMenu(false); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/70 border border-zinc-800/60 hover:border-cyan-500/40 transition-all text-[10px] font-medium text-zinc-400 hover:text-cyan-400 whitespace-nowrap">
                      <Zap className="w-3 h-3 flex-shrink-0" />
                      <span>{LIVE_MODELS.find(m => m.id === liveModel)?.label ?? 'Live'}</span>
                      <ChevronDown className="w-3 h-3 opacity-50" />
                    </button>
                    <AnimatePresence>
                      {showLiveModelMenu && (
                        <motion.div initial={{ opacity: 0, y: 6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.97 }} transition={{ duration: 0.15 }}
                          className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-52 bg-zinc-900/95 backdrop-blur-md border border-zinc-700/70 rounded-xl shadow-2xl overflow-hidden z-50">
                          <div className="px-3 py-2 border-b border-zinc-800"><p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-widest flex items-center gap-1"><Zap className="w-3 h-3" /> Live Model</p></div>
                          {LIVE_MODELS.map(m => (
                            <button key={m.id} type="button" onClick={() => { setLiveModel(m.id); localStorage.setItem('jarvis-live-model', m.id); setShowLiveModelMenu(false); }}
                              className={`w-full text-left px-3 py-2.5 text-xs transition-colors flex items-center justify-between gap-2 ${liveModel === m.id ? 'text-cyan-400 bg-cyan-500/10' : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'}`}>
                              <span>{m.label}</span>
                              {liveModel === m.id && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />}
                            </button>
                          ))}
                          <div className="px-3 py-1.5 border-t border-zinc-800"><p className="text-[9px] text-zinc-600">Takes effect on next session start</p></div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div ref={memModelRef} className="relative">
                    <button type="button" onClick={() => { setShowMemModelMenu(p => !p); setShowLiveModelMenu(false); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/70 border border-zinc-800/60 hover:border-purple-500/40 transition-all text-[10px] font-medium text-zinc-400 hover:text-purple-400 whitespace-nowrap">
                      <Cpu className="w-3 h-3 flex-shrink-0" />
                      <span>{MEM_MODELS.find(m => m.id === memoryModel)?.label ?? 'Memory'}</span>
                      <ChevronDown className="w-3 h-3 opacity-50" />
                    </button>
                    <AnimatePresence>
                      {showMemModelMenu && (
                        <motion.div initial={{ opacity: 0, y: 6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.97 }} transition={{ duration: 0.15 }}
                          className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-52 bg-zinc-900/95 backdrop-blur-md border border-zinc-700/70 rounded-xl shadow-2xl overflow-hidden z-50">
                          <div className="px-3 py-2 border-b border-zinc-800"><p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-widest flex items-center gap-1"><Cpu className="w-3 h-3" /> Memory Model</p></div>
                          {MEM_MODELS.map(m => (
                            <button key={m.id} type="button" onClick={() => { setMemoryModel(m.id); localStorage.setItem('jarvis-memory-model', m.id); setShowMemModelMenu(false); }}
                              className={`w-full text-left px-3 py-2.5 text-xs transition-colors flex items-center justify-between gap-2 ${memoryModel === m.id ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'}`}>
                              <span>{m.label}</span>
                              {memoryModel === m.id && <span className="w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />}
                            </button>
                          ))}
                          <div className="px-3 py-1.5 border-t border-zinc-800"><p className="text-[9px] text-zinc-600">Used for web memorization</p></div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Status text */}
                <div className="h-8 flex items-center justify-center">
                  <AnimatePresence mode="wait">
                    {!isConnected && !isConnecting && (
                      <motion.p key="idle" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        className="text-zinc-600 font-mono text-xs tracking-wider">
                        Tap orb to wake or type below
                      </motion.p>
                    )}
                    {isConnecting && (
                      <motion.p key="connecting" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        className="text-cyan-400 font-mono text-xs tracking-wider animate-pulse">
                        Connecting to core...
                      </motion.p>
                    )}
                    {isConnected && (
                      <motion.p key="active" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        className="text-zinc-400 font-mono text-xs tracking-wider">
                        {isSpeaking ? 'Jarvis is speaking...' : micActive ? 'Listening...' : 'Connected · Tap orb to speak'}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                {/* End Session */}
                <AnimatePresence>
                  {(isConnected || transcript) && (
                    <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      onClick={endSession}
                      className="px-5 py-1.5 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-medium tracking-wide">
                      End Session
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>

              {/* ── RIGHT COLUMN ── */}
              <div className="flex flex-col gap-3">
                {/* Recent Trades */}
                {tradeHistory && tradeHistory.length > 0 && (
                  <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}
                    className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 backdrop-blur-sm">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Clock className="w-3 h-3 text-zinc-500" />
                      <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-500">Recent Trades</span>
                    </div>
                    <div className="space-y-1.5">
                      {tradeHistory.slice(0, 3).map((t: any) => {
                        const pnl = t.realizedPnl ?? t.pnl ?? 0;
                        return (
                          <div key={t.id} className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                              {pnl >= 0 ? <TrendingUp className="w-2.5 h-2.5 text-emerald-500" /> : <TrendingDown className="w-2.5 h-2.5 text-red-500" />}
                              <span className="text-[10px] font-mono text-zinc-400">{(t.symbol || '').replace('/USDT', '')}</span>
                            </div>
                            <span className={`text-[10px] font-mono font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}

                {/* Whale Activity */}
                {whaleAlerts && whaleAlerts.length > 0 && (
                  <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}
                    className="bg-zinc-900/50 border border-amber-500/10 rounded-xl p-3 backdrop-blur-sm">
                    <div className="flex items-center gap-1.5 mb-2">
                      <AlertTriangle className="w-3 h-3 text-amber-500" />
                      <span className="text-[9px] uppercase tracking-widest font-semibold text-amber-500/70">Whale Activity</span>
                    </div>
                    <div className="space-y-2">
                      {whaleAlerts.slice(0, 3).map((w: any, i: number) => (
                        <div key={i} className="text-[10px] text-zinc-400 border-b border-zinc-800/30 last:border-0 pb-1.5 last:pb-0">
                          <span className="text-amber-400 font-mono font-bold">{w.symbol || 'BTC'}</span>
                          {' · '}<span>{w.side === 'buy' ? '🐋 Accumulating' : '🔴 Dumping'}</span>
                          {w.amount && <span className="text-zinc-500"> · ${(w.amount / 1e6).toFixed(1)}M</span>}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Market Intel */}
                {news && news.length > 0 && (
                  <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
                    className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 backdrop-blur-sm">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Newspaper className="w-3 h-3 text-zinc-500" />
                      <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-500">Market Intel</span>
                    </div>
                    <div className="space-y-2">
                      {news.slice(0, 3).map((n: any, i: number) => (
                        <div key={i} className="text-[10px] text-zinc-400 leading-snug border-b border-zinc-800/30 last:border-0 pb-1.5 last:pb-0">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${n.sentiment === 'bullish' ? 'bg-emerald-400' : n.sentiment === 'bearish' ? 'bg-red-400' : 'bg-zinc-500'}`} />
                          {n.headline || n.title || n.summary}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Quick Commands — always visible */}
                <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}
                  className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-3 backdrop-blur-sm">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Zap className="w-3 h-3 text-zinc-500" />
                    <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-500">Quick Commands</span>
                  </div>
                  <div className="space-y-1">
                    {[
                      { cmd: 'Scan the market', icon: '🔍' },
                      { cmd: 'What should I trade?', icon: '💡' },
                      { cmd: 'Check my positions', icon: '📊' },
                      { cmd: 'Show risk report', icon: '🛡️' },
                    ].map((item, i) => (
                      <button key={i} onClick={() => { setTextInput(item.cmd); }}
                        className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-[10px] text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors cursor-pointer">
                        <span>{item.icon}</span>
                        <span className="font-mono">{item.cmd}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>

                {/* Sentry Activity */}
                {sentryLogs && sentryLogs.length > 0 && (
                  <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }}
                    className="bg-zinc-900/50 border border-purple-500/10 rounded-xl p-3 backdrop-blur-sm">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Activity className="w-3 h-3 text-purple-400" />
                      <span className="text-[9px] uppercase tracking-widest font-semibold text-purple-400/70">Sentry Activity</span>
                    </div>
                    <div className="space-y-1.5">
                      {sentryLogs.slice(0, 4).map((log: any, i: number) => (
                        <div key={i} className="text-[10px] text-zinc-400 border-b border-zinc-800/30 last:border-0 pb-1 last:pb-0">
                          <span className="text-purple-300 font-mono">{log.action || log.type || 'scan'}</span>
                          {' · '}<span className="text-zinc-500">{log.symbol || log.pair || ''}</span>
                          {log.timestamp && <span className="text-zinc-700 ml-1">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>
            </div>
          </motion.main>
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
                {isFetchingMemories ? (
                  <div className="flex flex-col items-center justify-center py-8">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
                    <p className="text-zinc-500">Retrieving permanent memory bank...</p>
                  </div>
                ) : memories.length === 0 ? (
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
                        <p className="text-xs text-zinc-500 font-mono flex-1">
                          {new Date(memory.timestamp).toLocaleString()}
                        </p>
                        <button 
                          onClick={() => handleDeleteMemory(memory.id)}
                          className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                          title="Delete memory"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
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
                    onClick={async () => {
                      if (!confirmClear) {
                        setConfirmClear(true);
                        setTimeout(() => setConfirmClear(false), 3000); // Reset after 3s
                        return;
                      }
                      setConfirmClear(false);
                      const count = await memoryService.clearAllBackendMemories(user?.uid || '');
                      setMemories([]);
                      toast.success(`Cleared ${count} memories from the database.`);
                    }}
                    className={`text-xs px-4 py-2 rounded-lg transition-colors ${
                      confirmClear 
                        ? 'text-white bg-red-600 hover:bg-red-500 font-bold animate-pulse' 
                        : 'text-red-400 hover:text-red-300 hover:bg-red-400/10'
                    }`}
                  >
                    {confirmClear ? '⚠️ Tap again to permanently delete all' : 'Clear All Memories'}
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dashboard
        activeTab={dashboardTab}
        setActiveTab={setDashboardTab}
        positions={positions}
        pendingTrades={pendingTrades}
        tradeHistory={tradeHistory}
        dailyPnl={dailyPnl}
        portfolio={portfolio}
        userId={user?.uid || ''}
        sentryConfig={sentryConfig}
        sentryLogs={sentryLogs}
        onClosePosition={closePosition}
        onApproveTrade={approveTrade}
        onDeclineTrade={declineTrade}
        isLoading={isLoading}
        isPracticeMode={isPracticeMode}
        tradingMode={tradingMode}
        showTimeMachine={appState === 'market' || appState === 'chart'}
        isReplaying={isReplaying}
        onStartReplay={(date, speed, symbol, jarvisEnabled, capital, profitTarget) => {
          setReplayConfig({ date, speed, symbol, jarvisEnabled, capital, profitTarget });
          setIsReplaying(true);
        }}
        onStopReplay={() => {
          setReplayConfig(null);
          setIsReplaying(false);
        }}
      />

      {/* Real Money Confirmation Modal */}
      <AnimatePresence>
        {showRealModeConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setShowRealModeConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-zinc-900 border-2 border-red-500/50 rounded-2xl p-8 max-w-md mx-4 shadow-[0_0_60px_rgba(239,68,68,0.2)]"
            >
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                  <ShieldAlert className="w-8 h-8 text-red-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">⚠️ Switch to REAL MONEY?</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  You are about to switch to <span className="text-cyan-400 font-semibold">Real Trading Mode</span>. 
                  All trades will use <span className="text-red-400 font-semibold">real funds</span> from your connected exchange account.
                </p>
              </div>
              
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
                <p className="text-red-300 text-xs leading-relaxed">
                  💰 Real money is at risk. Losses are permanent.<br/>
                  📉 Never trade more than you can afford to lose.<br/>
                  🔌 Make sure your broker is connected in Settings.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowRealModeConfirm(false)}
                  className="flex-1 px-4 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium transition-all border border-zinc-700"
                >
                  Stay in Practice
                </button>
                <button
                  onClick={() => {
                    setIsPracticeMode(false);
                    setShowRealModeConfirm(false);
                    toast.warning('REAL MONEY MODE ACTIVATED', {
                      description: 'All trades will use real funds from your connected exchange.',
                      duration: 5000,
                      style: { backgroundColor: '#0891b2', color: 'white', border: '1px solid rgba(6,182,212,0.5)' }
                    });
                  }}
                  className="flex-1 px-4 py-3 rounded-xl bg-red-600/90 hover:bg-red-500 text-white font-bold transition-all border border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                >
                  I Understand — Go Live
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Onboarding Setup Wizard for new users */}
      <OnboardingWizard userId={user?.uid || ''} />

      {/* Logout Confirmation Modal */}
      <AnimatePresence>
        {showLogoutConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowLogoutConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl"
            >
              <div className="text-center mb-5">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-red-500/15 flex items-center justify-center">
                  <LogOut className="w-7 h-7 text-red-400" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">Sign Out?</h3>
                <p className="text-zinc-400 text-sm">Are you sure you want to logout?</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium transition-all border border-zinc-700"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowLogoutConfirm(false);
                    auth.signOut().then(() => setUser(null));
                  }}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-600/90 hover:bg-red-500 text-white font-bold transition-all border border-red-500/50"
                >
                  Logout
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

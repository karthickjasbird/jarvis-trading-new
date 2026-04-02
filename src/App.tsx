import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, MonitorUp, MonitorOff, BrainCircuit, X, Globe, Palette, LogOut, Key } from 'lucide-react';
import { Orb, OrbVariant } from './components/Orb';
import { useWakeWord } from './hooks/useWakeWord';
import { useJarvisLive } from './hooks/useJarvisLive';
import { memoryService } from './services/memoryService';
import { Toaster } from 'sonner';
import { Login } from './components/Login';
import { BrokerSettings } from './components/BrokerSettings';
import { LiveMarketData } from './components/LiveMarketData';
import { auth } from './firebase';
import { User } from 'firebase/auth';

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

  const {
    startSession,
    stopSession,
    isConnected,
    isConnecting,
    isListening,
    isSpeaking,
    transcript,
    volume,
  } = useJarvisLive();

  const transcriptRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const handleWake = () => {
    if (!isConnected && !isConnecting) {
      const context = memoryService.getFormattedContext();
      startSession(context, screenShareEnabled, searchEnabled, personality);
    }
  };

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
    if (isListening) return 'listening';
    return 'idle';
  };

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center relative overflow-hidden font-sans">
      <Toaster theme="dark" position="top-center" />
      {/* Background ambient glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,150,255,0.05)_0%,transparent_70%)] pointer-events-none" />

      {/* Header Controls */}
      <div className="absolute top-6 left-6 z-10">
        <button
          onClick={() => {
            // In Phase 2, this will trigger the backend to close all trades
            import('sonner').then(({ toast }) => {
              toast.error('PANIC INITIATED: Liquidating all open positions across all markets...', {
                style: { backgroundColor: '#ef4444', color: 'white', border: 'none' },
                duration: 5000
              });
            });
          }}
          className="px-6 py-3 rounded-xl bg-red-600/90 hover:bg-red-500 border border-red-500/50 text-white font-bold tracking-wider shadow-[0_0_30px_rgba(239,68,68,0.3)] transition-all hover:shadow-[0_0_50px_rgba(239,68,68,0.5)] hover:scale-105 flex items-center gap-2"
        >
          <X className="w-5 h-5" />
          PANIC CLOSE ALL
        </button>
      </div>

      <div className="absolute top-6 right-6 flex items-center gap-4 z-10">
        <button
          onClick={() => setShowBrokerSettings(true)}
          className="p-3 rounded-full bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-800 transition-colors text-zinc-400"
          title="Broker API Settings"
        >
          <Key className="w-5 h-5" />
        </button>
        <button
          onClick={() => auth.signOut().then(() => setUser(null))}
          className="p-3 rounded-full bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-800 transition-colors text-zinc-400"
          title="Logout"
        >
          <LogOut className="w-5 h-5" />
        </button>
        <button
          onClick={() => {
            const variants: OrbVariant[] = ['hologram', 'liquid', 'ethereal'];
            const currentIndex = variants.indexOf(orbVariant);
            setOrbVariant(variants[(currentIndex + 1) % variants.length]);
          }}
          className="p-3 rounded-full bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-800 transition-colors text-zinc-400"
          title={`Change Visual Style (Current: ${orbVariant})`}
        >
          <Palette className="w-5 h-5" />
        </button>
        <button
          onClick={() => setShowMemories(true)}
          className="p-3 rounded-full bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-800 transition-colors"
          title="View Memories"
        >
          <BrainCircuit className="w-5 h-5 text-zinc-400" />
        </button>
        <button
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
        
        {/* Personality Selector */}
        <div className="flex items-center bg-zinc-900/50 border border-zinc-800 rounded-full p-1">
          {(['classic', 'sarcastic', 'scientific'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPersonality(p)}
              className={`px-3 py-1.5 rounded-full text-[10px] uppercase tracking-widest transition-all ${
                personality === p
                  ? 'bg-zinc-100 text-zinc-900 font-bold'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <button
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
      </div>

      <AnimatePresence>
        {showBrokerSettings && (
          <BrokerSettings user={user} onClose={() => setShowBrokerSettings(false)} />
        )}
      </AnimatePresence>

      {/* Live Market Data Matrix */}
      <div className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col gap-4 z-10 hidden lg:flex">
        <LiveMarketData symbol="BTC/USDT" broker="crypto" />
        <LiveMarketData symbol="ETH/USDT" broker="crypto" />
        <LiveMarketData symbol="RELIANCE" broker="zerodha" />
      </div>

      {/* Main Content */}
      <main className="flex flex-col items-center justify-center w-full max-w-3xl mx-auto px-6 z-10">
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
        <div className="w-full max-w-xl h-32 mb-8 relative">
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
                  {isSpeaking ? 'Jarvis is speaking...' : 'Listening...'}
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
      </main>

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
                      <p className="text-xs text-zinc-500 mb-2 font-mono">
                        {new Date(memory.timestamp).toLocaleString()}
                      </p>
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
    </div>
  );
}

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Database, 
  Globe, 
  Trash2, 
  Plus, 
  Search,
  BookOpen,
  BrainCircuit,
  MessageSquare,
  Network,
  Download,
  GraduationCap
} from 'lucide-react';
import { toast } from 'sonner';

interface MemoryItem {
  id: string;
  userId: string;
  text: string;
  type: 'episodic' | 'semantic' | 'user_rule';
  createdAt: string;
}

export function JarvisMemories({ userId }: { userId?: string }) {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [manualMemoryText, setManualMemoryText] = useState('');
  const [isInjecting, setIsInjecting] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);

  const fetchMemories = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/memory/list/${userId}`);
      const data = await res.json();
      if (data.memories) {
        setMemories(data.memories);
      }
    } catch {
      toast.error('Failed to load memories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemories();
  }, [userId]);

  const deleteMemory = async (memoryId: string) => {
    if (!userId) return;
    try {
      await fetch(`/api/memory/${userId}/${memoryId}`, { method: 'DELETE' });
      setMemories(prev => prev.filter(m => m.id !== memoryId));
      toast.success('Memory deleted from permanent storage');
    } catch {
      toast.error('Failed to delete memory');
    }
  };

  const clearAllMemories = async () => {
    if (!userId) return;
    if (!window.confirm("WARNING: This will wipe Jarvis's entire memory base for your account. Are you sure?")) return;
    try {
      const res = await fetch(`/api/memory/clear/${userId}`, { method: 'DELETE' });
      const data = await res.json();
      setMemories([]);
      toast.success(`Wiped ${data.clearedCount} memories successfully.`);
    } catch {
      toast.error('Failed to clear memories');
    }
  };

  const injectMemory = async () => {
    if (!userId || !manualMemoryText.trim()) return;
    setIsInjecting(true);
    try {
      await fetch('/api/memory/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          text: `[User Explicit Rule]: ${manualMemoryText}`,
          type: 'semantic'
        })
      });
      toast.success('Rule injected into permanent memory');
      setManualMemoryText('');
      await fetchMemories();
    } catch {
      toast.error('Failed to inject memory');
    } finally {
      setIsInjecting(false);
    }
  };

  const migrateMemories = async () => {
    if (!userId) return;
    setIsMigrating(true);
    try {
      const res = await fetch(`/api/memory/migrate/${userId}`, { method: 'POST' });
      const data = await res.json();
      toast.success(`Migration complete! ${data.migrated} memories recovered, ${data.skipped} skipped.`);
      await fetchMemories();
    } catch {
      toast.error('Migration failed');
    } finally {
      setIsMigrating(false);
    }
  };

  // Compute stats
  const totalMemories = memories.length;
  const webStudiesCount = memories.filter(m => m.text.includes('Knowledge acquired from')).length;
  const tradeLessonsCount = memories.filter(m => m.text.includes('[TRADE LESSON]') || m.text.includes('Trade Lesson')).length;
  const userRulesCount = memories.filter(m => m.text.includes('[User Explicit Rule]')).length;
  const generalMemoriesCount = totalMemories - webStudiesCount - tradeLessonsCount - userRulesCount;

  // Filter for search
  const filteredMemories = memories.filter(m => 
    m.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getMemoryIcon = (text: string) => {
    if (text.includes('Knowledge acquired from')) return <Globe className="w-4 h-4 text-blue-400" />;
    if (text.includes('[User Explicit Rule]')) return <ShieldCheck className="w-4 h-4 text-emerald-400" />;
    return <Database className="w-4 h-4 text-purple-400" />;
  };

  const getMemoryTag = (text: string) => {
    if (text.includes('Knowledge acquired from')) return { label: 'Web Intel', color: 'blue' };
    if (text.includes('[User Explicit Rule]')) return { label: 'User Rule', color: 'emerald' };
    if (text.includes('[TRADE LESSON]') || text.includes('Trade Lesson')) return { label: 'Trade Lesson', color: 'amber' };
    return { label: 'General', color: 'purple' };
  };

  return (
    <div className="flex flex-col h-full bg-black overflow-hidden relative p-6">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-purple-900/10 via-black to-black opacity-60" />

      {/* Header */}
      <div className="flex items-center justify-between mb-6 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
            <BrainCircuit className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white uppercase tracking-wider">Memory Base</h2>
            <p className="text-zinc-500 text-xs font-medium">Permanent vector knowledge storage</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={migrateMemories}
            disabled={isMigrating}
            className="px-4 py-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg text-xs font-bold hover:bg-amber-500/20 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <Download className="w-3.5 h-3.5" />
            {isMigrating ? 'Migrating...' : 'Recover Lost Memories'}
          </button>
          <button 
            onClick={clearAllMemories}
            disabled={memories.length === 0}
            className="px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs font-bold hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            Wipe Memory
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 mb-6 relative z-10">
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1 flex items-center gap-1.5">
            <Network className="w-3.5 h-3.5" /> Total Embeddings
          </div>
          <div className="text-2xl font-black text-white">{totalMemories}</div>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-blue-400" /> Web Studies
          </div>
          <div className="text-2xl font-black text-blue-400">{webStudiesCount}</div>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1 flex items-center gap-1.5">
            <GraduationCap className="w-3.5 h-3.5 text-amber-400" /> Trade Lessons
          </div>
          <div className="text-2xl font-black text-amber-400">{tradeLessonsCount}</div>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-emerald-400" /> User Rules
          </div>
          <div className="text-2xl font-black text-emerald-400">{userRulesCount}</div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex gap-6 h-0 flex-1 relative z-10">
        
        {/* Left Column: Memory Feed */}
        <div className="w-2/3 flex flex-col bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-zinc-800 flex items-center gap-3 bg-zinc-900/80">
            <Search className="w-4 h-4 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Search memories (e.g., 'SUI' or 'RSI')..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            />
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-600 space-y-3">
                <BrainCircuit className="w-8 h-8 animate-pulse" />
                <span className="text-xs font-semibold">Accessing permanent storage...</span>
              </div>
            ) : filteredMemories.length > 0 ? (
              <AnimatePresence>
                {filteredMemories.map(memory => {
                  const tag = getMemoryTag(memory.text);
                  return (
                    <motion.div
                      key={memory.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      className="bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 transition-colors rounded-lg p-4 group"
                    >
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-${tag.color}-500/10 text-${tag.color}-400 border border-${tag.color}-500/20`}>
                            {tag.label}
                          </span>
                          <span className="text-[10px] text-zinc-500 font-mono">
                            {new Date(memory.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <button 
                          onClick={() => deleteMemory(memory.id)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                          title="Forget this memory"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                        {memory.text}
                      </p>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-zinc-600 space-y-2">
                <Database className="w-8 h-8 opacity-20" />
                <span className="text-xs">No memories found matching your search.</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Memory Injection */}
        <div className="w-1/3 flex flex-col gap-4">
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 flex flex-col h-full">
            <h3 className="text-xs font-black text-zinc-300 uppercase tracking-wider flex items-center gap-2 mb-4">
              <Plus className="w-4 h-4 text-emerald-400" />
              Manual Injection
            </h3>
            <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
              Directly inject a trading rule, preference, or fact into Jarvis's permanent vector storage. It will recall this during context generation.
            </p>
            <textarea
              value={manualMemoryText}
              onChange={e => setManualMemoryText(e.target.value)}
              placeholder="e.g., 'Never trade meme coins on weekends.' or 'If RSI is > 80, I prefer to wait for a pullback before shorting.'"
              className="w-full flex-1 bg-zinc-900/80 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 outline-none focus:border-emerald-500/50 resize-none custom-scrollbar mb-4"
            />
            <button
              onClick={injectMemory}
              disabled={isInjecting || !manualMemoryText.trim()}
              className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs rounded-lg transition-colors disabled:opacity-40"
            >
              {isInjecting ? 'Injecting...' : 'Inject into Memory'}
            </button>
          </div>
          
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4">
             <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wider flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4 text-amber-400" />
              How Jarvis Learns
            </h3>
            <ul className="text-[11px] text-zinc-500 space-y-2 leading-relaxed">
              <li>• <strong className="text-zinc-300">Web Studies:</strong> "Jarvis, study binance.com/docs" — extracts strategies.</li>
              <li>• <strong className="text-zinc-300">Conversations:</strong> "Remember that I don't trade SOL" — saves a User Rule.</li>
              <li>• <strong className="text-zinc-300">Context:</strong> During every trade analysis, the Swarm searches this memory bank to augment its prompt.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// A simple missing icon definition since ShieldCheck isn't in the import list of the original code snippet
function ShieldCheck(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

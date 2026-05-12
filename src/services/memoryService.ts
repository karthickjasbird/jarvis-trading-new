import { GoogleGenAI } from '@google/genai';
import { toast } from 'sonner';

export interface MemoryEntry {
  id: string;
  timestamp: number;
  summary: string;
  type: 'conversation' | 'trade_lesson';
}

export const memoryService = {
  // We keep a local cache to preserve the UI components easily without massive refactoring,
  // but we primarily rely on the backend Vector DB for true AI context.
  localCache: [] as MemoryEntry[],

  async summarizeAndSave(transcript: string, userId: string) {
    if (!transcript || transcript.trim().length < 50 || !userId) return; 

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-preview',
        contents: `Summarize the following conversation between a user and their AI assistant Jarvis. Focus on key facts, user preferences, and important context that Jarvis should remember for future interactions. Keep it concise.
        
Conversation:
${transcript}`,
      });

      const summary = response.text;
      if (summary) {
        // Save to backend Vector Database
        await fetch('/api/memory/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, text: summary, type: 'episodic' })
        });
        console.log("[Memory Service] Vector Memory saved successfully.");

        // Push to local cache for UI (just for visual representation)
        const entry: MemoryEntry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          summary,
          type: 'conversation'
        };
        this.localCache.unshift(entry);
      }
    } catch (error) {
      console.error('Failed to summarize conversation:', error);
    }
  },

  async analyzeAndSaveTrade(trade: any, userId: string) {
    if (!userId) return null;
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const isWin = trade.pnl > 0;
      const prompt = `Analyze this recently closed trade and extract a concise, 1-2 sentence lesson or observation for the user's trading journal.
      
Trade Details:
- Symbol: ${trade.symbol}
- Side: ${trade.side.toUpperCase()}
- Quantity: ${trade.quantity}
- Entry Price: $${trade.entryPrice}
- Exit Price: $${trade.exitPrice}
- PnL: $${trade.pnl} (${isWin ? 'WIN' : 'LOSS'})
- Mode: ${trade.mode}
- Practice Mode: ${trade.isPractice ? 'Yes' : 'No'}

Focus on what can be learned. If it's a loss, what might have gone wrong? If it's a win, what went right? Keep it brief and actionable.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-preview',
        contents: prompt,
      });

      const summary = response.text;
      if (summary) {
        const text = `Trade Lesson (${trade.symbol} ${isWin ? 'Win' : 'Loss'}): ${summary}`;
        
        // Save to backend Vector Database
        await fetch('/api/memory/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, text, type: 'semantic' })
        });

        const entry: MemoryEntry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          summary: text,
          type: 'trade_lesson'
        };

        this.localCache.unshift(entry);
        
        toast.success(`Jarvis learned a new lesson from your ${trade.symbol} trade!`, {
          description: summary,
          icon: '🧠'
        });
        
        return entry;
      }
    } catch (error) {
      console.error('Failed to analyze trade:', error);
    }
    return null;
  },

  getMemories(): MemoryEntry[] {
    return this.localCache;
  },

  async getFormattedContext(userId: string | undefined, query: string = "user rules, preferences and recent trading behavior", marketIntel?: { news: any[], whaleAlerts: any[] }): Promise<string> {
    let context = '';

    // Fetch highly relevant memories from Vector DB
    if (userId) {
      try {
        const res = await fetch('/api/memory/recall', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, query, limit: 5 })
        });
        const data = await res.json();
        
        if (data.status === 'success' && data.memories && data.memories.length > 0) {
          context += '--- RELEVANT CORE MEMORIES (Vector Retrieved) ---\n';
          context += data.memories.join('\n\n');
          context += '\n\n';
        }
      } catch (err) {
        console.warn("Failed to fetch memories from Vector DB:", err);
      }
    }

    if (marketIntel) {
      context += '--- LIVE MARKET INTEL ---\n';
      
      if (marketIntel.news && marketIntel.news.length > 0) {
        context += 'RECENT NEWS:\n';
        marketIntel.news.slice(0, 5).forEach(n => {
          context += `- [${n.symbol} | ${n.sentiment.toUpperCase()}] ${n.title} (${n.source})\n`;
        });
        context += '\n';
      }

      if (marketIntel.whaleAlerts && marketIntel.whaleAlerts.length > 0) {
        context += 'RECENT WHALE ALERTS:\n';
        marketIntel.whaleAlerts.slice(0, 5).forEach(w => {
          context += `- [${w.urgency.toUpperCase()}] ${w.amount} ${w.symbol} ($${w.valueUsd.toLocaleString()}) ${w.action} from ${w.from} to ${w.to}\n`;
        });
        context += '\n';
      }
    }

    return context || 'No past context available.';
  },
  
  async fetchBackendMemories(userId: string): Promise<MemoryEntry[]> {
    try {
      const res = await fetch(`/api/memory/list/${userId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.status === 'success' && data.memories) {
        // Map backend representation to UI MemoryEntry format
        return data.memories.map((m: any) => ({
          id: m.id,
          timestamp: new Date(m.createdAt).getTime(),
          summary: m.text,
          type: m.type === 'semantic' ? 'trade_lesson' : 'conversation'
        }));
      }
    } catch (e) {
      console.error('Failed to fetch backend memories:', e);
    }
    return [];
  },

  async deleteBackendMemory(userId: string, memoryId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/memory/${userId}/${memoryId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return data.status === 'success';
    } catch (e) {
      console.error('Failed to delete backend memory:', e);
      return false;
    }
  },

  clearMemories() {
    this.localCache = [];
  },

  async clearAllBackendMemories(userId: string): Promise<number> {
    try {
      const res = await fetch(`/api/memory/clear/${userId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.localCache = [];
      return data.deletedCount || 0;
    } catch (e) {
      console.error('Failed to clear all backend memories:', e);
      return 0;
    }
  }
};

import { GoogleGenAI } from '@google/genai';
import { toast } from 'sonner';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';

export interface MemoryEntry {
  id: string;
  timestamp: number;
  summary: string;
  type: 'conversation' | 'trade_lesson';
}

export const memoryService = {
  async summarizeAndSave(transcript: string) {
    if (!transcript || transcript.trim().length < 50) return; // Don't summarize very short interactions

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Summarize the following conversation between a user and their AI assistant Jarvis. Focus on key facts, user preferences, and important context that Jarvis should remember for future interactions. Keep it concise.
        
Conversation:
${transcript}`,
      });

      const summary = response.text;
      if (summary) {
        const entry: MemoryEntry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          summary,
          type: 'conversation'
        };

        const existingMemories = this.getMemories();
        existingMemories.push(entry);
        
        // Keep only the last 15 memories to avoid context window explosion
        if (existingMemories.length > 15) {
          existingMemories.shift();
        }

        localStorage.setItem('jarvis_memories', JSON.stringify(existingMemories));
      }
    } catch (error) {
      console.error('Failed to summarize conversation:', error);
    }
  },

  async analyzeAndSaveTrade(trade: any, userId: string) {
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
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });

      const summary = response.text;
      if (summary) {
        const entry: MemoryEntry = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          summary: `Trade Lesson (${trade.symbol} ${isWin ? 'Win' : 'Loss'}): ${summary}`,
          type: 'trade_lesson'
        };

        // Save to Firestore
        if (userId) {
          try {
            await addDoc(collection(db, 'users', userId, 'trading_memories'), {
              ...entry,
              tradeId: trade.id || trade.tradeId,
              symbol: trade.symbol,
              pnl: trade.pnl,
              isPractice: trade.isPractice || false
            });
          } catch (e) {
            console.error("Failed to save memory to Firestore", e);
          }
        }

        // Also save to local storage for immediate UI context
        const existingMemories = this.getMemories();
        existingMemories.push(entry);
        
        if (existingMemories.length > 15) {
          existingMemories.shift();
        }

        localStorage.setItem('jarvis_memories', JSON.stringify(existingMemories));
        
        // Notify user
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
    try {
      const data = localStorage.getItem('jarvis_memories');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  getFormattedContext(marketIntel?: { news: any[], whaleAlerts: any[] }): string {
    const memories = this.getMemories();
    let context = '';

    if (memories.length > 0) {
      context += '--- PAST CONVERSATION MEMORIES & TRADE LESSONS ---\n';
      context += memories
        .map((m) => {
          const date = new Date(m.timestamp).toLocaleString();
          const typeLabel = m.type === 'trade_lesson' ? '[TRADE LESSON]' : '[CONVERSATION]';
          return `${typeLabel} [${date}]: ${m.summary}`;
        })
        .join('\n\n');
      context += '\n\n';
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
  
  clearMemories() {
    localStorage.removeItem('jarvis_memories');
  }
};

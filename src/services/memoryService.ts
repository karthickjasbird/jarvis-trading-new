import { GoogleGenAI } from '@google/genai';

export interface MemoryEntry {
  id: string;
  timestamp: number;
  summary: string;
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
        };

        const existingMemories = this.getMemories();
        existingMemories.push(entry);
        
        // Keep only the last 10 memories to avoid context window explosion
        if (existingMemories.length > 10) {
          existingMemories.shift();
        }

        localStorage.setItem('jarvis_memories', JSON.stringify(existingMemories));
      }
    } catch (error) {
      console.error('Failed to summarize conversation:', error);
    }
  },

  getMemories(): MemoryEntry[] {
    try {
      const data = localStorage.getItem('jarvis_memories');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  getFormattedContext(): string {
    const memories = this.getMemories();
    if (memories.length === 0) return 'No past context available.';

    return memories
      .map((m) => {
        const date = new Date(m.timestamp).toLocaleString();
        return `[${date}]: ${m.summary}`;
      })
      .join('\n\n');
  },
  
  clearMemories() {
    localStorage.removeItem('jarvis_memories');
  }
};

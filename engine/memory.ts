import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';
import * as cheerio from 'cheerio';
import { generateTextForPurpose } from './modelRouter.ts';

export interface MemoryItem {
  id: string;
  userId: string;
  text: string;
  type: 'episodic' | 'semantic';
  embedding: number[];
  createdAt: string;
}

export class MemoryManager {
  private defaultAI: GoogleGenAI;
  private userAICache: Map<string, GoogleGenAI> = new Map();
  private db: admin.firestore.Firestore;
  private mockMemories: MemoryItem[] = []; // Fallback for when Firebase credentials are missing

  constructor(db: admin.firestore.Firestore) {
    this.db = db;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("MemoryManager: GEMINI_API_KEY not found. Memory features will not work.");
    }
    this.defaultAI = new GoogleGenAI({ apiKey: apiKey || '' });
  }

  /**
   * Get the appropriate GoogleGenAI instance for a user.
   * Uses per-user key if available, otherwise falls back to default.
   */
  private getAI(userGeminiKey?: string): GoogleGenAI {
    if (!userGeminiKey) return this.defaultAI;
    if (!this.userAICache.has(userGeminiKey)) {
      this.userAICache.set(userGeminiKey, new GoogleGenAI({ apiKey: userGeminiKey }));
    }
    return this.userAICache.get(userGeminiKey)!;
  }

  // Calculate Cosine Similarity for Vector Math
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async generateEmbedding(text: string, userGeminiKey?: string): Promise<number[]> {
    try {
      const ai = this.getAI(userGeminiKey);
      const response = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: text,
      });
      return response.embeddings?.[0]?.values || [];
    } catch (error) {
      console.error("MemoryManager: Failed to generate embedding", error);
      return [];
    }
  }

  async saveMemory(userId: string, text: string, type: 'episodic' | 'semantic' = 'episodic', userGeminiKey?: string): Promise<void> {
    const embedding = await this.generateEmbedding(text, userGeminiKey);
    if (!embedding || embedding.length === 0) {
      console.warn("MemoryManager: Generated empty embedding, skipping save.");
      return;
    }

    const memory: MemoryItem = {
      id: crypto.randomUUID(), // Local ID generated for push and mock use
      userId,
      text,
      type,
      embedding,
      createdAt: new Date().toISOString()
    };

    try {
      const { id, ...firestoreData } = memory; // Exclude 'id' — Firestore auto-generates doc IDs
      await this.db.collection('users').doc(userId).collection('memories').add(firestoreData);
      console.log(`[Memory Bank] Saved ${type} memory for ${userId}: "${text.substring(0, 50)}..."`);
    } catch (e: any) {
      console.warn(`[Memory Bank Warning] Firestore save failed, using local mock fallback. Error: ${e.message}`);
      this.mockMemories.push(memory);
    }
  }

  async recallMemories(userId: string, queryText: string, limit: number = 5, userGeminiKey?: string): Promise<string[]> {
    const queryEmbedding = await this.generateEmbedding(queryText, userGeminiKey);
    if (!queryEmbedding || queryEmbedding.length === 0) return [];

    let memories: (MemoryItem & { similarity: number })[] = [];

    try {
      const snapshot = await this.db.collection('users').doc(userId).collection('memories').get();
      if (!snapshot.empty) {
        snapshot.forEach(doc => {
          const data = doc.data();
          const similarity = this.cosineSimilarity(queryEmbedding, data.embedding || []);
          memories.push({
            id: doc.id,
            ...(data as any),
            similarity
          });
        });
      }
    } catch (e: any) {
      // Fallback
      memories = this.mockMemories
        .filter(m => m.userId === userId || userId === 'global_knowledge_base')
        .map(data => ({
          ...data,
          similarity: this.cosineSimilarity(queryEmbedding, data.embedding || [])
        }));
    }

    const relevantMemories = memories
      .filter(m => m.similarity > 0.5) 
      .sort((a, b) => b.similarity - a.similarity);

    const topResults = relevantMemories.slice(0, limit);
    return topResults.map(m => `[Memory from ${new Date(m.createdAt).toLocaleString()}]: ${m.text}`);
  }

  async listMemories(userId: string): Promise<MemoryItem[]> {
    try {
      const snapshot = await this.db.collection('users').doc(userId).collection('memories').orderBy('createdAt', 'desc').get();
      if (snapshot.empty) return [];

      const memories: MemoryItem[] = [];
      snapshot.forEach(doc => {
        memories.push({
          id: doc.id,
          ...(doc.data() as Omit<MemoryItem, 'id'>)
        });
      });
      return memories;
    } catch (e: any) {
      // Fallback
      return this.mockMemories
        .filter(m => m.userId === userId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
  }

  async deleteMemory(userId: string, memoryId: string): Promise<void> {
    try {
      await this.db.collection('users').doc(userId).collection('memories').doc(memoryId).delete();
      console.log(`[Memory Bank] Deleted memory ${memoryId} for user ${userId}`);
    } catch (e: any) {
      console.warn(`[Memory Bank Warning] Firestore delete failed, attempting local mock removal. Error: ${e.message}`);
      const initialLength = this.mockMemories.length;
      this.mockMemories = this.mockMemories.filter(m => m.id !== memoryId);
      if (this.mockMemories.length < initialLength) {
         console.log(`[Memory Bank] Deleted mock memory ${memoryId} for user ${userId}`);
      }
    }
  }

  async clearAllMemories(userId: string): Promise<number> {
    try {
      const snapshot = await this.db.collection('users').doc(userId).collection('memories').get();
      if (snapshot.empty) return 0;

      const batch = this.db.batch();
      snapshot.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      console.log(`[Memory Bank] Cleared all ${snapshot.size} memories for user ${userId}`);
      return snapshot.size;
    } catch (e: any) {
      console.warn(`[Memory Bank Warning] Firestore clear failed, clearing mock. Error: ${e.message}`);
      const count = this.mockMemories.filter(m => m.userId === userId).length;
      this.mockMemories = this.mockMemories.filter(m => m.userId !== userId);
      return count;
    }
  }

  async studyUrl(userId: string, url: string, onProgress?: (stage: string, progress: number, message: string) => void, model?: string): Promise<string> {
    try {
      const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();

      onProgress?.('fetching', 10, `Downloading ${hostname}...`);
      const response = await fetch(url.trim(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      onProgress?.('parsing', 35, 'Extracting content...');
      const html = await response.text();
      const $ = cheerio.load(html);
      
      // Remove noise
      $('script, style, nav, footer, header, aside').remove();
      
      // Extract main readable text
      const rawText = $('body').text().replace(/\s+/g, ' ').trim();
      
      onProgress?.('summarizing', 60, `Analyzing with ${(model || 'gemini-2.5-flash').replace('groq/', '')}...`);
      // We don't want to embed the entire raw site content because it makes vector search sparse.
      // E.g., if it's a 10,000 word page, we'll compress it down to core principles.
      const prompt = `You are a trading analyst distilling knowledge. Read the following raw text scraped from a website and summarize the core trading strategies, market indicators, or financial concepts discussed. Return ONLY the summarized bullet points or rules that a trader should remember. Limit to 300 words. \n\nRaw Text: ${rawText.substring(0, 30000)}`;

      const summary = await generateTextForPurpose('memory-summary', prompt, { model });
      if (!summary) throw new Error("Failed to generate summary from the page.");

      onProgress?.('embedding', 85, 'Generating embeddings...');
      // Save as semantic knowledge (embedding happens inside saveMemory)

      onProgress?.('storing', 95, 'Saving to Memory Bank...');
      await this.saveMemory(userId, `Knowledge acquired from [${url}]:\n${summary}`, 'semantic');
      
      onProgress?.('complete', 100, '✓ Knowledge stored!');
      return summary;
    } catch (error) {
      console.error(`[Memory Bank] Failed to study url ${url}:`, error);
      throw error;
    }
  }

  /**
   * Deep crawl: discover all internal links on a website and study every page.
   * Processes in batches of 20, saves each page to memory, and continues until done.
   */
  async deepStudyUrl(
    userId: string,
    startUrl: string,
    onProgress?: (stage: string, progress: number, message: string, meta?: any) => void,
    model?: string
  ): Promise<{ pagesStudied: number; totalPages: number }> {
    const BATCH_SIZE = 20;
    const DELAY_MS = 1000; // 1 second between pages to be polite
    const visited = new Set<string>();
    const queue: string[] = [];
    const allDiscovered = new Set<string>();

    const baseUrl = new URL(startUrl);
    const baseDomain = baseUrl.hostname;

    // Helper: normalize URL and check if it's an internal, crawlable link
    const normalizeUrl = (href: string): string | null => {
      try {
        const resolved = new URL(href, startUrl);
        // Same domain only
        if (resolved.hostname !== baseDomain) return null;
        // Skip anchors, mailto, javascript, media files
        if (resolved.hash && resolved.pathname === baseUrl.pathname) return null;
        const ext = resolved.pathname.split('.').pop()?.toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'pdf', 'mp4', 'mp3', 'zip', 'css', 'js'].includes(ext || '')) return null;
        // Strip hash and trailing slash for dedup
        resolved.hash = '';
        let clean = resolved.toString();
        if (clean.endsWith('/') && clean !== startUrl) clean = clean.slice(0, -1);
        return clean;
      } catch {
        return null;
      }
    };

    // Helper: fetch a page and extract internal links + text
    const fetchPage = async (url: string): Promise<{ text: string; links: string[] }> => {
      const res = await fetch(url.trim(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const $ = cheerio.load(html);

      // Extract links before removing navigation
      const links: string[] = [];
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
          const normalized = normalizeUrl(href);
          if (normalized && !allDiscovered.has(normalized)) {
            links.push(normalized);
            allDiscovered.add(normalized);
          }
        }
      });

      // Remove noise for text extraction
      $('script, style, nav, footer, header, aside').remove();
      const rawText = $('body').text().replace(/\s+/g, ' ').trim();

      return { text: rawText, links };
    };

    try {
      // Phase 1: Discover all pages
      onProgress?.('discovering', 5, `Scanning ${baseDomain} for pages...`);
      const startPage = await fetchPage(startUrl);
      visited.add(startUrl);
      allDiscovered.add(startUrl);

      // BFS to discover all internal links
      let discoveryQueue = [...startPage.links];
      while (discoveryQueue.length > 0) {
        const nextBatch = discoveryQueue.splice(0, 10); // discover 10 at a time
        for (const link of nextBatch) {
          if (visited.has(link)) continue;
          visited.add(link);
          try {
            await new Promise(r => setTimeout(r, 500)); // Short delay for discovery
            const page = await fetchPage(link);
            discoveryQueue.push(...page.links);
            onProgress?.('discovering', 5, `Found ${allDiscovered.size} pages on ${baseDomain}...`);
          } catch {
            // Skip pages that fail during discovery
          }
        }
        // Safety cap: don't discover more than 200 pages
        if (allDiscovered.size > 200) break;
      }

      const allPages = Array.from(allDiscovered);
      const totalPages = allPages.length;
      onProgress?.('discovered', 10, `Found ${totalPages} pages. Starting deep study...`, { totalPages });

      // Phase 2: Reset visited for actual studying, process in batches
      let pagesStudied = 0;

      for (let batchStart = 0; batchStart < totalPages; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, totalPages);
        const batch = allPages.slice(batchStart, batchEnd);
        const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(totalPages / BATCH_SIZE);

        onProgress?.('batch-start', Math.round((pagesStudied / totalPages) * 90) + 10,
          `Batch ${batchNum} of ${totalBatches} (pages ${batchStart + 1}-${batchEnd} of ${totalPages})`,
          { pagesStudied, totalPages, batchNum, totalBatches });

        for (const pageUrl of batch) {
          pagesStudied++;
          const pageProgress = Math.round((pagesStudied / totalPages) * 90) + 10;
          const pageName = (() => { try { return new URL(pageUrl).pathname; } catch { return pageUrl; } })();

          try {
            onProgress?.('studying', pageProgress,
              `Page ${pagesStudied} of ${totalPages}: ${pageName}`,
              { pagesStudied, totalPages });

            // Fetch the page content
            const res = await fetch(pageUrl.trim(), {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            if (!res.ok) {
              console.warn(`[Deep Study] Skipping ${pageUrl}: HTTP ${res.status}`);
              continue;
            }
            const html = await res.text();
            const $ = cheerio.load(html);
            $('script, style, nav, footer, header, aside').remove();
            const rawText = $('body').text().replace(/\s+/g, ' ').trim();

            if (rawText.length < 100) {
              console.warn(`[Deep Study] Skipping ${pageUrl}: too little content (${rawText.length} chars)`);
              continue;
            }

            // Summarize
            const prompt = `You are a trading analyst distilling knowledge. Read the following raw text scraped from a website and summarize the core trading strategies, market indicators, or financial concepts discussed. Return ONLY the summarized bullet points or rules that a trader should remember. Limit to 300 words. \n\nRaw Text: ${rawText.substring(0, 30000)}`;

            const summary = await generateTextForPurpose('memory-summary-batch', prompt, { userId, model });
            if (summary) {
              await this.saveMemory(userId, `Knowledge acquired from [${pageUrl}]:\n${summary}`, 'semantic');
            }

            // Polite delay between pages
            await new Promise(r => setTimeout(r, DELAY_MS));
          } catch (pageError: any) {
            console.warn(`[Deep Study] Error on ${pageUrl}: ${pageError.message}`);
            // Continue with next page
          }
        }

        onProgress?.('batch-complete', Math.round((pagesStudied / totalPages) * 90) + 10,
          `Batch ${batchNum} complete — ${pagesStudied} pages saved to memory`,
          { pagesStudied, totalPages, batchNum, totalBatches });
      }

      onProgress?.('complete', 100, `✓ Deep study complete! Studied ${pagesStudied} pages from ${baseDomain}`,
        { pagesStudied, totalPages });

      return { pagesStudied, totalPages };
    } catch (error) {
      console.error(`[Memory Bank] Deep study failed for ${startUrl}:`, error);
      throw error;
    }
  }
}

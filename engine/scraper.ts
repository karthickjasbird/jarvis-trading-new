import Parser from 'rss-parser';
import { GoogleGenAI } from '@google/genai';
import { MemoryManager } from './memory.ts';
import { generateText } from './modelRouter.ts';
import dotenv from 'dotenv';
dotenv.config();

const parser = new Parser();

export class MarketScraper {
  private memoryManager: MemoryManager;

  constructor(memoryManager: MemoryManager) {
    this.memoryManager = memoryManager;
  }

  async runBackgroundScraping() {
    try {
      console.log("[Market Scraper] Waking up to analyze current market narratives...");
      
      const feed = await parser.parseURL('https://cointelegraph.com/rss');
      
      // Grab top 10 articles
      const articles = feed.items.slice(0, 10).map(item => `- ${item.title}: ${item.contentSnippet || item.content}`).join('\n');
      
      if (!articles) {
        console.warn("[Market Scraper] No news fetched to analyze.");
        return;
      }

      const prompt = `Analyze the following recent crypto news headlines and snippets. \n\n${articles}\n\nBased on this information, write a concise 2-3 sentence summary of the current overarching market sentiment and narrative. Is the market mostly bullish, bearish, or uncertain? What are the key drivers? Start the response with "Market Narrative:"`;

      const narrative = await generateText('gemini-2.5-flash', prompt);
      
      if (narrative) {
        console.log("[Market Scraper] Deduced Narrative:", narrative);
        
        // Save to a global knowledge base so Jarvis can mix this overarching sentiment into his context.
        await this.memoryManager.saveMemory(
          'global_knowledge_base', 
          narrative + ` (Scraped on ${new Date().toDateString()})`,
          'semantic'
        );
        console.log("[Market Scraper] Narrative successfully embedded into Vector Memory Bank.");
      }

    } catch (e) {
      console.error("[Market Scraper] Failed to run scraping cycle:", e);
    }
  }
}

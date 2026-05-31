/**
 * Market Sentiment Pipeline — Multi-Source News + Fear & Greed Fusion
 * 
 * FIX #5: Upgraded from a skeletal 52-line single-RSS scraper to a
 * professional sentiment fusion pipeline.
 * 
 * Sources:
 *   1. CoinTelegraph RSS (news)
 *   2. CoinDesk RSS (news)
 *   3. The Block RSS (news)
 *   4. Alternative.me Fear & Greed Index (numeric sentiment)
 * 
 * Produces:
 *   - Numeric sentiment score (0-100)
 *   - Classification (extreme_fear / fear / neutral / greed / extreme_greed)
 *   - AI-synthesized narrative (2-3 sentences)
 *   - Top 3 fundamental market drivers
 * 
 * Saves to:
 *   - Firestore `marketSentiment` collection (for API access)
 *   - MemoryManager (for Scholar semantic recall)
 */

import Parser from 'rss-parser';
import { MemoryManager } from './memory.ts';
// v1.7.0 — LLM narrative generation removed. Sentiment now derived
// deterministically from Fear & Greed + headline counts. No Gemini calls.
import dotenv from 'dotenv';
dotenv.config();

const parser = new Parser();

// RSS feed sources
const RSS_FEEDS = [
  { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'TheBlock', url: 'https://www.theblock.co/rss.xml' },
];

export interface SentimentResult {
  sentimentScore: number;         // 0-100 (0 = extreme panic, 100 = extreme greed)
  classification: string;         // 'extreme_fear' | 'fear' | 'neutral' | 'greed' | 'extreme_greed'
  fearGreedIndex: number | null;  // Raw Fear & Greed value from API
  fearGreedLabel: string;         // API classification string
  narrative: string;              // AI-synthesized 2-3 sentence summary
  drivers: string[];              // Top 3 market drivers
  sources: string[];              // Which RSS feeds were successfully scraped
  headlineCount: number;          // Total headlines processed
  timestamp: string;
}

export class MarketScraper {
  private memoryManager: MemoryManager;
  private db: any;
  private lastResult: SentimentResult | null = null;

  constructor(memoryManager: MemoryManager, db?: any) {
    this.memoryManager = memoryManager;
    this.db = db || null;
  }

  /**
   * Get the last computed sentiment result (for API access)
   */
  getLastResult(): SentimentResult | null {
    return this.lastResult;
  }

  /**
   * Fetch Fear & Greed Index from Alternative.me
   */
  private async fetchFearGreedIndex(): Promise<{ value: number; label: string } | null> {
    try {
      const res = await fetch('https://api.alternative.me/fng/?limit=1');
      if (!res.ok) throw new Error(`Fear & Greed API error: ${res.status}`);
      const data = await res.json();
      if (data?.data?.[0]) {
        return {
          value: parseInt(data.data[0].value, 10),
          label: data.data[0].value_classification,
        };
      }
      return null;
    } catch (err: any) {
      console.error('[SENTIMENT] Fear & Greed API failed:', err.message);
      return null;
    }
  }

  /**
   * Scrape multiple RSS feeds in parallel, deduplicate, return top headlines
   */
  private async scrapeAllFeeds(): Promise<{ headlines: string[]; sources: string[] }> {
    const allHeadlines: string[] = [];
    const successfulSources: string[] = [];
    const seenTitles = new Set<string>();

    const results = await Promise.allSettled(
      RSS_FEEDS.map(async (feed) => {
        const parsed = await parser.parseURL(feed.url);
        return { name: feed.name, items: parsed.items || [] };
      })
    );

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const { name, items } = result.value;
      successfulSources.push(name);

      for (const item of items.slice(0, 8)) {
        const title = item.title?.trim();
        if (!title || seenTitles.has(title.toLowerCase())) continue;
        seenTitles.add(title.toLowerCase());
        const snippet = item.contentSnippet?.slice(0, 120) || '';
        allHeadlines.push(`[${name}] ${title}${snippet ? ': ' + snippet : ''}`);
      }
    }

    return { headlines: allHeadlines.slice(0, 15), sources: successfulSources };
  }

  /**
   * Run the full sentiment pipeline: scrape → analyze → store
   */
  async runBackgroundScraping(): Promise<SentimentResult | null> {
    try {
      console.log('[SENTIMENT] 🔄 Running multi-source sentiment pipeline...');

      // Step 1: Fetch Fear & Greed Index + RSS feeds in parallel
      const [fearGreed, feedData] = await Promise.all([
        this.fetchFearGreedIndex(),
        this.scrapeAllFeeds(),
      ]);

      const { headlines, sources } = feedData;

      if (headlines.length === 0 && !fearGreed) {
        console.warn('[SENTIMENT] No data from any source — skipping this cycle.');
        return null;
      }

      console.log(`[SENTIMENT] 📡 Scraped ${headlines.length} headlines from ${sources.join(', ')}`);
      if (fearGreed) {
        console.log(`[SENTIMENT] 😱 Fear & Greed Index: ${fearGreed.value} (${fearGreed.label})`);
      }

      // v1.7.0 — Step 2: derive sentiment deterministically from F&G + headline
      // counts. NO LLM. The previous narrative-generation prompt cost ~$3/month
      // and produced text the rules engine doesn't use as input anyway.
      const fgScore = fearGreed?.value ?? 50;
      const classification: SentimentResult['classification'] =
        fgScore <= 20 ? 'extreme_fear' :
        fgScore <= 40 ? 'fear' :
        fgScore <= 60 ? 'neutral' :
        fgScore <= 80 ? 'greed' : 'extreme_greed';
      const result: SentimentResult = {
        sentimentScore: fgScore,
        classification,
        fearGreedIndex: fearGreed?.value ?? null,
        fearGreedLabel: fearGreed?.label ?? 'N/A',
        narrative: `Fear & Greed ${fgScore} (${fearGreed?.label ?? 'N/A'}). ${headlines.length} headlines from ${sources.join(', ')}.`,
        drivers: [
          fearGreed ? `F&G ${fgScore} (${fearGreed.label})` : 'No F&G data',
          `${headlines.length} headlines`,
          `${sources.length} sources`,
        ],
        sources,
        headlineCount: headlines.length,
        timestamp: new Date().toISOString(),
      };

      // Step 3: Save to Firestore (for API endpoint)
      if (this.db) {
        try {
          await this.db.collection('marketSentiment').doc('latest').set(result);
          console.log('[SENTIMENT] 💾 Saved to Firestore marketSentiment/latest');
        } catch (err: any) {
          console.error('[SENTIMENT] Firestore save failed:', err.message);
        }
      }

      // Step 4: Save narrative to MemoryManager for Scholar semantic recall
      try {
        const memoryText = `[MARKET SENTIMENT] Score: ${result.sentimentScore}/100 (${result.classification}) | F&G: ${result.fearGreedIndex ?? 'N/A'} | ${result.narrative} | Drivers: ${result.drivers.join(', ')} (${new Date().toDateString()})`;
        await this.memoryManager.saveMemory('global_knowledge_base', memoryText, 'semantic');
        console.log('[SENTIMENT] 🧠 Narrative embedded into Memory Bank');
      } catch (err: any) {
        console.error('[SENTIMENT] Memory save failed:', err.message);
      }

      this.lastResult = result;
      console.log(`[SENTIMENT] ✅ Pipeline complete: ${result.sentimentScore}/100 (${result.classification}) — ${result.drivers.join(', ')}`);

      return result;
    } catch (e: any) {
      console.error('[SENTIMENT] Pipeline failed:', e.message);
      return null;
    }
  }
}

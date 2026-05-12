import { GoogleGenAI } from '@google/genai';
import { search, SafeSearchType } from 'duck-duck-scrape';
import { MemoryManager } from './memory.ts';

export class WebAgent {
  private ai: GoogleGenAI;
  private memoryManager: MemoryManager;

  constructor(memoryManager: MemoryManager) {
    this.memoryManager = memoryManager;
    const apiKey = process.env.GEMINI_API_KEY;
    this.ai = new GoogleGenAI({ apiKey: apiKey || '' });
  }

  /**
   * Starts an asynchronous background loop for Jarvis to independently research a topic.
   */
  async startResearch(userId: string, topic: string, durationMinutes: number): Promise<void> {
    const startTime = Date.now();
    const durationMs = durationMinutes * 60 * 1000;
    const visitedUrls: Set<string> = new Set();
    const researchLog: string[] = [];
    
    console.log(`[WebAgent] Mission Started: Researching "${topic}" for ${durationMinutes} minutes (User: ${userId})`);
    
    let iterations = 0;
    while (Date.now() - startTime < durationMs && iterations < 20) { // Max 20 iterations safety net
      iterations++;
      const timeRemaining = Math.max(0, Math.floor((durationMs - (Date.now() - startTime)) / 60000));
      
      const prompt = `You are Jarvis, an autonomous financial research agent.
Your mission is to comprehensively research the topic: "${topic}".
Time remaining: ${timeRemaining} minutes.

Current Session Log (what we've done so far):
${researchLog.length > 0 ? researchLog.join('\n') : "No actions taken yet."}

You have the ability to:
1. "SEARCH": Execute a web search to find relevant URLs.
2. "STUDY": Visit a specific URL to scrape, summarize, and permanently memorize its contents. 
3. "COMPLETE": End the session because you feel you have gathered enough rich knowledge on the topic.

Based on the current log, what is your next action?
Respond ONLY with a valid JSON object in this format, with no markdown formatting:
{
  "action": "SEARCH" | "STUDY" | "COMPLETE",
  "target": "the search query or the specific URL string to study",
  "reason": "short explanation of why"
}
`;

      try {
        const response = await this.ai.models.generateContent({
          model: 'gemini-3.1-flash',
          contents: prompt
        });

        const rawResponse = response.text || "{}";
        const cleanJsonStr = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        const decision = JSON.parse(cleanJsonStr);

        console.log(`[WebAgent] Loop ${iterations}: decided to ${decision.action} -> ${decision.target}`);
        
        if (decision.action === 'SEARCH') {
          researchLog.push(`[Action: SEARCH] Query: ${decision.target}`);
          
          const searchResults = await search(decision.target, { safeSearch: SafeSearchType.STRICT });
          
          if (searchResults && searchResults.results && searchResults.results.length > 0) {
            const topResults = searchResults.results.slice(0, 3).map(r => ` - ${r.title}: ${r.url}`).join('\n');
            researchLog.push(`[Search Results]\n${topResults}`);
          } else {
            researchLog.push(`[Search Results] No results found for query.`);
          }
        } 
        else if (decision.action === 'STUDY') {
          researchLog.push(`[Action: STUDY] URL: ${decision.target}`);
          
          if (visitedUrls.has(decision.target)) {
            researchLog.push(`[Study Result] Skipped. URL already studied in this session.`);
          } else {
            visitedUrls.add(decision.target);
            try {
              const summary = await this.memoryManager.studyUrl(userId, decision.target);
              researchLog.push(`[Study Result] Successfully extracted and saved knowledge: ${summary.substring(0, 80)}...`);
            } catch (err: any) {
              researchLog.push(`[Study Result] Failed to read URL: ${err.message}`);
            }
          }
        }
        else if (decision.action === 'COMPLETE') {
          console.log(`[WebAgent] Mission complete for ${userId}. Reason: ${decision.reason}`);
          break;
        }

        // Small pause to respect external APIs
        await new Promise(r => setTimeout(r, 2000));
        
      } catch (e: any) {
         console.error("[WebAgent] Evaluation/JSON Parsing error:", e.message);
         // Prevent rapid looping if LLM messes up JSON continuously
         await new Promise(r => setTimeout(r, 5000));
      }
    }
    
    console.log(`[WebAgent] Research session finished. Total iterations executed: ${iterations}`);
  }
}

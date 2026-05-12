import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const sessionPromise = ai.live.connect({ model: 'gemini-3.1-flash-live-preview', callbacks: {
  onopen: () => {
    sessionPromise.then(s => {
      console.log("METHODS:", Object.getOwnPropertyNames(Object.getPrototypeOf(s)));
      process.exit(0);
    });
  }
} });

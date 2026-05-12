import { GoogleGenAI, Modality } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const sessionPromise = ai.live.connect({ 
  model: 'gemini-3.1-flash-live-preview',
});
sessionPromise.then(s => {
  s.sendClientContent({ turns: [{ role: 'user', parts: [{ text: "Hello" }] }], turnComplete: true });
  s.onmessage = (msg) => { console.log(JSON.stringify(msg).substring(0, 100)); process.exit(0); };
});

import { GoogleGenAI, Modality } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const sessionPromise = ai.live.connect({ 
  model: 'gemini-2.0-flash-exp',
  callbacks: {
    onopen: () => {
      console.log("Connected");
      sessionPromise.then(s => {
        s.sendClientContent({ turns: [{ role: 'user', parts: [{ text: "Hello" }] }], turnComplete: true });
      });
    },
    onmessage: (msg) => { console.log("msg:", JSON.stringify(msg).substring(0, 50)); },
    onerror: (e) => { console.log("error:", e); },
    onclose: (e) => { console.log("closed:", e.code, e.reason); process.exit(0); }
  }
});

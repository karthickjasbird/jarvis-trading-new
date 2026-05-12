import { GoogleGenAI, Modality } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const sessionPromise = ai.live.connect({ 
  model: 'gemini-3.1-flash-live-preview',
  callbacks: {
    onopen: () => {
      console.log("Connected");
      sessionPromise.then(s => {
        s.sendRealtimeInput({ text: "Hello" });
      });
    },
    onmessage: (msg) => { console.log("msg:", JSON.stringify(msg).substring(0, 50)); },
    onerror: (e) => { console.log("error:", e); },
    onclose: (e) => { console.log("closed:", e.code, e.reason); process.exit(0); }
  }
});

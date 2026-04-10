import { GoogleGenAI, Modality } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const sessionPromise = ai.live.connect({ 
  model: 'gemini-3.1-flash-live-preview',
  config: {
    responseModalities: [Modality.AUDIO],
    systemInstruction: "You are a helpful assistant.",
    outputAudioTranscription: {}
  },
  callbacks: {
    onopen: () => {
      console.log("Connected");
      sessionPromise.then(s => {
        s.sendRealtimeInput({ text: "Hello, can you hear me?" });
      });
    },
    onmessage: (msg) => {
      if (msg.serverContent?.modelTurn) {
        console.log("Model turn received");
        process.exit(0);
      }
    },
    onerror: (e) => {
      console.error("Error:", e);
    },
    onclose: () => {
      console.log("Closed");
    }
  }
});
setTimeout(() => {}, 10000);

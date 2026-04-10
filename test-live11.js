import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: 'dummy' });
const session = ai.live.connect({ model: 'gemini-3.1-flash-live-preview' });
session.then(s => {
  try {
    s.sendClientContent({ turns: [{ role: 'user', parts: [{ text: "Hello" }] }], turnComplete: true });
    console.log("Success 1");
  } catch (e) {
    console.error("Error 1", e);
  }
  try {
    s.sendClientContent({ turns: "Hello", turnComplete: true });
    console.log("Success 2");
  } catch (e) {
    console.error("Error 2", e);
  }
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});

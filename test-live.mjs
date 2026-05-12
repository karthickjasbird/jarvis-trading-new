import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
console.log("Connecting...");
try {
  const sessionPromise = ai.live.connect({
    model: 'gemini-3.1-flash-live-preview',
    config: {
      systemInstruction: "You are a test agent"
    }
  });
  
  sessionPromise.then(session => {
    console.log("Connected!");
    session.sendClientContent({ turns: "Hello!" });
    console.log("Message sent!");
  }).catch(e => console.error("Session Promise rejected:", e));
  
} catch (e) {
  console.error("Failed!", e);
}

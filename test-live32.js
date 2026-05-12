import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: 'dummy' });
ai.live.connect({ model: 'gemini-3.1-flash-live-preview' }).then(s => {
  console.log("METHODS:");
  for (let k in s) {
    if (typeof s[k] === 'function') console.log(k);
  }
  process.exit(0);
}).catch(()=>process.exit(0));

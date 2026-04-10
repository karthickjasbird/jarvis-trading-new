import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: 'dummy' });
const session = ai.live.connect({ model: 'gemini-3.1-flash-live-preview' });
session.then(s => {
  console.log(s.send.toString());
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});

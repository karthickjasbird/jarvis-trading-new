import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: 'dummy' });
const session = ai.live.connect({ model: 'gemini-3.1-flash-live-preview' });
session.then(s => {
  console.log(Object.keys(s));
  console.log('sendClientContent:', typeof s.sendClientContent);
  console.log('send:', typeof s.send);
  console.log('sendRealtimeInput:', typeof s.sendRealtimeInput);
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});

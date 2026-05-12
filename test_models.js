import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function checkModel(modelName) {
  return new Promise(resolve => {
    ai.live.connect({ model: modelName, callbacks: {
      onopen: () => resolve(modelName + " SUCCESS"),
      onclose: (e) => resolve(modelName + " CLOSED: " + e.reason)
    }}).catch(e => resolve(modelName + " ERR"));
  });
}
async function run() {
  const models = ['gemini-2.0-flash-exp', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash-thinking-exp-01-21', 'gemini-3.1-flash-live-preview'];
  for (const m of models) console.log(await checkModel(m));
  process.exit(0);
}
run();

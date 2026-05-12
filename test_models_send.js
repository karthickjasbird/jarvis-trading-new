import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function checkModel(modelName) {
  return new Promise(resolve => {
    let sessionPromise = ai.live.connect({ model: modelName, callbacks: {
      onopen: () => {
        sessionPromise.then(s => {
          try {
             s.sendClientContent({ turns: [{ role: 'user', parts: [{ text: "Hello" }] }], turnComplete: true });
          } catch(e) { resolve(modelName + " SEND ERR"); }
        });
      },
      onmessage: (msg) => { if (msg.serverContent?.modelTurn) resolve(modelName + " REPLIED"); },
      onclose: (e) => resolve(modelName + " CLOSED: " + e.reason)
    }}).catch(e => resolve(modelName + " CONNECT ERR"));
  });
}
async function run() {
  const models = ['gemini-2.0-flash-exp', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-3.1-flash-live-preview'];
  for (const m of models) console.log(await checkModel(m));
  process.exit(0);
}
run();

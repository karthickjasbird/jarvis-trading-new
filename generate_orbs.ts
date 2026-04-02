import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateImage(prompt: string, filename: string) {
  console.log(`Generating ${filename}...`);
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: prompt,
    });
    
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        fs.writeFileSync(`public/${filename}`, Buffer.from(part.inlineData.data, 'base64'));
        console.log(`Saved ${filename}`);
        break;
      }
    }
  } catch (e) {
    console.error(`Failed to generate ${filename}:`, e);
  }
}

async function main() {
  await generateImage('UI design asset, a highly professional, sleek, futuristic AI assistant voice orb. Glowing cyan and blue holographic energy core, intricate geometric HUD rings, dark background, cinematic lighting, 8k resolution, clean, modern.', 'orb-option1.png');
  await generateImage('UI design asset, a minimalist, elegant futuristic AI voice assistant interface. A smooth, glowing white and silver liquid metal sphere surrounded by subtle, glowing soundwave particles. Dark background, premium UI design, sleek, sophisticated.', 'orb-option2.png');
  await generateImage('UI design asset, an abstract, high-tech AI assistant visualization. A cluster of glowing neon purple and pink geometric shards forming a dynamic sphere, with data streams orbiting it. Dark background, cyberpunk UI style, highly detailed.', 'orb-option3.png');
}

main();

import fs from 'fs';
const content = fs.readFileSync('node_modules/@google/genai/dist/genai.d.ts', 'utf8');
const lines = content.split('\n');
console.log(lines.slice(0, 20).join('\n'));

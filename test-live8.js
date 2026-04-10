import fs from 'fs';
const content = fs.readFileSync('node_modules/@google/genai/dist/genai.d.ts', 'utf8');
const lines = content.split('\n');
const startIndex = lines.findIndex(l => l.includes('class LiveSession'));
if (startIndex !== -1) {
  console.log(lines.slice(startIndex, startIndex + 50).join('\n'));
} else {
  console.log('LiveSession not found');
}

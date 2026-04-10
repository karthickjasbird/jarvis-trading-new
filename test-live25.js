import fs from 'fs';
const content = fs.readFileSync('node_modules/@google/genai/dist/genai.d.ts', 'utf8');
const lines = content.split('\n');
const startIndex = lines.findIndex(l => l.includes('sendToolResponse('));
if (startIndex !== -1) {
  console.log(lines.slice(startIndex - 5, startIndex + 5).join('\n'));
} else {
  console.log('sendToolResponse not found');
}

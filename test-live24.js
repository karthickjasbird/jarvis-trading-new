import fs from 'fs';
const content = fs.readFileSync('node_modules/@google/genai/dist/genai.d.ts', 'utf8');
const lines = content.split('\n');
const startIndex = lines.findIndex(l => l.includes('sendToolResponse('));
if (startIndex !== -1) {
  const paramMatch = lines[startIndex].match(/params: types\.([^)]+)/);
  if (paramMatch) {
    const paramType = paramMatch[1];
    const typeIndex = lines.findIndex(l => l.includes(`interface ${paramType}`) || l.includes(`type ${paramType}`));
    if (typeIndex !== -1) {
      console.log(lines.slice(typeIndex, typeIndex + 10).join('\n'));
    } else {
      console.log(paramType + ' not found');
    }
  }
}

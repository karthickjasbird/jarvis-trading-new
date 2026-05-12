const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/memory/study-stream',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}, res => {
  res.on('data', d => process.stdout.write(d));
});
req.write(JSON.stringify({ userId: '123', url: 'https://example.com', model: 'gemma-4-31b-it' }));
req.end();

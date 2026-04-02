fetch('http://localhost:3000/api/market-data?symbol=BTC/USDT').then(r => r.text()).then(console.log).catch(console.error);

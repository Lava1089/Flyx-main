#!/usr/bin/env node
/**
 * Test if we can fetch JWT directly without proxy
 */

const https = require('https');

const JWT_URL = 'https://hitsplay.fun/premiumtv/daddyhd.php?id=31';

function fetchDirect(url) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://dlhd.link/',
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data,
          time: Date.now() - start,
        });
      });
    });
    req.on('error', (e) => resolve({ error: e.message, time: Date.now() - start }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', time: Date.now() - start }); });
  });
}

async function main() {
  console.log('Testing direct JWT fetch from hitsplay.fun...\n');
  
  const result = await fetchDirect(JWT_URL);
  
  console.log(`Status: ${result.status || 'N/A'}`);
  console.log(`Time: ${result.time}ms`);
  
  if (result.error) {
    console.log(`Error: ${result.error}`);
    return;
  }
  
  // Check for JWT
  const jwtMatch = result.data.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (jwtMatch) {
    console.log(`\n✅ JWT FOUND! Direct fetch works!`);
    console.log(`JWT: ${jwtMatch[0].substring(0, 50)}...`);
  } else {
    console.log(`\n❌ No JWT found`);
    console.log(`Response preview: ${result.data.substring(0, 200)}`);
  }
}

main().catch(console.error);

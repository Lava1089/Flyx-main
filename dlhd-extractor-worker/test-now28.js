// Test: Can we get a REAL key from dvalna.ru by waiting out the rate limit?
// Retry-After is only 6 seconds — this isn't a permanent ban!
// We just need to not hammer the server.
const https = require('https');
const crypto = require('crypto');

function httpsReq(url, headers = {}, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout, family: 4,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Rate Limit Recovery Test ===');
  console.log('Time:', new Date().toISOString());
  console.log('Retry-After is 6s — waiting 10s before first attempt...\n');

  // Wait 10 seconds to let rate limit expire
  await sleep(10000);

  // Try a single key request with NO auth (just to see if rate limit cleared)
  const servers = ['chevy', 'zeko', 'nfs', 'ddy6'];
  
  for (const srv of servers) {
    // Try without 'new' suffix first
    for (const suffix of ['', 'new']) {
      const host = `${srv}${suffix}.dvalna.ru`;
      const url = `https://${host}/key/premium44/5901618`;
      console.log(`Testing ${host}...`);
      try {
        const res = await httpsReq(url, {
          'Referer': 'https://codepcplay.fun/',
          'Origin': 'https://codepcplay.fun',
        });
        const hex = res.data.length === 16 
          ? Array.from(res.data).map(b => b.toString(16).padStart(2, '0')).join('')
          : null;
        const isFake = hex === '45c6497365ca4c64c83460adca4e65ee';
        const isError = hex && hex.startsWith('6572726f72');
        
        if (res.status === 200 && hex && !isFake && !isError) {
          console.log(`  ✅ ${res.status} REAL KEY: ${hex}`);
        } else if (isFake) {
          console.log(`  ⚠️ ${res.status} FAKE KEY: ${hex}`);
        } else if (isError) {
          console.log(`  🚫 ${res.status} RATE LIMITED (error in body)`);
        } else {
          console.log(`  ❌ ${res.status} ${res.data.length}b ${res.data.toString().substring(0, 60)}`);
        }
      } catch (e) {
        console.log(`  💀 ${e.message}`);
      }
      
      // Wait 7 seconds between each request to avoid re-triggering rate limit
      console.log('  Waiting 7s...');
      await sleep(7000);
    }
  }
}

main().catch(console.error);

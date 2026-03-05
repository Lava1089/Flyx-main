const https = require('https');

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  // Fetch the obfuscated.js that contains EPlayerAuth
  console.log('Fetching /obfuscated.js from codepcplay.fun...');
  const r = await httpsGet('https://codepcplay.fun/obfuscated.js', { 'Referer': 'https://codepcplay.fun/' });
  console.log('Status:', r.status, 'Size:', r.data.length);
  
  const js = r.data.toString('utf8');
  
  // Find EPlayerAuth definition
  const epaIdx = js.indexOf('EPlayerAuth');
  if (epaIdx >= 0) {
    console.log('\nEPlayerAuth found at index:', epaIdx);
    // Print surrounding context
    console.log(js.substring(Math.max(0, epaIdx - 100), epaIdx + 3000));
  } else {
    console.log('EPlayerAuth NOT found in obfuscated.js');
    console.log('First 500 chars:', js.substring(0, 500));
  }
  
  // Find getXhrSetup
  const xhrIdx = js.indexOf('getXhrSetup');
  if (xhrIdx >= 0) {
    console.log('\n\n=== getXhrSetup found at index:', xhrIdx, '===');
    console.log(js.substring(Math.max(0, xhrIdx - 500), xhrIdx + 2000));
  }
  
  // Find any cookie references
  const cookieIdx = js.indexOf('cookie');
  if (cookieIdx >= 0) {
    console.log('\n\n=== cookie reference at index:', cookieIdx, '===');
    console.log(js.substring(Math.max(0, cookieIdx - 200), cookieIdx + 500));
  }
  
  // Find key-related patterns
  const patterns = ['X-Key-', 'Authorization', 'Bearer', 'setRequestHeader', 'xhr.open', 'XMLHttpRequest'];
  for (const p of patterns) {
    const idx = js.indexOf(p);
    if (idx >= 0) {
      console.log(`\n=== "${p}" at index ${idx} ===`);
      console.log(js.substring(Math.max(0, idx - 200), idx + 500));
    }
  }
}

main().catch(console.error);

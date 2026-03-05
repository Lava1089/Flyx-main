// Find how config.streamUrl is set in lovetier.bz
// Also test the /api endpoint
const https = require('https');

function httpsReq(url, headers = {}, timeout = 15000, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout, family: 4,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log('=== lovetier.bz config extraction ===');
  
  // Get the full page
  const r = await httpsReq('https://lovetier.bz/player/ESPN', { 'Referer': 'https://lovecdn.ru/' });
  const html = r.data.toString('utf8');
  
  // Find "config" variable assignment
  console.log('[1] Searching for config object...');
  const configPatterns = [
    /config\s*=\s*\{[^}]+\}/g,
    /config\s*=\s*JSON\.parse/g,
    /const\s+config\s*=/g,
    /var\s+config\s*=/g,
    /let\s+config\s*=/g,
    /window\.config\s*=/g,
  ];
  for (const p of configPatterns) {
    let m;
    while ((m = p.exec(html)) !== null) {
      const ctx = html.substring(m.index, Math.min(m.index + 500, html.length));
      console.log(`  Found at ${m.index}: ${ctx.substring(0, 300)}`);
    }
  }
  
  // Find fetch/ajax calls to /api
  console.log('\n[2] Searching for API calls...');
  const apiPatterns = [
    /fetch\s*\(\s*["'][^"']*api[^"']*["']/gi,
    /\.get\s*\(\s*["'][^"']*api[^"']*["']/gi,
    /\.post\s*\(\s*["'][^"']*api[^"']*["']/gi,
    /XMLHttpRequest/gi,
    /\/api\/[a-z]+/gi,
    /lovetier\.bz\/api/gi,
  ];
  for (const p of apiPatterns) {
    let m;
    while ((m = p.exec(html)) !== null) {
      const ctx = html.substring(Math.max(0, m.index - 100), Math.min(m.index + 400, html.length));
      console.log(`  Found "${m[0]}" at ${m.index}:`);
      console.log(`  ${ctx.substring(0, 400)}`);
    }
  }
  
  // Try the API endpoint directly
  console.log('\n[3] Testing lovetier.bz/api...');
  const apiTests = [
    { url: 'https://lovetier.bz/api', method: 'GET' },
    { url: 'https://lovetier.bz/api/ESPN', method: 'GET' },
    { url: 'https://lovetier.bz/api/stream/ESPN', method: 'GET' },
    { url: 'https://lovetier.bz/api/config/ESPN', method: 'GET' },
    { url: 'https://lovetier.bz/api/player/ESPN', method: 'GET' },
    { url: 'https://lovetier.bz/api', method: 'POST', body: JSON.stringify({ stream: 'ESPN' }), ct: 'application/json' },
    { url: 'https://lovetier.bz/api/ESPN', method: 'POST', body: '', ct: 'application/json' },
  ];
  
  for (const test of apiTests) {
    try {
      const headers = { 'Referer': 'https://lovetier.bz/', 'Origin': 'https://lovetier.bz' };
      if (test.ct) headers['Content-Type'] = test.ct;
      const resp = await httpsReq(test.url, headers, 8000, test.method, test.body);
      const text = resp.data.toString('utf8').substring(0, 300);
      console.log(`  ${test.method} ${test.url}: ${resp.status} - ${text}`);
    } catch (e) { console.log(`  ${test.method} ${test.url}: ERROR ${e.message}`); }
  }
  
  // Search for the stream name in the obfuscated code
  console.log('\n[4] Searching for stream name in JS...');
  const espnIdx = html.indexOf('ESPN');
  if (espnIdx !== -1) {
    // Find all occurrences
    let idx = 0;
    let count = 0;
    while ((idx = html.indexOf('ESPN', idx)) !== -1 && count < 10) {
      const ctx = html.substring(Math.max(0, idx - 50), Math.min(idx + 100, html.length));
      console.log(`  ESPN at ${idx}: ...${ctx}...`);
      idx += 4;
      count++;
    }
  }
  
  // Look for the streamUrl being set from response
  console.log('\n[5] Searching for streamUrl assignment...');
  const streamUrlPatterns = [
    /streamUrl/g,
    /stream_url/g,
    /streamURL/g,
  ];
  for (const p of streamUrlPatterns) {
    let m;
    while ((m = p.exec(html)) !== null) {
      const ctx = html.substring(Math.max(0, m.index - 100), Math.min(m.index + 300, html.length));
      console.log(`  ${m[0]} at ${m.index}: ${ctx.substring(0, 300)}`);
    }
  }
}

main().catch(console.error);

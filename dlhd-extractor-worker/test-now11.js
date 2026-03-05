// Test kiko2.ru and giokko.ru domains via RPI proxy
// dvalna.ru is 429'd - maybe the other domains aren't
const https = require('https');
const crypto = require('crypto');

function httpsReq(url, headers = {}, family = 4) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout: 20000, family,
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

function classifyKey(data) {
  const hex = data.toString('hex');
  if (data.length === 16) {
    if (hex.startsWith('45c6497') || hex.startsWith('455806f8')) return 'FAKE';
    if (hex.startsWith('6572726f72')) return 'RATE-LIMITED';
    if (hex === '00000000000000000000000000000000') return 'NULL';
    return 'REAL-KEY';
  }
  const text = data.toString('utf8').substring(0, 200);
  if (text.includes('error code')) return 'RATE-LIMITED';
  return 'UNKNOWN(' + data.length + 'b): ' + text.substring(0, 80);
}

async function main() {
  console.log('=== Testing kiko2.ru and giokko.ru domains ===');
  console.log('Time:', new Date().toISOString());
  
  const rpiKey = process.env.RPI_PROXY_API_KEY;
  if (!rpiKey) {
    console.error('ERROR: Set RPI_PROXY_API_KEY environment variable');
    process.exit(1);
  }
  
  // Get auth
  const authResult = await httpsReq('https://codepcplay.fun/premiumtv/daddyhd.php?id=51', { 'Referer': 'https://dlhd.link/' });
  const html = authResult.data.toString('utf8');
  const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
  const authToken = initMatch[1].match(/authToken\s*:\s*["']([^"']+)["']/)[1];
  const channelSalt = initMatch[1].match(/channelSalt\s*:\s*["']([^"']+)["']/)[1];
  
  // Get M3U8 for live key URL
  const m3u8 = await httpsReq('https://zekonew.dvalna.ru/zeko/premium51/mono.css', {
    'Referer': 'https://hitsplay.fun/', 'Origin': 'https://hitsplay.fun',
    'Authorization': `Bearer ${authToken}`,
  });
  const keyLine = m3u8.data.toString('utf8').split('\n').find(l => l.includes('EXT-X-KEY'));
  const keyUri = keyLine.match(/URI="([^"]+)"/)[1];
  const keyMatch = keyUri.match(/\/key\/([^/]+)\/(\d+)/);
  const resource = keyMatch[1];
  const keyNumber = keyMatch[2];
  console.log('Key:', resource + '/' + keyNumber);
  
  // Compute V5 headers
  const ts = Math.floor(Date.now() / 1000);
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const fp = crypto.createHash('sha256').update(ua + '1920x1080' + 'America/New_York' + 'en-US').digest('hex').substring(0, 16);
  const hmacPrefix = crypto.createHmac('sha256', channelSalt).update(resource).digest('hex');
  let nonce = 0;
  for (let n = 0; n < 100000; n++) {
    const data = hmacPrefix + resource + keyNumber + ts + n;
    const hash = crypto.createHash('md5').update(data).digest('hex');
    if (parseInt(hash.substring(0, 4), 16) < 0x1000) { nonce = n; break; }
  }
  const keyPath = crypto.createHmac('sha256', channelSalt).update(`${resource}|${keyNumber}|${ts}|${fp}`).digest('hex').substring(0, 16);
  
  const v5Headers = {
    'Accept': '*/*',
    'Origin': 'https://codepcplay.fun', 'Referer': 'https://codepcplay.fun/',
    'Authorization': `Bearer ${authToken}`,
    'X-Key-Timestamp': ts.toString(), 'X-Key-Nonce': nonce.toString(),
    'X-Key-Path': keyPath, 'X-Fingerprint': fp,
  };
  
  const servers = ['chevy', 'zekonew', 'ddy6new', 'windnew', 'nfsnew', 'dokko1new'];
  const domains = ['kiko2.ru', 'giokko.ru'];
  
  // Test 1: Key requests via RPI proxy to kiko2.ru and giokko.ru
  console.log('\n[1] Key requests via RPI /fetch to kiko2.ru and giokko.ru...');
  for (const domain of domains) {
    for (const server of servers) {
      const altKeyUrl = `https://${server}.${domain}/key/${resource}/${keyNumber}`;
      try {
        const url = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(altKeyUrl)}&headers=${encodeURIComponent(JSON.stringify(v5Headers))}&key=${rpiKey}`;
        const r = await httpsReq(url, { 'X-API-Key': rpiKey });
        const cls = classifyKey(r.data);
        console.log(`  ${server}.${domain}: status=${r.status}, upstream=${r.headers['x-upstream-status'] || '?'}, ${r.data.length}b, ${cls}, hex=${r.data.toString('hex').substring(0, 32)}`);
      } catch (e) { console.log(`  ${server}.${domain}: ERROR ${e.message}`); }
    }
  }
  
  // Test 2: M3U8 requests to kiko2.ru and giokko.ru (do they serve M3U8 too?)
  console.log('\n[2] M3U8 requests to kiko2.ru and giokko.ru...');
  for (const domain of domains) {
    for (const server of ['zeko', 'chevy', 'ddy6']) {
      const m3u8Url = `https://${server}new.${domain}/${server}/premium51/mono.css`;
      try {
        const r = await httpsReq(m3u8Url, {
          'Referer': 'https://hitsplay.fun/', 'Origin': 'https://hitsplay.fun',
          'Authorization': `Bearer ${authToken}`,
        });
        const text = r.data.toString('utf8').substring(0, 100);
        const isM3u8 = text.includes('#EXTM3U') || text.includes('#EXT-X-');
        console.log(`  ${server}new.${domain}: status=${r.status}, ${r.data.length}b, ${isM3u8 ? 'VALID M3U8' : text.substring(0, 60)}`);
      } catch (e) { console.log(`  ${server}new.${domain}: ERROR ${e.message}`); }
    }
  }
  
  // Test 3: Direct from this machine to kiko2.ru/giokko.ru (no RPI)
  console.log('\n[3] Direct key requests (no RPI) to kiko2.ru and giokko.ru...');
  for (const domain of domains) {
    const altKeyUrl = `https://chevy.${domain}/key/${resource}/${keyNumber}`;
    try {
      const r = await httpsReq(altKeyUrl, v5Headers);
      const cls = classifyKey(r.data);
      console.log(`  chevy.${domain}: status=${r.status}, ${r.data.length}b, ${cls}`);
    } catch (e) { console.log(`  chevy.${domain}: ERROR ${e.message}`); }
  }
  
  // Also re-check dvalna.ru for comparison
  console.log('\n[4] dvalna.ru comparison (expect 429)...');
  try {
    const url = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(keyUri)}&headers=${encodeURIComponent(JSON.stringify(v5Headers))}&key=${rpiKey}`;
    const r = await httpsReq(url, { 'X-API-Key': rpiKey });
    const cls = classifyKey(r.data);
    console.log(`  chevy.dvalna.ru: status=${r.status}, upstream=${r.headers['x-upstream-status'] || '?'}, ${cls}`);
  } catch (e) { console.log(`  chevy.dvalna.ru: ERROR ${e.message}`); }
  
  console.log('\n=== Done ===');
}

main().catch(console.error);

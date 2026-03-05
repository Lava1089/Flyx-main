// Quick test: check if rate limit has expired on RPI proxy
// Tests: 1) auth fetch, 2) single key fetch via RPI, 3) direct from this machine
const https = require('https');
const crypto = require('crypto');

function httpsReq(url, headers = {}, family = 4) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout: 15000, family,
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

async function main() {
  console.log('=== DLHD Rate Limit Check ===');
  console.log('Time:', new Date().toISOString());
  
  // Step 1: Get auth
  console.log('\n[1] Fetching auth from codepcplay.fun...');
  let authToken, channelSalt;
  try {
    const authResult = await httpsReq('https://codepcplay.fun/premiumtv/daddyhd.php?id=51', { 'Referer': 'https://dlhd.link/' });
    const html = authResult.data.toString('utf8');
    const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
    if (!initMatch) { console.log('FAIL: No EPlayerAuth.init found'); return; }
    authToken = initMatch[1].match(/authToken\s*:\s*["']([^"']+)["']/)[1];
    channelSalt = initMatch[1].match(/channelSalt\s*:\s*["']([^"']+)["']/)[1];
    console.log('OK: authToken=' + authToken.substring(0, 30) + '...');
    console.log('OK: channelSalt=' + channelSalt.substring(0, 16) + '...');
  } catch (e) { console.log('FAIL:', e.message); return; }
  
  // Step 2: Get M3U8 to find live key URL
  console.log('\n[2] Fetching M3U8 for live key URL...');
  let resource, keyNumber, keyUri;
  try {
    const m3u8 = await httpsReq('https://zekonew.dvalna.ru/zeko/premium51/mono.css', {
      'Referer': 'https://hitsplay.fun/', 'Origin': 'https://hitsplay.fun',
      'Authorization': `Bearer ${authToken}`,
    });
    if (m3u8.status !== 200) { console.log('FAIL: M3U8 status', m3u8.status); return; }
    const keyLine = m3u8.data.toString('utf8').split('\n').find(l => l.includes('EXT-X-KEY'));
    if (!keyLine) { console.log('FAIL: No EXT-X-KEY in M3U8'); return; }
    keyUri = keyLine.match(/URI="([^"]+)"/)[1];
    const keyMatch = keyUri.match(/\/key\/([^/]+)\/(\d+)/);
    resource = keyMatch[1];
    keyNumber = keyMatch[2];
    console.log('OK: key=' + resource + '/' + keyNumber);
    console.log('OK: keyUri=' + keyUri);
  } catch (e) { console.log('FAIL:', e.message); return; }
  
  // Step 3: Compute V5 auth headers
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
  
  const headers = {
    'Accept': '*/*',
    'Origin': 'https://codepcplay.fun', 'Referer': 'https://codepcplay.fun/',
    'Authorization': `Bearer ${authToken}`,
    'X-Key-Timestamp': ts.toString(), 'X-Key-Nonce': nonce.toString(),
    'X-Key-Path': keyPath, 'X-Fingerprint': fp,
  };
  
  function classifyKey(data) {
    const hex = data.toString('hex');
    if (data.length === 16) {
      if (hex.startsWith('45c6497') || hex.startsWith('455806f8')) return 'FAKE';
      if (hex.startsWith('6572726f72')) return 'RATE-LIMITED';
      if (hex === '00000000000000000000000000000000') return 'NULL';
      return 'REAL-KEY';
    }
    const text = data.toString('utf8').substring(0, 100);
    if (text.includes('error code')) return 'RATE-LIMITED';
    if (text.includes('403') || text.includes('Forbidden')) return 'FORBIDDEN';
    return 'UNKNOWN(' + data.length + 'b)';
  }
  
  // Step 4: Test via RPI proxy (the actual path our worker uses)
  console.log('\n[3] Testing key fetch via RPI proxy /fetch (single attempt)...');
  const rpiKey = '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560';
  try {
    const rpiUrl = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(keyUri)}&headers=${encodeURIComponent(JSON.stringify(headers))}&key=${rpiKey}`;
    const r = await httpsReq(rpiUrl, { 'X-API-Key': rpiKey });
    const hex = r.data.toString('hex');
    const cls = classifyKey(r.data);
    console.log(`RPI->chevy: status=${r.status}, upstream=${r.headers['x-upstream-status'] || '?'}, ${r.data.length}b, ${cls}`);
    console.log(`  hex: ${hex.substring(0, 32)}`);
    if (cls === 'REAL-KEY') console.log('  >>> RATE LIMIT HAS EXPIRED! Keys are working! <<<');
    else if (cls === 'RATE-LIMITED') console.log('  >>> Still rate limited <<<');
    else if (cls === 'FAKE') console.log('  >>> Fake key (IP blocked or wrong auth) <<<');
  } catch (e) { console.log('ERROR:', e.message); }
  
  // Step 5: Test RPI proxy to alternative servers
  console.log('\n[4] Testing alternative servers via RPI proxy...');
  for (const server of ['zekonew', 'ddy6new']) {
    const altKeyUrl = `https://${server}.dvalna.ru/key/${resource}/${keyNumber}`;
    try {
      const rpiUrl = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(altKeyUrl)}&headers=${encodeURIComponent(JSON.stringify(headers))}&key=${rpiKey}`;
      const r = await httpsReq(rpiUrl, { 'X-API-Key': rpiKey });
      const cls = classifyKey(r.data);
      console.log(`RPI->${server}: status=${r.status}, upstream=${r.headers['x-upstream-status'] || '?'}, ${r.data.length}b, ${cls}`);
    } catch (e) { console.log(`RPI->${server}: ERROR ${e.message}`); }
  }
  
  // Step 6: Test direct from this machine (datacenter IP - expect fake)
  console.log('\n[5] Testing direct from this machine (expect fake/blocked)...');
  try {
    const r = await httpsReq(keyUri, headers);
    const cls = classifyKey(r.data);
    console.log(`Direct->chevy: status=${r.status}, ${r.data.length}b, ${cls}`);
  } catch (e) { console.log('Direct->chevy: ERROR', e.message); }
  
  console.log('\n=== Done ===');
}

main().catch(console.error);

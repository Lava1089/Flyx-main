// Test: RPI /dlhd-key endpoint (uses V5 auth internally) vs /fetch (we compute auth)
// Also test if chevy fake key is consistent or changes
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
  console.log('=== DLHD Key Fetch Comparison Test ===');
  console.log('Time:', new Date().toISOString());
  
  const rpiKey = '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560';
  
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
  
  // Test 1: RPI /dlhd-key (V5 auth computed on RPI side)
  console.log('\n[1] RPI /dlhd-key (V5 auth computed server-side)...');
  try {
    const url = `https://rpi-proxy.vynx.cc/dlhd-key?url=${encodeURIComponent(keyUri)}&key=${rpiKey}`;
    const r = await httpsReq(url, { 'X-API-Key': rpiKey });
    const cls = classifyKey(r.data);
    console.log(`  status=${r.status}, ${r.data.length}b, ${cls}, hex=${r.data.toString('hex').substring(0, 32)}`);
  } catch (e) { console.log('  ERROR:', e.message); }
  
  // Test 2: RPI /fetch with our V5 headers to chevy
  console.log('\n[2] RPI /fetch + our V5 headers -> chevy...');
  try {
    const url = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(keyUri)}&headers=${encodeURIComponent(JSON.stringify(v5Headers))}&key=${rpiKey}`;
    const r = await httpsReq(url, { 'X-API-Key': rpiKey });
    const cls = classifyKey(r.data);
    console.log(`  status=${r.status}, upstream=${r.headers['x-upstream-status']}, ${r.data.length}b, ${cls}, hex=${r.data.toString('hex').substring(0, 32)}`);
  } catch (e) { console.log('  ERROR:', e.message); }
  
  // Test 3: RPI /fetch with NO auth headers to chevy (baseline)
  console.log('\n[3] RPI /fetch + NO auth -> chevy (baseline)...');
  try {
    const url = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(keyUri)}&headers=${encodeURIComponent(JSON.stringify({}))}&key=${rpiKey}`;
    const r = await httpsReq(url, { 'X-API-Key': rpiKey });
    const cls = classifyKey(r.data);
    console.log(`  status=${r.status}, upstream=${r.headers['x-upstream-status']}, ${r.data.length}b, ${cls}, hex=${r.data.toString('hex').substring(0, 32)}`);
  } catch (e) { console.log('  ERROR:', e.message); }
  
  // Test 4: Try ALL servers via RPI /fetch with V5 headers
  console.log('\n[4] All servers via RPI /fetch + V5 headers...');
  const servers = ['chevy', 'zekonew', 'ddy6new', 'windnew', 'nfsnew', 'dokko1new'];
  for (const server of servers) {
    const altKeyUrl = `https://${server}.dvalna.ru/key/${resource}/${keyNumber}`;
    try {
      const url = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(altKeyUrl)}&headers=${encodeURIComponent(JSON.stringify(v5Headers))}&key=${rpiKey}`;
      const r = await httpsReq(url, { 'X-API-Key': rpiKey });
      const cls = classifyKey(r.data);
      console.log(`  ${server}: status=${r.status}, upstream=${r.headers['x-upstream-status'] || '?'}, ${r.data.length}b, ${cls}`);
    } catch (e) { console.log(`  ${server}: ERROR ${e.message}`); }
  }
  
  // Test 5: Try chevy with different key server hostnames (without "new" suffix)
  console.log('\n[5] Servers WITHOUT "new" suffix...');
  for (const server of ['chevy', 'zeko', 'ddy6']) {
    const altKeyUrl = `https://${server}.dvalna.ru/key/${resource}/${keyNumber}`;
    try {
      const url = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(altKeyUrl)}&headers=${encodeURIComponent(JSON.stringify(v5Headers))}&key=${rpiKey}`;
      const r = await httpsReq(url, { 'X-API-Key': rpiKey });
      const cls = classifyKey(r.data);
      console.log(`  ${server}: status=${r.status}, upstream=${r.headers['x-upstream-status'] || '?'}, ${r.data.length}b, ${cls}`);
    } catch (e) { console.log(`  ${server}: ERROR ${e.message}`); }
  }
  
  console.log('\n=== Done ===');
}

main().catch(console.error);

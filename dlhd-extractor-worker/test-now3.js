const https = require('https');
const crypto = require('crypto');

function httpsGet(url, headers = {}, family = undefined) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout: 10000,
    };
    if (family) opts.family = family;
    const req = https.get(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  // Get fresh auth
  const authResult = await httpsGet('https://codepcplay.fun/premiumtv/daddyhd.php?id=51', { 'Referer': 'https://dlhd.link/' });
  const html = authResult.data.toString('utf8');
  const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
  const authToken = initMatch[1].match(/authToken\s*:\s*["']([^"']+)["']/)[1];
  const channelSalt = initMatch[1].match(/channelSalt\s*:\s*["']([^"']+)["']/)[1];
  
  // Get actual key number from M3U8
  const m3u8 = await httpsGet('https://zekonew.dvalna.ru/zeko/premium51/mono.css', {
    'Referer': 'https://hitsplay.fun/', 'Origin': 'https://hitsplay.fun',
    'Authorization': `Bearer ${authToken}`,
  });
  const m3u8Text = m3u8.data.toString('utf8');
  const keyLine = m3u8Text.split('\n').find(l => l.includes('EXT-X-KEY'));
  const keyUri = keyLine.match(/URI="([^"]+)"/)[1];
  const keyMatch = keyUri.match(/\/key\/([^/]+)\/(\d+)/);
  const resource = keyMatch[1];
  const keyNumber = keyMatch[2];
  const keyHost = new URL(keyUri).hostname;
  
  console.log('Key URI from M3U8:', keyUri);
  console.log('Resource:', resource, 'KeyNumber:', keyNumber, 'Host:', keyHost);
  console.log('authToken:', authToken.substring(0, 60) + '...');
  console.log('channelSalt:', channelSalt);
  
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
  
  console.log('\nts:', ts, 'nonce:', nonce, 'fp:', fp, 'keyPath:', keyPath);
  
  // Test 1: Direct to chevy.dvalna.ru with V5 headers (from this machine)
  console.log('\n=== Direct fetch (this machine, IPv4) ===');
  try {
    const r = await httpsGet(keyUri, {
      'Accept': '*/*',
      'Origin': 'https://hitsplay.fun', 'Referer': 'https://hitsplay.fun/',
      'Authorization': `Bearer ${authToken}`,
      'X-Key-Timestamp': ts.toString(), 'X-Key-Nonce': nonce.toString(),
      'X-Key-Path': keyPath, 'X-Fingerprint': fp,
    }, 4);
    const hex = r.data.toString('hex');
    console.log(`Status: ${r.status}, Size: ${r.data.length}, Hex: ${hex}`);
    if (r.data.length === 16 && !hex.startsWith('45c6497') && !hex.startsWith('455806f8') && !hex.startsWith('6572726f72')) {
      console.log('REAL KEY!');
    } else if (hex.startsWith('45c6497') || hex.startsWith('455806f8')) {
      console.log('FAKE KEY - auth rejected silently');
    } else {
      console.log('Text:', r.data.toString('utf8').substring(0, 100));
    }
  } catch (e) { console.log('ERROR:', e.message); }
  
  // Test 2: Direct IPv6
  console.log('\n=== Direct fetch (this machine, IPv6) ===');
  try {
    const r = await httpsGet(keyUri, {
      'Accept': '*/*',
      'Origin': 'https://hitsplay.fun', 'Referer': 'https://hitsplay.fun/',
      'Authorization': `Bearer ${authToken}`,
      'X-Key-Timestamp': ts.toString(), 'X-Key-Nonce': nonce.toString(),
      'X-Key-Path': keyPath, 'X-Fingerprint': fp,
    }, 6);
    const hex = r.data.toString('hex');
    console.log(`Status: ${r.status}, Size: ${r.data.length}, Hex: ${hex}`);
  } catch (e) { console.log('ERROR:', e.message); }
  
  // Test 3: Via RPI /fetch with V5 headers
  console.log('\n=== Via RPI /fetch (V5 headers) ===');
  const v5h = {
    'User-Agent': ua, 'Accept': '*/*',
    'Origin': 'https://hitsplay.fun', 'Referer': 'https://hitsplay.fun/',
    'Authorization': `Bearer ${authToken}`,
    'X-Key-Timestamp': ts.toString(), 'X-Key-Nonce': nonce.toString(),
    'X-Key-Path': keyPath, 'X-Fingerprint': fp,
  };
  try {
    const rpiUrl = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(keyUri)}&headers=${encodeURIComponent(JSON.stringify(v5h))}&key=5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560`;
    const r = await httpsGet(rpiUrl, { 'X-API-Key': '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560' });
    const hex = r.data.toString('hex');
    console.log(`Status: ${r.status}, Upstream: ${r.headers['x-upstream-status']}, Size: ${r.data.length}, Hex: ${hex}`);
    if (r.data.length === 16 && !hex.startsWith('45c6497') && !hex.startsWith('455806f8') && !hex.startsWith('6572726f72')) {
      console.log('REAL KEY!');
    } else if (hex.startsWith('45c6497') || hex.startsWith('455806f8')) {
      console.log('FAKE KEY');
    } else {
      console.log('Text:', r.data.toString('utf8').substring(0, 100));
    }
  } catch (e) { console.log('ERROR:', e.message); }
  
  // Test 4: Via RPI /fetch WITHOUT V5 extra headers (just V4-style)
  console.log('\n=== Via RPI /fetch (V4-style, no X-Key-Path/X-Fingerprint) ===');
  const v4h = {
    'User-Agent': ua, 'Accept': '*/*',
    'Origin': 'https://hitsplay.fun', 'Referer': 'https://hitsplay.fun/',
    'Authorization': `Bearer ${authToken}`,
    'X-Key-Timestamp': ts.toString(), 'X-Key-Nonce': nonce.toString(),
  };
  try {
    const rpiUrl = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(keyUri)}&headers=${encodeURIComponent(JSON.stringify(v4h))}&key=5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560`;
    const r = await httpsGet(rpiUrl, { 'X-API-Key': '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560' });
    const hex = r.data.toString('hex');
    console.log(`Status: ${r.status}, Upstream: ${r.headers['x-upstream-status']}, Size: ${r.data.length}, Hex: ${hex}`);
    if (r.data.length === 16 && !hex.startsWith('45c6497') && !hex.startsWith('455806f8') && !hex.startsWith('6572726f72')) {
      console.log('REAL KEY!');
    } else if (hex.startsWith('45c6497') || hex.startsWith('455806f8')) {
      console.log('FAKE KEY');
    } else {
      console.log('Text:', r.data.toString('utf8').substring(0, 100));
    }
  } catch (e) { console.log('ERROR:', e.message); }
  
  // Test 5: What does the RPI proxy's own V4 WASM auth produce?
  console.log('\n=== Via RPI /proxy (V4 WASM internal auth) ===');
  try {
    const rpiUrl = `https://rpi-proxy.vynx.cc/proxy?url=${encodeURIComponent(keyUri)}`;
    const r = await httpsGet(rpiUrl, { 'X-API-Key': '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560' });
    const hex = r.data.toString('hex');
    console.log(`Status: ${r.status}, Size: ${r.data.length}, Hex: ${hex.substring(0, 64)}`);
    if (r.data.length === 16 && !hex.startsWith('45c6497') && !hex.startsWith('455806f8') && !hex.startsWith('6572726f72')) {
      console.log('REAL KEY!');
    } else {
      console.log('Text:', r.data.toString('utf8').substring(0, 200));
    }
  } catch (e) { console.log('ERROR:', e.message); }
}

main().catch(console.error);

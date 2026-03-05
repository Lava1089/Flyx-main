const https = require('https');
const crypto = require('crypto');

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout: 10000,
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
  // Get fresh auth
  const authResult = await httpsGet('https://codepcplay.fun/premiumtv/daddyhd.php?id=51', { 'Referer': 'https://dlhd.link/' });
  const html = authResult.data.toString('utf8');
  const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
  const authToken = initMatch[1].match(/authToken\s*:\s*["']([^"']+)["']/)[1];
  const channelSalt = initMatch[1].match(/channelSalt\s*:\s*["']([^"']+)["']/)[1];
  
  const resource = 'premium51';
  const keyNumber = '5900830';
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
  
  console.log('Auth OK. Testing key servers...\n');
  
  // Test different key server hostnames
  // The M3U8 from zekonew.dvalna.ru might have relative key URLs
  // or key URLs on a different subdomain
  const servers = ['zekonew', 'ddy6new', 'windnew', 'dokko1new', 'nfsnew', 'chevy'];
  const domains = ['dvalna.ru', 'kiko2.ru', 'giokko.ru'];
  
  // Also test with V4-style headers (no X-Key-Path, no X-Fingerprint)
  const v5Headers = {
    'User-Agent': ua, 'Accept': '*/*',
    'Origin': 'https://hitsplay.fun', 'Referer': 'https://hitsplay.fun/',
    'Authorization': `Bearer ${authToken}`,
    'X-Key-Timestamp': ts.toString(), 'X-Key-Nonce': nonce.toString(),
    'X-Key-Path': keyPath, 'X-Fingerprint': fp,
  };
  
  const v4Headers = {
    'User-Agent': ua, 'Accept': '*/*',
    'Origin': 'https://dlhd.link', 'Referer': 'https://dlhd.link/',
    'Authorization': `Bearer ${authToken}`,
    'X-Key-Timestamp': ts.toString(), 'X-Key-Nonce': nonce.toString(),
  };
  
  // Quick test: just try a few combos
  const tests = [
    { server: 'zekonew', domain: 'dvalna.ru', label: 'V5+hitsplay', headers: v5Headers },
    { server: 'zekonew', domain: 'kiko2.ru', label: 'V5+hitsplay', headers: v5Headers },
    { server: 'chevy', domain: 'dvalna.ru', label: 'V5+hitsplay', headers: v5Headers },
    { server: 'zekonew', domain: 'dvalna.ru', label: 'V4+dlhd.link', headers: v4Headers },
  ];
  
  for (const t of tests) {
    const keyUrl = `https://${t.server}.${t.domain}/key/${resource}/${keyNumber}`;
    console.log(`${t.label} @ ${t.server}.${t.domain}:`);
    try {
      const r = await httpsGet(keyUrl, t.headers);
      const hex = r.data.toString('hex');
      if (r.data.length === 16 && !hex.startsWith('6572726f72')) {
        console.log(`  ${r.status} - ${r.data.length}b - ${hex} ${hex.startsWith('455806f8') || hex.startsWith('45c6497') ? 'FAKE' : 'REAL KEY!'}`);
      } else {
        console.log(`  ${r.status} - ${r.data.length}b - ${r.data.toString('utf8').substring(0, 80)}`);
      }
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
    }
  }
  
  // Test: What does the M3U8 actually contain for key URLs?
  console.log('\n=== M3U8 key URL check ===');
  const m3u8Url = `https://zekonew.dvalna.ru/zeko/premium51/mono.css`;
  try {
    const m3u8 = await httpsGet(m3u8Url, {
      'Referer': 'https://hitsplay.fun/',
      'Origin': 'https://hitsplay.fun',
      'Authorization': `Bearer ${authToken}`,
    });
    console.log('M3U8 status:', m3u8.status);
    const m3u8Text = m3u8.data.toString('utf8');
    // Find EXT-X-KEY lines
    const keyLines = m3u8Text.split('\n').filter(l => l.includes('EXT-X-KEY'));
    console.log('Key lines found:', keyLines.length);
    if (keyLines.length > 0) {
      console.log('First key line:', keyLines[0]);
      // Extract URI
      const uriMatch = keyLines[0].match(/URI="([^"]+)"/);
      if (uriMatch) console.log('Key URI:', uriMatch[1]);
    }
  } catch (e) {
    console.log('M3U8 ERROR:', e.message);
  }
  
  // Test: RPI proxy /fetch with V4-style (no extra headers)
  console.log('\n=== RPI /fetch with minimal V4 headers ===');
  const rpiUrl = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(`https://zekonew.dvalna.ru/key/${resource}/${keyNumber}`)}&headers=${encodeURIComponent(JSON.stringify(v4Headers))}&key=5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560`;
  try {
    const r = await httpsGet(rpiUrl, { 'X-API-Key': '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560' });
    console.log('Status:', r.status, 'Upstream:', r.headers['x-upstream-status']);
    console.log('Size:', r.data.length, 'Hex:', r.data.toString('hex').substring(0, 64));
    console.log('Text:', r.data.toString('utf8').substring(0, 100));
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

main().catch(console.error);

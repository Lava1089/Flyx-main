const https = require('https');
const crypto = require('crypto');

function httpsReq(url, headers = {}, family = 4) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout: 10000, family,
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
  // Get auth
  const authResult = await httpsReq('https://codepcplay.fun/premiumtv/daddyhd.php?id=51', { 'Referer': 'https://dlhd.link/' });
  const html = authResult.data.toString('utf8');
  const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
  const authToken = initMatch[1].match(/authToken\s*:\s*["']([^"']+)["']/)[1];
  const channelSalt = initMatch[1].match(/channelSalt\s*:\s*["']([^"']+)["']/)[1];
  
  // Get live key from M3U8
  const m3u8 = await httpsReq('https://zekonew.dvalna.ru/zeko/premium51/mono.css', {
    'Referer': 'https://hitsplay.fun/', 'Origin': 'https://hitsplay.fun',
    'Authorization': `Bearer ${authToken}`,
  });
  const keyLine = m3u8.data.toString('utf8').split('\n').find(l => l.includes('EXT-X-KEY'));
  const keyUri = keyLine.match(/URI="([^"]+)"/)[1];
  const keyMatch = keyUri.match(/\/key\/([^/]+)\/(\d+)/);
  const resource = keyMatch[1];
  const keyNumber = keyMatch[2];
  console.log('Key:', resource, keyNumber);
  
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
  
  // Test ALL domain combinations via RPI proxy
  const servers = ['chevy', 'zekonew', 'ddy6new', 'windnew', 'nfsnew', 'dokko1new'];
  const domains = ['dvalna.ru', 'kiko2.ru', 'giokko.ru'];
  
  console.log('\n=== Testing ALL server.domain combos via RPI proxy ===');
  for (const domain of domains) {
    for (const server of servers) {
      const altKeyUrl = `https://${server}.${domain}/key/${resource}/${keyNumber}`;
      try {
        const rpiUrl = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(altKeyUrl)}&headers=${encodeURIComponent(JSON.stringify(headers))}&key=5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560`;
        const r = await httpsReq(rpiUrl, { 'X-API-Key': '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560' });
        const hex = r.data.toString('hex');
        const label = r.data.length === 16 && !hex.startsWith('45c6497') && !hex.startsWith('455806f8') && !hex.startsWith('6572726f72') && !hex.startsWith('00000000') ? 'REAL KEY!' :
                      hex.startsWith('45c6497') || hex.startsWith('455806f8') ? 'FAKE' :
                      hex.startsWith('6572726f72') ? 'RATE-LIM' : 'OTHER';
        console.log(`${server}.${domain}: ${r.status} (up:${r.headers['x-upstream-status'] || '?'}), ${r.data.length}b ${label} ${hex.substring(0, 16)}`);
      } catch (e) { console.log(`${server}.${domain}: ${e.message}`); }
    }
  }
  
  // Also test direct from this machine to kiko2.ru and giokko.ru
  console.log('\n=== Direct from this machine (non-dvalna domains) ===');
  for (const domain of ['kiko2.ru', 'giokko.ru']) {
    const altKeyUrl = `https://chevy.${domain}/key/${resource}/${keyNumber}`;
    try {
      const r = await httpsReq(altKeyUrl, headers);
      const hex = r.data.toString('hex');
      const label = r.data.length === 16 && !hex.startsWith('45c6497') && !hex.startsWith('455806f8') && !hex.startsWith('6572726f72') ? 'REAL KEY!' :
                    hex.startsWith('45c6497') || hex.startsWith('455806f8') ? 'FAKE' :
                    hex.startsWith('6572726f72') ? 'RATE-LIM' : 'OTHER';
      console.log(`chevy.${domain}: ${r.status}, ${r.data.length}b ${label} ${hex.substring(0, 16)}`);
    } catch (e) { console.log(`chevy.${domain}: ${e.message}`); }
  }
}

main().catch(console.error);

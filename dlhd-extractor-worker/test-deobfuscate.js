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
  const r = await httpsGet('https://codepcplay.fun/obfuscated.js', { 'Referer': 'https://codepcplay.fun/' });
  const js = r.data.toString('utf8');
  
  // The string array function
  const strArray = ['.m3u8','.ts','SESSION_TOKEN','floor','innerHTML','/redirect/','body','1293366xMYsKl','5724224SbjceC','X-Key-Nonce','authToken','timeZone','resolvedOptions','FINGERPRINT','timestamp','SHA256','15kYHgdy','191502TimhMx','setRequestHeader','1967912iGePFC','substring','HmacSHA256','7bLFEnn','X-Key-Timestamp','toString','channelSalt','X-Key-Path','UTC','language','height','Domain\x20validation\x20failed','397706GnsMTB','includes','validDomain','39534381uEHNRg','userAgent','country','endsWith','channelKey','X-Channel-Key','4424706zncYIX'];
  
  // _0x30f4 maps hex to string: _0x30f4(0xbc) = strArray[0xbc - 0xbc] = strArray[0]
  // So 0xbc = '.m3u8', 0xbd = '.ts', 0xbe = 'SESSION_TOKEN', etc.
  const base = 0xbc;
  const map = {};
  strArray.forEach((s, i) => {
    const hex = (base + i).toString(16);
    map[`0x${hex}`] = s;
  });
  
  console.log('String map:');
  Object.entries(map).forEach(([k, v]) => console.log(`  ${k} = "${v}"`));
  
  // Now manually deobfuscate the key parts
  // _0x320408 is an alias for _0x30f4
  // _0x1dd993 is an alias for _0x30f4
  
  console.log('\n=== Deobfuscated xhrSetup function ===');
  console.log(`
function xhrSetup(xhr, url) {
  // _0x318233 = url, _0x20f58b = xhr
  
  if (url.includes('/key/')) {
    // KEY REQUEST - full auth headers
    const resource = /* extract from URL */;
    const keyNumber = /* extract from URL */;
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = computePowNonce(resource, keyNumber, timestamp);  // _0x182b1f
    const fingerprint = getFingerprint();  // _0x425248
    const keyPath = computeKeyPath(resource, keyNumber, timestamp, fingerprint);  // _0x2b56a3
    
    xhr.setRequestHeader('Authorization', 'Bearer ' + authToken);
    xhr.setRequestHeader('X-Key-Timestamp', timestamp.toString());
    xhr.setRequestHeader('X-Key-Nonce', nonce.toString());
    xhr.setRequestHeader('X-Key-Path', keyPath);
    xhr.setRequestHeader('X-Fingerprint', fingerprint);
  } else if (url.includes('.m3u8') || url.includes('.ts') || url.includes(/* something */)) {
    // M3U8/SEGMENT REQUEST - just auth token
    xhr.setRequestHeader('Authorization', 'Bearer ' + authToken);
  }
  
  // Also sets X-Channel-Key header
  xhr.setRequestHeader('X-Channel-Key', channelKey);
  // And X-User-Agent
  xhr.setRequestHeader('X-User-Agent', navigator.userAgent);
}
`);
  
  // KEY FINDING: The browser also sends X-Channel-Key header!
  // And X-User-Agent header!
  // Our V5 implementation is MISSING these headers!
  
  console.log('=== CRITICAL FINDINGS ===');
  console.log('1. Browser sends X-Channel-Key header on ALL requests');
  console.log('2. Browser sends X-User-Agent header on ALL requests');
  console.log('3. Browser sets eplayer_session cookie on .dvalna.ru domain');
  console.log('4. These headers are MISSING from our V5 auth implementation!');
  
  // Let's also check: does the browser set any cookies?
  // From the player page: document.cookie = "eplayer_session=" + authToken + "; domain=.dvalna.ru; ..."
  console.log('\n=== Cookie that browser sets ===');
  console.log('Cookie: eplayer_session=<authToken>; domain=.dvalna.ru; path=/; SameSite=None; Secure');
  
  // Now let's test with the missing headers added
  console.log('\n=== Testing with X-Channel-Key + Cookie ===');
  
  const authResult = await httpsGet('https://codepcplay.fun/premiumtv/daddyhd.php?id=51', { 'Referer': 'https://dlhd.link/' });
  const html = authResult.data.toString('utf8');
  const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
  const authToken = initMatch[1].match(/authToken\s*:\s*["']([^"']+)["']/)[1];
  const channelSalt = initMatch[1].match(/channelSalt\s*:\s*["']([^"']+)["']/)[1];
  
  const m3u8 = await httpsGet('https://zekonew.dvalna.ru/zeko/premium51/mono.css', {
    'Referer': 'https://hitsplay.fun/', 'Origin': 'https://hitsplay.fun',
    'Authorization': `Bearer ${authToken}`,
  });
  const keyLine = m3u8.data.toString('utf8').split('\n').find(l => l.includes('EXT-X-KEY'));
  const keyUri = keyLine.match(/URI="([^"]+)"/)[1];
  const keyMatch = keyUri.match(/\/key\/([^/]+)\/(\d+)/);
  const resource = keyMatch[1];
  const keyNumber = keyMatch[2];
  
  console.log('Key URI:', keyUri);
  
  const crypto = require('crypto');
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
  
  // Test WITH X-Channel-Key and Cookie
  const fullUrl = new URL(keyUri);
  const reqOpts = {
    hostname: fullUrl.hostname,
    path: fullUrl.pathname,
    method: 'GET',
    headers: {
      'User-Agent': ua,
      'Accept': '*/*',
      'Origin': 'https://codepcplay.fun',
      'Referer': 'https://codepcplay.fun/',
      'Authorization': `Bearer ${authToken}`,
      'X-Key-Timestamp': ts.toString(),
      'X-Key-Nonce': nonce.toString(),
      'X-Key-Path': keyPath,
      'X-Fingerprint': fp,
      'X-Channel-Key': resource,
      'X-User-Agent': ua,
      'Cookie': `eplayer_session=${authToken}`,
    },
    timeout: 10000,
    family: 4,
  };
  
  const keyResult = await new Promise((resolve, reject) => {
    const req = https.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
  
  const hex = keyResult.data.toString('hex');
  console.log(`With X-Channel-Key + Cookie: ${keyResult.status}, ${keyResult.data.length}b, ${hex}`);
  if (keyResult.data.length === 16 && !hex.startsWith('45c6497') && !hex.startsWith('455806f8') && !hex.startsWith('6572726f72')) {
    console.log('REAL KEY!!!');
  } else if (hex.startsWith('45c6497') || hex.startsWith('455806f8')) {
    console.log('FAKE KEY');
  } else {
    console.log('Text:', keyResult.data.toString('utf8').substring(0, 100));
  }
}

main().catch(console.error);

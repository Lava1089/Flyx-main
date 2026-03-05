const https = require('https');
const crypto = require('crypto');

// Test: Is our PoW nonce actually valid?
// Compare Node.js crypto MD5 vs what the CF worker's custom MD5 would produce

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout: 10000, family: 4,
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
  
  // Get actual key from M3U8
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
  console.log('Resource:', resource, 'KeyNumber:', keyNumber);
  console.log('channelSalt:', channelSalt);
  
  const ts = Math.floor(Date.now() / 1000);
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const fp = crypto.createHash('sha256').update(ua + '1920x1080' + 'America/New_York' + 'en-US').digest('hex').substring(0, 16);
  
  // Step 1: HMAC prefix
  const hmacPrefix = crypto.createHmac('sha256', channelSalt).update(resource).digest('hex');
  console.log('hmacPrefix:', hmacPrefix.substring(0, 32) + '...');
  
  // Step 2: Find nonce
  let nonce = -1;
  for (let n = 0; n < 100000; n++) {
    const data = hmacPrefix + resource + keyNumber + ts + n;
    const hash = crypto.createHash('md5').update(data).digest('hex');
    if (parseInt(hash.substring(0, 4), 16) < 0x1000) {
      nonce = n;
      console.log(`Nonce: ${n}, MD5: ${hash}, first4: 0x${hash.substring(0, 4)} = ${parseInt(hash.substring(0, 4), 16)}`);
      break;
    }
  }
  
  const keyPath = crypto.createHmac('sha256', channelSalt).update(`${resource}|${keyNumber}|${ts}|${fp}`).digest('hex').substring(0, 16);
  
  console.log('\nHeaders:');
  console.log('  Authorization: Bearer', authToken.substring(0, 40) + '...');
  console.log('  X-Key-Timestamp:', ts);
  console.log('  X-Key-Nonce:', nonce);
  console.log('  X-Key-Path:', keyPath);
  console.log('  X-Fingerprint:', fp);
  
  // Now let's look at what the ACTUAL browser sends
  // Let's check the player page for any clues about what Origin/Referer the browser uses
  console.log('\n=== Checking player page for Origin hints ===');
  const playerHtml = html;
  
  // Look for fetch/XMLHttpRequest calls that reveal the expected origin
  const fetchCalls = playerHtml.match(/fetch\s*\([^)]+\)/g);
  if (fetchCalls) {
    console.log('fetch() calls found:', fetchCalls.length);
    fetchCalls.forEach((f, i) => console.log(`  ${i}: ${f.substring(0, 100)}`));
  }
  
  // Look for origin/referer references
  const originRefs = playerHtml.match(/[Oo]rigin['":\s]+[^,;\n]+/g);
  if (originRefs) {
    console.log('Origin references:', originRefs.length);
    originRefs.forEach(r => console.log('  ', r.substring(0, 80)));
  }
  
  // Look for the key fetch function
  const keyFetchPattern = playerHtml.match(/key.*fetch|fetch.*key/gi);
  if (keyFetchPattern) {
    console.log('Key fetch patterns:', keyFetchPattern.length);
  }
  
  // Look for EPlayerAuth methods
  const epaMatches = playerHtml.match(/EPlayerAuth\.[a-zA-Z]+/g);
  if (epaMatches) {
    console.log('EPlayerAuth methods:', [...new Set(epaMatches)]);
  }
  
  // Check if there's a different auth mechanism we're missing
  // Look for any heartbeat or session setup
  const heartbeatRefs = playerHtml.match(/heartbeat|session|handshake/gi);
  if (heartbeatRefs) {
    console.log('Session/heartbeat refs:', [...new Set(heartbeatRefs)]);
  }
  
  // Try fetching key with the EXACT same timestamp as in the authToken
  console.log('\n=== Test: Use authToken timestamp instead of current time ===');
  const tokenParts = authToken.split('|');
  console.log('Token parts:', tokenParts.map((p, i) => i < 4 ? p : p.substring(0, 16) + '...'));
  const tokenTs = parseInt(tokenParts[2]);
  console.log('Token timestamp:', tokenTs, 'Current:', ts, 'Diff:', ts - tokenTs, 'seconds');
  
  // Recompute with token timestamp
  const hmacPrefix2 = crypto.createHmac('sha256', channelSalt).update(resource).digest('hex');
  let nonce2 = -1;
  for (let n = 0; n < 100000; n++) {
    const data = hmacPrefix2 + resource + keyNumber + tokenTs + n;
    const hash = crypto.createHash('md5').update(data).digest('hex');
    if (parseInt(hash.substring(0, 4), 16) < 0x1000) { nonce2 = n; break; }
  }
  const keyPath2 = crypto.createHmac('sha256', channelSalt).update(`${resource}|${keyNumber}|${tokenTs}|${fp}`).digest('hex').substring(0, 16);
  
  try {
    const r = await httpsGet(keyUri, {
      'Accept': '*/*',
      'Origin': 'https://hitsplay.fun', 'Referer': 'https://hitsplay.fun/',
      'Authorization': `Bearer ${authToken}`,
      'X-Key-Timestamp': tokenTs.toString(), 'X-Key-Nonce': nonce2.toString(),
      'X-Key-Path': keyPath2, 'X-Fingerprint': fp,
    });
    const hex = r.data.toString('hex');
    console.log(`Token-ts result: ${r.status}, ${r.data.length}b, ${hex}`);
    console.log(hex.startsWith('45c6497') || hex.startsWith('455806f8') ? 'FAKE' : r.data.length === 16 ? 'REAL KEY!' : 'ERROR');
  } catch (e) { console.log('ERROR:', e.message); }
  
  // Try WITHOUT X-Key-Path and X-Fingerprint (maybe server doesn't want them)
  console.log('\n=== Test: Without X-Key-Path and X-Fingerprint ===');
  try {
    const r = await httpsGet(keyUri, {
      'Accept': '*/*',
      'Origin': 'https://hitsplay.fun', 'Referer': 'https://hitsplay.fun/',
      'Authorization': `Bearer ${authToken}`,
      'X-Key-Timestamp': ts.toString(), 'X-Key-Nonce': nonce.toString(),
    });
    const hex = r.data.toString('hex');
    console.log(`No-path result: ${r.status}, ${r.data.length}b, ${hex}`);
    console.log(hex.startsWith('45c6497') || hex.startsWith('455806f8') ? 'FAKE' : r.data.length === 16 ? 'REAL KEY!' : 'ERROR');
  } catch (e) { console.log('ERROR:', e.message); }
  
  // Try with NO auth at all (baseline)
  console.log('\n=== Test: No auth headers at all ===');
  try {
    const r = await httpsGet(keyUri, {
      'Accept': '*/*',
      'Origin': 'https://hitsplay.fun', 'Referer': 'https://hitsplay.fun/',
    });
    const hex = r.data.toString('hex');
    console.log(`No-auth result: ${r.status}, ${r.data.length}b, ${hex}`);
  } catch (e) { console.log('ERROR:', e.message); }
}

main().catch(console.error);

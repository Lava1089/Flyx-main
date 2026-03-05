const https = require('https');
const crypto = require('crypto');

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }));
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

async function main() {
  // Step 1: Test auth fetch from codepcplay.fun
  console.log('=== STEP 1: Fetch auth from codepcplay.fun ===');
  let authResult;
  try {
    authResult = await httpsGet('https://codepcplay.fun/premiumtv/daddyhd.php?id=51', { 'Referer': 'https://dlhd.link/' });
    console.log('Status:', authResult.status);
    console.log('Size:', authResult.data.length, 'bytes');
    const html = authResult.data.toString('utf8');
    
    const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
    if (!initMatch) {
      console.log('NO EPlayerAuth found!');
      console.log('Page preview:', html.substring(0, 300));
      
      // Try hitsplay.fun fallback
      console.log('\n=== Trying hitsplay.fun fallback ===');
      const hitsResult = await httpsGet('https://hitsplay.fun/premiumtv/daddyhd.php?id=51', { 'Referer': 'https://dlhd.link/' });
      console.log('Status:', hitsResult.status);
      const hitsHtml = hitsResult.data.toString('utf8');
      const hitsMatch = hitsHtml.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
      if (!hitsMatch) {
        console.log('NO EPlayerAuth on hitsplay either!');
        console.log('Page preview:', hitsHtml.substring(0, 300));
        
        // Check for JWT (V4 format)
        const jwtMatch = hitsHtml.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
        if (jwtMatch) {
          console.log('Found JWT (V4):', jwtMatch[0].substring(0, 60) + '...');
        }
        
        // Check for any auth patterns
        const authTokenMatch = hitsHtml.match(/AUTH_TOKEN\s*=\s*["']([^"']+)["']/);
        if (authTokenMatch) {
          console.log('Found AUTH_TOKEN:', authTokenMatch[1].substring(0, 60) + '...');
        }
        
        // Look for any script patterns
        const scriptMatches = hitsHtml.match(/<script[^>]*>[\s\S]*?<\/script>/gi);
        if (scriptMatches) {
          console.log('Found', scriptMatches.length, 'script tags');
          scriptMatches.forEach((s, i) => {
            if (s.length < 2000) console.log(`Script ${i}:`, s.substring(0, 200));
          });
        }
        return;
      }
    }
    
    const matchStr = initMatch ? initMatch[1] : '';
    const authTokenMatch = matchStr.match(/authToken\s*:\s*["']([^"']+)["']/);
    const channelSaltMatch = matchStr.match(/channelSalt\s*:\s*["']([^"']+)["']/);
    
    if (!authTokenMatch || !channelSaltMatch) {
      console.log('Missing authToken or channelSalt');
      console.log('Init block:', matchStr.substring(0, 300));
      return;
    }
    
    const authToken = authTokenMatch[1];
    const channelSalt = channelSaltMatch[1];
    console.log('authToken:', authToken.substring(0, 60) + '...');
    console.log('channelSalt:', channelSalt);
    
    // Step 2: Compute V5 auth headers
    console.log('\n=== STEP 2: Compute V5 auth ===');
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
      if (parseInt(hash.substring(0, 4), 16) < 0x1000) {
        nonce = n;
        break;
      }
    }
    
    const keyPathData = `${resource}|${keyNumber}|${ts}|${fp}`;
    const keyPath = crypto.createHmac('sha256', channelSalt).update(keyPathData).digest('hex').substring(0, 16);
    
    console.log('timestamp:', ts);
    console.log('nonce:', nonce);
    console.log('fingerprint:', fp);
    console.log('keyPath:', keyPath);
    
    // Step 3: Test key fetch with different Origins
    const origins = [
      { origin: 'https://dlhd.link', referer: 'https://dlhd.link/' },
      { origin: 'https://hitsplay.fun', referer: 'https://hitsplay.fun/' },
      { origin: 'https://codepcplay.fun', referer: 'https://codepcplay.fun/' },
    ];
    
    const keyUrl = `https://zekonew.dvalna.ru/key/${resource}/${keyNumber}`;
    
    for (const { origin, referer } of origins) {
      console.log(`\n=== STEP 3: Key fetch with Origin: ${origin} ===`);
      const headers = {
        'User-Agent': ua,
        'Accept': '*/*',
        'Origin': origin,
        'Referer': referer,
        'Authorization': `Bearer ${authToken}`,
        'X-Key-Timestamp': ts.toString(),
        'X-Key-Nonce': nonce.toString(),
        'X-Key-Path': keyPath,
        'X-Fingerprint': fp,
      };
      
      try {
        const result = await httpsGet(keyUrl, headers);
        console.log('Status:', result.status);
        console.log('Size:', result.data.length, 'bytes');
        const hex = result.data.toString('hex');
        console.log('Hex:', hex.substring(0, 64));
        if (result.data.length === 16) {
          if (hex.startsWith('455806f8') || hex.startsWith('45c6497')) {
            console.log('RESULT: FAKE KEY');
          } else if (hex === '6572726f7220636f64653a2031303135') {
            console.log('RESULT: RATE LIMITED (error code 1015)');
          } else {
            console.log('RESULT: REAL KEY!');
          }
        } else {
          const text = result.data.toString('utf8');
          console.log('Text:', text.substring(0, 200));
        }
      } catch (e) {
        console.log('ERROR:', e.message);
      }
    }
    
    // Step 4: Test RPI proxy health
    console.log('\n=== STEP 4: RPI proxy health ===');
    try {
      const health = await httpsGet('https://rpi-proxy.vynx.cc/health', {
        'X-API-Key': '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560',
      });
      console.log('Status:', health.status);
      console.log('Response:', health.data.toString('utf8').substring(0, 200));
    } catch (e) {
      console.log('RPI PROXY DOWN:', e.message);
    }
    
    // Step 5: Test key via RPI proxy /fetch
    console.log('\n=== STEP 5: Key via RPI /fetch ===');
    const rpiHeaders = {
      'User-Agent': ua,
      'Accept': '*/*',
      'Origin': 'https://dlhd.link',
      'Referer': 'https://dlhd.link/',
      'Authorization': `Bearer ${authToken}`,
      'X-Key-Timestamp': ts.toString(),
      'X-Key-Nonce': nonce.toString(),
      'X-Key-Path': keyPath,
      'X-Fingerprint': fp,
    };
    
    const rpiUrl = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(keyUrl)}&headers=${encodeURIComponent(JSON.stringify(rpiHeaders))}&key=5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560`;
    try {
      const rpiResult = await httpsGet(rpiUrl, {
        'X-API-Key': '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560',
      });
      console.log('Status:', rpiResult.status);
      console.log('Upstream-Status:', rpiResult.headers['x-upstream-status']);
      console.log('Size:', rpiResult.data.length, 'bytes');
      const hex = rpiResult.data.toString('hex');
      console.log('Hex:', hex.substring(0, 64));
      if (rpiResult.data.length === 16) {
        if (hex.startsWith('455806f8') || hex.startsWith('45c6497')) {
          console.log('RESULT: FAKE KEY');
        } else {
          console.log('RESULT: REAL KEY!');
        }
      } else {
        console.log('Text:', rpiResult.data.toString('utf8').substring(0, 200));
      }
    } catch (e) {
      console.log('ERROR:', e.message);
    }
    
    // Step 6: Test RPI proxy's own V4 key fetch
    console.log('\n=== STEP 6: Key via RPI /dlhd-key (V4 auth) ===');
    try {
      const v4Url = `https://rpi-proxy.vynx.cc/dlhd-key?url=${encodeURIComponent(keyUrl)}`;
      const v4Result = await httpsGet(v4Url, {
        'X-API-Key': '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560',
      });
      console.log('Status:', v4Result.status);
      console.log('Size:', v4Result.data.length, 'bytes');
      const hex = v4Result.data.toString('hex');
      console.log('Hex:', hex.substring(0, 64));
      if (v4Result.data.length === 16) {
        if (hex.startsWith('455806f8') || hex.startsWith('45c6497')) {
          console.log('RESULT: FAKE KEY');
        } else {
          console.log('RESULT: REAL KEY!');
        }
      } else {
        console.log('Text:', v4Result.data.toString('utf8').substring(0, 200));
      }
    } catch (e) {
      console.log('ERROR:', e.message);
    }
    
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

main().catch(console.error);

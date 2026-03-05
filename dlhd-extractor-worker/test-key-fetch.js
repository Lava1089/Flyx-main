const https = require('https');
const crypto = require('crypto');

async function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://dlhd.link/',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function fetchKey(url, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    https.get({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        resolve({ status: res.statusCode, data });
      });
    }).on('error', reject);
  });
}

async function test() {
  console.log('Fetching auth from codepcplay...');
  const html = await fetchPage('https://codepcplay.fun/premiumtv/daddyhd.php?id=577');
  
  const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
  if (!initMatch) {
    console.log('No EPlayerAuth found');
    return;
  }
  
  const authTokenMatch = initMatch[1].match(/authToken\s*:\s*["']([^"']+)["']/);
  const channelSaltMatch = initMatch[1].match(/channelSalt\s*:\s*["']([^"']+)["']/);
  
  if (!authTokenMatch || !channelSaltMatch) {
    console.log('Missing auth data');
    return;
  }
  
  const authToken = authTokenMatch[1];
  const channelSalt = channelSaltMatch[1];
  
  console.log('authToken:', authToken.substring(0, 60) + '...');
  console.log('channelSalt:', channelSalt);
  
  // Compute auth
  const resource = 'premium577';
  const keyNumber = '5900825';
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
      console.log('Found nonce:', n, 'hash:', hash.substring(0, 8));
      break;
    }
  }
  
  const keyPathData = resource + '|' + keyNumber + '|' + ts + '|' + fp;
  const keyPath = crypto.createHmac('sha256', channelSalt).update(keyPathData).digest('hex').substring(0, 16);
  
  console.log('timestamp:', ts);
  console.log('nonce:', nonce);
  console.log('keyPath:', keyPath);
  console.log('fingerprint:', fp);
  
  const headers = {
    'User-Agent': ua,
    'Accept': '*/*',
    'Origin': 'https://hitsplay.fun',
    'Referer': 'https://hitsplay.fun/',
    'Authorization': 'Bearer ' + authToken,
    'X-Key-Timestamp': ts.toString(),
    'X-Key-Nonce': nonce.toString(),
    'X-Key-Path': keyPath,
    'X-Fingerprint': fp,
  };
  
  console.log('\nFetching key with headers:', JSON.stringify(headers, null, 2));
  
  const result = await fetchKey('https://chevy.dvalna.ru/key/premium577/5900825', headers);
  console.log('\nKey response:', result.status, result.data.length, 'bytes');
  console.log('Key hex:', result.data.toString('hex'));
}

test().catch(console.error);

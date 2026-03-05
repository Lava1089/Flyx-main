// Test: Fetch key with PROPER V5 auth headers through SOCKS5 proxy
// The 500 on zekonew might be because we sent no auth headers!
// Also: the M3U8 points to chevy.dvalna.ru for keys — let's try the REAL key URL
// from the M3U8 with auth headers through the proxy.

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const { URL } = require('url');

const PROXY = '24.249.199.12:4145'; // Verified working, fast

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- SOCKS5 helpers (same as before) ----
function socks5Connect(proxyHost, proxyPort, targetHost, targetPort, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('socks5 timeout')); }, timeout);
    const socket = net.connect(proxyPort, proxyHost, () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    let step = 'greeting';
    socket.on('data', (data) => {
      if (step === 'greeting') {
        if (data[0] !== 0x05 || data[1] !== 0x00) { clearTimeout(timer); socket.destroy(); reject(new Error(`auth rejected`)); return; }
        step = 'connect';
        const hostBuf = Buffer.from(targetHost);
        const portBuf = Buffer.alloc(2); portBuf.writeUInt16BE(targetPort);
        socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]), hostBuf, portBuf]));
      } else if (step === 'connect') {
        if (data[0] !== 0x05 || data[1] !== 0x00) { clearTimeout(timer); socket.destroy(); reject(new Error(`connect failed`)); return; }
        clearTimeout(timer); resolve(socket);
      }
    });
    socket.on('error', (e) => { clearTimeout(timer); reject(e); });
    socket.setTimeout(timeout);
  });
}

async function fetchViaSocks5(proxy, targetUrl, headers = {}, timeout = 15000) {
  const [proxyHost, proxyPort] = proxy.split(':');
  const target = new URL(targetUrl);
  const socket = await socks5Connect(proxyHost, parseInt(proxyPort), target.hostname, 443, timeout);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('tls timeout')); }, timeout);
    const tlsSocket = tls.connect({ socket, servername: target.hostname, rejectUnauthorized: false }, () => {
      const path = target.pathname + target.search;
      const allHeaders = { 'Host': target.hostname, ...headers };
      let reqStr = `GET ${path} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(allHeaders)) reqStr += `${k}: ${v}\r\n`;
      reqStr += 'Connection: close\r\n\r\n';
      tlsSocket.write(reqStr);
    });
    const chunks = [];
    tlsSocket.on('data', c => chunks.push(c));
    tlsSocket.on('end', () => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks);
      const rawStr = raw.toString('latin1');
      const headerEnd = rawStr.indexOf('\r\n\r\n');
      if (headerEnd === -1) { reject(new Error('no header boundary')); return; }
      const headerPart = rawStr.substring(0, headerEnd);
      const statusMatch = headerPart.match(/HTTP\/[\d.]+ (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1]) : 0;
      const bodyOffset = Buffer.byteLength(rawStr.substring(0, headerEnd + 4), 'latin1');
      const body = raw.slice(bodyOffset);
      resolve({ status, headerPart, body });
    });
    tlsSocket.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// ---- Minimal V5 auth header generation ----
// (Simplified from dlhd-auth-v5.ts — just enough to test)

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function hmacSha256(data, key) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function generateFingerprint() {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  return sha256(ua + '1920x1080' + 'America/New_York' + 'en-US').substring(0, 16);
}

function computePowNonce(channelKey, keyNumber, timestamp, channelSalt) {
  const hmacPrefix = hmacSha256(channelKey, channelSalt);
  for (let nonce = 0; nonce < 100000; nonce++) {
    const data = hmacPrefix + channelKey + keyNumber + timestamp + nonce;
    const hash = md5(data);
    if (parseInt(hash.substring(0, 4), 16) < 0x1000) return nonce;
  }
  return 99999;
}

function computeKeyPath(resource, keyNumber, timestamp, fingerprint, channelSalt) {
  const data = `${resource}|${keyNumber}|${timestamp}|${fingerprint}`;
  return hmacSha256(data, channelSalt).substring(0, 16);
}

async function fetchAuthData(channel) {
  // Fetch from codepcplay.fun to get authToken + channelSalt
  const resp = await fetch(`https://codepcplay.fun/premiumtv/daddyhd.php?id=${channel}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://dlhd.link/',
    },
  });
  if (!resp.ok) return null;
  const html = await resp.text();
  const initMatch = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
  if (!initMatch) return null;
  const s = initMatch[1];
  const authToken = s.match(/authToken\s*:\s*["']([^"']+)["']/)?.[1];
  const channelSalt = s.match(/channelSalt\s*:\s*["']([^"']+)["']/)?.[1];
  const channelKey = s.match(/channelKey\s*:\s*["']([^"']+)["']/)?.[1] || `premium${channel}`;
  if (!authToken || !channelSalt) return null;
  return { authToken, channelSalt, channelKey };
}

function generateKeyHeaders(resource, keyNumber, authData) {
  const timestamp = Math.floor(Date.now() / 1000);
  const fingerprint = generateFingerprint();
  const nonce = computePowNonce(resource, keyNumber, timestamp, authData.channelSalt);
  const keyPath = computeKeyPath(resource, keyNumber, timestamp, fingerprint, authData.channelSalt);
  
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Origin': 'https://codepcplay.fun',
    'Referer': 'https://codepcplay.fun/',
    'Authorization': `Bearer ${authData.authToken}`,
    'X-Key-Timestamp': timestamp.toString(),
    'X-Key-Nonce': nonce.toString(),
    'X-Key-Path': keyPath,
    'X-Fingerprint': fingerprint,
  };
}

async function main() {
  console.log('=== Proxy + V5 Auth Key Fetch Test ===');
  console.log('Time:', new Date().toISOString());
  console.log(`Proxy: ${PROXY}\n`);

  // Step 1: Get auth data (this goes direct, not through proxy)
  console.log('Step 1: Fetching auth data from codepcplay.fun...');
  const auth = await fetchAuthData('44');
  if (!auth) { console.log('FAILED to get auth data'); return; }
  console.log(`  authToken: ${auth.authToken.substring(0, 50)}...`);
  console.log(`  channelSalt: ${auth.channelSalt.substring(0, 20)}...`);
  console.log(`  channelKey: ${auth.channelKey}\n`);

  // Step 2: Fetch M3U8 through proxy to get the REAL key URL
  console.log('Step 2: Fetching M3U8 through proxy...');
  const m3u8Res = await fetchViaSocks5(PROXY, 'https://zekonew.dvalna.ru/zeko/premium44/mono.css', {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://hitsplay.fun/',
    'Origin': 'https://hitsplay.fun',
    'Authorization': `Bearer ${auth.authToken}`,
  });
  console.log(`  M3U8 status: ${m3u8Res.status}, ${m3u8Res.body.length}b`);
  const m3u8Text = m3u8Res.body.toString();
  
  // Extract key URL from M3U8
  const keyUriMatch = m3u8Text.match(/URI="([^"]+)"/);
  if (!keyUriMatch) { console.log('No key URL in M3U8!'); console.log(m3u8Text); return; }
  const realKeyUrl = keyUriMatch[1];
  console.log(`  Real key URL from M3U8: ${realKeyUrl}`);
  
  // Parse resource and keyNumber
  const keyParsed = realKeyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  if (!keyParsed) { console.log('Cannot parse key URL'); return; }
  const resource = keyParsed[1];
  const keyNumber = keyParsed[2];
  console.log(`  resource=${resource}, keyNumber=${keyNumber}\n`);

  // Step 3: Generate V5 auth headers
  console.log('Step 3: Generating V5 auth headers...');
  const keyHeaders = generateKeyHeaders(resource, keyNumber, auth);
  console.log(`  Authorization: Bearer ${keyHeaders['Authorization'].substring(7, 50)}...`);
  console.log(`  X-Key-Timestamp: ${keyHeaders['X-Key-Timestamp']}`);
  console.log(`  X-Key-Nonce: ${keyHeaders['X-Key-Nonce']}`);
  console.log(`  X-Key-Path: ${keyHeaders['X-Key-Path']}`);
  console.log(`  X-Fingerprint: ${keyHeaders['X-Fingerprint']}\n`);

  // Step 4: Fetch the key through proxy WITH auth headers
  console.log('Step 4: Fetching key through proxy with V5 auth...');
  
  // Try the exact URL from M3U8
  console.log(`\n  a) Exact URL from M3U8: ${realKeyUrl}`);
  try {
    const res = await fetchViaSocks5(PROXY, realKeyUrl, keyHeaders);
    console.log(`     Status: ${res.status}, Body: ${res.body.length}b`);
    if (res.body.length === 16) {
      const hex = Array.from(res.body).map(b => b.toString(16).padStart(2, '0')).join('');
      const isFake = hex.startsWith('455806f8') || hex === '45c6497365ca4c64c83460adca4e65ee';
      const isError = hex.startsWith('6572726f72');
      console.log(`     KEY: ${hex} ${isFake ? '⚠️FAKE' : isError ? '🚫RATE_LIMITED' : '✅REAL'}`);
    } else {
      console.log(`     Body: ${res.body.toString().substring(0, 200)}`);
    }
  } catch (e) {
    console.log(`     Error: ${e.message}`);
  }

  // Try on different servers with the same key path
  const servers = ['zekonew', 'chevynew', 'ddy6new', 'nfsnew', 'chevy', 'zeko'];
  for (const srv of servers) {
    const testUrl = `https://${srv}.dvalna.ru/key/${resource}/${keyNumber}`;
    console.log(`\n  b) ${srv}: ${testUrl}`);
    try {
      const res = await fetchViaSocks5(PROXY, testUrl, keyHeaders);
      console.log(`     Status: ${res.status}, Body: ${res.body.length}b`);
      if (res.body.length === 16) {
        const hex = Array.from(res.body).map(b => b.toString(16).padStart(2, '0')).join('');
        const isFake = hex.startsWith('455806f8') || hex === '45c6497365ca4c64c83460adca4e65ee';
        const isError = hex.startsWith('6572726f72');
        console.log(`     KEY: ${hex} ${isFake ? '⚠️FAKE' : isError ? '🚫RATE_LIMITED' : '✅REAL'}`);
      } else {
        console.log(`     Body: ${res.body.toString().substring(0, 200)}`);
      }
    } catch (e) {
      console.log(`     Error: ${e.message}`);
    }
    await sleep(500);
  }

  // Step 5: Try multiple proxies on the REAL key URL with auth
  console.log('\n\nStep 5: Multiple proxies on real key URL with auth...');
  const proxies = [
    '24.249.199.12:4145',
    '192.111.129.145:16894',
    '184.178.172.5:15303',
    '98.181.137.80:4145',
    '192.252.210.233:4145',
    '68.71.245.206:4145',
    '142.54.228.193:4145',
    '199.58.184.97:4145',
  ];
  
  for (const p of proxies) {
    try {
      // Regenerate headers (fresh timestamp for each)
      const hdrs = generateKeyHeaders(resource, keyNumber, auth);
      const res = await fetchViaSocks5(p, realKeyUrl, hdrs);
      if (res.body.length === 16) {
        const hex = Array.from(res.body).map(b => b.toString(16).padStart(2, '0')).join('');
        const isFake = hex.startsWith('455806f8') || hex === '45c6497365ca4c64c83460adca4e65ee';
        const isError = hex.startsWith('6572726f72');
        console.log(`  ${p}: ${res.status} KEY=${hex} ${isFake ? '⚠️FAKE' : isError ? '🚫RATE' : '✅REAL'}`);
      } else {
        console.log(`  ${p}: ${res.status} ${res.body.length}b`);
      }
    } catch (e) {
      console.log(`  ${p}: ${e.message}`);
    }
    await sleep(300);
  }
}

main().catch(console.error);

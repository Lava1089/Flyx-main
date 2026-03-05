// Test: Can we fetch dvalna.ru keys over plain HTTP (port 80)?
// If yes, we can use CF Workers TCP sockets + SOCKS5 without needing TLS upgrade
// Cloudflare typically redirects HTTP→HTTPS, but let's check

const net = require('net');
const { URL } = require('url');

const PROXY = '192.111.129.145:16894'; // Verified working SOCKS5

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function socks5Connect(proxyHost, proxyPort, targetHost, targetPort, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('timeout')); }, timeout);
    const socket = net.connect(proxyPort, proxyHost, () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    let step = 'greeting';
    socket.on('data', (data) => {
      if (step === 'greeting') {
        if (data[0] !== 0x05 || data[1] !== 0x00) { clearTimeout(timer); socket.destroy(); reject(new Error('auth rejected')); return; }
        step = 'connect';
        const hostBuf = Buffer.from(targetHost);
        const portBuf = Buffer.alloc(2); portBuf.writeUInt16BE(targetPort);
        socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]), hostBuf, portBuf]));
      } else if (step === 'connect') {
        if (data[0] !== 0x05 || data[1] !== 0x00) { clearTimeout(timer); socket.destroy(); reject(new Error(`connect failed: ${data[1]}`)); return; }
        clearTimeout(timer); resolve(socket);
      }
    });
    socket.on('error', (e) => { clearTimeout(timer); reject(e); });
    socket.setTimeout(timeout);
  });
}

// Fetch auth data for V5 headers
const crypto = require('crypto');
function md5(str) { return crypto.createHash('md5').update(str).digest('hex'); }
function hmacSha256(data, key) { return crypto.createHmac('sha256', key).update(data).digest('hex'); }
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function generateFingerprint() {
  return sha256('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.361920x1080America/New_Yorken-US').substring(0, 16);
}
function computePowNonce(channelKey, keyNumber, timestamp, channelSalt) {
  const hmacPrefix = hmacSha256(channelKey, channelSalt);
  for (let nonce = 0; nonce < 100000; nonce++) {
    const hash = md5(hmacPrefix + channelKey + keyNumber + timestamp + nonce);
    if (parseInt(hash.substring(0, 4), 16) < 0x1000) return nonce;
  }
  return 99999;
}
function computeKeyPath(resource, keyNumber, timestamp, fingerprint, channelSalt) {
  return hmacSha256(`${resource}|${keyNumber}|${timestamp}|${fingerprint}`, channelSalt).substring(0, 16);
}

async function fetchAuthData(channel) {
  const resp = await fetch(`https://codepcplay.fun/premiumtv/daddyhd.php?id=${channel}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://dlhd.link/' },
  });
  const html = await resp.text();
  const m = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
  if (!m) return null;
  const authToken = m[1].match(/authToken\s*:\s*["']([^"']+)["']/)?.[1];
  const channelSalt = m[1].match(/channelSalt\s*:\s*["']([^"']+)["']/)?.[1];
  if (!authToken || !channelSalt) return null;
  return { authToken, channelSalt };
}

function generateKeyHeaders(resource, keyNumber, auth) {
  const timestamp = Math.floor(Date.now() / 1000);
  const fingerprint = generateFingerprint();
  const nonce = computePowNonce(resource, keyNumber, timestamp, auth.channelSalt);
  const keyPath = computeKeyPath(resource, keyNumber, timestamp, fingerprint, auth.channelSalt);
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Origin': 'https://codepcplay.fun',
    'Referer': 'https://codepcplay.fun/',
    'Authorization': `Bearer ${auth.authToken}`,
    'X-Key-Timestamp': timestamp.toString(),
    'X-Key-Nonce': nonce.toString(),
    'X-Key-Path': keyPath,
    'X-Fingerprint': fingerprint,
  };
}

async function fetchViaPlainHttp(proxy, targetHost, path, headers, port = 80) {
  const [proxyHost, proxyPort] = proxy.split(':');
  const socket = await socks5Connect(proxyHost, parseInt(proxyPort), targetHost, port);
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('timeout')); }, 15000);
    
    // Send plain HTTP request (no TLS)
    let reqStr = `GET ${path} HTTP/1.1\r\n`;
    reqStr += `Host: ${targetHost}\r\n`;
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() !== 'host') reqStr += `${k}: ${v}\r\n`;
    }
    reqStr += 'Connection: close\r\n\r\n';
    socket.write(reqStr);
    
    const chunks = [];
    socket.on('data', c => chunks.push(c));
    socket.on('end', () => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks);
      const rawStr = raw.toString('latin1');
      const headerEnd = rawStr.indexOf('\r\n\r\n');
      if (headerEnd === -1) { reject(new Error('no header boundary')); return; }
      const headerPart = rawStr.substring(0, headerEnd);
      const statusMatch = headerPart.match(/HTTP\/[\d.]+ (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1]) : 0;
      const body = raw.slice(Buffer.byteLength(rawStr.substring(0, headerEnd + 4), 'latin1'));
      resolve({ status, headerPart, body });
    });
    socket.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

async function main() {
  console.log('=== Plain HTTP Key Fetch Test ===');
  console.log('Testing if dvalna.ru serves keys over HTTP (port 80)');
  console.log('If yes, CF Workers can use SOCKS5 without TLS upgrade\n');

  // Get auth
  const auth = await fetchAuthData('44');
  if (!auth) { console.log('Failed to get auth'); return; }
  console.log('Auth OK\n');

  const resource = 'premium44';
  const keyNumber = '5901700'; // arbitrary recent key number
  const headers = generateKeyHeaders(resource, keyNumber, auth);

  // Test 1: Plain HTTP (port 80) to chevy.dvalna.ru
  console.log('--- Test 1: HTTP port 80 ---');
  const servers = ['chevy', 'zekonew', 'chevynew'];
  for (const srv of servers) {
    const host = `${srv}.dvalna.ru`;
    console.log(`\n${host} port 80:`);
    try {
      const res = await fetchViaPlainHttp(PROXY, host, `/key/${resource}/${keyNumber}`, headers, 80);
      console.log(`  Status: ${res.status}`);
      console.log(`  Headers: ${res.headerPart.substring(0, 300)}`);
      if (res.body.length === 16) {
        const hex = Array.from(res.body).map(b => b.toString(16).padStart(2, '0')).join('');
        console.log(`  KEY: ${hex}`);
      } else {
        console.log(`  Body (${res.body.length}b): ${res.body.toString().substring(0, 200)}`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
    await sleep(500);
  }

  // Test 2: Also try port 8080 and 2053 (Cloudflare alternate ports)
  console.log('\n--- Test 2: Cloudflare alternate HTTPS ports (2053, 2083, 2087, 2096, 8443) ---');
  // These are Cloudflare's alternate HTTPS ports that might work
  // But they still need TLS... skip for now

  // Test 3: Try connecting to the Cloudflare IP directly with Host header
  // dvalna.ru resolves to CF IPs. What if we connect to a CF IP on port 80?
  console.log('\n--- Test 3: Direct to CF IP with Host header ---');
  // The AAAA records: 2606:4700:3036::ac43:9b67, 2606:4700:3030::6815:5907
  // A records: let's check
  const dns = require('dns');
  dns.resolve4('chevy.dvalna.ru', (err, addresses) => {
    if (err) console.log('DNS error:', err.message);
    else console.log('chevy.dvalna.ru A records:', addresses);
  });
}

main().catch(console.error);

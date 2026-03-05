// Test: Deeper proxy investigation
// 1. What does the 500 response body say? (Cloudflare block? Server error?)
// 2. Try different dvalna.ru servers (zekonew, chevynew, etc.)
// 3. Try fetching the M3U8 first (not just the key) to see if the proxy works at all
// 4. Also try with proper auth headers (V5 EPlayerAuth)

const net = require('net');
const tls = require('tls');
const { URL } = require('url');

// Pick a few fast SOCKS5 proxies that connected successfully
const SOCKS5_PROXIES = [
  '24.249.199.12:4145',
  '192.111.129.145:16894',
  '184.178.172.5:15303',
  '98.181.137.80:4145',
  '192.252.210.233:4145',
  '199.58.184.97:4145',
  '142.54.228.193:4145',
  '68.71.245.206:4145',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function socks5Connect(proxyHost, proxyPort, targetHost, targetPort, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('socks5 timeout')); }, timeout);
    const socket = net.connect(proxyPort, proxyHost, () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    let step = 'greeting';
    socket.on('data', (data) => {
      if (step === 'greeting') {
        if (data[0] !== 0x05 || data[1] !== 0x00) {
          clearTimeout(timer); socket.destroy();
          reject(new Error(`SOCKS5 auth rejected: ${data[0]}/${data[1]}`)); return;
        }
        step = 'connect';
        const hostBuf = Buffer.from(targetHost);
        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(targetPort);
        socket.write(Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
          hostBuf, portBuf,
        ]));
      } else if (step === 'connect') {
        if (data[0] !== 0x05 || data[1] !== 0x00) {
          clearTimeout(timer); socket.destroy();
          reject(new Error(`SOCKS5 connect failed: rep=${data[1]}`)); return;
        }
        clearTimeout(timer);
        resolve(socket);
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
    const tlsSocket = tls.connect({
      socket, servername: target.hostname, rejectUnauthorized: false,
    }, () => {
      const path = target.pathname + target.search;
      const allHeaders = {
        'Host': target.hostname,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        ...headers,
      };
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

async function main() {
  console.log('=== Proxy Deep Investigation ===');
  console.log('Time:', new Date().toISOString());
  
  const proxy = SOCKS5_PROXIES[0]; // Use the fastest one
  console.log(`\nUsing proxy: ${proxy}\n`);

  // Test 1: What does the 500 response body say?
  console.log('--- Test 1: Key fetch 500 body ---');
  try {
    const res = await fetchViaSocks5(proxy, 'https://zekonew.dvalna.ru/key/premium44/5901618', {
      'Referer': 'https://codepcplay.fun/',
      'Origin': 'https://codepcplay.fun',
    });
    console.log(`Status: ${res.status}, Body (${res.body.length}b):`);
    console.log(res.body.toString().substring(0, 500));
    console.log('\nResponse headers:');
    console.log(res.headerPart.substring(0, 500));
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }

  await sleep(500);

  // Test 2: Try different servers
  console.log('\n--- Test 2: Different key servers ---');
  const servers = ['zekonew', 'chevynew', 'chevy', 'zeko', 'nfsnew', 'ddy6new'];
  for (const srv of servers) {
    try {
      const res = await fetchViaSocks5(proxy, `https://${srv}.dvalna.ru/key/premium44/5901618`, {
        'Referer': 'https://codepcplay.fun/',
        'Origin': 'https://codepcplay.fun',
      });
      const bodyStr = res.body.length <= 100 ? res.body.toString() : `${res.body.length}b`;
      if (res.body.length === 16) {
        const hex = Array.from(res.body).map(b => b.toString(16).padStart(2, '0')).join('');
        console.log(`${srv}: ${res.status} KEY=${hex}`);
      } else {
        console.log(`${srv}: ${res.status} ${res.body.length}b`);
      }
    } catch (e) {
      console.log(`${srv}: ${e.message}`);
    }
    await sleep(300);
  }

  // Test 3: Can the proxy fetch the M3U8 at all?
  console.log('\n--- Test 3: M3U8 fetch (not key) ---');
  try {
    const res = await fetchViaSocks5(proxy, 'https://zekonew.dvalna.ru/zeko/premium44/mono.css', {
      'Referer': 'https://hitsplay.fun/',
      'Origin': 'https://hitsplay.fun',
    });
    console.log(`M3U8 status: ${res.status}, body: ${res.body.length}b`);
    if (res.body.length < 2000) {
      console.log(res.body.toString().substring(0, 500));
    } else {
      console.log(res.body.toString().substring(0, 200) + '...');
    }
  } catch (e) {
    console.log(`M3U8 error: ${e.message}`);
  }

  // Test 4: Try a completely different site to verify proxy works
  console.log('\n--- Test 4: Verify proxy works (httpbin) ---');
  try {
    const res = await fetchViaSocks5(proxy, 'https://httpbin.org/ip', {});
    console.log(`httpbin status: ${res.status}`);
    console.log(res.body.toString().substring(0, 200));
  } catch (e) {
    console.log(`httpbin error: ${e.message}`);
  }

  // Test 5: Try multiple proxies on the same key URL to see if any get through
  console.log('\n--- Test 5: All proxies on chevy.dvalna.ru (known to return keys) ---');
  for (const p of SOCKS5_PROXIES) {
    try {
      const res = await fetchViaSocks5(p, 'https://chevy.dvalna.ru/key/premium44/5901618', {
        'Referer': 'https://codepcplay.fun/',
        'Origin': 'https://codepcplay.fun',
      });
      if (res.body.length === 16) {
        const hex = Array.from(res.body).map(b => b.toString(16).padStart(2, '0')).join('');
        const isFake = hex === '45c6497365ca4c64c83460adca4e65ee' || hex.startsWith('455806f8');
        console.log(`${p}: ${res.status} KEY=${hex} ${isFake ? '⚠️FAKE' : '✅REAL'}`);
      } else {
        console.log(`${p}: ${res.status} ${res.body.length}b`);
      }
    } catch (e) {
      console.log(`${p}: ${e.message}`);
    }
    await sleep(300);
  }
}

main().catch(console.error);

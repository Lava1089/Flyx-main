// Test: Fetch dvalna.ru keys through free public proxies
// Uses REAL proxies from github.com/proxifly, github.com/TheSpeedX, github.com/officialputuid
// Tests both SOCKS5 (via node's net + tls) and HTTP CONNECT proxies
//
// NOTE: Free IPv6 proxies basically don't exist in public lists — all IPv4.
// dvalna.ru resolves AAAA to Cloudflare IPs, so IPv4 proxies hitting CF should work fine.

const net = require('net');
const tls = require('tls');
const http = require('http');
const { URL } = require('url');

// ============================================================
// REAL proxies from verified free proxy lists (fetched Feb 7 2026)
// ============================================================

// SOCKS5 proxies from proxifly + TheSpeedX + officialputuid
const SOCKS5_PROXIES = [
  '69.61.200.104:36181',
  '24.249.199.12:4145',
  '192.111.129.145:16894',
  '192.252.214.20:15864',
  '184.178.172.25:15291',
  '184.178.172.5:15303',
  '70.166.167.38:57728',
  '198.177.252.24:4145',
  '174.77.111.196:4145',
  '98.181.137.80:4145',
  '192.252.210.233:4145',
  '192.252.208.67:14287',
  '184.170.251.30:11288',
  '184.181.217.213:4145',
  '199.58.184.97:4145',
  '142.54.228.193:4145',
  '68.71.245.206:4145',
  '192.111.134.10:4145',
  '174.75.211.193:4145',
  '199.187.210.54:4145',
];

// HTTPS/HTTP CONNECT proxies from proxifly
const HTTPS_PROXIES = [
  '84.17.47.150:9002',
  '84.17.47.149:9002',
  '84.17.47.148:9002',
  '141.147.9.254:443',
  '65.108.150.56:8443',
  '129.151.160.199:443',
  '74.103.66.15:443',
  '167.99.124.118:443',
  '4.188.236.47:443',
  '34.122.187.196:443',
  '206.81.26.113:443',
  '23.88.59.163:443',
  '51.38.191.151:443',
  '154.65.39.7:443',
  '207.178.166.187:443',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// SOCKS5 proxy connect (handles HTTPS tunneling)
// ============================================================
function socks5Connect(proxyHost, proxyPort, targetHost, targetPort, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('socks5 timeout')); }, timeout);
    
    const socket = net.connect(proxyPort, proxyHost, () => {
      // SOCKS5 greeting: version=5, 1 auth method, no-auth=0
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    
    let step = 'greeting';
    const chunks = [];
    
    socket.on('data', (data) => {
      if (step === 'greeting') {
        // Server response: version=5, chosen method
        if (data[0] !== 0x05 || data[1] !== 0x00) {
          clearTimeout(timer);
          socket.destroy();
          reject(new Error(`SOCKS5 auth rejected: ${data[0]}/${data[1]}`));
          return;
        }
        
        // Send CONNECT request
        step = 'connect';
        const hostBuf = Buffer.from(targetHost);
        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(targetPort);
        
        // version=5, cmd=connect(1), rsv=0, atyp=domain(3), len, host, port
        const req = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
          hostBuf,
          portBuf,
        ]);
        socket.write(req);
      } else if (step === 'connect') {
        // Connect response
        if (data[0] !== 0x05 || data[1] !== 0x00) {
          clearTimeout(timer);
          socket.destroy();
          reject(new Error(`SOCKS5 connect failed: rep=${data[1]}`));
          return;
        }
        
        clearTimeout(timer);
        resolve(socket);
      }
    });
    
    socket.on('error', (e) => { clearTimeout(timer); reject(e); });
    socket.on('timeout', () => { socket.destroy(); clearTimeout(timer); reject(new Error('socket timeout')); });
    socket.setTimeout(timeout);
  });
}

// Fetch HTTPS URL through SOCKS5 proxy
async function fetchViaSocks5(proxy, targetUrl, headers = {}, timeout = 12000) {
  const [proxyHost, proxyPort] = proxy.split(':');
  const target = new URL(targetUrl);
  
  // Step 1: SOCKS5 connect to target host
  const socket = await socks5Connect(proxyHost, parseInt(proxyPort), target.hostname, 443, timeout);
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('tls timeout')); }, timeout);
    
    // Step 2: TLS handshake over SOCKS5 tunnel
    const tlsSocket = tls.connect({
      socket,
      servername: target.hostname,
      rejectUnauthorized: false,
    }, () => {
      // Step 3: Send HTTP request
      const path = target.pathname + target.search;
      const allHeaders = {
        'Host': target.hostname,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        ...headers,
      };
      
      let reqStr = `GET ${path} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(allHeaders)) {
        reqStr += `${k}: ${v}\r\n`;
      }
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
      if (headerEnd === -1) {
        reject(new Error('no HTTP header boundary'));
        return;
      }
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

// Fetch HTTPS URL through HTTP CONNECT proxy
function fetchViaHttpConnect(proxy, targetUrl, headers = {}, timeout = 12000) {
  const [proxyHost, proxyPort] = proxy.split(':');
  const target = new URL(targetUrl);
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('connect timeout')); }, timeout);
    
    const connectReq = http.request({
      host: proxyHost,
      port: parseInt(proxyPort),
      method: 'CONNECT',
      path: `${target.hostname}:443`,
      timeout,
    });
    
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(`CONNECT ${res.statusCode}`));
        return;
      }
      
      const tlsSocket = tls.connect({
        socket,
        servername: target.hostname,
        rejectUnauthorized: false,
      }, () => {
        const path = target.pathname + target.search;
        const allHeaders = {
          'Host': target.hostname,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          ...headers,
        };
        
        let reqStr = `GET ${path} HTTP/1.1\r\n`;
        for (const [k, v] of Object.entries(allHeaders)) {
          reqStr += `${k}: ${v}\r\n`;
        }
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
    
    connectReq.on('error', (e) => { clearTimeout(timer); reject(e); });
    connectReq.on('timeout', () => { connectReq.destroy(); clearTimeout(timer); reject(new Error('timeout')); });
    connectReq.end();
  });
}

function analyzeKeyResponse(body, status) {
  if (body.length === 16) {
    const hex = Array.from(body).map(b => b.toString(16).padStart(2, '0')).join('');
    const isFake = hex === '45c6497365ca4c64c83460adca4e65ee' || hex.startsWith('455806f8');
    const isError = hex.startsWith('6572726f72'); // "error" in hex
    if (isFake) return { type: 'FAKE', hex };
    if (isError) return { type: 'RATE_LIMITED', hex };
    return { type: 'REAL_KEY', hex };
  }
  if (status === 429) return { type: 'RATE_LIMITED_429' };
  if (status === 403) return { type: 'FORBIDDEN' };
  const text = body.toString().substring(0, 80);
  return { type: 'OTHER', status, bodyLen: body.length, text };
}

async function main() {
  console.log('=== Free Proxy Key Fetch Test ===');
  console.log('Time:', new Date().toISOString());
  console.log('Sources: proxifly, TheSpeedX, officialputuid (GitHub)');
  console.log('NOTE: No free IPv6 proxies exist in public lists — all IPv4');
  console.log('dvalna.ru is behind Cloudflare, so any non-banned IPv4 should work\n');

  const keyUrl = 'https://zekonew.dvalna.ru/key/premium44/5901618';
  const keyHeaders = {
    'Referer': 'https://codepcplay.fun/',
    'Origin': 'https://codepcplay.fun',
  };

  const results = { real: [], fake: [], blocked: [], failed: [] };

  // Test SOCKS5 proxies first (more reliable for HTTPS tunneling)
  console.log('========== SOCKS5 PROXIES ==========\n');
  for (let i = 0; i < SOCKS5_PROXIES.length; i++) {
    const proxy = SOCKS5_PROXIES[i];
    const start = Date.now();
    process.stdout.write(`[${i+1}/${SOCKS5_PROXIES.length}] SOCKS5 ${proxy} ... `);
    
    try {
      const res = await fetchViaSocks5(proxy, keyUrl, keyHeaders, 12000);
      const elapsed = Date.now() - start;
      const analysis = analyzeKeyResponse(res.body, res.status);
      
      if (analysis.type === 'REAL_KEY') {
        console.log(`✅ REAL KEY: ${analysis.hex} (${elapsed}ms)`);
        results.real.push({ proxy, type: 'socks5', hex: analysis.hex, elapsed });
      } else if (analysis.type === 'FAKE') {
        console.log(`⚠️ FAKE: ${analysis.hex} (${elapsed}ms)`);
        results.fake.push({ proxy, type: 'socks5' });
      } else if (analysis.type.startsWith('RATE_LIMITED')) {
        console.log(`🚫 RATE LIMITED (${elapsed}ms)`);
        results.blocked.push({ proxy, type: 'socks5' });
      } else {
        console.log(`❓ ${analysis.type} status=${res.status} ${analysis.bodyLen || ''}b (${elapsed}ms)`);
        results.failed.push({ proxy, type: 'socks5', reason: analysis.type });
      }
    } catch (e) {
      const elapsed = Date.now() - start;
      console.log(`💀 ${e.message} (${elapsed}ms)`);
      results.failed.push({ proxy, type: 'socks5', reason: e.message });
    }
    
    // Don't hammer — small delay
    await sleep(300);
  }

  // Test HTTP CONNECT proxies
  console.log('\n========== HTTPS CONNECT PROXIES ==========\n');
  for (let i = 0; i < HTTPS_PROXIES.length; i++) {
    const proxy = HTTPS_PROXIES[i];
    const start = Date.now();
    process.stdout.write(`[${i+1}/${HTTPS_PROXIES.length}] HTTPS ${proxy} ... `);
    
    try {
      const res = await fetchViaHttpConnect(proxy, keyUrl, keyHeaders, 12000);
      const elapsed = Date.now() - start;
      const analysis = analyzeKeyResponse(res.body, res.status);
      
      if (analysis.type === 'REAL_KEY') {
        console.log(`✅ REAL KEY: ${analysis.hex} (${elapsed}ms)`);
        results.real.push({ proxy, type: 'https', hex: analysis.hex, elapsed });
      } else if (analysis.type === 'FAKE') {
        console.log(`⚠️ FAKE: ${analysis.hex} (${elapsed}ms)`);
        results.fake.push({ proxy, type: 'https' });
      } else if (analysis.type.startsWith('RATE_LIMITED')) {
        console.log(`🚫 RATE LIMITED (${elapsed}ms)`);
        results.blocked.push({ proxy, type: 'https' });
      } else {
        console.log(`❓ ${analysis.type} status=${res.status} ${analysis.bodyLen || ''}b (${elapsed}ms)`);
        results.failed.push({ proxy, type: 'https', reason: analysis.type });
      }
    } catch (e) {
      const elapsed = Date.now() - start;
      console.log(`💀 ${e.message} (${elapsed}ms)`);
      results.failed.push({ proxy, type: 'https', reason: e.message });
    }
    
    await sleep(300);
  }

  // Summary
  console.log('\n\n========== SUMMARY ==========');
  console.log(`✅ REAL KEYS: ${results.real.length}`);
  results.real.forEach(r => console.log(`   ${r.type.toUpperCase()} ${r.proxy} → ${r.hex} (${r.elapsed}ms)`));
  console.log(`⚠️ FAKE KEYS: ${results.fake.length}`);
  results.fake.forEach(r => console.log(`   ${r.type.toUpperCase()} ${r.proxy}`));
  console.log(`🚫 RATE LIMITED: ${results.blocked.length}`);
  results.blocked.forEach(r => console.log(`   ${r.type.toUpperCase()} ${r.proxy}`));
  console.log(`💀 FAILED/TIMEOUT: ${results.failed.length}`);
  
  if (results.real.length > 0) {
    console.log('\n🎉 WORKING PROXIES FOUND! These can be used for key rotation in the CF Worker.');
    console.log('Next step: Integrate these into /dlhdprivate key fetching with rotation.');
  } else {
    console.log('\n😞 No working proxies found. May need to try more proxies or use a paid service.');
  }
}

main().catch(console.error);

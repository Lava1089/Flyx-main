#!/usr/bin/env node
/**
 * Run this DIRECTLY on the RPI to test key fetch without the proxy server.
 * This isolates whether the issue is the RPI's Node.js fetch or the proxy code.
 */
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }
function hmacSha256(d, k) { return crypto.createHmac('sha256', k).update(d).digest('hex'); }
function sha256(d) { return crypto.createHash('sha256').update(d).digest('hex'); }

async function main() {
  console.log('Node version:', process.version);
  
  // Get auth
  console.log('1. Fetching auth...');
  const authRes = await fetch('https://epaly.fun/premiumtv/daddyhd.php?id=51', {
    headers: { 'User-Agent': UA, 'Referer': 'https://dlhd.link/' },
  });
  const html = await authRes.text();
  const init = html.match(/EPlayerAuth\.init\s*\(\s*\{([^}]+)\}\s*\)/);
  if (!init) { console.error('No EPlayerAuth found'); process.exit(1); }
  
  const authToken = init[1].match(/authToken\s*:\s*['"]([^'"]+)['"]/)?.[1];
  const channelSalt = init[1].match(/channelSalt\s*:\s*['"]([^'"]+)['"]/)?.[1];
  if (!authToken || !channelSalt) { console.error('Missing auth fields'); process.exit(1); }
  console.log('   Auth OK, token:', authToken.substring(0, 30) + '...');

  // Server lookup
  console.log('2. Server lookup...');
  const lookup = await (await fetch('https://chevy.dvalna.ru/server_lookup?channel_id=premium51')).json();
  const sk = lookup.server_key;
  console.log('   Server:', sk);

  // M3U8
  console.log('3. Fetching M3U8...');
  const m3u8Url = `https://${sk}new.dvalna.ru/${sk}/premium51/mono.css`;
  const m3u8Res = await fetch(m3u8Url, {
    headers: { 'User-Agent': UA, 'Origin': 'https://epaly.fun', 'Referer': 'https://epaly.fun/', 'Authorization': `Bearer ${authToken}` },
  });
  const m3u8 = await m3u8Res.text();
  const keyMatch = m3u8.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/);
  if (!keyMatch) { console.log('   No key in M3U8 (unencrypted)'); process.exit(0); }
  const keyUrl = keyMatch[1];
  const kp = keyUrl.match(/\/key\/([^/]+)\/(\d+)/);
  console.log('   Key URL:', keyUrl);

  // Compute auth headers
  const resource = kp[1];
  const keyNumber = kp[2];
  const ts = Math.floor(Date.now() / 1000);
  const fp = sha256(UA + '1920x1080' + 'America/New_York' + 'en-US').substring(0, 16);
  const hp = hmacSha256(resource, channelSalt);
  let nonce = 0;
  for (let n = 0; n < 100000; n++) {
    if (parseInt(md5(hp + resource + keyNumber + ts + n).substring(0, 4), 16) < 0x1000) { nonce = n; break; }
  }
  const keyPath = hmacSha256(`${resource}|${keyNumber}|${ts}|${fp}`, channelSalt).substring(0, 16);

  const headers = {
    'User-Agent': UA, 'Accept': '*/*',
    'Origin': 'https://epaly.fun', 'Referer': 'https://epaly.fun/',
    'Authorization': `Bearer ${authToken}`,
    'X-Key-Timestamp': String(ts), 'X-Key-Nonce': String(nonce),
    'X-Key-Path': keyPath, 'X-Fingerprint': fp,
  };

  // Test A: Node.js fetch (same as what the proxy server uses internally)
  console.log('\n4a. Node.js fetch (direct from RPI)...');
  try {
    const res = await fetch(keyUrl, { headers });
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`   Status: ${res.status}, Size: ${buf.length}, Hex: ${buf.toString('hex')}`);
    console.log(`   Fake: ${buf.toString('hex').startsWith('45c6497') ? 'YES ❌' : 'NO ✅'}`);
  } catch (e) {
    console.log(`   Error: ${e.message}`);
  }

  // Test B: Node.js https module (what the /fetch route uses)
  console.log('\n4b. Node.js https.request (what /fetch route uses)...');
  const https = require('https');
  const u = new URL(keyUrl);
  await new Promise((resolve) => {
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'GET',
      headers: { ...headers },
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        console.log(`   Status: ${res.statusCode}, Size: ${buf.length}, Hex: ${buf.toString('hex')}`);
        console.log(`   Fake: ${buf.toString('hex').startsWith('45c6497') ? 'YES ❌' : 'NO ✅'}`);
        resolve();
      });
    });
    req.on('error', e => { console.log(`   Error: ${e.message}`); resolve(); });
    req.end();
  });

  // Test C: curl_chrome116 (what /fetch-impersonate uses)
  console.log('\n4c. curl_chrome116 (what /fetch-impersonate uses)...');
  const { spawn } = require('child_process');
  await new Promise((resolve) => {
    const args = ['-s', '--max-time', '15', '-i'];
    for (const [k, v] of Object.entries(headers)) {
      args.push('-H', `${k}: ${v}`);
    }
    args.push(keyUrl);
    
    const proc = spawn('curl_chrome116', args);
    const chunks = [];
    let stderr = '';
    proc.stdout.on('data', d => chunks.push(d));
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) { console.log(`   Exit ${code}: ${stderr}`); resolve(); return; }
      const output = Buffer.concat(chunks);
      const headerEnd = output.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEnd > 0) {
        const hdr = output.slice(0, headerEnd).toString();
        const body = output.slice(headerEnd + 4);
        const statusMatch = hdr.match(/HTTP\/[\d.]+ (\d+)/);
        console.log(`   Status: ${statusMatch?.[1]}, Size: ${body.length}, Hex: ${body.toString('hex')}`);
        console.log(`   Fake: ${body.toString('hex').startsWith('45c6497') ? 'YES ❌' : 'NO ✅'}`);
      } else {
        console.log(`   Raw: ${output.length}b, Hex: ${output.toString('hex').substring(0, 32)}`);
      }
      resolve();
    });
    proc.on('error', () => { console.log('   curl_chrome116 not installed'); resolve(); });
  });

  // Test D: regular curl
  console.log('\n4d. Regular curl...');
  await new Promise((resolve) => {
    const args = ['-s', '--max-time', '15', '-i'];
    for (const [k, v] of Object.entries(headers)) {
      args.push('-H', `${k}: ${v}`);
    }
    args.push(keyUrl);
    
    const proc = spawn('curl', args);
    const chunks = [];
    proc.stdout.on('data', d => chunks.push(d));
    proc.on('close', (code) => {
      const output = Buffer.concat(chunks);
      const headerEnd = output.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEnd > 0) {
        const hdr = output.slice(0, headerEnd).toString();
        const body = output.slice(headerEnd + 4);
        const statusMatch = hdr.match(/HTTP\/[\d.]+ (\d+)/);
        console.log(`   Status: ${statusMatch?.[1]}, Size: ${body.length}, Hex: ${body.toString('hex')}`);
        console.log(`   Fake: ${body.toString('hex').startsWith('45c6497') ? 'YES ❌' : 'NO ✅'}`);
      }
      resolve();
    });
    proc.on('error', () => { console.log('   curl not found'); resolve(); });
  });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

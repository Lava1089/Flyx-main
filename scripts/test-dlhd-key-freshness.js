#!/usr/bin/env node
/**
 * Test if the RPI whitelist is actually working by:
 * 1. Checking whitelist status
 * 2. Forcing a re-whitelist
 * 3. Fetching a key and trying to decrypt
 */
const https = require('https');
const crypto = require('crypto');
const API = '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560';

function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { timeout: 20000, headers }, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

async function main() {
  // Step 1: Check RPI whitelist status
  console.log('=== RPI Whitelist Status ===');
  const ws = await fetch('https://rpi-proxy.vynx.cc/whitelist-status');
  const status = JSON.parse(ws.buf.toString());
  console.log(JSON.stringify(status, null, 2));
  console.log(`Minutes since last whitelist: ${status.minutesSinceSuccess}`);
  console.log(`Is whitelisted: ${status.whitelisted}`);
  
  // Step 2: Force re-whitelist
  console.log('\n=== Forcing re-whitelist ===');
  try {
    const rw = await fetch(`https://rpi-proxy.vynx.cc/whitelist-refresh?key=${API}`, { 'X-API-Key': API });
    console.log(`Status: ${rw.status}`);
    console.log(`Response: ${rw.buf.toString().substring(0, 300)}`);
  } catch (e) {
    console.log(`Re-whitelist error: ${e.message}`);
  }
  
  // Wait for whitelist to take effect
  console.log('\nWaiting 3s for whitelist to propagate...');
  await new Promise(r => setTimeout(r, 3000));
  
  // Step 3: Fetch M3U8 for ch44 to get a fresh key URL
  console.log('\n=== Fetching fresh M3U8 ===');
  const m3u8Res = await fetch('https://dlhd.vynx.workers.dev/play/44?key=vynx');
  const m3u8 = m3u8Res.buf.toString();
  
  let keyUrl, keyIV, segUrl;
  for (const line of m3u8.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#EXT-X-KEY')) {
      const um = t.match(/URI="([^"]+)"/);
      const im = t.match(/IV=0x([0-9a-fA-F]+)/);
      if (um) keyUrl = um[1];
      if (im) keyIV = im[1];
    }
    if (t && !t.startsWith('#') && t.startsWith('http') && !segUrl) segUrl = t;
  }
  
  if (!keyUrl) { console.log('No key URL found!'); return; }
  
  // Extract upstream URL
  const upstream = new URL(keyUrl).searchParams.get('url');
  console.log(`Key upstream: ${upstream}`);
  
  // Step 4: Fetch key via worker /key endpoint
  console.log('\n=== Fetching key via worker ===');
  const kr = await fetch(keyUrl);
  const keyHex = kr.buf.length === 16 ? kr.buf.toString('hex') : 'BAD';
  console.log(`Key: ${keyHex} (source: ${kr.headers['x-key-source']})`);
  
  // Step 5: Also fetch key DIRECTLY from go.ai-chatx.site via RPI
  console.log('\n=== Fetching key directly via RPI ===');
  const hdrs = JSON.stringify({ 'Referer': 'https://adffdafdsafds.sbs/', 'Origin': 'https://adffdafdsafds.sbs' });
  const directUrl = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(upstream)}&headers=${encodeURIComponent(hdrs)}&key=${API}`;
  const dr = await fetch(directUrl, { 'X-API-Key': API });
  const directHex = dr.buf.length === 16 ? dr.buf.toString('hex') : `BAD(${dr.buf.length}b): ${dr.buf.toString().substring(0,100)}`;
  console.log(`Direct key: ${directHex}`);
  
  // Step 6: Also try vovlacosa.sbs
  console.log('\n=== Trying chevy.vovlacosa.sbs ===');
  const keyPath = new URL(upstream).pathname;
  const vovUrl = `https://chevy.vovlacosa.sbs${keyPath}`;
  const vovRpiUrl = `https://rpi-proxy.vynx.cc/fetch?url=${encodeURIComponent(vovUrl)}&headers=${encodeURIComponent(hdrs)}&key=${API}`;
  const vr = await fetch(vovRpiUrl, { 'X-API-Key': API });
  const vovHex = vr.buf.length === 16 ? vr.buf.toString('hex') : `BAD(${vr.buf.length}b)`;
  console.log(`Vovlacosa key: ${vovHex}`);
  
  // Step 7: Try decrypt with each key
  if (segUrl && keyIV) {
    console.log('\n=== Decrypt test ===');
    const sr = await fetch(segUrl);
    console.log(`Segment: ${sr.buf.length} bytes`);
    
    const keys = [
      { name: 'worker', hex: keyHex, buf: kr.buf },
      { name: 'direct-go', hex: directHex, buf: dr.buf },
      { name: 'vovlacosa', hex: vovHex, buf: vr.buf },
    ];
    
    const ivBuf = Buffer.from(keyIV, 'hex');
    
    for (const k of keys) {
      if (k.buf.length !== 16) { console.log(`  ${k.name}: skip (not 16b)`); continue; }
      try {
        const dec = crypto.createDecipheriv('aes-128-cbc', k.buf, ivBuf);
        dec.setAutoPadding(true);
        const d1 = dec.update(sr.buf);
        const d2 = dec.final();
        const decrypted = Buffer.concat([d1, d2]);
        const isMpegTS = decrypted[0] === 0x47;
        console.log(`  ${k.name} (${k.hex.substring(0,8)}...): ${isMpegTS ? '✅ VALID MPEG-TS' : '⚠️ decrypted but not TS'} (${decrypted.length}b)`);
      } catch (e) {
        console.log(`  ${k.name} (${k.hex.substring(0,8)}...): ❌ DECRYPT FAILED — wrong key`);
      }
    }
  }
  
  // Are all keys the same? That means whitelist isn't working
  console.log('\n=== Analysis ===');
  const allSame = keyHex === directHex && directHex === vovHex;
  console.log(`All keys same: ${allSame}`);
  if (allSame) {
    console.log('⚠️ All servers returning same key — likely a universal fake/poison key');
    console.log('The RPI whitelist may have expired or the key server changed behavior');
  }
}

main().catch(e => console.error('Fatal:', e.message));

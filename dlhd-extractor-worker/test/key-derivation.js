#!/usr/bin/env node
/**
 * Try key derivation approaches
 */

const http = require('http');
const crypto = require('crypto');

const API_URL = 'http://127.0.0.1:8787';
const API_KEY = 'test';

function fetchLocal(url) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'X-API-Key': API_KEY },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks) }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

function tryDecrypt(data, key, iv, name) {
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(data.slice(0, 1024)), decipher.final()]);
    
    if (decrypted[0] === 0x47) {
      console.log(`   ✅ ${name}: SUCCESS! First byte is 0x47`);
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function main() {
  console.log('═'.repeat(70));
  console.log('KEY DERIVATION ATTEMPTS');
  console.log('═'.repeat(70));
  
  // Get data
  const streamRes = await fetchLocal(`${API_URL}/stream/31`);
  const streamData = JSON.parse(streamRes.data.toString());
  
  const m3u8Res = await fetchLocal(streamData.streamUrl + '&key=' + API_KEY);
  const m3u8Content = m3u8Res.data.toString();
  
  // Parse
  let keyUrl = null;
  let ivHex = null;
  let segmentUrl = null;
  
  for (const line of m3u8Content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.includes('#EXT-X-KEY')) {
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      if (uriMatch) keyUrl = uriMatch[1];
      const ivMatch = trimmed.match(/IV=0x([0-9a-fA-F]+)/i);
      if (ivMatch) ivHex = ivMatch[1];
    }
    if (!segmentUrl && trimmed.startsWith('http') && trimmed.includes('/live/ts')) {
      segmentUrl = trimmed;
    }
  }
  
  const keyRes = await fetchLocal(keyUrl);
  const rawKey = keyRes.data;
  const iv = Buffer.from(ivHex, 'hex');
  
  const segRes = await fetchLocal(segmentUrl);
  const segment = segRes.data;
  
  console.log(`\nRaw key: ${rawKey.toString('hex')}`);
  console.log(`IV: ${iv.toString('hex')}`);
  console.log(`Segment size: ${segment.length}`);
  
  console.log('\n1. KEY DERIVATION ATTEMPTS:');
  
  // Try various key derivations
  const derivations = [
    { name: 'Raw key', key: rawKey },
    { name: 'MD5(key)', key: crypto.createHash('md5').update(rawKey).digest() },
    { name: 'SHA256(key)[0:16]', key: crypto.createHash('sha256').update(rawKey).digest().slice(0, 16) },
    { name: 'Key reversed', key: Buffer.from([...rawKey].reverse()) },
    { name: 'Key XOR 0xFF', key: Buffer.from(rawKey.map(b => b ^ 0xFF)) },
    { name: 'MD5(key+iv)', key: crypto.createHash('md5').update(Buffer.concat([rawKey, iv])).digest() },
    { name: 'MD5(iv+key)', key: crypto.createHash('md5').update(Buffer.concat([iv, rawKey])).digest() },
  ];
  
  // Also try with different IVs
  const ivs = [
    { name: 'M3U8 IV', iv: iv },
    { name: 'Zero IV', iv: Buffer.alloc(16, 0) },
    { name: 'Key as IV', iv: rawKey },
  ];
  
  for (const d of derivations) {
    for (const i of ivs) {
      if (tryDecrypt(segment, d.key, i.iv, `${d.name} + ${i.name}`)) {
        console.log(`\n   FOUND WORKING COMBINATION!`);
        console.log(`   Key: ${d.key.toString('hex')}`);
        console.log(`   IV: ${i.iv.toString('hex')}`);
        return;
      }
    }
  }
  
  console.log('\n2. TRYING PBKDF2 DERIVATIONS:');
  
  const salts = [
    Buffer.from('dlhd'),
    Buffer.from('premium'),
    iv,
    rawKey,
  ];
  
  for (const salt of salts) {
    const derived = crypto.pbkdf2Sync(rawKey, salt, 1000, 16, 'sha256');
    for (const i of ivs) {
      if (tryDecrypt(segment, derived, i.iv, `PBKDF2(salt=${salt.toString('hex').slice(0,8)}...) + ${i.name}`)) {
        console.log(`\n   FOUND WORKING COMBINATION!`);
        return;
      }
    }
  }
  
  console.log('\n3. CHECKING IF DATA IS DOUBLE-ENCRYPTED:');
  
  // First decrypt with raw key
  try {
    const decipher1 = crypto.createDecipheriv('aes-128-cbc', rawKey, iv);
    decipher1.setAutoPadding(false);
    const firstPass = Buffer.concat([decipher1.update(segment), decipher1.final()]);
    
    console.log(`   First pass result: ${firstPass.slice(0, 32).toString('hex')}`);
    
    // Try second decrypt
    for (const d of derivations) {
      for (const i of ivs) {
        if (tryDecrypt(firstPass, d.key, i.iv, `Double: ${d.name} + ${i.name}`)) {
          console.log(`\n   DOUBLE ENCRYPTION CONFIRMED!`);
          return;
        }
      }
    }
  } catch (e) {
    console.log(`   First pass failed: ${e.message}`);
  }
  
  console.log('\n4. CHECKING SEGMENT STRUCTURE:');
  
  // Maybe there's a header we need to skip?
  const headerSizes = [16, 32, 64, 128, 188, 256];
  
  for (const skip of headerSizes) {
    console.log(`   Trying skip ${skip} bytes...`);
    for (const i of ivs) {
      if (tryDecrypt(segment.slice(skip), rawKey, i.iv, `Skip ${skip} + ${i.name}`)) {
        console.log(`\n   FOUND: Need to skip ${skip} bytes!`);
        return;
      }
    }
  }
  
  console.log('\n   No working combination found.');
  console.log('\n   This might be a custom encryption scheme.');
}

main().catch(console.error);

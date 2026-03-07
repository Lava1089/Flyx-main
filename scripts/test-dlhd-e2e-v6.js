#!/usr/bin/env node
/**
 * E2E test for DLHD Key V6 flow
 * 
 * Tests the full pipeline:
 * 1. CF Worker fetches M3U8 (direct, no RPI needed)
 * 2. M3U8 key URLs are rewritten to RPI /dlhd-key-v6 endpoint
 * 3. RPI fetches key via rust-fetch (Chrome TLS from residential IP)
 * 4. Key is validated (16 bytes, not known fake pattern)
 * 5. HLS.js decrypts segments with the key
 * 
 * Usage: node scripts/test-dlhd-e2e-v6.js [channel]
 */

const https = require('https');
const crypto = require('crypto');

const RPI_URL = process.env.RPI_PROXY_URL || 'https://rpi-proxy.vynx.cc';
const RPI_KEY = process.env.RPI_PROXY_KEY || '5f1845926d725bb2a8230a6ed231fce1d03f07782f74a3f683c30ec04d4ac560';
const DLHD_WORKER = process.env.DLHD_WORKER_URL || 'https://dlhd.vynx.workers.dev';
const CHANNEL = process.argv[2] || '44';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function fetchBuf(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': UA, ...headers },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': UA, ...headers },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function main() {
  console.log('='.repeat(80));
  console.log(`DLHD Key V6 E2E Test — Channel ${CHANNEL}`);
  console.log(`RPI: ${RPI_URL}`);
  console.log(`DLHD Worker: ${DLHD_WORKER}`);
  console.log('='.repeat(80));

  // Step 1: Test RPI /dlhd-key-v6 endpoint directly
  console.log('\n--- Step 1: Server Lookup ---');
  const lookupRes = await fetchText(`https://chevy.vovlacosa.sbs/server_lookup?channel_id=premium${CHANNEL}`, {
    'Referer': 'https://adffdafdsafds.sbs/',
  });
  const serverKey = JSON.parse(lookupRes.body).server_key;
  console.log(`Server: ${serverKey}`);

  // Step 2: Fetch M3U8 directly
  console.log('\n--- Step 2: Fetch M3U8 ---');
  const m3u8Url = `https://chevy.soyspace.cyou/proxy/${serverKey}/premium${CHANNEL}/mono.css`;
  const m3u8Res = await fetchText(m3u8Url, {
    'Referer': 'https://adffdafdsafds.sbs/',
    'Origin': 'https://adffdafdsafds.sbs',
  });
  
  if (!m3u8Res.body.includes('#EXTM3U')) {
    console.log('❌ Invalid M3U8:', m3u8Res.body.substring(0, 200));
    return;
  }
  console.log('✅ Valid M3U8 received');

  // Parse key URI
  const keyLine = m3u8Res.body.match(/#EXT-X-KEY:([^\n]+)/);
  if (!keyLine) {
    console.log('❌ No EXT-X-KEY found');
    return;
  }
  
  const uriMatch = keyLine[1].match(/URI="([^"]+)"/);
  const ivMatch = keyLine[1].match(/IV=([^,\s]+)/);
  
  if (!uriMatch || !ivMatch) {
    console.log('❌ Could not parse URI or IV');
    return;
  }
  
  const keyPath = uriMatch[1];
  const ivStr = ivMatch[1];
  const ivBuf = Buffer.from(ivStr.replace(/^0x/i, ''), 'hex');
  
  console.log(`Key path: ${keyPath}`);
  console.log(`IV: ${ivStr}`);

  // Get first segment URL
  const lines = m3u8Res.body.split('\n');
  let segmentUrl = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.startsWith('http')) {
      segmentUrl = trimmed;
      break;
    }
  }

  // Step 3: Test RPI /dlhd-key-v6 endpoint
  console.log('\n--- Step 3: Fetch Key via RPI /dlhd-key-v6 ---');
  const originalKeyUrl = `https://chevy.soyspace.cyou${keyPath}`;
  const rpiKeyUrl = `${RPI_URL}/dlhd-key-v6?url=${encodeURIComponent(originalKeyUrl)}&key=${RPI_KEY}`;
  console.log(`RPI URL: ${rpiKeyUrl.substring(0, 120)}...`);
  
  try {
    const keyRes = await fetchBuf(rpiKeyUrl);
    console.log(`Status: ${keyRes.status}, Size: ${keyRes.body.length}`);
    
    if (keyRes.status !== 200) {
      const text = keyRes.body.toString('utf8');
      console.log(`❌ RPI returned error: ${text.substring(0, 200)}`);
      return;
    }
    
    if (keyRes.body.length !== 16) {
      console.log(`❌ Key is not 16 bytes: ${keyRes.body.length}`);
      console.log(`Body: ${keyRes.body.toString('utf8').substring(0, 100)}`);
      return;
    }
    
    const keyHex = keyRes.body.toString('hex');
    console.log(`Key hex: ${keyHex}`);
    console.log(`X-Fetched-By: ${keyRes.headers['x-fetched-by']}`);
    
    // Step 4: Validate key by decrypting segment
    if (segmentUrl) {
      console.log('\n--- Step 4: Decrypt-Validate Key ---');
      console.log(`Segment: ${segmentUrl.substring(0, 80)}...`);
      
      const segRes = await fetchBuf(segmentUrl);
      console.log(`Segment size: ${segRes.body.length} bytes`);
      
      try {
        const decipher = crypto.createDecipheriv('aes-128-cbc', keyRes.body, ivBuf);
        decipher.setAutoPadding(false);
        const decrypted = Buffer.concat([decipher.update(segRes.body), decipher.final()]);
        
        const firstByte = decrypted[0];
        console.log(`First byte after decrypt: 0x${firstByte.toString(16).padStart(2, '0')}`);
        
        let syncCount = 0;
        for (let i = 0; i < Math.min(decrypted.length, 1880); i += 188) {
          if (decrypted[i] === 0x47) syncCount++;
        }
        console.log(`TS sync bytes: ${syncCount}/10`);
        
        if (firstByte === 0x47) {
          console.log('✅ REAL KEY — decrypts to valid MPEG-TS!');
        } else {
          console.log(`❌ FAKE KEY — first byte 0x${firstByte.toString(16)} ≠ 0x47`);
        }
      } catch (e) {
        console.log(`❌ Decrypt error: ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`❌ RPI request failed: ${e.message}`);
  }

  // Step 5: Test CF Worker /play endpoint (full pipeline)
  console.log('\n--- Step 5: Test CF Worker /play Endpoint ---');
  const playUrl = `${DLHD_WORKER}/play/${CHANNEL}`;
  console.log(`Play URL: ${playUrl}`);
  
  try {
    const playRes = await fetchText(playUrl, {
      'X-API-Key': 'vynx',
    });
    console.log(`Status: ${playRes.status}`);
    
    if (playRes.status === 200 && playRes.body.includes('#EXTM3U')) {
      console.log('✅ CF Worker returned valid M3U8');
      
      // Check if key URLs point to RPI
      const keyLinePlay = playRes.body.match(/URI="([^"]+)"/);
      if (keyLinePlay) {
        const keyUrl = keyLinePlay[1];
        if (keyUrl.includes('dlhd-key-v6')) {
          console.log(`✅ Key URL points to RPI /dlhd-key-v6: ${keyUrl.substring(0, 100)}...`);
        } else if (keyUrl.includes('go.ai-chatx.site')) {
          console.log(`⚠️ Key URL still points to go.ai-chatx.site (fallback): ${keyUrl.substring(0, 100)}`);
        } else {
          console.log(`Key URL: ${keyUrl.substring(0, 100)}`);
        }
      }
    } else {
      console.log(`Response: ${playRes.body.substring(0, 200)}`);
    }
  } catch (e) {
    console.log(`❌ CF Worker request failed: ${e.message}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('E2E Test Complete');
  console.log('='.repeat(80));
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});

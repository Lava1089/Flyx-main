#!/usr/bin/env node
/**
 * Analyze raw M3U8 content directly from upstream
 */

const https = require('https');
const crypto = require('crypto');

function fetchHttps(url, headers = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Origin': 'https://hitsplay.fun',
        'Referer': 'https://hitsplay.fun/',
        ...headers,
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
}

async function main() {
  console.log('═'.repeat(70));
  console.log('RAW M3U8 ANALYSIS');
  console.log('═'.repeat(70));
  
  // First get server lookup
  console.log('\n1. Getting server lookup...');
  const lookupRes = await fetchHttps('https://chevy.dvalna.ru/server_lookup?channel_id=premium31');
  console.log(`   Status: ${lookupRes.status}`);
  
  if (lookupRes.error) {
    console.log(`   Error: ${lookupRes.error}`);
    return;
  }
  
  const lookupData = JSON.parse(lookupRes.data.toString());
  console.log(`   Server key: ${lookupData.server_key}`);
  
  // Construct M3U8 URL
  const sk = lookupData.server_key;
  const m3u8Url = (sk === 'top1/cdn')
    ? `https://top1.dvalna.ru/top1/cdn/premium31/mono.css`
    : `https://${sk}new.dvalna.ru/${sk}/premium31/mono.css`;
  
  console.log(`   M3U8 URL: ${m3u8Url}`);
  
  // Fetch M3U8
  console.log('\n2. Fetching M3U8...');
  const m3u8Res = await fetchHttps(m3u8Url);
  console.log(`   Status: ${m3u8Res.status}`);
  
  if (m3u8Res.error || m3u8Res.status !== 200) {
    console.log(`   Error: ${m3u8Res.error || 'HTTP ' + m3u8Res.status}`);
    console.log(`   Response: ${m3u8Res.data?.toString().substring(0, 200)}`);
    return;
  }
  
  const m3u8Content = m3u8Res.data.toString();
  console.log('\n3. M3U8 Content:');
  console.log('─'.repeat(70));
  console.log(m3u8Content);
  console.log('─'.repeat(70));
  
  // Parse M3U8
  console.log('\n4. Parsing M3U8...');
  let keyUrl = null;
  let ivHex = null;
  let segmentUrls = [];
  
  for (const line of m3u8Content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.includes('#EXT-X-KEY')) {
      console.log(`   KEY line: ${trimmed}`);
      const uriMatch = trimmed.match(/URI="([^"]+)"/);
      if (uriMatch) keyUrl = uriMatch[1];
      const ivMatch = trimmed.match(/IV=0x([0-9a-fA-F]+)/i);
      if (ivMatch) ivHex = ivMatch[1];
    }
    if (trimmed.startsWith('http') && !trimmed.startsWith('#')) {
      segmentUrls.push(trimmed);
    }
  }
  
  console.log(`   Key URL: ${keyUrl}`);
  console.log(`   IV: ${ivHex}`);
  console.log(`   Segments: ${segmentUrls.length}`);
  
  if (segmentUrls.length > 0) {
    console.log(`   First segment: ${segmentUrls[0]}`);
  }
  
  // Fetch key
  if (keyUrl) {
    console.log('\n5. Fetching key...');
    const keyRes = await fetchHttps(keyUrl);
    console.log(`   Status: ${keyRes.status}`);
    
    if (keyRes.status === 200) {
      const key = keyRes.data;
      console.log(`   Key: ${key.toString('hex')}`);
      console.log(`   Length: ${key.length} bytes`);
      
      // Fetch first segment
      if (segmentUrls.length > 0) {
        console.log('\n6. Fetching first segment...');
        const segRes = await fetchHttps(segmentUrls[0]);
        console.log(`   Status: ${segRes.status}`);
        
        if (segRes.status === 200) {
          const segment = segRes.data;
          console.log(`   Size: ${segment.length} bytes`);
          console.log(`   First 64 bytes: ${segment.slice(0, 64).toString('hex')}`);
          
          // Try decryption
          console.log('\n7. Testing decryption...');
          const iv = Buffer.from(ivHex, 'hex');
          
          try {
            const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
            decipher.setAutoPadding(false);
            const decrypted = Buffer.concat([decipher.update(segment.slice(0, 2048)), decipher.final()]);
            
            console.log(`   First decrypted byte: 0x${decrypted[0].toString(16)}`);
            console.log(`   First 64 decrypted: ${decrypted.slice(0, 64).toString('hex')}`);
            
            // Check for MPEG-TS sync bytes
            let syncCount = 0;
            for (let i = 0; i < Math.min(decrypted.length, 10 * 188); i += 188) {
              if (decrypted[i] === 0x47) syncCount++;
            }
            console.log(`   Sync bytes: ${syncCount}/10`);
            
            if (syncCount >= 5) {
              console.log('   ✅ DECRYPTION WORKS!');
            } else {
              console.log('   ❌ Decryption failed - not valid MPEG-TS');
            }
          } catch (e) {
            console.log(`   Decryption error: ${e.message}`);
          }
        } else if (segRes.status === 302 || segRes.status === 301) {
          const redirectUrl = segRes.headers.location;
          console.log(`   Redirect to: ${redirectUrl}`);
          
          // Follow redirect
          console.log('\n6b. Following redirect...');
          const segRes2 = await fetchHttps(redirectUrl);
          console.log(`   Status: ${segRes2.status}`);
          
          if (segRes2.status === 200) {
            const segment = segRes2.data;
            console.log(`   Size: ${segment.length} bytes`);
            console.log(`   First 64 bytes: ${segment.slice(0, 64).toString('hex')}`);
            
            // Try decryption
            console.log('\n7. Testing decryption...');
            const iv = Buffer.from(ivHex, 'hex');
            
            try {
              const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
              decipher.setAutoPadding(false);
              const decrypted = Buffer.concat([decipher.update(segment.slice(0, 2048)), decipher.final()]);
              
              console.log(`   First decrypted byte: 0x${decrypted[0].toString(16)}`);
              console.log(`   First 64 decrypted: ${decrypted.slice(0, 64).toString('hex')}`);
              
              // Check for MPEG-TS sync bytes
              let syncCount = 0;
              for (let i = 0; i < Math.min(decrypted.length, 10 * 188); i += 188) {
                if (decrypted[i] === 0x47) syncCount++;
              }
              console.log(`   Sync bytes: ${syncCount}/10`);
              
              if (syncCount >= 5) {
                console.log('   ✅ DECRYPTION WORKS!');
              } else {
                console.log('   ❌ Decryption failed - not valid MPEG-TS');
              }
            } catch (e) {
              console.log(`   Decryption error: ${e.message}`);
            }
          }
        }
      }
    }
  }
}

main().catch(console.error);

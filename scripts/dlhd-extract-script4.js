#!/usr/bin/env node
/**
 * Extract and analyze Script 4 from the DLHD player page
 * This is the obfuscated script with Function() and XMLHttpRequest
 */
const https = require('https');

function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...headers,
    }, timeout: 15000 }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    }).on('error', reject);
  });
}

async function main() {
  const res = await fetch('https://www.ksohls.ru/premiumtv/daddyhd.php?id=303', {
    'Referer': 'https://daddylive.mp/',
  });
  
  // Extract all scripts
  const scripts = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(res.body)) !== null) {
    if (m[1].trim().length > 0) scripts.push(m[1].trim());
  }
  
  // Script 4 is the obfuscated one with Function()
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
    if (s.includes('Function(') && s.length > 3000 && s.length < 5000) {
      console.log(`=== Script ${i} (${s.length} chars) ===`);
      console.log(s);
      console.log('\n=== END ===');
    }
  }
  
  // Also extract Script 13 (encodedDomains)
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
    if (s.includes('encodedDomains')) {
      console.log(`\n=== Script ${i} — encodedDomains (${s.length} chars) ===`);
      // Decode the base64 domains list
      const match = s.match(/encodedDomains\s*=\s*"([^"]+)"/);
      if (match) {
        try {
          const decoded = Buffer.from(match[1], 'base64').toString();
          console.log('Decoded domains:', decoded);
        } catch (e) {
          console.log('Decode error:', e.message);
        }
      }
      console.log('\nFull script:');
      console.log(s);
    }
  }
  
  // Extract the full player script (Script 14) and look for the verify response handling
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
    if (s.length > 30000 && s.includes('premium') && s.includes('m3u8')) {
      console.log(`\n=== Player Script ${i} — verify response handling ===`);
      // Find what the verify response looks like
      const verifySection = s.match(/\.then\(data\s*=>\s*\{[\s\S]{0,500}data\.success/);
      if (verifySection) console.log(verifySection[0]);
      
      // Find if there's any cookie handling
      const cookieSection = s.match(/cookie[\s\S]{0,300}/gi);
      if (cookieSection) {
        console.log('\nCookie references:');
        for (const cs of cookieSection) console.log('  ', cs.substring(0, 200));
      }
      
      // Find if there's any token/auth header being set for key requests
      const authSection = s.match(/(?:Authorization|Bearer|X-Auth|X-Token)[\s\S]{0,300}/gi);
      if (authSection) {
        console.log('\nAuth header references:');
        for (const as of authSection) console.log('  ', as.substring(0, 200));
      }
      
      // Find hlsjsConfig — does it set custom headers for key requests?
      const hlsConfig = s.match(/hlsjsConfig[\s\S]{0,2000}/);
      if (hlsConfig) {
        console.log('\nhlsjsConfig:');
        console.log(hlsConfig[0].substring(0, 2000));
      }
    }
  }
}

main().catch(e => console.error(e));

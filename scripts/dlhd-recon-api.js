#!/usr/bin/env node
/**
 * DLHD API Deep Recon - server_lookup and new domains
 */

async function main() {
  // Test server_lookup with correct parameter name
  console.log('=== server_lookup API ===');
  const lookupDomains = ['chevy.soyspace.cyou', 'chevy.adsfadfds.cfd', 'chevy.vovlacosa.sbs'];
  
  for (const domain of lookupDomains) {
    for (const ch of ['44', '51', '100', '851']) {
      const url = `https://${domain}/server_lookup?channel_id=${ch}`;
      try {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.ksohls.ru/',
            'Origin': 'https://www.ksohls.ru',
          },
        });
        const text = await resp.text();
        console.log(`${domain} ch${ch}: ${resp.status} -> ${text.substring(0, 200)}`);
      } catch (e) {
        console.log(`${domain} ch${ch}: ERROR ${e.message}`);
      }
    }
    console.log('');
  }
  
  // Test the new domain chevy.vovlacosa.sbs for M3U8
  console.log('\n=== Testing chevy.vovlacosa.sbs for M3U8 ===');
  const servers = ['ddy6', 'zeko', 'wind', 'dokko1', 'nfs', 'wiki', 'top1'];
  for (const server of servers) {
    const url = `https://chevy.vovlacosa.sbs/proxy/${server}/premium44/mono.css`;
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.ksohls.ru/',
          'Origin': 'https://www.ksohls.ru',
        },
      });
      const text = await resp.text();
      console.log(`vovlacosa.sbs/${server}: ${resp.status} isM3U8=${text.includes('#EXTM3U')} len=${text.length}`);
      if (text.length < 200 && !text.includes('#EXTM3U')) console.log(`  Body: ${text}`);
    } catch (e) {
      console.log(`vovlacosa.sbs/${server}: ERROR ${e.message}`);
    }
  }
  
  // Test key server on vovlacosa.sbs
  console.log('\n=== Testing chevy.vovlacosa.sbs for keys ===');
  try {
    const keyUrl = 'https://chevy.vovlacosa.sbs/key/premium44/5907766';
    const resp = await fetch(keyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.ksohls.ru/',
        'Origin': 'https://www.ksohls.ru',
      },
    });
    console.log(`Key fetch: ${resp.status}`);
    if (resp.ok) {
      const data = await resp.arrayBuffer();
      const hex = Array.from(new Uint8Array(data)).map(b => b.toString(16).padStart(2, '0')).join('');
      console.log(`Key: ${hex} (${data.byteLength} bytes)`);
    }
  } catch (e) {
    console.log(`Key ERROR: ${e.message}`);
  }
  
  // Fetch and analyze the obfuscated.js to understand server selection logic
  console.log('\n=== Analyzing obfuscated.js ===');
  try {
    const resp = await fetch('https://www.ksohls.ru/obfuscated.js', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.ksohls.ru/',
      },
    });
    const js = await resp.text();
    console.log(`Size: ${js.length}`);
    console.log(`\nFull content:\n${js}`);
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
}

main().catch(e => console.error('Fatal:', e));

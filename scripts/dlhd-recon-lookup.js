#!/usr/bin/env node
/**
 * Test server_lookup API with correct parameter format
 */

async function main() {
  const domains = ['chevy.vovlacosa.sbs', 'chevy.adsfadfds.cfd', 'chevy.soyspace.cyou'];
  const channels = ['premium44', 'premium51', 'premium1', 'premium100', 'premium851', 'premium439', 'premium900'];
  
  console.log('=== server_lookup with channel_id=premiumXX ===\n');
  
  for (const domain of domains) {
    console.log(`--- ${domain} ---`);
    for (const ch of channels) {
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
        console.log(`  ${ch}: ${resp.status} -> ${text.substring(0, 200)}`);
      } catch (e) {
        console.log(`  ${ch}: ERROR ${e.message}`);
      }
    }
    console.log('');
  }
  
  // Now test top1/cdn server
  console.log('=== Testing top1/cdn server ===');
  const testChannels = ['premium44', 'premium51', 'premium1'];
  for (const ch of testChannels) {
    const url = `https://chevy.adsfadfds.cfd/proxy/top1/cdn/${ch}/mono.css`;
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.ksohls.ru/',
          'Origin': 'https://www.ksohls.ru',
        },
      });
      const text = await resp.text();
      console.log(`top1/cdn ${ch}: ${resp.status} isM3U8=${text.includes('#EXTM3U')} len=${text.length}`);
      if (!text.includes('#EXTM3U') && text.length < 200) console.log(`  Body: ${text}`);
    } catch (e) {
      console.log(`top1/cdn ${ch}: ERROR ${e.message}`);
    }
  }
}

main().catch(e => console.error('Fatal:', e));

#!/usr/bin/env node
/**
 * Extract the full player flow from the inline script on the player page
 * This will show us how the browser selects servers and constructs M3U8 URLs
 */

async function main() {
  const resp = await fetch('https://www.ksohls.ru/premiumtv/daddyhd.php?id=44', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://daddylive.mp/',
    },
  });
  const html = await resp.text();
  
  // Find the main inline script that sets up the player
  const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  
  console.log('=== PLAYER FLOW ANALYSIS ===\n');
  
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i].replace(/<\/?script>/g, '');
    
    // Look for the script that contains server_lookup or HLS setup
    if (script.includes('server_lookup') || script.includes('Hls') || script.includes('mono.css') || script.includes('proxy/')) {
      console.log(`\n=== Script ${i} (${script.length} chars) ===`);
      console.log(script.substring(0, 3000));
      if (script.length > 3000) {
        console.log('\n... (showing key sections) ...\n');
        
        // Find server_lookup usage
        const slIdx = script.indexOf('server_lookup');
        if (slIdx > -1) {
          console.log('--- server_lookup context ---');
          console.log(script.substring(Math.max(0, slIdx - 200), slIdx + 500));
        }
        
        // Find mono.css / M3U8 URL construction
        const monoIdx = script.indexOf('mono.css');
        if (monoIdx > -1) {
          console.log('\n--- mono.css context ---');
          console.log(script.substring(Math.max(0, monoIdx - 300), monoIdx + 200));
        }
        
        // Find proxy/ URL construction
        const proxyIdx = script.indexOf('proxy/');
        if (proxyIdx > -1) {
          console.log('\n--- proxy/ context ---');
          console.log(script.substring(Math.max(0, proxyIdx - 300), proxyIdx + 200));
        }
        
        // Find HLS setup
        const hlsIdx = script.indexOf('Hls');
        if (hlsIdx > -1) {
          console.log('\n--- HLS setup context ---');
          console.log(script.substring(Math.max(0, hlsIdx - 100), hlsIdx + 500));
        }
        
        // Find chevy domain references
        const chevyIdx = script.indexOf('chevy');
        if (chevyIdx > -1) {
          console.log('\n--- chevy domain context ---');
          console.log(script.substring(Math.max(0, chevyIdx - 200), chevyIdx + 300));
        }
        
        // Find getXhrSetup (key auth injection)
        const xhrIdx = script.indexOf('getXhrSetup') || script.indexOf('xhrSetup');
        if (xhrIdx > -1) {
          console.log('\n--- XHR setup context ---');
          console.log(script.substring(Math.max(0, xhrIdx - 200), xhrIdx + 300));
        }
      }
    }
  }
  
  // Also look for any external JS that might contain server logic
  const externalScripts = html.match(/src="([^"]+\.js[^"]*)"/g) || [];
  console.log('\n=== External scripts ===');
  for (const s of externalScripts) {
    console.log(s);
  }
}

main().catch(e => console.error('Fatal:', e));

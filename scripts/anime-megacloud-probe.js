/**
 * MegaCloud API endpoint discovery
 * The embed URL is: /embed-2/v3/e-1/{id}?k=1
 * Need to find the getSources API endpoint
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

async function tryEndpoint(url, referer) {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': referer,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
      },
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, size: text.length, text };
  } catch (e) {
    return { status: -1, error: e.message };
  }
}

async function main() {
  const embedId = 'zqAeB6Od5pJp';
  const domain = 'megacloud.blog';
  const embedUrl = `https://${domain}/embed-2/v3/e-1/${embedId}?k=1`;
  
  console.log('=== MEGACLOUD API ENDPOINT DISCOVERY ===\n');
  console.log(`Embed URL: ${embedUrl}`);
  console.log(`Embed ID: ${embedId}\n`);
  
  // Try many possible endpoint patterns
  const endpoints = [
    // v3 variants
    `/embed-2/v3/ajax/e-1/getSources?id=${embedId}`,
    `/embed-2/v3/ajax/getSources?id=${embedId}`,
    `/embed-2/ajax/v3/e-1/getSources?id=${embedId}`,
    `/embed-2/ajax/v3/getSources?id=${embedId}`,
    
    // Without v3
    `/embed-2/ajax/e-1/getSources?id=${embedId}`,
    `/embed-2/ajax/getSources?id=${embedId}`,
    
    // With k parameter
    `/embed-2/ajax/e-1/getSources?id=${embedId}&k=1`,
    `/embed-2/v3/ajax/e-1/getSources?id=${embedId}&k=1`,
    
    // Different base paths
    `/ajax/embed-2/getSources?id=${embedId}`,
    `/ajax/embed/getSources?id=${embedId}`,
    `/ajax/v2/embed/getSources?id=${embedId}`,
    `/ajax/sources/${embedId}`,
    `/ajax/embed-6/getSources?id=${embedId}`,
    `/ajax/embed-6-v2/getSources?id=${embedId}`,
    
    // e-1 specific
    `/e-1/ajax/getSources?id=${embedId}`,
    `/e-1/getSources?id=${embedId}`,
    
    // API prefix
    `/api/embed-2/getSources?id=${embedId}`,
    `/api/v3/getSources?id=${embedId}`,
    `/api/getSources?id=${embedId}`,
    
    // Sources (not getSources)
    `/embed-2/ajax/e-1/sources?id=${embedId}`,
    `/embed-2/v3/ajax/e-1/sources?id=${embedId}`,
  ];
  
  console.log(`Testing ${endpoints.length} endpoints...\n`);
  
  for (const ep of endpoints) {
    const url = `https://${domain}${ep}`;
    const result = await tryEndpoint(url, embedUrl);
    const indicator = result.status === 200 ? '✅' : result.status === 404 ? '❌' : '⚠️';
    console.log(`${indicator} ${ep}: status=${result.status} size=${result.size || 0}`);
    
    if (result.status === 200 && result.text && result.text.length > 10) {
      try {
        const json = JSON.parse(result.text);
        console.log(`   Keys: ${Object.keys(json).join(', ')}`);
        if (json.sources) {
          console.log(`   SOURCES FOUND! Type: ${typeof json.sources}`);
          if (typeof json.sources === 'string') {
            console.log(`   Encrypted (${json.sources.length} chars): ${json.sources.substring(0, 80)}...`);
          }
        }
      } catch {
        console.log(`   Response: ${result.text.substring(0, 150)}`);
      }
    }
  }
  
  // Also try fetching the embed page and analyzing the player JS
  console.log('\n--- Embed Page Analysis ---');
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 15000);
    const res = await fetch(embedUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://hianime.to/' },
      signal: controller.signal,
    });
    const html = await res.text();
    console.log(`Embed page: status=${res.status} size=${html.length}`);
    
    // Find all script sources
    const scripts = html.match(/src="([^"]+\.js[^"]*)"/g) || [];
    console.log(`Scripts: ${scripts.length}`);
    scripts.forEach(s => console.log(`  ${s}`));
    
    // Find any AJAX/fetch patterns in inline scripts
    const inlineScripts = html.match(/<script>[\s\S]*?<\/script>/g) || [];
    console.log(`Inline scripts: ${inlineScripts.length}`);
    for (const script of inlineScripts) {
      const content = script.replace(/<\/?script>/g, '');
      if (content.length > 20 && content.length < 5000) {
        // Look for API patterns
        const apiPatterns = content.match(/["']\/[a-z/]+["']/g) || [];
        const fetchPatterns = content.match(/fetch\s*\(/g) || [];
        const xhrPatterns = content.match(/XMLHttpRequest|\.ajax|\.get|\.post/g) || [];
        if (apiPatterns.length > 0 || fetchPatterns.length > 0 || xhrPatterns.length > 0) {
          console.log(`  Interesting script (${content.length} chars):`);
          console.log(`    APIs: ${apiPatterns.join(', ')}`);
          console.log(`    Fetch: ${fetchPatterns.length}, XHR: ${xhrPatterns.length}`);
          console.log(`    Content: ${content.substring(0, 300)}`);
        }
      }
    }
    
    // Look for the player JS URL
    const playerJs = html.match(/src="([^"]*player[^"]*\.js[^"]*)"/);
    if (playerJs) {
      console.log(`\nPlayer JS: ${playerJs[1]}`);
      
      // Fetch the player JS and look for API endpoints
      const jsUrl = playerJs[1].startsWith('http') ? playerJs[1] : `https://${domain}${playerJs[1]}`;
      const jsRes = await fetch(jsUrl, {
        headers: { 'User-Agent': UA, 'Referer': embedUrl },
        signal: AbortSignal.timeout(15000),
      });
      const jsText = await jsRes.text();
      console.log(`Player JS size: ${jsText.length}`);
      
      // Search for getSources or source-related patterns
      const patterns = [
        /getSources/gi,
        /getSource/gi,
        /\/ajax\/[^"'\s]+/g,
        /sources\?/gi,
        /embed-2\/[^"'\s]+/g,
        /\.get\s*\(\s*["'][^"']+["']/g,
        /fetch\s*\(\s*["'][^"']+["']/g,
        /url\s*[:=]\s*["'][^"']+["']/g,
      ];
      
      for (const pattern of patterns) {
        const matches = jsText.match(pattern) || [];
        if (matches.length > 0) {
          const unique = [...new Set(matches)];
          console.log(`  ${pattern.source}: ${unique.slice(0, 10).join(' | ')}`);
        }
      }
    }
  } catch (e) {
    console.log(`Embed page FAILED: ${e.message}`);
  }
  
  console.log('\n=== DISCOVERY COMPLETE ===');
}

main().catch(console.error);

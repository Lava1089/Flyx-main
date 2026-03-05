const https = require('https');

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname, path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  // Get the full player page and look for EPlayerAuth implementation
  console.log('Fetching player page...');
  const r = await httpsGet('https://codepcplay.fun/premiumtv/daddyhd.php?id=51', { 'Referer': 'https://dlhd.link/' });
  const html = r.data.toString('utf8');
  
  // Find all script src URLs
  const scriptSrcs = html.match(/src=["']([^"']+\.js[^"']*?)["']/g);
  console.log('Script sources:', scriptSrcs ? scriptSrcs.length : 0);
  if (scriptSrcs) scriptSrcs.forEach(s => console.log(' ', s));
  
  // Find inline scripts that contain EPlayerAuth
  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  if (scripts) {
    for (const script of scripts) {
      if (script.includes('EPlayerAuth') || script.includes('getXhrSetup') || script.includes('keyUrl') || script.includes('/key/')) {
        console.log('\n=== EPlayerAuth script ===');
        // Extract just the content
        const content = script.replace(/<\/?script[^>]*>/gi, '').trim();
        if (content.length < 5000) {
          console.log(content);
        } else {
          console.log(content.substring(0, 2000));
          console.log('... (truncated, total:', content.length, 'chars)');
          // Look for key-related sections
          const keyIdx = content.indexOf('getXhrSetup');
          if (keyIdx >= 0) {
            console.log('\n--- getXhrSetup section ---');
            console.log(content.substring(Math.max(0, keyIdx - 200), keyIdx + 1000));
          }
          const authIdx = content.indexOf('getAuthToken');
          if (authIdx >= 0) {
            console.log('\n--- getAuthToken section ---');
            console.log(content.substring(Math.max(0, authIdx - 200), authIdx + 500));
          }
        }
      }
    }
  }
  
  // Also check for external EPlayerAuth script
  if (scriptSrcs) {
    for (const src of scriptSrcs) {
      const url = src.match(/src=["']([^"']+)["']/)[1];
      if (url.includes('player') || url.includes('auth') || url.includes('eplay')) {
        console.log('\n=== Fetching external script:', url, '===');
        try {
          const fullUrl = url.startsWith('http') ? url : `https://codepcplay.fun${url}`;
          const sr = await httpsGet(fullUrl, { 'Referer': 'https://codepcplay.fun/' });
          const js = sr.data.toString('utf8');
          if (js.includes('EPlayerAuth') || js.includes('getXhrSetup')) {
            console.log('Contains EPlayerAuth!');
            // Find getXhrSetup
            const idx = js.indexOf('getXhrSetup');
            if (idx >= 0) {
              console.log('\n--- getXhrSetup ---');
              console.log(js.substring(Math.max(0, idx - 500), idx + 2000));
            }
          } else {
            console.log('No EPlayerAuth in this script (', js.length, 'chars)');
          }
        } catch (e) {
          console.log('ERROR:', e.message);
        }
      }
    }
  }
}

main().catch(console.error);

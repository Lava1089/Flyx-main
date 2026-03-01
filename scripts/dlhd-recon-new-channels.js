#!/usr/bin/env node
/**
 * Scan for new channels beyond 870 and check the server_lookup API
 */

async function findWorkingServer(ch) {
  const servers = ['ddy6', 'zeko', 'wind', 'dokko1', 'nfs', 'wiki'];
  const domain = 'adsfadfds.cfd';
  for (const server of servers) {
    const url = `https://chevy.${domain}/proxy/${server}/premium${ch}/mono.css`;
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.ksohls.ru/',
          'Origin': 'https://www.ksohls.ru',
        },
      });
      const text = await resp.text();
      if (text.includes('#EXTM3U')) return server;
    } catch {}
  }
  return null;
}

async function main() {
  // Scan 871-950 for new channels
  console.log('=== Scanning channels 871-950 ===');
  const newChannels = {};
  for (let ch = 871; ch <= 950; ch++) {
    const server = await findWorkingServer(ch);
    if (server) {
      console.log(`ch${ch}: ${server}`);
      if (!newChannels[server]) newChannels[server] = [];
      newChannels[server].push(ch);
    }
  }
  
  console.log('\n=== New channels by server ===');
  for (const [server, channels] of Object.entries(newChannels)) {
    console.log(`${server}: [${channels.join(',')}]`);
  }
  
  // Also check the server_lookup API if it exists
  console.log('\n=== Testing server_lookup API ===');
  const lookupDomains = ['chevy.soyspace.cyou', 'chevy.adsfadfds.cfd'];
  for (const domain of lookupDomains) {
    for (const path of ['/server_lookup', '/server_lookup?channel=44', '/api/server_lookup', '/lookup']) {
      try {
        const resp = await fetch(`https://${domain}${path}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.ksohls.ru/',
          },
        });
        if (resp.status !== 404 && resp.status !== 403) {
          const text = await resp.text();
          console.log(`${domain}${path}: ${resp.status} (${text.substring(0, 200)})`);
        }
      } catch {}
    }
  }
  
  // Check the player page for server_lookup references
  console.log('\n=== Checking player page for server_lookup ===');
  const resp = await fetch('https://www.ksohls.ru/premiumtv/daddyhd.php?id=44', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://daddylive.mp/',
    },
  });
  const html = await resp.text();
  
  // Look for server_lookup or server assignment patterns
  const patterns = [
    /server_lookup/gi,
    /serverLookup/gi,
    /getServer/gi,
    /server\s*[:=]\s*["'](\w+)["']/gi,
    /chevy\.\w+\.\w+/gi,
    /proxy\/\w+\//gi,
  ];
  
  for (const pattern of patterns) {
    const matches = html.match(pattern);
    if (matches) {
      console.log(`Pattern ${pattern.source}: ${matches.length} matches`);
      // Show unique matches
      const unique = [...new Set(matches)];
      for (const m of unique.slice(0, 5)) {
        console.log(`  ${m}`);
      }
    }
  }
  
  // Look for the obfuscated.js URL
  const obfMatch = html.match(/src="([^"]*obfuscated[^"]*)"/);
  if (obfMatch) {
    console.log(`\nObfuscated JS URL: ${obfMatch[1]}`);
    // Fetch it and look for server logic
    try {
      const obfResp = await fetch(obfMatch[1].startsWith('http') ? obfMatch[1] : `https://www.ksohls.ru${obfMatch[1]}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.ksohls.ru/',
        },
      });
      const obfText = await obfResp.text();
      console.log(`Obfuscated JS size: ${obfText.length}`);
      
      // Look for server-related patterns
      for (const p of ['server_lookup', 'serverLookup', 'getServer', 'chevy', 'proxy/', 'mono.css', 'adsfadfds', 'soyspace']) {
        const idx = obfText.indexOf(p);
        if (idx > -1) {
          console.log(`Found "${p}" at offset ${idx}: ...${obfText.substring(Math.max(0, idx - 30), idx + 60)}...`);
        }
      }
    } catch (e) {
      console.log(`Error fetching obfuscated.js: ${e.message}`);
    }
  }
}

main().catch(e => console.error('Fatal:', e));

/**
 * Fetch and analyze hitsplay.fun player page
 */

const https = require('https');
const fs = require('fs');

const CHANNEL = 51;

async function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://dlhd.link/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    }).on('error', reject);
  });
}

async function analyzeHitsplay() {
  console.log('='.repeat(70));
  console.log('HITSPLAY.FUN ANALYSIS');
  console.log('='.repeat(70));
  
  const url = `https://hitsplay.fun/premiumtv/daddyhd.php?id=${CHANNEL}`;
  console.log(`\nFetching: ${url}\n`);
  
  const { status, data, headers } = await fetchPage(url);
  
  console.log(`Status: ${status}`);
  console.log(`Content-Length: ${data.length}`);
  
  // Save raw response
  fs.writeFileSync('hitsplay-raw.html', data);
  console.log('\nSaved raw response to hitsplay-raw.html');
  
  // Look for key patterns
  console.log('\n--- KEY PATTERNS ---');
  
  // JWT tokens
  const jwtMatches = data.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g);
  if (jwtMatches) {
    console.log(`\nJWT tokens found: ${jwtMatches.length}`);
    jwtMatches.forEach((jwt, i) => {
      console.log(`  JWT ${i + 1}: ${jwt.substring(0, 50)}...`);
      // Decode payload
      try {
        const payload = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
        console.log(`    Payload: ${JSON.stringify(payload)}`);
      } catch (e) {}
    });
  }
  
  // URLs
  const urlMatches = data.match(/https?:\/\/[^\s"'<>\\]+/g);
  if (urlMatches) {
    const uniqueUrls = [...new Set(urlMatches)];
    console.log(`\nURLs found: ${uniqueUrls.length}`);
    uniqueUrls.forEach(u => {
      if (u.includes('dvalna') || u.includes('m3u8') || u.includes('key') || u.includes('hls') || u.includes('stream')) {
        console.log(`  ${u.substring(0, 100)}`);
      }
    });
  }
  
  // Look for variable assignments
  console.log('\n--- VARIABLE ASSIGNMENTS ---');
  
  // Common patterns for config/auth data
  const patterns = [
    /(?:var|let|const)\s+(\w+)\s*=\s*["']([^"']+)["']/g,
    /(\w+)\s*:\s*["']([^"']+)["']/g,
    /window\[["'](\w+)["']\]\s*=\s*["']([^"']+)["']/g,
  ];
  
  const vars = new Map();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(data)) !== null) {
      const [, name, value] = match;
      if (value.length > 10 && value.length < 500 && !value.includes('function')) {
        vars.set(name, value);
      }
    }
  }
  
  console.log(`Variables found: ${vars.size}`);
  for (const [name, value] of vars) {
    if (name.toLowerCase().includes('key') || 
        name.toLowerCase().includes('token') || 
        name.toLowerCase().includes('auth') ||
        name.toLowerCase().includes('secret') ||
        name.toLowerCase().includes('url') ||
        name.toLowerCase().includes('server')) {
      console.log(`  ${name}: ${value.substring(0, 80)}${value.length > 80 ? '...' : ''}`);
    }
  }
  
  // Look for obfuscated strings
  console.log('\n--- OBFUSCATED STRINGS ---');
  
  // Base64 encoded strings
  const b64Matches = data.match(/[A-Za-z0-9+/]{40,}={0,2}/g);
  if (b64Matches) {
    console.log(`\nBase64 strings found: ${b64Matches.length}`);
    b64Matches.slice(0, 5).forEach((b64, i) => {
      try {
        const decoded = Buffer.from(b64, 'base64').toString('utf8');
        if (decoded.length > 10 && /^[\x20-\x7E]+$/.test(decoded)) {
          console.log(`  ${i + 1}: ${decoded.substring(0, 100)}`);
        }
      } catch (e) {}
    });
  }
  
  // Look for HLS.js or video player initialization
  console.log('\n--- PLAYER DETECTION ---');
  
  if (data.includes('Hls.js') || data.includes('hls.js')) {
    console.log('HLS.js detected');
  }
  if (data.includes('video.js') || data.includes('videojs')) {
    console.log('Video.js detected');
  }
  if (data.includes('jwplayer')) {
    console.log('JW Player detected');
  }
  if (data.includes('clappr')) {
    console.log('Clappr detected');
  }
  if (data.includes('plyr')) {
    console.log('Plyr detected');
  }
  
  // Look for m3u8 URL construction
  console.log('\n--- M3U8 URL PATTERNS ---');
  
  const m3u8Patterns = [
    /\.m3u8/g,
    /mono\.css/g,
    /dvalna\.ru/g,
    /kiko2\.ru/g,
    /giokko\.ru/g,
  ];
  
  for (const pattern of m3u8Patterns) {
    const matches = data.match(pattern);
    if (matches) {
      console.log(`  ${pattern}: ${matches.length} matches`);
    }
  }
  
  // Extract and analyze the main script
  console.log('\n--- SCRIPT ANALYSIS ---');
  
  const scriptMatches = data.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  if (scriptMatches) {
    console.log(`Scripts found: ${scriptMatches.length}`);
    
    scriptMatches.forEach((script, i) => {
      const content = script.replace(/<\/?script[^>]*>/gi, '');
      if (content.length > 100) {
        console.log(`\nScript ${i + 1} (${content.length} chars):`);
        
        // Check for common obfuscation patterns
        if (content.includes('eval(')) console.log('  - Uses eval()');
        if (content.includes('Function(')) console.log('  - Uses Function()');
        if (content.includes('atob(')) console.log('  - Uses atob()');
        if (content.includes('btoa(')) console.log('  - Uses btoa()');
        if (content.includes('fromCharCode')) console.log('  - Uses fromCharCode');
        if (content.includes('charCodeAt')) console.log('  - Uses charCodeAt');
        if (content.includes('split("").reverse()')) console.log('  - Uses string reversal');
        if (content.includes('_0x')) console.log('  - Obfuscator.io style');
        if (content.includes('window[')) console.log('  - Uses window[] access');
        
        // Look for the main obfuscated variable
        const mainVarMatch = content.match(/window\[['"]([^'"]+)['"]\]\s*=\s*['"]([^'"]+)['"]/);
        if (mainVarMatch) {
          console.log(`  - Main var: ${mainVarMatch[1]} = ${mainVarMatch[2].substring(0, 50)}...`);
        }
      }
    });
  }
  
  // Try to find the deobfuscation key
  console.log('\n--- DEOBFUSCATION ATTEMPT ---');
  
  // Look for the split/reduce pattern used in the obfuscation
  const splitReduceMatch = data.match(/['"]([^'"]{100,})['"]\.split\(['"]([^'"]+)['"]\)\.reduce/);
  if (splitReduceMatch) {
    const [, encoded, separator] = splitReduceMatch;
    console.log(`Found split/reduce pattern with separator: "${separator}"`);
    
    // Try to decode
    try {
      const parts = encoded.split(separator);
      console.log(`Parts count: ${parts.length}`);
      console.log(`First 10 parts: ${parts.slice(0, 10).join(', ')}`);
    } catch (e) {
      console.log(`Decode error: ${e.message}`);
    }
  }
}

analyzeHitsplay().catch(console.error);

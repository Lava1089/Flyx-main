#!/usr/bin/env node
/**
 * Extract and analyze the new DLHD auth script from player pages
 * Tests both www.ksohls.ru and the new adffdafdsafds.sbs domain
 */

const https = require('https');
const fs = require('fs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, ...(options.headers || {}) },
      timeout: options.timeout || 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
        return fetch(loc, options).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function extractAuthScript(domain, channel) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Extracting auth from ${domain} for ch${channel}`);
  console.log('='.repeat(70));
  
  const url = `https://${domain}/premiumtv/daddyhd.php?id=${channel}`;
  try {
    const res = await fetch(url, {
      headers: { 'Referer': 'https://dlstreams.top/' },
    });
    
    console.log(`Status: ${res.status}`);
    if (res.status !== 200) return null;
    
    const html = res.body;
    console.log(`Body: ${html.length} chars`);
    
    // Find the main auth/player script (the big one with CHANNEL_KEY)
    const scripts = [];
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = scriptRegex.exec(html)) !== null) {
      if (m[1].trim().length > 1000) {
        scripts.push(m[1].trim());
      }
    }
    
    // Find the script with CHANNEL_KEY or premium
    let mainScript = null;
    for (const s of scripts) {
      if (s.includes('CHANNEL_KEY') || (s.includes('premium') && s.includes('m3u8'))) {
        mainScript = s;
        break;
      }
    }
    
    if (!mainScript) {
      // Try the obfuscated one
      for (const s of scripts) {
        if (s.includes('hls') && s.includes('m3u8')) {
          mainScript = s;
          break;
        }
      }
    }
    
    if (!mainScript) {
      console.log('No main auth script found');
      // Show all large scripts
      for (let i = 0; i < scripts.length; i++) {
        console.log(`  Script ${i}: ${scripts[i].length} chars - ${scripts[i].substring(0, 100)}...`);
      }
      return null;
    }
    
    console.log(`\nMain script: ${mainScript.length} chars`);
    
    // Save full script for analysis
    const filename = `scripts/dlhd-auth-script-${domain.replace(/\./g, '-')}-ch${channel}.js`;
    fs.writeFileSync(filename, mainScript);
    console.log(`Saved to: ${filename}`);
    
    // Analyze the script
    console.log(`\n--- Key Patterns ---`);
    
    // CHANNEL_KEY
    const channelKeyMatch = mainScript.match(/CHANNEL_KEY\s*=\s*['"]([^'"]+)['"]/);
    if (channelKeyMatch) console.log(`  CHANNEL_KEY: ${channelKeyMatch[1]}`);
    
    // reCAPTCHA site key
    const recaptchaMatch = mainScript.match(/siteKey\s*[:=]\s*['"]([^'"]+)['"]/i) 
      || mainScript.match(/grecaptcha\.execute\s*\(\s*['"]([^'"]+)['"]/);
    if (recaptchaMatch) console.log(`  reCAPTCHA key: ${recaptchaMatch[1]}`);
    
    // Key URL patterns
    const keyUrlPatterns = mainScript.match(/key\/[^'")\s]+/g) || [];
    console.log(`  Key URL patterns: ${keyUrlPatterns.slice(0, 5).join(', ')}`);
    
    // Domain references
    const domainRefs = mainScript.match(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
    const uniqueDomains = [...new Set(domainRefs.map(d => { try { return new URL(d).hostname; } catch { return d; } }))];
    console.log(`  Domains: ${uniqueDomains.join(', ')}`);
    
    // Auth-related patterns
    const authPatterns = [
      { name: 'EPlayerAuth', regex: /EPlayerAuth/ },
      { name: 'authToken', regex: /authToken/ },
      { name: 'channelSalt', regex: /channelSalt/ },
      { name: 'Authorization', regex: /Authorization/ },
      { name: 'Bearer', regex: /Bearer/ },
      { name: 'X-Key-Timestamp', regex: /X-Key-Timestamp/ },
      { name: 'X-Key-Nonce', regex: /X-Key-Nonce/ },
      { name: 'X-Key-Path', regex: /X-Key-Path/ },
      { name: 'X-Fingerprint', regex: /X-Fingerprint/ },
      { name: 'PoW/nonce', regex: /nonce|pow/i },
      { name: 'HMAC', regex: /hmac/i },
      { name: 'MD5', regex: /md5/i },
      { name: 'SHA-256', regex: /sha.?256/i },
      { name: 'crypto.subtle', regex: /crypto\.subtle/ },
      { name: 'reCAPTCHA execute', regex: /grecaptcha\.execute/ },
      { name: 'reCAPTCHA ready', regex: /grecaptcha\.ready/ },
      { name: 'server_lookup', regex: /server_lookup/ },
      { name: 'mono.css', regex: /mono\.css/ },
      { name: 'Hls.js', regex: /Hls\s*\(/ },
      { name: 'Clappr', regex: /Clappr/ },
      { name: 'fetch key', regex: /fetch.*key/i },
      { name: 'whitelist', regex: /whitelist/i },
      { name: 'verify', regex: /verify/i },
    ];
    
    for (const p of authPatterns) {
      if (p.regex.test(mainScript)) {
        // Find context around the match
        const idx = mainScript.search(p.regex);
        const context = mainScript.substring(Math.max(0, idx - 30), Math.min(mainScript.length, idx + 80));
        console.log(`  ✅ ${p.name}: ...${context.replace(/\n/g, ' ')}...`);
      }
    }
    
    // Extract function names
    console.log(`\n--- Functions ---`);
    const funcNames = mainScript.match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g) || [];
    for (const f of funcNames.slice(0, 30)) {
      console.log(`  ${f.substring(0, 80)}`);
    }
    
    // Show the first 3000 chars of the script
    console.log(`\n--- Script Preview (first 3000 chars) ---`);
    console.log(mainScript.substring(0, 3000));
    
    return mainScript;
  } catch (e) {
    console.log(`Error: ${e.message}`);
    return null;
  }
}

async function main() {
  // Test the NEW player domain discovered from dlstreams.top
  await extractAuthScript('adffdafdsafds.sbs', '44');
  
  // Also test www.ksohls.ru for comparison
  await extractAuthScript('www.ksohls.ru', '44');
  
  // Test a second channel on the new domain
  await extractAuthScript('adffdafdsafds.sbs', '51');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});

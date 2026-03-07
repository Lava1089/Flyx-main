#!/usr/bin/env node
const https = require('https');

// Fetch the player page to see current auth mechanism
https.get('https://adffdafdsafds.sbs/premiumtv/daddyhd.php?id=44', {
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://dlstreams.top/',
  }
}, r => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => {
    console.log('Status:', r.statusCode);
    console.log('Length:', d.length);
    
    // Look for reCAPTCHA site key
    const siteKeyMatch = d.match(/sitekey['"]\s*[:=]\s*['"]([^'"]+)/i);
    if (siteKeyMatch) console.log('Site key:', siteKeyMatch[1]);
    
    // Look for verify endpoint URLs
    const verifyUrls = d.match(/https?:\/\/[^'"]+verify[^'"]*/gi);
    if (verifyUrls) console.log('Verify URLs:', [...new Set(verifyUrls)]);
    
    // Look for channel key
    const ckMatch = d.match(/CHANNEL_KEY\s*=\s*['"]([^'"]+)/);
    if (ckMatch) console.log('CHANNEL_KEY:', ckMatch[1]);
    
    // Look for key server domains
    const keyServerMatch = d.match(/go\.ai-chatx\.site|chevy\.soyspace|chevy\.vovlacosa/g);
    if (keyServerMatch) console.log('Key server refs:', [...new Set(keyServerMatch)]);
    
    // Print lines with auth-related content
    console.log('\n--- Auth-related lines ---');
    const lines = d.split('\n');
    for (const line of lines) {
      const l = line.trim();
      if (l.includes('recaptcha') || l.includes('verify') || l.includes('CHANNEL_KEY') || 
          l.includes('sitekey') || l.includes('whitelist') || l.includes('grecaptcha') ||
          l.includes('ai-chatx')) {
        console.log(l.substring(0, 250));
      }
    }
    
    // Also look for any script tags that load external JS
    console.log('\n--- Script tags ---');
    const scripts = d.match(/<script[^>]*src="([^"]+)"/gi);
    if (scripts) scripts.forEach(s => console.log(s.substring(0, 200)));
  });
}).on('error', e => console.log('Err:', e.message));

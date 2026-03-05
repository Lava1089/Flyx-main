/**
 * Fetch the external player script to understand the stream loading
 */

const fs = require('fs');

// Read the stream page
const html = fs.readFileSync('dlhd-extractor-worker/stream-51-page.html', 'utf8');

// The page loads a script from fidgetreclass.com
// This is likely the ad/player loader

// Let's look more carefully at the HTML structure
console.log('=== HTML Structure Analysis ===');

// Find all script tags
const scriptPattern = /<script[^>]*>[\s\S]*?<\/script>/gi;
const scripts = html.match(scriptPattern);
console.log('Total script tags:', scripts ? scripts.length : 0);

if (scripts) {
  scripts.forEach((s, i) => {
    const preview = s.substring(0, 200).replace(/\n/g, ' ');
    console.log(`\nScript ${i + 1}:`);
    console.log(preview);
  });
}

// Look for iframe elements
console.log('\n\n=== Iframe Analysis ===');
const iframePattern = /<iframe[^>]*>/gi;
const iframes = html.match(iframePattern);
if (iframes) {
  console.log('Iframes found:', iframes.length);
  iframes.forEach(f => console.log('  -', f));
}

// The actual player might be in a different part of the page
// Let's look at the body content
console.log('\n\n=== Body Content ===');
const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
if (bodyMatch) {
  const body = bodyMatch[1];
  console.log('Body length:', body.length);
  
  // Look for div elements
  const divPattern = /<div[^>]*>/gi;
  const divs = body.match(divPattern);
  console.log('Div elements:', divs ? divs.length : 0);
  if (divs) {
    divs.slice(0, 10).forEach(d => console.log('  -', d));
  }
}

// The stream might be embedded via a different mechanism
// Let's check if there's a canvas or video element
console.log('\n\n=== Media Elements ===');
const mediaPatterns = [
  /<video[^>]*>/gi,
  /<audio[^>]*>/gi,
  /<canvas[^>]*>/gi,
  /<object[^>]*>/gi,
  /<embed[^>]*>/gi,
];

for (const pattern of mediaPatterns) {
  const matches = html.match(pattern);
  if (matches) {
    console.log(`${pattern.source}:`, matches.length);
    matches.forEach(m => console.log('  -', m));
  }
}

// The obfuscated script might create the player dynamically
// Let's look for createElement calls
console.log('\n\n=== Dynamic Element Creation ===');
const createPattern = /createElement\s*\(\s*['"]([^'"]+)['"]\s*\)/gi;
let createMatch;
const elements = new Set();
while ((createMatch = createPattern.exec(html)) !== null) {
  elements.add(createMatch[1]);
}
console.log('Elements created dynamically:', [...elements].join(', '));

// The key might be in how the obfuscated code initializes the player
// Let's look for common player initialization patterns
console.log('\n\n=== Player Initialization Patterns ===');
const initPatterns = [
  /loadSource/gi,
  /attachMedia/gi,
  /play\s*\(\s*\)/gi,
  /autoplay/gi,
  /source\s*:/gi,
  /src\s*:/gi,
];

for (const pattern of initPatterns) {
  const matches = html.match(pattern);
  if (matches) {
    console.log(`${pattern.source}:`, matches.length, 'matches');
  }
}

// The stream URL might be constructed in the obfuscated code
// Let's look for URL-like patterns
console.log('\n\n=== URL Patterns in Code ===');
const urlPattern = /https?:\/\/[a-z0-9.-]+/gi;
const urls = new Set();
let urlMatch;
while ((urlMatch = urlPattern.exec(html)) !== null) {
  urls.add(urlMatch[0]);
}
console.log('Unique URLs found:');
[...urls].forEach(u => console.log('  -', u));

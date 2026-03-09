#!/usr/bin/env node
/**
 * Final decoder: extract string array + decoder + shuffle, run them,
 * then decode all strings from the obfuscated code.
 */
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('data/embed-44-raw.html', 'utf8');

// Extract functions
function extractFunction(code, startIdx) {
  let depth = 0, started = false;
  for (let i = startIdx; i < code.length; i++) {
    if (code[i] === '{') { depth++; started = true; }
    if (code[i] === '}') { depth--; if (started && depth === 0) return code.substring(startIdx, i + 1); }
  }
  return null;
}

const idx4360 = html.indexOf('function _0x4360()');
const idx4ef1 = html.indexOf('function _0x4ef1(');
const func4360 = extractFunction(html, idx4360);
const func4ef1 = extractFunction(html, idx4ef1);

// Extract shuffle IIFE
const shuffleStart = html.indexOf("';(function(", html.indexOf('ZpQw9XkLmN8c3vR3')) + 2;
const shuffleEnd = html.indexOf('}(_0x4360,0x55e2d)', shuffleStart) + '}(_0x4360,0x55e2d)'.length;
const shuffleCode = html.substring(shuffleStart, shuffleEnd);

console.log(`Array func: ${func4360.length}, Decoder: ${func4ef1.length}, Shuffle: ${shuffleCode.length}`);

// Execute setup
// The shuffle is an IIFE expression - it needs closing paren
let cleanShuffle = shuffleCode.trim();
if (cleanShuffle.endsWith(';')) cleanShuffle = cleanShuffle.slice(0, -1);
// Add closing paren if the IIFE starts with ( but doesn't end with )
if (cleanShuffle.startsWith('(function') && !cleanShuffle.endsWith('))')) {
  cleanShuffle += ')';
}
const fullSetup = func4360 + ';\n' + func4ef1 + ';\n' + cleanShuffle + ';\n';
const context = vm.createContext({
  parseInt, String, Array, Object, Number, Boolean, RegExp, Math, Date, JSON,
  encodeURIComponent, decodeURIComponent, escape, unescape, isNaN, isFinite,
  console: { log: () => {}, warn: () => {}, error: () => {} },
});

vm.runInContext(fullSetup, context, { timeout: 30000 });
const decoder = context._0x4ef1;
console.log(`Decoder ready: ${typeof decoder === 'function'}`);

// Find the main code (after the shuffle)
const mainCodeStart = shuffleEnd + 2; // skip ,!
const mainCode = html.substring(mainCodeStart);

// Find all decoder aliases
const aliasRe = /const (_0x[0-9a-f]+)=_0x4ef1/g;
const aliases = new Set();
let am;
while ((am = aliasRe.exec(mainCode)) !== null) aliases.add(am[1]);
console.log(`Found ${aliases.size} aliases: ${[...aliases].slice(0, 5).join(', ')}...`);

// Decode ALL calls with RC4 keys
const allDecoded = new Map();
for (const alias of aliases) {
  const escaped = alias.replace(/\$/g, '\\$');
  // Match: alias(0xHEX,'KEY')
  const callRe = new RegExp(escaped + "\\((0x[0-9a-f]+),'([^']*)'\\)", 'g');
  let cm;
  while ((cm = callRe.exec(mainCode)) !== null) {
    const idx = parseInt(cm[1]);
    const key = cm[2];
    const mapKey = `${idx}_${key}`;
    if (!allDecoded.has(mapKey)) {
      try {
        const decoded = decoder(idx, key);
        allDecoded.set(mapKey, { idx, key, decoded });
      } catch {}
    }
  }
}

console.log(`Decoded ${allDecoded.size} unique strings\n`);

// Categorize and display
const categories = {
  'DOMAINS & URLs': [],
  'PLAYER/IFRAME': [],
  'AUTH/CRYPTO': [],
  'BLOB RELATED': [],
  'KEY FUNCTIONS': [],
};

for (const [, { idx, key, decoded }] of allDecoded) {
  if (typeof decoded !== 'string') continue;
  const lower = decoded.toLowerCase();
  
  if (/\.(sbs|cfd|xyz|fun|site|cyou|ru|com|net|io|live|dad|top|pw|click|my|sx)/.test(decoded) ||
      decoded.startsWith('http') || decoded.startsWith('//')) {
    categories['DOMAINS & URLs'].push({ idx, decoded });
  }
  if (lower.includes('iframe') || lower.includes('player') || lower.includes('embed') ||
      lower.includes('video') || lower.includes('hls') || lower.includes('m3u8') ||
      lower.includes('src') || lower.includes('srcdoc') || lower === 'href') {
    categories['PLAYER/IFRAME'].push({ idx, decoded });
  }
  if (lower.includes('auth') || lower.includes('token') || lower.includes('salt') ||
      lower.includes('eplayer') || lower.includes('hmac') || lower.includes('nonce') ||
      lower.includes('fingerprint') || lower.includes('decrypt') || lower.includes('encrypt') ||
      lower.includes('crypto') || lower.includes('hash') || lower.includes('sign') ||
      lower.includes('digest') || lower.includes('subtle') || lower.includes('xor') ||
      lower.includes('aes') || lower.includes('key') || lower.includes('secret')) {
    categories['AUTH/CRYPTO'].push({ idx, decoded });
  }
  if (lower.includes('zpqw') || lower.includes('atob') || lower.includes('btoa') ||
      lower.includes('fromcharcode') || lower.includes('charcodeat') ||
      lower.includes('base64') || lower.includes('decode') || lower.includes('encode')) {
    categories['BLOB RELATED'].push({ idx, decoded });
  }
  if (lower.includes('premium') || lower.includes('daddyhd') || lower.includes('premiumtv') ||
      lower.includes('mono') || lower.includes('.php') || lower.includes('channel') ||
      lower.includes('server') || lower.includes('proxy') || lower.includes('init')) {
    categories['KEY FUNCTIONS'].push({ idx, decoded });
  }
}

for (const [cat, items] of Object.entries(categories)) {
  if (items.length === 0) continue;
  // Deduplicate
  const seen = new Set();
  const unique = items.filter(i => {
    if (seen.has(i.decoded)) return false;
    seen.add(i.decoded);
    return true;
  });
  unique.sort((a, b) => a.idx - b.idx);
  
  console.log(`=== ${cat} (${unique.length}) ===`);
  for (const { idx, decoded } of unique) {
    console.log(`  [0x${idx.toString(16)}] "${decoded}"`);
  }
  console.log();
}

// Write all decoded strings to file
let output = '';
const sorted = [...allDecoded.values()].sort((a, b) => a.idx - b.idx);
for (const { idx, key, decoded } of sorted) {
  output += `[0x${idx.toString(16)}] key="${key}" -> "${decoded}"\n`;
}
fs.writeFileSync('data/decoded-strings.txt', output);
console.log(`Wrote ${sorted.length} strings to data/decoded-strings.txt`);

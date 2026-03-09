#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('data/embed-44-raw.html', 'utf8');

// Find function boundaries manually
const idx4360 = html.indexOf('function _0x4360()');
const idx4ef1 = html.indexOf('function _0x4ef1(');

console.log(`_0x4360 at: ${idx4360}`);
console.log(`_0x4ef1 at: ${idx4ef1}`);

if (idx4360 < 0 || idx4ef1 < 0) {
  // The embed page might use different function names
  // Let's search for the pattern
  const funcNames = html.match(/function (_0x[0-9a-f]+)\(\)\{var _0x[0-9a-f]+=\['/);
  console.log('Array func match:', funcNames ? funcNames[1] : 'not found');
  
  const decoderNames = html.match(/function (_0x[0-9a-f]+)\(_0x[0-9a-f]+,_0x[0-9a-f]+\)\{var _0x[0-9a-f]+=_0x/);
  console.log('Decoder func match:', decoderNames ? decoderNames[1] : 'not found');
  
  // Also try: the functions might be in a different format
  // obfuscator.io sometimes uses: var _0x4360 = function() { ... }
  const varFunc = html.match(/var (_0x[0-9a-f]+)\s*=\s*function\s*\(\)\s*\{\s*var _0x[0-9a-f]+\s*=\s*\['/);
  console.log('Var func match:', varFunc ? varFunc[1] : 'not found');
}

// Extract function by counting braces
function extractFunction(code, startIdx) {
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < code.length; i++) {
    if (code[i] === '{') { depth++; started = true; }
    if (code[i] === '}') { depth--; if (started && depth === 0) return code.substring(startIdx, i + 1); }
  }
  return null;
}

if (idx4360 >= 0) {
  const func4360 = extractFunction(html, idx4360);
  console.log(`\n_0x4360 function: ${func4360 ? func4360.length : 0} chars`);
  if (func4360) console.log(`  Starts: ${func4360.substring(0, 100)}...`);
  
  if (idx4ef1 >= 0) {
    const func4ef1 = extractFunction(html, idx4ef1);
    console.log(`_0x4ef1 function: ${func4ef1 ? func4ef1.length : 0} chars`);
    if (func4ef1) console.log(`  Starts: ${func4ef1.substring(0, 100)}...`);
    
    // Find the shuffle IIFE
    // It's right after the blob assignment, starts with (function(
    const blobEnd = html.indexOf("';(function(", html.indexOf("ZpQw9XkLmN8c3vR3"));
    console.log(`\nBlob end + shuffle start at: ${blobEnd}`);
    
    if (blobEnd >= 0) {
      const shuffleStart = blobEnd + 2; // skip ';
      // Find the end: })(_0x4360, 0xNNNNN)
      const shuffleEndPattern = ')(_0x4360,';
      const shuffleEndIdx = html.indexOf(shuffleEndPattern, shuffleStart);
      if (shuffleEndIdx >= 0) {
        // Find the closing paren after the target number
        const afterTarget = html.indexOf(')', shuffleEndIdx + shuffleEndPattern.length);
        const shuffleCode = html.substring(shuffleStart, afterTarget + 1);
        console.log(`Shuffle IIFE: ${shuffleCode.length} chars`);
        console.log(`  Starts: ${shuffleCode.substring(0, 100)}...`);
        console.log(`  Ends: ...${shuffleCode.substring(shuffleCode.length - 50)}`);
        
        // Now combine and execute
        const fullSetup = func4360 + '\n' + func4ef1 + '\n' + shuffleCode + ';';
        console.log(`\nFull setup: ${fullSetup.length} chars`);
        
        const context = vm.createContext({
          parseInt, String, Array, Object, Number, Boolean, RegExp, Math, Date, JSON,
          encodeURIComponent, decodeURIComponent, escape, unescape, isNaN, isFinite,
          console: { log: () => {}, warn: () => {}, error: () => {} },
        });
        
        try {
          vm.runInContext(fullSetup, context, { timeout: 30000 });
          console.log('Setup executed successfully!');
          
          const decoder = context._0x4ef1;
          if (typeof decoder === 'function') {
            console.log('Decoder available!');
            
            // Test: decode 'ZpQw9XkLmN8c3vR3' - we know it's at index 0x69d
            // But we need the RC4 key. Let's find calls near 0x69d in the code.
            
            // First, let's find all decoder alias names and their calls with keys
            const mainCode = html.substring(afterTarget + 1);
            
            // Find aliases
            const aliasRe = /const (_0x[0-9a-f]+)=_0x4ef1/g;
            const aliases = new Set();
            let am;
            while ((am = aliasRe.exec(mainCode)) !== null) aliases.add(am[1]);
            console.log(`Aliases: ${[...aliases].join(', ')}`);
            
            // Find ALL calls with RC4 keys for each alias
            const allDecoded = new Map();
            let totalCalls = 0;
            
            for (const alias of aliases) {
              const escaped = alias.replace(/\$/g, '\\$');
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
                    totalCalls++;
                  } catch {}
                }
              }
            }
            
            console.log(`\nDecoded ${totalCalls} calls`);
            
            // Filter interesting
            const interesting = [];
            for (const [, { idx, key, decoded }] of allDecoded) {
              if (typeof decoded !== 'string') continue;
              const lower = decoded.toLowerCase();
              if (/\.(sbs|cfd|xyz|fun|site|cyou|ru|com|net|io|live|dad|top|pw|click|my|sx)/.test(decoded) ||
                  decoded.startsWith('http') || decoded.startsWith('//') ||
                  lower.includes('zpqw') || lower.includes('premium') || lower.includes('daddyhd') ||
                  lower.includes('iframe') || lower.includes('player') || lower.includes('.php') ||
                  lower.includes('auth') || lower.includes('token') || lower.includes('salt') ||
                  lower.includes('eplayer') || lower.includes('hls') || lower.includes('m3u8') ||
                  lower.includes('src') || lower.includes('href') || lower.includes('atob') ||
                  lower.includes('fromcharcode') || lower.includes('charcodeat') ||
                  lower.includes('xor') || lower.includes('decrypt') || lower.includes('encrypt') ||
                  lower.includes('key') || lower.includes('secret') || lower.includes('hash') ||
                  lower.includes('base64') || lower.includes('decode') || lower.includes('encode') ||
                  lower.includes('init') || lower.includes('mono') || lower.includes('proxy') ||
                  lower.includes('server') || lower.includes('channel') || lower.includes('embed')) {
                interesting.push({ idx, key, decoded });
              }
            }
            
            interesting.sort((a, b) => a.idx - b.idx);
            console.log(`\n=== ${interesting.length} INTERESTING STRINGS ===`);
            for (const { idx, key, decoded } of interesting) {
              console.log(`  [0x${idx.toString(16)}] "${decoded}"`);
            }
          }
        } catch (e) {
          console.log(`Error: ${e.message}`);
        }
      }
    }
  }
}

/**
 * MegaCloud player JS deep analysis
 * Check the actual content of the obfuscated JS
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

async function main() {
  const domain = 'megacloud.blog';
  const embedUrl = `https://${domain}/embed-2/v3/e-1/zqAeB6Od5pJp?k=1`;
  
  // Key finding from embed HTML:
  // <div data-dpi="XcJLZgpbC6VdA4YU7wKGLRuE9mMJ1wXYv3P0vF9SKA9a0RV4" style="display:none"></div>
  // <div id="megacloud-player" data-id="zqAeB6Od5pJp" data-realid="114721" data-mediaid="1080109" data-fileversion="1">
  
  console.log('=== KEY FINDINGS FROM EMBED PAGE ===');
  console.log('data-dpi: XcJLZgpbC6VdA4YU7wKGLRuE9mMJ1wXYv3P0vF9SKA9a0RV4');
  console.log('data-id: zqAeB6Od5pJp');
  console.log('data-realid: 114721 (this is the HiAnime episode ID!)');
  console.log('data-mediaid: 1080109 (this is the HiAnime server ID!)');
  console.log('data-fileversion: 1');
  console.log('');
  
  // The data-dpi value might be a token/key used for the API call
  // Let's try using it in the getSources request
  
  const embedId = 'zqAeB6Od5pJp';
  const dpi = 'XcJLZgpbC6VdA4YU7wKGLRuE9mMJ1wXYv3P0vF9SKA9a0RV4';
  
  console.log('--- Trying getSources with data-dpi token ---');
  
  const endpoints = [
    // With dpi as parameter
    `/embed-2/ajax/e-1/getSources?id=${embedId}&dpi=${dpi}`,
    `/embed-2/ajax/e-1/getSources?id=${embedId}&token=${dpi}`,
    `/embed-2/ajax/e-1/getSources?id=${embedId}&t=${dpi}`,
    `/embed-2/ajax/e-1/getSources?id=${embedId}&_=${dpi}`,
    `/embed-2/ajax/e-1/getSources?id=${embedId}&h=${dpi}`,
    
    // v3 with dpi
    `/embed-2/v3/ajax/e-1/getSources?id=${embedId}&dpi=${dpi}`,
    `/embed-2/v3/ajax/e-1/getSources?id=${embedId}&t=${dpi}`,
    
    // Different endpoint names
    `/embed-2/ajax/e-1/getSource?id=${embedId}`,
    `/embed-2/ajax/e-1/source?id=${embedId}`,
    `/embed-2/ajax/e-1/video?id=${embedId}`,
    `/embed-2/ajax/e-1/stream?id=${embedId}`,
    `/embed-2/ajax/e-1/media?id=${embedId}`,
    `/embed-2/ajax/e-1/play?id=${embedId}`,
    
    // POST-style as GET
    `/embed-2/ajax/e-1/getSources?id=${embedId}&v=3&b=1`,
  ];
  
  for (const ep of endpoints) {
    try {
      const url = `https://${domain}${ep}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': embedUrl,
        },
        signal: AbortSignal.timeout(8000),
      });
      const text = await res.text();
      const indicator = res.status === 200 ? '✅' : res.status === 404 ? '❌' : `⚠️(${res.status})`;
      
      if (res.status === 200 && text.length > 10 && text.length < 7000) {
        console.log(`${indicator} ${ep}: size=${text.length}`);
        try {
          const json = JSON.parse(text);
          console.log(`   Keys: ${Object.keys(json).join(', ')}`);
          if (json.sources) console.log(`   SOURCES! type=${typeof json.sources}`);
        } catch {
          console.log(`   Text: ${text.substring(0, 200)}`);
        }
      } else {
        console.log(`${indicator} ${ep}: size=${text.length}`);
      }
    } catch (e) {
      console.log(`❌ ${ep}: ${e.message}`);
    }
  }
  
  // Now let's look at the actual JS content
  console.log('\n--- Player JS Content Analysis ---');
  const jsUrl = `https://${domain}/js/player/a/v3/pro/embed-1.min.js?v=1770662765`;
  const jsRes = await fetch(jsUrl, {
    headers: { 'User-Agent': UA, 'Referer': embedUrl },
    signal: AbortSignal.timeout(15000),
  });
  const jsText = await jsRes.text();
  
  // Show first 500 chars to understand the obfuscation type
  console.log(`JS size: ${jsText.length}`);
  console.log(`First 500 chars:\n${jsText.substring(0, 500)}\n`);
  
  // Check if it's a string array obfuscation
  const hasStringArray = jsText.includes('0x') || jsText.includes('\\x');
  console.log(`Has hex strings: ${hasStringArray}`);
  
  // Check for common obfuscation patterns
  const hasSwitch = (jsText.match(/switch/g) || []).length;
  const hasWhile = (jsText.match(/while/g) || []).length;
  const hasVar = (jsText.match(/var /g) || []).length;
  const hasConst = (jsText.match(/const /g) || []).length;
  const hasLet = (jsText.match(/let /g) || []).length;
  const hasFunction = (jsText.match(/function/g) || []).length;
  console.log(`switch: ${hasSwitch}, while: ${hasWhile}, var: ${hasVar}, const: ${hasConst}, let: ${hasLet}, function: ${hasFunction}`);
  
  // Look for hex-encoded strings (common in obfuscated JS)
  const hexStrings = jsText.match(/0x[0-9a-f]+/gi) || [];
  console.log(`Hex numbers: ${hexStrings.length}`);
  if (hexStrings.length > 0) {
    console.log(`First 10: ${hexStrings.slice(0, 10).join(', ')}`);
  }
  
  // Look for string array function calls like _0x1234('0x5')
  const arrayCallPattern = jsText.match(/_0x[a-f0-9]+\s*\(\s*['"]?0x[a-f0-9]+['"]?\s*\)/g) || [];
  console.log(`String array calls: ${arrayCallPattern.length}`);
  
  // Look for base64 strings
  const b64Strings = jsText.match(/['"][A-Za-z0-9+/=]{20,}['"]/g) || [];
  console.log(`Base64-like strings: ${b64Strings.length}`);
  if (b64Strings.length > 0) {
    b64Strings.slice(0, 5).forEach(s => console.log(`  ${s.substring(0, 80)}`));
  }
  
  // Look for URL-like patterns in the raw bytes
  const urlPatterns = jsText.match(/https?:\/\/[^\s"'`]+/g) || [];
  console.log(`\nURL patterns: ${urlPatterns.length}`);
  urlPatterns.forEach(u => console.log(`  ${u.substring(0, 100)}`));
  
  console.log('\n=== ANALYSIS COMPLETE ===');
}

main().catch(console.error);

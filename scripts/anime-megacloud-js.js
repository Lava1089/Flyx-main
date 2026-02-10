/**
 * MegaCloud player JS analysis
 * The embed page loads: /js/player/a/v3/pro/embed-1.min.js
 * This is the obfuscated player that loads sources
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

async function main() {
  const domain = 'megacloud.blog';
  const embedUrl = `https://${domain}/embed-2/v3/e-1/zqAeB6Od5pJp?k=1`;
  
  console.log('=== MEGACLOUD PLAYER JS ANALYSIS ===\n');
  
  // Fetch the embed page first to get exact JS URL
  const embedRes = await fetch(embedUrl, {
    headers: { 'User-Agent': UA, 'Referer': 'https://hianime.to/' },
    signal: AbortSignal.timeout(15000),
  });
  const embedHtml = await embedRes.text();
  console.log(`Embed page size: ${embedHtml.length}`);
  console.log(`Embed HTML:\n${embedHtml}\n`);
  
  // Fetch the player JS
  const jsUrl = `https://${domain}/js/player/a/v3/pro/embed-1.min.js?v=1770662715`;
  console.log(`\nFetching player JS: ${jsUrl}`);
  
  const jsRes = await fetch(jsUrl, {
    headers: { 'User-Agent': UA, 'Referer': embedUrl },
    signal: AbortSignal.timeout(15000),
  });
  const jsText = await jsRes.text();
  console.log(`Player JS size: ${jsText.length}\n`);
  
  // Look for URL construction patterns
  console.log('--- URL/API Patterns ---');
  
  // Find string literals that look like paths
  const stringLiterals = jsText.match(/["'][a-zA-Z0-9/._-]{5,}["']/g) || [];
  const pathLiterals = stringLiterals.filter(s => s.includes('/') || s.includes('ajax') || s.includes('source') || s.includes('embed'));
  console.log(`Path-like strings: ${pathLiterals.length}`);
  pathLiterals.forEach(s => console.log(`  ${s}`));
  
  // Find fetch/XMLHttpRequest patterns
  const fetchPatterns = jsText.match(/fetch\s*\([^)]{0,200}\)/g) || [];
  console.log(`\nfetch() calls: ${fetchPatterns.length}`);
  fetchPatterns.forEach(f => console.log(`  ${f.substring(0, 150)}`));
  
  // Find XMLHttpRequest patterns
  const xhrPatterns = jsText.match(/XMLHttpRequest|\.open\s*\([^)]+\)/g) || [];
  console.log(`\nXHR patterns: ${xhrPatterns.length}`);
  xhrPatterns.slice(0, 10).forEach(x => console.log(`  ${x.substring(0, 100)}`));
  
  // Find $.ajax or $.get patterns
  const jqueryAjax = jsText.match(/\$\.(ajax|get|post|getJSON)\s*\([^)]{0,200}\)/g) || [];
  console.log(`\njQuery AJAX: ${jqueryAjax.length}`);
  jqueryAjax.forEach(j => console.log(`  ${j.substring(0, 150)}`));
  
  // Find any URL concatenation patterns
  const concatPatterns = jsText.match(/["'][^"']*["']\s*\+\s*[a-zA-Z_$]+/g) || [];
  const urlConcats = concatPatterns.filter(c => c.includes('/') || c.includes('http') || c.includes('ajax'));
  console.log(`\nURL concatenations: ${urlConcats.length}`);
  urlConcats.forEach(c => console.log(`  ${c.substring(0, 100)}`));
  
  // Look for crypto/encryption patterns
  console.log('\n--- Crypto Patterns ---');
  const cryptoPatterns = jsText.match(/(?:CryptoJS|crypto|AES|aes|encrypt|decrypt|cipher|decipher|atob|btoa|base64)[a-zA-Z.()[\]]{0,50}/gi) || [];
  const uniqueCrypto = [...new Set(cryptoPatterns)];
  console.log(`Crypto patterns: ${uniqueCrypto.length}`);
  uniqueCrypto.forEach(c => console.log(`  ${c}`));
  
  // Look for the specific embed ID usage
  console.log('\n--- Embed ID Usage ---');
  // The embed page likely passes the ID to the JS somehow
  // Check for window variables or data attributes
  const windowPatterns = jsText.match(/window\.[a-zA-Z_$]+/g) || [];
  const uniqueWindow = [...new Set(windowPatterns)];
  console.log(`window.* references: ${uniqueWindow.length}`);
  uniqueWindow.slice(0, 20).forEach(w => console.log(`  ${w}`));
  
  // Look for "sources" keyword context
  console.log('\n--- "sources" Context ---');
  const sourcesIdx = [];
  let idx = 0;
  while ((idx = jsText.indexOf('sources', idx)) !== -1) {
    sourcesIdx.push(idx);
    idx++;
  }
  console.log(`"sources" appears ${sourcesIdx.length} times`);
  // Show context around first 10 occurrences
  sourcesIdx.slice(0, 10).forEach(i => {
    const context = jsText.substring(Math.max(0, i - 40), Math.min(jsText.length, i + 60));
    console.log(`  ...${context.replace(/\n/g, ' ')}...`);
  });
  
  // Look for "getSources" specifically
  console.log('\n--- "getSources" Context ---');
  const getSourcesIdx = [];
  idx = 0;
  while ((idx = jsText.indexOf('getSources', idx)) !== -1) {
    getSourcesIdx.push(idx);
    idx++;
  }
  console.log(`"getSources" appears ${getSourcesIdx.length} times`);
  getSourcesIdx.forEach(i => {
    const context = jsText.substring(Math.max(0, i - 60), Math.min(jsText.length, i + 80));
    console.log(`  ...${context.replace(/\n/g, ' ')}...`);
  });
  
  console.log('\n=== ANALYSIS COMPLETE ===');
}

main().catch(console.error);

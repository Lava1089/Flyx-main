#!/usr/bin/env node
/**
 * Inspect raw M3U8 content from upstream to check for URL splitting tricks
 */

const http = require('http');
const https = require('https');

const API_URL = 'http://127.0.0.1:8787';
const API_KEY = 'test';

function fetchLocal(url, headers = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = http.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'X-API-Key': API_KEY, ...headers },
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

function fetchRemote(url, headers = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        ...headers,
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

async function main() {
  console.log('═'.repeat(80));
  console.log('INSPECT RAW M3U8 - CHECKING FOR URL SPLITTING TRICKS');
  console.log('═'.repeat(80));
  
  // Step 1: Get stream info
  console.log('\n1. Getting stream info for channel 31...');
  const streamRes = await fetchLocal(`${API_URL}/stream/31`);
  
  if (streamRes.error || streamRes.status !== 200) {
    console.log(`   ❌ Failed: ${streamRes.error || streamRes.status}`);
    return;
  }
  
  const streamData = JSON.parse(streamRes.data);
  console.log(`   ✅ Got stream data`);
  
  // Extract the original M3U8 URL from the proxy URL
  const proxyUrl = new URL(streamData.streamUrl);
  const encodedUrl = proxyUrl.searchParams.get('url');
  
  if (!encodedUrl) {
    console.log('   ❌ No encoded URL found in proxy URL');
    console.log(`   Proxy URL: ${streamData.streamUrl}`);
    console.log(`   Params: ${proxyUrl.searchParams.toString()}`);
    return;
  }
  
  // Decode URL-safe base64
  let base64 = encodedUrl.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4;
  if (padding) base64 += '='.repeat(4 - padding);
  const originalM3u8Url = Buffer.from(base64, 'base64').toString('utf-8');
  console.log(`   Original M3U8 URL: ${originalM3u8Url}`);
  
  // Step 2: Fetch the PROXIED M3U8 (through our worker)
  console.log('\n2. Fetching PROXIED M3U8 (through worker)...');
  const proxiedRes = await fetchLocal(streamData.streamUrl + '&key=' + API_KEY);
  
  if (proxiedRes.error || proxiedRes.status !== 200) {
    console.log(`   ❌ Failed: ${proxiedRes.error || proxiedRes.status}`);
  } else {
    console.log(`   ✅ Got proxied M3U8 (${proxiedRes.data.length} bytes)`);
    
    console.log('\n   PROXIED M3U8 RAW CONTENT (first 50 lines):');
    console.log('   ' + '─'.repeat(76));
    const lines = proxiedRes.data.split('\n');
    lines.slice(0, 50).forEach((line, i) => {
      // Show raw bytes for non-printable chars
      const displayLine = line.replace(/[\x00-\x1f]/g, (c) => `[0x${c.charCodeAt(0).toString(16).padStart(2, '0')}]`);
      console.log(`   ${String(i+1).padStart(3)}: |${displayLine}|`);
    });
    
    // Check for KEY tag issues
    console.log('\n   CHECKING KEY TAGS:');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('#EXT-X-KEY')) {
        console.log(`   Line ${i+1}: ${line.length} chars`);
        console.log(`   Starts with: ${line.substring(0, 100)}`);
        console.log(`   Ends with: ...${line.substring(line.length - 100)}`);
        
        // Check if URI is properly quoted
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch) {
          console.log(`   ✅ URI properly quoted, length: ${uriMatch[1].length}`);
        } else {
          console.log(`   ⚠️  URI NOT properly quoted!`);
          // Check for partial URI
          const partialUri = line.match(/URI="([^"]*)/);
          if (partialUri) {
            console.log(`   Partial URI found: ${partialUri[1].substring(0, 50)}...`);
          }
        }
      }
    }
    
    console.log('\n   CHECKING FOR TRUNCATED/SPLIT URLs:');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Check if line looks like a partial base64 string (continuation of URL)
      if (line && !line.startsWith('#') && !line.startsWith('http') && /^[A-Za-z0-9_-]+$/.test(line)) {
        console.log(`   ⚠️  Line ${i+1} looks like a URL continuation: "${line.substring(0, 60)}..."`);
        if (i > 0) {
          console.log(`       Previous line: "${lines[i-1].substring(0, 60)}..."`);
        }
      }
    }
    
    // Check for suspicious patterns
    console.log('\n   ANALYSIS:');
    console.log('   ' + '─'.repeat(76));
    
    // Check for continuation lines (lines that don't start with # and aren't URLs)
    let suspiciousLines = [];
    let prevLine = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // Check for lines that look like partial URLs
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('http') && !trimmed.startsWith('/')) {
        suspiciousLines.push({ index: i, line: trimmed, prevLine });
      }
      
      // Check for lines with unusual characters
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(line)) {
        console.log(`   ⚠️  Line ${i+1} has unusual control characters`);
      }
      
      prevLine = trimmed;
    }
    
    if (suspiciousLines.length > 0) {
      console.log(`\n   ⚠️  SUSPICIOUS LINES (possible URL splitting):`);
      suspiciousLines.slice(0, 10).forEach(s => {
        console.log(`      Line ${s.index + 1}: "${s.line}"`);
        console.log(`      Previous: "${s.prevLine}"`);
      });
    }
    
    // Count different line types
    let tagLines = 0, urlLines = 0, emptyLines = 0, otherLines = 0;
    for (const line of lines) {
      const t = line.trim();
      if (!t) emptyLines++;
      else if (t.startsWith('#')) tagLines++;
      else if (t.startsWith('http') || t.startsWith('/') || t.includes('.ts') || t.includes('.m3u8')) urlLines++;
      else otherLines++;
    }
    
    console.log(`\n   Line type breakdown:`);
    console.log(`      Tags (#...): ${tagLines}`);
    console.log(`      URLs: ${urlLines}`);
    console.log(`      Empty: ${emptyLines}`);
    console.log(`      Other/Unknown: ${otherLines}`);
    
    if (otherLines > 0) {
      console.log(`\n   ⚠️  ${otherLines} lines don't look like tags or URLs!`);
    }
  }
  
  // Step 3: Check line endings
  console.log('\n3. Checking line endings...');
  if (proxiedRes.data) {
    const hasCRLF = proxiedRes.data.includes('\r\n');
    const hasLF = proxiedRes.data.includes('\n');
    const hasCR = proxiedRes.data.includes('\r') && !hasCRLF;
    
    console.log(`   CRLF (\\r\\n): ${hasCRLF}`);
    console.log(`   LF (\\n): ${hasLF}`);
    console.log(`   CR only (\\r): ${hasCR}`);
    
    if (hasCRLF || hasCR) {
      console.log('   ⚠️  Non-standard line endings detected!');
    }
  }
}

main().catch(console.error);

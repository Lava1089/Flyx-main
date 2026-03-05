#!/usr/bin/env node
/**
 * Test the RPI /dlhdfast endpoint
 * 
 * Usage: node test-dlhdfast.js [channelId] [rpiUrl]
 * 
 * Examples:
 *   node test-dlhdfast.js 51
 *   node test-dlhdfast.js 51 http://localhost:3001
 *   node test-dlhdfast.js 51 https://your-rpi-tunnel.trycloudflare.com
 */

const channelId = process.argv[2] || '51';
const rpiUrl = process.argv[3] || 'http://localhost:3001';

async function testDLHDFast() {
  console.log(`\n🧪 Testing /dlhdfast/${channelId} on ${rpiUrl}\n`);
  
  const url = `${rpiUrl}/dlhdfast/${channelId}`;
  console.log(`📡 Fetching: ${url}`);
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(url);
    const elapsed = Date.now() - startTime;
    
    console.log(`\n📊 Response:`);
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Duration: ${elapsed}ms`);
    console.log(`   Content-Type: ${response.headers.get('content-type')}`);
    console.log(`   X-DLHD-Channel: ${response.headers.get('x-dlhd-channel')}`);
    console.log(`   X-DLHD-Server: ${response.headers.get('x-dlhd-server')}`);
    console.log(`   X-DLHD-Duration-Ms: ${response.headers.get('x-dlhd-duration-ms')}`);
    
    const body = await response.text();
    
    if (response.status === 200) {
      console.log(`\n✅ SUCCESS! Got M3U8 playlist (${body.length} bytes)`);
      console.log(`\n📝 First 500 chars of M3U8:`);
      console.log(body.substring(0, 500));
      
      // Count segments
      const segmentCount = (body.match(/\.ts/g) || []).length;
      const keyCount = (body.match(/EXT-X-KEY/g) || []).length;
      console.log(`\n📊 M3U8 Stats:`);
      console.log(`   Segments: ${segmentCount}`);
      console.log(`   Key tags: ${keyCount}`);
      
      // Check if URLs are rewritten
      if (body.includes('/dlhdprivate?')) {
        console.log(`   ✅ URLs rewritten through /dlhdprivate proxy`);
      } else {
        console.log(`   ⚠️ URLs NOT rewritten (direct dvalna.ru URLs)`);
      }
    } else {
      console.log(`\n❌ FAILED!`);
      console.log(`   Response: ${body.substring(0, 500)}`);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
  }
}

testDLHDFast();

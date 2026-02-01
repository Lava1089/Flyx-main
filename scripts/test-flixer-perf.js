/**
 * Test Flixer streaming performance
 */
require('dotenv').config({ path: '.env.local' });

const CF_PROXY = process.env.NEXT_PUBLIC_CF_STREAM_PROXY_URL?.replace(/\/stream\/?$/, '');

async function testStreamingPerformance() {
  console.log('='.repeat(60));
  console.log('FLIXER STREAMING PERFORMANCE TEST');
  console.log('='.repeat(60));
  
  // Get a fresh stream URL with retries
  let streamUrl = null;
  const servers = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
  
  for (const server of servers) {
    const extractUrl = `${CF_PROXY}/flixer/extract?tmdbId=550&type=movie&server=${server}`;
    const res = await fetch(extractUrl, { signal: AbortSignal.timeout(20000) });
    const data = await res.json();
    
    if (data.success && data.sources?.[0]?.url) {
      streamUrl = data.sources[0].url;
      console.log('Using server:', server);
      break;
    }
  }
  
  if (!streamUrl) {
    console.log('Failed to get stream URL');
    return;
  }
  
  console.log('Stream URL:', streamUrl.substring(0, 80) + '...');
  
  // Fetch master playlist through proxy
  console.log('\nFetching master playlist...');
  const proxyUrl = `${CF_PROXY}/animekai?url=${encodeURIComponent(streamUrl)}`;
  const masterRes = await fetch(proxyUrl);
  const masterText = await masterRes.text();
  
  // Parse quality levels - handle format where URL is on next line
  const lines = masterText.split('\n');
  const qualities = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('#EXT-X-STREAM-INF')) {
      const match = lines[i].match(/RESOLUTION=(\d+x\d+)/);
      const bandwidth = lines[i].match(/BANDWIDTH=(\d+)/);
      // URL is on the next line
      if (match && i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
        qualities.push({
          resolution: match[1],
          bandwidth: bandwidth ? parseInt(bandwidth[1]) : 0,
          url: lines[i + 1].trim()
        });
      }
    }
  }
  
  if (qualities.length === 0) {
    console.log('No qualities found in playlist');
    console.log('Playlist:', masterText.substring(0, 500));
    return;
  }
  
  console.log('Available qualities:');
  qualities.forEach(q => {
    console.log('  -', q.resolution, '(' + Math.round(q.bandwidth / 1000) + ' kbps)');
  });
  
  // Test highest quality (first one is usually highest in HLS)
  const highestQuality = qualities[0];
  console.log('\nTesting highest quality (' + highestQuality.resolution + ')...');
  
  const variantRes = await fetch(highestQuality.url);
  const variantText = await variantRes.text();
  
  // Get segment info
  const segmentLines = variantText.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const targetDuration = variantText.match(/#EXT-X-TARGETDURATION:(\d+)/)?.[1] || '4';
  
  console.log('Total segments:', segmentLines.length);
  console.log('Target duration:', targetDuration, 'seconds');
  console.log('Estimated video length:', Math.round(segmentLines.length * parseInt(targetDuration) / 60), 'minutes');
  
  // Test segment download speeds
  console.log('\nTesting segment download speeds (10 random segments)...');
  
  const testIndices = [];
  for (let i = 0; i < 10; i++) {
    testIndices.push(Math.floor(Math.random() * segmentLines.length));
  }
  testIndices.sort((a, b) => a - b);
  
  const speeds = [];
  for (const i of testIndices) {
    const segUrl = segmentLines[i];
    const start = Date.now();
    const segRes = await fetch(segUrl);
    const segData = await segRes.arrayBuffer();
    const time = Date.now() - start;
    const speed = segData.byteLength / (time / 1000) / 1024;
    speeds.push(speed);
    console.log('  Segment', i.toString().padStart(4), ':', 
      (segData.byteLength / 1024).toFixed(1).padStart(6), 'KB in', 
      time.toString().padStart(4), 'ms =', 
      speed.toFixed(0).padStart(5), 'KB/s');
  }
  
  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);
  
  console.log('\nSpeed Summary:');
  console.log('  Average:', avgSpeed.toFixed(0), 'KB/s');
  console.log('  Min:', minSpeed.toFixed(0), 'KB/s');
  console.log('  Max:', maxSpeed.toFixed(0), 'KB/s');
  
  // Calculate if buffering is likely
  const requiredSpeed = highestQuality.bandwidth / 8 / 1024; // Convert bps to KB/s
  console.log('\nBuffering Analysis:');
  console.log('  Required speed for ' + highestQuality.resolution + ':', requiredSpeed.toFixed(0), 'KB/s');
  console.log('  Average speed:', avgSpeed.toFixed(0), 'KB/s');
  console.log('  Speed margin:', ((avgSpeed / requiredSpeed - 1) * 100).toFixed(0) + '%');
  
  if (avgSpeed < requiredSpeed) {
    console.log('  ⚠️  WARNING: Average speed is BELOW required - buffering likely!');
  } else if (avgSpeed < requiredSpeed * 1.5) {
    console.log('  ⚠️  WARNING: Speed margin is low - buffering possible');
  } else {
    console.log('  ✓ Speed is sufficient for smooth playback');
  }
  
  if (minSpeed < requiredSpeed) {
    console.log('  ⚠️  WARNING: Minimum speed dropped below required - occasional buffering expected');
  }
  
  console.log('\n' + '='.repeat(60));
}

testStreamingPerformance().catch(console.error);

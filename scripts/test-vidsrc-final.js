/**
 * Test VidSrc Extractor - Final Verification
 * Tests the new 2embed.stream API integration.
 */

require('dotenv').config({ path: '.env.local' });

async function fetchWithHeaders(url, referer) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  if (referer) headers['Referer'] = referer;
  return fetch(url, { headers, redirect: 'follow' });
}

async function testMovie(tmdbId, name) {
  console.log(`\n--- Testing ${name} (${tmdbId}) ---`);
  
  const apiUrl = `https://v1.2embed.stream/api/m3u8/movie/${tmdbId}`;
  
  try {
    const resp = await fetchWithHeaders(apiUrl, 'https://v1.2embed.stream/');
    if (!resp.ok) { console.log(`❌ API returned ${resp.status}`); return false; }
    
    const data = await resp.json();
    if (!data.success || !data.m3u8_url) { console.log(`❌ No m3u8_url`); return false; }
    
    console.log(`✓ Got m3u8 URL (source: ${data.source})`);
    
    const m3u8Resp = await fetchWithHeaders(data.m3u8_url, 'https://v1.2embed.stream/');
    if (!m3u8Resp.ok) { console.log(`❌ M3U8 returned ${m3u8Resp.status}`); return false; }
    
    const m3u8Content = await m3u8Resp.text();
    if (!m3u8Content.includes('#EXTM3U')) { console.log(`❌ Invalid M3U8`); return false; }
    
    const variants = (m3u8Content.match(/#EXT-X-STREAM-INF/g) || []).length;
    console.log(`✓ Valid M3U8 with ${variants} quality variants`);
    return true;
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
    return false;
  }
}

async function testTvShow(tmdbId, name, season, episode) {
  console.log(`\n--- Testing ${name} S${season}E${episode} (${tmdbId}) ---`);
  
  const apiUrl = `https://v1.2embed.stream/api/m3u8/tv/${tmdbId}/${season}/${episode}`;
  
  try {
    const resp = await fetchWithHeaders(apiUrl, 'https://v1.2embed.stream/');
    if (!resp.ok) { console.log(`❌ API returned ${resp.status}`); return false; }
    
    const data = await resp.json();
    if (!data.success || !data.m3u8_url) { 
      console.log(`❌ No m3u8_url (${data.error || 'unknown'})`); 
      return false; 
    }
    
    console.log(`✓ Got m3u8 URL (source: ${data.source})`);
    
    const m3u8Resp = await fetchWithHeaders(data.m3u8_url, 'https://v1.2embed.stream/');
    if (!m3u8Resp.ok) { console.log(`❌ M3U8 returned ${m3u8Resp.status}`); return false; }
    
    const m3u8Content = await m3u8Resp.text();
    if (!m3u8Content.includes('#EXTM3U')) { console.log(`❌ Invalid M3U8`); return false; }
    
    const variants = (m3u8Content.match(/#EXT-X-STREAM-INF/g) || []).length;
    console.log(`✓ Valid M3U8 with ${variants} quality variants`);
    return true;
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('VidSrc Extractor - Final Verification');
  console.log('=====================================');
  
  const movies = [
    { id: '550', name: 'Fight Club' },
    { id: '157336', name: 'Interstellar' },
    { id: '27205', name: 'Inception' },
  ];
  
  const tvShows = [
    { id: '1396', name: 'Breaking Bad', season: 1, episode: 1 },
    { id: '1399', name: 'Game of Thrones', season: 1, episode: 1 },
  ];
  
  let movieSuccess = 0, tvSuccess = 0;
  
  console.log('\n=== MOVIES ===');
  for (const movie of movies) {
    if (await testMovie(movie.id, movie.name)) movieSuccess++;
    await new Promise(r => setTimeout(r, 300));
  }
  
  console.log('\n=== TV SHOWS ===');
  for (const show of tvShows) {
    if (await testTvShow(show.id, show.name, show.season, show.episode)) tvSuccess++;
    await new Promise(r => setTimeout(r, 300));
  }
  
  console.log('\n=== SUMMARY ===');
  console.log(`Movies: ${movieSuccess}/${movies.length} | TV: ${tvSuccess}/${tvShows.length}`);
  
  if (movieSuccess + tvSuccess === movies.length + tvShows.length) {
    console.log('\n🎉 ALL TESTS PASSED! VidSrc is fully working!');
  }
}

main().catch(console.error);

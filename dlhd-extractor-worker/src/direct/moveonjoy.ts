/**
 * Moveonjoy.com Backend - DISABLED (March 2026)
 * 
 * All moveonjoy.com URLs return 404 as of March 2026.
 * Keeping the module for reference but all functions return false/null
 * to avoid wasting time on requests that will fail.
 * 
 * Previously: Direct M3U8 access with no authentication or key fetching needed.
 * Master playlist: https://fl{N}.moveonjoy.com/{STREAM_NAME}/index.m3u8
 */

// Channel ID -> moveonjoy URL mapping
const MOVEONJOY_CHANNELS: Record<string, { url: string; name: string }> = {
  // Sports
  '11': { url: 'https://fl7.moveonjoy.com/UFC/index.m3u8', name: 'UFC' },
  '19': { url: 'https://fl31.moveonjoy.com/MLB_NETWORK/index.m3u8', name: 'MLB Network' },
  '39': { url: 'https://fl7.moveonjoy.com/FOX_Sports_1/index.m3u8', name: 'FOX Sports 1' },
  '44': { url: 'https://fl2.moveonjoy.com/ESPN/index.m3u8', name: 'ESPN' },
  '45': { url: 'https://fl2.moveonjoy.com/ESPN_2/index.m3u8', name: 'ESPN 2' },
  '90': { url: 'https://fl1.moveonjoy.com/SEC_NETWORK/index.m3u8', name: 'SEC Network' },
  '91': { url: 'https://fl31.moveonjoy.com/ACC_NETWORK/index.m3u8', name: 'ACC Network' },
  '92': { url: 'https://fl31.moveonjoy.com/ESPN_U/index.m3u8', name: 'ESPN U' },
  '93': { url: 'https://fl31.moveonjoy.com/ESPN_NEWS/index.m3u8', name: 'ESPN News' },
  '94': { url: 'https://fl7.moveonjoy.com/BIG_TEN_NETWORK/index.m3u8', name: 'Big Ten Network' },
  '98': { url: 'https://fl31.moveonjoy.com/NBA_TV/index.m3u8', name: 'NBA TV' },
  '127': { url: 'https://fl31.moveonjoy.com/CBS_SPORTS_NETWORK/index.m3u8', name: 'CBS Sports Network' },
  '129': { url: 'https://fl31.moveonjoy.com/YES_NETWORK/index.m3u8', name: 'YES Network' },
  '146': { url: 'https://fl7.moveonjoy.com/WWE/index.m3u8', name: 'WWE Network' },
  '288': { url: 'https://fl31.moveonjoy.com/ESPN_NEWS/index.m3u8', name: 'ESPN News' },
  '308': { url: 'https://fl31.moveonjoy.com/CBS_SPORTS_NETWORK/index.m3u8', name: 'CBS Sports Network' },
  '316': { url: 'https://fl31.moveonjoy.com/ESPN_U/index.m3u8', name: 'ESPN U' },
  '336': { url: 'https://fl7.moveonjoy.com/TBS/index.m3u8', name: 'TBS' },
  '338': { url: 'https://fl7.moveonjoy.com/TNT/index.m3u8', name: 'TNT' },
  '376': { url: 'https://fl7.moveonjoy.com/WWE/index.m3u8', name: 'WWE' },
  '385': { url: 'https://fl1.moveonjoy.com/SEC_NETWORK/index.m3u8', name: 'SEC Network' },
  '397': { url: 'https://fl7.moveonjoy.com/BIG_TEN_NETWORK/index.m3u8', name: 'Big Ten Network' },
  '399': { url: 'https://fl31.moveonjoy.com/MLB_NETWORK/index.m3u8', name: 'MLB Network' },
  '404': { url: 'https://fl31.moveonjoy.com/NBA_TV/index.m3u8', name: 'NBA TV' },
  '405': { url: 'https://fl31.moveonjoy.com/NFL_NETWORK/index.m3u8', name: 'NFL Network' },
  '664': { url: 'https://fl31.moveonjoy.com/ACC_NETWORK/index.m3u8', name: 'ACC Network' },
  // Broadcast
  '51': { url: 'https://fl1.moveonjoy.com/AL_BIRMINGHAM_ABC/index.m3u8', name: 'ABC' },
  '52': { url: 'https://fl1.moveonjoy.com/FL_West_Palm_Beach_CBS/index.m3u8', name: 'CBS' },
  '53': { url: 'https://fl61.moveonjoy.com/FL_Tampa_NBC/index.m3u8', name: 'NBC' },
  '54': { url: 'https://fl61.moveonjoy.com/FL_Tampa_FOX/index.m3u8', name: 'FOX' },
  // Entertainment
  '20': { url: 'https://fl61.moveonjoy.com/MTV/index.m3u8', name: 'MTV' },
  '21': { url: 'https://fl31.moveonjoy.com/SYFY/index.m3u8', name: 'SYFY' },
  '303': { url: 'https://fl61.moveonjoy.com/AMC_NETWORK/index.m3u8', name: 'AMC' },
  '304': { url: 'https://fl1.moveonjoy.com/Animal_Planet/index.m3u8', name: 'Animal Planet' },
  '307': { url: 'https://fl7.moveonjoy.com/BRAVO/index.m3u8', name: 'Bravo' },
  '310': { url: 'https://fl61.moveonjoy.com/Comedy_Central/index.m3u8', name: 'Comedy Central' },
  '312': { url: 'https://fl31.moveonjoy.com/DISNEY/index.m3u8', name: 'Disney Channel' },
  '313': { url: 'https://fl31.moveonjoy.com/DISCOVERY_FAMILY_CHANNEL/index.m3u8', name: 'Discovery' },
  '315': { url: 'https://fl61.moveonjoy.com/E_ENTERTAINMENT_TELEVISION/index.m3u8', name: 'E!' },
  '317': { url: 'https://fl61.moveonjoy.com/FX/index.m3u8', name: 'FX' },
  '320': { url: 'https://fl61.moveonjoy.com/HALLMARK_CHANNEL/index.m3u8', name: 'Hallmark' },
  '321': { url: 'https://fl61.moveonjoy.com/HBO/index.m3u8', name: 'HBO' },
  '328': { url: 'https://fl31.moveonjoy.com/National_Geographic/index.m3u8', name: 'Nat Geo' },
  '333': { url: 'https://fl31.moveonjoy.com/SHOWTIME/index.m3u8', name: 'Showtime' },
  '334': { url: 'https://fl31.moveonjoy.com/PARAMOUNT_NETWORK/index.m3u8', name: 'Paramount' },
  '337': { url: 'https://fl1.moveonjoy.com/TLC/index.m3u8', name: 'TLC' },
  '339': { url: 'https://fl1.moveonjoy.com/CARTOON_NETWORK/index.m3u8', name: 'Cartoon Network' },
  '343': { url: 'https://fl7.moveonjoy.com/USA_NETWORK/index.m3u8', name: 'USA Network' },
  '360': { url: 'https://fl1.moveonjoy.com/BBC_AMERICA/index.m3u8', name: 'BBC America' },
};

/**
 * Check if a channel has a moveonjoy backend available
 * DISABLED March 2026: All moveonjoy URLs return 404
 */
export function hasMoveonjoyChannel(_channelId: string): boolean {
  return false; // Moveonjoy is dead as of March 2026
}

/**
 * Get the moveonjoy master playlist URL for a channel
 * Returns null if channel not mapped
 */
export function getMoveonjoyUrl(channelId: string): string | null {
  const ch = MOVEONJOY_CHANNELS[channelId];
  return ch ? ch.url : null;
}

/**
 * Build a proxied URL through /dlhdprivate
 */
function proxyUrl(upstream: string, workerBaseUrl: string, jwtToken: string): string {
  const proxied = new URL('/dlhdprivate', workerBaseUrl);
  proxied.searchParams.set('url', upstream);
  proxied.searchParams.set('jwt', jwtToken);
  return proxied.toString();
}

/**
 * Fetch the media playlist from moveonjoy (resolves master -> media)
 * Returns the full media playlist content ready to serve to the player,
 * with ALL segment URLs rewritten to proxy through /dlhdprivate.
 * The client NEVER talks to moveonjoy.com directly.
 * 
 * Returns null if the channel is offline or not available.
 */
export async function fetchMoveonjoyPlaylist(
  channelId: string,
  workerBaseUrl: string,
  jwtToken: string,
): Promise<{
  content: string;
  baseUrl: string;
  channelName: string;
} | null> {
  const ch = MOVEONJOY_CHANNELS[channelId];
  if (!ch) return null;

  try {
    // Fetch master playlist
    const masterRes = await fetch(ch.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    if (!masterRes.ok) return null;

    const masterText = await masterRes.text();
    if (!masterText.includes('#EXTM3U')) return null;

    // Extract relative media playlist path from master
    const mediaPath = masterText.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim();
    if (!mediaPath) return null;

    // Build absolute media playlist URL
    const baseUrl = ch.url.substring(0, ch.url.lastIndexOf('/') + 1);
    const mediaUrl = mediaPath.startsWith('http') ? mediaPath : baseUrl + mediaPath;

    // Fetch media playlist
    const mediaRes = await fetch(mediaUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    if (!mediaRes.ok) return null;

    const mediaText = await mediaRes.text();
    if (!mediaText.includes('#EXTM3U')) return null;

    // Rewrite ALL segment URLs to proxy through /dlhdprivate
    const mediaBase = mediaUrl.substring(0, mediaUrl.lastIndexOf('/') + 1);
    const lines = mediaText.split('\n');
    const rewrittenLines = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      // Make absolute then proxy
      const absoluteUrl = trimmed.startsWith('http') ? trimmed : mediaBase + trimmed;
      return proxyUrl(absoluteUrl, workerBaseUrl, jwtToken);
    });

    return {
      content: rewrittenLines.join('\n'),
      baseUrl: mediaBase,
      channelName: ch.name,
    };
  } catch (e) {
    console.log(`[moveonjoy] Error fetching ch${channelId}: ${e}`);
    return null;
  }
}

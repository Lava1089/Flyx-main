/**
 * Player 6 Backend (lovecdn.ru → lovetier.bz → planetary.lovecdn.ru)
 * 
 * NO ENCRYPTION, token-based auth embedded in page.
 * Works when dvalna.ru players (1-5) are down.
 * 
 * Flow:
 * 1. Fetch lovetier.bz/player/{streamName} (with Referer: lovecdn.ru)
 * 2. Extract config.streamUrl from inline JS
 * 3. That's the M3U8 master playlist URL (unencrypted)
 * 4. Token auto-refreshes via POST /api/refresh_token.php
 * 
 * Master: https://planetary.lovecdn.ru/{stream}/index.m3u8?token=...
 * Media:  https://planetary.lovecdn.ru/{stream}/tracks-v1a1/mono.m3u8?token=...
 */

// Channel ID → lovecdn stream name mapping (scraped from player 6 pages)
const PLAYER6_STREAMS: Record<string, string> = {
  '31': 'TNT1UK', '32': 'tntsports2', '33': 'tntsports3', '34': 'tntsports4',
  '35': 'SkySportsFootballUK', '36': 'skysportsplus', '37': 'skysportsaction',
  '38': 'skysportsmainevent', '39': 'FOXSPORTS1', '40': 'TENNISCHANNEL',
  '41': 'EURO1GR', '42': 'EURO2GR', '44': 'ESPN', '45': 'ESPN2',
  '46': 'skysportstennisuk', '47': 'POLSATSPORTPL', '48': 'CANALSPORTPL',
  '49': 'SPT1', '50': 'POLSATSPORTEXTRA', '57': 'EUROSPORT1PL',
  '58': 'EUROSPORT2PL', '60': 'SkySportsF1', '62': 'beINSPORTS1TR',
  '63': 'beINSPORTS2TR', '64': 'beINSPORTS3TR', '65': 'skysportscricketuk',
  '67': 'BEINSPORT4TR', '70': 'skysportsgolfuk', '71': 'ElevenSports1PL',
  '72': 'ElevenSports2PL', '73': 'CANALSPORT2PL', '74': 'SPT2',
  '78': 'SPORTV1BR', '79': 'SPORTV2BR', '80': 'SPORTV3BR', '81': 'ESPN1BR',
  '82': 'ESPN2BR', '83': 'ESPN3BR', '84': 'LALIGAES', '85': 'ESPN4BR',
  '88': 'PREMIERE1BR', '89': 'COMBATE', '91': 'beINAR', '92': 'beINAR2',
  '93': 'beINAR3', '94': 'beINAR4', '95': 'beINAR5', '96': 'beINAR6',
  '97': 'beINAR7', '98': 'beINAR8', '99': 'beINAR9',
  '101': 'SPORTKLUB1RS', '102': 'SPORTKLUB2RS', '103': 'SPORTKLUB3RS',
  '104': 'SPORTKLUB4RS', '111': 'TSN1', '112': 'TSN2', '113': 'TSN3',
  '114': 'TSN4', '115': 'TSN5', '116': 'BEINSPORT1FR', '117': 'BEINSPORT2FR',
  '118': 'BEINSPORT3FR', '119': 'RMCSPORT1FR', '120': 'RMCSPORT2FR',
  '121': 'CANALPLFR', '122': 'CANALSPORTFR', '127': 'MatchTV',
  '129': 'POLSATSPORTNEWS', '130': 'skysportspremierleague',
  '134': 'ARENASPORT1PREMIUMRS', '135': 'ARENASPORT2PREMIUMRS',
  '136': 'MatchTV1', '137': 'MatchTV2', '138': 'MatchTV3',
  '139': 'ARENASPORT3PREMIUMRS', '140': 'SPORT1IL', '141': 'SPORT2IL',
  '142': 'SPORT3IL', '143': 'SPORT4IL', '144': 'SPORT5IL', '145': 'SPORT5PLUS',
  '146': 'SPORT5LIVE', '147': 'SPORT5STARS', '148': 'SPORT5GOLD',
  '210': 'PBSAmerica', '233': 'Eurosport1NL', '234': 'Eurosport2NL',
  '259': 'CANALSPORT3PL', '271': 'CANALPLGPAF', '273': 'CANALPLF1AF',
  '274': 'SkySportF1DE', '276': 'ViaplayLaLigaUK', '288': 'ESPNNEWS',
  '289': 'SPT4', '290': 'SPT5', '291': 'SPT6', '308': 'CBSSPORTSNETWORK',
  '316': 'ESPNU', '318': 'GOLFChannel', '343': 'USANETWEST',
  '346': 'WILLOWCRICKET', '348': 'Dave', '349': 'BBCNEWS', '350': 'ITV1',
  '351': 'ITV2', '352': 'ITV3', '353': 'ITV4', '356': 'BBCONE',
  '357': 'BBCTWO', '358': 'BBCThree', '362': 'SkyAtlanticDE',
  '366': 'skysportsnews', '367': 'MTV', '372': 'BEINSPORTES',
  '375': 'ESPNDEPORTES', '376': 'WWE', '377': 'MUTV', '379': 'ESPN1NL',
  '380': 'BTV1', '383': 'ZiggoSport5', '386': 'ESPN2NL', '393': 'ZiggoSport',
  '395': 'MatchTVFight', '396': 'ZiggoSport4', '397': 'BIGTENNETWORK',
  '398': 'ZiggoSport2', '400': 'DIGISPORT1', '401': 'DIGISPORT2',
  '402': 'DIGISPORT3', '403': 'DIGISPORT4', '405': 'NFLNETWORK',
  '425': 'beINSPORTSUS', '428': 'ElevenSports3PL', '432': 'ARENASPORT1HR',
  '433': 'ARENASPORT2HR', '434': 'ARENASPORT3HR', '435': 'MLIGADECAMPEONES',
  '436': 'MDEPORTES', '445': 'DAZN1ES', '446': 'DAZN2ES',
  '449': 'skysportsmixuk',
};

export function hasPlayer6Channel(channelId: string): boolean {
  return channelId in PLAYER6_STREAMS;
}

export function getPlayer6StreamName(channelId: string): string | null {
  return PLAYER6_STREAMS[channelId] || null;
}

/**
 * Extract stream URL from player 6 (lovetier.bz).
 * Returns the master playlist URL with token, or null if extraction fails.
 */
export async function extractPlayer6Stream(channelId: string): Promise<{
  masterUrl: string;
  streamName: string;
} | null> {
  const streamName = PLAYER6_STREAMS[channelId];
  if (!streamName) return null;

  try {
    const resp = await fetch(`https://lovetier.bz/player/${streamName}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://lovecdn.ru/',
      },
    });
    if (!resp.ok) return null;

    const html = await resp.text();
    const match = html.match(/streamUrl:\s*"([^"]+)"/);
    if (!match) return null;

    const masterUrl = match[1].replace(/\\\//g, '/');
    return { masterUrl, streamName };
  } catch (e) {
    console.log(`[player6] Error extracting ch${channelId}: ${e}`);
    return null;
  }
}

/**
 * Fetch the media playlist from player 6.
 * Resolves master → media playlist and makes segment URLs absolute.
 * 
 * When workerBaseUrl is provided, segment URLs are proxied through /dlhdprivate
 * to avoid CORS issues (planetary.lovecdn.ru doesn't set CORS headers).
 */
export async function fetchPlayer6Playlist(
  channelId: string,
  workerBaseUrl?: string,
  token?: string
): Promise<{
  content: string;
  baseUrl: string;
  streamName: string;
} | null> {
  const extracted = await extractPlayer6Stream(channelId);
  if (!extracted) return null;

  try {
    // Fetch master playlist
    const masterResp = await fetch(extracted.masterUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://lovetier.bz/',
      },
    });
    if (!masterResp.ok) return null;

    const masterText = await masterResp.text();
    if (!masterText.includes('#EXTM3U')) return null;

    // Extract media playlist path (relative URL in master)
    const mediaPath = masterText.split('\n').find(l => l.trim() && !l.startsWith('#'))?.trim();
    if (!mediaPath) return null;

    // Build absolute media URL
    const masterBase = extracted.masterUrl.substring(0, extracted.masterUrl.lastIndexOf('/') + 1);
    const mediaUrl = mediaPath.startsWith('http') ? mediaPath : masterBase + mediaPath;

    // Fetch media playlist
    const mediaResp = await fetch(mediaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://lovetier.bz/',
      },
    });
    if (!mediaResp.ok) return null;

    const mediaText = await mediaResp.text();
    if (!mediaText.includes('#EXTM3U')) return null;

    // Make segment URLs absolute, optionally proxied through /dlhdprivate
    const mediaBase = mediaUrl.substring(0, mediaUrl.lastIndexOf('/') + 1);
    const lines = mediaText.split('\n');
    const rewrittenLines = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const absoluteUrl = trimmed.startsWith('http') ? trimmed : mediaBase + trimmed;
        // Proxy through /dlhdprivate if workerBaseUrl is provided (for CORS)
        if (workerBaseUrl) {
          const proxied = new URL('/dlhdprivate', workerBaseUrl);
          proxied.searchParams.set('url', absoluteUrl);
          if (token) proxied.searchParams.set('jwt', token);
          proxied.searchParams.set('ref', 'https://lovetier.bz/');
          return proxied.toString();
        }
        return absoluteUrl;
      }
      return line;
    });

    return {
      content: rewrittenLines.join('\n'),
      baseUrl: mediaBase,
      streamName: extracted.streamName,
    };
  } catch (e) {
    console.log(`[player6] Error fetching playlist ch${channelId}: ${e}`);
    return null;
  }
}

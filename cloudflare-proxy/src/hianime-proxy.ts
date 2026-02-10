/**
 * HiAnime Extraction + Stream Proxy
 * 
 * ALL extraction and decryption happens HERE on the Cloudflare Worker.
 * The frontend just calls /hianime/extract and gets back proxied HLS URLs.
 * 
 * Routes:
 *   GET /hianime/extract?malId=X&title=Y&episode=Z  - Full extraction pipeline
 *   GET /hianime/stream?url=<encoded_url>            - Proxy HLS stream/segment
 *   GET /hianime/health                              - Health check
 * 
 * Extraction pipeline:
 *   1. Search HiAnime by title → match MAL ID via syncData
 *   2. Get episode list → find target episode
 *   3. Get servers → pick VidStreaming (serverId=4) for sub/dub
 *   4. Get source link → MegaCloud embed URL
 *   5. Extract client key from embed page
 *   6. Fetch megacloud decryption key from GitHub
 *   7. Call getSources v3 → decrypt if encrypted
 *   8. Return proxied HLS URLs + subtitles + skip markers
 * 
 * Pure fetch + local decryption. No external dependencies.
 */

import { createLogger, type LogLevel } from './logger';

export interface Env {
  LOG_LEVEL?: string;
  RPI_PROXY_URL?: string;
  RPI_PROXY_KEY?: string;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const HIANIME_DOMAIN = 'hianime.to';
const MEGACLOUD_KEYS_URL = 'https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json';

// ============================================================================
// MegaCloud Decryption Engine (pure JS, no dependencies)
// ============================================================================

function keygen2(megacloudKey: string, clientKey: string): string {
  const keygenHashMultVal = 31n;
  const keygenXORVal = 247;
  const keygenShiftVal = 5;
  let tempKey = megacloudKey + clientKey;

  let hashVal = 0n;
  for (let i = 0; i < tempKey.length; i++) {
    hashVal = BigInt(tempKey.charCodeAt(i)) + hashVal * keygenHashMultVal + (hashVal << 7n) - hashVal;
  }
  hashVal = hashVal < 0n ? -hashVal : hashVal;
  const lHash = Number(hashVal % 0x7fffffffffffffffn);

  tempKey = tempKey.split('').map(c => String.fromCharCode(c.charCodeAt(0) ^ keygenXORVal)).join('');
  const pivot = (lHash % tempKey.length) + keygenShiftVal;
  tempKey = tempKey.slice(pivot) + tempKey.slice(0, pivot);

  const leafStr = clientKey.split('').reverse().join('');
  let returnKey = '';
  for (let i = 0; i < Math.max(tempKey.length, leafStr.length); i++) {
    returnKey += (tempKey[i] || '') + (leafStr[i] || '');
  }
  returnKey = returnKey.substring(0, 96 + (lHash % 33));
  returnKey = [...returnKey].map(c => String.fromCharCode((c.charCodeAt(0) % 95) + 32)).join('');
  return returnKey;
}

function seedShuffle2(charArray: string[], iKey: string): string[] {
  let hashVal = 0n;
  for (let i = 0; i < iKey.length; i++) {
    hashVal = (hashVal * 31n + BigInt(iKey.charCodeAt(i))) & 0xffffffffn;
  }
  let shuffleNum = hashVal;
  const psudoRand = (arg: number) => {
    shuffleNum = (shuffleNum * 1103515245n + 12345n) & 0x7fffffffn;
    return Number(shuffleNum % BigInt(arg));
  };
  const retStr = [...charArray];
  for (let i = retStr.length - 1; i > 0; i--) {
    const swapIndex = psudoRand(i + 1);
    [retStr[i], retStr[swapIndex]] = [retStr[swapIndex], retStr[i]];
  }
  return retStr;
}

function columnarCipher2(src: string, ikey: string): string {
  const columnCount = ikey.length;
  const rowCount = Math.ceil(src.length / columnCount);
  const cipherArry = Array(rowCount).fill(null).map(() => Array(columnCount).fill(' '));
  const keyMap = ikey.split('').map((char, index) => ({ char, idx: index }));
  const sortedMap = [...keyMap].sort((a, b) => a.char.charCodeAt(0) - b.char.charCodeAt(0));

  let srcIndex = 0;
  sortedMap.forEach(({ idx: index }) => {
    for (let i = 0; i < rowCount; i++) {
      cipherArry[i][index] = src[srcIndex++];
    }
  });

  let returnStr = '';
  for (let x = 0; x < rowCount; x++) {
    for (let y = 0; y < columnCount; y++) {
      returnStr += cipherArry[x][y];
    }
  }
  return returnStr;
}

function decryptSrc2(src: string, clientKey: string, megacloudKey: string): string {
  const layers = 3;
  const genKey = keygen2(megacloudKey, clientKey);
  let decSrc = atob(src);
  const charArray = [...Array(95)].map((_, index) => String.fromCharCode(32 + index));

  const reverseLayer = (iteration: number) => {
    const layerKey = genKey + iteration;
    let hashVal = 0n;
    for (let i = 0; i < layerKey.length; i++) {
      hashVal = (hashVal * 31n + BigInt(layerKey.charCodeAt(i))) & 0xffffffffn;
    }
    let seed = hashVal;
    const seedRand = (arg: number) => {
      seed = (seed * 1103515245n + 12345n) & 0x7fffffffn;
      return Number(seed % BigInt(arg));
    };

    decSrc = decSrc.split('').map((char) => {
      const cArryIndex = charArray.indexOf(char);
      if (cArryIndex === -1) return char;
      const randNum = seedRand(95);
      const newCharIndex = (cArryIndex - randNum + 95) % 95;
      return charArray[newCharIndex];
    }).join('');

    decSrc = columnarCipher2(decSrc, layerKey);
    const subValues = seedShuffle2(charArray, layerKey);
    const charMap: Record<string, string> = {};
    subValues.forEach((char, index) => { charMap[char] = charArray[index]; });
    decSrc = decSrc.split('').map(char => charMap[char] || char).join('');
  };

  for (let i = layers; i > 0; i--) {
    reverseLayer(i);
  }
  const dataLen = parseInt(decSrc.substring(0, 4), 10);
  return decSrc.substring(4, 4 + dataLen);
}

// ============================================================================
// MegaCloud Client Key Extraction
// ============================================================================

async function getMegaCloudClientKey(sourceId: string): Promise<string> {
  const res = await fetch(`https://megacloud.blog/embed-2/v3/e-1/${sourceId}`, {
    headers: { 'User-Agent': UA, 'Referer': 'https://hianime.to/' },
  });
  const text = await res.text();

  const regexes = [
    /<meta name="_gg_fb" content="[a-zA-Z0-9]+">/,
    /<!--\s+_is_th:[0-9a-zA-Z]+\s+-->/,
    /<script>window\._lk_db\s+=\s+\{[xyz]:\s+["'][a-zA-Z0-9]+["'],\s+[xyz]:\s+["'][a-zA-Z0-9]+["'],\s+[xyz]:\s+["'][a-zA-Z0-9]+["']\};<\/script>/,
    /<div\s+data-dpi="[0-9a-zA-Z]+"\s+.*><\/div>/,
    /<script nonce="[0-9a-zA-Z]+">/,
    /<script>window\._xy_ws = ['"`][0-9a-zA-Z]+['"`];<\/script>/,
  ];
  const keyRegex = /"[a-zA-Z0-9]+"/;
  const lkDbRegex = [/x:\s+"[a-zA-Z0-9]+"/, /y:\s+"[a-zA-Z0-9]+"/, /z:\s+"[a-zA-Z0-9]+"/];

  let pass: RegExpMatchArray | null = null;
  let count = 0;
  for (let i = 0; i < regexes.length; i++) {
    pass = text.match(regexes[i]);
    if (pass !== null) { count = i; break; }
  }
  if (!pass) throw new Error('Failed extracting MegaCloud client key');

  let clientKey = '';
  if (count === 2) {
    const x = pass[0].match(lkDbRegex[0]);
    const y = pass[0].match(lkDbRegex[1]);
    const z = pass[0].match(lkDbRegex[2]);
    if (!x || !y || !z) throw new Error('Failed building client key (xyz)');
    const p1 = x[0].match(keyRegex), p2 = y[0].match(keyRegex), p3 = z[0].match(keyRegex);
    if (!p1 || !p2 || !p3) throw new Error('Failed building client key (xyz)');
    clientKey = p1[0].replace(/"/g, '') + p2[0].replace(/"/g, '') + p3[0].replace(/"/g, '');
  } else if (count === 1) {
    const keytest = pass[0].match(/:[a-zA-Z0-9]+ /);
    if (!keytest) throw new Error('Failed extracting client key (comment)');
    clientKey = keytest[0].replace(/:/g, '').replace(/ /g, '');
  } else {
    const keytest = pass[0].match(keyRegex);
    if (!keytest) throw new Error('Failed extracting client key');
    clientKey = keytest[0].replace(/"/g, '');
  }
  return clientKey;
}

async function getMegaCloudKey(): Promise<string> {
  const res = await fetch(MEGACLOUD_KEYS_URL);
  const keys = await res.json() as Record<string, string>;
  return keys.mega;
}

// ============================================================================
// HiAnime API (pure fetch, regex HTML parsing)
// ============================================================================

async function hianimeSearch(query: string): Promise<Array<{ id: string; name: string; hianimeId: string | null }>> {
  const res = await fetch(`https://${HIANIME_DOMAIN}/search?keyword=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA },
  });
  const html = await res.text();
  const results: Array<{ id: string; name: string; hianimeId: string | null }> = [];
  const itemRegex = /<a[^>]*href="\/([^"?]+)"[^>]*class="[^"]*dynamic-name[^"]*"[^>]*data-jname="([^"]*)"[^>]*>([^<]*)<\/a>/g;
  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const id = match[1];
    const name = match[3].trim();
    const numId = id.match(/-(\d+)$/)?.[1] || null;
    results.push({ id, name, hianimeId: numId });
  }
  return results;
}

async function getHiAnimeMalId(animeSlug: string): Promise<number | null> {
  const res = await fetch(`https://${HIANIME_DOMAIN}/${animeSlug}`, {
    headers: { 'User-Agent': UA },
  });
  const html = await res.text();
  const syncMatch = html.match(/<div[^>]*id="syncData"[^>]*>([^<]*)<\/div>/);
  if (!syncMatch) return null;
  try {
    const syncData = JSON.parse(syncMatch[1]);
    return syncData.mal_id ? parseInt(syncData.mal_id) : null;
  } catch {
    return null;
  }
}

interface HiAnimeEpisode { number: number; dataId: string; href: string; }
interface HiAnimeServer { dataId: string; type: 'sub' | 'dub' | 'raw'; serverId: string; }

async function getEpisodeList(animeId: string): Promise<HiAnimeEpisode[]> {
  const res = await fetch(`https://${HIANIME_DOMAIN}/ajax/v2/episode/list/${animeId}`, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': `https://${HIANIME_DOMAIN}/` },
  });
  const json = await res.json() as { html: string };
  const episodes: HiAnimeEpisode[] = [];
  const epRegex = /<a[^>]*data-number="(\d+)"[^>]*data-id="(\d+)"[^>]*href="([^"]*)"[^>]*>/g;
  let m;
  while ((m = epRegex.exec(json.html)) !== null) {
    episodes.push({ number: parseInt(m[1]), dataId: m[2], href: m[3] });
  }
  return episodes;
}

async function getServers(episodeId: string): Promise<HiAnimeServer[]> {
  const res = await fetch(`https://${HIANIME_DOMAIN}/ajax/v2/episode/servers?episodeId=${episodeId}`, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': `https://${HIANIME_DOMAIN}/` },
  });
  const json = await res.json() as { html: string };
  const servers: HiAnimeServer[] = [];
  // Attributes span multiple lines — use [\s\S] to match across newlines
  const serverRegex = /<div[\s\S]*?class="[^"]*server-item[^"]*"[\s\S]*?>/g;
  let m;
  while ((m = serverRegex.exec(json.html)) !== null) {
    const block = m[0];
    const dataId = block.match(/data-id="(\d+)"/)?.[1];
    const type = block.match(/data-type="(sub|dub|raw)"/)?.[1] as 'sub' | 'dub' | 'raw' | undefined;
    const serverId = block.match(/data-server-id="(\d+)"/)?.[1];
    if (dataId && type && serverId) servers.push({ dataId, type, serverId });
  }
  return servers;
}

async function getSourceLink(serverId: string): Promise<string | null> {
  const res = await fetch(`https://${HIANIME_DOMAIN}/ajax/v2/episode/sources?id=${serverId}`, {
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': `https://${HIANIME_DOMAIN}/` },
  });
  const json = await res.json() as { link?: string };
  return json.link || null;
}

// ============================================================================
// MegaCloud Stream Extraction
// ============================================================================

interface MegaCloudSource { file: string; type: string; }
interface MegaCloudTrack { file: string; kind: string; label?: string; default?: boolean; }
interface MegaCloudResult {
  sources: Array<{ url: string; type: string }>;
  subtitles: Array<{ url: string; lang: string; default: boolean }>;
  intro: { start: number; end: number };
  outro: { start: number; end: number };
}

async function extractMegaCloudStream(embedUrl: string): Promise<MegaCloudResult> {
  const url = new URL(embedUrl);
  const sourceId = url.pathname.split('/').pop()!;

  const [clientKey, megacloudKey] = await Promise.all([
    getMegaCloudClientKey(sourceId),
    getMegaCloudKey(),
  ]);

  const srcRes = await fetch(
    `https://megacloud.blog/embed-2/v3/e-1/getSources?id=${sourceId}&_k=${clientKey}`,
    { headers: { 'User-Agent': UA, 'Referer': embedUrl } }
  );
  const srcData = await srcRes.json() as {
    sources: string | MegaCloudSource[];
    tracks?: MegaCloudTrack[];
    encrypted?: boolean;
    intro?: { start: number; end: number };
    outro?: { start: number; end: number };
  };

  let sources: MegaCloudSource[];
  if (!srcData.encrypted && Array.isArray(srcData.sources)) {
    sources = srcData.sources;
  } else {
    const decrypted = decryptSrc2(srcData.sources as string, clientKey, megacloudKey);
    sources = JSON.parse(decrypted);
  }

  const subtitles = (srcData.tracks || [])
    .filter(t => t.kind === 'captions')
    .map(t => ({ url: t.file, lang: t.label || t.kind, default: t.default || false }));

  return {
    sources: sources.map(s => ({ url: s.file, type: s.type })),
    subtitles,
    intro: srcData.intro || { start: 0, end: 0 },
    outro: srcData.outro || { start: 0, end: 0 },
  };
}

// ============================================================================
// Find anime on HiAnime by MAL ID
// ============================================================================

async function findHiAnimeByMalId(
  malId: number,
  title: string,
): Promise<{ hianimeId: string; slug: string } | null> {
  const results = await hianimeSearch(title);
  // Check each result's syncData for MAL ID match
  for (const result of results.slice(0, 5)) {
    const malIdFromPage = await getHiAnimeMalId(result.id);
    if (malIdFromPage === malId) {
      return { hianimeId: result.hianimeId!, slug: result.id };
    }
  }
  // Fallback: single result
  if (results.length === 1 && results[0].hianimeId) {
    return { hianimeId: results[0].hianimeId, slug: results[0].id };
  }
  return null;
}

// ============================================================================
// Helpers
// ============================================================================

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
  };
}

function jsonResponse(data: object, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function rewritePlaylistUrls(playlist: string, baseUrl: string, proxyOrigin: string): string {
  const lines = playlist.split('\n');
  const rewritten: string[] = [];
  const base = new URL(baseUrl);
  const basePath = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);

  const proxyUrl = (url: string): string => {
    let absoluteUrl: string;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      absoluteUrl = url;
    } else if (url.startsWith('/')) {
      absoluteUrl = `${base.origin}${url}`;
    } else {
      absoluteUrl = `${base.origin}${basePath}${url}`;
    }
    return `${proxyOrigin}/hianime/stream?url=${encodeURIComponent(absoluteUrl)}`;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (line.startsWith('#EXT-X-MEDIA:') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
      const uriMatch = line.match(/URI="([^"]+)"/);
      if (uriMatch) {
        rewritten.push(line.replace(`URI="${uriMatch[1]}"`, `URI="${proxyUrl(uriMatch[1])}"`));
      } else {
        rewritten.push(line);
      }
    } else if (line.startsWith('#') || trimmed === '') {
      rewritten.push(line);
    } else {
      try { rewritten.push(proxyUrl(trimmed)); } catch { rewritten.push(line); }
    }
  }
  return rewritten.join('\n');
}

// ============================================================================
// Request Handler
// ============================================================================

export async function handleHiAnimeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const logLevel = (env.LOG_LEVEL || 'info') as LogLevel;
  const logger = createLogger(request, logLevel);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // Health check
  if (path === '/hianime/health' || path.endsWith('/health')) {
    const hasRpi = !!(env.RPI_PROXY_URL && env.RPI_PROXY_KEY);
    return jsonResponse({
      status: 'ok',
      provider: 'hianime',
      rpiProxy: {
        configured: hasRpi,
        url: env.RPI_PROXY_URL ? env.RPI_PROXY_URL.substring(0, 30) + '...' : 'not set',
      },
      timestamp: new Date().toISOString(),
    }, 200);
  }

  // ── EXTRACT endpoint ──────────────────────────────────────────────
  if (path === '/hianime/extract') {
    const malId = url.searchParams.get('malId');
    const title = url.searchParams.get('title');
    const episode = url.searchParams.get('episode');

    if (!malId || !title) {
      return jsonResponse({
        error: 'Missing parameters',
        usage: '/hianime/extract?malId=<mal_id>&title=<anime_title>&episode=<number>',
      }, 400);
    }

    logger.info('HiAnime extract request', { malId, title, episode });
    const startTime = Date.now();

    try {
      // Step 1: Find anime
      const anime = await findHiAnimeByMalId(parseInt(malId), title);
      if (!anime) {
        return jsonResponse({ success: false, error: 'Anime not found on HiAnime' }, 404);
      }
      logger.info('Found anime', { hianimeId: anime.hianimeId, slug: anime.slug });

      // Step 2: Get episodes
      const episodes = await getEpisodeList(anime.hianimeId);
      const targetEp = episode ? parseInt(episode) : 1;
      const ep = episodes.find(e => e.number === targetEp);
      if (!ep) {
        return jsonResponse({
          success: false,
          error: `Episode ${targetEp} not found (${episodes.length} available)`,
        }, 404);
      }

      // Step 3: Get servers
      const servers = await getServers(ep.dataId);
      const subServer = servers.find(s => s.type === 'sub' && s.serverId === '4')
        || servers.find(s => s.type === 'sub');
      const dubServer = servers.find(s => s.type === 'dub' && s.serverId === '4')
        || servers.find(s => s.type === 'dub');

      // Step 4: Extract streams (sub + dub in parallel)
      const extractStream = async (server: HiAnimeServer | undefined, label: string) => {
        if (!server) return null;
        const link = await getSourceLink(server.dataId);
        if (!link) return null;
        const result = await extractMegaCloudStream(link);
        return { label, ...result };
      };

      const [subResult, dubResult] = await Promise.all([
        extractStream(subServer, 'sub'),
        extractStream(dubServer, 'dub'),
      ]);

      // Step 5: Build response with proxied URLs
      const proxyOrigin = url.origin;
      interface SourceEntry {
        quality: string;
        title: string;
        url: string;
        type: 'hls';
        language: string;
        skipIntro?: [number, number];
        skipOutro?: [number, number];
      }
      const sources: SourceEntry[] = [];
      const allSubtitles: Array<{ label: string; url: string; language: string }> = [];

      for (const result of [subResult, dubResult]) {
        if (!result) continue;
        for (const src of result.sources) {
          // Rewrite the m3u8 URL to go through our proxy
          const proxiedUrl = `${proxyOrigin}/hianime/stream?url=${encodeURIComponent(src.url)}`;
          sources.push({
            quality: 'auto',
            title: `HiAnime (${result.label === 'sub' ? 'Sub' : 'Dub'})`,
            url: proxiedUrl,
            type: 'hls',
            language: result.label,
            skipIntro: result.intro.end > 0 ? [result.intro.start, result.intro.end] : undefined,
            skipOutro: result.outro.end > 0 ? [result.outro.start, result.outro.end] : undefined,
          });
        }
        if (result.label === 'sub') {
          for (const sub of result.subtitles) {
            allSubtitles.push({ label: sub.lang, url: sub.url, language: sub.lang });
          }
        }
      }

      const elapsed = Date.now() - startTime;
      logger.info('Extraction complete', { sources: sources.length, subtitles: allSubtitles.length, elapsed });

      return jsonResponse({
        success: sources.length > 0,
        sources,
        subtitles: allSubtitles,
        provider: 'hianime',
        totalEpisodes: episodes.length,
        executionTime: elapsed,
      }, sources.length > 0 ? 200 : 404);

    } catch (error) {
      const err = error as Error;
      logger.error('HiAnime extraction error', err);
      return jsonResponse({
        success: false,
        error: err.message || 'Extraction failed',
        executionTime: Date.now() - startTime,
      }, 500);
    }
  }

  // ── STREAM proxy endpoint ─────────────────────────────────────────
  // MegaCloud CDN blocks datacenter IPs (403 Cloudflare challenge).
  // Route ALL stream requests through RPI residential proxy.
  // Flow: Client → CF Worker → RPI Proxy (residential IP) → MegaCloud CDN
  if (path === '/hianime/stream') {
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
      return jsonResponse({ error: 'Missing url parameter' }, 400);
    }

    const decodedUrl = decodeURIComponent(targetUrl);
    logger.debug('HiAnime stream proxy', { url: decodedUrl.substring(0, 100) });

    const hasRpi = !!(env.RPI_PROXY_URL && env.RPI_PROXY_KEY);

    // Strategy 1: Try RPI residential proxy (required for MegaCloud CDN)
    if (hasRpi) {
      try {
        let rpiBaseUrl = env.RPI_PROXY_URL!;
        if (!rpiBaseUrl.startsWith('http://') && !rpiBaseUrl.startsWith('https://')) {
          rpiBaseUrl = `https://${rpiBaseUrl}`;
        }
        rpiBaseUrl = rpiBaseUrl.replace(/\/+$/, '');

        // Use the /animekai endpoint on RPI — it handles CDN streams without Origin/Referer
        const rpiParams = new URLSearchParams({
          url: decodedUrl,
          key: env.RPI_PROXY_KEY!,
        });
        const rpiUrl = `${rpiBaseUrl}/animekai?${rpiParams.toString()}`;
        logger.debug('Forwarding to RPI proxy', { rpiUrl: rpiUrl.substring(0, 80) });

        const rpiResponse = await fetch(rpiUrl, {
          signal: AbortSignal.timeout(20000),
        });

        if (!rpiResponse.ok) {
          logger.warn('RPI proxy returned error', { status: rpiResponse.status });
          // Fall through to direct attempt
        } else {
          const contentType = rpiResponse.headers.get('content-type') || '';

          // Playlist — rewrite URLs to route back through this proxy
          if (contentType.includes('mpegurl') || decodedUrl.includes('.m3u8')) {
            const text = await rpiResponse.text();
            const rewritten = rewritePlaylistUrls(text, decodedUrl, url.origin);
            return new Response(rewritten, {
              status: 200,
              headers: {
                'Content-Type': 'application/vnd.apple.mpegurl',
                'Cache-Control': 'public, max-age=5',
                'X-Proxied-Via': 'rpi',
                ...corsHeaders(),
              },
            });
          }

          // Segment — pass through
          const body = await rpiResponse.arrayBuffer();
          const firstBytes = new Uint8Array(body.slice(0, 4));
          const isMpegTs = firstBytes[0] === 0x47;
          const isFmp4 = firstBytes[0] === 0x00 && firstBytes[1] === 0x00 && firstBytes[2] === 0x00;
          let actualContentType = contentType;
          if (isMpegTs) actualContentType = 'video/mp2t';
          else if (isFmp4) actualContentType = 'video/mp4';
          else if (!actualContentType) actualContentType = 'application/octet-stream';

          return new Response(body, {
            status: 200,
            headers: {
              'Content-Type': actualContentType,
              'Content-Length': body.byteLength.toString(),
              'Cache-Control': 'public, max-age=3600',
              'X-Proxied-Via': 'rpi',
              ...corsHeaders(),
            },
          });
        }
      } catch (error) {
        logger.warn('RPI proxy error, falling back to direct', { error: (error as Error).message });
      }
    }

    // Strategy 2: Direct fetch (will likely 403 on MegaCloud CDN but try anyway)
    try {
      const response = await fetch(decodedUrl, {
        headers: {
          'User-Agent': UA,
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return jsonResponse({
          error: `Stream fetch failed (${response.status})`,
          hint: hasRpi ? 'RPI proxy also failed' : 'RPI proxy not configured — MegaCloud CDN blocks datacenter IPs',
        }, response.status);
      }

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('mpegurl') || decodedUrl.includes('.m3u8')) {
        const text = await response.text();
        const rewritten = rewritePlaylistUrls(text, decodedUrl, url.origin);
        return new Response(rewritten, {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'public, max-age=5',
            'X-Proxied-Via': 'cf-direct',
            ...corsHeaders(),
          },
        });
      }

      const body = await response.arrayBuffer();
      const firstBytes = new Uint8Array(body.slice(0, 4));
      const isMpegTs = firstBytes[0] === 0x47;
      const isFmp4 = firstBytes[0] === 0x00 && firstBytes[1] === 0x00 && firstBytes[2] === 0x00;
      let actualContentType = contentType;
      if (isMpegTs) actualContentType = 'video/mp2t';
      else if (isFmp4) actualContentType = 'video/mp4';
      else if (!actualContentType) actualContentType = 'application/octet-stream';

      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': actualContentType,
          'Content-Length': body.byteLength.toString(),
          'Cache-Control': 'public, max-age=3600',
          'X-Proxied-Via': 'cf-direct',
          ...corsHeaders(),
        },
      });
    } catch (error) {
      const err = error as Error;
      logger.error('HiAnime stream proxy error (all strategies failed)', err);
      return jsonResponse({ error: err.message || 'Stream proxy error' }, 502);
    }
  }

  return jsonResponse({ error: 'Unknown HiAnime route', path }, 404);
}

export default {
  fetch: handleHiAnimeRequest,
};

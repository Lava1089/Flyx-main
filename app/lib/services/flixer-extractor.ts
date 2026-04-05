/**
 * Hexa.su Extractor — Browser-Direct Pattern
 *
 * Like DLHD whitelist: the BROWSER calls hexa.su API directly so hexa sees
 * the user's residential IP (no captcha). The CF Worker only provides:
 *   1. /flixer/sign  — signed auth headers (WASM keygen + HMAC)
 *   2. /flixer/decrypt — decrypts the encrypted API response (WASM)
 *
 * Flow:
 *   Browser → CF Worker /sign → get headers
 *   Browser → hexa.su API directly (user IP!) → encrypted response
 *   Browser → CF Worker /decrypt → parsed sources with URLs
 */

import { getFlixerSignUrl, getFlixerDecryptUrl } from '../proxy-config';

interface StreamSource {
  quality: string;
  title: string;
  url: string;
  type: 'hls' | 'mp4';
  referer: string;
  requiresSegmentProxy: boolean;
  status?: 'working' | 'down' | 'unknown';
  language?: string;
  server?: string;
}

interface ExtractionResult {
  success: boolean;
  sources: StreamSource[];
  subtitles?: Array<{ label: string; url: string; language: string }>;
  error?: string;
}

const SUBTITLE_API = 'https://sub.wyzie.ru';

export const FLIXER_ENABLED = true;

const SERVER_NAMES: Record<string, string> = {
  alpha: 'Ares', bravo: 'Balder', charlie: 'Circe', delta: 'Dionysus',
  echo: 'Eros', foxtrot: 'Freya', golf: 'Gaia', hotel: 'Hades',
  india: 'Isis', juliet: 'Juno', kilo: 'Kronos', lima: 'Loki',
  mike: 'Medusa', november: 'Nyx', oscar: 'Odin', papa: 'Persephone',
  quebec: 'Quirinus', romeo: 'Ra', sierra: 'Selene', tango: 'Thor',
  uniform: 'Uranus', victor: 'Vulcan', whiskey: 'Woden', xray: 'Xolotl',
  yankee: 'Ymir', zulu: 'Zeus',
};

async function fetchSubtitles(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
): Promise<Array<{ label: string; url: string; language: string }>> {
  try {
    let url = `${SUBTITLE_API}/search?id=${tmdbId}`;
    if (type === 'tv' && season && episode) {
      url += `&season=${season}&episode=${episode}`;
    }
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://hexa.su/' },
    });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data
      .map((sub: any) => ({
        label: sub.label || sub.lang || 'Unknown',
        url: sub.url || sub.file || '',
        language: sub.lang || 'en',
      }))
      .filter((s: any) => s.url);
  } catch {
    return [];
  }
}

/**
 * Sign + fetch + decrypt a single hexa API call.
 * Browser calls hexa.su directly — user's IP is visible, no captcha.
 */
async function hexaDirectFetch(
  tmdbId: string,
  type: 'movie' | 'tv',
  opts?: { server?: string; warmup?: boolean; season?: number; episode?: number },
): Promise<{ encrypted: string; apiUrl: string }> {
  // Step 1: Get signed headers from CF Worker
  const signUrl = getFlixerSignUrl(tmdbId, type, opts);
  const signRes = await fetch(signUrl, { signal: AbortSignal.timeout(8000) });
  if (!signRes.ok) throw new Error(`Sign failed: ${signRes.status}`);
  const signData = await signRes.json() as { success: boolean; url: string; headers: Record<string, string>; error?: string };
  if (!signData.success) throw new Error(signData.error || 'Sign failed');

  // Step 2: Browser fetches hexa.su API DIRECTLY (user's residential IP!)
  const apiRes = await fetch(signData.url, {
    headers: signData.headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!apiRes.ok) {
    const errText = await apiRes.text().catch(() => '');
    throw new Error(`Hexa API ${apiRes.status}: ${errText.substring(0, 100)}`);
  }

  return { encrypted: await apiRes.text(), apiUrl: signData.url };
}

async function hexaDecrypt(encrypted: string): Promise<any> {
  const decryptUrl = getFlixerDecryptUrl();
  const res = await fetch(decryptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Decrypt failed: ${res.status}`);
  const data = await res.json() as { success: boolean; sources: any[]; servers: string[]; parsed: any; error?: string };
  if (!data.success) throw new Error(data.error || 'Decrypt failed');
  return data;
}

/**
 * Extract streams from Hexa — browser-direct pattern.
 * No PoW captcha needed because hexa sees the user's real IP.
 */
export async function extractFlixerStreams(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
  _capToken?: string | null, // kept for API compat, not used in browser-direct
): Promise<ExtractionResult> {
  console.log(`[Hexa] Extracting ${type} ${tmdbId}${type === 'tv' ? ` S${season}E${episode}` : ''}`);

  if (!FLIXER_ENABLED) {
    return { success: false, sources: [], error: 'Hexa provider is disabled' };
  }
  if (type === 'tv' && (!season || !episode)) {
    return { success: false, sources: [], error: 'Season and episode required for TV' };
  }

  const subtitlePromise = fetchSubtitles(tmdbId, type, season, episode);
  const seasonNum = season;
  const episodeNum = episode;

  try {
    // Step 1: Warm-up (browser-direct)
    const warmupResult = await hexaDirectFetch(tmdbId, type, {
      warmup: true, season: seasonNum, episode: episodeNum,
    });
    const warmupData = await hexaDecrypt(warmupResult.encrypted);
    const servers = warmupData.servers?.length > 0 && warmupData.servers.length < 26
      ? warmupData.servers
      : Object.keys(SERVER_NAMES);

    console.log(`[Hexa] ${servers.length} servers available: ${servers.slice(0, 6).join(', ')}`);

    // Step 2: Fetch each server (browser-direct, sequential)
    const sources: StreamSource[] = [];
    for (const server of servers) {
      try {
        const result = await hexaDirectFetch(tmdbId, type, {
          server, season: seasonNum, episode: episodeNum,
        });
        const decrypted = await hexaDecrypt(result.encrypted);

        // Find URL for this server
        let url: string | null = null;
        if (decrypted.sources?.length > 0) {
          const src = decrypted.sources.find((s: any) => s.server === server) || decrypted.sources[0];
          url = src?.url || null;
        }
        if (!url && decrypted.parsed) {
          url = decrypted.parsed.url || decrypted.parsed.file || decrypted.parsed.stream || null;
        }

        if (url) {
          sources.push({
            quality: 'auto',
            title: `Flixer ${SERVER_NAMES[server] || server}`,
            url,
            type: 'hls',
            referer: 'https://hexa.su/',
            requiresSegmentProxy: true,
            status: 'working',
            language: 'en',
            server,
          });
          console.log(`[Hexa] ${server}: URL found`);
        }
      } catch (e) {
        console.log(`[Hexa] ${server}: ${e instanceof Error ? e.message : e}`);
      }
    }

    console.log(`[Hexa] ${sources.length}/${servers.length} servers returned URLs`);

    const subtitles = await subtitlePromise;
    return {
      success: sources.length > 0,
      sources,
      subtitles: subtitles.length > 0 ? subtitles : undefined,
    };
  } catch (err) {
    console.error(`[Hexa] Error:`, err instanceof Error ? err.message : err);
    return { success: false, sources: [], error: err instanceof Error ? err.message : 'Extraction failed' };
  }
}

/**
 * Fetch a specific Hexa source by display name (browser-direct).
 */
export async function fetchFlixerSourceByName(
  sourceName: string,
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
  _capToken?: string | null,
): Promise<StreamSource | null> {
  const serverEntry = Object.entries(SERVER_NAMES).find(([_, displayName]) =>
    sourceName.toLowerCase().includes(displayName.toLowerCase())
  );
  const server = serverEntry ? serverEntry[0] : 'alpha';

  try {
    // Warm-up first
    const warmup = await hexaDirectFetch(tmdbId, type, {
      warmup: true, season, episode,
    });
    await hexaDecrypt(warmup.encrypted);

    // Then fetch specific server
    const result = await hexaDirectFetch(tmdbId, type, { server, season, episode });
    const decrypted = await hexaDecrypt(result.encrypted);

    let url: string | null = null;
    if (decrypted.sources?.length > 0) {
      const src = decrypted.sources.find((s: any) => s.server === server) || decrypted.sources[0];
      url = src?.url || null;
    }

    if (url) {
      return {
        quality: 'auto',
        title: `Flixer ${SERVER_NAMES[server] || server}`,
        url,
        type: 'hls',
        referer: 'https://hexa.su/',
        requiresSegmentProxy: true,
        status: 'working',
        language: 'en',
        server,
      };
    }
  } catch (e) {
    console.error('[Hexa] fetchByName error:', e);
  }
  return null;
}

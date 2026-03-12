/**
 * Hexa.su Extractor - Cloudflare Worker Implementation
 * 
 * This extractor routes all requests through the Cloudflare Worker at /flixer/extract.
 * The WASM-based encryption/decryption runs in the CF Worker (bundled at build time).
 * 
 * Key discoveries from cracking:
 * - The `bW90aGFmYWth` header BLOCKS requests when present - must NOT send it
 * - The `Origin` header should NOT be sent
 * - A "warm-up" request is needed before the actual request
 * - WASM must be bundled with CF Worker, not fetched at runtime
 */

import { getFlixerExtractUrl, getFlixerExtractAllUrl } from '../proxy-config';
import { cfFetch } from '../utils/cf-fetch';

// The CF Worker at media-proxy.vynx.workers.dev/flixer handles the actual
// hexa.su API calls + WASM encryption. When running on CF Pages (same account),
// we can't directly fetch another CF Worker — cfFetch routes through RPI proxy.

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

interface FlixerApiResponse {
  success: boolean;
  sources?: StreamSource[];
  error?: string;
  server?: string;
}

const FLIXER_BASE_URL = 'https://hexa.su';
const SUBTITLE_API = 'https://sub.wyzie.ru';

// Hexa is back online (February 2026) — PRIMARY provider for movies and TV
export const FLIXER_ENABLED = true;

const SERVER_NAMES: Record<string, string> = {
  alpha: 'Ares',
  bravo: 'Balder',
  charlie: 'Circe',
  delta: 'Dionysus',
  echo: 'Eros',
  foxtrot: 'Freya',
  golf: 'Gaia',
  hotel: 'Hades',
  india: 'Isis',
  juliet: 'Juno',
  kilo: 'Kronos',
  lima: 'Loki',
  mike: 'Medusa',
  november: 'Nyx',
  oscar: 'Odin',
  papa: 'Persephone',
  quebec: 'Quirinus',
  romeo: 'Ra',
  sierra: 'Selene',
  tango: 'Thor',
  uniform: 'Uranus',
  victor: 'Vulcan',
  whiskey: 'Woden',
  xray: 'Xolotl',
  yankee: 'Ymir',
  zulu: 'Zeus',
};

async function fetchSubtitles(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<Array<{ label: string; url: string; language: string }>> {
  try {
    let url = `${SUBTITLE_API}/search?id=${tmdbId}`;
    if (type === 'tv' && season && episode) {
      url += `&season=${season}&episode=${episode}`;
    }
    // Direct fetch — subtitle API doesn't block datacenter IPs
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': FLIXER_BASE_URL },
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
 * Extract streams from Flixer via Cloudflare Worker
 * 
 * Uses the /flixer/extract-all batch endpoint — one round trip to the CF Worker
 * which fans out to all servers internally. Much faster than 6 individual requests.
 */
export async function extractFlixerStreams(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ExtractionResult> {
  console.log(`[Hexa] Extracting for ${type} ${tmdbId}${type === 'tv' ? ` S${season}E${episode}` : ''}`);

  if (!FLIXER_ENABLED) {
    return { success: false, sources: [], error: 'Hexa provider is disabled' };
  }

  if (type === 'tv' && (!season || !episode)) {
    return { success: false, sources: [], error: 'Season and episode required for TV shows' };
  }

  // Subtitles in parallel (don't block)
  const subtitlePromise = fetchSubtitles(tmdbId, type, season, episode);

  try {
    // Single batch request — CF Worker fans out to all servers internally
    // Use cfFetch: on CF Pages, direct fetch to same-account CF Workers returns 404
    const extractAllUrl = getFlixerExtractAllUrl(tmdbId, type, season, episode);
    const response = await cfFetch(extractAllUrl, { signal: AbortSignal.timeout(30000) });

    if (!response.ok) {
      console.log(`[Hexa] extract-all returned ${response.status}`);
      return { success: false, sources: [], error: `Hexa API returned ${response.status}` };
    }

    const data = await response.json() as { success: boolean; sources?: StreamSource[]; error?: string };

    if (!data.success || !data.sources?.length) {
      console.log(`[Hexa] extract-all: no sources`);
      return { success: false, sources: [], error: data.error || 'No working sources from Hexa' };
    }

    // Sources already have correct format from the CF Worker
    const sources: StreamSource[] = data.sources.map((s: any) => ({
      quality: s.quality || 'auto',
      title: s.title || 'Hexa',
      url: s.url || '',
      type: (s.type || 'hls') as 'hls' | 'mp4',
      referer: s.referer || 'https://hexa.su/',
      requiresSegmentProxy: s.requiresSegmentProxy ?? true,
      status: (s.status || 'working') as 'working' | 'down' | 'unknown',
      language: s.language || 'en',
      server: s.server,
    }));

    // At least one source must have a URL for initial playback
    const workingSources = sources.filter(s => s.url && s.status === 'working');
    console.log(`[Hexa] ${workingSources.length} working / ${sources.length} total source(s) via extract-all`);

    const subtitles = await subtitlePromise;
    return {
      success: sources.length > 0, // True if we have any servers (working or lazy-fetchable)
      sources, // Return ALL sources (working + unknown) so the player can show them
      subtitles: subtitles.length > 0 ? subtitles : undefined,
    };
  } catch (err) {
    console.error(`[Hexa] extract-all error:`, err instanceof Error ? err.message : err);
    return { success: false, sources: [], error: err instanceof Error ? err.message : 'Hexa extraction failed' };
  }
}

/**
 * Fetch a specific Hexa source by display name
 */
export async function fetchFlixerSourceByName(
  sourceName: string,
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<StreamSource | null> {
  // Find server by display name (e.g., "Flixer Ares" -> "alpha")
  const serverEntry = Object.entries(SERVER_NAMES).find(([_, displayName]) =>
    sourceName.toLowerCase().includes(displayName.toLowerCase())
  );
  const server = serverEntry ? serverEntry[0] : 'alpha';

  try {
    const extractUrl = getFlixerExtractUrl(tmdbId, type, server, season, episode);
    
    const response = await cfFetch(extractUrl, {
      signal: AbortSignal.timeout(20000),
    });
    
    if (!response.ok) {
      console.error(`[Hexa] fetchFlixerSourceByName: HTTP ${response.status}`);
      return null;
    }
    
    const data: FlixerApiResponse = await response.json();
    
    if (data.success && data.sources && data.sources.length > 0) {
      return data.sources[0];
    }
  } catch (e) {
    console.error('[Hexa] fetchFlixerSourceByName error:', e);
  }

  return null;
}

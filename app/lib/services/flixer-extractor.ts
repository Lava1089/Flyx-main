/**
 * Flixer.sh Extractor - Cloudflare Worker Implementation
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

import { getFlixerExtractUrl } from '../proxy-config';
import { cfFetch } from '../utils/cf-fetch';

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

const FLIXER_BASE_URL = 'https://flixer.sh';
const SUBTITLE_API = 'https://sub.wyzie.ru';

// DISABLED - Flixer is currently down (February 2026)
// Re-enable when Flixer comes back online and CF Worker is updated with new WASM
export const FLIXER_ENABLED = false;

const SERVER_NAMES: Record<string, string> = {
  alpha: 'Ares',
  bravo: 'Balder',
  charlie: 'Circe',
  delta: 'Dionysus',
  echo: 'Eros',
  foxtrot: 'Freya',
};

const NATO_ORDER = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];

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
    // Use cfFetch to route through RPI proxy on Cloudflare Workers
    const response = await cfFetch(url, {
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
 * The CF Worker handles WASM-based encryption/decryption
 * 
 * Updated: Now fetches ALL servers in parallel for maximum source availability
 */
export async function extractFlixerStreams(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<ExtractionResult> {
  console.log(`[Flixer] Extracting streams for ${type} ID ${tmdbId}${type === 'tv' ? ` S${season}E${episode}` : ''}`);

  if (!FLIXER_ENABLED) {
    return { success: false, sources: [], error: 'Flixer provider is disabled' };
  }

  if (type === 'tv' && (!season || !episode)) {
    return { success: false, sources: [], error: 'Season and episode required for TV shows' };
  }

  const sources: StreamSource[] = [];

  // Fetch ALL servers in parallel for maximum source availability
  console.log(`[Flixer] Fetching all ${NATO_ORDER.length} servers in parallel...`);
  
  const serverPromises = NATO_ORDER.map(async (server) => {
    try {
      const extractUrl = getFlixerExtractUrl(tmdbId, type, server, season, episode);
      console.log(`[Flixer] Server ${server} URL: ${extractUrl}`);
      
      const response = await fetch(extractUrl, {
        signal: AbortSignal.timeout(20000),
      });
      
      console.log(`[Flixer] Server ${server} response: ${response.status} ${response.ok}`);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error');
        console.log(`[Flixer] Server ${server} error body: ${errorText.substring(0, 200)}`);
        return null;
      }
      
      const data: FlixerApiResponse = await response.json();
      console.log(`[Flixer] Server ${server} data:`, { success: data.success, sourcesCount: data.sources?.length, error: data.error });
      
      if (data.success && data.sources && data.sources.length > 0) {
        // Add server name to each source for identification
        const serverDisplayName = SERVER_NAMES[server] || server;
        return data.sources.map(src => ({
          ...src,
          title: `Flixer ${serverDisplayName}`,
          server: server,
          status: 'working' as const,
        }));
      } else {
        console.log(`[Flixer] Server ${server}: ${data.error || 'No sources'}`);
        return null;
      }
    } catch (e) {
      console.log(`[Flixer] Server ${server} failed:`, e instanceof Error ? e.message : e);
      return null;
    }
  });

  // Wait for all servers to respond
  const results = await Promise.allSettled(serverPromises);
  
  // Collect all successful sources
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      sources.push(...result.value);
    }
  }

  console.log(`[Flixer] Got ${sources.length} sources from ${results.filter(r => r.status === 'fulfilled' && r.value).length} servers`);

  if (sources.length === 0) {
    return { success: false, sources: [], error: 'No working sources available from Flixer' };
  }

  const subtitles = await fetchSubtitles(tmdbId, type, season, episode);
  return { success: true, sources, subtitles: subtitles.length > 0 ? subtitles : undefined };
}

/**
 * Fetch a specific Flixer source by display name
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
    
    const response = await fetch(extractUrl, {
      signal: AbortSignal.timeout(20000),
    });
    
    if (!response.ok) {
      console.error(`[Flixer] fetchFlixerSourceByName: HTTP ${response.status}`);
      return null;
    }
    
    const data: FlixerApiResponse = await response.json();
    
    if (data.success && data.sources && data.sources.length > 0) {
      return data.sources[0];
    }
  } catch (e) {
    console.error('[Flixer] fetchFlixerSourceByName error:', e);
  }

  return null;
}

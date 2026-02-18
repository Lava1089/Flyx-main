/**
 * VidLink Extractor (replaces Videasy)
 * Uses the vidlink.pro API with AES-256-CBC decryption
 * 
 * Decryption flow:
 * 1. Fetch encrypted response from vidlink.pro API
 * 2. Extract IV (first 16 bytes) from the encrypted data
 * 3. AES-256-CBC decrypt with known key → JSON with sources/subtitles
 * 
 * API endpoints:
 * - Movies: https://vidlink.pro/api/b/movie/{tmdbId}
 * - TV: https://vidlink.pro/api/b/tv/{tmdbId}/{season}/{episode}
 * 
 * Per-server endpoints (same server names as old videasy):
 * - https://vidlink.pro/api/b/{server}/sources-with-title?tmdbId=...&mediaType=...&title=...&year=...
 * 
 * The single /api/b/movie|tv endpoint returns the default source.
 * The per-server endpoint lets us pick specific servers (Neon, Sage, etc.)
 */

interface StreamSource {
  quality: string;
  title: string;
  url: string;
  type: 'hls';
  referer: string;
  requiresSegmentProxy: boolean;
  status?: 'working' | 'down' | 'unknown';
  language?: string;
}

interface ExtractionResult {
  success: boolean;
  sources: StreamSource[];
  subtitles?: Array<{ label: string; url: string; language: string }>;
  error?: string;
}

interface VidLinkSource {
  file?: string;
  url?: string;
  type?: string;
  label?: string;
  quality?: string;
}

interface VidLinkResponse {
  sources?: VidLinkSource[];
  subtitles?: Array<{ file?: string; url?: string; label?: string; lang?: string }>;
  tracks?: Array<{ file?: string; url?: string; label?: string; kind?: string }>;
}

// AES-256-CBC decryption key (32 bytes hex-encoded)
const DECRYPTION_KEY = 'c75136c5668bbfe65a7ecad431a745db68b5f381555b38d8f6c699449cf11fcd';

// API Configuration
const VIDLINK_API_BASE = 'https://vidlink.pro/api/b';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://vidlink.pro/',
  'Origin': 'https://vidlink.pro',
  'Connection': 'keep-alive',
};

// Rate limiting
const MIN_DELAY_MS = 300;
const MAX_DELAY_MS = 1500;
const BACKOFF_MULTIPLIER = 1.3;
let lastRequestTime = 0;
let consecutiveFailures = 0;

async function rateLimitDelay(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  const backoffDelay = Math.min(
    MIN_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, consecutiveFailures),
    MAX_DELAY_MS
  );
  const requiredDelay = Math.max(0, backoffDelay - timeSinceLastRequest);
  if (requiredDelay > 0) {
    console.log(`[VidLink] Rate limit delay: ${Math.round(requiredDelay)}ms (failures: ${consecutiveFailures})`);
    await new Promise(resolve => setTimeout(resolve, requiredDelay));
  }
  lastRequestTime = Date.now();
}

// Language display names
export const LANGUAGE_NAMES: Record<string, string> = {
  'en': 'English',
  'de': 'German',
  'it': 'Italian',
  'fr': 'French',
  'es': 'Spanish',
  'es-419': 'Latin Spanish',
  'pt': 'Portuguese',
  'hi': 'Hindi',
};

// Source configurations - all servers available on vidlink.pro
const SOURCES = [
  // English sources (highest priority)
  { name: 'Neon', endpoint: 'myflixerzupcloud', language: 'en', languageName: 'English', priority: 1, movieOnly: false },
  { name: 'Sage', endpoint: '1movies', language: 'en', languageName: 'English', priority: 2, movieOnly: false },
  { name: 'Cypher', endpoint: 'moviebox', language: 'en', languageName: 'English', priority: 3, movieOnly: false },
  { name: 'Yoru', endpoint: 'cdn', language: 'en', languageName: 'English', priority: 4, movieOnly: true },
  { name: 'Reyna', endpoint: 'primewire', language: 'en', languageName: 'English', priority: 5, movieOnly: false },
  { name: 'Omen', endpoint: 'onionplay', language: 'en', languageName: 'English', priority: 6, movieOnly: false },
  { name: 'Breach', endpoint: 'm4uhd', language: 'en', languageName: 'English', priority: 7, movieOnly: false },
  { name: 'Vyse', endpoint: 'hdmovie', language: 'en', languageName: 'English', priority: 8, movieOnly: false },
  // Hindi
  { name: 'Fade', endpoint: 'hdmovie', language: 'hi', languageName: 'Hindi', priority: 9, movieOnly: false, queryParams: 'language=hindi' },
  // German
  { name: 'Killjoy', endpoint: 'meine', language: 'de', languageName: 'German', priority: 10, movieOnly: false, queryParams: 'language=german' },
  // Italian
  { name: 'Harbor', endpoint: 'meine', language: 'it', languageName: 'Italian', priority: 11, movieOnly: false, queryParams: 'language=italian' },
  // French
  { name: 'Chamber', endpoint: 'meine', language: 'fr', languageName: 'French', priority: 12, movieOnly: true, queryParams: 'language=french' },
  // Spanish
  { name: 'Gekko', endpoint: 'cuevana-latino', language: 'es-419', languageName: 'Latin Spanish', priority: 13, movieOnly: false },
  { name: 'Kayo', endpoint: 'cuevana-spanish', language: 'es', languageName: 'Spanish', priority: 14, movieOnly: false },
  // Portuguese
  { name: 'Raze', endpoint: 'superflix', language: 'pt', languageName: 'Portuguese', priority: 15, movieOnly: false },
  { name: 'Phoenix', endpoint: 'overflix', language: 'pt', languageName: 'Portuguese', priority: 16, movieOnly: false },
  { name: 'Astra', endpoint: 'visioncine', language: 'pt', languageName: 'Portuguese', priority: 17, movieOnly: false },
];

// ============================================================================
// AES-256-CBC Decryption
// ============================================================================

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Decrypt VidLink response using AES-256-CBC
 * The encrypted data is base64-encoded: first 16 bytes = IV, rest = ciphertext
 */
async function decryptResponse(encryptedData: string): Promise<VidLinkResponse | null> {
  try {
    let rawBytes: Uint8Array;

    // Try base64 decode first
    if (/^[A-Za-z0-9+/=]+$/.test(encryptedData.trim())) {
      const binaryStr = atob(encryptedData.trim());
      rawBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        rawBytes[i] = binaryStr.charCodeAt(i);
      }
    } else if (/^[0-9a-fA-F]+$/.test(encryptedData.trim())) {
      rawBytes = hexToBytes(encryptedData.trim());
    } else {
      try {
        const padded = encryptedData.trim() + '=='.slice(0, (4 - encryptedData.trim().length % 4) % 4);
        const binaryStr = atob(padded);
        rawBytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          rawBytes[i] = binaryStr.charCodeAt(i);
        }
      } catch {
        console.log('[VidLink] Cannot decode encrypted data - unknown format');
        return null;
      }
    }

    if (rawBytes.length < 32) {
      console.log('[VidLink] Encrypted data too short:', rawBytes.length);
      return null;
    }

    // Extract IV (first 16 bytes) and ciphertext (rest)
    const iv = rawBytes.slice(0, 16);
    const ciphertext = rawBytes.slice(16);

    const keyBytes = hexToBytes(DECRYPTION_KEY);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes.buffer as ArrayBuffer,
      { name: 'AES-CBC' },
      false,
      ['decrypt']
    );

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: iv.buffer as ArrayBuffer },
      cryptoKey,
      ciphertext.buffer as ArrayBuffer
    );

    const decryptedText = new TextDecoder().decode(decryptedBuffer);
    console.log(`[VidLink] Decrypted successfully (${decryptedText.length} chars)`);
    return JSON.parse(decryptedText);
  } catch (error) {
    console.log('[VidLink] Decryption error:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Try to parse response - handles both encrypted and plain JSON responses
 */
async function parseResponse(responseText: string): Promise<VidLinkResponse | null> {
  // Try plain JSON first
  try {
    const parsed = JSON.parse(responseText);
    if (parsed.sources || parsed.tracks || parsed.subtitles) {
      console.log('[VidLink] Response is plain JSON');
      return parsed;
    }
    if (parsed.data && typeof parsed.data === 'string') {
      return await decryptResponse(parsed.data);
    }
    if (parsed.encrypted && typeof parsed.encrypted === 'string') {
      return await decryptResponse(parsed.encrypted);
    }
    return parsed;
  } catch {
    // Not JSON - try decrypting
  }
  return await decryptResponse(responseText);
}

// ============================================================================
// TMDB Helpers
// ============================================================================

async function getTmdbInfo(tmdbId: string, type: 'movie' | 'tv'): Promise<{ title: string; year: string; originalTitle?: string } | null> {
  try {
    const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY;
    if (!apiKey) {
      console.error('[VidLink] TMDB API key not configured');
      return null;
    }

    const url = `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${apiKey}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 86400 },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = await response.json();
    const title = type === 'movie' ? data.title : data.name;
    const originalTitle = type === 'movie' ? data.original_title : data.original_name;
    const dateStr = type === 'movie' ? data.release_date : data.first_air_date;
    const year = dateStr ? dateStr.split('-')[0] : '';

    if (!title || !year) return null;
    return { title, year, originalTitle };
  } catch {
    return null;
  }
}

async function getSeasonFirstEpisode(tmdbId: string, seasonNumber: number): Promise<number> {
  try {
    const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY;
    if (!apiKey) return 1;

    const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?api_key=${apiKey}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, { signal: controller.signal, next: { revalidate: 86400 } });
    clearTimeout(timeoutId);

    if (!response.ok) return 1;
    const data = await response.json();
    if (data.episodes && data.episodes.length > 0) {
      return data.episodes[0].episode_number;
    }
    return 1;
  } catch {
    return 1;
  }
}

// ============================================================================
// API Fetching
// ============================================================================

/**
 * Fetch from VidLink simple API (movie/tv endpoint - returns default source)
 */
async function fetchSimple(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
  retryCount: number = 0
): Promise<string | null> {
  const MAX_RETRIES = 2;
  try {
    await rateLimitDelay();

    const url = type === 'movie'
      ? `${VIDLINK_API_BASE}/movie/${tmdbId}`
      : `${VIDLINK_API_BASE}/tv/${tmdbId}/${season || 1}/${episode || 1}`;

    console.log(`[VidLink] Fetching: ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { headers: HEADERS, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 429) {
      consecutiveFailures++;
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) await new Promise(r => setTimeout(r, parseInt(retryAfter) * 1000 || 5000));
      if (retryCount < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, MIN_DELAY_MS * Math.pow(2, retryCount + 1)));
        return fetchSimple(tmdbId, type, season, episode, retryCount + 1);
      }
      return null;
    }

    if (!response.ok) { consecutiveFailures++; return null; }

    const text = await response.text();
    if (!text || text.trim() === '' || text.trim().startsWith('<')) { consecutiveFailures++; return null; }

    consecutiveFailures = Math.max(0, consecutiveFailures - 1);
    return text;
  } catch (error) {
    consecutiveFailures++;
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('[VidLink] Timeout');
    }
    return null;
  }
}

/**
 * Fetch from VidLink per-server API endpoint
 * URL pattern: /api/b/{server}/sources-with-title?tmdbId=...&mediaType=...&title=...&year=...
 */
async function fetchPerServer(
  endpoint: string,
  tmdbId: string,
  title: string,
  year: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
  queryParams?: string,
  retryCount: number = 0
): Promise<string | null> {
  const MAX_RETRIES = 2;
  try {
    await rateLimitDelay();

    let url = `${VIDLINK_API_BASE}/${endpoint}/sources-with-title?title=${encodeURIComponent(title)}&mediaType=${type}&year=${year}&tmdbId=${tmdbId}`;
    if (type === 'tv' && season !== undefined && episode !== undefined) {
      url += `&seasonId=${season}&episodeId=${episode}`;
    }
    if (queryParams) url += `&${queryParams}`;

    console.log(`[VidLink] Fetching server: ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { headers: HEADERS, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 429) {
      consecutiveFailures++;
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) await new Promise(r => setTimeout(r, parseInt(retryAfter) * 1000 || 5000));
      if (retryCount < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, MIN_DELAY_MS * Math.pow(2, retryCount + 1)));
        return fetchPerServer(endpoint, tmdbId, title, year, type, season, episode, queryParams, retryCount + 1);
      }
      return null;
    }

    if (!response.ok) { consecutiveFailures++; console.log(`[VidLink] ${endpoint}: HTTP ${response.status}`); return null; }

    const text = await response.text();
    if (!text || text.trim() === '' || text.trim().startsWith('<')) { consecutiveFailures++; return null; }

    consecutiveFailures = Math.max(0, consecutiveFailures - 1);
    return text;
  } catch (error) {
    consecutiveFailures++;
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`[VidLink] ${endpoint}: Timeout`);
    } else {
      console.log(`[VidLink] ${endpoint}: Error -`, error);
    }
    return null;
  }
}

// ============================================================================
// Subtitle Extraction
// ============================================================================

function extractSubtitles(data: VidLinkResponse): Array<{ label: string; url: string; language: string }> {
  const subtitles: Array<{ label: string; url: string; language: string }> = [];

  if (data.subtitles) {
    for (const sub of data.subtitles) {
      const subUrl = sub.url || sub.file;
      if (subUrl) {
        subtitles.push({
          label: sub.label || sub.lang || 'Unknown',
          url: subUrl,
          language: sub.lang ||
            (sub.label?.toLowerCase().includes('english') ? 'en' :
              sub.label?.toLowerCase().includes('spanish') ? 'es' :
                sub.label?.toLowerCase().includes('french') ? 'fr' : 'unknown'),
        });
      }
    }
  }

  if (data.tracks) {
    for (const track of data.tracks) {
      if (track.kind === 'captions' || track.kind === 'subtitles' || !track.kind) {
        const trackUrl = track.url || track.file;
        if (trackUrl && !subtitles.find(s => s.url === trackUrl)) {
          subtitles.push({
            label: track.label || 'Unknown',
            url: trackUrl,
            language: track.label?.toLowerCase().includes('english') ? 'en' :
              track.label?.toLowerCase().includes('spanish') ? 'es' :
                track.label?.toLowerCase().includes('french') ? 'fr' : 'unknown',
          });
        }
      }
    }
  }

  return subtitles;
}

// ============================================================================
// Per-Source Extraction (tries a single named server)
// ============================================================================

async function trySource(
  src: typeof SOURCES[0],
  tmdbId: string,
  title: string,
  year: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<{ source: StreamSource; subtitles?: Array<{ label: string; url: string; language: string }> } | null> {
  try {
    if (src.movieOnly && type === 'tv') return null;

    const responseText = await fetchPerServer(
      src.endpoint, tmdbId, title, year, type, season, episode, src.queryParams
    );
    if (!responseText) return null;

    const data = await parseResponse(responseText);
    if (!data) { console.log(`[VidLink] ${src.name}: Decryption failed`); return null; }

    let streamUrl = '';
    if (data.sources && data.sources.length > 0) {
      streamUrl = data.sources[0].url || data.sources[0].file || '';
    }
    if (!streamUrl) { console.log(`[VidLink] ${src.name}: No stream URL`); return null; }

    console.log(`[VidLink] ${src.name}: ✓ Got stream URL`);

    return {
      source: {
        quality: 'auto',
        title: src.name,
        url: streamUrl,
        type: 'hls',
        referer: 'https://vidlink.pro/',
        requiresSegmentProxy: true,
        status: 'working',
        language: src.language,
      },
      subtitles: extractSubtitles(data),
    };
  } catch (error) {
    console.log(`[VidLink] ${src.name}: Error -`, error);
    return null;
  }
}

// ============================================================================
// Main Extraction - Parallel Batch Strategy
// ============================================================================

/**
 * Main extraction function
 * Tries sources in parallel batches for speed:
 *   Batch 1: Top 3 English sources in parallel (fastest path)
 *   Batch 2: Remaining English sources sequentially
 *   Batch 3: Non-English sources sequentially
 * Returns first working source immediately, lists others as "unknown" for manual selection.
 */
export async function extractVidLinkStreams(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
  _includeAllLanguages: boolean = true
): Promise<ExtractionResult> {
  console.log(`[VidLink] Extracting sources for ${type} ID ${tmdbId}...`);

  // Get title and year from TMDB (needed for per-server endpoints)
  const tmdbInfo = await getTmdbInfo(tmdbId, type);

  if (!tmdbInfo) {
    // Fallback: try the simple endpoint that only needs tmdbId
    console.log('[VidLink] TMDB lookup failed, trying simple endpoint...');
    return extractVidLinkSimple(tmdbId, type, season, episode);
  }

  const searchTitle = tmdbInfo.title;
  console.log(`[VidLink] Title: "${searchTitle}", Year: ${tmdbInfo.year}`);

  // For TV: convert absolute episode numbers to relative
  let relativeEpisode = episode;
  if (type === 'tv' && season !== undefined && episode !== undefined) {
    const firstEp = await getSeasonFirstEpisode(tmdbId, season);
    if (firstEp > 1) {
      relativeEpisode = episode - firstEp + 1;
      console.log(`[VidLink] Absolute ep ${episode} → relative ep ${relativeEpisode} (season starts at ${firstEp})`);
    }
  }

  // Filter and sort sources
  const sourcesToTry = SOURCES
    .filter(src => !(src.movieOnly && type === 'tv'))
    .sort((a, b) => a.priority - b.priority);

  let workingSource: StreamSource | null = null;
  let workingSubtitles: Array<{ label: string; url: string; language: string }> = [];
  let workingSourceConfig: typeof SOURCES[0] | null = null;

  const englishSources = sourcesToTry.filter(s => s.language === 'en');
  const otherSources = sourcesToTry.filter(s => s.language !== 'en');

  // Batch 1: Top 3 English sources in parallel
  const batch1 = englishSources.slice(0, 3);
  if (batch1.length > 0) {
    console.log(`[VidLink] Batch 1: ${batch1.map(s => s.name).join(', ')} in parallel...`);
    const results = await Promise.allSettled(
      batch1.map(src => trySource(src, tmdbId, searchTitle, tmdbInfo.year, type, season, relativeEpisode))
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled' && r.value) {
        workingSource = { ...r.value.source, title: `${batch1[i].name} (${batch1[i].languageName})`, language: batch1[i].language, status: 'working' };
        workingSubtitles = r.value.subtitles || [];
        workingSourceConfig = batch1[i];
        console.log(`[VidLink] ✓ ${batch1[i].name} WORKS`);
        break;
      }
    }
  }

  // Batch 2: Remaining English sources sequentially
  if (!workingSource) {
    for (const src of englishSources.slice(3)) {
      const result = await trySource(src, tmdbId, searchTitle, tmdbInfo.year, type, season, relativeEpisode);
      if (result) {
        workingSource = { ...result.source, title: `${src.name} (${src.languageName})`, language: src.language, status: 'working' };
        workingSubtitles = result.subtitles || [];
        workingSourceConfig = src;
        console.log(`[VidLink] ✓ ${src.name} WORKS`);
        break;
      }
    }
  }

  // Batch 3: Non-English sources sequentially
  if (!workingSource) {
    for (const src of otherSources) {
      const result = await trySource(src, tmdbId, searchTitle, tmdbInfo.year, type, season, relativeEpisode);
      if (result) {
        workingSource = { ...result.source, title: `${src.name} (${src.languageName})`, language: src.language, status: 'working' };
        workingSubtitles = result.subtitles || [];
        workingSourceConfig = src;
        console.log(`[VidLink] ✓ ${src.name} WORKS`);
        break;
      }
    }
  }

  // If per-server endpoints all failed, try the simple endpoint as last resort
  if (!workingSource) {
    console.log('[VidLink] All per-server endpoints failed, trying simple endpoint...');
    return extractVidLinkSimple(tmdbId, type, season, episode);
  }

  // Build sources list: working source first, then all others as "unknown"
  const allSources: StreamSource[] = [workingSource];

  for (const src of sourcesToTry) {
    if (src.name === workingSourceConfig!.name) continue;
    allSources.push({
      quality: 'auto',
      title: `${src.name} (${src.languageName})`,
      url: '', // fetched on-demand when user selects
      type: 'hls',
      referer: 'https://vidlink.pro/',
      requiresSegmentProxy: true,
      status: 'unknown',
      language: src.language,
    });
  }

  console.log(`[VidLink] Returning 1 working + ${allSources.length - 1} other options`);

  return {
    success: true,
    sources: allSources,
    subtitles: workingSubtitles.length > 0 ? workingSubtitles : undefined,
  };
}

// ============================================================================
// Simple Extraction (fallback - single endpoint, no TMDB needed)
// ============================================================================

/**
 * Fallback extraction using the simple /api/b/movie|tv endpoint.
 * Used when TMDB lookup fails or per-server endpoints all fail.
 */
async function extractVidLinkSimple(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
): Promise<ExtractionResult> {
  const responseText = await fetchSimple(tmdbId, type, season, episode);

  if (!responseText) {
    return { success: false, sources: [], error: 'Failed to fetch from VidLink API' };
  }

  const data = await parseResponse(responseText);
  if (!data) {
    return { success: false, sources: [], error: 'Failed to decrypt VidLink response' };
  }

  const sources: StreamSource[] = [];
  if (data.sources && data.sources.length > 0) {
    for (let i = 0; i < data.sources.length; i++) {
      const src = data.sources[i];
      const streamUrl = src.url || src.file || '';
      if (!streamUrl) continue;
      sources.push({
        quality: src.quality || src.label || 'auto',
        title: src.label || `Source ${i + 1}`,
        url: streamUrl,
        type: 'hls',
        referer: 'https://vidlink.pro/',
        requiresSegmentProxy: true,
        status: 'working',
        language: 'en',
      });
    }
  }

  if (sources.length === 0) {
    return { success: false, sources: [], error: 'No stream URLs in VidLink response' };
  }

  return {
    success: true,
    sources,
    subtitles: extractSubtitles(data),
  };
}

// ============================================================================
// Fetch Specific Source By Name (for manual source selection in UI)
// ============================================================================

/**
 * Fetch a specific source by name - used when user manually selects a source from the menu
 */
export async function fetchVidLinkSourceByName(
  sourceName: string,
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<StreamSource | null> {
  console.log(`[VidLink] Fetching specific source: ${sourceName}`);

  // Find the source config by name (handle "Neon (English)" format)
  const cleanName = sourceName.split(' (')[0];
  const srcConfig = SOURCES.find(s => s.name === cleanName || s.name === sourceName);

  if (!srcConfig) {
    // No matching server - fall back to simple endpoint
    console.log(`[VidLink] Unknown source "${sourceName}", using simple endpoint`);
    const result = await extractVidLinkSimple(tmdbId, type, season, episode);
    return result.sources[0] || null;
  }

  // Get TMDB info for per-server endpoint
  const tmdbInfo = await getTmdbInfo(tmdbId, type);
  if (!tmdbInfo) {
    console.log('[VidLink] TMDB lookup failed, using simple endpoint');
    const result = await extractVidLinkSimple(tmdbId, type, season, episode);
    return result.sources[0] || null;
  }

  // Convert absolute episode to relative
  let relativeEpisode = episode;
  if (type === 'tv' && season !== undefined && episode !== undefined) {
    const firstEp = await getSeasonFirstEpisode(tmdbId, season);
    if (firstEp > 1) {
      relativeEpisode = episode - firstEp + 1;
    }
  }

  const result = await trySource(srcConfig, tmdbId, tmdbInfo.title, tmdbInfo.year, type, season, relativeEpisode);

  if (result) {
    return {
      ...result.source,
      title: `${srcConfig.name} (${srcConfig.languageName})`,
      language: srcConfig.language,
      status: 'working',
    };
  }

  console.log(`[VidLink] ✗ ${srcConfig.name} failed`);
  return null;
}

// Export for testing
export { SOURCES as VIDLINK_SOURCES };

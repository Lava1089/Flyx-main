/**
 * Videasy Extractor
 * Uses the videasy.net API with handrolled WASM + CryptoJS AES decryption
 * 
 * Decryption flow (reverse-engineered from player.videasy.net):
 * 1. Fetch encrypted hex data from api.videasy.net
 * 2. WASM decrypt(encryptedHex, tmdbId) → base64 CryptoJS ciphertext
 * 3. CryptoJS.AES.decrypt(wasmResult, "") → JSON with sources/subtitles
 * 
 * The WASM module is patched to bypass the serve()/verify() anti-tamper check.
 * The AES key is empty string because Hashids.encode(hexString) returns "".
 * 
 * Servers available:
 * - Neon (myflixerzupcloud) - Original language
 * - Sage (1movies) - Original language
 * - Cypher (moviebox) - Original language
 * - Yoru (cdn) - Original language, MOVIE ONLY
 * - Reyna (primewire) - Original language
 * - Omen (onionplay) - Original language
 * - Breach (m4uhd) - Original language
 * - Vyse (hdmovie) - Original language
 * - Killjoy (meine?language=german) - German
 * - Harbor (meine?language=italian) - Italian
 * - Chamber (meine?language=french) - French, MOVIE ONLY
 * - Fade (hdmovie) - Hindi
 * - Gekko (cuevana-latino) - Latin
 * - Kayo (cuevana-spanish) - Spanish
 * - Raze (superflix) - Portuguese
 * - Phoenix (overflix) - Portuguese
 * - Astra (visioncine) - Portuguese
 */

import CryptoJS from 'crypto-js';
import * as fs from 'fs';
import * as path from 'path';

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

interface VideasySource {
  file?: string;
  url?: string;
  type?: string;
  label?: string;
  quality?: string;
}

interface VideasyResponse {
  sources?: VideasySource[];
  subtitles?: Array<{ file?: string; url?: string; label?: string; lang?: string }>;
  tracks?: Array<{ file?: string; url?: string; label?: string; kind?: string }>;
}

// API Configuration
const VIDEASY_API_BASE = 'https://api.videasy.net';
const VIDEASY_API_BASE_ALT = 'https://api2.videasy.net';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Connection': 'keep-alive',
};

// Rate limiting configuration
const MIN_DELAY_MS = 400;  // Minimum delay between requests (reduced for parallel batching)
const MAX_DELAY_MS = 1500; // Maximum delay for backoff
const BACKOFF_MULTIPLIER = 1.3; // Exponential backoff multiplier

// Track rate limit state
let lastRequestTime = 0;
let consecutiveFailures = 0;

/**
 * Delay with exponential backoff based on consecutive failures
 */
async function rateLimitDelay(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  // Calculate delay with exponential backoff
  const backoffDelay = Math.min(
    MIN_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, consecutiveFailures),
    MAX_DELAY_MS
  );
  
  // Ensure minimum time between requests
  const requiredDelay = Math.max(0, backoffDelay - timeSinceLastRequest);
  
  if (requiredDelay > 0) {
    console.log(`[Videasy] Rate limit delay: ${Math.round(requiredDelay)}ms (failures: ${consecutiveFailures})`);
    await new Promise(resolve => setTimeout(resolve, requiredDelay));
  }
  
  lastRequestTime = Date.now();
}

// Language display names for UI (exported for use in other components)
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

// Source configurations - ALL sources for multi-language support
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

/**
 * Fetch encrypted data from Videasy API with rate limiting
 */
async function fetchFromVideasy(
  endpoint: string,
  tmdbId: string,
  title: string,
  year: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
  queryParams?: string,
  useAltApi: boolean = false,
  retryCount: number = 0
): Promise<string | null> {
  const MAX_RETRIES = 2;
  
  try {
    // Apply rate limiting delay before each request
    await rateLimitDelay();
    
    const baseUrl = useAltApi ? VIDEASY_API_BASE_ALT : VIDEASY_API_BASE;
    
    // Build URL
    let url = `${baseUrl}/${endpoint}/sources-with-title?title=${encodeURIComponent(title)}&mediaType=${type}&year=${year}&tmdbId=${tmdbId}`;
    
    if (type === 'tv' && season !== undefined && episode !== undefined) {
      url += `&seasonId=${season}&episodeId=${episode}`;
    }
    
    if (queryParams) {
      url += `&${queryParams}`;
    }

    console.log(`[Videasy] Fetching: ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle rate limiting (429)
    if (response.status === 429) {
      consecutiveFailures++;
      console.log(`[Videasy] ${endpoint}: HTTP 429 (rate limited), failures: ${consecutiveFailures}`);
      
      // Check for Retry-After header
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) {
        const waitTime = parseInt(retryAfter) * 1000 || 5000;
        console.log(`[Videasy] Retry-After header: waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      // Retry with exponential backoff
      if (retryCount < MAX_RETRIES) {
        const backoffWait = MIN_DELAY_MS * Math.pow(2, retryCount + 1);
        console.log(`[Videasy] Retrying ${endpoint} after ${backoffWait}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, backoffWait));
        return fetchFromVideasy(endpoint, tmdbId, title, year, type, season, episode, queryParams, useAltApi, retryCount + 1);
      }
      
      return null;
    }

    if (!response.ok) {
      consecutiveFailures++;
      console.log(`[Videasy] ${endpoint}: HTTP ${response.status}`);
      return null;
    }

    const text = await response.text();
    
    if (!text || text.trim() === '') {
      consecutiveFailures++;
      console.log(`[Videasy] ${endpoint}: Empty response`);
      return null;
    }

    // Only reject if the response is clearly an error page (HTML error), not JSON with error field
    if (text.trim().startsWith('<') || text.trim().startsWith('<!')) {
      consecutiveFailures++;
      console.log(`[Videasy] ${endpoint}: Got HTML error page instead of data`);
      return null;
    }

    // Success - reset failure counter
    consecutiveFailures = Math.max(0, consecutiveFailures - 1);
    return text;
  } catch (error) {
    consecutiveFailures++;
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`[Videasy] ${endpoint}: Timeout`);
    } else {
      console.log(`[Videasy] ${endpoint}: Error -`, error);
    }
    return null;
  }
}

// ============================================================================
// WASM-based Decryption (handrolled - no external services)
// ============================================================================

// Cached WASM instance for reuse across requests
let wasmInstance: any = null;
let wasmMemory: WebAssembly.Memory | null = null;
let wasmModule: WebAssembly.Module | null = null;
let wasmDecryptCount = 0;
const WASM_RECYCLE_AFTER = 50; // Recycle instance after N decryptions to prevent memory bloat

/**
 * Load and cache the patched WASM module
 * The WASM is patched to bypass serve()/verify() anti-tamper checks
 */
async function getWasmInstance(): Promise<{ decrypt: Function; memory: WebAssembly.Memory; __new: Function }> {
  // Recycle instance periodically to prevent memory bloat
  if (wasmInstance && wasmDecryptCount >= WASM_RECYCLE_AFTER) {
    console.log('[Videasy] Recycling WASM instance after', wasmDecryptCount, 'decryptions');
    wasmInstance = null;
    wasmMemory = null;
    wasmDecryptCount = 0;
  }
  
  if (wasmInstance) return wasmInstance;

  // Compile module once, reuse for instantiation
  if (!wasmModule) {
    const wasmPath = path.join(process.cwd(), 'public', 'videasy-module-patched.wasm');
    const wasmBuffer = fs.readFileSync(wasmPath);
    wasmModule = await WebAssembly.compile(wasmBuffer);
    console.log('[Videasy] WASM module compiled');
  }

  const instance = await WebAssembly.instantiate(wasmModule, {
    env: {
      seed: () => Date.now() * Math.random(),
      abort: (msgPtr: number) => {
        // Read abort message from WASM memory for debugging
        if (msgPtr && instance.exports.memory) {
          const mem = instance.exports.memory as WebAssembly.Memory;
          const dv = new DataView(mem.buffer);
          const len = dv.getUint32(msgPtr - 4, true);
          let msg = '';
          for (let i = 0; i < Math.min(len, 200); i += 2) {
            msg += String.fromCharCode(dv.getUint16(msgPtr + i, true));
          }
          throw new Error(`WASM abort: ${msg}`);
        }
        throw new Error('WASM abort');
      }
    }
  });

  wasmMemory = instance.exports.memory as WebAssembly.Memory;
  wasmInstance = {
    decrypt: instance.exports.decrypt,
    memory: wasmMemory,
    __new: instance.exports.__new,
  };

  console.log('[Videasy] WASM module loaded successfully');
  return wasmInstance;
}

/**
 * Write a JS string into WASM memory (AssemblyScript UTF-16 format)
 */
function wasmWriteString(wasm: { memory: WebAssembly.Memory; __new: Function }, str: string): number {
  const len = str.length;
  const ptr = (wasm.__new(len << 1, 2) as number) >>> 0;
  const arr = new Uint16Array(wasm.memory.buffer);
  for (let i = 0; i < len; ++i) {
    arr[(ptr >>> 1) + i] = str.charCodeAt(i);
  }
  return ptr;
}

/**
 * Read a string from WASM memory (AssemblyScript UTF-16 format)
 */
function wasmReadString(wasm: { memory: WebAssembly.Memory }, ptr: number): string | null {
  if (!ptr) return null;
  const end = ptr + (new Uint32Array(wasm.memory.buffer)[(ptr - 4) >>> 2] >>> 1);
  const arr = new Uint16Array(wasm.memory.buffer);
  let start = ptr >>> 1;
  let result = '';
  while (end - start > 1024) {
    result += String.fromCharCode(...arr.subarray(start, start += 1024));
  }
  return result + String.fromCharCode(...arr.subarray(start, end));
}

/**
 * Decrypt Videasy response using handrolled WASM + CryptoJS AES
 * 
 * Flow: WASM decrypt(hex, tmdbId) → CryptoJS.AES.decrypt(result, "") → JSON
 */
async function decryptVideasyResponse(encryptedText: string, tmdbId: string): Promise<VideasyResponse | null> {
  try {
    console.log(`[Videasy] Decrypting response (${encryptedText.length} chars) with WASM...`);

    const wasm = await getWasmInstance();
    wasmDecryptCount++;

    // Layer 1: WASM decrypt (hex → base64 ciphertext)
    // The WASM decrypt takes a string pointer and tmdbId as a raw number
    const encPtr = wasmWriteString(wasm, encryptedText);
    const tmdbIdNum = parseInt(tmdbId, 10);
    const resultPtr = (wasm.decrypt(encPtr, tmdbIdNum) as number) >>> 0;
    const wasmResult = wasmReadString(wasm, resultPtr);

    if (!wasmResult) {
      console.log('[Videasy] WASM decrypt returned null');
      return null;
    }

    // Verify it's a valid CryptoJS base64 string (starts with "U2FsdGVk" = "Salted__")
    if (!wasmResult.startsWith('U2FsdGVk')) {
      console.log('[Videasy] WASM result is not CryptoJS format, first 50:', wasmResult.substring(0, 50));
      return null;
    }

    // Layer 2: CryptoJS AES decrypt with empty key
    // The key is empty because Hashids.encode(hexString) returns "" for non-numeric strings
    const decryptedStr = CryptoJS.AES.decrypt(wasmResult, '').toString(CryptoJS.enc.Utf8);

    if (!decryptedStr) {
      console.log('[Videasy] CryptoJS AES decrypt returned empty');
      return null;
    }

    console.log(`[Videasy] Decrypted successfully (${decryptedStr.length} chars)`);

    // Parse JSON
    const decrypted: VideasyResponse = JSON.parse(decryptedStr);
    return decrypted;
  } catch (error) {
    console.log('[Videasy] Decryption error:', error instanceof Error ? error.message : error);
    
    // If WASM instance is corrupted, reset it for next attempt
    wasmInstance = null;
    wasmMemory = null;
    
    return null;
  }
}

/**
 * Get the first episode number of a season from TMDB
 * This is needed because some shows (like One Piece) have absolute episode numbers
 * e.g., Season 2 starts at episode 62, not episode 1
 */
async function getSeasonFirstEpisode(tmdbId: string, seasonNumber: number): Promise<number> {
  try {
    const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY;
    if (!apiKey) return 1;

    const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?api_key=${apiKey}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 86400 },
    });

    clearTimeout(timeoutId);

    if (!response.ok) return 1;

    const data = await response.json();
    
    // Get the first episode's episode_number
    if (data.episodes && data.episodes.length > 0) {
      const firstEpNum = data.episodes[0].episode_number;
      console.log(`[Videasy] Season ${seasonNumber} first episode number: ${firstEpNum}`);
      return firstEpNum;
    }
    
    return 1;
  } catch {
    return 1;
  }
}

/**
 * Get title and year from TMDB
 * Uses original_title/original_name to avoid remakes being matched incorrectly
 */
async function getTmdbInfo(tmdbId: string, type: 'movie' | 'tv'): Promise<{ title: string; year: string; originalTitle?: string } | null> {
  try {
    const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY;
    if (!apiKey) {
      console.error('[Videasy] TMDB API key not configured');
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

    if (!response.ok) {
      console.log(`[Videasy] TMDB lookup failed: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    // Get both localized and original titles
    const title = type === 'movie' ? data.title : data.name;
    const originalTitle = type === 'movie' ? data.original_title : data.original_name;
    const dateStr = type === 'movie' ? data.release_date : data.first_air_date;
    const year = dateStr ? dateStr.split('-')[0] : '';

    if (!title || !year) {
      console.log('[Videasy] Missing title or year from TMDB');
      return null;
    }

    // Log if original title differs (helps debug remake issues)
    if (originalTitle && originalTitle !== title) {
      console.log(`[Videasy] Original title differs: "${originalTitle}" vs "${title}"`);
    }

    return { title, year, originalTitle };
  } catch (error) {
    console.log('[Videasy] TMDB lookup error:', error);
    return null;
  }
}

/**
 * Try to extract from a single source
 */
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
    console.log(`[Videasy] Trying ${src.name} (${src.endpoint})...`);

    // Skip movie-only sources for TV shows
    if (src.movieOnly && type === 'tv') {
      console.log(`[Videasy] ${src.name}: Skipping (movie only)`);
      return null;
    }

    // Fetch encrypted data
    const encryptedData = await fetchFromVideasy(
      src.endpoint,
      tmdbId,
      title,
      year,
      type,
      season,
      episode,
      src.queryParams
    );

    if (!encryptedData) {
      console.log(`[Videasy] ${src.name}: No data returned`);
      return null;
    }

    // Decrypt the response
    const decrypted = await decryptVideasyResponse(encryptedData, tmdbId);

    if (!decrypted) {
      console.log(`[Videasy] ${src.name}: Decryption failed`);
      return null;
    }

    // Extract stream URL (API returns 'url' not 'file')
    let streamUrl = '';
    if (decrypted.sources && decrypted.sources.length > 0) {
      streamUrl = decrypted.sources[0].url || decrypted.sources[0].file || '';
    }

    if (!streamUrl) {
      console.log(`[Videasy] ${src.name}: No stream URL in response`);
      return null;
    }

    console.log(`[Videasy] ${src.name}: ✓ Got stream URL`);

    // Extract subtitles (check both 'subtitles' and 'tracks' arrays)
    const subtitles: Array<{ label: string; url: string; language: string }> = [];
    
    // Check subtitles array first
    if (decrypted.subtitles && decrypted.subtitles.length > 0) {
      for (const sub of decrypted.subtitles) {
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
    
    // Also check tracks array
    if (decrypted.tracks) {
      for (const track of decrypted.tracks) {
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

    return {
      source: {
        quality: 'auto',
        title: src.name,
        url: streamUrl,
        type: 'hls',
        referer: 'https://videasy.net/',
        requiresSegmentProxy: true,
        status: 'working',
        language: src.language,
      },
      subtitles: subtitles.length > 0 ? subtitles : undefined,
    };
  } catch (error) {
    console.log(`[Videasy] ${src.name}: Error -`, error);
    return null;
  }
}

/**
 * Main extraction function - tries sources ONE AT A TIME until finding a working one
 * Returns immediately with the first working source for fast playback
 * Other sources are listed as "unknown" status for the user to try manually
 */
export async function extractVideasyStreams(
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
  _includeAllLanguages: boolean = true
): Promise<ExtractionResult> {
  console.log(`[Videasy] Extracting sources for ${type} ID ${tmdbId}...`);

  // Get title and year from TMDB
  const tmdbInfo = await getTmdbInfo(tmdbId, type);
  
  if (!tmdbInfo) {
    return {
      success: false,
      sources: [],
      error: 'Failed to get title/year from TMDB',
    };
  }

  // ALWAYS use the English/localized title first since Videasy is English-language.
  // The original_title can be in Korean/Japanese/etc which Videasy won't match.
  // The tmdbId parameter is the primary key for matching - title is supplementary.
  const searchTitle = tmdbInfo.title;
  
  console.log(`[Videasy] Title: "${searchTitle}"${tmdbInfo.originalTitle && tmdbInfo.originalTitle !== tmdbInfo.title ? ` (original: "${tmdbInfo.originalTitle}")` : ''}, Year: ${tmdbInfo.year}`);

  // For TV shows, calculate the relative episode number within the season
  // TMDB returns absolute episode numbers for some shows (e.g., One Piece S2E62)
  // but Videasy expects relative episode numbers (e.g., S2E1)
  let relativeEpisode = episode;
  if (type === 'tv' && season !== undefined && episode !== undefined) {
    const firstEpisodeOfSeason = await getSeasonFirstEpisode(tmdbId, season);
    if (firstEpisodeOfSeason > 1) {
      // This season uses absolute episode numbers, convert to relative
      relativeEpisode = episode - firstEpisodeOfSeason + 1;
      console.log(`[Videasy] Converting absolute episode ${episode} to relative episode ${relativeEpisode} (season starts at ${firstEpisodeOfSeason})`);
    }
  }

  // Filter sources based on type
  let sourcesToTry = SOURCES.filter(src => {
    // Skip movie-only sources for TV
    if (src.movieOnly && type === 'tv') return false;
    return true;
  });

  // Sort by priority (English first, then other languages)
  sourcesToTry.sort((a, b) => a.priority - b.priority);

  console.log(`[Videasy] Will try ${sourcesToTry.length} sources (parallel batch + sequential fallback)...`);

  // Try sources in parallel batches for speed
  // Batch 1: Top 3 English sources in parallel (fastest path)
  // If none work, Batch 2: remaining English sources
  // If none work, Batch 3: non-English sources (only if user wants all languages)
  let workingSource: StreamSource | null = null;
  let workingSubtitles: Array<{ label: string; url: string; language: string }> = [];
  let workingSourceConfig: typeof SOURCES[0] | null = null;

  const englishSources = sourcesToTry.filter(s => s.language === 'en');
  const otherSources = sourcesToTry.filter(s => s.language !== 'en');

  // Batch 1: Try top 3 English sources in parallel
  const batch1 = englishSources.slice(0, 3);
  if (batch1.length > 0) {
    console.log(`[Videasy] Batch 1: Trying ${batch1.map(s => s.name).join(', ')} in parallel...`);
    const batch1Results = await Promise.allSettled(
      batch1.map(src => trySource(src, tmdbId, searchTitle, tmdbInfo.year, type, season, relativeEpisode))
    );
    
    for (let i = 0; i < batch1Results.length; i++) {
      const result = batch1Results[i];
      if (result.status === 'fulfilled' && result.value) {
        const src = batch1[i];
        console.log(`[Videasy] ✓ ${src.name} (${src.languageName}) WORKS!`);
        workingSource = {
          ...result.value.source,
          title: `${src.name} (${src.languageName})`,
          language: src.language,
          status: 'working',
        };
        workingSubtitles = result.value.subtitles || [];
        workingSourceConfig = src;
        break;
      }
    }
  }

  // Batch 2: Try remaining English sources sequentially (if batch 1 failed)
  if (!workingSource) {
    const batch2 = englishSources.slice(3);
    for (const src of batch2) {
      console.log(`[Videasy] Trying ${src.name} (${src.languageName})...`);
      const result = await trySource(src, tmdbId, searchTitle, tmdbInfo.year, type, season, relativeEpisode);
      if (result) {
        console.log(`[Videasy] ✓ ${src.name} (${src.languageName}) WORKS!`);
        workingSource = {
          ...result.source,
          title: `${src.name} (${src.languageName})`,
          language: src.language,
          status: 'working',
        };
        workingSubtitles = result.subtitles || [];
        workingSourceConfig = src;
        break;
      }
    }
  }

  // Batch 3: Try non-English sources sequentially (if all English failed)
  if (!workingSource) {
    for (const src of otherSources) {
      console.log(`[Videasy] Trying ${src.name} (${src.languageName})...`);
      const result = await trySource(src, tmdbId, searchTitle, tmdbInfo.year, type, season, relativeEpisode);
      if (result) {
        console.log(`[Videasy] ✓ ${src.name} (${src.languageName}) WORKS!`);
        workingSource = {
          ...result.source,
          title: `${src.name} (${src.languageName})`,
          language: src.language,
          status: 'working',
        };
        workingSubtitles = result.subtitles || [];
        workingSourceConfig = src;
        break;
      }
    }
  }

  if (!workingSource || !workingSourceConfig) {
    console.error('[Videasy] All sources failed');
    return {
      success: false,
      sources: [],
      error: 'All Videasy sources unavailable',
    };
  }

  // Build the sources list: working source first, then all others as "unknown" status
  // This lets the user try other sources/languages manually from the menu
  const allSources: StreamSource[] = [workingSource];
  
  for (const src of sourcesToTry) {
    // Skip the one we already added as working
    if (src.name === workingSourceConfig.name) continue;
    
    // Add other sources as "unknown" - user can try them manually
    allSources.push({
      quality: 'auto',
      title: `${src.name} (${src.languageName})`,
      url: '', // Empty URL - will be fetched when user selects
      type: 'hls',
      referer: 'https://videasy.net/',
      requiresSegmentProxy: true,
      status: 'unknown',
      language: src.language,
    });
  }

  console.log(`[Videasy] Returning 1 working source + ${allSources.length - 1} other options`);
  
  return {
    success: true,
    sources: allSources,
    subtitles: workingSubtitles.length > 0 ? workingSubtitles : undefined,
  };
}

/**
 * Fetch a specific source by name - used when user manually selects a source from the menu
 */
export async function fetchVideasySourceByName(
  sourceName: string,
  tmdbId: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): Promise<StreamSource | null> {
  console.log(`[Videasy] Fetching specific source: ${sourceName}`);

  // Find the source config
  const srcConfig = SOURCES.find(s => s.name === sourceName || s.name === sourceName.split(' (')[0]);
  if (!srcConfig) {
    console.error(`[Videasy] Unknown source: ${sourceName}`);
    return null;
  }

  // Get title and year from TMDB
  const tmdbInfo = await getTmdbInfo(tmdbId, type);
  if (!tmdbInfo) {
    console.error('[Videasy] Failed to get TMDB info');
    return null;
  }

  // ALWAYS use the English/localized title - Videasy is English-language
  const searchTitle = tmdbInfo.title;

  // For TV shows, calculate the relative episode number within the season
  let relativeEpisode = episode;
  if (type === 'tv' && season !== undefined && episode !== undefined) {
    const firstEpisodeOfSeason = await getSeasonFirstEpisode(tmdbId, season);
    if (firstEpisodeOfSeason > 1) {
      relativeEpisode = episode - firstEpisodeOfSeason + 1;
      console.log(`[Videasy] Converting absolute episode ${episode} to relative episode ${relativeEpisode}`);
    }
  }

  // Try the source with relative episode number and original title
  const result = await trySource(srcConfig, tmdbId, searchTitle, tmdbInfo.year, type, season, relativeEpisode);
  
  if (result) {
    console.log(`[Videasy] ✓ ${srcConfig.name} fetched successfully`);
    return {
      ...result.source,
      title: `${srcConfig.name} (${srcConfig.languageName})`,
      language: srcConfig.language,
      status: 'working',
    };
  }

  console.log(`[Videasy] ✗ ${srcConfig.name} failed`);
  return null;
}

// Export for testing
export { SOURCES as VIDEASY_SOURCES };

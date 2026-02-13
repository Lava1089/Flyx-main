'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import type { MediaItem, Season } from '@/types/media';
import type { MALAnimeDetails } from '@/lib/services/mal';
import { ParallaxContainer } from '@/components/ui/ParallaxContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { FluidButton } from '@/components/ui/FluidButton';
import { WatchlistButton } from '@/components/ui/WatchlistButton';
import { SeasonSelector } from './SeasonSelector';
import { AnimeSeasonSelector, type AnimeEntry } from './AnimeSeasonSelector';
import { EpisodeList } from './EpisodeList';
import { usePresenceContext } from '@/components/analytics/PresenceProvider';
import { shouldReduceAnimations } from '@/lib/utils/performance';

import styles from './DetailsPage.module.css';

// Anime that use ABSOLUTE episode numbering on TMDB (single season with all episodes)
// For these, we need to calculate which MAL entry an episode belongs to
const TMDB_ABSOLUTE_EPISODE_ANIME: Record<number, Array<{ malId: number; episodes: number; title: string }>> = {
  // JJK: TMDB shows as 1 season with 71 episodes (as of Jan 2026)
  // Episodes 1-24 = MAL 40748, 25-47 = MAL 51009, 48-59 = MAL 57658 (Part 1 - 12 eps)
  95479: [
    { malId: 40748, episodes: 24, title: 'Jujutsu Kaisen' },
    { malId: 51009, episodes: 23, title: 'Jujutsu Kaisen 2nd Season' },
    { malId: 57658, episodes: 12, title: 'Jujutsu Kaisen: The Culling Game - Part 1' },
  ],
};

function getMALEntryForAbsoluteEpisode(
  tmdbId: number,
  absoluteEpisode: number
): { malId: number; malTitle: string; relativeEpisode: number } | null {
  const entries = TMDB_ABSOLUTE_EPISODE_ANIME[tmdbId];
  if (!entries || entries.length === 0) return null;
  
  let episodeOffset = 0;
  for (const entry of entries) {
    if (absoluteEpisode <= episodeOffset + entry.episodes) {
      const relativeEpisode = absoluteEpisode - episodeOffset;
      console.log(`[DetailsPage] Absolute ep ${absoluteEpisode} → ${entry.title} ep ${relativeEpisode}`);
      return { malId: entry.malId, malTitle: entry.title, relativeEpisode };
    }
    episodeOffset += entry.episodes;
  }
  
  // Episode beyond known entries - use last entry
  const lastEntry = entries[entries.length - 1];
  const relativeEpisode = absoluteEpisode - episodeOffset + lastEntry.episodes;
  return { malId: lastEntry.malId, malTitle: lastEntry.title, relativeEpisode };
}

function usesAbsoluteEpisodeNumbering(tmdbId: number): boolean {
  return tmdbId in TMDB_ABSOLUTE_EPISODE_ANIME;
}

// Related Content Section with horizontal scroll and navigation buttons
function RelatedContentSection({
  items,
  onItemSelect,
  reduceMotion = true
}: {
  items: MediaItem[];
  onItemSelect: (id: string) => void;
  reduceMotion?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 600;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  return (
    <section className="py-12 px-6">
      <div className="container mx-auto">
        <div>
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
              <span className="text-3xl">✨</span>
              <span>You May Also Like</span>
            </h2>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => scroll('left')}
                className="w-16 h-16 bg-gradient-to-r from-purple-600/20 to-pink-600/20 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:from-purple-600/30 hover:to-pink-600/30 transition-all duration-300 border border-white/20 shadow-xl active:scale-90"
                data-tv-skip="true"
                tabIndex={-1}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => scroll('right')}
                className="w-16 h-16 bg-gradient-to-r from-purple-600/20 to-pink-600/20 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:from-purple-600/30 hover:to-pink-600/30 transition-all duration-300 border border-white/20 shadow-xl active:scale-90"
                data-tv-skip="true"
                tabIndex={-1}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                </svg>
              </button>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="flex gap-6 overflow-x-auto scrollbar-hide pb-8 pt-4 px-2"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            data-tv-scroll-container="true"
            data-tv-group="related-content"
          >
            {items.map((item) => (
              <div
                key={item.id}
                onClick={() => onItemSelect(String(item.id))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onItemSelect(String(item.id));
                  }
                }}
                className="flex-shrink-0 w-48 md:w-56 cursor-pointer group p-2"
                data-tv-focusable="true"
                tabIndex={0}
                role="button"
                aria-label={`${item.title || item.name}`}
              >
                <div className={`relative rounded-xl bg-gray-800 shadow-2xl overflow-hidden ${reduceMotion ? '' : 'hover:scale-105 hover:-translate-y-2'} transition-transform duration-300`}>
                  <div className="overflow-hidden rounded-xl">
                    <img
                      src={item.posterPath || `https://image.tmdb.org/t/p/w500${item.poster_path || ''}`}
                      alt={item.title || item.name || 'Content'}
                      className={`w-full h-72 md:h-80 object-cover ${reduceMotion ? '' : 'group-hover:scale-110'} transition-transform duration-500`}
                      loading="lazy"
                    />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                  {/* Play Button Overlay */}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none">
                    <div className="w-16 h-16 bg-gradient-to-r from-purple-600/80 to-pink-600/80 backdrop-blur-md rounded-full flex items-center justify-center shadow-2xl border border-white/20">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="white" strokeWidth="0">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>

                  {/* Rating Badge */}
                  <div className="absolute top-3 right-3 px-2 py-1 bg-gradient-to-r from-yellow-500/90 to-orange-500/90 backdrop-blur-md rounded-full text-white text-xs font-bold flex items-center gap-1 shadow-lg border border-white/20">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    {(item.vote_average || item.rating || 0).toFixed(1)}
                  </div>
                </div>

                <div className="p-3">
                  <h3 className="text-white font-semibold text-base mb-1 line-clamp-2">
                    {item.title || item.name || 'Untitled'}
                  </h3>
                  <p className="text-gray-400 text-sm">
                    {new Date(item.release_date || item.first_air_date || item.releaseDate || '').getFullYear() || ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// Note: Removed prefetch to avoid duplicate requests
// SimpleVideoPlayer will handle stream extraction when user clicks "Watch Now"

interface DetailsPageClientProps {
  content: MediaItem | null;
  relatedContent: MediaItem[];
  error: string | null;
}

/**
 * DetailsPageClient - Client-side details page component
 * Features:
 * - Parallax hero section with backdrop
 * - Metadata display (title, description, ratings, cast, genres)
 * - Season and episode selection for TV shows
 * - Related content recommendations
 * - Watch Now button with smooth transition
 */
export default function DetailsPageClient({
  content,
  relatedContent,
  error,
}: DetailsPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presenceContext = usePresenceContext();
  
  // Get season from URL params (for returning from watch page)
  const seasonFromUrl = searchParams.get('season');
  const initialSeason = seasonFromUrl ? parseInt(seasonFromUrl) : 1;
  
  const [selectedSeason, setSelectedSeason] = useState<number>(initialSeason);
  const [seasonData, setSeasonData] = useState<Season | null>(null);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [episodeProgress, setEpisodeProgress] = useState<Record<number, number>>({});
  const [reduceMotion, setReduceMotion] = useState(true);
  
  // Check for reduced motion on mount
  useEffect(() => {
    setReduceMotion(shouldReduceAnimations());
  }, []);
  
  // MAL-specific state for anime
  const [isAnime, setIsAnime] = useState<boolean>(false);
  const [malData, setMalData] = useState<MALAnimeDetails | null>(null);
  const [loadingMAL, setLoadingMAL] = useState<boolean>(false);
  
  // For anime with MAL mappings: list of all MAL entries and currently selected one
  const [animeEntries, setAnimeEntries] = useState<AnimeEntry[]>([]);
  const [selectedMalId, setSelectedMalId] = useState<number | null>(null);
  
  // For anime: maps TMDB season to MAL parts (e.g., TMDB S2 -> MAL Part 1, 2, 3)
  // Structure: { tmdbSeason: number, malParts: MALSeason[], tmdbEpisodes: Episode[] }
  const [animeSeasonMapping, setAnimeSeasonMapping] = useState<{
    tmdbSeason: number;
    malParts: any[];
    tmdbEpisodes: any[];
  } | null>(null);
  
  // Track browsing activity with content title - only when content changes
  useEffect(() => {
    if (content && presenceContext?.setBrowsingContext) {
      const title = content.title || content.name || 'Unknown';
      presenceContext.setBrowsingContext(
        `Viewing: ${title}`,
        title,
        String(content.id),
        content.mediaType as 'movie' | 'tv'
      );
    }
  }, [content?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check if content is anime and fetch MAL data
  // Re-fetch when season changes because different seasons may have different MAL entries
  // Also check for movies - anime movies need MAL routing too
  useEffect(() => {
    if (content?.mediaType === 'tv' || content?.mediaType === 'movie') {
      checkAndLoadMALData();
    }
  }, [content?.id, selectedSeason]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkAndLoadMALData = async () => {
    if (!content) return;
    
    setLoadingMAL(true);
    try {
      // First check if it's anime
      const checkResponse = await fetch(
        `/api/content/check-anime?tmdbId=${content.id}&type=${content.mediaType}`
      );
      const checkData = await checkResponse.json();
      
      if (checkData.isAnime) {
        setIsAnime(true);
        
        // For seasons > 1, we need to get the season name from TMDB
        // e.g., Bleach Season 2 is "Thousand-Year Blood War" on TMDB
        let searchTitle = content.title || content.name || '';
        
        if (selectedSeason > 1 && content.seasons) {
          // Find the season info
          const seasonInfo = content.seasons.find(s => s.seasonNumber === selectedSeason);
          if (seasonInfo) {
            // Fetch season details to get the name
            try {
              const seasonResponse = await fetch(
                `/api/content/season?tvId=${content.id}&seasonNumber=${selectedSeason}`
              );
              if (seasonResponse.ok) {
                const seasonDataTemp = await seasonResponse.json();
                // TMDB season names are often like "Thousand-Year Blood War"
                // We want to search MAL with "Bleach: Thousand-Year Blood War"
                if (seasonDataTemp.name && seasonDataTemp.name !== `Season ${selectedSeason}`) {
                  searchTitle = `${content.title || content.name}: ${seasonDataTemp.name}`;
                  console.log(`[DetailsPage] Using season-specific title for MAL search: "${searchTitle}"`);
                }
              }
            } catch (e) {
              console.log('[DetailsPage] Could not fetch season name, using base title');
            }
          }
        }
        
        // Fetch MAL data with the appropriate title and season
        const malResponse = await fetch(
          `/api/content/mal-info?tmdbId=${content.id}&type=${content.mediaType}&season=${selectedSeason}&title=${encodeURIComponent(searchTitle)}`
        );
        const malResult = await malResponse.json();
        
        // Debug: Log the full MAL result
        console.log('[DetailsPage] MAL API response:', {
          success: malResult.success,
          hasData: !!malResult.data,
          seasonsCount: malResult.data?.allSeasons?.length || 0,
          seasons: malResult.data?.allSeasons?.map((s: any) => ({ 
            title: s.title, 
            titleEnglish: s.titleEnglish,
            malId: s.malId,
            episodes: s.episodes 
          })),
          searchedTitle: searchTitle,
          debug: malResult.debug
        });
        
        if (malResult.success && malResult.data) {
          // MAL data found - store it for episode mapping
          console.log('[DetailsPage] MAL data loaded:', {
            title: malResult.data.mainEntry?.title,
            malId: malResult.data.mainEntry?.mal_id,
            episodes: malResult.data.totalEpisodes
          });
          setMalData(malResult.data);
          
          // Populate anime entries for the selector
          if (malResult.data.allSeasons && malResult.data.allSeasons.length > 0) {
            const entries: AnimeEntry[] = malResult.data.allSeasons.map((s: any) => ({
              malId: s.malId,
              title: s.titleEnglish || s.title,
              episodes: s.episodes || 0,
            }));
            setAnimeEntries(entries);
            
            // Set initial selection to first entry if not already set
            if (!selectedMalId || !entries.find(e => e.malId === selectedMalId)) {
              setSelectedMalId(entries[0].malId);
            }
            console.log('[DetailsPage] Anime entries populated:', entries.map(e => e.title));
          }
        } else {
          console.log('[DetailsPage] No MAL match found, using standard TMDB display');
          setMalData(null);
          setAnimeEntries([]);
          setSelectedMalId(null);
        }
      } else {
        setIsAnime(false);
        setMalData(null);
        setAnimeEntries([]);
        setSelectedMalId(null);
      }
    } catch (err) {
      console.error('[DetailsPage] Error checking anime/MAL:', err);
      setIsAnime(false);
      setMalData(null);
      setAnimeEntries([]);
      setSelectedMalId(null);
    } finally {
      setLoadingMAL(false);
    }
  };

  // Load episodes when season changes for TV shows
  // For anime with MAL data: load TMDB episodes then split by MAL parts
  // For non-anime or anime without MAL split: use standard TMDB display
  useEffect(() => {
    if (content?.mediaType === 'tv' && content.seasons && content.seasons.length > 0) {
      // Always load TMDB episodes - we need them for thumbnails/titles
      loadSeasonEpisodes(selectedSeason);
      loadEpisodeProgress(selectedSeason);
    }
  }, [selectedSeason, content]);
  
  // Handle anime entry selection change
  const handleAnimeEntryChange = (malId: number) => {
    setSelectedMalId(malId);
    console.log('[DetailsPage] Selected anime entry:', malId);
  };
  
  // Get the currently selected anime entry
  const getSelectedAnimeEntry = () => {
    if (!selectedMalId || !malData?.allSeasons) return null;
    return malData.allSeasons.find((s: any) => s.malId === selectedMalId);
  };
  
  // Generate episode list for the selected MAL entry
  const getEpisodesForSelectedEntry = () => {
    const entry = getSelectedAnimeEntry();
    if (!entry) return [];
    
    // Generate episode numbers 1 to entry.episodes
    const episodes = [];
    for (let i = 1; i <= (entry.episodes || 0); i++) {
      episodes.push({
        id: `${entry.malId}-${i}`,
        episodeNumber: i,
        seasonNumber: 1, // MAL entries are treated as single seasons
        title: `Episode ${i}`,
        overview: '',
        stillPath: '', // No thumbnail for generated episodes
        airDate: '',
        runtime: 0,
        // Store MAL info for navigation
        _malId: entry.malId,
        _malTitle: entry.titleEnglish || entry.title,
      });
    }
    return episodes;
  };
  
  // When we have MAL data, store it for episode navigation
  // IMPORTANT: For anime with absolute episode numbering (like JJK), DON'T set animeSeasonMapping
  // because the episode selection logic needs to calculate the correct MAL entry based on episode number
  useEffect(() => {
    if (isAnime && malData && seasonData) {
      const tmdbId = parseInt(String(content?.id || '0'));
      
      // Skip setting animeSeasonMapping for absolute episode anime
      if (usesAbsoluteEpisodeNumbering(tmdbId)) {
        console.log('[DetailsPage] Skipping animeSeasonMapping for absolute episode anime (will calculate per episode)');
        setAnimeSeasonMapping(null);
        return;
      }
      
      const malEntry = malData.allSeasons[0]; // Single MAL entry for this TMDB season
      
      console.log('[DetailsPage] MAL mapping for season:', {
        tmdbSeason: selectedSeason,
        tmdbEpisodes: seasonData.episodes.length,
        malId: malEntry?.malId,
        malTitle: malEntry?.title,
        malEpisodes: malEntry?.episodes
      });
      
      // Store the mapping - single MAL entry, no splitting needed
      setAnimeSeasonMapping({
        tmdbSeason: selectedSeason,
        malParts: malData.allSeasons,
        tmdbEpisodes: seasonData.episodes
      });
    } else {
      setAnimeSeasonMapping(null);
    }
  }, [isAnime, malData, seasonData, selectedSeason]);

  // Load episode watch progress from localStorage and API
  const loadEpisodeProgress = async (seasonNumber: number) => {
    if (!content) return;
    
    const progressMap: Record<number, number> = {};
    
    try {
      // First, try to load from localStorage (multiple possible keys)
      const localStorageKeys = ['flyx_watch_progress', 'flyx_preferences'];
      
      for (const storageKey of localStorageKeys) {
        const stored = localStorage.getItem(storageKey);
        if (!stored) {
          console.log(`[DetailsPage] No data in ${storageKey}`);
          continue;
        }
        
        const data = JSON.parse(stored);
        // Handle both direct watchProgress and nested in preferences
        const watchProgress = storageKey === 'flyx_preferences' 
          ? (data.watchProgress || {}) 
          : data;
        
        console.log(`[DetailsPage] Found ${Object.keys(watchProgress).length} entries in ${storageKey}`);
        
        // Look for progress entries for this show and season
        // Key format: contentId_s{season}_e{episode}
        Object.entries(watchProgress).forEach(([key, value]: [string, any]) => {
          const pattern = `${content.id}_s${seasonNumber}_e`;
          if (key.startsWith(pattern)) {
            const episodeNum = parseInt(key.replace(pattern, ''));
            if (!isNaN(episodeNum)) {
              // Handle different data formats
              let progress = 0;
              if (value.completionPercentage !== undefined) {
                progress = value.completionPercentage;
              } else if (value.currentTime && value.duration && value.duration > 0) {
                progress = (value.currentTime / value.duration) * 100;
              }
              console.log(`[DetailsPage] localStorage progress for S${seasonNumber}E${episodeNum}: ${progress}%`);
              if (progress > 0) {
                progressMap[episodeNum] = Math.max(progressMap[episodeNum] || 0, progress);
              }
            }
          }
        });
      }
      
      // Also check flyx_viewing_history for completed episodes
      const historyStored = localStorage.getItem('flyx_viewing_history');
      if (historyStored) {
        const history = JSON.parse(historyStored);
        history.forEach((item: any) => {
          if (item.contentId === content.id && item.completed) {
            // Mark completed episodes as 100%
            // Note: viewing history doesn't store episode numbers directly
          }
        });
      }
      
      // Try to fetch from API for more accurate server-side data
      try {
        const userId = localStorage.getItem('flyx_user_id');
        console.log('[DetailsPage] Fetching watch sessions for userId:', userId?.substring(0, 8), 'contentId:', content.id);
        if (userId) {
          const response = await fetch(
            `/api/analytics/watch-session?userId=${userId}&contentId=${content.id}&limit=100`
          );
          if (response.ok) {
            const data = await response.json();
            console.log('[DetailsPage] Watch sessions response:', data);
            if (data.sessions && Array.isArray(data.sessions)) {
              data.sessions.forEach((session: any) => {
                // Check if this session is for the current season
                if (session.season_number === seasonNumber && session.episode_number) {
                  const episodeNum = session.episode_number;
                  const progress = session.completion_percentage || 0;
                  console.log(`[DetailsPage] Found progress for S${seasonNumber}E${episodeNum}: ${progress}%`);
                  // Use the higher progress value (local or server)
                  progressMap[episodeNum] = Math.max(progressMap[episodeNum] || 0, progress);
                }
              });
            }
          }
        }
      } catch (apiErr) {
        // API fetch failed, use localStorage data only
        console.log('Using localStorage progress only:', apiErr);
      }
      
      console.log('[DetailsPage] Final progress map:', progressMap);
      setEpisodeProgress(progressMap);
    } catch (err) {
      console.error('Error loading episode progress:', err);
    }
  };

  const loadSeasonEpisodes = async (seasonNumber: number) => {
    if (!content) return;
    
    setLoadingEpisodes(true);
    try {
      const response = await fetch(
        `/api/content/season?tvId=${content.id}&seasonNumber=${seasonNumber}`
      );
      
      if (response.ok) {
        const data = await response.json();
        setSeasonData(data);
      }
    } catch (err) {
      console.error('Error loading episodes:', err);
    } finally {
      setLoadingEpisodes(false);
    }
  };

  const handleWatchNow = () => {
    if (!content) return;
    
    const title = encodeURIComponent(content.title || content.name || 'Unknown');
    const tmdbId = parseInt(String(content.id));
    
    if (content.mediaType === 'movie') {
      // For anime movies, include MAL info so the extractor uses AnimeKai
      if (isAnime && malData?.mainEntry?.mal_id) {
        const malEntry = malData.mainEntry;
        console.log(`[handleWatchNow] Anime movie with MAL ID: ${malEntry.mal_id} (${malEntry.title})`);
        router.push(
          `/watch/${content.id}?type=movie&title=${title}&malId=${malEntry.mal_id}&malTitle=${encodeURIComponent(malEntry.title_english || malEntry.title)}`
        );
      } else {
        router.push(`/watch/${content.id}?type=movie&title=${title}`);
      }
    } else if (isAnime && animeEntries.length > 0 && selectedMalId) {
      // For anime with MAL entries, use the selected entry
      const selectedEntry = getSelectedAnimeEntry();
      if (selectedEntry) {
        console.log(`[handleWatchNow] Starting with MAL entry: ${selectedEntry.malId} (${selectedEntry.titleEnglish || selectedEntry.title})`);
        router.push(
          `/watch/${content.id}?type=tv&season=1&episode=1&title=${title}&malId=${selectedEntry.malId}&malTitle=${encodeURIComponent(selectedEntry.titleEnglish || selectedEntry.title)}`
        );
        return;
      }
    } else if (isAnime && usesAbsoluteEpisodeNumbering(tmdbId)) {
      // For anime with absolute episode numbering, start with episode 1
      // Pass absolute episode number - API will convert to correct MAL entry
      console.log(`[handleWatchNow] Starting absolute episode anime with episode 1`);
      router.push(
        `/watch/${content.id}?type=tv&season=${selectedSeason}&episode=1&title=${title}`
      );
      return;
    } else if (animeSeasonMapping && animeSeasonMapping.malParts.length >= 1) {
      // For anime with MAL data, include MAL info for accurate episode mapping
      const malPart = animeSeasonMapping.malParts[0]; // Single MAL entry per TMDB season
      
      console.log(`[handleWatchNow] Starting with MAL info: ${malPart.malId} (${malPart.title})`);
      
      router.push(
        `/watch/${content.id}?type=tv&season=${selectedSeason}&episode=1&title=${title}&malId=${malPart.malId}&malTitle=${encodeURIComponent(malPart.titleEnglish || malPart.title)}`
      );
    } else {
      // For TV shows without MAL data, watch first episode of selected season
      const episode = seasonData?.episodes[0];
      if (episode) {
        router.push(
          `/watch/${content.id}?type=tv&season=${selectedSeason}&episode=${episode.episodeNumber}&title=${title}`
        );
      }
    }
  };

  const handleEpisodeSelect = (episodeNumber: number, malId?: number, malTitle?: string) => {
    if (!content) return;
    const title = encodeURIComponent(content.title || content.name || 'Unknown');
    const tmdbId = parseInt(String(content.id));
    
    // If MAL info is passed directly (from anime entry selector), use it
    if (malId && malTitle) {
      console.log(`[handleEpisodeSelect] Episode ${episodeNumber} with direct MAL ID: ${malId}, Title: ${malTitle}`);
      router.push(
        `/watch/${content.id}?type=tv&season=1&episode=${episodeNumber}&title=${title}&malId=${malId}&malTitle=${encodeURIComponent(malTitle)}`
      );
      return;
    }
    
    // Check if this anime uses absolute episode numbering on TMDB
    // e.g., JJK on TMDB is 1 season with 59 episodes, but MAL has 3 separate entries
    if (isAnime && usesAbsoluteEpisodeNumbering(tmdbId)) {
      const malEntry = getMALEntryForAbsoluteEpisode(tmdbId, episodeNumber);
      if (malEntry) {
        console.log(`[handleEpisodeSelect] Absolute episode ${episodeNumber} → MAL ${malEntry.malId} (${malEntry.malTitle}) episode ${malEntry.relativeEpisode}`);
        // IMPORTANT: Pass the ABSOLUTE episode number (episodeNumber), not the relative one
        // The API will convert it to the correct MAL entry + relative episode
        router.push(
          `/watch/${content.id}?type=tv&season=${selectedSeason}&episode=${episodeNumber}&title=${title}`
        );
        return;
      }
    }
    
    // If we have MAL mapping, include MAL info for accurate episode lookup
    // With 1:1 TMDB season to MAL entry mapping, episode number is direct (no offset)
    if (animeSeasonMapping && animeSeasonMapping.malParts.length >= 1) {
      const malPart = animeSeasonMapping.malParts[0]; // Single MAL entry per TMDB season
      
      console.log(`[handleEpisodeSelect] Episode ${episodeNumber} with MAL ID: ${malPart.malId}, Title: ${malPart.titleEnglish || malPart.title}`);
      
      router.push(
        `/watch/${content.id}?type=tv&season=${selectedSeason}&episode=${episodeNumber}&title=${title}&malId=${malPart.malId}&malTitle=${encodeURIComponent(malPart.titleEnglish || malPart.title)}`
      );
    } else {
      router.push(
        `/watch/${content.id}?type=tv&season=${selectedSeason}&episode=${episodeNumber}&title=${title}`
      );
    }
  };

  const handleRelatedSelect = (id: string) => {
    // Navigate to the related content's details page
    const relatedItem = relatedContent.find(item => item.id === id);
    if (relatedItem) {
      router.push(`/details/${id}?type=${relatedItem.mediaType}`);
    }
  };

  if (error && !content) {
    return (
      <div className={styles.errorContainer}>
        <GlassPanel className={styles.errorPanel}>
          <h2 className={styles.errorTitle}>Oops! Something went wrong</h2>
          <p className={styles.errorMessage}>{error}</p>
          <FluidButton onClick={() => router.push('/')} variant="primary">
            Go Home
          </FluidButton>
        </GlassPanel>
      </div>
    );
  }

  if (!content) {
    return null;
  }

  const formattedRating = (content.rating || content.vote_average || 0).toFixed(1);
  const releaseYear = content.releaseDate
    ? new Date(content.releaseDate).getFullYear()
    : 'N/A';

  const handleGoBack = () => {
    if (typeof window === 'undefined' || !content) {
      router.push('/');
      return;
    }
    
    // Check for stored navigation origin (set by search page or homepage)
    const navigationOrigin = sessionStorage.getItem('flyx_navigation_origin');
    
    if (navigationOrigin) {
      try {
        const origin = JSON.parse(navigationOrigin);
        
        // If came from search, go back to search with the same query
        if (origin.type === 'search' && origin.query) {
          router.push(`/search?q=${encodeURIComponent(origin.query)}`);
          return;
        }
        
        // If came from homepage with scroll position, go back and restore
        if (origin.type === 'home' && origin.scrollY !== undefined) {
          router.push('/');
          // Restore scroll position after navigation
          setTimeout(() => {
            window.scrollTo(0, origin.scrollY);
          }, 100);
          return;
        }
      } catch (e) {
        console.error('Failed to parse navigation origin:', e);
      }
    }
    
    // Route based on media type
    // For anime: check if it's anime (Japanese animation)
    if (isAnime) {
      router.push('/anime');
      return;
    }
    
    // For movies
    if (content.mediaType === 'movie') {
      router.push('/movies');
      return;
    }
    
    // For TV shows (non-anime)
    if (content.mediaType === 'tv') {
      router.push('/series');
      return;
    }
    
    // Fallback to home
    router.push('/');
  };

  return (
    <div className={styles.container}>
      {/* Back Navigation */}
      <div className={styles.backNavigation}>
        <motion.button
          type="button"
          onClick={handleGoBack}
          className={styles.backButton}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          data-tv-focusable="true"
          data-tv-group="details-nav"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className={styles.backIcon}>
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
          </svg>
          <span>Back</span>
        </motion.button>
      </div>

      {/* Hero Section with Parallax Backdrop */}
      <ParallaxContainer className={styles.heroSection}>
        {/* Backdrop Image */}
        {content.backdropPath && (
          <div className={styles.backdrop}>
            <img
              src={content.backdropPath}
              alt={content.title}
              className={styles.backdropImage}
            />
            {/* Gradient overlays */}
            <div className={styles.backdropGradientTop} />
            <div className={styles.backdropGradientBottom} />
          </div>
        )}

        {/* Hero Content */}
        <div className={styles.heroContent}>
          <motion.div
            className={styles.heroInner}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            {/* Poster */}
            <div className={styles.posterContainer}>
              {content.posterPath ? (
                <img
                  src={content.posterPath}
                  alt={content.title}
                  className={styles.poster}
                />
              ) : (
                <div className={styles.posterPlaceholder}>
                  <span className={styles.posterIcon}>
                    {content.mediaType === 'movie' ? '🎬' : '📺'}
                  </span>
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className={styles.metadata}>
              <h1 className={styles.title}>{content.title}</h1>

              {/* Info Row */}
              <div className={styles.infoRow}>
                {/* Show MAL rating for anime, TMDB rating otherwise */}
                {isAnime && malData?.mainEntry?.score ? (
                  <span className={styles.rating} title="MyAnimeList Score">
                    ⭐ {malData.mainEntry.score.toFixed(2)} <span className={styles.malBadgeSmall}>MAL</span>
                  </span>
                ) : (
                  <span className={styles.rating}>⭐ {formattedRating}</span>
                )}
                <span className={styles.separator}>•</span>
                <span className={styles.year}>{releaseYear}</span>
                {content.runtime && (
                  <>
                    <span className={styles.separator}>•</span>
                    <span className={styles.runtime}>{content.runtime} min</span>
                  </>
                )}
                <span className={styles.separator}>•</span>
                <span className={styles.mediaType}>
                  {isAnime ? 'Anime' : content.mediaType === 'movie' ? 'Movie' : 'TV Show'}
                </span>
                {isAnime && malData && (
                  <>
                    <span className={styles.separator}>•</span>
                    <span className={styles.totalEpisodes}>
                      {malData.totalEpisodes} total episodes
                    </span>
                  </>
                )}
              </div>

              {/* Genres */}
              {content.genres && content.genres.length > 0 && (
                <div className={styles.genres}>
                  {content.genres.map((genre) => (
                    <span key={genre.id} className={styles.genreTag}>
                      {genre.name}
                    </span>
                  ))}
                </div>
              )}

              {/* Overview */}
              <p className={styles.overview}>{content.overview}</p>

              {/* Watch Now Button */}
              <div className={styles.actions}>
                <FluidButton
                  onClick={handleWatchNow}
                  variant="primary"
                  size="lg"
                  className={styles.watchButton}
                  tvGroup="details-actions"
                >
                  <svg
                    className={styles.playIcon}
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Watch Now
                </FluidButton>
                <WatchlistButton item={content} variant="full" />
              </div>
            </div>
          </motion.div>
        </div>
      </ParallaxContainer>

      {/* TV Show Season/Episode Selection */}
      {content.mediaType === 'tv' && content.seasons && content.seasons.length > 0 && (
        <section className={styles.seasonsSection}>
          <GlassPanel className={styles.seasonsPanel}>
            <h2 className={styles.sectionTitle}>Episodes</h2>
            
            {/* For anime with MAL entries: show anime title selector instead of TMDB seasons */}
            {isAnime && animeEntries.length > 0 && selectedMalId ? (
              <AnimeSeasonSelector
                entries={animeEntries}
                selectedMalId={selectedMalId}
                onEntryChange={handleAnimeEntryChange}
              />
            ) : (
              /* TMDB Season Selector - show for non-anime TV */
              <SeasonSelector
                seasons={content.seasons}
                selectedSeason={selectedSeason}
                onSeasonChange={(s) => {
                  setSelectedSeason(s);
                }}
              />
            )}
            
            {/* Loading indicator */}
            {(loadingEpisodes || loadingMAL) && (
              <div className={styles.loadingEpisodes}>
                <div className={styles.spinner} />
                <p>{loadingMAL ? 'Checking anime database...' : 'Loading episodes...'}</p>
              </div>
            )}
            
            {/* For anime with MAL entries: show episodes for selected entry */}
            {!loadingEpisodes && !loadingMAL && isAnime && animeEntries.length > 0 && selectedMalId && (
              <>
                {/* MAL Info Badge */}
                {(() => {
                  const selectedEntry = getSelectedAnimeEntry();
                  return selectedEntry ? (
                    <div className={styles.malPartSelector}>
                      <div className={styles.malPartHeader}>
                        <span className={styles.malBadgeSmall}>MAL</span>
                        <span className={styles.malPartNote}>
                          {selectedEntry.titleEnglish || selectedEntry.title}
                        </span>
                        <span className={styles.malPartRange}>
                          {selectedEntry.episodes} episodes • ⭐ {selectedEntry.score?.toFixed(2) || 'N/A'}
                        </span>
                      </div>
                    </div>
                  ) : null;
                })()}
                
                {/* Show generated episodes for selected MAL entry */}
                <EpisodeList
                  episodes={getEpisodesForSelectedEntry()}
                  onEpisodeSelect={(epNum) => {
                    const entry = getSelectedAnimeEntry();
                    if (entry) {
                      handleEpisodeSelect(epNum, entry.malId, entry.titleEnglish || entry.title);
                    }
                  }}
                  episodeProgress={episodeProgress}
                />
              </>
            )}
            
            {/* For anime without MAL entries or non-anime: show TMDB episodes */}
            {!loadingEpisodes && !loadingMAL && seasonData && !(isAnime && animeEntries.length > 0 && selectedMalId) && (
              <EpisodeList
                episodes={seasonData.episodes}
                onEpisodeSelect={handleEpisodeSelect}
                episodeProgress={episodeProgress}
              />
            )}
          </GlassPanel>
        </section>
      )}

      {/* Related Content - Horizontal Scroll Row */}
      {relatedContent.length > 0 && (
        <RelatedContentSection 
          items={relatedContent} 
          onItemSelect={handleRelatedSelect}
          reduceMotion={reduceMotion}
        />
      )}
    </div>
  );
}

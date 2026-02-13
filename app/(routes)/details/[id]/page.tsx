
import { notFound, redirect } from 'next/navigation';
import { tmdbService } from '@/lib/services/tmdb';
import { malService } from '@/lib/services/mal';
import type { MediaItem } from '@/types/media';
import DetailsPageClient from './DetailsPageClient';

interface DetailsPageProps {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    type?: 'movie' | 'tv';
  }>;
}

/**
 * Check if content is anime (Japanese animation)
 */
async function isAnimeContent(tmdbId: string, mediaType: 'movie' | 'tv'): Promise<boolean> {
  try {
    const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY;
    if (!apiKey) return false;
    
    const response = await fetch(
      `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${apiKey}`
    );
    
    if (!response.ok) return false;
    
    const data = await response.json();
    
    // Check if it's Japanese animation (genre 16 = Animation, origin_country includes JP)
    const isAnimation = data.genres?.some((g: any) => g.id === 16);
    const isJapanese = data.origin_country?.includes('JP') || 
                       data.original_language === 'ja' ||
                       data.production_countries?.some((c: any) => c.iso_3166_1 === 'JP');
    
    return isAnimation && isJapanese;
  } catch {
    return false;
  }
}

/**
 * Content Details Page - Server Component
 * Fetches content details and related content on the server
 * Redirects anime content to the dedicated /anime/[malId] page
 */
export default async function DetailsPage({ params, searchParams }: DetailsPageProps) {
  const { id } = await params;
  const { type } = await searchParams;
  const mediaType = type || 'movie';

  // Check if this is anime and redirect to MAL-based page
  const isAnime = await isAnimeContent(id, mediaType);
  if (isAnime) {
    try {
      // Get the content title for MAL search
      const content = await tmdbService.getDetails(id, mediaType);
      const title = content?.title || content?.name || '';
      
      if (title) {
        // Try to find MAL match
        const malData = await malService.getAllMALSeasonsForTMDB(parseInt(id), title);
        
        if (malData?.mainEntry?.mal_id) {
          // Redirect to dedicated anime page
          redirect(`/anime/${malData.mainEntry.mal_id}`);
        }
        
        // Fallback: search MAL directly
        const malMatch = await malService.findMatch(title, undefined, mediaType);
        if (malMatch?.mal_id) {
          redirect(`/anime/${malMatch.mal_id}`);
        }
      }
    } catch (error) {
      // IMPORTANT: Next.js redirect() works by throwing a special error.
      // We must re-throw it so the redirect actually happens.
      if (error && typeof error === 'object' && 'digest' in error && 
          typeof (error as any).digest === 'string' && (error as any).digest.startsWith('NEXT_REDIRECT')) {
        throw error;
      }
      // If it's a real error (not a redirect), continue with normal details page
      console.error('[DetailsPage] Anime redirect failed:', error);
    }
  }

  let content: MediaItem | null = null;
  let relatedContent: MediaItem[] = [];
  let error: string | null = null;

  try {
    // Fetch content details
    content = await tmdbService.getDetails(id, mediaType);

    // Fetch related content based on type
    const [trending, popular] = await Promise.all([
      tmdbService.getTrending(mediaType, 'week').catch(() => []),
      mediaType === 'movie' 
        ? tmdbService.getPopularMovies(1).catch(() => [])
        : tmdbService.getPopularTV(1).catch(() => []),
    ]);

    // Combine and filter out current item
    relatedContent = [...trending, ...popular]
      .filter(item => item.id !== id)
      .slice(0, 12);

  } catch (err) {
    console.error('Error fetching content details:', err);
    error = 'Failed to load content details. Please try again later.';
    
    // If content fetch failed, show 404
    if (!content) {
      notFound();
    }
  }

  return (
    <DetailsPageClient
      content={content}
      relatedContent={relatedContent}
      error={error}
    />
  );
}

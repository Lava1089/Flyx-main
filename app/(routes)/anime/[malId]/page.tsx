import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { malService } from '@/lib/services/mal';
import AnimeDetailsClient from './AnimeDetailsClient';

// Disable static caching — always fetch fresh on CF Workers
// ISR with revalidate caused 404s when Jikan API was temporarily unavailable
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ malId: string }>; // Next.js 13+ async params
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { malId: malIdStr } = await params;
  const malId = parseInt(malIdStr);
  
  if (isNaN(malId) || malId <= 0) {
    return {
      title: 'Invalid Anime | Flyx',
      description: 'The requested anime ID is invalid.',
    };
  }
  
  const anime = await malService.getById(malId);
  
  if (!anime) {
    return {
      title: 'Anime Not Found | Flyx',
      description: 'The requested anime could not be found.',
    };
  }

  return {
    title: `${anime.title} | Flyx Anime`,
    description: anime.synopsis || `Watch ${anime.title} on Flyx`,
    openGraph: {
      title: anime.title,
      description: anime.synopsis || undefined,
      images: anime.images?.jpg?.large_image_url ? [anime.images.jpg.large_image_url] : undefined,
      type: 'video.tv_show',
      siteName: 'Flyx',
    },
    twitter: {
      card: 'summary_large_image',
      title: anime.title,
      description: anime.synopsis || undefined,
      images: anime.images?.jpg?.large_image_url ? [anime.images.jpg.large_image_url] : undefined,
    },
  };
}

export default async function AnimeDetailsPage({ params }: Props) {
  const { malId: malIdStr } = await params;
  const malId = parseInt(malIdStr);
  
  if (isNaN(malId) || malId <= 0) {
    console.warn(`[AnimeDetailsPage] Invalid MAL ID: ${malIdStr}`);
    notFound();
  }

  // Try up to 2 times — Jikan API can be flaky, especially through proxy
  let seriesData = null;
  let lastError: unknown = null;
  
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      seriesData = await malService.getSeriesSeasons(malId);
      if (seriesData) break;
    } catch (error) {
      lastError = error;
      console.warn(`[AnimeDetailsPage] Attempt ${attempt} failed for MAL ID ${malId}:`, error);
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  // If all attempts failed, try just fetching the basic anime info
  if (!seriesData) {
    try {
      const anime = await malService.getById(malId);
      if (anime) {
        seriesData = {
          mainEntry: anime,
          allSeasons: [{
            malId: anime.mal_id,
            title: anime.title,
            titleEnglish: anime.title_english,
            episodes: anime.episodes,
            score: anime.score,
            members: anime.members,
            type: anime.type,
            status: anime.status,
            aired: anime.aired.string,
            synopsis: anime.synopsis,
            imageUrl: anime.images.jpg.large_image_url || anime.images.jpg.image_url,
            seasonOrder: 1,
          }],
          totalEpisodes: anime.episodes || 0,
        };
      }
    } catch (error) {
      console.error(`[AnimeDetailsPage] Fallback also failed for MAL ID ${malId}:`, error);
    }
  }

  if (!seriesData) {
    console.error(`[AnimeDetailsPage] All attempts failed for MAL ID: ${malId}`, lastError);
    notFound();
  }

  return (
    <AnimeDetailsClient 
      anime={seriesData.mainEntry} 
      allSeasons={seriesData.allSeasons} 
      totalEpisodes={seriesData.totalEpisodes}
    />
  );
}

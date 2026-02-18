'use client';

import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useMobileGestures } from '@/hooks/useMobileGestures';
import { useWatchProgress } from '@/lib/hooks/useWatchProgress';
import { useCast, CastMedia } from '@/hooks/useCast';
import { usePresenceContext } from '@/components/analytics/PresenceProvider';
import styles from './MobileVideoPlayer.module.css';

// Copy URL button with feedback for external players
function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    
    // Convert relative URLs to absolute URLs
    let fullUrl = url;
    if (url.startsWith('/')) {
      fullUrl = `${window.location.origin}${url}`;
    }
    
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  };

  return (
    <button 
      className={`${styles.speedButton} ${copied ? styles.active : ''}`}
      onClick={handleCopy}
      onTouchEnd={(e) => e.stopPropagation()}
      title="Copy stream URL"
    >
      {copied ? '✓' : '🔗'}
    </button>
  );
}

type AudioPreference = 'sub' | 'dub';
type Provider = 'vidsrc' | '1movies' | 'flixer' | 'vidlink' | 'animekai' | 'hianime';

interface SubtitleTrack {
  id: string;
  url: string;
  language: string;
  langCode?: string;
  iso639?: string;
}

interface MobileVideoPlayerProps {
  tmdbId: string;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
  title?: string;
  streamUrl: string;
  onBack?: () => void;
  onError?: (error: string) => void;
  onSourceChange?: (sourceIndex: number, currentTime: number) => void;
  availableSources?: Array<{ title: string; url: string; quality?: string; provider?: string; skipIntro?: [number, number]; skipOutro?: [number, number] }>;
  currentSourceIndex?: number;
  nextEpisode?: { season: number; episode: number; title?: string } | null;
  onNextEpisode?: () => void;
  // Anime sub/dub props
  isAnime?: boolean;
  audioPref?: AudioPreference;
  onAudioPrefChange?: (pref: AudioPreference, currentTime: number) => void;
  // Resume playback from specific time (used when switching sources/audio)
  initialTime?: number;
  // IMDB ID for fetching subtitles
  imdbId?: string;
  // Provider selection props
  currentProvider?: Provider;
  availableProviders?: Provider[];
  onProviderChange?: (provider: Provider, currentTime: number) => void;
  loadingProvider?: boolean;
  // Skip intro/outro data (from AnimeKai)
  skipIntro?: [number, number] | null;
  skipOutro?: [number, number] | null;
}

const formatTime = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const triggerHaptic = (type: 'light' | 'medium' | 'heavy' = 'light') => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    const duration = type === 'light' ? 10 : type === 'medium' ? 25 : 50;
    navigator.vibrate(duration);
  }
};

// Provider display names
const PROVIDER_NAMES: Record<Provider, string> = {
  vidsrc: 'VidSrc',
  flixer: 'Flixer',
  '1movies': '1movies',
  vidlink: 'VidLink',
  animekai: 'AnimeKai',
  hianime: 'HiAnime',
};

export default function MobileVideoPlayer({
  tmdbId,
  mediaType,
  season,
  episode,
  title,
  streamUrl,
  onBack,
  onError,
  onSourceChange,
  availableSources = [],
  currentSourceIndex = 0,
  nextEpisode,
  onNextEpisode,
  isAnime = false,
  audioPref = 'sub',
  onAudioPrefChange,
  initialTime = 0,
  imdbId,
  currentProvider,
  availableProviders = [],
  onProviderChange,
  loadingProvider = false,
  skipIntro: skipIntroProp = null,
  skipOutro: skipOutroProp = null,
}: MobileVideoPlayerProps) {
  const mobileInfo = useIsMobile();
  const presenceContext = usePresenceContext();
  
  // Lock in iOS and HLS support detection to prevent re-initialization on rotation
  const isIOSRef = useRef<boolean | null>(null);
  const supportsHLSRef = useRef<boolean | null>(null);
  if (isIOSRef.current === null && typeof window !== 'undefined') {
    isIOSRef.current = mobileInfo.isIOS;
    supportsHLSRef.current = mobileInfo.supportsHLS;
  }
  const isIOS = isIOSRef.current ?? mobileInfo.isIOS;
  const supportsHLS = supportsHLSRef.current ?? mobileInfo.supportsHLS;
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const seekPreviewTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Core playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  // Orientation state
  const [isLandscape, setIsLandscape] = useState(false);
  const [showRotateHint, setShowRotateHint] = useState(false);

  // Gesture feedback state
  const [seekPreview, setSeekPreview] = useState<{ show: boolean; time: number; delta: number } | null>(null);
  const [doubleTapIndicator, setDoubleTapIndicator] = useState<{ show: boolean; side: 'left' | 'right'; x: number; y: number } | null>(null);
  const [brightnessLevel, setBrightnessLevel] = useState(1);
  
  // Skip intro/outro state
  const [showSkipIntroButton, setShowSkipIntroButton] = useState(false);
  const [showSkipOutroButton, setShowSkipOutroButton] = useState(false);
  const skipIntroRef = useRef<[number, number] | null>(skipIntroProp);
  const skipOutroRef = useRef<[number, number] | null>(skipOutroProp);
  
  // Keep refs in sync with props
  useEffect(() => { skipIntroRef.current = skipIntroProp; }, [skipIntroProp]);
  useEffect(() => { skipOutroRef.current = skipOutroProp; }, [skipOutroProp]);
  const [volumeLevel, setVolumeLevel] = useState(1);
  const [showBrightnessOverlay, setShowBrightnessOverlay] = useState(false);
  const [showVolumeOverlay, setShowVolumeOverlay] = useState(false);
  const [longPressActive, setLongPressActive] = useState(false);
  const [showGestureHint, setShowGestureHint] = useState(false);

  // Resume playback state
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [savedProgress, setSavedProgress] = useState(0);
  const hasShownResumePromptRef = useRef(false);

  // Subtitle state
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [availableSubtitles, setAvailableSubtitles] = useState<SubtitleTrack[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState<string | null>(null);
  const [subtitlesLoading, setSubtitlesLoading] = useState(false);

  // Cast state
  const [isCastOverlayVisible, setIsCastOverlayVisible] = useState(false);
  const [castError, setCastError] = useState<string | null>(null);
  const [showCastTips, setShowCastTips] = useState(false); // Cast Tips modal
  const castErrorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cast callbacks - memoized to prevent useCast from re-initializing
  const handleCastConnect = useCallback(() => {
    console.log('[MobilePlayer] Cast/AirPlay connected');
    setCastError(null);
  }, []);
  
  const handleCastDisconnect = useCallback(() => {
    console.log('[MobilePlayer] Cast/AirPlay disconnected');
    setIsCastOverlayVisible(false);
  }, []);
  
  const handleCastError = useCallback((error: string) => {
    console.error('[MobilePlayer] Cast error:', error);
    setCastError(error);
    if (castErrorTimeoutRef.current) {
      clearTimeout(castErrorTimeoutRef.current);
    }
    castErrorTimeoutRef.current = setTimeout(() => {
      setCastError(null);
    }, 5000);
  }, []);

  // Cast to TV functionality (Chromecast + AirPlay)
  const cast = useCast({
    videoRef: videoRef,
    streamUrl: streamUrl, // Pass the actual m3u8 URL for Android casting
    onConnect: handleCastConnect,
    onDisconnect: handleCastDisconnect,
    onError: handleCastError,
  });

  // Build cast media object
  const getCastMedia = useCallback((): CastMedia | undefined => {
    if (!streamUrl) return undefined;
    
    const episodeInfo = mediaType === 'tv' && season && episode 
      ? `S${season}E${episode}` 
      : undefined;
    
    return {
      url: streamUrl.startsWith('/') ? `${window.location.origin}${streamUrl}` : streamUrl,
      title: title || 'Unknown Title',
      subtitle: episodeInfo,
      contentType: 'application/x-mpegURL',
      isLive: false,
      startTime: currentTime > 0 ? currentTime : undefined,
    };
  }, [streamUrl, title, mediaType, season, episode, currentTime]);

  // Handle cast button click - use ref to prevent double-firing on mobile
  const castClickHandledRef = useRef(false);
  const handleCastClick = useCallback(async (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    // Prevent double-firing from both onClick and onTouchEnd
    if (castClickHandledRef.current) {
      console.log('[MobilePlayer] Cast click already handled, skipping');
      return;
    }
    castClickHandledRef.current = true;
    setTimeout(() => { castClickHandledRef.current = false; }, 500);
    
    triggerHaptic('light');
    
    console.log('[MobilePlayer] Cast button clicked!', {
      isCasting: cast.isCasting,
      isAirPlayActive: cast.isAirPlayActive,
      isConnected: cast.isConnected,
      isAvailable: cast.isAvailable,
      isAirPlayAvailable: cast.isAirPlayAvailable,
    });
    
    // If already casting, stop
    if (cast.isCasting || cast.isAirPlayActive) {
      cast.stop();
      setIsCastOverlayVisible(false);
      return;
    }
    
    // If already connected, load media
    if (cast.isConnected) {
      const media = getCastMedia();
      if (media) {
        videoRef.current?.pause();
        const success = await cast.loadMedia(media);
        if (success) {
          setIsCastOverlayVisible(true);
        }
      }
      return;
    }
    
    // Try to start a cast session
    // This will show the device picker (Chromecast or AirPlay depending on browser)
    console.log('[MobilePlayer] Calling cast.requestSession()...');
    const connected = await cast.requestSession();
    console.log('[MobilePlayer] requestSession returned:', connected);
    
    if (connected) {
      const media = getCastMedia();
      if (media) {
        videoRef.current?.pause();
        const success = await cast.loadMedia(media);
        if (success) {
          setIsCastOverlayVisible(true);
        }
      }
    }
    
    // If cast.lastError was set, it will be shown via the castError state
    // which is synced from the useCast hook
    if (cast.lastError && !castError) {
      setCastError(cast.lastError);
      if (castErrorTimeoutRef.current) {
        clearTimeout(castErrorTimeoutRef.current);
      }
      castErrorTimeoutRef.current = setTimeout(() => {
        setCastError(null);
      }, 8000);
    }
  }, [cast, getCastMedia, castError]);

  // Refs for gesture calculations
  const seekStartTimeRef = useRef(0);
  const brightnessStartRef = useRef(1);
  const volumeStartRef = useRef(1);
  
  // Ref to track pending seek time (for resuming after source change)
  const pendingSeekTimeRef = useRef<number | null>(initialTime > 0 ? initialTime : null);
  
  // Store onError in a ref to avoid re-initialization when callback changes
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Debug: Log anime props
  useEffect(() => {
    console.log('[MobilePlayer] Anime props:', { isAnime, audioPref, hasOnAudioPrefChange: !!onAudioPrefChange });
  }, [isAnime, audioPref, onAudioPrefChange]);

  // Debug: Log skip intro/outro props
  useEffect(() => {
    console.log('[MobilePlayer] Skip data:', { skipIntro: skipIntroProp, skipOutro: skipOutroProp });
  }, [skipIntroProp, skipOutroProp]);

  // Watch progress tracking
  const {
    loadProgress,
    handleProgress,
    handleWatchStart,
    handleWatchPause,
    handleWatchResume,
  } = useWatchProgress({
    contentId: tmdbId,
    contentType: mediaType === 'tv' ? 'episode' : 'movie',
    contentTitle: title,
    seasonNumber: season,
    episodeNumber: episode,
  });

  // Auto-hide controls
  const resetControlsTimeout = useCallback(() => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (!isLocked) {
      setShowControls(true);
      if (isPlaying && !showSourceMenu && !showSpeedMenu) {
        controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 4000);
      }
    }
  }, [isPlaying, showSourceMenu, showSpeedMenu, isLocked]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || isLocked) return;
    if (video.paused) {
      video.play().catch(console.error);
    } else {
      video.pause();
    }
    triggerHaptic('light');
    resetControlsTimeout();
  }, [isLocked, resetControlsTimeout]);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video || isLocked) return;
    const newTime = Math.max(0, Math.min(time, duration));
    video.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration, isLocked]);

  const skip = useCallback((seconds: number) => {
    if (isLocked) return;
    seekTo(currentTime + seconds);
    triggerHaptic('light');
  }, [currentTime, seekTo, isLocked]);

  const handleTap = useCallback(() => {
    if (isLocked) {
      setShowControls(true);
      setTimeout(() => setShowControls(false), 2000);
      return;
    }
    if (showControls) {
      setShowControls(false);
    } else {
      resetControlsTimeout();
    }
  }, [isLocked, showControls, resetControlsTimeout]);

  const handleDoubleTap = useCallback((x: number, y: number, side: 'left' | 'center' | 'right') => {
    if (isLocked) return;
    if (side === 'center') {
      togglePlay();
      return;
    }
    const seekAmount = side === 'left' ? -10 : 10;
    skip(seekAmount);
    setDoubleTapIndicator({ show: true, side, x, y });
    setTimeout(() => setDoubleTapIndicator(null), 600);
    triggerHaptic('medium');
  }, [isLocked, togglePlay, skip]);

  const handleLongPress = useCallback(() => {
    if (isLocked) return;
    setLongPressActive(true);
    if (videoRef.current) videoRef.current.playbackRate = 2;
    triggerHaptic('heavy');
  }, [isLocked]);

  const handleLongPressEnd = useCallback(() => {
    if (longPressActive) {
      setLongPressActive(false);
      if (videoRef.current) videoRef.current.playbackRate = playbackSpeed;
    }
  }, [longPressActive, playbackSpeed]);

  const handleHorizontalDrag = useCallback((_deltaX: number, progress: number) => {
    if (isLocked) return;
    const seekDelta = progress * duration * 0.5;
    const previewTime = Math.max(0, Math.min(duration, seekStartTimeRef.current + seekDelta));
    setSeekPreview({ show: true, time: previewTime, delta: seekDelta });
  }, [isLocked, duration]);

  const handleHorizontalDragEnd = useCallback(() => {
    if (isLocked || !seekPreview) return;
    seekTo(seekPreview.time);
    if (seekPreviewTimeoutRef.current) clearTimeout(seekPreviewTimeoutRef.current);
    seekPreviewTimeoutRef.current = setTimeout(() => setSeekPreview(null), 300);
    triggerHaptic('light');
  }, [isLocked, seekPreview, seekTo]);

  const handleVerticalDragLeft = useCallback((_deltaY: number, progress: number) => {
    if (isLocked) return;
    const newBrightness = Math.max(0.2, Math.min(1.5, brightnessStartRef.current - progress));
    setBrightnessLevel(newBrightness);
    setShowBrightnessOverlay(true);
  }, [isLocked]);

  const handleVerticalDragLeftEnd = useCallback(() => {
    brightnessStartRef.current = brightnessLevel;
    setTimeout(() => setShowBrightnessOverlay(false), 500);
  }, [brightnessLevel]);

  const handleVerticalDragRight = useCallback((_deltaY: number, progress: number) => {
    if (isLocked) return;
    const newVolume = Math.max(0, Math.min(1, volumeStartRef.current - progress));
    setVolumeLevel(newVolume);
    if (videoRef.current) videoRef.current.volume = newVolume;
    setShowVolumeOverlay(true);
  }, [isLocked]);

  const handleVerticalDragRightEnd = useCallback(() => {
    volumeStartRef.current = volumeLevel;
    setTimeout(() => setShowVolumeOverlay(false), 500);
  }, [volumeLevel]);

  const handleGestureStart = useCallback((type: string) => {
    if (type === 'horizontal-drag') seekStartTimeRef.current = currentTime;
    else if (type === 'vertical-drag-left') brightnessStartRef.current = brightnessLevel;
    else if (type === 'vertical-drag-right') volumeStartRef.current = volumeLevel;
  }, [currentTime, brightnessLevel, volumeLevel]);

  const handleGestureEnd = useCallback((type: string) => {
    if (type === 'long-press') handleLongPressEnd();
  }, [handleLongPressEnd]);

  const { isGestureActive } = useMobileGestures(containerRef as React.RefObject<HTMLElement>, {
    onTap: handleTap,
    onDoubleTap: handleDoubleTap,
    onLongPress: handleLongPress,
    onHorizontalDrag: handleHorizontalDrag,
    onHorizontalDragEnd: handleHorizontalDragEnd,
    onVerticalDragLeft: handleVerticalDragLeft,
    onVerticalDragLeftEnd: handleVerticalDragLeftEnd,
    onVerticalDragRight: handleVerticalDragRight,
    onVerticalDragRightEnd: handleVerticalDragRightEnd,
    onGestureStart: handleGestureStart,
    onGestureEnd: handleGestureEnd,
    enabled: !showSourceMenu && !showSpeedMenu,
    preventScroll: true,
    doubleTapMaxDelay: 300,
    longPressDelay: 500,
    dragThreshold: 15,
  });


  const hlsConfig = useMemo(() => ({
    enableWorker: true,
    lowLatencyMode: false,
    // Improved buffering for VOD content
    backBufferLength: 60, // Keep 60s of back buffer for seeking
    maxBufferLength: 45, // Buffer up to 45s ahead
    maxMaxBufferLength: 90, // Allow up to 90s in good conditions
    maxBufferSize: 60 * 1000 * 1000, // 60MB buffer size
    maxBufferHole: 0.5, // Max gap to skip
    // Aggressive retry settings for better stall recovery
    manifestLoadingTimeOut: 20000,
    manifestLoadingMaxRetry: 6,
    manifestLoadingRetryDelay: 1000,
    levelLoadingTimeOut: 20000,
    levelLoadingMaxRetry: 6,
    levelLoadingRetryDelay: 1000,
    fragLoadingTimeOut: 30000,
    fragLoadingMaxRetry: 8,
    fragLoadingRetryDelay: 1000,
    // ABR settings for smoother playback
    startLevel: -1,
    abrEwmaDefaultEstimate: 1000000, // 1Mbps default estimate
    abrBandWidthFactor: 0.7, // Conservative bandwidth factor
    abrBandWidthUpFactor: 0.5, // Even more conservative for upgrades
    abrMaxWithRealBitrate: true, // Use real bitrate for ABR decisions
    // Stall recovery
    nudgeOffset: 0.1, // Small nudge to recover from stalls
    nudgeMaxRetry: 5, // Max nudge retries
  }), []);

  // Track the last initialized stream URL to prevent re-initialization on rotation
  const lastInitializedUrlRef = useRef<string | null>(null);
  
  // Initialize HLS
  useEffect(() => {
    if (!streamUrl || !videoRef.current) return;
    
    // Skip re-initialization if we already initialized this URL
    if (lastInitializedUrlRef.current === streamUrl && hlsRef.current) {
      console.log('[MobilePlayer] Skipping HLS re-init, already initialized for:', streamUrl.substring(0, 50));
      return;
    }
    
    console.log('[MobilePlayer] Initializing HLS for:', streamUrl.substring(0, 50));
    lastInitializedUrlRef.current = streamUrl;
    
    const video = videoRef.current;
    setIsLoading(true);
    setError(null);

    const attemptAutoplay = () => {
      // Seek to pending time if set (resuming after source change)
      if (pendingSeekTimeRef.current !== null && pendingSeekTimeRef.current > 0) {
        console.log('[MobilePlayer] Seeking to saved position:', pendingSeekTimeRef.current);
        video.currentTime = pendingSeekTimeRef.current;
        pendingSeekTimeRef.current = null;
      }
      video.muted = false;
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    };

    // Check for saved progress and show resume prompt
    const checkResumeProgress = () => {
      if (hasShownResumePromptRef.current) return;
      
      // Skip if we have a pending seek time (source/audio change)
      if (pendingSeekTimeRef.current !== null && pendingSeekTimeRef.current > 0) {
        hasShownResumePromptRef.current = true;
        return;
      }
      
      const savedTime = loadProgress();
      if (savedTime > 0 && video.duration > 0 && savedTime < video.duration - 30) {
        console.log('[MobilePlayer] Found saved progress:', savedTime);
        setSavedProgress(savedTime);
        setShowResumePrompt(true);
        video.pause();
        hasShownResumePromptRef.current = true;
      } else {
        hasShownResumePromptRef.current = true;
      }
    };

    if (isIOS && supportsHLS) {
      video.src = streamUrl;
      const handleLoadedMetadata = () => {
        setDuration(video.duration);
        setIsLoading(false);
        checkResumeProgress();
        if (!showResumePrompt) attemptAutoplay();
      };
      const handleCanPlay = () => {
        setIsLoading(false);
        if (video.paused) attemptAutoplay();
      };
      const handleError = () => {
        const err = video.error;
        setError(`Playback error: ${err?.message || 'Unknown error'}`);
        setIsLoading(false);
        onErrorRef.current?.(err?.message || 'Playback failed');
      };
      video.addEventListener('loadedmetadata', handleLoadedMetadata);
      video.addEventListener('canplay', handleCanPlay);
      video.addEventListener('error', handleError);
      return () => {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.removeEventListener('canplay', handleCanPlay);
        video.removeEventListener('error', handleError);
      };
    }

    if (Hls.isSupported()) {
      const hls = new Hls(hlsConfig);
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        // Restore playback speed if not default
        if (playbackSpeed !== 1 && video) {
          video.playbackRate = playbackSpeed;
        }
        // Check for resume after duration is available
        const checkAndPlay = () => {
          if (video.duration > 0) {
            checkResumeProgress();
            if (!hasShownResumePromptRef.current || !showResumePrompt) {
              attemptAutoplay();
            }
          } else {
            // Wait for duration
            setTimeout(checkAndPlay, 100);
          }
        };
        checkAndPlay();
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else {
            setError('Playback failed. Try another source.');
            setIsLoading(false);
            onErrorRef.current?.('Fatal playback error');
          }
        }
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }

    video.src = streamUrl;
    video.addEventListener('loadedmetadata', () => {
      setIsLoading(false);
      // Restore playback speed if not default
      if (playbackSpeed !== 1) {
        video.playbackRate = playbackSpeed;
      }
      attemptAutoplay();
    });
  // Note: isIOS and supportsHLS are locked refs, so they won't cause re-runs
  // onError is intentionally excluded - it's only used for error callbacks, not initialization
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, hlsConfig]);

  // Hide controls after 2 seconds when playing (stay visible when paused)
  useEffect(() => {
    if (isPlaying && !isLoading && showControls) {
      const hideTimer = setTimeout(() => {
        if (isPlaying && !showSourceMenu && !showSpeedMenu && !isLocked) {
          setShowControls(false);
        }
      }, 2000);
      return () => clearTimeout(hideTimer);
    }
  }, [isPlaying, isLoading, showControls, showSourceMenu, showSpeedMenu, isLocked]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    // Throttle timeupdate to reduce state updates
    let lastTimeUpdate = 0;
    
    const onPlay = () => { 
      setIsPlaying(true);
      handleWatchResume(video.currentTime, video.duration);
      
      // Update presence to "watching" for mobile users
      presenceContext?.setActivityType('watching', {
        contentId: tmdbId,
        contentTitle: title,
        contentType: mediaType,
        seasonNumber: season,
        episodeNumber: episode,
      });
      
      // Note: Auto-fullscreen removed - it requires user gesture and causes console errors
      // Users can tap the fullscreen button or rotate their device
    };
    const onPause = () => { 
      setIsPlaying(false); 
      setShowControls(true);
      handleWatchPause(video.currentTime, video.duration);
      
      // Update presence back to "browsing" when paused
      presenceContext?.setActivityType('browsing');
    };
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => { setIsBuffering(false); setIsLoading(false); };
    const onTimeUpdate = () => {
      // Throttle to ~4 updates per second to reduce re-renders
      const now = Date.now();
      if (now - lastTimeUpdate < 250) return;
      lastTimeUpdate = now;
      
      if (!isGestureActive) {
        setCurrentTime(video.currentTime);
        // Track watch progress
        if (video.duration > 0 && !showResumePrompt) {
          handleProgress(video.currentTime, video.duration);
        }
      }
      if (video.buffered.length > 0) {
        setBuffered((video.buffered.end(video.buffered.length - 1) / video.duration) * 100);
      }
      
      // Show/hide skip intro button based on current time
      const currentSkipIntro = skipIntroRef.current;
      if (currentSkipIntro) {
        const [introStart, introEnd] = currentSkipIntro;
        const inIntro = video.currentTime >= introStart && video.currentTime < introEnd;
        setShowSkipIntroButton(inIntro);
      }
      
      // Show/hide skip outro button based on current time
      const currentSkipOutro = skipOutroRef.current;
      if (currentSkipOutro) {
        const [outroStart, outroEnd] = currentSkipOutro;
        const inOutro = video.currentTime >= outroStart && video.currentTime < outroEnd;
        setShowSkipOutroButton(inOutro);
      }
    };
    const onDurationChange = () => setDuration(video.duration);
    const onEnded = () => { setIsPlaying(false); setShowControls(true); };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('ended', onEnded);
    };
  }, [isGestureActive, resetControlsTimeout, handleProgress, handleWatchPause, handleWatchResume, showResumePrompt, presenceContext, tmdbId, title, mediaType, season, episode]);

  // Orientation detection
  useEffect(() => {
    const checkOrientation = () => {
      // Check using multiple methods for best compatibility
      let isLand = false;
      if (screen.orientation) {
        isLand = screen.orientation.type.includes('landscape');
      } else if (typeof window !== 'undefined') {
        // Fallback: check window dimensions
        isLand = window.innerWidth > window.innerHeight;
      }
      setIsLandscape(isLand);
      
      // Show rotate hint briefly when in portrait and playing
      if (!isLand && !localStorage.getItem('mobile-rotate-hint-seen')) {
        setShowRotateHint(true);
        setTimeout(() => {
          setShowRotateHint(false);
          localStorage.setItem('mobile-rotate-hint-seen', 'true');
        }, 4000);
      }
    };

    // Initial check
    checkOrientation();

    // Listen for orientation changes
    if (screen.orientation) {
      screen.orientation.addEventListener('change', checkOrientation);
    }
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);

    return () => {
      if (screen.orientation) {
        screen.orientation.removeEventListener('change', checkOrientation);
      }
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  // Fullscreen handling
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (videoRef.current as any)?.webkitDisplayingFullscreen
      );
      setIsFullscreen(isNowFullscreen);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    const video = videoRef.current;
    if (video) {
      video.addEventListener('webkitbeginfullscreen', handleFullscreenChange);
      video.addEventListener('webkitendfullscreen', handleFullscreenChange);
    }
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      if (video) {
        video.removeEventListener('webkitbeginfullscreen', handleFullscreenChange);
        video.removeEventListener('webkitendfullscreen', handleFullscreenChange);
      }
    };
  }, []);

  // Simple fullscreen toggle - native experience, no forced orientation
  const toggleFullscreen = useCallback(async () => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container) return;
    
    try {
      if (!isFullscreen) {
        // Enter fullscreen - use native iOS fullscreen for best experience
        if ((video as any).webkitEnterFullscreen) {
          (video as any).webkitEnterFullscreen();
        } else if ((container as any).webkitRequestFullscreen) {
          await (container as any).webkitRequestFullscreen();
        } else if (container.requestFullscreen) {
          await container.requestFullscreen();
        }
      } else {
        // Exit fullscreen
        if ((video as any).webkitExitFullscreen) {
          (video as any).webkitExitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          (document as any).webkitExitFullscreen();
        } else if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      }
    } catch (e) { console.error('[MobilePlayer] Fullscreen error:', e); }
    triggerHaptic('light');
  }, [isFullscreen]);

  const toggleLock = useCallback(() => {
    setIsLocked(prev => !prev);
    triggerHaptic('medium');
    if (!isLocked) setShowControls(false);
  }, [isLocked]);

  const changeSpeed = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
    setShowSpeedMenu(false);
    triggerHaptic('light');
  }, []);

  // Resume playback handlers
  const handleResumePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    
    console.log('[MobilePlayer] Resuming from:', savedProgress);
    video.currentTime = savedProgress;
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {});
    });
    setShowResumePrompt(false);
    handleWatchResume(savedProgress, video.duration);
    triggerHaptic('light');
  }, [savedProgress, handleWatchResume]);

  const handleStartOver = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    
    console.log('[MobilePlayer] Starting from beginning');
    video.currentTime = 0;
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {});
    });
    setShowResumePrompt(false);
    handleWatchStart(0, video.duration);
    triggerHaptic('light');
  }, [handleWatchStart]);

  const handleProgressTouch = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    if (isLocked) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const touch = e.touches[0] || e.changedTouches[0];
    const pos = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    seekTo(pos * duration);
    triggerHaptic('light');
  }, [duration, seekTo, isLocked]);

  // Fetch subtitles
  const fetchSubtitles = useCallback(async () => {
    if (!imdbId) return;
    
    setSubtitlesLoading(true);
    try {
      const params = new URLSearchParams({ imdbId });
      if (mediaType === 'tv' && season && episode) {
        params.append('season', season.toString());
        params.append('episode', episode.toString());
      }
      
      const response = await fetch(`/api/subtitles?${params}`);
      const data = await response.json();
      
      if (data.success && data.subtitles && Array.isArray(data.subtitles)) {
        setAvailableSubtitles(data.subtitles);
      } else {
        setAvailableSubtitles([]);
      }
    } catch (err) {
      console.error('[MobilePlayer] Failed to fetch subtitles:', err);
      setAvailableSubtitles([]);
    } finally {
      setSubtitlesLoading(false);
    }
  }, [imdbId, mediaType, season, episode]);

  // Load subtitle track
  const loadSubtitle = useCallback((subtitle: SubtitleTrack | null) => {
    const video = videoRef.current;
    if (!video) return;

    // Remove existing tracks
    const tracks = video.querySelectorAll('track');
    tracks.forEach(track => track.remove());

    if (subtitle) {
      // Pass language code for proper encoding detection (especially for Arabic, Hebrew, etc.)
      const langCode = subtitle.iso639 || subtitle.langCode || '';
      const subtitleUrl = `/api/subtitle-proxy?url=${encodeURIComponent(subtitle.url)}&lang=${encodeURIComponent(langCode)}&_t=${Date.now()}`;
      
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = subtitle.language || 'Subtitles';
      track.srclang = subtitle.iso639 || 'en';
      track.src = subtitleUrl;
      track.default = true;
      
      track.addEventListener('load', () => {
        if (video.textTracks) {
          for (let i = 0; i < video.textTracks.length; i++) {
            video.textTracks[i].mode = 'showing';
          }
        }
      });
      
      video.appendChild(track);
      setCurrentSubtitle(subtitle.id);
    } else {
      setCurrentSubtitle(null);
    }
    
    setShowSubtitleMenu(false);
    triggerHaptic('light');
  }, []);

  // Fetch IMDB ID and then subtitles
  useEffect(() => {
    if (imdbId) {
      fetchSubtitles();
      return;
    }
    
    // If no imdbId prop, fetch it from TMDB
    const getImdbIdAndFetchSubtitles = async () => {
      try {
        // Skip TMDB lookup for MAL-direct anime (tmdbId=0)
        if (tmdbId === '0') {
          console.log('[MobilePlayer] Skipping IMDB lookup for MAL-direct anime (tmdbId=0)');
          return;
        }
        
        const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY;
        if (!apiKey || !tmdbId) return;
        
        const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/external_ids?api_key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.imdb_id) {
          setSubtitlesLoading(true);
          const params = new URLSearchParams({ imdbId: data.imdb_id });
          if (mediaType === 'tv' && season && episode) {
            params.append('season', season.toString());
            params.append('episode', episode.toString());
          }
          
          const subResponse = await fetch(`/api/subtitles?${params}`);
          const subData = await subResponse.json();
          
          if (subData.success && subData.subtitles && Array.isArray(subData.subtitles)) {
            setAvailableSubtitles(subData.subtitles);
          }
          setSubtitlesLoading(false);
        }
      } catch (err) {
        console.error('[MobilePlayer] Failed to fetch IMDB ID or subtitles:', err);
        setSubtitlesLoading(false);
      }
    };
    
    getImdbIdAndFetchSubtitles();
  }, [imdbId, tmdbId, mediaType, season, episode, fetchSubtitles]);

  const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];


  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${isFullscreen ? styles.fullscreen : ''} ${isLandscape ? styles.landscape : styles.portrait}`}
      style={{ filter: `brightness(${brightnessLevel})` }}
    >
      <video
        ref={videoRef}
        className={styles.video}
        playsInline
        autoPlay={false}
        controls={false}
        preload="metadata"
        webkit-playsinline="true"
        x-webkit-airplay="allow"
      />

      {(isLoading || isBuffering) && (
        <div className={styles.loadingOverlay}>
          <div className={styles.spinner} />
          <p>{isLoading ? 'Loading...' : 'Buffering...'}</p>
        </div>
      )}

      {error && (
        <div className={styles.errorOverlay}>
          <span className={styles.errorIcon}>⚠️</span>
          <p>{error}</p>
          <button className={styles.retryButton} onClick={() => { setError(null); setIsLoading(true); videoRef.current?.load(); }}>
            Retry
          </button>
        </div>
      )}

      {/* Cast Error Toast */}
      {castError && (
        <div className={styles.castErrorToast}>
          <span className={styles.castErrorIcon}>📺</span>
          <p>{castError}</p>
        </div>
      )}

      {/* Cast Overlay - shown when casting to TV */}
      {isCastOverlayVisible && (cast.isCasting || cast.isAirPlayActive) && (
        <div className={styles.castOverlay}>
          <div className={styles.castOverlayContent}>
            <div className={styles.castingIndicator}>
              {cast.isAirPlayAvailable ? (
                <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 22h12l-6-6-6 6z" />
                  <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4v-2H3V5h18v12h-4v2h4c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
                </svg>
              ) : (
                <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M1 18v3h3c0-1.66-1.34-3-3-3z" />
                  <path d="M1 14v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7z" />
                  <path d="M1 10v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11z" />
                  <path d="M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
                </svg>
              )}
            </div>
            <h3 className={styles.castTitle}>
              {cast.isAirPlayActive ? 'AirPlaying to TV' : 'Casting to TV'}
            </h3>
            <p className={styles.castSubtitle}>{title}</p>
            {mediaType === 'tv' && season && episode && (
              <p className={styles.castEpisode}>S{season} E{episode}</p>
            )}
            <button 
              className={styles.stopCastButton}
              onClick={(e) => {
                e.stopPropagation();
                cast.stop();
                setIsCastOverlayVisible(false);
                triggerHaptic('light');
              }}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              Stop {cast.isAirPlayActive ? 'AirPlay' : 'Casting'}
            </button>
          </div>
        </div>
      )}

      {/* Resume Playback Prompt */}
      {showResumePrompt && (
        <div className={styles.resumePromptOverlay} onClick={(e) => e.stopPropagation()}>
          <div className={styles.resumePromptContent}>
            <h3>Resume Playback?</h3>
            <p>Continue from {formatTime(savedProgress)}</p>
            <div className={styles.resumePromptButtons}>
              <button 
                className={styles.resumeButton}
                onClick={handleResumePlayback}
              >
                ▶️ Resume
              </button>
              <button 
                className={styles.startOverButton}
                onClick={handleStartOver}
              >
                ⏮️ Start Over
              </button>
            </div>
          </div>
        </div>
      )}

      {doubleTapIndicator?.show && (
        <div className={`${styles.doubleTapIndicator} ${styles[doubleTapIndicator.side]}`} style={{ left: doubleTapIndicator.x, top: doubleTapIndicator.y }}>
          <div className={styles.doubleTapRipple} />
          <span className={styles.doubleTapIcon}>{doubleTapIndicator.side === 'left' ? '⏪' : '⏩'}</span>
          <span>10s</span>
        </div>
      )}

      {seekPreview?.show && (
        <div className={styles.seekPreview}>
          <span className={styles.seekPreviewTime}>{formatTime(seekPreview.time)}</span>
          <span className={styles.seekPreviewDelta}>{seekPreview.delta >= 0 ? '+' : ''}{formatTime(Math.abs(seekPreview.delta))}</span>
          <div className={styles.seekPreviewBar}>
            <div className={styles.seekPreviewProgress} style={{ width: `${(seekPreview.time / duration) * 100}%` }} />
          </div>
        </div>
      )}

      {showBrightnessOverlay && (
        <div className={styles.gestureOverlay}>
          <span className={styles.gestureIcon}>☀️</span>
          <div className={styles.gestureBar}>
            <div className={styles.gestureFill} style={{ height: `${(brightnessLevel / 1.5) * 100}%` }} />
          </div>
          <span>{Math.round((brightnessLevel / 1.5) * 100)}%</span>
        </div>
      )}

      {showVolumeOverlay && (
        <div className={styles.gestureOverlay}>
          <span className={styles.gestureIcon}>{volumeLevel === 0 ? '🔇' : volumeLevel < 0.5 ? '🔉' : '🔊'}</span>
          <div className={styles.gestureBar}>
            <div className={styles.gestureFill} style={{ height: `${volumeLevel * 100}%` }} />
          </div>
          <span>{Math.round(volumeLevel * 100)}%</span>
        </div>
      )}

      {longPressActive && (
        <div className={styles.speedIndicator}>
          <span>⏩ 2x Speed</span>
        </div>
      )}

      {/* Rotate hint for portrait mode */}
      {showRotateHint && !isLandscape && (
        <div className={styles.rotateHint}>
          <span className={styles.rotateIcon}>📱↻</span>
          <span>Rotate for fullscreen</span>
        </div>
      )}

      {/* Gesture Hints Overlay */}
      {showGestureHint && (
        <div className={styles.gestureHintOverlay} onClick={() => setShowGestureHint(false)}>
          <div className={styles.gestureHintContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.gestureHintHeader}>
              <h3>Gesture Controls</h3>
              <button className={styles.gestureHintClose} onClick={() => setShowGestureHint(false)}>✕</button>
            </div>
            <div className={styles.gestureHintList}>
              <div className={styles.gestureHintItem}>
                <span className={styles.gestureHintIcon}>👆</span>
                <div className={styles.gestureHintText}>
                  <span className={styles.gestureHintAction}>Tap</span>
                  <span className={styles.gestureHintDesc}>Show/hide controls</span>
                </div>
              </div>
              <div className={styles.gestureHintItem}>
                <span className={styles.gestureHintIcon}>👆👆</span>
                <div className={styles.gestureHintText}>
                  <span className={styles.gestureHintAction}>Double tap left/right</span>
                  <span className={styles.gestureHintDesc}>Skip ±10 seconds</span>
                </div>
              </div>
              <div className={styles.gestureHintItem}>
                <span className={styles.gestureHintIcon}>👆👆</span>
                <div className={styles.gestureHintText}>
                  <span className={styles.gestureHintAction}>Double tap center</span>
                  <span className={styles.gestureHintDesc}>Play/Pause</span>
                </div>
              </div>
              <div className={styles.gestureHintItem}>
                <span className={styles.gestureHintIcon}>👆⏱️</span>
                <div className={styles.gestureHintText}>
                  <span className={styles.gestureHintAction}>Long press</span>
                  <span className={styles.gestureHintDesc}>2x speed while held</span>
                </div>
              </div>
              <div className={styles.gestureHintItem}>
                <span className={styles.gestureHintIcon}>↔️</span>
                <div className={styles.gestureHintText}>
                  <span className={styles.gestureHintAction}>Swipe horizontal</span>
                  <span className={styles.gestureHintDesc}>Seek through video</span>
                </div>
              </div>
              <div className={styles.gestureHintItem}>
                <span className={styles.gestureHintIcon}>↕️☀️</span>
                <div className={styles.gestureHintText}>
                  <span className={styles.gestureHintAction}>Swipe up/down (left side)</span>
                  <span className={styles.gestureHintDesc}>Adjust brightness</span>
                </div>
              </div>
              <div className={styles.gestureHintItem}>
                <span className={styles.gestureHintIcon}>↕️🔊</span>
                <div className={styles.gestureHintText}>
                  <span className={styles.gestureHintAction}>Swipe up/down (right side)</span>
                  <span className={styles.gestureHintDesc}>Adjust volume</span>
                </div>
              </div>
            </div>
            <button className={styles.gestureHintDismiss} onClick={() => setShowGestureHint(false)}>
              Got it!
            </button>
          </div>
        </div>
      )}

      {/* Lock indicator - tap anywhere on it to unlock */}
      {isLocked && showControls && (
        <div 
          className={styles.lockIndicator} 
          onClick={(e) => { 
            e.stopPropagation(); 
            setIsLocked(false);
            triggerHaptic('medium');
          }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <span>🔒 Tap to unlock</span>
        </div>
      )}

      <div className={`${styles.controls} ${showControls && !isLocked ? styles.visible : ''}`}>
        {/* Top Bar */}
        <div className={styles.topBar}>
          <button className={styles.iconButton} onClick={(e) => { e.stopPropagation(); onBack?.(); }} onTouchEnd={(e) => e.stopPropagation()}>
            ←
          </button>
          <div className={styles.titleArea}>
            <h2 className={styles.title}>{title}</h2>
            {mediaType === 'tv' && season && episode && (
              <span className={styles.episodeInfo}>S{season} E{episode}</span>
            )}
          </div>
          <div className={styles.topButtons}>
            {/* DEBUG: Show anime status - remove after debugging */}
            <span style={{ color: isAnime ? 'lime' : 'red', fontSize: '10px', marginRight: '8px' }}>
              {isAnime ? '🎌' : '📺'}
            </span>
            {/* Sub/Dub Toggle for Anime */}
            {isAnime && (
              <button 
                className={styles.subDubToggle} 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  if (!onAudioPrefChange) {
                    console.warn('[MobilePlayer] onAudioPrefChange not provided!');
                    return;
                  }
                  const newPref = audioPref === 'sub' ? 'dub' : 'sub';
                  // Pass current playback time to preserve position
                  onAudioPrefChange(newPref, currentTime);
                  triggerHaptic('light');
                }} 
                onTouchEnd={(e) => e.stopPropagation()}
              >
                <span className={audioPref === 'sub' ? styles.activeLabel : styles.inactiveLabel}>SUB</span>
                <div className={styles.toggleTrack} data-active={audioPref}>
                  <div className={styles.toggleThumb} />
                </div>
                <span className={audioPref === 'dub' ? styles.activeLabel : styles.inactiveLabel}>DUB</span>
              </button>
            )}
            {/* Subtitles Button */}
            <button 
              className={`${styles.iconButton} ${currentSubtitle ? styles.activeIcon : ''}`}
              onClick={(e) => { 
                e.stopPropagation(); 
                setShowSubtitleMenu(true);
                triggerHaptic('light');
              }} 
              onTouchEnd={(e) => e.stopPropagation()}
              title="Subtitles"
            >
              CC
            </button>
            {/* Help/Gesture Hints Button */}
            <button 
              className={styles.iconButton} 
              onClick={(e) => { 
                e.stopPropagation(); 
                setShowGestureHint(true);
                triggerHaptic('light');
              }} 
              onTouchEnd={(e) => e.stopPropagation()}
              title="Show gesture hints"
            >
              ❓
            </button>
            {/* Cast / AirPlay Button */}
            <button 
              className={`${styles.iconButton} ${cast.isCasting || cast.isAirPlayActive ? styles.activeIcon : ''}`}
              onClick={handleCastClick}
              onTouchEnd={(e) => {
                e.stopPropagation();
                // On mobile, onClick may not fire reliably, so handle touch here too
                handleCastClick(e);
              }}
              title={cast.isAirPlayAvailable ? 'AirPlay' : 'Cast to TV'}
            >
              {cast.isAirPlayAvailable ? (
                // AirPlay icon
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 22h12l-6-6-6 6z" />
                  <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4v-2H3V5h18v12h-4v2h4c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
                </svg>
              ) : (
                // Chromecast icon
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M1 18v3h3c0-1.66-1.34-3-3-3z" />
                  <path d="M1 14v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7z" />
                  <path d="M1 10v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11z" />
                  <path d="M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
                </svg>
              )}
            </button>
            {/* Cast Tips Button */}
            <button 
              className={styles.iconButton}
              onClick={(e) => { 
                e.stopPropagation(); 
                setShowCastTips(true);
                triggerHaptic('light');
              }}
              onTouchEnd={(e) => e.stopPropagation()}
              title="Cast Tips & Help"
              style={{ fontSize: '12px', fontWeight: 600 }}
            >
              ?
            </button>
            <button className={styles.iconButton} onClick={(e) => { e.stopPropagation(); toggleLock(); }} onTouchEnd={(e) => e.stopPropagation()}>
              🔒
            </button>
            <button className={styles.iconButton} onClick={(e) => { e.stopPropagation(); setShowSourceMenu(true); }} onTouchEnd={(e) => e.stopPropagation()}>
              📡
            </button>
          </div>
        </div>

        {/* Center Controls */}
        <div className={styles.centerControls}>
          <button className={styles.skipButton} onClick={(e) => { e.stopPropagation(); skip(-10); }} onTouchEnd={(e) => e.stopPropagation()}>
            <span className={styles.skipIcon}>⏪</span>
            <span className={styles.skipText}>10</span>
          </button>
          <button className={styles.playButton} onClick={(e) => { e.stopPropagation(); togglePlay(); }} onTouchEnd={(e) => e.stopPropagation()}>
            {isPlaying ? '⏸️' : '▶️'}
          </button>
          <button className={styles.skipButton} onClick={(e) => { e.stopPropagation(); skip(10); }} onTouchEnd={(e) => e.stopPropagation()}>
            <span className={styles.skipIcon}>⏩</span>
            <span className={styles.skipText}>10</span>
          </button>
        </div>

        {/* Bottom Bar */}
        <div className={styles.bottomBar}>
          <div className={styles.progressContainer} onTouchStart={handleProgressTouch} onTouchMove={handleProgressTouch}>
            <div className={styles.progressTrack}>
              <div className={styles.progressBuffered} style={{ width: `${buffered}%` }} />
              <div className={styles.progressFilled} style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
            </div>
            <div className={styles.progressThumb} style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
          </div>
          <div className={styles.bottomControls}>
            {/* Time on left: current / total */}
            <span className={styles.timeDisplay}>
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
            
            {/* Center buttons */}
            <div className={styles.bottomButtons}>
              <button className={styles.speedButton} onClick={(e) => { e.stopPropagation(); setShowSpeedMenu(true); }} onTouchEnd={(e) => e.stopPropagation()}>
                {playbackSpeed}x
              </button>
              {nextEpisode && onNextEpisode && (
                <button 
                  className={styles.nextEpisodeButton} 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    console.log('[MobilePlayer] Next episode clicked:', nextEpisode);
                    onNextEpisode(); 
                    triggerHaptic('light');
                  }} 
                  onTouchEnd={(e) => e.stopPropagation()}
                >
                  <span>Next</span>
                  <span className={styles.nextIcon}>⏭️</span>
                </button>
              )}
              {/* Copy URL button */}
              <CopyUrlButton url={streamUrl} />
            </div>
            
            {/* Fullscreen on far right */}
            <button className={styles.iconButton} onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} onTouchEnd={(e) => e.stopPropagation()}>
              {isFullscreen ? '⛶' : '⛶'}
            </button>
          </div>
        </div>
      </div>

      {/* Skip Intro Button */}
      {showSkipIntroButton && skipIntroProp && (
        <button
          className={styles.skipIntroOutroButton}
          onClick={(e) => {
            e.stopPropagation();
            if (videoRef.current && skipIntroProp) {
              videoRef.current.currentTime = skipIntroProp[1];
              setShowSkipIntroButton(false);
              triggerHaptic('light');
            }
          }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <span>Skip Intro</span>
          <span>⏭️</span>
        </button>
      )}

      {/* Skip Outro Button */}
      {showSkipOutroButton && skipOutroProp && (
        <button
          className={styles.skipIntroOutroButton}
          onClick={(e) => {
            e.stopPropagation();
            if (videoRef.current && skipOutroProp) {
              videoRef.current.currentTime = skipOutroProp[1];
              setShowSkipOutroButton(false);
              triggerHaptic('light');
            }
          }}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <span>Skip Outro</span>
          <span>⏭️</span>
        </button>
      )}

      {/* Source Menu */}
      {showSourceMenu && (
        <div className={styles.menuOverlay} onClick={() => setShowSourceMenu(false)}>
          <div className={styles.menuContent} onClick={e => e.stopPropagation()}>
            <div className={styles.menuHeader}>
              <h3>Select Source</h3>
              <button className={styles.menuClose} onClick={() => setShowSourceMenu(false)}>✕</button>
            </div>
            
            {/* Provider Tabs */}
            {availableProviders.length > 1 && (
              <div className={styles.providerTabs}>
                {availableProviders.map(provider => (
                  <button
                    key={provider}
                    className={`${styles.providerTab} ${provider === currentProvider ? styles.active : ''}`}
                    onClick={() => {
                      if (provider !== currentProvider && onProviderChange) {
                        onProviderChange(provider, currentTime);
                        triggerHaptic('light');
                      }
                    }}
                    disabled={loadingProvider}
                  >
                    {PROVIDER_NAMES[provider]}
                  </button>
                ))}
              </div>
            )}
            
            {/* Loading indicator */}
            {loadingProvider && (
              <div className={styles.loadingIndicator}>
                <span>Loading sources...</span>
              </div>
            )}
            
            <div className={styles.menuList}>
              {!loadingProvider && availableSources.length === 0 ? (
                <div className={styles.noSources}>
                  No sources available from {currentProvider ? PROVIDER_NAMES[currentProvider] : 'this provider'}
                </div>
              ) : (
                availableSources.map((source, index) => (
                  <button
                    key={index}
                    className={`${styles.menuItem} ${index === currentSourceIndex ? styles.active : ''}`}
                    onClick={() => { 
                      // Pass current playback time to preserve position
                      onSourceChange?.(index, currentTime); 
                      setShowSourceMenu(false); 
                      triggerHaptic('light'); 
                    }}
                  >
                    <span>{source.title || `Source ${index + 1}`}</span>
                    {source.quality && <span className={styles.quality}>{source.quality}</span>}
                    {index === currentSourceIndex && <span className={styles.checkmark}>✓</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Speed Menu */}
      {showSpeedMenu && (
        <div className={styles.menuOverlay} onClick={() => setShowSpeedMenu(false)}>
          <div className={styles.menuContent} onClick={e => e.stopPropagation()}>
            <div className={styles.menuHeader}>
              <h3>Playback Speed</h3>
              <button className={styles.menuClose} onClick={() => setShowSpeedMenu(false)}>✕</button>
            </div>
            <div className={styles.menuList}>
              {speedOptions.map(speed => (
                <button
                  key={speed}
                  className={`${styles.menuItem} ${speed === playbackSpeed ? styles.active : ''}`}
                  onClick={() => changeSpeed(speed)}
                >
                  <span>{speed}x</span>
                  {speed === 1 && <span className={styles.normalLabel}>Normal</span>}
                  {speed === playbackSpeed && <span className={styles.checkmark}>✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Subtitle Menu */}
      {showSubtitleMenu && (
        <div className={styles.menuOverlay} onClick={() => setShowSubtitleMenu(false)}>
          <div className={styles.menuContent} onClick={e => e.stopPropagation()}>
            <div className={styles.menuHeader}>
              <h3>Subtitles</h3>
              <button className={styles.menuClose} onClick={() => setShowSubtitleMenu(false)}>✕</button>
            </div>
            <div className={styles.menuList}>
              {/* Off option */}
              <button
                className={`${styles.menuItem} ${!currentSubtitle ? styles.active : ''}`}
                onClick={() => loadSubtitle(null)}
              >
                <span>Off</span>
                {!currentSubtitle && <span className={styles.checkmark}>✓</span>}
              </button>
              
              {subtitlesLoading ? (
                <div className={styles.menuLoading}>Loading subtitles...</div>
              ) : availableSubtitles.length > 0 ? (
                availableSubtitles.map((subtitle) => (
                  <button
                    key={subtitle.id}
                    className={`${styles.menuItem} ${currentSubtitle === subtitle.id ? styles.active : ''}`}
                    onClick={() => loadSubtitle(subtitle)}
                  >
                    <span>{subtitle.language}</span>
                    {currentSubtitle === subtitle.id && <span className={styles.checkmark}>✓</span>}
                  </button>
                ))
              ) : (
                <div className={styles.menuEmpty}>No subtitles available</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cast Tips Modal */}
      {showCastTips && (
        <div className={styles.menuOverlay} onClick={() => setShowCastTips(false)}>
          <div className={styles.menuContent} onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh' }}>
            <div className={styles.menuHeader}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#e50914">
                  <path d="M1 18v3h3c0-1.66-1.34-3-3-3z" />
                  <path d="M1 14v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7z" />
                  <path d="M1 10v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11z" />
                  <path d="M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
                </svg>
                Cast Tips
              </h3>
              <button className={styles.menuClose} onClick={() => setShowCastTips(false)}>✕</button>
            </div>
            <div className={styles.menuList} style={{ padding: '12px' }}>
              {/* iOS/iPhone Section */}
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '10px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95rem', color: 'white', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  📱 iPhone / iPad
                </h4>
                <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 }}>
                  <li>Tap the AirPlay button above</li>
                  <li>Select your Apple TV or AirPlay TV</li>
                  <li>Video plays directly on your TV</li>
                </ol>
                <p style={{ margin: '8px 0 0 0', fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>
                  ✅ AirPlay sends the stream directly for smooth playback
                </p>
              </div>

              {/* Android Section */}
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '10px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95rem', color: 'white', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  🤖 Android
                </h4>
                <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)' }}>
                  <strong>Option 1:</strong> Tap the Cast button above (works with Chromecast)
                </p>
                <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)' }}>
                  <strong>Option 2 (Recommended):</strong> Use Screen Mirroring:
                </p>
                <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 }}>
                  <li>Swipe down for Quick Settings</li>
                  <li>Tap "Smart View" / "Screen Cast" / "Wireless Display"</li>
                  <li>Select your TV</li>
                </ol>
                <p style={{ margin: '8px 0 0 0', fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>
                  💡 Screen mirroring works with all TVs and stream types
                </p>
              </div>

              {/* Windows Section */}
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '10px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95rem', color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  🖥️ Windows PC
                </h4>
                <p style={{ margin: '0 0 6px 0', fontSize: '0.85rem', color: 'rgba(255,255,255,0.9)' }}>
                  Press <strong style={{ background: '#333', padding: '2px 6px', borderRadius: '4px' }}>Win + K</strong> for best results:
                </p>
                <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 }}>
                  <li>Select your TV from wireless displays</li>
                  <li>Choose "Duplicate" or "Second screen only"</li>
                </ol>
                <p style={{ margin: '8px 0 0 0', fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>
                  💡 Smoother than Chrome tab casting
                </p>
              </div>

              {/* Smart TV Section - IMPORTANT WARNING */}
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'rgba(255, 193, 7, 0.15)', borderRadius: '10px', border: '1px solid rgba(255, 193, 7, 0.4)' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95rem', color: '#ffc107', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  ⚠️ LG / Samsung Smart TVs
                </h4>
                <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>
                  These TVs do NOT support native Chromecast!
                </p>
                <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)' }}>
                  The cast button won't work properly. You must use screen mirroring:
                </p>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 }}>
                  <li><strong>Android:</strong> Quick Settings → Smart View / Screen Cast</li>
                  <li><strong>Windows:</strong> Press Win + K</li>
                  <li><strong>Chrome:</strong> Menu (⋮) → Cast → Sources → Cast tab</li>
                </ul>
                <p style={{ margin: '8px 0 0 0', fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' }}>
                  💡 For smooth casting, buy a Chromecast device (~$30)
                </p>
              </div>

              {/* Troubleshooting */}
              <div style={{ padding: '12px', backgroundColor: 'rgba(229, 9, 20, 0.1)', borderRadius: '10px', border: '1px solid rgba(229, 9, 20, 0.3)' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  🔧 Tips
                </h4>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 }}>
                  <li>Same WiFi network required</li>
                  <li>Right-click casting is always laggy</li>
                  <li>Use the cast button for best quality</li>
                </ul>
              </div>
            </div>
            <div style={{ padding: '12px' }}>
              <button 
                onClick={() => setShowCastTips(false)}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: '#e50914',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'white',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unlock Button - only show briefly when tapped while locked */}
      {isLocked && showControls && (
        <button className={styles.unlockButton} onClick={(e) => { 
          e.stopPropagation(); 
          setIsLocked(false);
          triggerHaptic('medium');
        }} onTouchEnd={(e) => e.stopPropagation()}>
          🔓
        </button>
      )}
    </div>
  );
}

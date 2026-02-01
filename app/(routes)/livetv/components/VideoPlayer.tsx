/**
 * Live TV Video Player
 * 
 * Native HLS.js player for DLHD, CDN Live, and VIPRow streams.
 * NO EMBEDS - direct m3u8 playback with full controls.
 * Includes channel selector for events with multiple channels.
 */

'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import { LiveEvent, TVChannel } from '../hooks/useLiveTVData';
import { getTvPlaylistUrl, getAvailableBackends } from '@/app/lib/proxy-config';
import styles from './VideoPlayer.module.css';

interface VideoPlayerProps {
  event: LiveEvent | null;
  channel: TVChannel | null;
  isOpen: boolean;
  onClose: () => void;
}

export function VideoPlayer({ event, channel, isOpen, onClose }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [currentQuality, setCurrentQuality] = useState<number>(-1);
  const [qualities, setQualities] = useState<Array<{ height: number; index: number }>>([]);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showChannelMenu, setShowChannelMenu] = useState(false);
  const [selectedChannelIndex, setSelectedChannelIndex] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  
  // Backend switching state
  const [availableBackends, setAvailableBackends] = useState<Array<{
    id: string;
    server: string;
    domain: string;
    isPrimary: boolean;
    label: string;
  }>>([]);
  const [selectedBackend, setSelectedBackend] = useState<string | undefined>(undefined);
  const [showBackendMenu, setShowBackendMenu] = useState(false);
  const [loadingBackends, setLoadingBackends] = useState(false);

  // Get current channel from event
  const currentEventChannel = event?.channels?.[selectedChannelIndex];

  // Get stream URL based on source
  const getStreamUrl = useCallback((): string | null => {
    // Channel playback (DLHD or CDN Live)
    if (channel) {
      if (channel.source === 'dlhd') {
        return getTvPlaylistUrl(channel.channelId, selectedBackend);
      }
      if (channel.source === 'cdnlive') {
        const [name, country] = channel.channelId.split('|');
        return `/api/livetv/cdnlive-stream?channel=${encodeURIComponent(name)}&code=${country || ''}`;
      }
    }

    // Event playback - use selected channel
    if (event) {
      if (event.source === 'dlhd' && event.channels.length > 0) {
        const ch = event.channels[selectedChannelIndex] || event.channels[0];
        console.log('[LiveTV Player] Using channel:', ch.channelId, ch.name);
        return getTvPlaylistUrl(ch.channelId, selectedBackend);
      }

      if (event.source === 'viprow' && event.viprowUrl) {
        const cfProxy = process.env.NEXT_PUBLIC_CF_STREAM_PROXY_URL;
        if (cfProxy) {
          const baseUrl = cfProxy.replace(/\/stream\/?$/, '');
          return `${baseUrl}/viprow/stream?url=${encodeURIComponent(event.viprowUrl)}&link=1`;
        }
        return `/api/livetv/viprow-stream?url=${encodeURIComponent(event.viprowUrl)}&link=1`;
      }
    }

    return null;
  }, [event, channel, selectedChannelIndex, selectedBackend]);

  // Load HLS stream
  const loadHlsStream = useCallback((video: HTMLVideoElement, url: string) => {
    console.log('[VideoPlayer] Loading HLS stream:', url);
    
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false, // Disable for better stability
        // Improved buffering configuration for live streams
        backBufferLength: 60, // Keep 60s of back buffer for seeking
        maxBufferLength: 45, // Buffer up to 45s ahead
        maxMaxBufferLength: 90, // Allow up to 90s in good conditions
        maxBufferSize: 60 * 1000 * 1000, // 60MB buffer size
        maxBufferHole: 0.5, // Max gap to skip
        // Live stream sync settings
        liveSyncDurationCount: 4, // Sync to 4 segments behind live edge
        liveMaxLatencyDurationCount: 12, // Max 12 segments behind before seeking
        liveDurationInfinity: true, // Treat live streams as infinite
        // Aggressive retry settings for better stall recovery
        manifestLoadingMaxRetry: 8,
        manifestLoadingRetryDelay: 1000,
        manifestLoadingMaxRetryTimeout: 30000,
        levelLoadingMaxRetry: 8,
        levelLoadingRetryDelay: 1000,
        levelLoadingMaxRetryTimeout: 30000,
        fragLoadingMaxRetry: 10,
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 45000,
        // ABR settings for smoother playback
        abrEwmaDefaultEstimate: 1000000, // 1Mbps default estimate
        abrBandWidthFactor: 0.7, // Conservative bandwidth factor
        abrBandWidthUpFactor: 0.5, // Even more conservative for upgrades
        abrMaxWithRealBitrate: true, // Use real bitrate for ABR decisions
        // Stall recovery
        nudgeOffset: 0.1, // Small nudge to recover from stalls
        nudgeMaxRetry: 5, // Max nudge retries
        // Custom loader to handle X-Real-IV header for dvalna.ru segments
        xhrSetup: (xhr) => {
          xhr.timeout = 30000;
        },
      });

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        const levels = data.levels.map((level, index) => ({
          height: level.height,
          index,
        })).filter(l => l.height > 0);
        
        setQualities(levels);
        setIsLoading(false);
        video.play().then(() => {
          console.log('[VideoPlayer] Autoplay started');
          setIsPlaying(true);
        }).catch((err) => {
          console.log('[VideoPlayer] Autoplay blocked:', err);
          setIsPlaying(false);
        });
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        setCurrentQuality(data.level);
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error('[VideoPlayer] HLS Error:', data.type, data.details, data.fatal);
        
        // Handle buffer stalls (non-fatal)
        if (data.details === 'bufferStalledError') {
          console.log('[VideoPlayer] Buffer stalled, attempting recovery...');
          if (video.currentTime > 0 && !video.paused) {
            video.currentTime = video.currentTime + 0.1;
          }
          return;
        }
        
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retryCount < 5) {
            console.log('[VideoPlayer] Network error, retrying...', retryCount + 1);
            setRetryCount(prev => prev + 1);
            // Exponential backoff
            setTimeout(() => hls.startLoad(), Math.min(1000 * Math.pow(2, retryCount), 10000));
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            console.log('[VideoPlayer] Media error, recovering...');
            hls.recoverMediaError();
          } else {
            console.error('[VideoPlayer] Fatal error, giving up');
            setError(`Stream failed: ${data.details || 'Unknown error'}`);
            setIsLoading(false);
            hls.destroy();
          }
        }
      });

      // Monitor buffer health
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        // Reset retry count on successful fragment load
        if (retryCount > 0) {
          setRetryCount(0);
        }
      });

      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.addEventListener('loadedmetadata', () => {
        setIsLoading(false);
        video.play().catch(() => {});
      });
      video.addEventListener('error', () => {
        setError('Failed to load stream');
        setIsLoading(false);
      });
    } else {
      setError('HLS not supported');
      setIsLoading(false);
    }
  }, [retryCount]);

  // Initialize player
  const initPlayer = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setIsLoading(true);
    setError(null);

    const streamUrl = getStreamUrl();
    console.log('[VideoPlayer] Stream URL:', streamUrl);
    
    if (!streamUrl) {
      setError('No stream URL available - channel may not be configured');
      setIsLoading(false);
      return;
    }

    // Handle API endpoints that return JSON
    if (streamUrl.includes('/api/livetv/')) {
      try {
        console.log('[VideoPlayer] Fetching from API:', streamUrl);
        const response = await fetch(streamUrl);
        const data = await response.json();
        console.log('[VideoPlayer] API response:', data);
        if (data.streamUrl) {
          loadHlsStream(video, data.streamUrl);
        } else {
          setError(data.error || 'Failed to get stream from API');
          setIsLoading(false);
        }
      } catch (err) {
        console.error('[VideoPlayer] API fetch error:', err);
        setError('Failed to fetch stream - network error');
        setIsLoading(false);
      }
      return;
    }

    // Direct HLS URL (Cloudflare Worker proxy)
    loadHlsStream(video, streamUrl);
    
    // Set a loading timeout - if stream doesn't load in 30s, show error
    const loadingTimeout = setTimeout(() => {
      if (isLoading && !error) {
        console.warn('[VideoPlayer] Loading timeout - stream may be unavailable');
        setError('Stream loading timeout - channel may be offline or blocked');
        setIsLoading(false);
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      }
    }, 30000);
    
    return () => clearTimeout(loadingTimeout);
  }, [getStreamUrl, loadHlsStream, isLoading, error]);

  // Switch channel
  const switchChannel = useCallback((index: number) => {
    setSelectedChannelIndex(index);
    setShowChannelMenu(false);
    setRetryCount(0);
    setSelectedBackend(undefined); // Reset backend when switching channels
    setAvailableBackends([]);
  }, []);

  // Fetch available backends for current channel
  const fetchBackends = useCallback(async () => {
    const channelId = channel?.channelId || event?.channels?.[selectedChannelIndex]?.channelId;
    if (!channelId) return;
    
    setLoadingBackends(true);
    try {
      const backends = await getAvailableBackends(channelId);
      setAvailableBackends(backends);
    } catch (e) {
      console.error('[VideoPlayer] Failed to fetch backends:', e);
    } finally {
      setLoadingBackends(false);
    }
  }, [channel, event, selectedChannelIndex]);

  // Switch backend
  const switchBackend = useCallback((backendId: string) => {
    console.log('[VideoPlayer] Switching to backend:', backendId);
    setSelectedBackend(backendId);
    setShowBackendMenu(false);
    setError(null);
    setRetryCount(0);
  }, []);

  // Re-init when channel or backend changes
  useEffect(() => {
    if (isOpen && (event || channel)) {
      initPlayer();
    }
  }, [selectedChannelIndex, selectedBackend]);

  // Initialize when opened
  useEffect(() => {
    if (isOpen && (event || channel)) {
      setSelectedChannelIndex(0);
      setRetryCount(0);
      initPlayer();
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [isOpen, event, channel]);

  // Video event handlers - sync play/pause/volume state with video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Sync initial state
    setIsPlaying(!video.paused);
    setVolume(video.volume);
    setIsMuted(video.muted);

    const onPlay = () => { 
      console.log('[VideoPlayer] play event');
      setIsPlaying(true); 
      setIsLoading(false); 
    };
    const onPause = () => {
      console.log('[VideoPlayer] pause event');
      setIsPlaying(false);
    };
    const onWaiting = () => setIsLoading(true);
    const onPlaying = () => { 
      console.log('[VideoPlayer] playing event');
      setIsPlaying(true); 
      setIsLoading(false); 
    };
    const onCanPlay = () => setIsLoading(false);
    const onVolumeChange = () => {
      console.log('[VideoPlayer] volumechange - volume:', video.volume, 'muted:', video.muted);
      setVolume(video.volume);
      setIsMuted(video.muted);
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('volumechange', onVolumeChange);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('volumechange', onVolumeChange);
    };
  }, [isOpen]);

  // Auto-hide controls
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showQualityMenu && !showChannelMenu && !showBackendMenu) {
        setShowControls(false);
      }
    }, 3000);
  }, [isPlaying, showQualityMenu, showChannelMenu, showBackendMenu]);

  // Hide controls when menus close
  useEffect(() => {
    if (!showQualityMenu && !showChannelMenu && !showBackendMenu && isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 2000);
    }
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [showQualityMenu, showChannelMenu, showBackendMenu, isPlaying]);

  // Keyboard controls
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          video.paused ? video.play() : video.pause();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          video.muted = !video.muted;
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          break;
        case 'Escape':
          isFullscreen ? document.exitFullscreen?.() : onClose();
          break;
      }
      showControlsTemporarily();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isFullscreen, onClose, showControlsTemporarily]);

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    document.fullscreenElement ? document.exitFullscreen?.() : container.requestFullscreen?.();
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    console.log('[VideoPlayer] togglePlay - paused:', video.paused);
    if (video.paused) {
      video.play().catch(err => console.error('[VideoPlayer] Play failed:', err));
    } else {
      video.pause();
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const val = parseFloat(e.target.value);
    console.log('[VideoPlayer] Volume slider changed to:', val);
    video.volume = val;
    setVolume(val);
    if (val > 0) {
      video.muted = false;
      setIsMuted(false);
    }
  };

  const selectQuality = (index: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = index;
      setCurrentQuality(index);
    }
    setShowQualityMenu(false);
  };

  const getTitle = () => {
    if (channel) return channel.name;
    if (event) {
      const ch = event.channels[selectedChannelIndex];
      return ch ? `${event.title} • ${ch.name}` : event.title;
    }
    return 'Live TV';
  };

  if (!isOpen) return null;

  const hasMultipleChannels = event && event.channels.length > 1;

  return (
    <div className={styles.playerOverlay}>
      <div 
        ref={containerRef}
        className={styles.playerContainer}
        onMouseMove={showControlsTemporarily}
        onMouseLeave={() => isPlaying && setShowControls(false)}
        onClick={(e) => e.target === e.currentTarget && togglePlay()}
      >
        <video
          ref={videoRef}
          className={styles.video}
          playsInline
          onClick={togglePlay}
        />

        {isLoading && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner} />
            <p>Loading stream...</p>
          </div>
        )}

        {error && (
          <div className={styles.errorOverlay}>
            <div className={styles.errorIcon}>⚠️</div>
            <p className={styles.errorMessage}>{error}</p>
            <div className={styles.errorActions}>
              <button onClick={() => { setRetryCount(0); initPlayer(); }} className={styles.retryButton}>
                Retry
              </button>
              <button 
                onClick={() => { 
                  if (availableBackends.length === 0) fetchBackends();
                  setShowBackendMenu(!showBackendMenu);
                }} 
                className={styles.switchBackendButton}
              >
                {loadingBackends ? 'Loading...' : 'Switch Server'}
              </button>
            </div>
            
            {showBackendMenu && availableBackends.length > 0 && (
              <div className={styles.backendMenu}>
                <p className={styles.backendMenuTitle}>Select a different server:</p>
                {availableBackends.map((backend) => (
                  <button
                    key={backend.id}
                    onClick={() => switchBackend(backend.id)}
                    className={`${styles.backendOption} ${selectedBackend === backend.id ? styles.active : ''} ${backend.isPrimary ? styles.primary : ''}`}
                  >
                    {backend.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={`${styles.controls} ${showControls ? styles.visible : ''}`}>
          <div className={styles.topBar}>
            <button onClick={onClose} className={styles.closeButton}>✕</button>
            <div className={styles.titleSection}>
              <h2 className={styles.title}>{getTitle()}</h2>
              {event?.isLive && (
                <span className={styles.liveBadge}>
                  <span className={styles.liveDot} />
                  LIVE
                </span>
              )}
            </div>
          </div>

          <div className={styles.bottomBar}>
            <button onClick={togglePlay} className={styles.controlButton}>
              {isPlaying ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <div className={styles.volumeControl}>
              <button 
                onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }}
                className={styles.controlButton}
              >
                {isMuted || volume === 0 ? (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                  </svg>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className={styles.volumeSlider}
                style={{ '--volume-percent': `${(isMuted ? 0 : volume) * 100}%` } as React.CSSProperties}
              />
            </div>

            <div className={styles.spacer} />

            {/* Channel Selector */}
            {hasMultipleChannels && (
              <div className={styles.channelSelector}>
                <button 
                  onClick={() => { setShowChannelMenu(!showChannelMenu); setShowQualityMenu(false); setShowBackendMenu(false); }}
                  className={styles.controlButton}
                >
                  📺
                  <span className={styles.channelLabel}>
                    {currentEventChannel?.name || 'Channel'}
                  </span>
                </button>
                
                {showChannelMenu && (
                  <div className={styles.channelMenu}>
                    {event.channels.map((ch, idx) => (
                      <button
                        key={ch.channelId}
                        onClick={() => switchChannel(idx)}
                        className={`${styles.channelOption} ${idx === selectedChannelIndex ? styles.active : ''}`}
                      >
                        {ch.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Backend/Server Selector - only for DLHD sources */}
            {(channel?.source === 'dlhd' || event?.source === 'dlhd') && (
              <div className={styles.backendSelector}>
                <button 
                  onClick={() => { 
                    if (availableBackends.length === 0) fetchBackends();
                    setShowBackendMenu(!showBackendMenu); 
                    setShowQualityMenu(false); 
                    setShowChannelMenu(false); 
                  }}
                  className={styles.controlButton}
                >
                  🖥️
                  <span className={styles.backendLabel}>
                    {selectedBackend ? selectedBackend.split('.')[0].toUpperCase() : 'Auto'}
                  </span>
                </button>
                
                {showBackendMenu && (
                  <div className={styles.backendMenuPopup}>
                    {loadingBackends ? (
                      <p className={styles.backendLoading}>Loading servers...</p>
                    ) : availableBackends.length > 0 ? (
                      <>
                        <button
                          onClick={() => { setSelectedBackend(undefined); setShowBackendMenu(false); }}
                          className={`${styles.backendOption} ${!selectedBackend ? styles.active : ''}`}
                        >
                          Auto (Default)
                        </button>
                        {availableBackends.map((backend) => (
                          <button
                            key={backend.id}
                            onClick={() => switchBackend(backend.id)}
                            className={`${styles.backendOption} ${selectedBackend === backend.id ? styles.active : ''} ${backend.isPrimary ? styles.primary : ''}`}
                          >
                            {backend.label}
                          </button>
                        ))}
                      </>
                    ) : (
                      <p className={styles.backendLoading}>No servers available</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Quality Selector */}
            {qualities.length > 0 && (
              <div className={styles.qualitySelector}>
                <button 
                  onClick={() => { setShowQualityMenu(!showQualityMenu); setShowChannelMenu(false); setShowBackendMenu(false); }}
                  className={styles.controlButton}
                >
                  ⚙️
                  <span className={styles.qualityLabel}>
                    {currentQuality === -1 ? 'Auto' : `${qualities.find(q => q.index === currentQuality)?.height || ''}p`}
                  </span>
                </button>
                
                {showQualityMenu && (
                  <div className={styles.qualityMenu}>
                    <button
                      onClick={() => selectQuality(-1)}
                      className={`${styles.qualityOption} ${currentQuality === -1 ? styles.active : ''}`}
                    >
                      Auto
                    </button>
                    {qualities.map((q) => (
                      <button
                        key={q.index}
                        onClick={() => selectQuality(q.index)}
                        className={`${styles.qualityOption} ${currentQuality === q.index ? styles.active : ''}`}
                      >
                        {q.height}p
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button onClick={toggleFullscreen} className={styles.controlButton}>
              {isFullscreen ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

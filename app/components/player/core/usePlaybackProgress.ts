/**
 * usePlaybackProgress — Watch progress tracking, resume from saved position
 * 
 * Wraps the existing useWatchProgress hook and adds resume-from-saved-position
 * logic (showing a resume prompt, handling start-over vs resume).
 * Shared between desktop and mobile players.
 * 
 * Requirements: 6.1
 */
'use client';

import { useState, useRef, useCallback } from 'react';
import { useWatchProgress } from '@/lib/hooks/useWatchProgress';

export interface UsePlaybackProgressOptions {
  tmdbId: string;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
  title?: string;
  autoplay?: boolean;
}

export interface UsePlaybackProgressReturn {
  // Resume prompt state
  showResumePrompt: boolean;
  savedProgress: number;
  // Actions
  handleStartOver: (videoEl: HTMLVideoElement | null) => void;
  handleResume: (videoEl: HTMLVideoElement | null, resyncSubtitles?: () => void) => void;
  checkResumeProgress: (videoEl: HTMLVideoElement | null) => boolean;
  // Watch progress tracking (delegated)
  handleProgress: (currentTime: number, duration: number) => void;
  handleWatchStart: (currentTime: number, duration: number) => void;
  handleWatchPause: (currentTime: number, duration: number) => void;
  handleWatchResume: (currentTime: number, duration: number) => void;
  // Refs
  hasShownResumePromptRef: React.MutableRefObject<boolean>;
  shouldShowResumePromptRef: React.MutableRefObject<boolean>;
}

export function usePlaybackProgress(options: UsePlaybackProgressOptions): UsePlaybackProgressReturn {
  const { tmdbId, mediaType, season, episode, title, autoplay = false } = options;

  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [savedProgress, setSavedProgress] = useState(0);

  const hasShownResumePromptRef = useRef(false);
  const shouldShowResumePromptRef = useRef(false);

  const contentType = mediaType === 'tv' ? 'episode' : 'movie';

  const {
    handleProgress,
    loadProgress,
    handleWatchStart,
    handleWatchPause,
    handleWatchResume,
  } = useWatchProgress({
    contentId: tmdbId,
    contentType,
    contentTitle: title,
    seasonNumber: season,
    episodeNumber: episode,
    onProgress: () => {},
    onComplete: () => {},
  });

  const checkResumeProgress = useCallback((videoEl: HTMLVideoElement | null): boolean => {
    if (hasShownResumePromptRef.current) return false;
    if (autoplay) {
      hasShownResumePromptRef.current = true;
      return false;
    }

    const savedTime = loadProgress();
    if (savedTime > 30) {
      shouldShowResumePromptRef.current = true;
    }

    if (videoEl && savedTime > 0 && videoEl.duration > 0 && savedTime < videoEl.duration - 30) {
      setSavedProgress(savedTime);
      setShowResumePrompt(true);
      videoEl.pause();
      hasShownResumePromptRef.current = true;
      return true;
    }

    hasShownResumePromptRef.current = true;
    return false;
  }, [autoplay, loadProgress]);

  const handleStartOver = useCallback((videoEl: HTMLVideoElement | null) => {
    if (videoEl) {
      videoEl.currentTime = 0;
      videoEl.play();
    }
    setShowResumePrompt(false);
    shouldShowResumePromptRef.current = false;
  }, []);

  const handleResumeAction = useCallback((videoEl: HTMLVideoElement | null, resyncSubtitles?: () => void) => {
    if (videoEl) {
      videoEl.currentTime = savedProgress;
      videoEl.play();
      if (resyncSubtitles) setTimeout(resyncSubtitles, 100);
    }
    setShowResumePrompt(false);
    shouldShowResumePromptRef.current = false;
  }, [savedProgress]);

  return {
    showResumePrompt,
    savedProgress,
    handleStartOver,
    handleResume: handleResumeAction,
    checkResumeProgress,
    handleProgress,
    handleWatchStart,
    handleWatchPause,
    handleWatchResume,
    hasShownResumePromptRef,
    shouldShowResumePromptRef,
  };
}

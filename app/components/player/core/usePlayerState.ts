/**
 * usePlayerState — Centralized playback state management
 * 
 * Manages all core playback state (playing, buffering, time, volume, etc.)
 * in a single hook so both desktop and mobile shells share the same state logic.
 * 
 * Requirements: 6.1
 */
'use client';

import { useState, useCallback, useRef } from 'react';
import { getSavedVolume, getSavedMuteState, saveVolumeSettings } from '@/lib/utils/player-preferences';
import type { PlayerState, PlayerSource, HlsQualityLevel } from './types';

export interface UsePlayerStateReturn {
  // Core state
  state: PlayerState;
  // State setters
  setPlaying: (playing: boolean) => void;
  setBuffering: (buffering: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setBuffered: (buffered: number) => void;
  setFullscreen: (fullscreen: boolean) => void;
  setCurrentSourceIndex: (index: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  setSubtitlesEnabled: (enabled: boolean) => void;
  setCurrentSubtitleLanguage: (lang: string) => void;
  setQuality: (quality: string) => void;
  // Volume helpers
  handleVolumeChange: (videoEl: HTMLVideoElement | null, value: number) => void;
  toggleMute: (videoEl: HTMLVideoElement | null) => void;
  // Sources
  availableSources: PlayerSource[];
  setAvailableSources: React.Dispatch<React.SetStateAction<PlayerSource[]>>;
  // HLS quality
  hlsLevels: HlsQualityLevel[];
  setHlsLevels: React.Dispatch<React.SetStateAction<HlsQualityLevel[]>>;
  currentHlsLevel: number;
  setCurrentHlsLevel: React.Dispatch<React.SetStateAction<number>>;
  // Refs for avoiding stale closures
  lastTimeUpdateRef: React.MutableRefObject<number>;
  lastWatchTimeUpdateRef: React.MutableRefObject<number>;
  sourceConfirmedWorkingRef: React.MutableRefObject<boolean>;
  pendingSeekTimeRef: React.MutableRefObject<number | null>;
}

export function usePlayerState(initialTime: number = 0): UsePlayerStateReturn {
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(() => getSavedVolume());
  const [muted, setMutedState] = useState(() => getSavedMuteState());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buffered, setBuffered] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [currentSourceIndex, setCurrentSourceIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(false);
  const [currentSubtitleLanguage, setCurrentSubtitleLanguage] = useState('');
  const [quality, setQuality] = useState('');

  const [availableSources, setAvailableSources] = useState<PlayerSource[]>([]);
  const [hlsLevels, setHlsLevels] = useState<HlsQualityLevel[]>([]);
  const [currentHlsLevel, setCurrentHlsLevel] = useState(-1); // -1 = auto

  // Throttling refs
  const lastTimeUpdateRef = useRef(0);
  const lastWatchTimeUpdateRef = useRef(0);
  const sourceConfirmedWorkingRef = useRef(false);
  const pendingSeekTimeRef = useRef<number | null>(initialTime > 0 ? initialTime : null);

  const handleVolumeChange = useCallback((videoEl: HTMLVideoElement | null, value: number) => {
    if (!videoEl) return;
    const newVolume = value / 100;
    const newMuted = newVolume === 0;
    videoEl.volume = newVolume;
    setVolumeState(newVolume);
    setMutedState(newMuted);
    saveVolumeSettings(newVolume, newMuted);
  }, []);

  const toggleMute = useCallback((videoEl: HTMLVideoElement | null) => {
    if (!videoEl) return;
    const newMuted = !muted;
    videoEl.muted = newMuted;
    setMutedState(newMuted);
    saveVolumeSettings(volume, newMuted);
  }, [muted, volume]);

  const state: PlayerState = {
    playing,
    buffering,
    currentTime,
    duration,
    volume,
    muted,
    quality,
    currentSourceIndex,
    error,
    subtitlesEnabled,
    currentSubtitleLanguage,
    loading,
    buffered,
    fullscreen,
    playbackSpeed,
  };

  return {
    state,
    setPlaying,
    setBuffering,
    setCurrentTime,
    setDuration,
    setVolume: setVolumeState,
    setMuted: setMutedState,
    setLoading,
    setError,
    setBuffered,
    setFullscreen,
    setCurrentSourceIndex,
    setPlaybackSpeed,
    setSubtitlesEnabled,
    setCurrentSubtitleLanguage,
    setQuality,
    handleVolumeChange,
    toggleMute,
    availableSources,
    setAvailableSources,
    hlsLevels,
    setHlsLevels,
    currentHlsLevel,
    setCurrentHlsLevel,
    lastTimeUpdateRef,
    lastWatchTimeUpdateRef,
    sourceConfirmedWorkingRef,
    pendingSeekTimeRef,
  };
}

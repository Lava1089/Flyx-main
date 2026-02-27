/**
 * Shared Player Core Types
 * 
 * Centralized type definitions used by all player hooks and both
 * desktop/mobile player shells.
 * 
 * Requirements: 6.1
 */

export interface PlayerState {
  playing: boolean;
  buffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  quality: string;
  currentSourceIndex: number;
  error: string | null;
  subtitlesEnabled: boolean;
  currentSubtitleLanguage: string;
  loading: boolean;
  buffered: number; // percentage 0-100
  fullscreen: boolean;
  playbackSpeed: number;
}

export interface PlayerSource {
  url: string;
  title?: string;
  quality?: string;
  type?: 'hls' | 'mp4';
  provider?: string;
  requiresSegmentProxy?: boolean;
  skipOrigin?: boolean;
  directUrl?: string;
  referer?: string;
  language?: string;
  server?: string;
  status?: 'working' | 'down' | 'unknown';
  skipIntro?: [number, number];
  skipOutro?: [number, number];
}

export interface PlayerSubtitleTrack {
  id: string;
  url: string;
  language: string;
  langCode?: string;
  iso639?: string;
  format?: string;
  fileName?: string;
  isCustom?: boolean;
  qualityScore?: number;
}

export interface HlsQualityLevel {
  height: number;
  bitrate: number;
  index: number;
}

export type PlaybackSpeedOption = 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2;

export const PLAYBACK_SPEED_OPTIONS: PlaybackSpeedOption[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

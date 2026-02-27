/**
 * Player Core — Shared hooks for desktop and mobile video players
 * 
 * Requirements: 6.1, 6.5, 6.6
 */

export { usePlayerState } from './usePlayerState';
export { useHlsPlayer } from './useHlsPlayer';
export { useSubtitles } from './useSubtitles';
export { usePlaybackProgress } from './usePlaybackProgress';
export { useSourceSwitcher } from './useSourceSwitcher';

export type { PlayerState, PlayerSource, PlayerSubtitleTrack, HlsQualityLevel, PlaybackSpeedOption } from './types';
export { PLAYBACK_SPEED_OPTIONS } from './types';

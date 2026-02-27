/**
 * useSubtitles — Subtitle loading, rendering, preference persistence
 * 
 * Manages subtitle fetching from OpenSubtitles API, custom VTT/SRT file uploads,
 * subtitle track loading onto the video element, timing offset adjustments,
 * SRT-to-VTT conversion, and user preference persistence.
 * 
 * Requirements: 6.1, 6.6
 */
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  getSubtitlePreferences,
  setSubtitlesEnabled as persistSubtitlesEnabled,
  setSubtitleLanguage as persistSubtitleLanguage,
  getSubtitleStyle,
  setSubtitleStyle as persistSubtitleStyle,
  type SubtitleStyle,
} from '@/lib/utils/subtitle-preferences';
import type { PlayerSubtitleTrack } from './types';

export interface UseSubtitlesOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  tmdbId: string;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
}

export interface UseSubtitlesReturn {
  // State
  availableSubtitles: PlayerSubtitleTrack[];
  currentSubtitle: string | null;
  subtitlesLoading: boolean;
  subtitleStyle: SubtitleStyle;
  subtitleOffset: number;
  customSubtitles: PlayerSubtitleTrack[];
  // Actions
  loadSubtitle: (subtitle: PlayerSubtitleTrack | null, offset?: number) => void;
  fetchSubtitles: (imdbId: string) => Promise<void>;
  handleSubtitleFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  adjustSubtitleOffset: (delta: number) => void;
  resetSubtitleOffset: () => void;
  updateSubtitleStyle: (newStyle: Partial<SubtitleStyle>) => void;
  resyncSubtitles: () => void;
  restoreSubtitles: () => void;
  // Refs
  subtitleFileInputRef: React.RefObject<HTMLInputElement | null>;
  currentSubtitleDataRef: React.MutableRefObject<PlayerSubtitleTrack | null>;
}

export function useSubtitles(options: UseSubtitlesOptions): UseSubtitlesReturn {
  const { videoRef, tmdbId, mediaType, season, episode } = options;

  const [availableSubtitles, setAvailableSubtitles] = useState<PlayerSubtitleTrack[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState<string | null>(null);
  const [subtitlesLoading, setSubtitlesLoading] = useState(false);
  const [subtitleStyle, setSubtitleStyleState] = useState<SubtitleStyle>(getSubtitleStyle());
  const [subtitleOffset, setSubtitleOffset] = useState(0);
  const [customSubtitles, setCustomSubtitles] = useState<PlayerSubtitleTrack[]>([]);

  const subtitleFileInputRef = useRef<HTMLInputElement>(null);
  const currentSubtitleDataRef = useRef<PlayerSubtitleTrack | null>(null);
  const subtitlesAutoLoadedRef = useRef(false);

  const resyncSubtitles = useCallback(() => {
    if (!videoRef.current?.textTracks) return;
    const video = videoRef.current;
    for (let i = 0; i < video.textTracks.length; i++) {
      const track = video.textTracks[i];
      if (track.mode === 'showing') {
        track.mode = 'hidden';
        requestAnimationFrame(() => { track.mode = 'showing'; });
      }
    }
  }, [videoRef]);

  const loadSubtitle = useCallback((subtitle: PlayerSubtitleTrack | null, offset: number = 0) => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    // Disable all existing text tracks
    if (video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = 'disabled';
      }
    }
    // Remove all track elements
    video.querySelectorAll('track').forEach(t => t.remove());

    currentSubtitleDataRef.current = subtitle;

    if (subtitle) {
      const cacheBuster = Date.now();
      const langCode = subtitle.iso639 || subtitle.langCode || '';
      const subtitleUrl = subtitle.isCustom
        ? subtitle.url
        : `/api/subtitle-proxy?url=${encodeURIComponent(subtitle.url)}&lang=${encodeURIComponent(langCode)}&_t=${cacheBuster}`;

      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = subtitle.language || 'Subtitles';
      track.srclang = subtitle.iso639 || 'en';
      track.src = subtitleUrl;
      track.default = true;

      track.addEventListener('load', () => {
        if (!videoRef.current?.textTracks) return;
        for (let i = 0; i < videoRef.current.textTracks.length; i++) {
          const textTrack = videoRef.current.textTracks[i];
          if (offset !== 0 && textTrack.cues) {
            for (let j = 0; j < textTrack.cues.length; j++) {
              const cue = textTrack.cues[j] as VTTCue;
              cue.startTime = Math.max(0, cue.startTime + offset);
              cue.endTime = Math.max(0, cue.endTime + offset);
            }
          }
          textTrack.mode = 'hidden';
        }
        requestAnimationFrame(() => {
          if (!videoRef.current?.textTracks) return;
          for (let i = 0; i < videoRef.current.textTracks.length; i++) {
            videoRef.current.textTracks[i].mode = 'showing';
          }
        });
      });

      video.appendChild(track);

      // Delayed sync fallback
      setTimeout(() => {
        if (!videoRef.current?.textTracks) return;
        for (let i = 0; i < videoRef.current.textTracks.length; i++) {
          const textTrack = videoRef.current.textTracks[i];
          if (textTrack.mode !== 'showing') {
            textTrack.mode = 'hidden';
            requestAnimationFrame(() => { textTrack.mode = 'showing'; });
          }
        }
      }, 500);

      setCurrentSubtitle(subtitle.id);
      persistSubtitleLanguage(subtitle.langCode || '', subtitle.language || '');
      persistSubtitlesEnabled(true);
      if (offset === 0) setSubtitleOffset(0);
    } else {
      currentSubtitleDataRef.current = null;
      setCurrentSubtitle(null);
      persistSubtitlesEnabled(false);
      setSubtitleOffset(0);
    }
  }, [videoRef]);

  const restoreSubtitles = useCallback(() => {
    if (currentSubtitleDataRef.current) {
      setTimeout(() => {
        loadSubtitle(currentSubtitleDataRef.current, subtitleOffset);
      }, 100);
    }
  }, [loadSubtitle, subtitleOffset]);

  const fetchSubtitles = useCallback(async (imdbId: string) => {
    try {
      setSubtitlesLoading(true);
      const params = new URLSearchParams({ imdbId });
      if (mediaType === 'tv' && season && episode) {
        params.append('season', season.toString());
        params.append('episode', episode.toString());
      }
      const response = await fetch(`/api/subtitles?${params}`);
      const data = await response.json();
      if (data.success && Array.isArray(data.subtitles)) {
        setAvailableSubtitles(data.subtitles);
      } else {
        setAvailableSubtitles([]);
      }
    } catch {
      setAvailableSubtitles([]);
    } finally {
      setSubtitlesLoading(false);
    }
  }, [mediaType, season, episode]);

  const adjustSubtitleOffset = useCallback((delta: number) => {
    setSubtitleOffset(prev => {
      const newOffset = prev + delta;
      if (videoRef.current?.textTracks) {
        for (let i = 0; i < videoRef.current.textTracks.length; i++) {
          const textTrack = videoRef.current.textTracks[i];
          if (textTrack.cues) {
            for (let j = 0; j < textTrack.cues.length; j++) {
              const cue = textTrack.cues[j] as VTTCue;
              cue.startTime = Math.max(0, cue.startTime + delta);
              cue.endTime = Math.max(0, cue.endTime + delta);
            }
          }
        }
      }
      return newOffset;
    });
  }, [videoRef]);

  const resetSubtitleOffset = useCallback(() => {
    if (subtitleOffset !== 0 && currentSubtitleDataRef.current) {
      loadSubtitle(currentSubtitleDataRef.current, 0);
      setSubtitleOffset(0);
    }
  }, [subtitleOffset, loadSubtitle]);

  const updateSubtitleStyle = useCallback((newStyle: Partial<SubtitleStyle>) => {
    const updated = { ...subtitleStyle, ...newStyle };
    setSubtitleStyleState(updated);
    persistSubtitleStyle(updated);

    if (videoRef.current) {
      const styleId = 'dynamic-subtitle-style';
      let styleEl = document.getElementById(styleId) as HTMLStyleElement;
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }
      const bgOpacity = updated.backgroundOpacity / 100;
      styleEl.textContent = `
        video::cue {
          font-size: ${updated.fontSize}% !important;
          color: ${updated.textColor} !important;
          background-color: rgba(0, 0, 0, ${bgOpacity}) !important;
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8) !important;
          line: ${updated.verticalPosition}% !important;
        }
      `;
    }
  }, [subtitleStyle, videoRef]);

  const convertSrtToVtt = useCallback((srtContent: string): string => {
    let normalized = srtContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    let vttContent = 'WEBVTT\n\n';

    const srtBlockRegex = /(\d+)\n(\d{1,2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{3})\n([\s\S]*?)(?=\n\n\d+\n|\n*$)/g;
    let match;
    let blockCount = 0;

    while ((match = srtBlockRegex.exec(normalized)) !== null) {
      blockCount++;
      const startTime = match[2].replace(',', '.');
      const endTime = match[3].replace(',', '.');
      const text = match[4].trim();
      if (text) vttContent += `${startTime} --> ${endTime}\n${text}\n\n`;
    }

    if (blockCount === 0) {
      const lines = normalized.split('\n');
      let i = 0;
      while (i < lines.length) {
        while (i < lines.length && (lines[i].trim() === '' || /^\d+$/.test(lines[i].trim()))) i++;
        if (i >= lines.length) break;
        const timestampMatch = lines[i].match(/(\d{1,2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{3})/);
        if (timestampMatch) {
          const startTime = timestampMatch[1].replace(',', '.');
          const endTime = timestampMatch[2].replace(',', '.');
          i++;
          const textLines: string[] = [];
          while (i < lines.length && lines[i].trim() !== '' && !/^\d+$/.test(lines[i].trim())) {
            textLines.push(lines[i]);
            i++;
          }
          if (textLines.length > 0) vttContent += `${startTime} --> ${endTime}\n${textLines.join('\n')}\n\n`;
        } else {
          i++;
        }
      }
    }

    return vttContent;
  }, []);

  const handleSubtitleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validTypes = ['.vtt', '.srt'];
    const fileExtension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!validTypes.includes(fileExtension)) {
      alert('Please upload a .vtt or .srt subtitle file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      let content = e.target?.result as string;
      if (!content) return;

      if (fileExtension === '.srt') content = convertSrtToVtt(content);
      if (!content.startsWith('WEBVTT')) content = 'WEBVTT\n\n' + content;

      const blob = new Blob([content], { type: 'text/vtt' });
      const blobUrl = URL.createObjectURL(blob);

      const fileName = file.name.toLowerCase();
      let language = 'Custom';
      if (fileName.includes('english') || fileName.includes('.en.')) language = 'English (Custom)';
      else if (fileName.includes('spanish') || fileName.includes('.es.')) language = 'Spanish (Custom)';
      else if (fileName.includes('french') || fileName.includes('.fr.')) language = 'French (Custom)';

      const customSub: PlayerSubtitleTrack = {
        id: `custom-${Date.now()}`,
        url: blobUrl,
        language,
        langCode: 'custom',
        format: 'vtt',
        fileName: file.name,
        isCustom: true,
        qualityScore: 100,
      };

      setCustomSubtitles(prev => [...prev, customSub]);
      setSubtitleOffset(0);
      loadSubtitle(customSub);
    };

    reader.readAsText(file);
    event.target.value = '';
  }, [convertSrtToVtt, loadSubtitle]);

  // Auto-load preferred subtitle when subtitles become available
  useEffect(() => {
    if (availableSubtitles.length === 0 || subtitlesAutoLoadedRef.current) return;
    const preferences = getSubtitlePreferences();
    if (preferences.enabled) {
      const preferred = availableSubtitles.find(sub => sub.langCode === preferences.languageCode);
      if (preferred) {
        loadSubtitle(preferred);
        subtitlesAutoLoadedRef.current = true;
      } else {
        const english = availableSubtitles.find(sub => sub.langCode === 'eng');
        if (english) {
          loadSubtitle(english);
          subtitlesAutoLoadedRef.current = true;
        }
      }
    }
  }, [availableSubtitles, loadSubtitle]);

  // Apply subtitle style on mount
  useEffect(() => {
    updateSubtitleStyle(subtitleStyle);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset auto-load flag when content changes
  useEffect(() => {
    subtitlesAutoLoadedRef.current = false;
  }, [tmdbId, season, episode]);

  return {
    availableSubtitles,
    currentSubtitle,
    subtitlesLoading,
    subtitleStyle,
    subtitleOffset,
    customSubtitles,
    loadSubtitle,
    fetchSubtitles,
    handleSubtitleFileUpload,
    adjustSubtitleOffset,
    resetSubtitleOffset,
    updateSubtitleStyle,
    resyncSubtitles,
    restoreSubtitles,
    subtitleFileInputRef,
    currentSubtitleDataRef,
  };
}

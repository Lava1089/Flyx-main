'use client';

/**
 * PrimeSrc Turnstile Solver
 *
 * Renders an invisible Cloudflare Turnstile widget that solves the challenge
 * in the browser. The token is then passed to the CF Worker to call /api/v1/l.
 *
 * Sitekey: 0x4AAAAAACox-LngVREu55Y4 (from primesrc.me)
 * Appearance: interaction-only (invisible until user interaction needed)
 */

import { useEffect, useRef, useCallback, useState } from 'react';

const TURNSTILE_SITEKEY = '0x4AAAAAACox-LngVREu55Y4';
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

interface PrimeSrcTurnstileProps {
  onToken: (token: string) => void;
  onError?: (error: string) => void;
  /** Auto-solve on mount (default: true) */
  autoSolve?: boolean;
}

// Global script loading state
let scriptLoaded = false;
let scriptLoading = false;
const scriptCallbacks: (() => void)[] = [];

function loadTurnstileScript(): Promise<void> {
  if (scriptLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    if (scriptLoading) {
      scriptCallbacks.push(resolve);
      return;
    }
    scriptLoading = true;
    const script = document.createElement('script');
    script.src = `${TURNSTILE_SCRIPT_URL}?render=explicit`;
    script.async = true;
    script.onload = () => {
      scriptLoaded = true;
      scriptLoading = false;
      resolve();
      scriptCallbacks.forEach(cb => cb());
      scriptCallbacks.length = 0;
    };
    script.onerror = () => {
      scriptLoading = false;
      resolve(); // Resolve anyway, render will handle missing window.turnstile
    };
    document.head.appendChild(script);
  });
}

export default function PrimeSrcTurnstile({ onToken, onError, autoSolve = true }: PrimeSrcTurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  const renderWidget = useCallback(() => {
    if (!containerRef.current) return;
    if (widgetIdRef.current !== null) return; // Already rendered

    const turnstile = (window as any).turnstile;
    if (!turnstile) {
      onError?.('Turnstile script not loaded');
      return;
    }

    try {
      const id = turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITEKEY,
        appearance: 'interaction-only',
        callback: (token: string) => {
          console.log('[PrimeSrc Turnstile] Token obtained:', token.substring(0, 20) + '...');
          onToken(token);
        },
        'error-callback': (err: any) => {
          console.error('[PrimeSrc Turnstile] Error:', err);
          onError?.(typeof err === 'string' ? err : 'Turnstile challenge failed');
        },
        'expired-callback': () => {
          console.log('[PrimeSrc Turnstile] Token expired, re-solving...');
          if (widgetIdRef.current !== null) {
            turnstile.reset(widgetIdRef.current);
          }
        },
        retry: 'auto',
        'retry-interval': 2000,
      });
      widgetIdRef.current = id;
      console.log('[PrimeSrc Turnstile] Widget rendered, id:', id);
    } catch (e) {
      console.error('[PrimeSrc Turnstile] Render error:', e);
      onError?.(e instanceof Error ? e.message : 'Failed to render Turnstile');
    }
  }, [onToken, onError]);

  useEffect(() => {
    if (!autoSolve) return;

    let cancelled = false;
    loadTurnstileScript().then(() => {
      if (cancelled) return;
      setReady(true);
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        if (!cancelled) renderWidget();
      }, 100);
    });

    return () => {
      cancelled = true;
      // Cleanup widget
      if (widgetIdRef.current !== null) {
        try {
          const turnstile = (window as any).turnstile;
          if (turnstile) turnstile.remove(widgetIdRef.current);
        } catch {}
        widgetIdRef.current = null;
      }
    };
  }, [autoSolve, renderWidget]);

  // The container is invisible — Turnstile only shows UI if interaction is needed
  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        bottom: 0,
        right: 0,
        zIndex: 9999,
        // Turnstile with interaction-only is invisible unless it needs user input
      }}
      aria-hidden="true"
    />
  );
}

/**
 * Hook to get a Turnstile token for PrimeSrc.
 * Returns { token, loading, error, refresh }.
 */
export function usePrimeSrcTurnstile() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleToken = useCallback((t: string) => {
    setToken(t);
    setLoading(false);
    setError(null);
  }, []);

  const handleError = useCallback((e: string) => {
    setError(e);
    setLoading(false);
  }, []);

  const refresh = useCallback(() => {
    setToken(null);
    setLoading(true);
    setError(null);
    // The component will re-render and re-solve
  }, []);

  return { token, loading, error, refresh, handleToken, handleError };
}

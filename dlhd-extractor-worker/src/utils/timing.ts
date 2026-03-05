/**
 * Timing Utility Module
 * 
 * Requirements: 7.4
 * - THE Worker SHALL include request timing information in responses for performance debugging
 * 
 * This module provides utilities for tracking and reporting timing information
 * across all request handlers.
 */

import { TimingInfo, ExtendedTimingInfo, TimingPhase } from '../types';

/**
 * Timer class for tracking request timing
 */
export class RequestTimer {
  private startTime: number;
  private phases: TimingPhase[] = [];
  private currentPhase: { name: string; startTime: number } | null = null;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Start a new timing phase
   * @param name - Name of the phase
   */
  startPhase(name: string): void {
    // End current phase if one is active
    if (this.currentPhase) {
      this.endPhase();
    }
    
    this.currentPhase = {
      name,
      startTime: Date.now(),
    };
  }

  /**
   * End the current timing phase
   */
  endPhase(): void {
    if (this.currentPhase) {
      const endTime = Date.now();
      this.phases.push({
        name: this.currentPhase.name,
        durationMs: endTime - this.currentPhase.startTime,
        startTime: new Date(this.currentPhase.startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
      });
      this.currentPhase = null;
    }
  }

  /**
   * Get basic timing information
   */
  getTimingInfo(): TimingInfo {
    const endTime = Date.now();
    return {
      durationMs: endTime - this.startTime,
      startTime: new Date(this.startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
    };
  }

  /**
   * Get extended timing information with phase breakdown
   */
  getExtendedTimingInfo(retryAttempts?: number, retryDurationMs?: number): ExtendedTimingInfo {
    // End any active phase
    if (this.currentPhase) {
      this.endPhase();
    }

    const endTime = Date.now();
    return {
      durationMs: endTime - this.startTime,
      startTime: new Date(this.startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      phases: this.phases.length > 0 ? [...this.phases] : undefined,
      retryAttempts,
      retryDurationMs,
    };
  }

  /**
   * Get the elapsed time since the timer started
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get the start time as an ISO string
   */
  getStartTimeISO(): string {
    return new Date(this.startTime).toISOString();
  }

  /**
   * Get the phases recorded so far
   */
  getPhases(): TimingPhase[] {
    return [...this.phases];
  }
}

/**
 * Create a simple timing info object
 * 
 * @param startTime - Start time in milliseconds (Date.now())
 * @returns TimingInfo object
 */
export function createTimingInfo(startTime: number): TimingInfo {
  const endTime = Date.now();
  return {
    durationMs: endTime - startTime,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
  };
}

/**
 * Measure the duration of an async function
 * 
 * @param fn - The async function to measure
 * @returns Object with result and timing info
 */
export async function measureAsync<T>(
  fn: () => Promise<T>
): Promise<{ result: T; timing: TimingInfo }> {
  const startTime = Date.now();
  const result = await fn();
  return {
    result,
    timing: createTimingInfo(startTime),
  };
}

/**
 * Measure the duration of a sync function
 * 
 * @param fn - The sync function to measure
 * @returns Object with result and timing info
 */
export function measureSync<T>(
  fn: () => T
): { result: T; timing: TimingInfo } {
  const startTime = Date.now();
  const result = fn();
  return {
    result,
    timing: createTimingInfo(startTime),
  };
}

/**
 * Format timing info for logging
 * 
 * @param timing - Timing info to format
 * @returns Formatted string
 */
export function formatTiming(timing: TimingInfo): string {
  return `${timing.durationMs}ms (started: ${timing.startTime})`;
}

/**
 * Format extended timing info for logging
 * 
 * @param timing - Extended timing info to format
 * @returns Formatted string
 */
export function formatExtendedTiming(timing: ExtendedTimingInfo): string {
  let result = `Total: ${timing.durationMs}ms`;
  
  if (timing.phases && timing.phases.length > 0) {
    const phaseStrings = timing.phases.map(p => `${p.name}: ${p.durationMs}ms`);
    result += ` [${phaseStrings.join(', ')}]`;
  }
  
  if (timing.retryAttempts !== undefined && timing.retryAttempts > 0) {
    result += ` (${timing.retryAttempts} retries, ${timing.retryDurationMs || 0}ms in retries)`;
  }
  
  return result;
}

/**
 * Calculate timing statistics from multiple timing infos
 * 
 * @param timings - Array of timing infos
 * @returns Statistics object
 */
export function calculateTimingStats(timings: TimingInfo[]): {
  count: number;
  totalMs: number;
  averageMs: number;
  minMs: number;
  maxMs: number;
} {
  if (timings.length === 0) {
    return {
      count: 0,
      totalMs: 0,
      averageMs: 0,
      minMs: 0,
      maxMs: 0,
    };
  }

  const durations = timings.map(t => t.durationMs);
  const totalMs = durations.reduce((sum, d) => sum + d, 0);

  return {
    count: timings.length,
    totalMs,
    averageMs: totalMs / timings.length,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
  };
}

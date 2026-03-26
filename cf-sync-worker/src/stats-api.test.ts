import { describe, it, expect } from 'vitest';
import { parseSlices, parseTimeRange, VALID_SLICES } from './stats-api';

// ---------------------------------------------------------------------------
// Unit tests for parseSlices
// ---------------------------------------------------------------------------

describe('parseSlices', () => {
  it('returns all valid slices when param is null', () => {
    expect(parseSlices(null)).toEqual([...VALID_SLICES]);
  });

  it('returns all valid slices when param is empty string', () => {
    const result = parseSlices('');
    expect(result).toEqual([...VALID_SLICES]);
  });

  it('filters to only valid slice names', () => {
    expect(parseSlices('realtime,invalid,users')).toEqual(['realtime', 'users']);
  });

  it('returns single valid slice', () => {
    expect(parseSlices('content')).toEqual(['content']);
  });
});

// ---------------------------------------------------------------------------
// Unit tests for parseTimeRange
// ---------------------------------------------------------------------------

describe('parseTimeRange', () => {
  it('parses hours correctly', () => {
    const now = Date.now();
    const [start, end] = parseTimeRange('24h', now);
    expect(end).toBe(now);
    expect(start).toBe(now - 24 * 60 * 60 * 1000);
  });

  it('parses days correctly', () => {
    const now = Date.now();
    const [start, end] = parseTimeRange('7d', now);
    expect(end).toBe(now);
    expect(start).toBe(now - 7 * 24 * 60 * 60 * 1000);
  });

  it('parses months correctly', () => {
    const now = Date.now();
    const [start, end] = parseTimeRange('3m', now);
    expect(end).toBe(now);
    expect(start).toBe(now - 3 * 30 * 24 * 60 * 60 * 1000);
  });

  it('defaults to 24h for invalid range', () => {
    const now = Date.now();
    const [start, end] = parseTimeRange('invalid', now);
    expect(end).toBe(now);
    expect(start).toBe(now - 24 * 60 * 60 * 1000);
  });
});

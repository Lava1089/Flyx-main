/**
 * Property-Based Tests for Channel Parsing
 * 
 * **Feature: dlhd-stream-extractor-worker, Property 1: Channel Parsing Completeness**
 * **Validates: Requirements 1.2**
 * 
 * For any valid DLHD channel listing HTML containing channel elements,
 * the Channel_Parser SHALL extract all channels with their id, name, category,
 * and status fields populated.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  parseChannelListHtml,
  parseChannelCard,
  extractChannelId,
  decodeHtmlEntities,
  ParseError,
} from '../src/discovery/parser';
import { Channel } from '../src/types';

/**
 * Generate a valid channel name (alphanumeric with spaces)
 */
const channelNameArb = fc.stringOf(
  fc.constantFrom(
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '.split('')
  ),
  { minLength: 1, maxLength: 50 }
).filter(s => s.trim().length > 0);

/**
 * Generate a valid channel ID (positive integer as string)
 */
const channelIdArb = fc.integer({ min: 1, max: 9999 }).map(String);

/**
 * Generate a single channel card HTML element
 */
const channelCardArb = fc.record({
  id: channelIdArb,
  name: channelNameArb,
  dataTitle: channelNameArb,
  dataFirst: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
}).map(({ id, name, dataTitle, dataFirst }) => {
  return `<a class="card" 
     href="/watch.php?id=${id}" 
     data-title="${dataTitle.toLowerCase()}"
     data-first="${dataFirst}">
    <div class="card__title">${name}</div>
    <div class="">ID: ${id}</div>
  </a>`;
});

/**
 * Generate a valid DLHD channels page HTML with multiple channel cards
 */
const channelsPageHtmlArb = fc.array(channelCardArb, { minLength: 1, maxLength: 20 })
  .map(cards => {
    return `<!DOCTYPE html>
<html>
<head><title>24/7 Channels</title></head>
<body>
<div class="grid">
${cards.join('\n')}
</div>
</body>
</html>`;
  });

describe('Channel Parser - Property Tests', () => {
  /**
   * Property 1: Channel Parsing Completeness
   * For any valid DLHD channel listing HTML containing channel elements,
   * the parser SHALL extract all channels with id, name, category, and status populated.
   */
  it('Property 1: All parsed channels have required fields populated', () => {
    fc.assert(
      fc.property(channelsPageHtmlArb, (html) => {
        const channels = parseChannelListHtml(html);
        
        // Every channel must have all required fields
        for (const channel of channels) {
          expect(channel.id).toBeDefined();
          expect(channel.id.length).toBeGreaterThan(0);
          expect(channel.name).toBeDefined();
          expect(channel.name.length).toBeGreaterThan(0);
          expect(channel.category).toBeDefined();
          expect(['24-7', 'live-event']).toContain(channel.category);
          expect(channel.status).toBeDefined();
          expect(['live', 'offline', 'scheduled']).toContain(channel.status);
        }
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Channel count matches card count
   * The number of parsed channels should equal the number of valid cards in HTML
   */
  it('Property: Parsed channel count matches input card count', () => {
    fc.assert(
      fc.property(
        fc.array(channelCardArb, { minLength: 1, maxLength: 20 }),
        (cards) => {
          const html = `<div class="grid">${cards.join('\n')}</div>`;
          const channels = parseChannelListHtml(html);
          
          // Should parse exactly as many channels as cards provided
          expect(channels.length).toBe(cards.length);
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Channel IDs are correctly extracted
   */
  it('Property: Channel IDs are correctly extracted from href', () => {
    fc.assert(
      fc.property(channelIdArb, (id) => {
        const href = `/watch.php?id=${id}`;
        const extractedId = extractChannelId(href);
        
        expect(extractedId).toBe(id);
        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Alternative URL formats are handled
   */
  it('Property: Stream URL format is correctly parsed', () => {
    fc.assert(
      fc.property(channelIdArb, (id) => {
        const href = `/watch/stream-${id}.php`;
        const extractedId = extractChannelId(href);
        
        expect(extractedId).toBe(id);
        return true;
      }),
      { numRuns: 100 }
    );
  });
});

describe('Channel Parser - Unit Tests', () => {
  it('should parse a single channel card correctly', () => {
    const cardHtml = `<a class="card" 
       href="/watch.php?id=51" 
       data-title="abc usa"
       data-first="A">
      <div class="card__title">ABC USA</div>
      <div class="">ID: 51</div>
    </a>`;
    
    const channel = parseChannelCard(cardHtml);
    
    expect(channel).not.toBeNull();
    expect(channel!.id).toBe('51');
    expect(channel!.name).toBe('ABC USA');
    expect(channel!.category).toBe('24-7');
    expect(channel!.status).toBe('live');
  });

  it('should decode HTML entities in channel names', () => {
    expect(decodeHtmlEntities('A&amp;E USA')).toBe('A&E USA');
    expect(decodeHtmlEntities('Test &lt;Channel&gt;')).toBe('Test <Channel>');
    expect(decodeHtmlEntities('Quote &quot;Test&quot;')).toBe('Quote "Test"');
  });

  it('should throw ParseError when no channels found', () => {
    const emptyHtml = '<html><body><div class="grid"></div></body></html>';
    
    expect(() => parseChannelListHtml(emptyHtml)).toThrow(ParseError);
  });

  it('should extract channel ID from various URL formats', () => {
    expect(extractChannelId('/watch.php?id=123')).toBe('123');
    expect(extractChannelId('/watch/stream-456.php')).toBe('456');
    expect(extractChannelId('/casting/stream-789.php')).toBe('789');
    expect(extractChannelId('/invalid/path')).toBeNull();
  });

  it('should parse multiple channels from HTML', () => {
    const html = `
      <div class="grid">
        <a class="card" href="/watch.php?id=1" data-title="channel 1" data-first="C">
          <div class="card__title">Channel 1</div>
        </a>
        <a class="card" href="/watch.php?id=2" data-title="channel 2" data-first="C">
          <div class="card__title">Channel 2</div>
        </a>
        <a class="card" href="/watch.php?id=3" data-title="channel 3" data-first="C">
          <div class="card__title">Channel 3</div>
        </a>
      </div>
    `;
    
    const channels = parseChannelListHtml(html);
    
    expect(channels.length).toBe(3);
    expect(channels[0].id).toBe('1');
    expect(channels[1].id).toBe('2');
    expect(channels[2].id).toBe('3');
  });
});

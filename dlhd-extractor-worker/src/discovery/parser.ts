/**
 * DLHD Channel HTML Parser
 * Parses channel listings from DLHD HTML pages
 */

import { Channel, ScheduledEvent } from '../types';

/**
 * Error thrown when parsing fails due to site structure changes
 */
export class ParseError extends Error {
  code: string;
  
  constructor(message: string, code: string = 'PARSE_ERROR') {
    super(message);
    this.name = 'ParseError';
    this.code = code;
  }
}

/**
 * Extract channel ID from href attribute
 * Handles formats like "/watch.php?id=51" or "/watch/stream-51.php"
 */
export function extractChannelId(href: string): string | null {
  // Format: /watch.php?id=XX
  const watchMatch = href.match(/\/watch\.php\?id=(\d+)/);
  if (watchMatch) {
    return watchMatch[1];
  }
  
  // Format: /watch/stream-XX.php
  const streamMatch = href.match(/\/watch\/stream-(\d+)\.php/);
  if (streamMatch) {
    return streamMatch[1];
  }
  
  // Format: /casting/stream-XX.php
  const castingMatch = href.match(/\/casting\/stream-(\d+)\.php/);
  if (castingMatch) {
    return castingMatch[1];
  }
  
  return null;
}

/**
 * Parse a single channel card element from HTML
 */
export function parseChannelCard(cardHtml: string): Channel | null {
  // Extract href
  const hrefMatch = cardHtml.match(/href="([^"]+)"/);
  if (!hrefMatch) return null;
  
  const href = hrefMatch[1];
  const id = extractChannelId(href);
  if (!id) return null;
  
  // Extract data-title attribute (lowercase channel name)
  const dataTitleMatch = cardHtml.match(/data-title="([^"]+)"/);
  
  // Extract card__title content (display name)
  const titleMatch = cardHtml.match(/<div class="card__title">([^<]+)<\/div>/);
  
  // Use data-title or card__title for the name
  let name = '';
  if (titleMatch) {
    name = decodeHtmlEntities(titleMatch[1].trim());
  } else if (dataTitleMatch) {
    name = decodeHtmlEntities(dataTitleMatch[1].trim());
  }
  
  if (!name) return null;
  
  // Extract data-first attribute (first letter for filtering)
  const dataFirstMatch = cardHtml.match(/data-first="([^"]+)"/);
  
  // Determine category based on page context (will be set by caller)
  // Default to '24-7' for channel listings
  const category: '24-7' | 'live-event' = '24-7';
  
  return {
    id,
    name,
    category,
    status: 'live', // 24/7 channels are always "live"
  };
}

/**
 * Decode HTML entities in a string
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

/**
 * Parse all channel cards from 24/7 channels page HTML
 */
export function parseChannelListHtml(html: string): Channel[] {
  const channels: Channel[] = [];
  
  // Find all card elements with href to watch.php
  // Pattern: <a class="card" href="/watch.php?id=XX" ...>
  const cardPattern = /<a\s+class="card"[^>]*href="\/watch\.php\?id=\d+"[^>]*>[\s\S]*?<\/a>/gi;
  const cardMatches = html.match(cardPattern);
  
  if (!cardMatches || cardMatches.length === 0) {
    throw new ParseError(
      'No channel cards found in HTML. Site structure may have changed.',
      'PARSE_ERROR'
    );
  }
  
  for (const cardHtml of cardMatches) {
    const channel = parseChannelCard(cardHtml);
    if (channel) {
      channels.push(channel);
    }
  }
  
  return channels;
}

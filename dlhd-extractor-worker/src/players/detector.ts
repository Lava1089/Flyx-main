/**
 * Player Source Detector
 * Detects and extracts all 6 player sources from DLHD channel pages
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

import { PlayerSource } from '../types';

/**
 * Error thrown when player detection fails
 */
export class PlayerDetectionError extends Error {
  code: string;
  
  constructor(message: string, code: string = 'PLAYER_DETECTION_ERROR') {
    super(message);
    this.name = 'PlayerDetectionError';
    this.code = code;
  }
}

/**
 * Player configuration with priority and name mappings
 * Lower priority number = higher reliability/quality
 */
const PLAYER_CONFIG: Record<number, { name: string; priority: number }> = {
  1: { name: 'Player 1', priority: 1 },
  2: { name: 'Player 2', priority: 2 },
  3: { name: 'Player 3', priority: 3 },
  4: { name: 'Player 4', priority: 4 },
  5: { name: 'Player 5', priority: 5 },
  6: { name: 'Player 6', priority: 6 },
};

/**
 * Extract player embed URL from onclick attribute or href
 * Handles various patterns used by DLHD
 */
export function extractEmbedUrl(element: string, channelId: string): string | null {
  // Pattern 1: onclick="loadPlayer(X)" or similar
  const onclickMatch = element.match(/onclick\s*=\s*["']loadPlayer\((\d+)\)["']/i);
  if (onclickMatch) {
    const playerId = onclickMatch[1];
    return `/embed.php?id=${channelId}&player=${playerId}`;
  }
  
  // Pattern 2: data-player="X" attribute
  const dataPlayerMatch = element.match(/data-player\s*=\s*["'](\d+)["']/i);
  if (dataPlayerMatch) {
    const playerId = dataPlayerMatch[1];
    return `/embed.php?id=${channelId}&player=${playerId}`;
  }
  
  // Pattern 3: href with embed URL
  const hrefMatch = element.match(/href\s*=\s*["']([^"']*embed[^"']*)["']/i);
  if (hrefMatch) {
    return hrefMatch[1];
  }
  
  // Pattern 4: iframe src with embed URL
  const iframeSrcMatch = element.match(/src\s*=\s*["']([^"']*embed[^"']*)["']/i);
  if (iframeSrcMatch) {
    return iframeSrcMatch[1];
  }
  
  // Pattern 5: JavaScript variable assignment for player URL
  const jsVarMatch = element.match(/player\d*_?url\s*=\s*["']([^"']+)["']/i);
  if (jsVarMatch) {
    return jsVarMatch[1];
  }
  
  return null;
}

/**
 * Detect player buttons/links from channel page HTML
 * Returns raw player elements for further processing
 */
export function detectPlayerElements(html: string): Map<number, string> {
  const playerElements = new Map<number, string>();
  
  // Pattern 1: Player buttons with onclick handlers
  // e.g., <button onclick="loadPlayer(1)">Player 1</button>
  const buttonPattern = /<(?:button|a|div)[^>]*(?:onclick|data-player)\s*=\s*["'][^"']*(\d+)[^"']*["'][^>]*>[\s\S]*?<\/(?:button|a|div)>/gi;
  let match;
  
  while ((match = buttonPattern.exec(html)) !== null) {
    const playerId = parseInt(match[1], 10);
    if (playerId >= 1 && playerId <= 6) {
      playerElements.set(playerId, match[0]);
    }
  }
  
  // Pattern 2: Player tabs/links with player number in text or class
  // e.g., <a class="player-tab" data-player="1">Server 1</a>
  const tabPattern = /<(?:a|li|div)[^>]*class\s*=\s*["'][^"']*(?:player|server|tab)[^"']*["'][^>]*>[\s\S]*?(?:player|server)\s*(\d+)[\s\S]*?<\/(?:a|li|div)>/gi;
  
  while ((match = tabPattern.exec(html)) !== null) {
    const playerId = parseInt(match[1], 10);
    if (playerId >= 1 && playerId <= 6 && !playerElements.has(playerId)) {
      playerElements.set(playerId, match[0]);
    }
  }
  
  // Pattern 3: Iframe sources for each player
  // e.g., <iframe id="player1" src="...">
  const iframePattern = /<iframe[^>]*(?:id\s*=\s*["']player(\d+)["']|data-player\s*=\s*["'](\d+)["'])[^>]*>/gi;
  
  while ((match = iframePattern.exec(html)) !== null) {
    const playerId = parseInt(match[1] || match[2], 10);
    if (playerId >= 1 && playerId <= 6 && !playerElements.has(playerId)) {
      playerElements.set(playerId, match[0]);
    }
  }
  
  // Pattern 4: JavaScript player configuration
  // e.g., players[1] = "embed_url"
  const jsConfigPattern = /players?\[(\d+)\]\s*=\s*["']([^"']+)["']/gi;
  
  while ((match = jsConfigPattern.exec(html)) !== null) {
    const playerId = parseInt(match[1], 10);
    if (playerId >= 1 && playerId <= 6 && !playerElements.has(playerId)) {
      // Create a synthetic element with the URL
      playerElements.set(playerId, `<a href="${match[2]}" data-player="${playerId}">Player ${playerId}</a>`);
    }
  }
  
  return playerElements;
}

/**
 * Build embed URL for a specific player
 */
export function buildEmbedUrl(channelId: string, playerId: number, baseUrl?: string): string {
  const base = baseUrl || 'https://dlhd.link';
  return `${base}/embed.php?id=${channelId}&player=${playerId}`;
}

/**
 * Detect all player sources from channel page HTML
 * Returns players sorted by priority (lower = better)
 * 
 * Requirements:
 * - 2.1: Identify all 6 available player sources
 * - 2.2: Extract embed URL for each player
 * - 2.3: Mark unavailable players as unavailable
 * - 2.4: Return sorted by priority
 */
export function detectPlayers(channelPageHtml: string, channelId: string): PlayerSource[] {
  const playerElements = detectPlayerElements(channelPageHtml);
  const players: PlayerSource[] = [];
  
  // Process all 6 possible players
  for (let playerId = 1; playerId <= 6; playerId++) {
    const config = PLAYER_CONFIG[playerId];
    const element = playerElements.get(playerId);
    
    if (element) {
      // Player element found - extract embed URL
      const embedUrl = extractEmbedUrl(element, channelId) || buildEmbedUrl(channelId, playerId);
      
      players.push({
        id: playerId,
        name: config.name,
        embedUrl: embedUrl.startsWith('http') ? embedUrl : `https://dlhd.link${embedUrl}`,
        available: true,
        priority: config.priority,
      });
    } else {
      // Player not found in HTML - mark as unavailable but still include
      // This allows fallback attempts even if not explicitly shown
      players.push({
        id: playerId,
        name: config.name,
        embedUrl: buildEmbedUrl(channelId, playerId),
        available: false,
        priority: config.priority + 100, // Lower priority for unavailable players
      });
    }
  }
  
  // Sort by priority (lower = better)
  players.sort((a, b) => a.priority - b.priority);
  
  return players;
}

/**
 * Get available players only (filters out unavailable)
 */
export function getAvailablePlayers(players: PlayerSource[]): PlayerSource[] {
  return players.filter(p => p.available);
}

/**
 * Get the best available player (lowest priority number)
 */
export function getBestPlayer(players: PlayerSource[]): PlayerSource | null {
  const available = getAvailablePlayers(players);
  return available.length > 0 ? available[0] : null;
}

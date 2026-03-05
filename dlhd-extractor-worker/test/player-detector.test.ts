/**
 * Property-Based Tests for Player Detection
 * 
 * **Feature: dlhd-stream-extractor-worker, Property 2: Player Detection Completeness**
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 * 
 * For any valid DLHD channel page HTML, the Player_Detector SHALL:
 * - Identify all present player sources (up to 6)
 * - Extract a valid embed URL for each detected player
 * - Mark missing players as unavailable without throwing errors
 * - Return players sorted by priority (lower priority number = higher reliability)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  detectPlayers,
  detectPlayerElements,
  extractEmbedUrl,
  buildEmbedUrl,
  getAvailablePlayers,
  getBestPlayer,
} from '../src/players/detector';
import { PlayerSource } from '../src/types';

/**
 * Generate a valid channel ID (positive integer as string)
 */
const channelIdArb = fc.integer({ min: 1, max: 9999 }).map(String);

/**
 * Generate a subset of player IDs (1-6)
 */
const playerIdsSubsetArb = fc.subarray([1, 2, 3, 4, 5, 6], { minLength: 0, maxLength: 6 });

/**
 * Generate a player button HTML element
 */
function generatePlayerButton(playerId: number): string {
  return `<button onclick="loadPlayer(${playerId})" class="player-btn">Player ${playerId}</button>`;
}

/**
 * Generate a player tab HTML element
 */
function generatePlayerTab(playerId: number): string {
  return `<a class="player-tab" data-player="${playerId}">Server ${playerId}</a>`;
}

/**
 * Generate a player iframe HTML element
 */
function generatePlayerIframe(playerId: number, channelId: string): string {
  return `<iframe id="player${playerId}" src="/embed.php?id=${channelId}&player=${playerId}"></iframe>`;
}

/**
 * Generate channel page HTML with specified players
 */
const channelPageHtmlArb = fc.record({
  channelId: channelIdArb,
  playerIds: playerIdsSubsetArb,
  useButtons: fc.boolean(),
  useTabs: fc.boolean(),
  useIframes: fc.boolean(),
}).map(({ channelId, playerIds, useButtons, useTabs, useIframes }) => {
  const playerElements: string[] = [];
  
  for (const playerId of playerIds) {
    if (useButtons) {
      playerElements.push(generatePlayerButton(playerId));
    } else if (useTabs) {
      playerElements.push(generatePlayerTab(playerId));
    } else if (useIframes) {
      playerElements.push(generatePlayerIframe(playerId, channelId));
    } else {
      // Default to buttons
      playerElements.push(generatePlayerButton(playerId));
    }
  }
  
  return {
    html: `<!DOCTYPE html>
<html>
<head><title>Channel ${channelId}</title></head>
<body>
<div class="player-container">
${playerElements.join('\n')}
</div>
<div id="video-player"></div>
</body>
</html>`,
    channelId,
    playerIds,
  };
});

describe('Player Detector - Property Tests', () => {
  /**
   * Property 2: Player Detection Completeness
   * For any valid DLHD channel page HTML, the Player_Detector SHALL identify
   * all present player sources (up to 6).
   */
  it('Property 2.1: Detects all present player sources', () => {
    fc.assert(
      fc.property(channelPageHtmlArb, ({ html, channelId, playerIds }) => {
        const players = detectPlayers(html, channelId);
        const availablePlayers = getAvailablePlayers(players);
        
        // All players in the HTML should be detected as available
        for (const playerId of playerIds) {
          const player = availablePlayers.find(p => p.id === playerId);
          expect(player).toBeDefined();
          expect(player?.available).toBe(true);
        }
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2.2: Extract valid embed URL for each detected player
   */
  it('Property 2.2: Each detected player has a valid embed URL', () => {
    fc.assert(
      fc.property(channelPageHtmlArb, ({ html, channelId, playerIds }) => {
        const players = detectPlayers(html, channelId);
        
        for (const player of players) {
          // Every player must have an embed URL
          expect(player.embedUrl).toBeDefined();
          expect(player.embedUrl.length).toBeGreaterThan(0);
          
          // Embed URL should be a valid URL format
          expect(player.embedUrl).toMatch(/^https?:\/\//);
          
          // Embed URL should contain the channel ID
          expect(player.embedUrl).toContain(channelId);
        }
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2.3: Missing players are marked as unavailable without errors
   */
  it('Property 2.3: Missing players are marked unavailable, not throwing', () => {
    fc.assert(
      fc.property(channelPageHtmlArb, ({ html, channelId, playerIds }) => {
        // Should not throw for any input
        const players = detectPlayers(html, channelId);
        
        // Should always return exactly 6 players
        expect(players.length).toBe(6);
        
        // Players not in HTML should be marked unavailable
        for (const player of players) {
          if (!playerIds.includes(player.id)) {
            expect(player.available).toBe(false);
          }
        }
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2.4: Players are sorted by priority (lower = better)
   */
  it('Property 2.4: Players are sorted by priority', () => {
    fc.assert(
      fc.property(channelPageHtmlArb, ({ html, channelId }) => {
        const players = detectPlayers(html, channelId);
        
        // Verify sorted by priority
        for (let i = 1; i < players.length; i++) {
          expect(players[i].priority).toBeGreaterThanOrEqual(players[i - 1].priority);
        }
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Available players come before unavailable in sorted order
   */
  it('Property: Available players have lower priority than unavailable', () => {
    fc.assert(
      fc.property(channelPageHtmlArb, ({ html, channelId }) => {
        const players = detectPlayers(html, channelId);
        const availablePlayers = players.filter(p => p.available);
        const unavailablePlayers = players.filter(p => !p.available);
        
        // All available players should have lower priority than unavailable
        if (availablePlayers.length > 0 && unavailablePlayers.length > 0) {
          const maxAvailablePriority = Math.max(...availablePlayers.map(p => p.priority));
          const minUnavailablePriority = Math.min(...unavailablePlayers.map(p => p.priority));
          expect(maxAvailablePriority).toBeLessThan(minUnavailablePriority);
        }
        
        return true;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: getBestPlayer returns the lowest priority available player
   */
  it('Property: getBestPlayer returns lowest priority available player', () => {
    fc.assert(
      fc.property(channelPageHtmlArb, ({ html, channelId, playerIds }) => {
        const players = detectPlayers(html, channelId);
        const bestPlayer = getBestPlayer(players);
        
        if (playerIds.length === 0) {
          // No available players
          expect(bestPlayer).toBeNull();
        } else {
          // Best player should be available
          expect(bestPlayer).not.toBeNull();
          expect(bestPlayer?.available).toBe(true);
          
          // Best player should have lowest priority among available
          const availablePlayers = getAvailablePlayers(players);
          const minPriority = Math.min(...availablePlayers.map(p => p.priority));
          expect(bestPlayer?.priority).toBe(minPriority);
        }
        
        return true;
      }),
      { numRuns: 100 }
    );
  });
});

describe('Player Detector - Unit Tests', () => {
  it('should detect player buttons with onclick handlers', () => {
    const html = `
      <div class="players">
        <button onclick="loadPlayer(1)">Player 1</button>
        <button onclick="loadPlayer(2)">Player 2</button>
        <button onclick="loadPlayer(3)">Player 3</button>
      </div>
    `;
    
    const elements = detectPlayerElements(html);
    
    expect(elements.size).toBe(3);
    expect(elements.has(1)).toBe(true);
    expect(elements.has(2)).toBe(true);
    expect(elements.has(3)).toBe(true);
  });

  it('should detect player tabs with data-player attribute', () => {
    const html = `
      <div class="player-tabs">
        <a class="player-tab" data-player="1">Server 1</a>
        <a class="player-tab" data-player="2">Server 2</a>
      </div>
    `;
    
    const elements = detectPlayerElements(html);
    
    expect(elements.size).toBe(2);
    expect(elements.has(1)).toBe(true);
    expect(elements.has(2)).toBe(true);
  });

  it('should detect player iframes', () => {
    const html = `
      <div class="video-container">
        <iframe id="player1" src="/embed.php?id=51&player=1"></iframe>
      </div>
    `;
    
    const elements = detectPlayerElements(html);
    
    expect(elements.size).toBe(1);
    expect(elements.has(1)).toBe(true);
  });

  it('should extract embed URL from onclick handler', () => {
    const element = '<button onclick="loadPlayer(2)">Player 2</button>';
    const url = extractEmbedUrl(element, '51');
    
    expect(url).toBe('/embed.php?id=51&player=2');
  });

  it('should extract embed URL from data-player attribute', () => {
    const element = '<a class="player-tab" data-player="3">Server 3</a>';
    const url = extractEmbedUrl(element, '51');
    
    expect(url).toBe('/embed.php?id=51&player=3');
  });

  it('should build correct embed URL', () => {
    const url = buildEmbedUrl('51', 2);
    expect(url).toBe('https://dlhd.link/embed.php?id=51&player=2');
    
    const urlWithBase = buildEmbedUrl('51', 3, 'https://custom.domain');
    expect(urlWithBase).toBe('https://custom.domain/embed.php?id=51&player=3');
  });

  it('should return all 6 players even when none detected', () => {
    const html = '<html><body><div>No players here</div></body></html>';
    const players = detectPlayers(html, '51');
    
    expect(players.length).toBe(6);
    
    // All should be unavailable
    for (const player of players) {
      expect(player.available).toBe(false);
    }
  });

  it('should mark detected players as available', () => {
    const html = `
      <div>
        <button onclick="loadPlayer(1)">Player 1</button>
        <button onclick="loadPlayer(3)">Player 3</button>
      </div>
    `;
    
    const players = detectPlayers(html, '51');
    
    const player1 = players.find(p => p.id === 1);
    const player2 = players.find(p => p.id === 2);
    const player3 = players.find(p => p.id === 3);
    
    expect(player1?.available).toBe(true);
    expect(player2?.available).toBe(false);
    expect(player3?.available).toBe(true);
  });

  it('should sort players by priority with available first', () => {
    const html = `
      <div>
        <button onclick="loadPlayer(3)">Player 3</button>
        <button onclick="loadPlayer(5)">Player 5</button>
      </div>
    `;
    
    const players = detectPlayers(html, '51');
    
    // Available players (3, 5) should come first
    expect(players[0].id).toBe(3);
    expect(players[0].available).toBe(true);
    expect(players[1].id).toBe(5);
    expect(players[1].available).toBe(true);
    
    // Unavailable players should come after
    expect(players[2].available).toBe(false);
  });

  it('should handle empty player list gracefully', () => {
    const players: PlayerSource[] = [];
    
    expect(getAvailablePlayers(players)).toEqual([]);
    expect(getBestPlayer(players)).toBeNull();
  });
});

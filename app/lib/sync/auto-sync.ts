/**
 * Auto-Sync Utility
 * Automatically syncs data to the server when changes occur
 */

import { getSyncStatus, collectLocalSyncData, applyRemoteSyncData, mergeSyncData } from './sync-client';
import { getSyncEndpoint, isUsingCloudflareSyncWorker } from '@/lib/utils/sync-endpoints';

// Debounce timer for batching rapid changes
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 1000; // Wait 1 second after last change before syncing (reduced from 2)

// Track if a sync is in progress
let isSyncing = false;

// Track last sync time to prevent too frequent syncs
let lastSyncTime = 0;
const MIN_SYNC_INTERVAL_MS = 2000; // Minimum 2 seconds between syncs (reduced from 3)

/**
 * Queue a sync operation (debounced)
 * Call this whenever local data changes that should be synced
 */
export function queueSync(): void {
  if (typeof window === 'undefined') return;
  
  const status = getSyncStatus();
  if (!status.isLinked || !status.syncCode) {
    console.log('[AutoSync] Not linked, skipping sync');
    return; // Not linked, don't sync
  }
  
  // Clear existing timer
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
  }
  
  console.log('[AutoSync] Queuing sync in', SYNC_DEBOUNCE_MS, 'ms');
  
  // Set new timer
  syncDebounceTimer = setTimeout(() => {
    performSync();
  }, SYNC_DEBOUNCE_MS);
}

/**
 * Queue an immediate sync (shorter debounce for critical events like watch progress)
 * Use this for watch progress updates that need faster sync
 */
export function queueImmediateSync(): void {
  if (typeof window === 'undefined') return;
  
  const status = getSyncStatus();
  if (!status.isLinked || !status.syncCode) {
    return;
  }
  
  // Clear existing timer
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
  }
  
  console.log('[AutoSync] Queuing immediate sync in 500ms');
  
  // Shorter debounce for immediate sync (500ms)
  syncDebounceTimer = setTimeout(() => {
    performSync();
  }, 500);
}

/**
 * Perform immediate sync (no debounce) - PUSH ONLY
 * For pushing local changes to server
 */
export async function performSync(): Promise<{ success: boolean; error?: string }> {
  if (typeof window === 'undefined') {
    return { success: false, error: 'Not in browser' };
  }
  
  const status = getSyncStatus();
  if (!status.isLinked || !status.syncCode) {
    console.log('[AutoSync] Not linked, cannot sync');
    return { success: false, error: 'Not linked' };
  }
  
  if (isSyncing) {
    console.log('[AutoSync] Sync already in progress');
    return { success: false, error: 'Sync already in progress' };
  }
  
  // Check minimum interval
  const now = Date.now();
  if (now - lastSyncTime < MIN_SYNC_INTERVAL_MS) {
    // Queue for later instead of skipping
    console.log('[AutoSync] Too soon, queuing for later');
    queueSync();
    return { success: false, error: 'Too soon, queued for later' };
  }
  
  isSyncing = true;
  lastSyncTime = now;
  
  try {
    const localData = collectLocalSyncData();
    const endpoint = getSyncEndpoint();
    
    console.log(`[AutoSync] Pushing to ${isUsingCloudflareSyncWorker() ? 'Cloudflare Worker' : 'local API'}: ${endpoint}`);
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Sync-Code': status.syncCode,
    };
    
    if (status.passphrase) {
      headers['X-Sync-Passphrase'] = status.passphrase;
    }
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(localData),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || 'Sync failed');
    }
    
    // Update last sync timestamp
    localStorage.setItem('flyx_last_sync', result.lastSyncedAt.toString());
    
    console.log('[AutoSync] Push completed successfully');
    return { success: true };
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Sync failed';
    console.error('[AutoSync] Sync failed:', errorMsg);
    return { success: false, error: errorMsg };
  } finally {
    isSyncing = false;
  }
}

/**
 * Perform a full sync (pull then push)
 * Use this when you need to get latest data from server first
 */
export async function performFullSync(): Promise<{ success: boolean; error?: string }> {
  if (typeof window === 'undefined') {
    return { success: false, error: 'Not in browser' };
  }
  
  const status = getSyncStatus();
  if (!status.isLinked || !status.syncCode) {
    return { success: false, error: 'Not linked' };
  }
  
  if (isSyncing) {
    return { success: false, error: 'Sync already in progress' };
  }
  
  isSyncing = true;
  lastSyncTime = Date.now();
  
  try {
    const endpoint = getSyncEndpoint();
    const headers: Record<string, string> = {
      'X-Sync-Code': status.syncCode,
    };
    
    if (status.passphrase) {
      headers['X-Sync-Passphrase'] = status.passphrase;
    }
    
    console.log(`[AutoSync] Full sync - pulling from ${endpoint}`);
    
    // Pull first
    const pullResponse = await fetch(endpoint, {
      method: 'GET',
      headers,
    });
    
    if (pullResponse.ok) {
      const pullResult = await pullResponse.json();
      if (pullResult.success && pullResult.data) {
        const localData = collectLocalSyncData();
        const merged = mergeSyncData(localData, pullResult.data, 'remote');
        applyRemoteSyncData(merged);
        console.log('[AutoSync] Pulled and merged remote data');
      }
    }
    
    // Then push
    const localData = collectLocalSyncData();
    const pushResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(localData),
    });
    
    if (!pushResponse.ok) {
      throw new Error(`HTTP ${pushResponse.status}`);
    }
    
    const pushResult = await pushResponse.json();
    
    if (pushResult.success) {
      localStorage.setItem('flyx_last_sync', pushResult.lastSyncedAt.toString());
      console.log('[AutoSync] Full sync completed');
      return { success: true };
    }
    
    throw new Error(pushResult.error || 'Push failed');
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Sync failed';
    console.error('[AutoSync] Full sync failed:', errorMsg);
    return { success: false, error: errorMsg };
  } finally {
    isSyncing = false;
  }
}

/**
 * Cancel any pending sync
 */
export function cancelPendingSync(): void {
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
    syncDebounceTimer = null;
  }
}

/**
 * Check if sync is currently in progress
 */
export function isSyncInProgress(): boolean {
  return isSyncing;
}

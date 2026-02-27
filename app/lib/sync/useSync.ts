'use client';

/**
 * useSync Hook - React hook for cross-device sync
 * Routes through Cloudflare Worker when configured
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { SyncStatus, SyncCode, Passphrase, AccountProfile, AccountIcon, AccountColor } from './types';
import {
  getSyncStatus,
  createNewSyncAccount,
  importSyncAccount,
  disconnectSync,
  collectLocalSyncData,
  applyRemoteSyncData,
  mergeSyncData,
  getAccountProfile,
  saveAccountProfile,
} from './sync-client';
import { getSyncEndpoint, isUsingCloudflareSyncWorker } from '@/lib/utils/sync-endpoints';

interface UseSyncOptions {
  autoSyncInterval?: number;
  syncOnMount?: boolean;
}

interface UseSyncReturn {
  status: SyncStatus;
  profile: AccountProfile;
  generateAccount: (profile?: Partial<AccountProfile>) => { code: SyncCode; passphrase: Passphrase };
  importAccount: (code: string, passphrase: string) => Promise<{ success: boolean; error?: string }>;
  disconnect: () => void;
  sync: () => Promise<{ success: boolean; error?: string }>;
  push: () => Promise<{ success: boolean; error?: string }>;
  pull: () => Promise<{ success: boolean; error?: string }>;
  updateProfile: (updates: Partial<AccountProfile>) => void;
  setProfileName: (name: string) => void;
  setProfileIcon: (icon: AccountIcon) => void;
  setProfileColor: (color: AccountColor) => void;
  isSyncing: boolean;
  error: string | null;
}

export function useSync(options: UseSyncOptions = {}): UseSyncReturn {
  const { autoSyncInterval = 0, syncOnMount = false } = options;
  
  const [status, setStatus] = useState<SyncStatus>(() => getSyncStatus());
  const [profile, setProfile] = useState<AccountProfile>(() => getAccountProfile());
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  const refreshStatus = useCallback(() => {
    if (typeof window !== 'undefined') {
      setStatus(getSyncStatus());
      setProfile(getAccountProfile());
    }
  }, []);

  // Generate new account with code and passphrase
  const generateAccount = useCallback((profileData?: Partial<AccountProfile>): { code: SyncCode; passphrase: Passphrase } => {
    const { code, passphrase, profile: newProfile } = createNewSyncAccount(profileData);
    setProfile(newProfile);
    refreshStatus();
    return { code, passphrase };
  }, [refreshStatus]);

  // Import existing account with code and passphrase
  const importAccount = useCallback(async (code: string, passphrase: string): Promise<{ success: boolean; error?: string }> => {
    const result = importSyncAccount(code, passphrase);
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    refreshStatus();
    
    // Pull data from server after importing
    const pullResult = await pullData(result.code!, result.passphrase!);
    return pullResult;
  }, [refreshStatus]);

  const disconnect = useCallback(() => {
    disconnectSync();
    refreshStatus();
    setError(null);
  }, [refreshStatus]);

  // Update profile
  const updateProfile = useCallback((updates: Partial<AccountProfile>) => {
    const updated = saveAccountProfile(updates);
    setProfile(updated);
  }, []);

  const setProfileName = useCallback((name: string) => {
    updateProfile({ name: name.trim() || 'My Account' });
  }, [updateProfile]);

  const setProfileIcon = useCallback((icon: AccountIcon) => {
    updateProfile({ icon });
  }, [updateProfile]);

  const setProfileColor = useCallback((color: AccountColor) => {
    updateProfile({ color });
  }, [updateProfile]);

  // Push local data to server
  const pushData = useCallback(async (syncCode?: SyncCode, passphrase?: Passphrase): Promise<{ success: boolean; error?: string }> => {
    const code = syncCode || status.syncCode;
    const pass = passphrase || status.passphrase;
    
    if (!code) {
      return { success: false, error: 'No sync code configured' };
    }
    
    setIsSyncing(true);
    setError(null);
    
    try {
      const localData = collectLocalSyncData();
      const endpoint = getSyncEndpoint();
      
      console.log(`[Sync] Pushing to ${isUsingCloudflareSyncWorker() ? 'Cloudflare Worker' : 'local API'}`);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Sync-Code': code,
      };
      
      if (pass) {
        headers['X-Sync-Passphrase'] = pass;
      }
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(localData),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Push failed');
      }
      
      if (typeof window !== 'undefined') {
        localStorage.setItem('flyx_last_sync', result.lastSyncedAt.toString());
      }
      
      refreshStatus();
      return { success: true };
      
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Push failed';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      if (isMountedRef.current) {
        setIsSyncing(false);
      }
    }
  }, [status.syncCode, status.passphrase, refreshStatus]);

  // Pull data from server
  const pullData = useCallback(async (syncCode?: SyncCode, passphrase?: Passphrase): Promise<{ success: boolean; error?: string }> => {
    const code = syncCode || status.syncCode;
    const pass = passphrase || status.passphrase;
    
    if (!code) {
      return { success: false, error: 'No sync code configured' };
    }
    
    setIsSyncing(true);
    setError(null);
    
    try {
      const endpoint = getSyncEndpoint();
      
      console.log(`[Sync] Pulling from ${isUsingCloudflareSyncWorker() ? 'Cloudflare Worker' : 'local API'}`);
      
      const headers: Record<string, string> = {
        'X-Sync-Code': code,
      };
      
      if (pass) {
        headers['X-Sync-Passphrase'] = pass;
      }
      
      const response = await fetch(endpoint, {
        method: 'GET',
        headers,
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Pull failed');
      }
      
      if (result.data) {
        const localData = collectLocalSyncData();
        const merged = mergeSyncData(localData, result.data, 'newest');
        applyRemoteSyncData(merged);
        
        // Update profile state if it changed
        if (result.data.profile) {
          setProfile(getAccountProfile());
        }
      }
      
      refreshStatus();
      return { success: true };
      
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Pull failed';
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      if (isMountedRef.current) {
        setIsSyncing(false);
      }
    }
  }, [status.syncCode, status.passphrase, refreshStatus]);

  // Full sync (pull then push)
  const sync = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!status.syncCode) {
      return { success: false, error: 'No sync code configured' };
    }
    
    const pullResult = await pullData();
    if (!pullResult.success) {
      return pullResult;
    }
    
    const pushResult = await pushData();
    return pushResult;
  }, [status.syncCode, pullData, pushData]);

  // Auto-sync interval
  useEffect(() => {
    if (autoSyncInterval > 0 && status.isLinked) {
      syncIntervalRef.current = setInterval(() => {
        sync();
      }, autoSyncInterval);
      
      return () => {
        if (syncIntervalRef.current) {
          clearInterval(syncIntervalRef.current);
        }
      };
    }
  }, [autoSyncInterval, status.isLinked, sync]);

  // Sync on mount
  useEffect(() => {
    if (syncOnMount && status.isLinked) {
      sync();
    }
  }, [syncOnMount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, []);

  // Listen for storage changes (sync across tabs)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'flyx_sync_code' || e.key === 'flyx_sync_enabled' || e.key === 'flyx_account_profile') {
        refreshStatus();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [refreshStatus]);

  return {
    status,
    profile,
    generateAccount,
    importAccount,
    disconnect,
    sync,
    push: pushData,
    pull: pullData,
    updateProfile,
    setProfileName,
    setProfileIcon,
    setProfileColor,
    isSyncing,
    error,
  };
}

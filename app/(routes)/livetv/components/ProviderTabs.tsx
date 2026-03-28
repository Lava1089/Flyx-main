/**
 * Provider Tabs Component
 * Navigation tabs for DLHD, CDN Live, and VIPRow
 */

import { memo } from 'react';
import styles from '../LiveTV.module.css';

export type Provider = 'dlhd' | 'cdnlive' | 'ppv';

interface ProviderTabsProps {
  selectedProvider: Provider;
  onProviderChange: (provider: Provider) => void;
  stats: {
    dlhd: { events: number; channels: number };
    cdnlive: { channels: number };
    ppv: { events: number; live: number };
  };
  loading?: boolean;
}

const PROVIDERS: Array<{
  id: Provider;
  label: string;
  description: string;
  icon: string;
}> = [
  { 
    id: 'dlhd', 
    label: 'DLHD', 
    description: 'Live Sports & Channels',
    icon: '📡' 
  },
  { 
    id: 'cdnlive', 
    label: 'CDN Live', 
    description: 'TV Channels',
    icon: '🌐' 
  },
  {
    id: 'ppv',
    label: 'PPV.to',
    description: 'Live Events & PPV',
    icon: '🏟️'
  },
];

export const ProviderTabs = memo(function ProviderTabs({
  selectedProvider,
  onProviderChange,
  stats,
  loading = false,
}: ProviderTabsProps) {
  const getCount = (id: Provider): number => {
    switch (id) {
      case 'dlhd':
        return stats.dlhd.events + stats.dlhd.channels;
      case 'cdnlive':
        return stats.cdnlive.channels;
      case 'ppv':
        return stats.ppv.events;
      default:
        return 0;
    }
  };

  return (
    <div className={styles.providerTabs}>
      {PROVIDERS.map(({ id, label, icon }) => {
        const count = getCount(id);
        const isActive = selectedProvider === id;
        
        return (
          <button
            key={id}
            onClick={() => onProviderChange(id)}
            className={`${styles.providerTab} ${isActive ? styles.active : ''}`}
            disabled={loading}
          >
            <span className={styles.providerIcon}>{icon}</span>
            <div className={styles.providerInfo}>
              <span className={styles.providerLabel}>{label}</span>
              <span className={styles.providerDesc}>
                {loading ? '...' : `${count} items`}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
});

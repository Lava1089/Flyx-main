'use client';

/**
 * Content Analytics View
 *
 * Shows currently active content from the realtime snapshot.
 * Data comes from RealtimeSlice (in-memory on worker, zero D1).
 */

import { useRealtimeSlice } from '../context/slices';
import {
  colors,
  formatNumber,
  Card,
  PageHeader,
  LoadingState,
  EmptyState,
} from '../components/ui';

export default function ContentAnalyticsPage() {
  const realtime = useRealtimeSlice();
  const rd = realtime.data;

  return (
    <div>
      <PageHeader
        title="Content Analytics"
        icon="🎬"
        subtitle="Currently active content across the platform"
        actions={
          <ConnectionBadge connected={realtime.connected} lastUpdate={realtime.lastUpdate} />
        }
      />

      {/* Summary */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <QuickStat label="Watching Now" value={rd.watching} color={colors.primary} />
        <QuickStat label="Live TV" value={rd.livetv} color={colors.warning} />
        <QuickStat label="Browsing" value={rd.browsing} color={colors.info} />
        <QuickStat label="Total Active" value={rd.liveUsers} color={colors.success} />
      </div>

      {realtime.loading ? (
        <LoadingState message="Loading content data..." />
      ) : rd.topActiveContent.length === 0 ? (
        <EmptyState icon="🎬" title="No Active Content" message="Content data will appear as users watch content" />
      ) : (
        <Card title="Top Active Content" icon="🏆">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {rd.topActiveContent.map((item, i) => {
              const maxViewers = rd.topActiveContent[0]?.viewers || 1;
              const pct = Math.round((item.viewers / maxViewers) * 100);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <span
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: i < 3 ? ['#ffd700', '#c0c0c0', '#cd7f32'][i] : 'rgba(255,255,255,0.1)',
                      color: i < 3 ? '#000' : colors.text.muted,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: '600',
                      fontSize: '12px',
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ color: colors.text.primary, fontSize: '14px', fontWeight: '500', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </span>
                  <div style={{ flex: 1, height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden', maxWidth: '200px' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: colors.primary, borderRadius: '4px', transition: 'width 0.3s' }} />
                  </div>
                  <span style={{ color: colors.success, fontWeight: '600', fontSize: '14px', minWidth: '80px', textAlign: 'right' }}>
                    {formatNumber(item.viewers)} viewers
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

function QuickStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '12px 16px', background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', minWidth: '130px',
    }}>
      <div>
        <div style={{ color, fontSize: '20px', fontWeight: '700', lineHeight: 1 }}>{formatNumber(value)}</div>
        <div style={{ color: colors.text.muted, fontSize: '11px', marginTop: '2px' }}>{label}</div>
      </div>
    </div>
  );
}

function ConnectionBadge({ connected }: { connected: boolean; lastUpdate?: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '12px',
      background: connected ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
      border: `1px solid ${connected ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}`,
      fontSize: '11px', color: connected ? colors.success : colors.warning,
    }}>
      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: connected ? colors.success : colors.warning }} />
      {connected ? 'Live' : 'Polling'}
    </div>
  );
}

'use client';

/**
 * ImprovedLiveDashboard - OPTIMIZED
 * Uses ONLY unified stats context for real-time data
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeSlice } from '../context/slices';
import { getAdminAnalyticsUrl } from '../hooks/useAnalyticsApi';
import { colors, getPercentage } from './ui';

function useAnimatedNumber(value: number, duration = 400): number {
  const [displayValue, setDisplayValue] = useState(value);
  const prevValue = useRef(value);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (prevValue.current === value) return;
    const start = prevValue.current;
    const startTime = performance.now();
    
    const animate = (currentTime: number) => {
      const progress = Math.min((currentTime - startTime) / duration, 1);
      setDisplayValue(Math.round(start + (value - start) * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) animationRef.current = requestAnimationFrame(animate);
      else prevValue.current = value;
    };
    
    animationRef.current = requestAnimationFrame(animate);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [value, duration]);

  return displayValue;
}

interface HistoryPoint { time: number; total: number; watching: number; livetv: number; browsing: number; }

export default function ImprovedLiveDashboard() {
  const realtime = useRealtimeSlice();
  const loading = realtime.loading;
  const lastUpdate = realtime.lastUpdate;
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(getAdminAnalyticsUrl('activity-history', { hours: 12 }));
      const data = await res.json();
      if (data.success && data.history) {
        setHistory(data.history.map((h: any) => ({ time: h.time, total: h.total, watching: h.watching || 0, browsing: h.browsing || 0, livetv: h.livetv || 0 })));
      }
    } catch (e) { console.error('Failed to fetch history:', e); }
  }, []);

  useEffect(() => { fetchHistory(); const i = setInterval(fetchHistory, 300000); return () => clearInterval(i); }, [fetchHistory]);

  const activity = { total: realtime.data.liveUsers, watching: realtime.data.watching, livetv: realtime.data.livetv, browsing: realtime.data.browsing };
  const peak = { peakTotal: realtime.data.peakToday, peakWatching: 0, peakLiveTV: 0, peakBrowsing: 0, peakTotalTime: realtime.data.peakTime, peakWatchingTime: 0, peakLiveTVTime: 0, peakBrowsingTime: 0 };
  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ margin: 0, color: colors.text.primary, fontSize: '20px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '10px' }}>
            Real-Time Activity
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'rgba(16, 185, 129, 0.2)', borderRadius: '20px', fontSize: '11px', color: colors.success }}>
              <span style={{ width: '6px', height: '6px', background: colors.success, borderRadius: '50%', animation: 'pulse 2s infinite' }} />LIVE
            </span>
          </h2>
          <p style={{ margin: '4px 0 0 0', color: colors.text.muted, fontSize: '13px' }}>Updated: {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : 'Loading...'}</p>
        </div>
        <button onClick={() => { fetchHistory(); }} disabled={loading} style={{ padding: '6px 12px', background: 'rgba(120, 119, 198, 0.2)', border: '1px solid rgba(120, 119, 198, 0.3)', borderRadius: '6px', color: colors.primary, fontSize: '13px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? '⏳' : '🔄'} Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <ActivityCard title="On Site" value={activity.total} peak={peak.peakTotal || 0} peakTime={peak.peakTotalTime || 0} icon="👥" color={colors.success} isMain />
        <ActivityCard title="Watching VOD" value={activity.watching} peak={peak.peakWatching || 0} peakTime={peak.peakWatchingTime || 0} icon="▶️" color={colors.primary} />
        <ActivityCard title="Live TV" value={activity.livetv} peak={peak.peakLiveTV || 0} peakTime={peak.peakLiveTVTime || 0} icon="📺" color={colors.warning} />
        <ActivityCard title="Browsing" value={activity.browsing} peak={peak.peakBrowsing || 0} peakTime={peak.peakBrowsingTime || 0} icon="🔍" color={colors.info} />
      </div>

      <div style={{ background: colors.bg.card, border: `1px solid ${colors.border.default}`, borderRadius: '12px', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ color: colors.text.secondary, fontSize: '13px' }}>Activity Breakdown</span>
          <span style={{ color: colors.text.primary, fontWeight: '600' }}>{activity.total} total</span>
        </div>
        {activity.total > 0 ? (
          <>
            <div style={{ display: 'flex', height: '24px', borderRadius: '6px', overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }}>
              {activity.watching > 0 && <div style={{ width: `${(activity.watching / activity.total) * 100}%`, background: colors.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'white', fontWeight: '600', minWidth: '30px' }}>{activity.watching}</div>}
              {activity.livetv > 0 && <div style={{ width: `${(activity.livetv / activity.total) * 100}%`, background: colors.warning, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'white', fontWeight: '600', minWidth: '30px' }}>{activity.livetv}</div>}
              {activity.browsing > 0 && <div style={{ width: `${(activity.browsing / activity.total) * 100}%`, background: colors.info, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'white', fontWeight: '600', minWidth: '30px' }}>{activity.browsing}</div>}
            </div>
            <div style={{ display: 'flex', gap: '16px', marginTop: '10px' }}>
              <Legend color={colors.primary} label="VOD" value={activity.watching} total={activity.total} />
              <Legend color={colors.warning} label="Live TV" value={activity.livetv} total={activity.total} />
              <Legend color={colors.info} label="Browsing" value={activity.browsing} total={activity.total} />
            </div>
          </>
        ) : <div style={{ textAlign: 'center', padding: '20px', color: colors.text.muted }}>No active users</div>}
      </div>

      {history.length > 0 && (
        <div style={{ background: colors.bg.card, border: `1px solid ${colors.border.default}`, borderRadius: '12px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
            <span style={{ color: colors.text.secondary, fontSize: '13px' }}>Activity Trend (12h)</span>
            <div style={{ display: 'flex', gap: '12px', fontSize: '12px' }}>
              <span style={{ color: colors.success }}>● Total</span>
              <span style={{ color: colors.primary }}>● VOD</span>
            </div>
          </div>
          <div style={{ height: '80px' }}>
            <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
              {['total', 'watching'].map((field, i) => {
                const maxVal = Math.max(...history.map(h => h.total), 1);
                const pts = history.map((p, j) => `${(j / (history.length - 1)) * 100},${100 - ((p as any)[field] / maxVal) * 90}`).join(' ');
                return <polyline key={field} fill="none" stroke={i === 0 ? colors.success : colors.primary} strokeWidth={i === 0 ? 2 : 1.5} strokeDasharray={i === 0 ? undefined : '4,2'} vectorEffect="non-scaling-stroke" points={pts} />;
              })}
            </svg>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '11px', color: colors.text.muted }}>
            <span>{formatTime(history[0].time)}</span><span>Now</span>
          </div>
        </div>
      )}

      {realtime.data.topActiveContent?.length > 0 && (
        <div style={{ background: colors.bg.card, border: `1px solid ${colors.border.default}`, borderRadius: '12px', padding: '16px' }}>
          <span style={{ color: colors.text.secondary, fontSize: '13px', display: 'block', marginBottom: '12px' }}>🔥 Active Content</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {realtime.data.topActiveContent.slice(0, 6).map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: i === 0 ? 'rgba(255,215,0,0.1)' : 'rgba(255,255,255,0.02)', borderRadius: '8px', border: i === 0 ? '1px solid rgba(255,215,0,0.2)' : 'none' }}>
                <span style={{ width: '28px', height: '28px', borderRadius: '50%', background: i < 3 ? ['#ffd700', '#c0c0c0', '#cd7f32'][i] : 'rgba(255,255,255,0.1)', color: i < 3 ? '#000' : colors.text.secondary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '12px' }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: colors.text.primary, fontSize: '13px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
                </div>
                <span style={{ color: colors.success, fontWeight: '600', fontSize: '13px', padding: '4px 8px', background: 'rgba(16,185,129,0.15)', borderRadius: '12px' }}>{c.viewers} 👁</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <style jsx>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
    </div>
  );
}

function ActivityCard({ title, value, peak, peakTime, icon, color, isMain = false }: { title: string; value: number; peak: number; peakTime: number; icon: string; color: string; isMain?: boolean }) {
  const animatedValue = useAnimatedNumber(value);
  return (
    <div style={{ background: isMain ? `linear-gradient(135deg, ${color}15, ${color}05)` : colors.bg.card, border: `1px solid ${isMain ? color + '30' : colors.border.default}`, borderRadius: '12px', padding: '16px', borderTop: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ fontSize: '20px' }}>{icon}</span>
        <span style={{ color: colors.text.primary, fontSize: '13px', fontWeight: '600' }}>{title}</span>
      </div>
      <div style={{ fontSize: isMain ? '36px' : '28px', fontWeight: '700', color, marginBottom: '8px' }}>{animatedValue.toLocaleString()}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', fontSize: '11px' }}>
        <span style={{ color: colors.pink }}>📈</span>
        <span style={{ color: colors.text.secondary }}>Peak:</span>
        <span style={{ color: colors.text.primary, fontWeight: '600' }}>{peak}</span>
        {peakTime > 0 && <span style={{ color: colors.text.muted }}>at {new Date(peakTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
    </div>
  );
}

function Legend({ color, label, value, total }: { color: string; label: string; value: number; total: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: color }} />
      <span style={{ color: colors.text.secondary, fontSize: '12px' }}>{label}:</span>
      <span style={{ color: colors.text.primary, fontSize: '12px', fontWeight: '600' }}>{value}</span>
      <span style={{ color: colors.text.muted, fontSize: '11px' }}>({getPercentage(value, total)}%)</span>
    </div>
  );
}

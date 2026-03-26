'use client';

/**
 * Live Statistics — Real-time activity monitoring dashboard
 *
 * All data comes from RealtimeSlice + UserSlice (in-memory on worker, zero D1).
 * SSE-powered with auto-updating visuals. Tracks a rolling history of snapshots
 * client-side for sparkline graphs and trend indicators.
 */

import { useState, useEffect } from 'react';
import { useRealtimeSlice, useUserSlice } from '../context/slices';
import {
  colors,
  gradients,
  formatNumber,
  Card,
  Grid,
  PageHeader,
  LoadingState,
  getPercentage,
} from '../components/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HistoryPoint {
  time: number;
  liveUsers: number;
  watching: number;
  browsing: number;
  livetv: number;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const MAX_HISTORY = 60; // 60 data points = ~10 minutes at 10s SSE interval

export default function LiveStatsPage() {
  const realtime = useRealtimeSlice();
  const users = useUserSlice();
  const rd = realtime.data;
  const ud = users.data;

  // Rolling history for sparklines
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  // Record snapshot to history whenever realtime data updates
  useEffect(() => {
    if (realtime.lastUpdate === 0) return;

    setHistory(prev => {
      const point: HistoryPoint = {
        time: realtime.lastUpdate,
        liveUsers: rd.liveUsers,
        watching: rd.watching,
        browsing: rd.browsing,
        livetv: rd.livetv,
      };

      // Dedupe if timestamp hasn't changed
      if (prev.length > 0 && prev[prev.length - 1].time === point.time) {
        return prev;
      }

      const next = [...prev, point];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });

  }, [realtime.lastUpdate, rd.liveUsers, rd.watching, rd.browsing, rd.livetv]);

  // Compute trend from last 6 data points
  const trend = computeTrend(history);
  const connected = realtime.connected || users.connected;

  // Seconds since last update
  const [secondsAgo, setSecondsAgo] = useState(0);
  useEffect(() => {
    if (!realtime.lastUpdate) return;
    const tick = () => setSecondsAgo(Math.floor((Date.now() - realtime.lastUpdate) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [realtime.lastUpdate]);

  if (realtime.loading && users.loading) {
    return (
      <div>
        <PageHeader title="Live Statistics" icon="📡" subtitle="Waiting for data..." />
        <LoadingState message="Connecting to real-time feed..." />
      </div>
    );
  }

  const total = rd.liveUsers || 1;
  const watchingPct = getPercentage(rd.watching, total);
  const browsingPct = getPercentage(rd.browsing, total);
  const livetvPct = getPercentage(rd.livetv, total);

  return (
    <div>
      <PageHeader
        title="Live Statistics"
        icon="📡"
        subtitle="Real-time platform activity"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <UpdateTimer secondsAgo={secondsAgo} />
            <ConnectionBadge connected={connected} error={realtime.error || users.error} />
          </div>
        }
      />

      {/* ── Hero: Big Live Count ── */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(120,119,198,0.08) 100%)',
        border: '1px solid rgba(16,185,129,0.25)',
        borderRadius: '20px',
        padding: '32px',
        marginBottom: '24px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background sparkline */}
        {history.length > 2 && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '80px', opacity: 0.15 }}>
            <Sparkline data={history.map(h => h.liveUsers)} color={colors.success} fill />
          </div>
        )}

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <LiveDot />
              <span style={{ color: colors.text.secondary, fontSize: '14px', fontWeight: '500' }}>Users on site right now</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: colors.text.muted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Peak today</div>
              <div style={{ color: colors.success, fontSize: '24px', fontWeight: '700' }}>{formatNumber(rd.peakToday)}</div>
              {rd.peakTime > 0 && (
                <div style={{ color: colors.text.muted, fontSize: '11px' }}>
                  at {new Date(rd.peakTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', marginBottom: '24px' }}>
            <span style={{ fontSize: '72px', fontWeight: '800', color: colors.text.primary, lineHeight: 1, letterSpacing: '-2px' }}>
              {formatNumber(rd.liveUsers)}
            </span>
            {trend !== null && (
              <TrendBadge value={trend} />
            )}
          </div>

          {/* Activity breakdown bars */}
          <div style={{ display: 'flex', gap: '6px', height: '32px', borderRadius: '8px', overflow: 'hidden', marginBottom: '16px' }}>
            {rd.watching > 0 && (
              <div style={{ flex: rd.watching, background: colors.purple, borderRadius: rd.browsing === 0 && rd.livetv === 0 ? '8px' : '8px 0 0 8px', transition: 'flex 0.5s ease' }} />
            )}
            {rd.livetv > 0 && (
              <div style={{ flex: rd.livetv, background: colors.warning, transition: 'flex 0.5s ease' }} />
            )}
            {rd.browsing > 0 && (
              <div style={{ flex: rd.browsing, background: colors.info, borderRadius: rd.watching === 0 && rd.livetv === 0 ? '8px' : '0 8px 8px 0', transition: 'flex 0.5s ease' }} />
            )}
            {rd.liveUsers === 0 && (
              <div style={{ flex: 1, background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }} />
            )}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            <LegendItem color={colors.purple} label="Watching" value={rd.watching} pct={watchingPct} />
            <LegendItem color={colors.warning} label="Live TV" value={rd.livetv} pct={livetvPct} />
            <LegendItem color={colors.info} label="Browsing" value={rd.browsing} pct={browsingPct} />
          </div>
        </div>
      </div>

      {/* ── Activity Sparklines Row ── */}
      <Grid cols={3} gap="16px">
        <SparklineCard
          title="Watching"
          value={rd.watching}
          color={colors.purple}
          data={history.map(h => h.watching)}
          icon="▶️"
        />
        <SparklineCard
          title="Live TV"
          value={rd.livetv}
          color={colors.warning}
          data={history.map(h => h.livetv)}
          icon="📺"
        />
        <SparklineCard
          title="Browsing"
          value={rd.browsing}
          color={colors.info}
          data={history.map(h => h.browsing)}
          icon="🔍"
        />
      </Grid>

      {/* ── User Metrics + Active Content ── */}
      <div style={{ marginTop: '24px' }}>
        <Grid cols={2} gap="20px">
          {/* User metrics */}
          <Card title="Today's Users" icon="👥">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <MetricRow label="Unique Visitors (DAU)" value={formatNumber(ud.dau)} color={colors.primary} />
              <MetricRow label="Weekly Active (WAU)" value={formatNumber(ud.wau)} color={colors.info} />
              <MetricRow label="Monthly Active (MAU)" value={formatNumber(ud.mau)} color={colors.purple} />
              <div style={{ borderTop: `1px solid ${colors.border.subtle}`, paddingTop: '12px' }}>
                <MetricRow label="New Today" value={formatNumber(ud.newToday)} color={colors.success} />
                <div style={{ marginTop: '8px' }}>
                  <MetricRow label="Returning" value={formatNumber(ud.returningUsers)} color={colors.warning} />
                </div>
              </div>
              {ud.deviceBreakdown.length > 0 && (
                <div style={{ borderTop: `1px solid ${colors.border.subtle}`, paddingTop: '12px' }}>
                  <div style={{ color: colors.text.muted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>Devices</div>
                  {ud.deviceBreakdown.slice(0, 4).map(d => {
                    const deviceTotal = ud.deviceBreakdown.reduce((s, x) => s + x.count, 0);
                    const icons: Record<string, string> = { desktop: '💻', mobile: '📱', tablet: '📲' };
                    return (
                      <div key={d.device} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                        <span style={{ color: colors.text.secondary, fontSize: '13px' }}>{icons[d.device] || '🖥️'} {d.device}</span>
                        <span style={{ color: colors.text.primary, fontSize: '13px', fontWeight: '600' }}>
                          {d.count} <span style={{ color: colors.text.muted, fontWeight: '400' }}>({getPercentage(d.count, deviceTotal)}%)</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          {/* Top active content */}
          <Card title="Active Content" icon="🎬">
            {rd.topActiveContent.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {rd.topActiveContent.slice(0, 10).map((item, i) => {
                  const maxViewers = rd.topActiveContent[0]?.viewers || 1;
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        background: i === 0 ? 'rgba(120,119,198,0.08)' : 'transparent',
                        transition: 'background 0.2s',
                      }}
                    >
                      <span style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '6px',
                        background: i < 3 ? ['linear-gradient(135deg, #ffd700, #ffaa00)', 'linear-gradient(135deg, #c0c0c0, #a0a0a0)', 'linear-gradient(135deg, #cd7f32, #b8690e)'][i] : 'rgba(255,255,255,0.06)',
                        color: i < 3 ? '#000' : colors.text.muted,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: '700',
                        fontSize: '11px',
                        flexShrink: 0,
                      }}>
                        {i + 1}
                      </span>
                      <span style={{
                        flex: 1,
                        color: colors.text.primary,
                        fontSize: '13px',
                        fontWeight: i === 0 ? '600' : '400',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {item.title}
                      </span>
                      <div style={{ width: '60px', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden', flexShrink: 0 }}>
                        <div style={{
                          height: '100%',
                          width: `${getPercentage(item.viewers, maxViewers)}%`,
                          background: gradients.primary,
                          borderRadius: '2px',
                          transition: 'width 0.3s',
                        }} />
                      </div>
                      <span style={{
                        color: colors.success,
                        fontWeight: '600',
                        fontSize: '13px',
                        minWidth: '28px',
                        textAlign: 'right',
                        flexShrink: 0,
                      }}>
                        {item.viewers}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: colors.text.muted, textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: '36px', marginBottom: '12px', opacity: 0.5 }}>🎬</div>
                No active content right now
              </div>
            )}
          </Card>
        </Grid>
      </div>

      {/* ── Activity Log (recent history) ── */}
      {history.length > 1 && (
        <div style={{ marginTop: '24px' }}>
          <Card title="Activity Timeline" icon="📈">
            <div style={{ height: '120px' }}>
              <Sparkline data={history.map(h => h.liveUsers)} color={colors.success} fill showDots />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
              <span style={{ color: colors.text.muted, fontSize: '11px' }}>
                {history.length > 0 ? new Date(history[0].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
              <span style={{ color: colors.text.muted, fontSize: '11px' }}>
                {history.length > 0 ? new Date(history[history.length - 1].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
            </div>
          </Card>
        </div>
      )}

      <style jsx global>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.3); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LiveDot() {
  return (
    <div style={{ position: 'relative', width: '12px', height: '12px' }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        borderRadius: '50%',
        background: colors.success,
        animation: 'livePulse 2s ease-in-out infinite',
      }} />
      <div style={{
        position: 'absolute',
        inset: '2px',
        borderRadius: '50%',
        background: colors.success,
      }} />
    </div>
  );
}

function UpdateTimer({ secondsAgo }: { secondsAgo: number }) {
  const label = secondsAgo < 5 ? 'just now' : secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.floor(secondsAgo / 60)}m ago`;
  return (
    <span style={{ color: colors.text.muted, fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
      Updated {label}
    </span>
  );
}

function ConnectionBadge({ connected, error }: { connected: boolean; error: string | null }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '20px',
      background: connected ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
      border: `1px solid ${connected ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
      fontSize: '12px', fontWeight: '500',
      color: connected ? colors.success : colors.warning,
    }}>
      <div style={{
        width: '6px', height: '6px', borderRadius: '50%',
        background: connected ? colors.success : colors.warning,
        animation: connected ? 'livePulse 2s ease-in-out infinite' : 'none',
      }} />
      {connected ? 'SSE Connected' : error ? 'Polling' : 'Connecting...'}
    </div>
  );
}

function TrendBadge({ value }: { value: number }) {
  const isUp = value > 0;
  const isFlat = value === 0;
  const color = isFlat ? colors.text.muted : isUp ? colors.success : colors.danger;
  const bg = isFlat ? 'rgba(100,116,139,0.15)' : isUp ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';
  const arrow = isFlat ? '→' : isUp ? '↑' : '↓';

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '4px 10px', borderRadius: '8px',
      background: bg, color, fontSize: '14px', fontWeight: '600',
    }}>
      {arrow} {Math.abs(value)}%
    </span>
  );
}

function LegendItem({ color, label, value, pct }: { color: string; label: string; value: number; pct: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '10px', height: '10px', borderRadius: '3px', background: color, flexShrink: 0 }} />
      <span style={{ color: colors.text.secondary, fontSize: '13px' }}>{label}</span>
      <span style={{ color: colors.text.primary, fontSize: '13px', fontWeight: '600' }}>{formatNumber(value)}</span>
      <span style={{ color: colors.text.muted, fontSize: '12px' }}>({pct}%)</span>
    </div>
  );
}

function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: colors.text.secondary, fontSize: '13px' }}>{label}</span>
      <span style={{ color: color || colors.text.primary, fontWeight: '600', fontSize: '14px', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function SparklineCard({ title, value, color, data, icon }: { title: string; value: number; color: string; data: number[]; icon: string }) {
  const prevValue = data.length >= 2 ? data[data.length - 2] : value;
  const diff = value - prevValue;

  return (
    <div style={{
      background: colors.bg.card,
      border: `1px solid ${colors.border.default}`,
      borderRadius: '14px',
      padding: '16px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {data.length > 2 && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '50px', opacity: 0.12 }}>
          <Sparkline data={data} color={color} fill />
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontSize: '16px' }}>{icon}</span>
          <span style={{ color: colors.text.secondary, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '28px', fontWeight: '700', color, lineHeight: 1 }}>{formatNumber(value)}</span>
          {diff !== 0 && data.length > 2 && (
            <span style={{
              fontSize: '12px', fontWeight: '600',
              color: diff > 0 ? colors.success : colors.danger,
            }}>
              {diff > 0 ? '+' : ''}{diff}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline SVG
// ---------------------------------------------------------------------------

function Sparkline({
  data,
  color,
  fill = false,
  showDots = false,
}: {
  data: number[];
  color: string;
  fill?: boolean;
  showDots?: boolean;
}) {
  if (data.length < 2) return null;

  const width = 400;
  const height = 100;
  const padY = 8;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - padY - ((val - min) / range) * (height - padY * 2);
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const fillPath = `${linePath} L${width},${height} L0,${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
      {fill && (
        <defs>
          <linearGradient id={`fill-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {fill && <path d={fillPath} fill={`url(#fill-${color.replace('#', '')})`} />}
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {showDots && points.length <= 30 && points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a trend percentage from the last ~6 history points vs the 6 before that.
 * Returns null if not enough data.
 */
function computeTrend(history: HistoryPoint[]): number | null {
  if (history.length < 4) return null;

  const half = Math.floor(history.length / 2);
  const recent = history.slice(half);
  const older = history.slice(0, half);

  const recentAvg = recent.reduce((s, h) => s + h.liveUsers, 0) / recent.length;
  const olderAvg = older.reduce((s, h) => s + h.liveUsers, 0) / older.length;

  if (olderAvg === 0) return recentAvg > 0 ? 100 : 0;

  return Math.round(((recentAvg - olderAvg) / olderAvg) * 100);
}

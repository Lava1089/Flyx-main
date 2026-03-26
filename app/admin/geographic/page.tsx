'use client';

/**
 * Geographic View
 *
 * Geographic data is not currently collected via heartbeats.
 * This page shows an empty state with explanation.
 */

import {
  PageHeader,
  EmptyState,
} from '../components/ui';

export default function GeographicPage() {
  return (
    <div>
      <PageHeader
        title="Geographic Analytics"
        icon="🌍"
        subtitle="User distribution across the globe"
      />
      <EmptyState
        icon="🌍"
        title="Geographic Data Unavailable"
        message="Geographic analytics require IP geolocation which is not currently collected via heartbeats. This feature may be added in the future."
      />
    </div>
  );
}

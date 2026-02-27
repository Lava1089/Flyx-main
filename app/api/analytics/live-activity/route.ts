/**
 * Live Activity API
 * POST /api/analytics/live-activity - Update live activity heartbeat
 * GET /api/analytics/live-activity - Get current live activities
 * DELETE /api/analytics/live-activity - Deactivate activity
 * 
 * OPTIMIZED: Forwards to CF Analytics Worker to avoid duplicate D1 writes.
 * The CF Worker handles all D1 operations with batching for efficiency.
 */

import { NextRequest, NextResponse } from 'next/server';

const CF_ANALYTICS_URL = process.env.NEXT_PUBLIC_CF_ANALYTICS_WORKER_URL || 'https://flyx-analytics.vynx.workers.dev';

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();

    if (!data.userId || !data.sessionId || !data.activityType) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Forward to CF Analytics Worker - it handles D1 writes with batching
    const response = await fetch(`${CF_ANALYTICS_URL}/live-activity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward geo headers
        'CF-IPCountry': request.headers.get('CF-IPCountry') || '',
        'User-Agent': request.headers.get('User-Agent') || '',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      console.error('[live-activity] CF Worker error:', response.status);
      return NextResponse.json({ success: true, forwarded: false });
    }

    const result = await response.json();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Failed to update live activity:', error);
    // Don't fail the request - analytics shouldn't break the app
    return NextResponse.json({ success: true, forwarded: false });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const maxAge = searchParams.get('maxAge') || '5';

    // Forward to CF Analytics Worker
    const response = await fetch(`${CF_ANALYTICS_URL}/live-activity?maxAge=${maxAge}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.error('[live-activity] CF Worker GET error:', response.status);
      return NextResponse.json({
        success: true,
        activities: [],
        stats: { totalActive: 0, watching: 0, browsing: 0, livetv: 0 },
      });
    }

    const result = await response.json();
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to get live activities:', error);
    return NextResponse.json({
      success: true,
      activities: [],
      stats: { totalActive: 0, watching: 0, browsing: 0, livetv: 0 },
    });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activityId = searchParams.get('id');

    if (!activityId) {
      return NextResponse.json(
        { error: 'Activity ID is required' },
        { status: 400 }
      );
    }

    // Forward to CF Analytics Worker
    await fetch(`${CF_ANALYTICS_URL}/live-activity?id=${activityId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to deactivate activity:', error);
    return NextResponse.json({ success: true });
  }
}

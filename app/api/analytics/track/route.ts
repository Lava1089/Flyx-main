/**
 * Analytics Tracking API
 * POST /api/analytics/track - Track user events
 * 
 * OPTIMIZED: Forwards to CF Analytics Worker to avoid duplicate D1 writes.
 * The CF Worker handles all D1 operations with batching for efficiency.
 */

import { NextRequest, NextResponse } from 'next/server';

const CF_ANALYTICS_URL = process.env.NEXT_PUBLIC_CF_ANALYTICS_WORKER_URL || 'https://flyx-analytics.vynx.workers.dev';

// GET endpoint for testing
export async function GET(_request: NextRequest) {
  return NextResponse.json({
    success: true,
    message: 'Analytics track endpoint is working',
    mode: 'cf-worker-forwarding',
    workerUrl: CF_ANALYTICS_URL,
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const requestId = `analytics_${Date.now()}`;
  
  try {
    const body = await request.json();
    
    // Forward to CF Analytics Worker - it handles D1 writes with batching
    const response = await fetch(`${CF_ANALYTICS_URL}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward geo headers for location tracking
        'CF-IPCountry': request.headers.get('CF-IPCountry') || '',
        'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') || '',
        'X-Forwarded-For': request.headers.get('X-Forwarded-For') || '',
        'User-Agent': request.headers.get('User-Agent') || '',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.warn(`[${requestId}] CF Worker returned ${response.status}`);
      // Don't fail - analytics shouldn't break the app
      return NextResponse.json({ 
        success: true, 
        requestId,
        forwarded: false,
        reason: `worker_error_${response.status}`,
      });
    }

    const result = await response.json();
    return NextResponse.json({ 
      success: true, 
      requestId,
      forwarded: true,
      ...result,
    });
    
  } catch (error) {
    console.error(`[${requestId}] Analytics tracking error:`, error);
    // Don't fail the request - analytics shouldn't break the app
    return NextResponse.json({ 
      success: true, 
      requestId,
      forwarded: false,
      reason: 'exception',
    });
  }
}

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Admin routes require authentication (handled by admin auth system)
  // Self-hosted mode bypasses auth checks
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    const isSelfHosted = process.env.FLYX_SELF_HOSTED === 'true';
    if (!isSelfHosted) {
      // Admin auth is enforced at the API route level
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};

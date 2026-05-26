import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_QUERY_KEYS = ['finance_session', 'session', 'session_token', 'token'];
const SESSION_PENDING_COOKIE = 'finance_session_pending';

function getSessionFromQuery(request: NextRequest) {
  for (const key of SESSION_QUERY_KEYS) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) return { key, value };
  }
  return null;
}

/**
 * Proxy hook for handling authentication and API proxying.
 * - Ensures cookies from external login service are properly forwarded.
 * - Handles CORS for page requests.
 */
export function proxy(request: NextRequest) {
  const session = getSessionFromQuery(request);
  if (session) {
    const cleanUrl = request.nextUrl.clone();
    for (const key of SESSION_QUERY_KEYS) cleanUrl.searchParams.delete(key);
    cleanUrl.searchParams.delete('session_redirect');

    const redirectResponse = NextResponse.redirect(cleanUrl);
    redirectResponse.cookies.set('finance_session', session.value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      path: '/',
    });
    redirectResponse.cookies.set(SESSION_PENDING_COOKIE, '1', {
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      path: '/',
      maxAge: 15,
    });
    return redirectResponse;
  }

  const response = NextResponse.next();

  // Allow credentials in page responses for cross-origin requests.
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Allow-Origin', request.headers.get('origin') || '*');

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};

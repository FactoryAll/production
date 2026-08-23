import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from './lib/auth/constants';
import { getSessionFromToken } from './lib/auth/session-token';

const PUBLIC_PATHS = ['/login', '/change-password', '/api/auth', '/_next', '/favicon.ico', '/public', '/health'];
const PUBLIC_EXTENSIONS = ['.ico', '.png', '.jpg', '.jpeg', '.svg', '.css', '.js', '.woff2', '.map'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  if (PUBLIC_EXTENSIONS.some((ext) => pathname.endsWith(ext))) return true;
  return false;
}

// TODO T-017: enforce role-based access matrix here
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Logged-in users should not see the login page.
  if (pathname === '/login') {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = await getSessionFromToken(token);
    if (session) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSessionFromToken(token);

  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Attach user identity/roles to request headers for server components/actions.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', session.userId);
  const roles = session.user.roles.map((ur) => ur.role.code).join(',');
  requestHeaders.set('x-user-roles', roles);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|public).*)'],
};
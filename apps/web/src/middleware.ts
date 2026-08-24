import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from './lib/auth/constants';

const PUBLIC_PATHS = ['/login', '/change-password', '/api/auth', '/_next', '/favicon.ico', '/public', '/health'];
const PUBLIC_EXTENSIONS = ['.ico', '.png', '.jpg', '.jpeg', '.svg', '.css', '.js', '.woff2', '.map'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  if (PUBLIC_EXTENSIONS.some((ext) => pathname.endsWith(ext))) return true;
  return false;
}

function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.has(SESSION_COOKIE_NAME);
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (pathname === '/login') {
    if (hasSessionCookie(request)) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!hasSessionCookie(request)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Full session validation, role checks and shift-window enforcement happen
  // inside Server Actions and Server Components (Node.js runtime).
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|public).*)'],
};

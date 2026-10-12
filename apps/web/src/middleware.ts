import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from './lib/auth/constants';

// '/icon' и '/apple-icon' — favicon из app/icon.svg (файловые метаданные Next.js). Сам файл
// отдаётся по пути /icon.svg и попадает в публичные по расширению; записи здесь — страховка
// на случай формы без расширения.
const PUBLIC_PATHS = ['/login', '/change-password', '/api/auth', '/_next', '/favicon.ico', '/public', '/health', '/icon', '/apple-icon'];
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

/**
 * Returns the permission codes required for a given route.
 * Full authorization (session + role) is enforced inside Server Actions
 * and Server Components; middleware only uses this mapping for documentation
 * and future route-level guards.
 */
export function getRoutePermissions(pathname: string): string[] {
  if (pathname.includes('/transfers')) {
    if (pathname.includes('/new') || pathname.includes('/edit')) {
      return ['transfer:create', 'transfer:update'];
    }
    if (pathname.includes('/submit') || pathname.includes('/cancel')) {
      return ['transfer:update'];
    }
    if (pathname.includes('/receive')) {
      return ['transfer:receive'];
    }
    if (pathname.includes('/reconcile')) {
      return ['transfer:reconcile'];
    }
    return ['transfer:create', 'transfer:update', 'transfer:receive', 'transfer:reconcile'];
  }
  return [];
}

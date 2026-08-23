import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { hasPermission } from '@prodtrack/contracts';
import { SESSION_COOKIE_NAME } from './lib/auth/constants';
import { getSessionFromToken } from './lib/auth/session-token';
import { isWithinShiftWindow } from './lib/auth/shift-window';
import type { PermissionCode } from './lib/auth/access';

const PUBLIC_PATHS = ['/login', '/change-password', '/api/auth', '/_next', '/favicon.ico', '/public', '/health'];
const PUBLIC_EXTENSIONS = ['.ico', '.png', '.jpg', '.jpeg', '.svg', '.css', '.js', '.woff2', '.map'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  if (PUBLIC_EXTENSIONS.some((ext) => pathname.endsWith(ext))) return true;
  return false;
}

function getRequiredPermissions(pathname: string, method: string): PermissionCode[] | null {
  if (pathname === '/nsi' || pathname.startsWith('/nsi/')) {
    return method === 'GET' ? ['nsi:read', 'nsi:manage'] : ['nsi:manage'];
  }
  if (pathname.startsWith('/users/')) return ['users:manage'];
  if (pathname.startsWith('/roles/')) return ['roles:manage'];
  if (pathname.startsWith('/production-orders/')) {
    if (pathname.includes('/edit') || pathname.includes('/create') || pathname.includes('/new')) {
      return ['production_order:create', 'production_order:update'];
    }
    return ['production_order:read', 'production_order:read_own'];
  }
  if (pathname.startsWith('/shift-execution/')) {
    return ['production_order:accept', 'production_order:report'];
  }
  if (pathname.startsWith('/transfers/')) {
    if (pathname.includes('/edit') || pathname.includes('/create')) {
      return ['transfer:create', 'transfer:update'];
    }
    return ['transfer:create', 'transfer:update', 'transfer:receive', 'transfer:reconcile'];
  }
  if (pathname.startsWith('/receiving/')) {
    return ['transfer:receive', 'transfer:reconcile'];
  }
  if (pathname.startsWith('/onec/')) {
    return ['onec:read', 'onec:process'];
  }
  if (pathname.startsWith('/audit/')) {
    return ['audit:read'];
  }
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    return ['dashboard:read', 'dashboard:read_own'];
  }
  return null;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

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

  const userRoles = session.user.roles.map((ur) => ur.role.code);

  // BR-7: OPR shift window restriction applies only when OPR is the sole role.
  if (userRoles.includes('OPR') && userRoles.length === 1) {
    const now = new Date();
    if (!isWithinShiftWindow(now)) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('error', 'outside_shift_window');
      return NextResponse.redirect(loginUrl);
    }
  }

  if (session.user.mustChangePassword) {
    if (pathname !== '/change-password') {
      return NextResponse.redirect(new URL('/change-password', request.url));
    }
    return NextResponse.next();
  }

  const requiredPermissions = getRequiredPermissions(pathname, request.method);
  if (requiredPermissions) {
    const allowed = requiredPermissions.some((permission) => hasPermission(userRoles, permission));
    if (!allowed) {
      // NOTE: Middleware only checks route access. Fine-grained ownership filtering
      // for *_own permissions (e.g. production_order:read_own) MUST be implemented
      // in the server action / Prisma query itself via where: { workCenterId: user.workCenterId }.
      return NextResponse.redirect(new URL('/forbidden', request.url), { status: 307 });
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', session.userId);
  requestHeaders.set('x-user-roles', userRoles.join(','));

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-user-id', session.userId);
  response.headers.set('x-user-roles', userRoles.join(','));
  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|public).*)'],
};

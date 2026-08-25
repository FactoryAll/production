import Link from 'next/link';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@/lib/auth/constants';
import { LogoutButton } from './logout-button';

const navItems = [
  { label: 'Дашборд', href: '/dashboard' },
  { label: 'ПЗ', href: '/production-orders' },
  { label: 'Исполнение', href: '/shift-execution' },
  { label: 'Остатки', href: '/stock' },
  { label: 'Отчёты', href: '/shift-reports' },
];

const nsiItems = [
  { label: 'РЦ', href: '/nsi/work-centers' },
  { label: 'Сотрудники', href: '/nsi/employees' },
  { label: 'Номенклатура', href: '/nsi/products' },
  { label: 'Смены', href: '/nsi/shifts' },
  { label: 'Склады', href: '/nsi/warehouses' },
  { label: 'Причины', href: '/nsi/defect-reasons' },
];

export function Header() {
  const cookieStore = cookies();
  const hasSession = cookieStore.has(SESSION_COOKIE_NAME);

  if (!hasSession) {
    return null;
  }

  return (
    <header className="bg-graphite text-white shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight">
          ProdTrack
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-sm px-3 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
            >
              {item.label}
            </Link>
          ))}

          <div className="group relative">
            <button className="rounded-sm px-3 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white">
              НСИ
            </button>
            <div className="absolute left-0 top-full hidden min-w-[180px] rounded-md border border-mist-metal bg-white py-1 shadow-lg group-hover:block">
              {nsiItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block px-4 py-2 text-sm text-graphite hover:bg-graphite-surface"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          <Link
            href="/users"
            className="rounded-sm px-3 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
          >
            Пользователи
          </Link>
        </nav>

        <div className="flex items-center gap-4">
          <LogoutButton className="h-[var(--button-height-sm)] rounded-md border border-white/20 bg-transparent px-4 text-base font-medium text-white transition-colors hover:bg-white/10" />
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-t border-white/10 px-4 py-2 md:hidden">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="whitespace-nowrap rounded-sm px-3 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:bg-white/10 hover:text-white"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </header>
  );
}

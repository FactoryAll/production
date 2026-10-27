import { describe, it, expect } from 'vitest';
import { canViewTransfers, getAdminNavItems, getNavItems, getNsiNavItems } from '../nav-items';

const hrefsFor = (roles: string[]) => getNavItems(roles).map((item) => item.href);
const adminHrefsFor = (roles: string[]) => getAdminNavItems(roles).map((item) => item.href);

describe('nav-items', () => {
  it('shows Перемещения for NP, KSGP, USGP and ADM (M07 §3)', () => {
    for (const role of ['NP', 'KSGP', 'USGP', 'ADM']) {
      expect(canViewTransfers([role])).toBe(true);
      expect(hrefsFor([role])).toContain('/transfers');
    }
  });

  it('hides Перемещения from OPR (нет права transfer:read)', () => {
    expect(canViewTransfers(['OPR'])).toBe(false);
    expect(hrefsFor(['OPR'])).not.toContain('/transfers');
  });

  it('shows Перемещения for С1С — право transfer:read (решение владельца 03.10.2026)', () => {
    expect(canViewTransfers(['S1C'])).toBe(true);
    expect(hrefsFor(['S1C'])).toContain('/transfers');
  });

  it('shows Перемещения when any of the multiple roles grants access (Р-23)', () => {
    expect(canViewTransfers(['OPR', 'KSGP'])).toBe(true);
    expect(hrefsFor(['OPR', 'KSGP'])).toContain('/transfers');
  });

  // ОТК (решение владельца 26.10.2026): гостевой просмотр + отчёты.
  it('ОТК видит отчёты и гостевые экраны, но не рабочие места', () => {
    const hrefs = hrefsFor(['OTK']);
    expect(hrefs).toContain('/reports');
    expect(hrefs).toContain('/production-orders');
    expect(hrefs).toContain('/stock');
    expect(hrefs).toContain('/transfers');
    expect(hrefs).not.toContain('/shift-execution');
    expect(hrefs).not.toContain('/onec');
  });

  it('гость отчётов не видит', () => {
    expect(hrefsFor(['GUEST'])).not.toContain('/reports');
  });

  // Регресс 25.10.2026: меню «НСИ» выводилось в шапке без всякой проверки права —
  // гость видел его и получал отказ по клику.
  it('меню НСИ показывается только тем, у кого есть право читать справочники', () => {
    expect(getNsiNavItems(['GUEST'])).toEqual([]);
    expect(getNsiNavItems(['OPR']).map((item) => item.href)).toContain('/nsi/products');
    expect(getNsiNavItems(['NP'])).toHaveLength(6);
  });

  // Гостевая роль (решение владельца 25.10.2026): только три экрана на просмотр.
  it('гость видит ровно ПЗ, Остатки и Перемещения — и никаких рабочих мест', () => {
    const hrefs = hrefsFor(['GUEST']);
    expect(hrefs).toContain('/production-orders');
    expect(hrefs).toContain('/stock');
    expect(hrefs).toContain('/transfers');
    // Уведомлений тоже нет: гостю не адресовано ни одно событие (решение владельца 25.10.2026).
    expect(hrefs).not.toContain('/notifications');
    // Ни исполнения смены, ни 1С, ни администрирования: прав на действие у гостя нет.
    expect(hrefs).not.toContain('/shift-execution');
    expect(hrefs).not.toContain('/onec');
    expect(adminHrefsFor(['GUEST'])).toEqual([]);
  });

  it('builds the NP menu in a stable order', () => {
    expect(hrefsFor(['NP'])).toEqual([
      '/dashboard',
      '/notifications',
      '/production-orders',
      '/stock',
      '/transfers',
      // Отчёты — по праву reports:read (решение владельца 26.10.2026).
      '/reports',
    ]);
    // Аудит и хронометраж у НП есть, но в выпадающем меню администрирования.
    expect(adminHrefsFor(['NP'])).toEqual(['/audit', '/timing']);
  });

  it('builds the KSGP menu without pages the role cannot open', () => {
    expect(hrefsFor(['KSGP'])).toEqual([
      '/dashboard',
      '/notifications',
      '/stock',
      '/transfers',
    ]);
  });

  it('builds the OPR menu without Перемещения and without ПЗ', () => {
    expect(hrefsFor(['OPR'])).toEqual([
      '/dashboard',
      '/notifications',
      '/shift-execution',
      '/stock',
    ]);
  });

  it('builds the full menu for ADM', () => {
    // Пункта «Уведомления» нет: администратору не адресовано ни одно событие каталога,
    // его центр уведомлений всегда пуст (решение владельца 25.10.2026, ОПЭ-54).
    expect(hrefsFor(['ADM'])).toEqual([
      '/dashboard',
      '/production-orders',
      '/shift-execution',
      '/stock',
      '/transfers',
      // Отчёты идут перед рабочим местом 1С — так они и добавляются в меню
      // (решение владельца 26.10.2026).
      '/reports',
      '/onec',
    ]);
  });

  it('показывает «Данные» только администратору (T-076)', () => {
    expect(adminHrefsFor(['ADM'])).toContain('/data');
    for (const role of ['NP', 'OPR', 'KSGP', 'USGP', 'S1C']) {
      expect(adminHrefsFor([role])).not.toContain('/data');
    }
  });

  it('shows рабочее место 1С only for С1С и АДМ (M12 §3: просмотр данных для 1С — R)', () => {
    expect(hrefsFor(['S1C'])).toContain('/onec');
    expect(hrefsFor(['ADM'])).toContain('/onec');
    for (const role of ['NP', 'OPR', 'KSGP', 'USGP']) {
      expect(hrefsFor([role])).not.toContain('/onec');
    }
  });

  it('hides the production orders page from roles lacking production_order:read', () => {
    for (const role of ['KSGP', 'USGP']) {
      expect(hrefsFor([role])).not.toContain('/production-orders');
    }
  });

  it('shows ПЗ for С1С — право production_order:read (решение владельца 03.10.2026)', () => {
    expect(hrefsFor(['S1C'])).toContain('/production-orders');
  });

  it('никогда не выводит ссылку на несуществующую страницу /shift-reports', () => {
    for (const role of ['NP', 'OPR', 'KSGP', 'USGP', 'S1C', 'ADM']) {
      expect(hrefsFor([role])).not.toContain('/shift-reports');
    }
  });

  it('shows Уведомления тем, кому каталог адресует события', () => {
    for (const role of ['NP', 'OPR', 'KSGP', 'USGP', 'S1C']) {
      expect(hrefsFor([role])).toContain('/notifications');
    }
    // Гость и администратор событий не получают — пункт им не нужен (ОПЭ-54).
    expect(hrefsFor(['GUEST'])).not.toContain('/notifications');
    expect(hrefsFor(['ADM'])).not.toContain('/notifications');
  });

  it('shows Хронометраж for every role (M10 §3: просмотр хронометража — R для всех)', () => {
    for (const role of ['NP', 'OPR', 'KSGP', 'USGP', 'S1C', 'ADM']) {
      expect(adminHrefsFor([role])).toContain('/timing');
    }
  });

  it('shows Аудит only for НП и АДМ (M13 §3, BR-3)', () => {
    expect(adminHrefsFor(['NP'])).toContain('/audit');
    expect(adminHrefsFor(['ADM'])).toContain('/audit');
    for (const role of ['OPR', 'KSGP', 'USGP', 'S1C']) {
      expect(adminHrefsFor([role])).not.toContain('/audit');
    }
  });

  it('shows Роли only for the role holding roles:manage (M02, T-069)', () => {
    expect(adminHrefsFor(['ADM'])).toContain('/roles');
    for (const role of ['NP', 'OPR', 'KSGP', 'USGP', 'S1C']) {
      expect(adminHrefsFor([role])).not.toContain('/roles');
    }
    // Совмещение ролей (Р-23): право даёт любая из ролей пользователя.
    expect(adminHrefsFor(['OPR', 'ADM'])).toContain('/roles');
  });

  it('выносит редкие экраны из основной полосы меню', () => {
    // Из-за тринадцати пунктов шапка переносилась на вторую строку (замечание владельца 12.10.2026).
    for (const role of ['NP', 'OPR', 'KSGP', 'USGP', 'S1C', 'ADM']) {
      for (const href of ['/audit', '/data', '/roles', '/users', '/timing']) {
        expect(hrefsFor([role])).not.toContain(href);
      }
    }
  });

  it('показывает «Пользователи» только ролям с правом users:manage', () => {
    expect(adminHrefsFor(['ADM'])).toContain('/users');
    for (const role of ['NP', 'OPR', 'KSGP', 'USGP', 'S1C']) {
      expect(adminHrefsFor([role])).not.toContain('/users');
    }
  });

  it('меню администрирования строится для администратора в устойчивом порядке', () => {
    expect(adminHrefsFor(['ADM'])).toEqual(['/audit', '/data', '/roles', '/users', '/timing']);
  });

  it('не выводит пунктов администрирования у роли без подходящих прав', () => {
    // Пустое меню не показывается вовсе; проверяем на роли, у которой нет ни аудита,
    // ни прав администратора — остаётся только хронометраж, доступный всем.
    expect(adminHrefsFor(['KSGP'])).toEqual(['/timing']);
  });

  it('always keeps the dashboard entry', () => {
    for (const role of ['NP', 'OPR', 'KSGP', 'USGP', 'S1C', 'ADM']) {
      expect(hrefsFor([role])).toContain('/dashboard');
    }
  });
});

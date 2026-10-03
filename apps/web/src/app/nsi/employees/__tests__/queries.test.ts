import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@prodtrack/db';
import { EMPLOYEES_PAGE_SIZE, employeeWhere, getEmployeesPage } from '../queries';

vi.mock('@prodtrack/db', () => ({ prisma: { employee: { findMany: vi.fn() } } }));

describe('employeeWhere — серверный поиск (T-058)', () => {
  it('без запроса условий нет', () => {
    expect(employeeWhere({})).toEqual({});
  });

  it('ищет по ФИО и табельному номеру без учёта регистра', () => {
    expect(employeeWhere({ q: 'Иванов' })).toEqual({
      OR: [
        { tabNumber: { contains: 'Иванов', mode: 'insensitive' } },
        { fullName: { contains: 'Иванов', mode: 'insensitive' } },
      ],
    });
  });

  it('фильтрует по активности', () => {
    expect(employeeWhere({ active: 'INACTIVE' })).toEqual({ active: false });
  });
});

describe('getEmployeesPage (T-057)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('сортирует по табельному номеру и берёт страницу', async () => {
    (prisma.employee.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await getEmployeesPage({ q: '001', active: 'ACTIVE' }, '3');

    expect(prisma.employee.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { tabNumber: { contains: '001', mode: 'insensitive' } },
          { fullName: { contains: '001', mode: 'insensitive' } },
        ],
        active: true,
      },
      orderBy: { tabNumber: 'asc' },
      skip: EMPLOYEES_PAGE_SIZE * 2,
      take: EMPLOYEES_PAGE_SIZE + 1,
    });
    expect(result.page).toBe(3);
    expect(result.hasNextPage).toBe(false);
  });
});

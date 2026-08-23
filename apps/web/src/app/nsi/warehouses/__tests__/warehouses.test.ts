import { WarehouseType } from '@prodtrack/contracts';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Warehouse } from '@prisma/client';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@prodtrack/db', async () => {
  const actual = await vi.importActual<typeof import('@prodtrack/db')>('@prodtrack/db');
  return {
    ...actual,
    prisma: {
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        const mockTx = {
          warehouse: {
            update: vi.fn(),
            findUniqueOrThrow: vi.fn(),
          },
        };
        return cb(mockTx);
      }),
      warehouse: {
        findUniqueOrThrow: vi.fn(),
      },
    },
    writeAudit: vi.fn(),
  };
});

vi.mock('@/lib/auth/access', () => ({
  requirePermission: vi.fn().mockResolvedValue({ userId: 'admin-user', user: { roles: [{ role: { code: 'ADM' } }] } } as any),
}));

const base: Warehouse = {
  id: 'w-1',
  name: 'Производственный склад',
  description: 'Склад сырья и материалов',
  type: 'PRODUCTION' as WarehouseType,
  active: true,
};

describe('updateWarehouse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects empty name', async () => {
    const { updateWarehouse } = await import('../actions');
    await expect(updateWarehouse('w-1', { name: '   ', description: 'Desc' })).rejects.toThrow('Название обязательно');
  });

  it('updates warehouse and writes audit', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.warehouse.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    (prisma as unknown as { $transaction: (cb: (tx: { warehouse: { update: () => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        warehouse: {
          update: vi.fn().mockResolvedValue({ ...base, name: 'Производственный', description: 'Обновлённое' }),
        },
      };
      return cb(mockTx);
    });
    const { updateWarehouse } = await import('../actions');
    const updated = await updateWarehouse('w-1', { name: 'Производственный', description: 'Обновлённое' });
    expect(updated.name).toBe('Производственный');
    expect(updated.description).toBe('Обновлённое');
    expect(writeAudit).toHaveBeenCalled();
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.userRoles).toEqual(['ADM']);
    expect(auditCall.permission).toBe('nsi:manage');
    expect(auditCall.action).toBe('UPDATE');
  });
});

describe('toggleWarehouseActive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toggles active flag and writes audit', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.warehouse.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    (prisma as unknown as { $transaction: (cb: (tx: { warehouse: { update: () => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        warehouse: {
          update: vi.fn().mockResolvedValue({ ...base, active: false }),
        },
      };
      return cb(mockTx);
    });
    const { toggleWarehouseActive } = await import('../actions');
    const updated = await toggleWarehouseActive('w-1');
    expect(updated.active).toBe(false);
    expect(writeAudit).toHaveBeenCalled();
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.field).toBe('active');
  });
});

describe('no create action', () => {
  it('actions module does not export createWarehouse', async () => {
    const actions = await import('../actions') as Record<string, unknown>;
    expect(actions.createWarehouse).toBeUndefined();
  });
});

describe('BR-9: warehouse catalog is fixed', () => {
  it('does not expose a deleteWarehouse action', async () => {
    const actions = await import('../actions') as Record<string, unknown>;
    expect(actions.deleteWarehouse).toBeUndefined();
  });

  it('client page does not render toggle/deactivate button for warehouses', async () => {
    const { default: fs } = await import('node:fs');
    const clientPageSource = fs.readFileSync('src/app/nsi/warehouses/_client-page.tsx', 'utf-8');
    expect(clientPageSource).not.toContain('ToggleWarehouseButton');
    expect(clientPageSource).not.toContain('Деактивировать');
    expect(clientPageSource).not.toContain('Создать');
  });
});

describe('seed loaded 2 warehouses with correct types', () => {
  it('seed data contains production and finished goods warehouses', async () => {
    const { default: fs } = await import('node:fs');
    const seedSource = fs.readFileSync('src/app/nsi/warehouses/_client-page.tsx', 'utf-8');
    expect(seedSource).toContain('Производственный');
    expect(seedSource).toContain('Склад ГП');
  });
});
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Product } from '@prisma/client';
import { ProductCategory } from '@prodtrack/contracts';

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
          product: {
            create: vi.fn(),
            update: vi.fn(),
            findUnique: vi.fn(),
            findUniqueOrThrow: vi.fn(),
          },
        };
        return cb(mockTx);
      }),
      product: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
    },
    writeAudit: vi.fn(),
  };
});

vi.mock('@/lib/auth/access', () => ({
  requirePermission: vi.fn().mockResolvedValue({ userId: 'admin-user', user: { roles: [{ role: { code: 'ADM' } }] } } as any),
}));

const base: Product = {
  id: 'p-1',
  code: 'SKU-001',
  name: 'Мыло',
  category: ProductCategory.GP,
  unit: 'шт',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('createProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects empty code', async () => {
    const { createProduct } = await import('../actions');
    await expect(createProduct({ code: '   ', name: 'Name', category: ProductCategory.GP, unit: 'кг' })).rejects.toThrow('Код обязателен');
  });

  it('rejects duplicate code', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.product.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    const { createProduct } = await import('../actions');
    await expect(createProduct({ code: 'SKU-001', name: 'Other', category: ProductCategory.GP, unit: 'кг' })).rejects.toThrow('Номенклатура с таким кодом уже существует');
  });

  it('rejects invalid category', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.product.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { createProduct } = await import('../actions');
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createProduct({ code: 'X', name: 'X', category: 'PF' as any, unit: 'кг' }),
    ).rejects.toThrow('Категория может быть только Масса или ГП');
  });

  it('rejects empty unit and unit longer than 20 chars', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.product.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { createProduct } = await import('../actions');
    await expect(createProduct({ code: 'X', name: 'X', category: ProductCategory.GP, unit: '' })).rejects.toThrow('Единица измерения обязательна');
    await expect(createProduct({ code: 'X', name: 'X', category: ProductCategory.GP, unit: 'a'.repeat(21) })).rejects.toThrow('Единица измерения не может превышать 20 символов');
  });

  it('creates product with valid data and writes audit', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.product.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma as unknown as { $transaction: (cb: (tx: { product: { create: () => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        product: {
          create: vi.fn().mockResolvedValue({
            id: 'new',
            code: 'SKU-002',
            name: 'Гель',
            category: ProductCategory.GP,
            unit: 'л',
            active: true,
          }),
        },
      };
      return cb(mockTx);
    });
    const { createProduct } = await import('../actions');
    const created = await createProduct({ code: 'SKU-002', name: 'Гель', category: ProductCategory.GP, unit: 'л' });
    expect(created.category).toBe(ProductCategory.GP);
    expect(created.unit).toBe('л');
    expect(writeAudit).toHaveBeenCalled();
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.userRoles).toEqual(['ADM']);
    expect(auditCall.permission).toBe('nsi:manage');
    expect(auditCall.action).toBe('CREATE');
  });
});

describe('updateProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks duplicate code on another record', async () => {
    const { prisma } = await import('@prodtrack/db');
    (prisma.product.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...base, id: 'other-id' });
    const { updateProduct } = await import('../actions');
    await expect(updateProduct('p-1', { code: 'SKU-001', name: 'X', category: ProductCategory.GP, unit: 'кг' })).rejects.toThrow('Номенклатура с таким кодом уже существует');
  });

  it('updates product and writes audit', async () => {
    const { prisma, writeAudit } = await import('@prodtrack/db');
    (prisma.product.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.product.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(base);
    (prisma as unknown as { $transaction: (cb: (tx: { product: { update: () => Promise<unknown> } }) => Promise<unknown>) => Promise<unknown> }).$transaction = vi.fn(async (cb) => {
      const mockTx = {
        product: {
          update: vi.fn().mockResolvedValue({ ...base, code: 'SKU-003', name: 'Шампунь', unit: 'уп' }),
        },
      };
      return cb(mockTx);
    });
    const { updateProduct } = await import('../actions');
    const updated = await updateProduct('p-1', { code: 'SKU-003', name: 'Шампунь', category: ProductCategory.GP, unit: 'уп' });
    expect(updated.unit).toBe('уп');
    expect(writeAudit).toHaveBeenCalled();
    const auditCall = (writeAudit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(auditCall.action).toBe('UPDATE');
  });
});

describe('UC-M01-2: deactivation warnings (Phase 2/3 stub)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getDeactivationWarnings requires admin and returns empty list', async () => {
    const { requirePermission } = await import('@/lib/auth/access');
    const { getDeactivationWarnings } = await import('../actions');
    const warnings = await getDeactivationWarnings('p-1');
    expect(requirePermission).toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });
});
import { describe, it, expect, vi } from 'vitest';
import { type WorkCenter, type Product, type Employee, type Shift } from '@prisma/client';
import { validateProductionOrderLine, validateProductionOrder } from '../production-order';

function makeWorkCenter(overrides: Partial<WorkCenter> = {}): WorkCenter {
  return {
    id: 'wc-01',
    code: '01',
    name: '01.Реактор',
    producesMass: true,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as WorkCenter;
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'mass-1',
    code: 'M-001',
    name: 'Масса',
    category: 'MASS',
    unit: 'кг',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Product;
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 'emp-1',
    tabNumber: '001',
    fullName: 'Иванов И.И.',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Employee;
}

describe('validateProductionOrderLine', () => {
  it('returns valid for active MASS line on РЦ 01', async () => {
    const result = await validateProductionOrderLine(
      { workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' },
      makeWorkCenter(),
      makeProduct(),
      makeEmployee(),
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid for active GP line on РЦ 03', async () => {
    const result = await validateProductionOrderLine(
      { workCenterId: 'wc-03', productId: 'gp-1', plannedQuantity: 5, operatorId: 'emp-1' },
      makeWorkCenter({ id: 'wc-03', code: '03', producesMass: false }),
      makeProduct({ id: 'gp-1', code: 'GP-001', name: 'Крем', category: 'GP', unit: 'шт' }),
      makeEmployee(),
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('blocks MASS on GP work center (BR-7)', async () => {
    const result = await validateProductionOrderLine(
      { workCenterId: 'wc-03', productId: 'mass-1', plannedQuantity: 5, operatorId: 'emp-1' },
      makeWorkCenter({ id: 'wc-03', code: '03', producesMass: false }),
      makeProduct(),
      makeEmployee(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ГП можно планировать только на РЦ 03–12');
  });

  it('blocks GP on MASS work center (BR-7)', async () => {
    const result = await validateProductionOrderLine(
      { workCenterId: 'wc-01', productId: 'gp-1', plannedQuantity: 5, operatorId: 'emp-1' },
      makeWorkCenter(),
      makeProduct({ id: 'gp-1', code: 'GP-001', name: 'Крем', category: 'GP', unit: 'шт' }),
      makeEmployee(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Массу можно планировать только на РЦ 01/02');
  });

  it('blocks inactive work center', async () => {
    const result = await validateProductionOrderLine(
      { workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' },
      makeWorkCenter({ active: false }),
      makeProduct(),
      makeEmployee(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('РЦ деактивирован');
  });

  it('blocks inactive product', async () => {
    const result = await validateProductionOrderLine(
      { workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' },
      makeWorkCenter(),
      makeProduct({ active: false }),
      makeEmployee(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Номенклатура деактивирована');
  });

  it('blocks inactive operator', async () => {
    const result = await validateProductionOrderLine(
      { workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' },
      makeWorkCenter(),
      makeProduct(),
      makeEmployee({ active: false }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Сотрудник деактивирован');
  });

  it('blocks zero quantity', async () => {
    const result = await validateProductionOrderLine(
      { workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 0, operatorId: 'emp-1' },
      makeWorkCenter(),
      makeProduct(),
      makeEmployee(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Плановое количество должно быть больше 0');
  });

  it('blocks negative quantity', async () => {
    const result = await validateProductionOrderLine(
      { workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: -5, operatorId: 'emp-1' },
      makeWorkCenter(),
      makeProduct(),
      makeEmployee(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Плановое количество должно быть больше 0');
  });
});

describe('validateProductionOrder', () => {
  function makeMockPrisma(overrides: {
    shift?: Shift | null;
    workCenters?: WorkCenter[];
    products?: Product[];
    employees?: Employee[];
  } = {}) {
    const resolvedShift = overrides.shift !== undefined ? overrides.shift : {
      id: 'shift-1',
      number: 1,
      date: new Date(),
      start: '08:00',
      end: '20:00',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Shift;

    return {
      shift: {
        findUnique: vi.fn().mockResolvedValue(resolvedShift),
      },
      workCenter: {
        findMany: vi.fn().mockResolvedValue(overrides.workCenters ?? [makeWorkCenter()]),
      },
      product: {
        findMany: vi.fn().mockResolvedValue(overrides.products ?? [makeProduct()]),
      },
      employee: {
        findMany: vi.fn().mockResolvedValue(overrides.employees ?? [makeEmployee()]),
      },
    } as unknown as Parameters<typeof validateProductionOrder>[1];
  }

  it('returns valid for complete order with active entities', async () => {
    const prisma = makeMockPrisma();
    const result = await validateProductionOrder(
      {
        shiftId: 'shift-1',
        lines: [{ workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' }],
      },
      prisma,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('blocks empty lines', async () => {
    const prisma = makeMockPrisma();
    const result = await validateProductionOrder({ shiftId: 'shift-1', lines: [] }, prisma);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Добавьте хотя бы одну строку ПЗ');
  });

  it('blocks missing shift', async () => {
    const prisma = makeMockPrisma({ shift: null });
    const result = await validateProductionOrder(
      {
        shiftId: 'missing',
        lines: [{ workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' }],
      },
      prisma,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Смена не найдена');
  });

  it('blocks inactive shift', async () => {
    const prisma = makeMockPrisma({
      shift: { id: 'shift-1', number: 1, date: new Date(), start: '08:00', end: '20:00', active: false, createdAt: new Date(), updatedAt: new Date() } as Shift,
    });
    const result = await validateProductionOrder(
      {
        shiftId: 'shift-1',
        lines: [{ workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' }],
      },
      prisma,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Смена деактивирована');
  });

  it('blocks duplicate work center in lines (BR-3)', async () => {
    const prisma = makeMockPrisma();
    const result = await validateProductionOrder(
      {
        shiftId: 'shift-1',
        lines: [
          { workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' },
          { workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 5, operatorId: 'emp-1' },
        ],
      },
      prisma,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('РЦ может встречаться в ПЗ только один раз: 01.Реактор');
  });

  it('blocks inactive work center via order validation', async () => {
    const prisma = makeMockPrisma({ workCenters: [makeWorkCenter({ active: false })] });
    const result = await validateProductionOrder(
      {
        shiftId: 'shift-1',
        lines: [{ workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' }],
      },
      prisma,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('РЦ деактивирован (строка 1)');
  });

  it('blocks inactive product via order validation', async () => {
    const prisma = makeMockPrisma({ products: [makeProduct({ active: false })] });
    const result = await validateProductionOrder(
      {
        shiftId: 'shift-1',
        lines: [{ workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' }],
      },
      prisma,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Номенклатура деактивирована (строка 1)');
  });

  it('blocks inactive operator via order validation', async () => {
    const prisma = makeMockPrisma({ employees: [makeEmployee({ active: false })] });
    const result = await validateProductionOrder(
      {
        shiftId: 'shift-1',
        lines: [{ workCenterId: 'wc-01', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' }],
      },
      prisma,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Сотрудник деактивирован (строка 1)');
  });

  it('blocks incomplete line', async () => {
    const prisma = makeMockPrisma();
    const result = await validateProductionOrder(
      {
        shiftId: 'shift-1',
        lines: [{ workCenterId: '', productId: 'mass-1', plannedQuantity: 10, operatorId: 'emp-1' }],
      },
      prisma,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Заполните РЦ, номенклатуру, количество и Оператора (строка 1)');
  });
});

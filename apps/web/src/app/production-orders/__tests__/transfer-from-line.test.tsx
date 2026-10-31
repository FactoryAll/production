import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('../actions', () => ({
  confirmProductionOrderAction: vi.fn(),
  substituteOperatorAction: vi.fn(),
  cancelProductionOrderAction: vi.fn(),
  correctProductionFactAction: vi.fn(),
}));

import ProductionOrderCard from '../[id]/_client-card';

/**
 * Кнопка «Создать перемещение» из строки ПЗ (T-103, решение владельца 30.10.2026).
 *
 * Проверяем три вещи владельца: кнопка у ГП-строки, количество — ФАКТ ГП (а не план),
 * и предупреждение о уже созданном перемещении со ссылкой, но без блокировки.
 */
const PRODUCTION_WAREHOUSE = 'wh-prod';
const FINISHED_GOODS_WAREHOUSE = 'wh-gp';

function gpFact(quantity: number) {
  return {
    id: `fact-gp-${quantity}`,
    lineId: 'line-1',
    productId: 'gp-1',
    factCategory: 'GP',
    quantity: new Decimal(quantity),
    defectQuantity: new Decimal(0),
    defectReasonId: null,
    defectReason: null,
    stopsCount: 0,
    stopsDurationMinutes: 0,
    comment: null,
    recordedAt: new Date(),
    reportedAt: new Date(),
    reportedByUserId: 'user-1',
    createdById: 'user-1',
    postCompletionCorrection: false,
    correctionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    consumptions: [],
  };
}

function pfFact(quantity: number) {
  return { ...gpFact(quantity), id: `fact-pf-${quantity}`, factCategory: 'PF' };
}

function makeOrder(overrides: { category?: 'MASS' | 'GP'; facts?: unknown[] } = {}) {
  const category = overrides.category ?? 'GP';
  return {
    id: 'po-1',
    status: 'COMPLETED',
    shiftId: 'shift-1',
    createdById: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: new Date(),
    confirmedAt: null,
    confirmedByUserId: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    shift: { id: 'shift-1', number: 2, date: new Date('2026-10-30'), start: '08:00', end: '20:00', active: true },
    createdBy: { id: 'user-1', login: 'np' },
    confirmedBy: null,
    cancelledBy: null,
    lines: [
      {
        id: 'line-1',
        orderId: 'po-1',
        workCenterId: 'wc-03',
        productId: 'gp-1',
        plannedQuantity: new Decimal(40),
        operatorId: 'emp-1',
        status: 'REPORTED',
        comment: null,
        substitutionReasonId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        workCenter: { id: 'wc-03', code: '03', name: 'Тубировка крем', producesMass: false, active: true },
        product: {
          id: 'gp-1',
          code: 'GP002',
          name: 'Готовая продукция Б',
          unit: 'шт',
          category,
          active: true,
        },
        operator: null,
        facts: overrides.facts ?? [gpFact(45)],
        workerAssignments: [],
      },
    ],
  } as never;
}

function renderCard(overrides: {
  order?: ReturnType<typeof makeOrder>;
  userRoles?: string[];
} = {}) {
  return render(
    <ProductionOrderCard
      order={overrides.order ?? makeOrder()}
      defectReasons={[]}
      consumableProducts={[]}
      absenceReasons={[]}
      workerCandidates={[]}
      transferWarehouses={[
        { id: PRODUCTION_WAREHOUSE, type: 'PRODUCTION' },
        { id: FINISHED_GOODS_WAREHOUSE, type: 'FINISHED_GOODS' },
      ]}
      userRoles={overrides.userRoles ?? ['NP']}
    />,
  );
}

describe('Перемещение из строки ПЗ: кнопка и предупреждение (T-103)', () => {
  it('у ГП-строки есть кнопка, и в ссылке — факт ГП и склады (без привязки к строке ПЗ)', () => {
    renderCard({ order: makeOrder({ facts: [gpFact(45), pfFact(10)] }) });

    const link = screen.getByRole('link', { name: /Создать перемещение/ });
    const href = link.getAttribute('href') ?? '';

    expect(href.startsWith('/transfers/new?')).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    // Количество — ФАКТ ГП (45), а не план (40) и не сумма с ПФ (55).
    expect(params.get('quantity')).toBe('45');
    expect(params.get('productId')).toBe('gp-1');
    // Привязки к строке ПЗ больше нет (решение владельца 31.10.2026).
    expect(params.get('productionOrderLineId')).toBeNull();
    expect(params.get('sourceWarehouseId')).toBe(PRODUCTION_WAREHOUSE);
    expect(params.get('destinationWarehouseId')).toBe(FINISHED_GOODS_WAREHOUSE);
  });

  it('без факта ГП количество не подставляется — поле остаётся пустым', () => {
    renderCard({ order: makeOrder({ facts: [pfFact(10)] }) });

    const link = screen.getByRole('link', { name: /Создать перемещение/ });
    const href = link.getAttribute('href') ?? '';
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(params.get('quantity')).toBeNull();
  });

  it('у строки Массы перемещения нет: перемещают только ГП', () => {
    renderCard({ order: makeOrder({ category: 'MASS' }) });

    expect(screen.queryByRole('link', { name: /Создать перемещение/ })).toBeNull();
  });

  it('без права transfer:create кнопки нет', () => {
    renderCard({ userRoles: ['OTK'] });

    expect(screen.queryByRole('link', { name: /Создать перемещение/ })).toBeNull();
  });
});

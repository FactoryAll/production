import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getDeactivationWarnings, type DeactivatableEntityType } from './deactivation';

interface MockClient {
  productionOrder: { findMany: ReturnType<typeof vi.fn> };
  goodsTransfer: { findMany: ReturnType<typeof vi.fn> };
}

function buildClient(): MockClient {
  return {
    productionOrder: { findMany: vi.fn().mockResolvedValue([]) },
    goodsTransfer: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

function warningsFor(entityType: DeactivatableEntityType, entityId: string, client: MockClient) {
  return getDeactivationWarnings(entityType, entityId, client as unknown as PrismaClient);
}

describe('Предупреждение Р-22: незавершённые документы при деактивации (M01 BR-13)', () => {
  it('РЦ: ПЗ в незавершённых статусах со строкой на этом РЦ', async () => {
    const client = buildClient();
    client.productionOrder.findMany.mockResolvedValue([
      { id: 'abcdefgh-1', status: 'IN_PROGRESS' },
    ]);

    const warnings = await warningsFor('WorkCenter', 'wc-01', client);

    expect(client.productionOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'] },
          lines: { some: { workCenterId: 'wc-01' } },
        },
      }),
    );
    expect(warnings).toEqual([
      { type: 'PRODUCTION_ORDER', id: 'abcdefgh-1', label: 'ПЗ abcdefgh · В работе' },
    ]);
  });

  it('Номенклатура: и ПЗ, и Перемещения со строками на эту позицию', async () => {
    const client = buildClient();
    client.productionOrder.findMany.mockResolvedValue([{ id: 'po-1', status: 'DRAFT' }]);
    client.goodsTransfer.findMany.mockResolvedValue([{ id: 'tr-1', status: 'SUBMITTED' }]);

    const warnings = await warningsFor('Product', 'p-1', client);

    expect(client.goodsTransfer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['DRAFT', 'SUBMITTED'] }, lines: { some: { productId: 'p-1' } } },
      }),
    );
    expect(warnings.map((warning) => warning.type)).toEqual(['PRODUCTION_ORDER', 'GOODS_TRANSFER']);
    expect(warnings[1].label).toBe('Перемещение tr-1 · Отправлено');
  });

  it('Сотрудник: Оператор строки или назначенный работник РЦ', async () => {
    const client = buildClient();

    await warningsFor('Employee', 'emp-1', client);

    expect(client.productionOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          lines: {
            some: {
              OR: [
                { operatorId: 'emp-1' },
                { workerAssignments: { some: { employeeId: 'emp-1' } } },
              ],
            },
          },
        }),
      }),
    );
  });

  it('Причина брака: ПЗ, в факте которых она указана', async () => {
    const client = buildClient();

    await warningsFor('DefectReason', 'dr-1', client);

    expect(client.productionOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          lines: { some: { facts: { some: { defectReasonId: 'dr-1' } } } },
        }),
      }),
    );
  });

  it('Причина ввода за Оператора: строки с внесённым итогом (Р-11)', async () => {
    const client = buildClient();

    await warningsFor('SubstitutionReason', 'sr-1', client);

    expect(client.productionOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lines: { some: { substitutionReasonId: 'sr-1', status: 'REPORTED' } } },
      }),
    );
  });

  it('Смена: ПЗ, привязанные к этой смене', async () => {
    const client = buildClient();

    await warningsFor('Shift', 'shift-1', client);

    expect(client.productionOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shiftId: 'shift-1', status: { in: ['DRAFT', 'CONFIRMED', 'IN_PROGRESS'] } },
      }),
    );
  });

  it('если незавершённых документов нет — пустой список, деактивация не блокируется', async () => {
    const client = buildClient();

    expect(await warningsFor('WorkCenter', 'wc-01', client)).toEqual([]);
  });
});

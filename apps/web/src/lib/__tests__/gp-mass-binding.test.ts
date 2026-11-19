import { describe, it, expect, vi } from 'vitest';
import {
  bindingQuantity,
  isMassAllowedForProduct,
  isPackagingWorkCenterAllowed,
  massBindingViolationText,
  suggestedMassQuantity,
} from '../gp-mass-binding';
import { applyBomPlan } from '@/lib/bom-import/apply';
import type { BomPlan } from '@/lib/bom-import/plan';

/**
 * Привязки изделия (решение владельца 19.11.2026): одна Масса и одна Туба, РЦ фасовки, нормы.
 * Тесты держат главное свойство: правило действует только там, где привязка есть, — иначе
 * релиз остановил бы планирование позиций, у которых привязку ещё не завели.
 */

describe('правило «одна Масса на изделие»', () => {
  it('без привязки не ограничивает: любая Масса, как раньше', () => {
    expect(isMassAllowedForProduct(undefined, 'MASS-1')).toBeNull();
    expect(isMassAllowedForProduct({ massCode: null }, 'MASS-1')).toBeNull();
  });

  it('с привязкой разрешает только свою Массу', () => {
    expect(isMassAllowedForProduct({ massCode: 'MASS-1' }, 'MASS-1')).toBe(true);
    expect(isMassAllowedForProduct({ massCode: 'MASS-1' }, 'MASS-2')).toBe(false);
  });

  it('текст отказа называет Массу и говорит, куда идти с другой', () => {
    const text = massBindingViolationText('MASS-1');
    expect(text).toContain('только Масса MASS-1');
    expect(text).toContain('Ввести за Оператора');
  });
});

describe('РЦ фасовки', () => {
  it('пустой список = все фасовочные РЦ (поведение как до релиза)', () => {
    expect(isPackagingWorkCenterAllowed(undefined, '03')).toBe(true);
    expect(isPackagingWorkCenterAllowed({ packagingWorkCenterCodes: [] }, '03')).toBe(true);
  });

  it('заполненный список ограничивает', () => {
    expect(isPackagingWorkCenterAllowed({ packagingWorkCenterCodes: ['03', '13'] }, '03')).toBe(true);
    expect(isPackagingWorkCenterAllowed({ packagingWorkCenterCodes: ['03', '13'] }, '04')).toBe(false);
  });
});

describe('норма из спецификации', () => {
  it('считает количество как норму на единицу выпуска', () => {
    expect(suggestedMassQuantity({ massQuantity: 0.088 }, 1000)).toBeCloseTo(88);
    expect(suggestedMassQuantity({ massQuantity: '5' }, 2)).toBe(10);
  });

  it('без нормы или без выпуска количество не подставляет', () => {
    expect(suggestedMassQuantity(undefined, 100)).toBeNull();
    expect(suggestedMassQuantity({ massQuantity: 1 }, 0)).toBeNull();
    expect(suggestedMassQuantity({ massQuantity: null }, 100)).toBeNull();
  });

  it('пустое и битое значение нормы не превращается в NaN', () => {
    expect(bindingQuantity('')).toBeNull();
    expect(bindingQuantity('abc')).toBeNull();
    expect(bindingQuantity('1,5')).toBe(1.5);
  });
});

describe('запись привязок из спецификации', () => {
  function buildClient(existing: Array<Record<string, unknown>>) {
    const update = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const runCreate = vi.fn().mockResolvedValue({ id: 'run-1' });
    const tx = {
      product: { update },
      auditRecord: { create: auditCreate },
      bomImportRun: { create: runCreate },
    };
    const client = {
      product: { findMany: vi.fn().mockResolvedValue(existing) },
      bomImportRun: { create: runCreate },
      $transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    };
    return { client, update, auditCreate, runCreate };
  }

  const plan = {
    bind: [
      {
        gpCode: 'GP-1',
        gpName: 'Крем',
        massCode: 'MASS-1',
        massShare: 0.088,
        tubeCode: 'TUBE-1',
        tubeName: 'Туба Крем',
        tubeShare: 1,
        action: 'bind' as const,
      },
    ],
    skip: [],
    absentFromFile: [],
    withoutMassInFile: [],
    counts: { fromFile: 1, bind: 1, skip: 0, absentFromFile: 0, withoutMassInFile: 0 },
  } satisfies BomPlan;

  it('пишет Массу ссылкой, а Тубу — кодом и наименованием, пока её нет в номенклатуре', async () => {
    const { client, update, auditCreate } = buildClient([
      {
        id: 'gp-1',
        code: 'GP-1',
        name: 'Крем',
        massProductId: null,
        massQuantity: null,
        tubeProductId: null,
        tubeProductCode: null,
        tubeQuantity: null,
      },
      { id: 'mass-1', code: 'MASS-1', name: 'Масса', massProductId: null, massQuantity: null, tubeProductId: null, tubeProductCode: null, tubeQuantity: null },
    ]);

    const result = await applyBomPlan(client as never, plan, { fileName: '4-bom.xlsx' });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'gp-1' },
      data: expect.objectContaining({
        massProductId: 'mass-1',
        massQuantity: 0.088,
        tubeProductCode: 'TUBE-1',
        tubeProductName: 'Туба Крем',
      }),
    });
    // Мастер-данные меняются загрузкой — каждое изменение обязано попасть в журнал.
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ massBound: 1, tubeBound: 1, skipped: 0 });
  });

  it('повторная загрузка того же файла ничего не меняет', async () => {
    const { client, update } = buildClient([
      {
        id: 'gp-1',
        code: 'GP-1',
        name: 'Крем',
        massProductId: 'mass-1',
        massQuantity: '0.088',
        tubeProductId: null,
        tubeProductCode: 'TUBE-1',
        tubeQuantity: '1',
      },
      { id: 'mass-1', code: 'MASS-1', name: 'Масса', massProductId: null, massQuantity: null, tubeProductId: null, tubeProductCode: null, tubeQuantity: null },
    ]);

    const result = await applyBomPlan(client as never, plan, { fileName: '4-bom.xlsx' });

    expect(update).not.toHaveBeenCalled();
    expect(result.massUnchanged).toBe(1);
  });
});

describe('проверка привязки в серверных путях ввода (19.11.2026)', () => {
  const boundProduct = {
    massProductId: 'mass-1',
    massProduct: { code: '00-00000767' },
  };

  it('без привязки не мешает — прежнее правило', async () => {
    const { assertConsumptionMatchesProductBinding } = await import('../gp-mass-binding');
    expect(() =>
      assertConsumptionMatchesProductBinding(
        { massProductId: null, massProduct: null },
        [{ productId: 'any', stockCategory: 'MASS' }],
      ),
    ).not.toThrow();
  });

  it('со своей Массой пропускает', async () => {
    const { assertConsumptionMatchesProductBinding } = await import('../gp-mass-binding');
    expect(() =>
      assertConsumptionMatchesProductBinding(boundProduct, [{ productId: 'mass-1', stockCategory: 'MASS' }]),
    ).not.toThrow();
  });

  it('чужую Массу отбивает текстом про привязку и «Ввод за Оператора»', async () => {
    const { assertConsumptionMatchesProductBinding } = await import('../gp-mass-binding');
    expect(() =>
      assertConsumptionMatchesProductBinding(boundProduct, [{ productId: 'mass-2', stockCategory: 'MASS' }]),
    ).toThrow(/только Масса 00-00000767/);
  });

  it('ПФ привязка Массы не касается', async () => {
    const { assertConsumptionMatchesProductBinding } = await import('../gp-mass-binding');
    expect(() =>
      assertConsumptionMatchesProductBinding(boundProduct, [{ productId: 'pf-1', stockCategory: 'PF' }]),
    ).not.toThrow();
  });
});

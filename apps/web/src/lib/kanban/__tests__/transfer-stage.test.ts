import { describe, it, expect } from 'vitest';
import { resolveTransferColumn, transferEventDate, transferNote } from '../transfer-stage';

/**
 * Самостоятельные перемещения на доске (решение владельца 31.10.2026).
 *
 * Отбор — по дате документа в окне выбранной смены, и других дат у `GoodsTransfer` нет:
 * `createdAt` для черновика, `submittedAt` (или `updatedAt`) для отправки, `updatedAt`
 * для приёмки, расхождения и отмены.
 */
const DAY = { from: new Date('2026-10-30T08:00:00'), to: new Date('2026-10-30T20:00:00') };

function transfer(overrides: Partial<{
  status: string;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
}> = {}) {
  return {
    status: 'DRAFT',
    createdAt: new Date('2026-10-30T09:00:00'),
    updatedAt: new Date('2026-10-30T09:00:00'),
    submittedAt: null,
    ...overrides,
  };
}

describe('дата перемещения по статусу', () => {
  it('черновик — createdAt', () => {
    const createdAt = new Date('2026-10-30T09:00:00');
    expect(transferEventDate(transfer({ status: 'DRAFT', createdAt }))).toEqual(createdAt);
  });

  it('отправлено — submittedAt', () => {
    const submittedAt = new Date('2026-10-30T12:00:00');
    expect(transferEventDate(transfer({ status: 'SUBMITTED', submittedAt }))).toEqual(submittedAt);
  });

  it('отправлено без submittedAt — updatedAt', () => {
    const updatedAt = new Date('2026-10-30T13:00:00');
    expect(
      transferEventDate(transfer({ status: 'SUBMITTED', submittedAt: null, updatedAt })),
    ).toEqual(updatedAt);
  });

  it('приёмка, расхождение и отмена — updatedAt', () => {
    for (const status of ['RECEIVED', 'RECONCILED', 'DISCREPANCY', 'CANCELLED']) {
      const updatedAt = new Date('2026-10-30T15:00:00');
      expect(transferEventDate(transfer({ status, updatedAt }))).toEqual(updatedAt);
    }
  });
});

describe('колонка перемещения', () => {
  it('статусы раскладываются по колонкам 6–9 и «Отменено»', () => {
    expect(resolveTransferColumn(transfer({ status: 'DRAFT' }), DAY)).toBe('TRANSFER_DRAFT');
    expect(
      resolveTransferColumn(transfer({ status: 'SUBMITTED', submittedAt: new Date('2026-10-30T12:00:00') }), DAY),
    ).toBe('TRANSFER_SUBMITTED');
    expect(resolveTransferColumn(transfer({ status: 'RECEIVED', updatedAt: new Date('2026-10-30T18:00:00') }), DAY)).toBe(
      'RECEIVED',
    );
    expect(
      resolveTransferColumn(transfer({ status: 'RECONCILED', updatedAt: new Date('2026-10-30T18:00:00') }), DAY),
    ).toBe('RECEIVED');
    expect(
      resolveTransferColumn(transfer({ status: 'DISCREPANCY', updatedAt: new Date('2026-10-30T18:00:00') }), DAY),
    ).toBe('DISCREPANCY');
    expect(resolveTransferColumn(transfer({ status: 'CANCELLED' }), DAY)).toBe('CANCELLED');
  });

  it('дата вне окна смены — карточка в эту смену не попадает', () => {
    // Черновик создан в 07:00, а смена начинается в 08:00.
    const early = transfer({ status: 'DRAFT', createdAt: new Date('2026-10-30T07:00:00') });
    expect(resolveTransferColumn(early, DAY)).toBeNull();

    // Принято на следующий день — в смену 30-го не попадает.
    const nextDay = transfer({ status: 'RECEIVED', updatedAt: new Date('2026-10-31T09:00:00') });
    expect(resolveTransferColumn(nextDay, DAY)).toBeNull();
  });

  it('неизвестный статус вне контура — колонки нет', () => {
    expect(resolveTransferColumn(transfer({ status: 'SOMETHING_NEW' }), DAY)).toBeNull();
  });
});

describe('пометки карточки перемещения', () => {
  it('в пути, расхождение, согласовано, отменено', () => {
    expect(transferNote(transfer({ status: 'SUBMITTED' }))).toBe('в пути');
    expect(transferNote(transfer({ status: 'DISCREPANCY' }))).toBe('расхождение');
    expect(transferNote(transfer({ status: 'RECONCILED' }))).toBe('расхождение согласовано');
    expect(transferNote(transfer({ status: 'CANCELLED' }))).toBe('перемещение отменено');
    expect(transferNote(transfer({ status: 'DRAFT' }))).toBeNull();
    expect(transferNote(transfer({ status: 'RECEIVED' }))).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { resolveKanbanStage, KANBAN_COLUMNS } from '../stage';

/**
 * Этап карточки доски контура (T-103, постановка §3–§4).
 *
 * Функция чистая, поэтому крайние случаи проверяются без базы. Требуемые главной линией:
 * строка в ПЗ, где одна строка отчиталась, а другая нет; отменённое ПЗ; отменённое перемещение;
 * привязанное перемещение в статусе DISCREPANCY; текущая смена через полночь (последняя —
 * в своём тесте, `current-shift.test.ts`).
 */
describe('колонки доски', () => {
  it('одиннадцать колонок в порядке контура, и ПЗ-колонки помечены отдельно', () => {
    expect(KANBAN_COLUMNS.map((column) => column.key)).toEqual([
      'DRAFT',
      'CONFIRMED',
      'IN_PROGRESS',
      'REPORTED',
      'AWAITING_NP_CLOSE',
      'CLOSED',
      'TRANSFER_DRAFT',
      'TRANSFER_SUBMITTED',
      'DISCREPANCY',
      'RECEIVED',
      'CANCELLED',
    ]);
    // 18.11.2026: этапов стало два — «отчиталась часть РЦ» и «все отчитались, ждём НП».
    expect(KANBAN_COLUMNS.find((column) => column.key === 'REPORTED')?.title).toBe(
      'Отчёт сдан (отчиталась часть РЦ)',
    );
    expect(KANBAN_COLUMNS.find((column) => column.key === 'AWAITING_NP_CLOSE')?.title).toBe(
      'Ожидает закрытия НП',
    );
    expect(KANBAN_COLUMNS.filter((column) => column.isOrderColumn).map((column) => column.key)).toEqual([
      'DRAFT',
      'CONFIRMED',
      'IN_PROGRESS',
      'REPORTED',
      'AWAITING_NP_CLOSE',
      'CLOSED',
    ]);
    // «Отменено» — не колонка перемещений: туда попадают и отменённые ПЗ.
  });
});

describe('этап по ПЗ и строке', () => {
  it('черновик ПЗ — колонка «Черновик ПЗ»', () => {
    expect(resolveKanbanStage({ orderStatus: 'DRAFT', lineStatus: 'ASSIGNED' }).column).toBe('DRAFT');
  });

  it('подтверждённое ПЗ со строкой без принятия — «Подтверждено»', () => {
    expect(resolveKanbanStage({ orderStatus: 'CONFIRMED', lineStatus: 'ASSIGNED' }).column).toBe(
      'CONFIRMED',
    );
  });

  it('строка принята оператором — «В работе»', () => {
    expect(resolveKanbanStage({ orderStatus: 'IN_PROGRESS', lineStatus: 'ACCEPTED' }).column).toBe(
      'IN_PROGRESS',
    );
  });

  it('закрытое ПЗ — «Закрыто», с подписью про 1С', () => {
    expect(
      resolveKanbanStage({ orderStatus: 'COMPLETED', lineStatus: 'REPORTED', oneCTaskStatus: 'PENDING' }),
    ).toMatchObject({ column: 'CLOSED', note: 'ожидает 1С' });

    expect(
      resolveKanbanStage({ orderStatus: 'COMPLETED', lineStatus: 'REPORTED', oneCTaskStatus: 'PROCESSED' }),
    ).toMatchObject({ column: 'CLOSED', note: 'проведено' });

    // Задачи ещё нет — считаем, что она ожидается: «проведено» без задачи неправда.
    expect(
      resolveKanbanStage({ orderStatus: 'COMPLETED', lineStatus: 'REPORTED' }),
    ).toMatchObject({ column: 'CLOSED', note: 'ожидает 1С' });
  });

  // Требование главной линии: в одном ПЗ одна строка отчиталась, другая нет.
  it('ПЗ со статусом «Ожидает закрытия НП» идёт в свой столбец, а не в «Отчёт сдан» (18.11.2026)', () => {
    expect(resolveKanbanStage({ orderStatus: 'READY_FOR_CLOSE', lineStatus: 'REPORTED' }).column).toBe(
      'AWAITING_NP_CLOSE',
    );
    // И это не «Закрыто»: ПЗ ещё не закрыто, 1С задач не получал.
    expect(resolveKanbanStage({ orderStatus: 'READY_FOR_CLOSE', lineStatus: 'REPORTED' }).column).toBe(
      'AWAITING_NP_CLOSE',
    );
  });

  it('строка, которая отчиталась, идёт в «Отчёт сдан», а неотчитавшаяся — в «В работе»', () => {
    const reported = resolveKanbanStage({ orderStatus: 'IN_PROGRESS', lineStatus: 'REPORTED' });
    const accepted = resolveKanbanStage({ orderStatus: 'IN_PROGRESS', lineStatus: 'ACCEPTED' });
    const assigned = resolveKanbanStage({ orderStatus: 'IN_PROGRESS', lineStatus: 'ASSIGNED' });

    expect(reported.column).toBe('REPORTED');
    expect(accepted.column).toBe('IN_PROGRESS');
    // Строка, до которой ещё не дошли: ПЗ уже в работе, но конкретно эта строка не принята.
    expect(assigned.column).toBe('CONFIRMED');
  });
});

describe('отмены', () => {
  // Требование главной линии: отменённое ПЗ.
  it('отменённое ПЗ — «Отменено», и причина отмены — ПЗ', () => {
    const stage = resolveKanbanStage({
      orderStatus: 'CANCELLED',
      lineStatus: 'REPORTED',
    });

    expect(stage).toMatchObject({
      column: 'CANCELLED',
      cancelledBy: 'order',
      note: 'ПЗ отменено',
      transferId: null,
    });
  });
});

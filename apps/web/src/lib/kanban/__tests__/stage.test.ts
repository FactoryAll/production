import { describe, it, expect } from 'vitest';
import { resolveKanbanStage, KANBAN_COLUMNS, isTransferColumn } from '../stage';

/**
 * Этап карточки доски контура (T-103, постановка §3–§4).
 *
 * Функция чистая, поэтому крайние случаи проверяются без базы. Требуемые главной линией:
 * строка в ПЗ, где одна строка отчиталась, а другая нет; отменённое ПЗ; отменённое перемещение;
 * привязанное перемещение в статусе DISCREPANCY; текущая смена через полночь (последняя —
 * в своём тесте, `current-shift.test.ts`).
 */
describe('колонки доски', () => {
  it('десять колонок в порядке контура, и ПЗ-колонки помечены отдельно', () => {
    expect(KANBAN_COLUMNS.map((column) => column.key)).toEqual([
      'DRAFT',
      'CONFIRMED',
      'IN_PROGRESS',
      'REPORTED',
      'CLOSED',
      'TRANSFER_DRAFT',
      'TRANSFER_SUBMITTED',
      'RECEIVED',
      'DISCREPANCY',
      'CANCELLED',
    ]);
    // ОПЭ-74: однострочное ПЗ уходит сразу в «Закрыто» (авто-закрытие), поэтому колонка
    // «Отчёт сдан» подписана как частичное закрытие смены — иначе это читалось как поломка.
    expect(KANBAN_COLUMNS.find((column) => column.key === 'REPORTED')?.title).toBe(
      'Отчёт сдан (когда отчиталась часть смены)',
    );
    expect(KANBAN_COLUMNS.filter((column) => column.isOrderColumn).map((column) => column.key)).toEqual([
      'DRAFT',
      'CONFIRMED',
      'IN_PROGRESS',
      'REPORTED',
      'CLOSED',
    ]);
    // «Отменено» — не колонка перемещений: туда попадают и отменённые ПЗ.
    expect(isTransferColumn('CANCELLED')).toBe(false);
    expect(isTransferColumn('TRANSFER_DRAFT')).toBe(true);
    expect(isTransferColumn('CLOSED')).toBe(false);
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
      transfers: [{ id: 'tr-1', status: 'RECEIVED' }],
    });

    expect(stage).toMatchObject({
      column: 'CANCELLED',
      cancelledBy: 'order',
      note: 'ПЗ отменено',
      transferId: null,
    });
  });

  // Требование главной линии: отменённое перемещение.
  it('единственное отменённое перемещение — «Отменено» с причиной «перемещение»', () => {
    const stage = resolveKanbanStage({
      orderStatus: 'COMPLETED',
      lineStatus: 'REPORTED',
      transfers: [{ id: 'tr-1', status: 'CANCELLED' }],
    });

    expect(stage).toMatchObject({
      column: 'CANCELLED',
      cancelledBy: 'transfer',
      note: 'перемещение отменено',
      transferId: 'tr-1',
    });
  });

  it('отменённое перемещение не утаскивает карточку, если есть действующее', () => {
    // Возврат на доработку: первое перемещение отменили, второе приняли.
    const stage = resolveKanbanStage({
      orderStatus: 'COMPLETED',
      lineStatus: 'REPORTED',
      transfers: [
        { id: 'tr-1', status: 'CANCELLED' },
        { id: 'tr-2', status: 'RECEIVED' },
      ],
    });

    expect(stage.column).toBe('RECEIVED');
    expect(stage.transferId).toBe('tr-2');
  });
});

describe('этап по перемещениям', () => {
  it('черновик перемещения — «Перемещение создано»', () => {
    expect(
      resolveKanbanStage({
        orderStatus: 'COMPLETED',
        lineStatus: 'REPORTED',
        transfers: [{ id: 'tr-1', status: 'DRAFT' }],
      }),
    ).toMatchObject({ column: 'TRANSFER_DRAFT', transferId: 'tr-1' });
  });

  it('отправленное — «Отправлено» с подписью «в пути»', () => {
    expect(
      resolveKanbanStage({
        orderStatus: 'COMPLETED',
        lineStatus: 'REPORTED',
        transfers: [{ id: 'tr-1', status: 'SUBMITTED' }],
      }),
    ).toMatchObject({ column: 'TRANSFER_SUBMITTED', note: 'в пути' });
  });

  it('принятое — «Принято складом», согласованное подписано', () => {
    expect(
      resolveKanbanStage({
        orderStatus: 'COMPLETED',
        lineStatus: 'REPORTED',
        transfers: [{ id: 'tr-1', status: 'RECEIVED' }],
      }),
    ).toMatchObject({ column: 'RECEIVED', note: null });

    expect(
      resolveKanbanStage({
        orderStatus: 'COMPLETED',
        lineStatus: 'REPORTED',
        transfers: [{ id: 'tr-1', status: 'RECONCILED' }],
      }),
    ).toMatchObject({ column: 'RECEIVED', note: 'расхождение согласовано' });
  });

  // Требование главной линии: привязанное перемещение в статусе DISCREPANCY.
  it('перемещение с расхождением — отдельная колонка «Расхождение», а не «Принято»', () => {
    const stage = resolveKanbanStage({
      orderStatus: 'COMPLETED',
      lineStatus: 'REPORTED',
      transfers: [{ id: 'tr-1', status: 'DISCREPANCY' }],
    });

    expect(stage.column).toBe('DISCREPANCY');
    expect(stage.transferId).toBe('tr-1');
  });

  it('из нескольких перемещений карточка идёт по самому продвинутому', () => {
    const stage = resolveKanbanStage({
      orderStatus: 'COMPLETED',
      lineStatus: 'REPORTED',
      transfers: [
        { id: 'tr-1', status: 'RECEIVED' },
        { id: 'tr-2', status: 'DRAFT' },
        { id: 'tr-3', status: 'SUBMITTED' },
      ],
    });

    expect(stage.column).toBe('RECEIVED');
    expect(stage.transferId).toBe('tr-1');
  });

  it('неизвестный статус перемещения не ломает этап', () => {
    const stage = resolveKanbanStage({
      orderStatus: 'COMPLETED',
      lineStatus: 'REPORTED',
      transfers: [{ id: 'tr-1', status: 'SOMETHING_NEW' }],
    });

    expect(stage.column).toBe('CLOSED');
  });

  it('перемещение продвигает карточку дальше закрытого ПЗ', () => {
    const withoutTransfer = resolveKanbanStage({ orderStatus: 'COMPLETED', lineStatus: 'REPORTED' });
    const withTransfer = resolveKanbanStage({
      orderStatus: 'COMPLETED',
      lineStatus: 'REPORTED',
      transfers: [{ id: 'tr-1', status: 'DRAFT' }],
    });

    expect(withoutTransfer.column).toBe('CLOSED');
    expect(withTransfer.column).toBe('TRANSFER_DRAFT');
  });
});

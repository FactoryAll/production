import { describe, it, expect } from 'vitest';
import { canReceiveTransfer, receivingRolesFor } from '../receive-rules';

/**
 * ОПЭ-28 (решение владельца 21.10.2026). Привязки «пользователь → склад» в системе нет,
 * поэтому приёмщик определяется типом склада-приёмника: склад ГП — КСГП, производственный — УСГП.
 * До правки «Принять» видел любой с правом transfer:receive — в том числе тот, кто сам отправил.
 */
describe('canReceiveTransfer', () => {
  it('склад ГП принимает КСГП', () => {
    expect(receivingRolesFor('FINISHED_GOODS')).toEqual(['KSGP']);
    expect(canReceiveTransfer(['KSGP'], 'FINISHED_GOODS')).toBe(true);
    expect(canReceiveTransfer(['USGP'], 'FINISHED_GOODS')).toBe(false);
  });

  it('производственный склад принимает УСГП', () => {
    expect(receivingRolesFor('PRODUCTION')).toEqual(['USGP']);
    expect(canReceiveTransfer(['USGP'], 'PRODUCTION')).toBe(true);
    expect(canReceiveTransfer(['KSGP'], 'PRODUCTION')).toBe(false);
  });

  it('администратор принимает на любом складе', () => {
    expect(canReceiveTransfer(['ADM'], 'PRODUCTION')).toBe(true);
    expect(canReceiveTransfer(['ADM'], 'FINISHED_GOODS')).toBe(true);
  });

  it('роли без права приёмки не принимают нигде', () => {
    expect(canReceiveTransfer(['NP'], 'PRODUCTION')).toBe(false);
    expect(canReceiveTransfer(['OPR'], 'FINISHED_GOODS')).toBe(false);
    expect(canReceiveTransfer(['S1C'], 'FINISHED_GOODS')).toBe(false);
  });

  it('нескольких ролей достаточно, если среди них есть принимающая', () => {
    expect(canReceiveTransfer(['NP', 'KSGP'], 'FINISHED_GOODS')).toBe(true);
  });
});

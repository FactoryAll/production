import { describe, it, expect } from 'vitest';
import { boardViewHref, listViewHref } from '../view-links';

/**
 * Ссылки переключателя «Список | Канбан» (T-103, 30.10.2026).
 *
 * Проверяем главное: между видами переносится **только общий параметр** — смена, — а не вся
 * строка запроса. Параметр, которого адресат не понимает, в ссылке выглядит как применённый
 * фильтр, хотя его никто не читал; на этом уже разъехались параметры периода в отчётах (ОПЭ-70).
 */
describe('переключатель видов: ссылки', () => {
  it('список ПЗ получает смену и статус', () => {
    expect(listViewHref({ shiftId: 'shift-1', status: 'CONFIRMED' })).toBe(
      '/production-orders?status=CONFIRMED&shiftId=shift-1',
    );
  });

  it('доска получает смену, РЦ, номенклатуру и склад', () => {
    expect(
      boardViewHref({
        shiftId: 'shift-1',
        workCenterId: 'wc-1',
        productId: 'prod-1',
        warehouseId: 'wh-1',
      }),
    ).toBe('/kanban?shiftId=shift-1&workCenterId=wc-1&productId=prod-1&warehouseId=wh-1');
  });

  it('смена переносится в обе стороны — это общий параметр', () => {
    expect(listViewHref({ shiftId: 'shift-9' })).toBe('/production-orders?shiftId=shift-9');
    expect(boardViewHref({ shiftId: 'shift-9' })).toBe('/kanban?shiftId=shift-9');
  });

  it('чужие параметры не переносятся: у списка нет РЦ, у доски нет статуса', () => {
    expect(listViewHref({ shiftId: 'shift-1', workCenterId: 'wc-1' })).toBe(
      '/production-orders?shiftId=shift-1',
    );
    // status объявлен в параметрах вида, поэтому проверяем именно «не попадает в ссылку доски».
    expect(boardViewHref({ shiftId: 'shift-1', status: 'CONFIRMED' })).toBe('/kanban?shiftId=shift-1');
  });

  it('без параметров ссылка чистая, без «?»', () => {
    expect(listViewHref({})).toBe('/production-orders');
    expect(boardViewHref({})).toBe('/kanban');
  });
});

/**
 * Ссылки переключателя видов «Список | Канбан» (T-103, решение владельца 30.10.2026).
 *
 * Модуль чистый и лежит отдельно, потому что это место уже один раз разъехалось: в отчётах
 * каждый экран собирал параметры периода у себя, и «Смена» молча теряла дату (ОПЭ-70).
 * Здесь правило одно — **что переносим между видами, решает сам переключатель**, явным
 * списком, а не «каждый вид прочитает из строки запроса то, что поймёт».
 *
 * Общий у видов пока один параметр — `shiftId` (фильтр по смене есть и у списка ПЗ, и у доски).
 * Остальные параметры принадлежат своему виду: у списка — `status`, у доски — РЦ, номенклатура
 * и склад. При переключении они не переносятся, и это осознанно: непонятный адресату параметр
 * в ссылке выглядит как «фильтр применился», хотя его никто не читал.
 */

export interface KanbanViewParams {
  shiftId?: string;
  /** Только вид «Список ПЗ». */
  status?: string;
  /** Только вид «Канбан». */
  workCenterId?: string;
  productId?: string;
  warehouseId?: string;
}

function withQuery(path: string, entries: Array<[string, string | undefined]>): string {
  const query = new URLSearchParams();
  for (const [name, value] of entries) {
    if (value) {
      query.set(name, value);
    }
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/** Ссылка на список ПЗ: статус и смена. */
export function listViewHref(params: KanbanViewParams): string {
  return withQuery('/production-orders', [
    ['status', params.status],
    ['shiftId', params.shiftId],
  ]);
}

/** Ссылка на доску: смена, РЦ, номенклатура, склад. */
export function boardViewHref(params: KanbanViewParams): string {
  return withQuery('/kanban', [
    ['shiftId', params.shiftId],
    ['workCenterId', params.workCenterId],
    ['productId', params.productId],
    ['warehouseId', params.warehouseId],
  ]);
}

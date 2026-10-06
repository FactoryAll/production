// Общие части SSE-канала дашборда M11 (tech_stack §5).
//
// Вынесено из route-handler: в файле маршрута можно экспортировать только HTTP-методы и
// настройки сегмента, поэтому чистые функции живут здесь (тот же приём, что в M09).

/** Интервал опроса БД внутри канала (мс). */
export const DASHBOARD_STREAM_INTERVAL_MS = 5000;

/**
 * Интервал keep-alive-комментария (мс).
 *
 * Кадр-комментарий не вызывает onmessage на клиенте, но удерживает соединение живым:
 * у nginx по умолчанию proxy_read_timeout 60 с.
 */
export const DASHBOARD_STREAM_PING_MS = 15000;

export interface DashboardStreamPayload {
  /** Отпечаток состояния данных дашборда. */
  revision: string;
}

/** Сигнал состояния одной таблицы, которую читает дашборд. */
export interface DashboardSignal {
  count: number;
  lastAt: Date | null;
}

/**
 * Отпечаток состояния данных дашборда (M11 BR-2).
 *
 * Дашборд агрегирует ПЗ, итоги смен, перемещения и остатки, поэтому «версия» строится из
 * счётчиков и времени последней записи читаемых таблиц. Хронометраж ловит все статусные
 * переходы (00 §6), строки ПЗ — подтверждение получения и внесение итога, движения остатков —
 * приёмку, согласование расхождений и корректировки факта (Р-18).
 */
export function buildDashboardRevision(signals: DashboardSignal[]): string {
  return signals
    .map((signal) => signal.count + '@' + (signal.lastAt ? signal.lastAt.toISOString() : '-'))
    .join('|');
}

/** Кадр SSE: строка "data: <json>" и пустая строка после неё. */
export function dashboardStreamFrame(payload: DashboardStreamPayload): string {
  return 'data: ' + JSON.stringify(payload) + '\n\n';
}

/** Кадр keep-alive (комментарий SSE): клиент его игнорирует, соединение остаётся открытым. */
export function dashboardStreamPing(): string {
  return ': ping\n\n';
}

/** Изменилось ли состояние по сравнению с предыдущим кадром (шлём только изменения). */
export function isDashboardStreamChanged(
  previous: DashboardStreamPayload,
  next: DashboardStreamPayload,
): boolean {
  return previous.revision !== next.revision;
}

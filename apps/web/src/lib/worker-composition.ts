/**
 * Фактический состав работников при вводе итога смены (T-093, `docs/timesheet_design.md` §5).
 *
 * Модуль чистый и лежит **вне** `'use server'`-файла действий: серверный модуль действий
 * может экспортировать только асинхронные функции (иначе падает сборка Next), а правило
 * состава хочется проверять тестами отдельно от базы и сессии.
 */

/**
 * Строка фактического состава работников, как её присылает экран (T-093).
 *
 * `planned` здесь намеренно нет: план берётся из `ProductionOrderLineWorkers` на сервере,
 * клиент не должен решать, был работник назначен или добавлен.
 */
export interface WorkerCompositionInput {
  employeeId: string;
  /** Вышел ли работник. Не задано — считаем, что вышел. */
  worked?: boolean;
  /** Причина неявки из справочника — обязательна, если работник не вышел. */
  absenceReasonId?: string | null;
  /** Словами, почему работника добавили в состав — обязательно для добавленных. */
  comment?: string | null;
}

/** Состав после проверки: план уже проставлен сервером. */
export interface ResolvedWorkerRow {
  employeeId: string;
  planned: boolean;
  worked: boolean;
  absenceReasonId: string | null;
  comment: string | null;
}

/** Строка прошлого факта: что о работнике уже известно из данных. */
export interface KnownCompositionRow {
  employeeId: string;
  worked?: boolean;
  absenceReasonId?: string | null;
  comment?: string | null;
}

/**
 * Приводит присланный состав к снимку, который можно записать в `ProductionFactWorker`.
 *
 * Состав — это **полный снимок**, а не список изменений: оператор подтверждает, кто вышел,
 * и неподтверждённый работник не должен молча остаться «назначенным». Поэтому плановые
 * работники, о которых экран ничего не сказал, попадают в снимок как вышедшие — это и есть
 * правило «ничего не менял — состав равен назначенному» из §5 постановки.
 *
 * `options.known` — строки прошлого факта. Из них наследуется всё, чего экран не прислал:
 * при «Вводе за Оператора» и корректировке причина неявки уже записана, и повторять её
 * не нужно (уточнение владельца 28.10.2026: причина требуется только при расхождении
 * с тем, что уже известно, а не при любом вводе).
 *
 * Проверки, из-за которых сохранение отклоняется:
 *   — работник, который не вышел, обязан иметь причину из справочника причин неявки
 *     (свою или унаследованную из прошлого факта);
 *   — добавленный работник обязан иметь причину словами, если о нём данных ещё нет;
 *   — добавленного работника нельзя отметить как не вышедшего: «добавили и не вышел» —
 *     это не расхождение, а ошибка ввода, и такого в данных быть не должно.
 */
export function resolveWorkerComposition(
  workers: WorkerCompositionInput[] | undefined,
  plannedIds: readonly string[],
  options: { known?: readonly KnownCompositionRow[] } = {},
): ResolvedWorkerRow[] {
  if (!workers) {
    return [];
  }

  const planned = new Set(plannedIds);
  const previousById = new Map((options.known ?? []).map((row) => [row.employeeId, row]));
  const seen = new Set<string>();
  const rows: ResolvedWorkerRow[] = [];

  for (const item of workers) {
    const employeeId = item.employeeId?.trim();
    // Пустые и повторные строки не считаем ошибкой: экран мог прислать дубль при двойном клике.
    if (!employeeId || seen.has(employeeId)) {
      continue;
    }
    seen.add(employeeId);

    const wasPlanned = planned.has(employeeId);
    const previous = previousById.get(employeeId);
    const worked = item.worked ?? previous?.worked ?? true;
    const absenceReasonId = item.absenceReasonId?.trim() || previous?.absenceReasonId || null;
    const comment = item.comment?.trim() || previous?.comment || null;

    if (!wasPlanned && !worked) {
      throw new Error('Добавленный работник не может быть отмечен как не вышедший');
    }
    if (!worked && !absenceReasonId) {
      throw new Error('Укажите причину неявки работника из справочника');
    }
    if (!wasPlanned && !comment && !previous) {
      throw new Error('Укажите причину, по которой работника добавили в состав');
    }

    rows.push({
      employeeId,
      planned: wasPlanned,
      worked,
      // Причина неявки у вышедшего работника бессмысленна — не храним её.
      absenceReasonId: worked ? null : absenceReasonId,
      comment,
    });
  }

  for (const employeeId of plannedIds) {
    if (seen.has(employeeId)) {
      continue;
    }
    rows.push({
      employeeId,
      planned: true,
      worked: true,
      absenceReasonId: null,
      comment: null,
    });
  }

  return rows;
}

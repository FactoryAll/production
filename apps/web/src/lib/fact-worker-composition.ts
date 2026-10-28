// RoleCode берём из Prisma: именно его ждёт `writeAudit` (packages/db/src/kernel.ts),
// а в контрактах живёт такой же по смыслу, но другой по типу перечень.
import type { RoleCode } from '@prisma/client';
import type { PermissionCode } from '@prodtrack/contracts';
import { writeAudit, type TxClient } from '@prodtrack/db';
import {
  resolveWorkerComposition,
  type ResolvedWorkerRow,
  type WorkerCompositionInput,
} from './worker-composition';

/**
 * Запись фактического состава работников в факт смены (T-093, `docs/timesheet_design.md` §5).
 *
 * Одно правило на все четыре пути ввода итога: ввод итога оператором, его корректировка,
 * «Ввод за Оператора» (НП) и корректировка НП после закрытия строки. Поэтому проверки,
 * замена снимка и аудит живут здесь, а не копией в каждом действии — копии разъезжаются,
 * и разъехавшийся состав в табеле замечают позже, чем он появился.
 *
 * Что гарантирует сервис:
 *   — работник и причина неявки существуют и **действующие** (проверка в той же транзакции);
 *   — снимок один на линию: старые строки состава линии заменяются целиком, потому что фактов
 *     у линии бывает два (ГП и ПФ), а состав относится к событию ввода итога (урок ОПЭ-38);
 *   — аудит «было → стало» пишется **только при изменении**: подтверждение того же состава —
 *     не событие;
 *   — причина требуется только для строк, о которых данные молчат: назначение строки и прошлый
 *     факт считаются известными. Поэтому при корректировке и «Вводе за Оператора» экран может
 *     прислать прошлый состав, и оператору не приходится повторять причину заново.
 */

export interface SaveCompositionDeps {
  writeAudit: typeof writeAudit;
}

export interface SaveCompositionParams {
  /** Строка ПЗ: по ней находится весь состав линии. */
  lineId: string;
  /** Факт основной категории линии, к которому привязывается снимок. */
  primaryFactId: string;
  /** Назначенные работники строки (план) — из `ProductionOrderLineWorkers`. */
  plannedIds: readonly string[];
  /**
   * Состав, присланный экраном. `undefined` — состав не трогаем (путь, который его ещё
   * не подтверждает). Пустой массив — осознанный снимок «работников не было».
   */
  workers: WorkerCompositionInput[] | undefined;
  userId: string;
  userRoles: RoleCode[];
  /** Право, под которым действует линия: от него зависит роль в записи аудита. */
  permission: PermissionCode;
}

interface CompositionRow {
  employeeId: string;
  planned: boolean;
  worked: boolean;
  absenceReasonId: string | null;
  comment: string | null;
}

const COMPOSITION_SELECT = {
  employeeId: true,
  planned: true,
  worked: true,
  absenceReasonId: true,
  comment: true,
} as const;

export async function saveWorkerComposition(
  tx: TxClient,
  deps: SaveCompositionDeps,
  params: SaveCompositionParams,
): Promise<ResolvedWorkerRow[] | null> {
  if (params.workers === undefined) {
    return null;
  }

  const previous = (await tx.productionFactWorker.findMany({
    where: { productionFact: { lineId: params.lineId } },
    select: COMPOSITION_SELECT,
  })) as CompositionRow[];

  // Прошлый состав — уже подтверждённые данные: из него наследуется всё, чего экран не прислал.
  // Причина неявки у этих работников уже записана, и требовать её заново не за что
  // (уточнение владельца 28.10.2026).
  const composition = resolveWorkerComposition(params.workers, params.plannedIds, {
    known: previous,
  });

  const reasonIds = [
    ...new Set(
      composition.map((row) => row.absenceReasonId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const employeeIds = composition.map((row) => row.employeeId);

  if (employeeIds.length > 0) {
    const employees = await tx.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, active: true },
    });
    if (employees.length !== employeeIds.length) {
      throw new Error('Работник не найден — состав не сохранён');
    }
    if (employees.some((employee) => !employee.active)) {
      throw new Error('Работник деактивирован — состав не сохранён');
    }
  }

  if (reasonIds.length > 0) {
    const reasons = await tx.absenceReason.findMany({
      where: { id: { in: reasonIds } },
      select: { id: true, active: true },
    });
    if (reasons.length !== reasonIds.length) {
      throw new Error('Причина неявки не найдена — состав не сохранён');
    }
    if (reasons.some((reason) => !reason.active)) {
      throw new Error('Причина неявки деактивирована — состав не сохранён');
    }
  }

  await tx.productionFactWorker.deleteMany({
    where: { productionFact: { lineId: params.lineId } },
  });

  if (composition.length > 0) {
    await tx.productionFactWorker.createMany({
      data: composition.map((row) => ({
        productionFactId: params.primaryFactId,
        employeeId: row.employeeId,
        planned: row.planned,
        worked: row.worked,
        absenceReasonId: row.absenceReasonId,
        comment: row.comment,
      })),
    });
  }

  if (isSameComposition(previous, composition)) {
    return composition;
  }

  await deps.writeAudit(tx, {
    action: previous.length > 0 ? 'UPDATE' : 'CREATE',
    objectType: 'ProductionFact',
    objectId: params.primaryFactId,
    field: 'workers',
    oldValue: previous.length > 0 ? JSON.stringify(previous) : undefined,
    newValue: JSON.stringify(composition),
    userId: params.userId,
    userRoles: params.userRoles,
    permission: params.permission,
  });

  return composition;
}

/** Одинаков ли состав: сравниваем по сотруднику и всем полям строки. */
export function isSameComposition(previous: CompositionRow[], next: CompositionRow[]): boolean {
  if (previous.length !== next.length) {
    return false;
  }
  return next.every((row) => {
    const before = previous.find((item) => item.employeeId === row.employeeId);
    return (
      before !== undefined &&
      before.worked === row.worked &&
      before.planned === row.planned &&
      before.absenceReasonId === row.absenceReasonId &&
      (before.comment ?? null) === row.comment
    );
  });
}

/**
 * Факт основной категории линии — тот, к которому привязывается состав.
 *
 * Если факта основной категории нет (линия отчиталась только полуфабрикатом), берём первый:
 * состав всё равно один на линию, и «первый» здесь означает «тот, что есть».
 */
export function pickPrimaryFact<T extends { factCategory: string }>(
  facts: T[],
  lineCategory: string,
): T | undefined {
  return facts.find((fact) => fact.factCategory === lineCategory) ?? facts[0];
}

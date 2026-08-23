// import { prisma } from './prisma';

// TODO Фаза 2/3: заменить заглушку на реальные запросы к ProductionOrder, GoodsTransfer, ProductionFact.
// Сейчас возвращаем пустой список, чтобы в Фазе 1 диалог деактивации работал в штатном режиме.

export type DeactivatableEntityType =
  | 'WorkCenter'
  | 'Product'
  | 'Employee'
  | 'DefectReason'
  | 'SubstitutionReason'
  | 'Shift';

export interface DeactivationWarning {
  type: 'PRODUCTION_ORDER' | 'GOODS_TRANSFER' | 'SHIFT_SUMMARY';
  id: string;
  label: string;
}

export async function getDeactivationWarnings(
  _entityType: DeactivatableEntityType,
  _entityId: string,
): Promise<DeactivationWarning[]> {
  // В Фазе 1 незавершённые документы ещё не реализованы, поэтому возвращаем пустой список.
  // TODO Фаза 2/3: реализовать запросы:
  // - WorkCenter: ПЗ в DRAFT/CONFIRMED/IN_PROGRESS со строками на этом РЦ.
  // - Product: ПЗ в DRAFT/CONFIRMED/IN_PROGRESS + Перемещения в DRAFT/SUBMITTED со строками на эту номенклатуру.
  // - Employee: ПЗ в DRAFT/CONFIRMED/IN_PROGRESS, где сотрудник — Оператор или работник строки.
  // - DefectReason: ProductionFact с этой причиной в незавершённых сменах.
  // - SubstitutionReason: строки ПЗ со статусом REPORTED и этой причиной ввода за Оператора.
  // - Shift: ПЗ в DRAFT/CONFIRMED/IN_PROGRESS, привязанные к этой смене.
  return [];
}

export async function getDeactivationWarningsAdmin(
  _entityType: DeactivatableEntityType,
  _entityId: string,
): Promise<DeactivationWarning[]> {
  // TODO T-017: добавить requireAdmin, когда @/lib/auth/require-admin станет доступен из packages/db
  // или когда появится центральная матрица доступа.
  return [];
}

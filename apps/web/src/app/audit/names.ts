// Словарь «идентификатор → человеческое название» для журнала аудита (14.11.2026).
//
// Зачем: записи аудита хранят ссылки как UUID, и в журнале они раньше так и печатались.
// Здесь по всем значениям записей собираются идентификаторы и одним проходом заменяются
// названиями из справочников. Неизвестные остаются коротким кодом (#b35b2488) — так видно,
// что это ссылка, а не мусор.

import { prisma } from '@prodtrack/db';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

type RecordLike = { oldValue: string | null; newValue: string | null };

export function collectAuditIds(records: RecordLike[]): string[] {
  const ids = new Set<string>();
  for (const record of records) {
    for (const value of [record.oldValue, record.newValue]) {
      if (!value) continue;
      for (const match of value.match(UUID_RE) ?? []) {
        ids.add(match.toLowerCase());
      }
    }
  }
  return [...ids];
}

/** Названия для всех идентификаторов, встретившихся в записях. */
export async function buildAuditNameMap(records: RecordLike[]): Promise<Record<string, string>> {
  const ids = collectAuditIds(records);
  const names: Record<string, string> = {};
  if (ids.length === 0) {
    return names;
  }

  const [products, warehouses, users, employees, workCenters] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unit: true } }),
    prisma.warehouse.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, login: true } }),
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }),
    prisma.workCenter.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } }),
  ]);

  for (const product of products) {
    names[product.id] = `${product.name} (${product.unit})`;
  }
  for (const warehouse of warehouses) {
    names[warehouse.id] = warehouse.name;
  }
  for (const user of users) {
    names[user.id] = user.login;
  }
  for (const employee of employees) {
    names[employee.id] = employee.fullName;
  }
  for (const workCenter of workCenters) {
    names[workCenter.id] = `${workCenter.code} — ${workCenter.name}`;
  }
  return names;
}

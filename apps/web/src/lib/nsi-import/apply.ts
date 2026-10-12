// Применение плана импорта: запись номенклатуры и журнала аудита (этап 5).
//
// Пишет только то, что решил план: создание, обновление, пропуск. Признак активности не меняется
// никогда — деактивированная позиция не возвращается в работу загрузкой файла.

import { writeAudit } from '@prodtrack/db';
import type { PrismaClient, RoleCode } from '@prisma/client';
import type { ImportPlan } from './plan';

/**
 * Запас на транзакцию: загрузка пишет по две записи на строку (позиция + аудит),
 * поэтому предел по умолчанию (5 секунд) мал даже для нескольких сотен строк.
 */
const IMPORT_TRANSACTION_TIMEOUT_MS = 120_000;

export interface ImportActor {
  userId: string;
  roles: RoleCode[];
}

export interface ImportApplyResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

interface AuditFieldSet {
  code?: string;
  name?: string;
  category?: string;
  unit?: string;
}

/**
 * Применяет план импорта одной транзакцией: либо загружается весь файл, либо ничего.
 *
 * На каждую созданную и изменённую позицию пишется запись аудита — как при ручном создании
 * и правке в справочнике (M13, Р-09). Дополнительно пишется одна сводная запись о загрузке:
 * по ней видно, кто и какой файл загрузил, даже когда строк сотни.
 */
export async function applyImportPlan(
  prisma: PrismaClient,
  plan: ImportPlan,
  actor: ImportActor,
  meta: { fileName?: string } = {},
): Promise<ImportApplyResult> {
  const result: ImportApplyResult = {
    created: 0,
    updated: 0,
    unchanged: plan.counts.unchanged,
    skipped: plan.counts.skip,
  };

  await prisma.$transaction(
    async (tx) => {
      for (const item of plan.items) {
        if (item.action === 'create') {
          const created = await tx.product.create({
            data: {
              code: item.code,
              name: item.name,
              category: item.category,
              unit: item.unit,
              active: true,
            },
          });

          await writeAudit(tx, {
            action: 'CREATE',
            objectType: 'Product',
            objectId: created.id,
            userId: actor.userId,
            userRoles: actor.roles,
            permission: 'nsi:manage',
            newValue: JSON.stringify({
              code: created.code,
              name: created.name,
              category: created.category,
              unit: created.unit,
            }),
          });

          result.created += 1;
          continue;
        }

        if (item.action !== 'update' || !item.existing) {
          continue;
        }

        const existing = item.existing;
        const oldValue: AuditFieldSet = {};
        const newValue: AuditFieldSet = {};
        const fields: string[] = [];
        const data: { name?: string; category?: typeof item.category; unit?: string } = {};

        if (existing.name !== item.name) {
          data.name = item.name;
          oldValue.name = existing.name;
          newValue.name = item.name;
          fields.push('name');
        }
        if (existing.category !== item.category) {
          data.category = item.category;
          oldValue.category = existing.category;
          newValue.category = item.category;
          fields.push('category');
        }
        if (existing.unit !== item.unit) {
          data.unit = item.unit;
          oldValue.unit = existing.unit;
          newValue.unit = item.unit;
          fields.push('unit');
        }

        const updated = await tx.product.update({ where: { id: existing.id }, data });

        // В журнал попадают только действительно изменившиеся поля (замечание владельца по v2.0.0).
        await writeAudit(tx, {
          action: 'UPDATE',
          objectType: 'Product',
          objectId: updated.id,
          userId: actor.userId,
          userRoles: actor.roles,
          permission: 'nsi:manage',
          field: fields.join(','),
          oldValue: JSON.stringify(oldValue),
          newValue: JSON.stringify(newValue),
        });

        result.updated += 1;
      }

      await writeAudit(tx, {
        action: 'CREATE',
        objectType: 'ProductImport',
        objectId: 'product-import',
        userId: actor.userId,
        userRoles: actor.roles,
        permission: 'nsi:manage',
        newValue: JSON.stringify({
          file: meta.fileName ?? null,
          mode: plan.mode,
          rows: plan.totalRows,
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
          skipped: result.skipped,
          errors: plan.counts.errors,
        }),
      });
    },
    { timeout: IMPORT_TRANSACTION_TIMEOUT_MS },
  );

  return result;
}

/**
 * Запись привязок из спецификации 1С: Масса и Туба изделия, нормы, журнал запуска.
 *
 * Пишет **только** то, что решил план (`bind`). Пропущенные позиции не трогаются: номенклатуру
 * из файла мы не заводим и не деактивируем (решение владельца 19.11.2026) — этим занимается
 * человек, потому что часть позиций в выгрузке может быть устаревшей.
 *
 * Привязки, которых в файле нет, **не удаляются**: отсутствие в свежей выгрузке — повод
 * разобраться, а не молча обнулить поле.
 */

import type { PrismaClient } from '@prisma/client';
import type { BomPlan } from './plan';

export interface ApplyBomResult {
  runId: string;
  massBound: number;
  tubeBound: number;
  massUnchanged: number;
  skipped: number;
  issues: number;
}

export interface ApplyBomOptions {
  /** Имя файла — попадает в журнал запусков, чтобы источник правды был прослеживаемым. */
  fileName: string;
  /** Кто загрузил (для аудита и журнала); для CLI может быть не указан. */
  actorId?: string | null;
  actorRoles?: string[];
}

type Client = Pick<PrismaClient, 'product' | 'bomImportRun' | '$transaction'>;

/**
 * Применяет план. Один запуск = одна транзакция: либо все привязки из файла легли, либо ни одной.
 */
export async function applyBomPlan(
  client: Client,
  plan: BomPlan,
  options: ApplyBomOptions,
): Promise<ApplyBomResult> {
  const codes = new Set<string>();
  for (const item of plan.bind) {
    codes.add(item.gpCode);
    if (item.massCode) codes.add(item.massCode);
    if (item.tubeCode) codes.add(item.tubeCode);
  }

  const products = await client.product.findMany({
    where: { code: { in: [...codes] } },
    select: {
      id: true,
      code: true,
      name: true,
      massProductId: true,
      massQuantity: true,
      tubeProductId: true,
      tubeProductCode: true,
      tubeQuantity: true,
    },
  });
  const byCode = new Map(products.map((product) => [product.code, product]));

  let massBound = 0;
  let tubeBound = 0;
  let massUnchanged = 0;

  const run = await client.$transaction(async (tx) => {
    for (const item of plan.bind) {
      const gp = byCode.get(item.gpCode);
      if (!gp) continue;

      const mass = item.massCode ? byCode.get(item.massCode) : undefined;
      const tube = item.tubeCode ? byCode.get(item.tubeCode) : undefined;

      const data: Record<string, unknown> = {};
      const changes: string[] = [];

      if (mass) {
        if (gp.massProductId !== mass.id) {
          data.massProductId = mass.id;
          changes.push(`Масса: ${gp.massProductId ? 'заменена' : 'задана'} → ${mass.code}`);
        }
        const nextQuantity = item.massShare === undefined ? null : item.massShare.toString();
        if (String(gp.massQuantity ?? '') !== String(nextQuantity ?? '')) {
          data.massQuantity = item.massShare ?? null;
          changes.push(`норма Массы: ${gp.massQuantity ?? '—'} → ${item.massShare ?? '—'}`);
        }
      }
      if (tube) {
        tubeBound += 1;
        if (gp.tubeProductId !== tube.id) {
          data.tubeProductId = tube.id;
          changes.push(`Туба: ${gp.tubeProductId ? 'заменена' : 'задана'} → ${tube.code}`);
        }
        const nextQuantity = item.tubeShare === undefined ? null : item.tubeShare.toString();
        if (String(gp.tubeQuantity ?? '') !== String(nextQuantity ?? '')) {
          data.tubeQuantity = item.tubeShare ?? null;
          changes.push(`норма Тубы: ${gp.tubeQuantity ?? '—'} → ${item.tubeShare ?? '—'}`);
        }
      } else if (item.tubeCode && item.tubeCode !== gp.tubeProductCode) {
        tubeBound += 1;
        // Номенклатуры Туб в системе пока нет: храним код и наименование из 1С, чтобы привязка
        // не потерялась. Когда Туба станет номенклатурой, поля свяжутся ссылкой.
        data.tubeProductCode = item.tubeCode;
        data.tubeProductName = item.tubeName ?? null;
        changes.push(`Туба (из 1С): ${gp.tubeProductCode ?? '—'} → ${item.tubeCode}`);
      }

      if (changes.length === 0) {
        massUnchanged += 1;
        continue;
      }

      await tx.product.update({
        where: { id: gp.id },
        data: {
          ...data,
          ...(item.massShare === undefined ? {} : { massQuantity: item.massShare }),
          ...(item.tubeShare === undefined ? {} : { tubeQuantity: item.tubeShare }),
        },
      });

      // Аудит: мастер-данные меняются загрузкой — это должно быть видно в журнале,
      // с файлом-источником и прежним значением.
      await tx.auditRecord.create({
        data: {
          userId: options.actorId ?? null,
          role: options.actorRoles?.join(',') ?? null,
          action: 'UPDATE',
          objectType: 'Product',
          objectId: gp.id,
          field: 'bindings',
          oldValue: JSON.stringify({
            massProductId: gp.massProductId,
            massQuantity: gp.massQuantity?.toString() ?? null,
            tubeProductId: gp.tubeProductId,
            tubeQuantity: gp.tubeQuantity?.toString() ?? null,
          }),
          newValue: JSON.stringify({
            source: 'BOM_IMPORT',
            fileName: options.fileName,
            changes,
          }),
        },
      });

      if (mass) massBound += 1;
    }

    return tx.bomImportRun.create({
      data: {
        fileName: options.fileName,
        finishedAt: new Date(),
        createdById: options.actorId ?? null,
        massBound,
        tubeBound,
        skipped: plan.counts.skip,
        issues: 0,
      },
      select: { id: true },
    });
  });

  return {
    runId: run.id,
    massBound,
    tubeBound,
    massUnchanged,
    skipped: plan.counts.skip,
    issues: 0,
  };
}

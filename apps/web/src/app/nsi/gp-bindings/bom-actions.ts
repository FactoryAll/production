'use server';

import { revalidatePath } from 'next/cache';
import { prisma, writeAudit } from '@prodtrack/db';
import { hasPermission } from '@prodtrack/contracts';
import { requirePermission } from '@/lib/auth/access';
import { readFirstSheet } from '@/lib/bom-import/xlsx';
import { parseBom } from '@/lib/bom-import/bom';
import { buildBomPlan, describeBomPlan, type CatalogueEntry } from '@/lib/bom-import/plan';
import { applyBomPlan } from '@/lib/bom-import/apply';

/**
 * Загрузка спецификаций 1С прямо с экрана привязок (19.11.2026).
 *
 * Зачем в приложении, а не только в терминале: файл из 1С приходит регулярно, и загружать его
 * должен НП или АДМ, а не линия поддержки по просьбе. Порядок двухшаговый, как в импорте
 * номенклатуры: сначала **проверка** — человек видит, что привяжется, что пропущено и почему;
 * только потом **загрузка**. Мастер-данные без предварительного показа последствий не меняются.
 */

export interface BomPreviewResult {
  success: boolean;
  error?: string;
  /** Текст отчёта — то, что человек читает перед загрузкой. */
  report?: string;
  counts?: { fromFile: number; bind: number; mass: number; tube: number; skip: number };
  /** Пропущенные позиции (рабочий список: их нет в номенклатуре или противоречие в файле). */
  skipped?: Array<{ gpCode: string; gpName: string; reason: string }>;
  fileSize?: number;
  fileName?: string;
}

async function loadCatalogue(): Promise<CatalogueEntry[]> {
  const products = await prisma.product.findMany({
    select: {
      code: true,
      name: true,
      category: true,
      active: true,
      massProduct: { select: { code: true } },
      tubeProductCode: true,
    },
  });
  return products.map((product) => ({
    code: product.code,
    name: product.name,
    category: product.category,
    active: product.active,
    currentMassCode: product.massProduct?.code ?? null,
    currentTubeCode: product.tubeProductCode ?? null,
  }));
}

async function parseUploaded(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const rows = readFirstSheet(buffer);
  const catalogue = await loadCatalogue();
  const catalogueByCode = new Map(catalogue.map((entry) => [entry.code, entry]));
  const parsed = parseBom(rows, catalogueByCode);
  const plan = buildBomPlan(parsed, catalogue);
  return { parsed, plan, catalogue, buffer };
}

/** Шаг 1: проверить файл и показать последствия. Нихчего не пишет. */
export async function previewBomAction(formData: FormData): Promise<BomPreviewResult> {
  try {
    const session = await requirePermission('nsi:manage');
    if (!hasPermission(session.user.roles.map((ur) => ur.role.code), 'nsi:manage')) {
      return { success: false, error: 'Forbidden: insufficient permissions' };
    }

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { success: false, error: 'Выберите файл выгрузки 1С (.xlsx)' };
    }

    const { parsed, plan } = await parseUploaded(file);
    const report = describeBomPlan(plan, parsed.issues);

    return {
      success: true,
      report,
      counts: {
        fromFile: plan.counts.fromFile,
        bind: plan.counts.bind,
        mass: parsed.stats.massBindings,
        tube: parsed.stats.tubeBindings,
        skip: plan.counts.skip,
      },
      skipped: plan.skip.map((item) => ({
        gpCode: item.gpCode,
        gpName: item.gpName,
        reason: item.reason ?? '',
      })),
      fileSize: file.size,
      fileName: file.name,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось разобрать файл',
    };
  }
}

/** Шаг 2: записать привязки. Файл передаётся заново — сервер ничего не держит между запросами. */
export async function applyBomAction(formData: FormData): Promise<BomPreviewResult> {
  try {
    const session = await requirePermission('nsi:manage');
    const roles = session.user.roles.map((ur) => ur.role.code);
    if (!hasPermission(roles, 'nsi:manage')) {
      return { success: false, error: 'Forbidden: insufficient permissions' };
    }

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { success: false, error: 'Выберите файл выгрузки 1С (.xlsx)' };
    }

    const { parsed, plan } = await parseUploaded(file);
    const report = describeBomPlan(plan, parsed.issues);

    const result = await applyBomPlan(prisma as never, plan, {
      fileName: file.name,
      actorId: session.userId,
      actorRoles: roles,
      report,
      fileSize: file.size,
    });

    revalidatePath('/nsi/gp-bindings');
    revalidatePath('/production-orders/new');

    return {
      success: true,
      report: `${report}\n\nЗаписано: привязок Массы ${result.massBound}, привязок Тубы ${result.tubeBound}, ` +
        `без изменений ${result.massUnchanged}. Запуск сохранён в журнале загрузок.`,
      counts: {
        fromFile: plan.counts.fromFile,
        bind: plan.counts.bind,
        mass: result.massBound,
        tube: result.tubeBound,
        skip: plan.counts.skip,
      },
      skipped: plan.skip.map((item) => ({
        gpCode: item.gpCode,
        gpName: item.gpName,
        reason: item.reason ?? '',
      })),
      fileName: file.name,
      fileSize: file.size,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось загрузить спецификации',
    };
  }
}

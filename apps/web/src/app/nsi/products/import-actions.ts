'use server';

// Загрузка номенклатуры из файла .xlsx: проверка файла и применение (этап 5, задание владельца 12.10.2026).
//
// Два действия, а не одно: администратор сначала видит последствия загрузки (что появится, что
// изменится, где ошибки), и только потом применяет. Ошибки в файле блокируют загрузку целиком —
// частично загруженный справочник хуже, чем незагруженный.

import { revalidatePath } from 'next/cache';
import { prisma } from '@prodtrack/db';
import type { RoleCode } from '@prisma/client';
import { hasPermission } from '@/lib/auth/access';
import { requireSession } from '@/lib/auth/session';
import {
  MAX_IMPORT_FILE_BYTES,
  PREVIEW_ROWS,
  parseProductImportTable,
} from '@/lib/nsi-import/product-import';
import {
  buildImportPlan,
  type ExistingProduct,
  type ImportPlanCounts,
  type ImportPlanItem,
  type ProductImportMode,
} from '@/lib/nsi-import/plan';
import { applyImportPlan } from '@/lib/nsi-import/apply';
import { isSupportedImportFile, readXlsxTable } from '@/lib/nsi-import/xlsx';

export interface ProductImportRowError {
  rowNumber: number;
  messages: string[];
}

export interface ProductImportCheckResult {
  ok: boolean;
  error?: string;
  fileName?: string;
  mode: ProductImportMode;
  totalRows: number;
  counts: ImportPlanCounts;
  /** Первые строки плана — для предпросмотра в диалоге. */
  preview: ImportPlanItem[];
  rowErrors: ProductImportRowError[];
  ignoredHeaders: string[];
}

export interface ProductImportApplyResult {
  success: boolean;
  error?: string;
  created?: number;
  updated?: number;
  unchanged?: number;
  skipped?: number;
}

function parseMode(value: FormDataEntryValue | null): ProductImportMode {
  return value === 'upsert' ? 'upsert' : 'add-only';
}

/**
 * Доступ — ровно как у ручного ведения справочника: право nsi:manage.
 * Инструмент не даёт новых прав: кто может создать позицию вручную, тот может загрузить и файл.
 */
async function requireImportAccess(): Promise<{ userId: string; roles: RoleCode[] } | null> {
  const session = await requireSession();
  const roles = session.user.roles.map((ur) => ur.role.code);
  if (!hasPermission(roles, 'nsi:manage')) {
    return null;
  }
  return { userId: session.userId, roles };
}

/** Читает файл из формы: расширение, размер и разбор проверяются до обращения к базе. */
async function readUploadedTable(
  formData: FormData,
): Promise<{ fileName: string; table: string[][] }> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    throw new Error('Выберите файл .xlsx');
  }
  if (!isSupportedImportFile(file.name)) {
    throw new Error('Нужен файл .xlsx (Excel 2007 и новее): формат .xls и .csv не принимается');
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error('Файл больше 10 МБ — разделите его на части');
  }

  try {
    return { fileName: file.name, table: await readXlsxTable(await file.arrayBuffer()) };
  } catch {
    throw new Error('Файл не читается как .xlsx — откройте его в Excel и сохраните заново');
  }
}

/** Существующие позиции одним запросом: без обращения к базе в цикле (Definition of Done, п. 4). */
async function findExistingProducts(codes: string[]): Promise<ExistingProduct[]> {
  if (codes.length === 0) {
    return [];
  }
  return prisma.product.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true, name: true, category: true, unit: true, active: true },
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Проверка файла без записи в базу: что появится, что изменится, где ошибки.
 */
export async function checkProductImportAction(
  formData: FormData,
): Promise<ProductImportCheckResult> {
  const mode = parseMode(formData.get('mode'));

  try {
    if (!(await requireImportAccess())) {
      return {
        ok: false,
        error: 'Загрузка номенклатуры недоступна для вашей роли',
        mode,
        totalRows: 0,
        counts: { create: 0, update: 0, unchanged: 0, skip: 0, errors: 0 },
        preview: [],
        rowErrors: [],
        ignoredHeaders: [],
      };
    }

    const { fileName, table } = await readUploadedTable(formData);
    const parsed = parseProductImportTable(table);

    if (parsed.fatalError) {
      return {
        ok: false,
        error: parsed.fatalError,
        fileName,
        mode,
        totalRows: 0,
        counts: { create: 0, update: 0, unchanged: 0, skip: 0, errors: 0 },
        preview: [],
        rowErrors: [],
        ignoredHeaders: parsed.ignoredHeaders,
      };
    }

    const existing = await findExistingProducts(parsed.rows.map((row) => row.code));
    const plan = buildImportPlan(parsed.rows, existing, mode, parsed.errors.length);

    return {
      ok: true,
      fileName,
      mode,
      totalRows: plan.totalRows,
      counts: plan.counts,
      preview: plan.items.slice(0, PREVIEW_ROWS),
      rowErrors: parsed.errors.slice(0, PREVIEW_ROWS),
      ignoredHeaders: parsed.ignoredHeaders,
    };
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error, 'Не удалось проверить файл'),
      mode,
      totalRows: 0,
      counts: { create: 0, update: 0, unchanged: 0, skip: 0, errors: 0 },
      preview: [],
      rowErrors: [],
      ignoredHeaders: [],
    };
  }
}

/**
 * Применение загрузки. Файл разбирается заново: состояние между двумя нажатиями не хранится,
 * поэтому применяется ровно то, что лежит в файле сейчас.
 */
export async function applyProductImportAction(
  formData: FormData,
): Promise<ProductImportApplyResult> {
  const mode = parseMode(formData.get('mode'));

  try {
    const actor = await requireImportAccess();
    if (!actor) {
      return { success: false, error: 'Загрузка номенклатуры недоступна для вашей роли' };
    }

    const { fileName, table } = await readUploadedTable(formData);
    const parsed = parseProductImportTable(table);

    if (parsed.fatalError) {
      return { success: false, error: parsed.fatalError };
    }
    if (parsed.errors.length > 0) {
      return {
        success: false,
        error:
          'В файле ' +
          parsed.errors.length +
          ' строк с ошибками — исправьте файл (первая: строка ' +
          parsed.errors[0].rowNumber +
          ') и загрузите снова',
      };
    }

    const existing = await findExistingProducts(parsed.rows.map((row) => row.code));
    const plan = buildImportPlan(parsed.rows, existing, mode);

    if (plan.counts.create + plan.counts.update === 0) {
      return {
        success: false,
        error: 'Загружать нечего: все строки файла уже совпадают со справочником',
      };
    }

    const result = await applyImportPlan(prisma, plan, actor, { fileName });
    revalidatePath('/nsi/products');

    return {
      success: true,
      created: result.created,
      updated: result.updated,
      unchanged: result.unchanged,
      skipped: result.skipped,
    };
  } catch (error) {
    return { success: false, error: errorMessage(error, 'Не удалось загрузить файл') };
  }
}

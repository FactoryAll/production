import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';

const tx = {
  product: { create: vi.fn(), update: vi.fn() },
  auditRecord: { create: vi.fn() },
};
const productFindMany = vi.fn();

vi.mock('@prodtrack/db', () => ({
  prisma: {
    product: { findMany: (...args: unknown[]) => productFindMany(...args) },
    $transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
  },
  writeAudit: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ requireSession: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { writeAudit } from '@prodtrack/db';
import { requireSession } from '@/lib/auth/session';
import { applyProductImportAction, checkProductImportAction } from '../import-actions';

const HEADERS = ['Код', 'Наименование', 'Категория', 'Единица измерения'];

function mockSession(roles: string[]) {
  (requireSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: 'user-adm',
    user: { id: 'user-adm', roles: roles.map((code) => ({ role: { code } })) },
  });
}

/**
 * jsdom не реализует Blob.arrayBuffer(), а серверное действие читает файл именно так.
 * В браузере и в Node метод есть — в тестах подменяем его на те же байты.
 */
function bytesOf(source: ArrayBufferView | ArrayBuffer): Uint8Array<ArrayBuffer> {
  const view =
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer as ArrayBuffer, source.byteOffset, source.byteLength);
  return new Uint8Array(view);
}

function makeFile(source: ArrayBufferView | ArrayBuffer, fileName: string): File {
  const bytes = bytesOf(source);
  const file = new File([bytes], fileName);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  return file;
}

async function fileForm(
  rows: (string | number)[][],
  mode: 'add-only' | 'upsert' = 'add-only',
  fileName = 'nomenclature.xlsx',
): Promise<FormData> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Номенклатура');
  sheet.addRow(HEADERS);
  rows.forEach((row) => sheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();

  const formData = new FormData();
  formData.set('file', makeFile(buffer, fileName));
  formData.set('mode', mode);
  return formData;
}

const existingProduct = {
  id: 'p-1',
  code: 'GP001',
  name: 'Крем А',
  category: 'GP',
  unit: 'шт',
  active: true,
};

describe('Загрузка номенклатуры из файла: серверные действия', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession(['ADM']);
    productFindMany.mockResolvedValue([existingProduct]);
    tx.product.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'new-' + data.code,
      ...data,
    }));
    tx.product.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...existingProduct,
      ...data,
    }));
  });

  it('недоступна роли без права ведения справочника', async () => {
    mockSession(['OPR']);

    const checked = await checkProductImportAction(await fileForm([['GP002', 'Крем Б', 'ГП', 'шт']]));
    const applied = await applyProductImportAction(await fileForm([['GP002', 'Крем Б', 'ГП', 'шт']]));

    expect(checked.ok).toBe(false);
    expect(checked.error).toContain('недоступна для вашей роли');
    expect(applied.success).toBe(false);
    expect(productFindMany).not.toHaveBeenCalled();
    expect(tx.product.create).not.toHaveBeenCalled();
  });

  it('доступна тем же ролям, что ручное ведение справочника: право nsi:manage', async () => {
    mockSession(['NP']);

    const result = await checkProductImportAction(
      await fileForm([['GP002', 'Крем Б', 'ГП', 'шт']]),
    );

    expect(result.ok).toBe(true);
    expect(result.counts.create).toBe(1);
  });

  it('на проверке показывает новые строки и совпадения со справочником', async () => {
    const result = await checkProductImportAction(
      await fileForm([
        ['GP001', 'Крем А изменённый', 'ГП', 'шт'],
        ['GP002', 'Крем Б', 'ГП', 'шт'],
      ]),
    );

    expect(result.ok).toBe(true);
    expect(result.counts).toEqual({ create: 1, update: 0, unchanged: 0, skip: 1, errors: 0 });
    expect(result.preview).toHaveLength(2);
    // Существующие позиции ищутся одним запросом, а не по строке (Definition of Done, п. 4).
    expect(productFindMany).toHaveBeenCalledTimes(1);
    expect(productFindMany.mock.calls[0][0].where.code.in).toEqual(['GP001', 'GP002']);
  });

  it('создаёт новые позиции и пишет аудит по каждой плюс сводную запись', async () => {
    const result = await applyProductImportAction(
      await fileForm([
        ['GP001', 'Крем А', 'ГП', 'шт'],
        ['GP002', 'Крем Б', 'ГП', 'шт'],
      ]),
    );

    expect(result.success).toBe(true);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(tx.product.create).toHaveBeenCalledTimes(1);
    expect(tx.product.create).toHaveBeenCalledWith({
      data: { code: 'GP002', name: 'Крем Б', category: 'GP', unit: 'шт', active: true },
    });

    const audits = (writeAudit as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1]);
    expect(audits).toHaveLength(2);
    expect(audits[0].action).toBe('CREATE');
    expect(audits[0].objectType).toBe('Product');
    expect(audits[1].objectType).toBe('ProductImport');
    expect(audits[1].newValue).toContain('nomenclature.xlsx');
  });

  it('обновляет только изменившиеся поля и не трогает признак активности', async () => {
    const result = await applyProductImportAction(
      await fileForm([['GP001', 'Крем А улучшенный', 'ГП', 'шт']], 'upsert'),
    );

    expect(result.success).toBe(true);
    expect(result.updated).toBe(1);
    expect(tx.product.update).toHaveBeenCalledTimes(1);
    const updateArgs = tx.product.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'p-1' });
    expect(updateArgs.data).toEqual({ name: 'Крем А улучшенный' });
    expect('active' in updateArgs.data).toBe(false);

    const audits = (writeAudit as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[1]);
    const update = audits.find((audit) => audit.action === 'UPDATE');
    expect(update.field).toBe('name');
    expect(update.oldValue).toBe('{"name":"Крем А"}');
    expect(update.newValue).toBe('{"name":"Крем А улучшенный"}');
  });

  it('строка с ошибкой блокирует загрузку целиком', async () => {
    const result = await applyProductImportAction(
      await fileForm([
        ['GP002', 'Крем Б', 'ГП', 'шт'],
        ['GP003', 'Крем В', 'ПФ', 'шт'],
      ]),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('строк с ошибками');
    expect(tx.product.create).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('отказывается загружать, когда все строки уже совпадают со справочником', async () => {
    const result = await applyProductImportAction(
      await fileForm([['GP001', 'Крем А', 'ГП', 'шт']], 'upsert'),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Загружать нечего');
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('принимает только .xlsx и сообщает об этом понятно', async () => {
    const result = await checkProductImportAction(
      await fileForm([['GP002', 'Крем Б', 'ГП', 'шт']], 'add-only', 'номенклатура.csv'),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Нужен файл .xlsx');
  });

  it('без строки заголовков объясняет, что нужно скачать шаблон', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Лист1').addRow(['просто текст']);
    const buffer = await workbook.xlsx.writeBuffer();
    const formData = new FormData();
    formData.set('file', makeFile(buffer, 'nomenclature.xlsx'));

    const result = await checkProductImportAction(formData);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('не найдена строка заголовков');
    expect(result.error).toContain('шаблон');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProductCategory } from '@prodtrack/contracts';
import type { ProductImportCheckResult } from '../import-actions';

const checkProductImportAction = vi.fn();
const applyProductImportAction = vi.fn();

vi.mock('../import-actions', () => ({
  checkProductImportAction: (...args: unknown[]) => checkProductImportAction(...args),
  applyProductImportAction: (...args: unknown[]) => applyProductImportAction(...args),
}));
vi.mock('../actions', () => ({
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  toggleProductActive: vi.fn(),
  getDeactivationWarnings: vi.fn().mockResolvedValue([]),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ImportProductsDialog } from '../_components/import-dialog';
import ProductsPage from '../_client-page';

const emptyCounts = { create: 0, update: 0, unchanged: 0, skip: 0, errors: 0 };

function report(overrides: Partial<ProductImportCheckResult> = {}): ProductImportCheckResult {
  return {
    ok: true,
    mode: 'add-only',
    fileName: 'nomenclature.xlsx',
    totalRows: 2,
    counts: { ...emptyCounts, create: 1, skip: 1 },
    preview: [
      {
        rowNumber: 2,
        code: 'GP002',
        name: 'Крем Б',
        category: ProductCategory.GP,
        unit: 'шт',
        action: 'create',
      },
    ],
    rowErrors: [],
    ignoredHeaders: [],
    ...overrides,
  };
}

function renderDialog() {
  return render(<ImportProductsDialog open onClose={() => {}} />);
}

function chooseFile() {
  const input = screen.getByLabelText('Файл') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(['dummy'], 'nomenclature.xlsx')] },
  });
}

describe('Диалог загрузки номенклатуры из файла', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('без выбранного файла проверка недоступна', () => {
    renderDialog();

    expect(screen.getByLabelText('Файл')).toBeDefined();
    expect((screen.getByRole('button', { name: 'Проверить файл' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('показывает результат проверки: счётчики, предпросмотр и действие по строке', async () => {
    checkProductImportAction.mockResolvedValue(report());
    renderDialog();
    chooseFile();

    fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));

    await waitFor(() => {
      expect(screen.getByText(/Строк с данными: 2/)).toBeDefined();
    });
    expect(screen.getByText('GP002')).toBeDefined();
    expect(screen.getByText('создание')).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Загрузить (1)' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('при ошибках в файле перечисляет строки и блокирует загрузку', async () => {
    checkProductImportAction.mockResolvedValue(
      report({
        counts: { ...emptyCounts, create: 0, errors: 1 },
        preview: [],
        rowErrors: [{ rowNumber: 5, messages: ['Не указана категория'] }],
      }),
    );
    renderDialog();
    chooseFile();

    fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));

    await waitFor(() => {
      expect(screen.getByText(/Строка 5: Не указана категория/)).toBeDefined();
    });
    expect(
      (screen.getByRole('button', { name: 'Загрузить (0)' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('после загрузки показывает, сколько создано и обновлено', async () => {
    checkProductImportAction.mockResolvedValue(report());
    applyProductImportAction.mockResolvedValue({
      success: true,
      created: 1,
      updated: 0,
      skipped: 1,
      unchanged: 0,
    });
    renderDialog();
    chooseFile();

    fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Загрузить (1)' })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить (1)' }));

    await waitFor(() => {
      expect(screen.getByText(/Загрузка выполнена/)).toBeDefined();
    });
    expect(screen.getByText(/создано: 1/)).toBeDefined();
  });

  it('показывает ошибку сервера, если файл не принят', async () => {
    checkProductImportAction.mockResolvedValue({
      ok: false,
      error: 'Нужен файл .xlsx (Excel 2007 и новее): формат .xls и .csv не принимается',
      mode: 'add-only',
      totalRows: 0,
      counts: emptyCounts,
      preview: [],
      rowErrors: [],
      ignoredHeaders: [],
    });
    renderDialog();
    chooseFile();

    fireEvent.click(screen.getByRole('button', { name: 'Проверить файл' }));

    await waitFor(() => {
      expect(screen.getByText(/Нужен файл .xlsx/)).toBeDefined();
    });
  });
});

describe('Кнопка загрузки на экране номенклатуры', () => {
  it('видна только тому, кто ведёт справочник', () => {
    const { unmount } = render(
      <ProductsPage products={[]} canManage query="" activeFilter="ALL" />,
    );
    expect(screen.getByRole('button', { name: 'Загрузить из файла' })).toBeDefined();
    unmount();

    render(<ProductsPage products={[]} canManage={false} query="" activeFilter="ALL" />);
    expect(screen.queryByRole('button', { name: 'Загрузить из файла' })).toBeNull();
  });
});

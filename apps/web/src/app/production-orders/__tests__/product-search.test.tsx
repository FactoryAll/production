import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { Employee, Product, WorkCenter } from '@prisma/client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const createProductionOrderAction = vi.fn();
vi.mock('../actions', () => ({
  createProductionOrderAction: (...args: unknown[]) => createProductionOrderAction(...args),
}));

import ProductionOrderForm from '../new/_client-form';

const workCenter: WorkCenter = {
  id: 'wc-03', code: '03', name: '03.Тубировка крем', producesMass: false, active: true,
  createdAt: new Date(), updatedAt: new Date(),
};

function product(id: string, code: string, name: string, category: 'GP' | 'MASS' = 'GP'): Product {
  return { id, code, name, category, unit: 'шт', active: true, createdAt: new Date(), updatedAt: new Date() };
}

const gel = product('p-1', 'БП-00000109', 'GECO Гель дезинфицирующий, 100 мл');
const cream = product('p-2', 'БП-00001700', 'GECO Крем для рук');
const mass = product('p-3', 'MASS-001', 'Масса базовая', 'MASS');

const operator: Employee = {
  id: 'emp-opr', fullName: 'Оператор О.О.', tabNumber: '0001', active: true, canBeWorker: true,
  createdAt: new Date(), updatedAt: new Date(),
};

function renderForm() {
  return render(
    <ProductionOrderForm
      workCenters={[workCenter]}
      products={[gel, cream, mass]}
      workerEmployees={[operator]}
      operatorEmployees={[operator]}
      shiftOptions={[{ value: '1', label: '1-я смена (08:00–20:00)' }]}
      defaultShiftDate="2026-10-12"
      defaultShiftNumber={1}
      minShiftDate="2026-10-12"
    />,
  );
}

function chooseWorkCenter() {
  fireEvent.change(screen.getByLabelText('Рабочий центр'), { target: { value: workCenter.id } });
}

function searchProduct(query: string) {
  const field = screen.getByLabelText('Номенклатура') as HTMLInputElement;
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: query } });
  return field;
}

describe('Форма ПЗ: выбор номенклатуры с поиском (фидбэк ОПЭ)', () => {
  it('до выбора РЦ список номенклатуры не открывается', () => {
    renderForm();

    const field = screen.getByLabelText('Номенклатура') as HTMLInputElement;
    expect(field.disabled).toBe(true);
    expect(field.placeholder).toBe('Сначала выберите РЦ');
  });

  it('поиск по коду оставляет только подходящую позицию', () => {
    renderForm();
    chooseWorkCenter();

    searchProduct('00000109');

    // Ищем только в списке подсказок: role="option" есть и у вариантов обычных <select> формы.
    const options = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    expect(options).toHaveLength(1);
    expect(options[0]).toContain('GECO Гель дезинфицирующий');
  });

  it('на РЦ готовой продукции Масса не предлагается', () => {
    renderForm();
    chooseWorkCenter();

    searchProduct('Масса');

    expect(screen.getByText('Ничего не найдено')).toBeDefined();
  });

  it('выбранная позиция уходит в заявку на сохранение', async () => {
    createProductionOrderAction.mockResolvedValue({ success: true });
    renderForm();
    chooseWorkCenter();

    searchProduct('гель');
    fireEvent.mouseDown(within(screen.getByRole('listbox')).getByRole('option', { name: /GECO Гель/ }));

    // Поле показывает выбранное значение целиком — код и наименование.
    expect((screen.getByLabelText('Номенклатура') as HTMLInputElement).value).toContain('БП-00000109');

    fireEvent.change(screen.getByLabelText('Плановое количество'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Оператор'), { target: { value: operator.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));

    await waitFor(() => {
      expect(createProductionOrderAction).toHaveBeenCalled();
    });

    const formData = createProductionOrderAction.mock.calls[0][0] as FormData;
    const lines = JSON.parse(String(formData.get('lines'))) as { productId: string; plannedQuantity: string }[];
    expect(lines[0].productId).toBe('p-1');
    expect(lines[0].plannedQuantity).toBe('50');
  });
});

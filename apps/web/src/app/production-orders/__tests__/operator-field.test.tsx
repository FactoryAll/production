import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Employee, Product, Shift, WorkCenter } from '@prisma/client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('../actions', () => ({
  createProductionOrderAction: vi.fn(),
}));

import ProductionOrderForm from '../new/_client-form';

function employee(id: string, fullName: string): Employee {
  return { id, tabNumber: id, fullName, active: true, createdAt: new Date(), updatedAt: new Date() };
}

const operator = employee('emp-opr', 'Оператор О.О.');
const storekeeper = employee('emp-store', 'Складчиков С.С.');

const shift: Shift = {
  id: 'shift-1', number: 1, date: new Date('2026-10-06'), start: '08:00', end: '20:00',
  active: true, createdAt: new Date(), updatedAt: new Date(),
};
const workCenter: WorkCenter = {
  id: 'wc-01', code: '01', name: '01.Реактор', producesMass: true, active: true,
  createdAt: new Date(), updatedAt: new Date(),
};
const product: Product = {
  id: 'p-1', code: 'M-001', name: 'Масса', category: 'MASS', unit: 'кг', active: true,
  createdAt: new Date(), updatedAt: new Date(),
};

function renderForm() {
  return render(
    <ProductionOrderForm
      shifts={[shift]}
      workCenters={[workCenter]}
      products={[product]}
      employees={[operator, storekeeper]}
      operatorEmployees={[operator]}
    />,
  );
}

describe('Форма ПЗ: поле «Оператор» (T-070)', () => {
  it('предлагает только сотрудников с активной учётной записью роли ОПР', () => {
    renderForm();

    const select = screen.getByLabelText('Оператор') as HTMLSelectElement;
    const labels = Array.from(select.options).map((option) => option.text);

    expect(labels).toContain('Оператор О.О.');
    expect(labels).not.toContain('Складчиков С.С.');
  });

  it('оставляет в списке «Работники» всех активных сотрудников', () => {
    renderForm();

    expect(screen.queryByLabelText('Складчиков С.С.')).not.toBeNull();
  });

  it('объясняет, что Оператора назначить нельзя, если нет ни одной учётной записи ОПР', () => {
    render(
      <ProductionOrderForm
        shifts={[shift]}
        workCenters={[workCenter]}
        products={[product]}
        employees={[storekeeper]}
        operatorEmployees={[]}
      />,
    );

    expect(screen.getByText(/Нет сотрудников с активной учётной записью роли ОПР/)).toBeTruthy();
  });
});

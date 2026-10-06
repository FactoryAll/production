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

function employee(id: string, fullName: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id,
    tabNumber: id,
    fullName,
    active: true,
    canBeWorker: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const operator = employee('emp-opr', 'Оператор О.О.');
const worker = employee('emp-worker', 'Рабочий Р.Р.');
const storekeeper = employee('emp-store', 'Складчиков С.С.', { canBeWorker: false });

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

function renderForm(overrides: { workerEmployees?: Employee[]; operatorEmployees?: Employee[] } = {}) {
  return render(
    <ProductionOrderForm
      shifts={[shift]}
      workCenters={[workCenter]}
      products={[product]}
      workerEmployees={overrides.workerEmployees ?? [operator, worker]}
      operatorEmployees={overrides.operatorEmployees ?? [operator]}
    />,
  );
}

describe('Форма ПЗ: списки сотрудников (T-070, T-071)', () => {
  it('предлагает в поле «Оператор» только сотрудников с активной учётной записью роли ОПР', () => {
    renderForm();

    const labels = Array.from((screen.getByLabelText('Оператор') as HTMLSelectElement).options).map(
      (option) => option.text,
    );

    expect(labels).toContain('Оператор О.О.');
    expect(labels).not.toContain('Рабочий Р.Р.');
    expect(labels).not.toContain('Складчиков С.С.');
  });

  it('предлагает в «Работниках» только сотрудников с допуском к работе на РЦ', () => {
    renderForm();

    expect(screen.queryByLabelText('Рабочий Р.Р.')).not.toBeNull();
    expect(screen.queryByLabelText('Складчиков С.С.')).toBeNull();
  });

  it('объясняет, что Оператора назначить нельзя, если нет ни одной учётной записи ОПР', () => {
    renderForm({ operatorEmployees: [] });

    expect(screen.getByText(/Нет сотрудников с активной учётной записью роли ОПР/)).toBeTruthy();
  });
});

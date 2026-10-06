import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Employee } from '@prisma/client';

vi.mock('../actions', () => ({
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  toggleEmployeeActive: vi.fn(),
  getDeactivationWarnings: vi.fn().mockResolvedValue([]),
}));

import EmployeesPage from '../_client-page';

const employee: Employee = {
  id: 'e-1',
  fullName: 'Иванов Иван Иванович',
  tabNumber: '000123',
  active: true,
  canBeWorker: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function renderPage() {
  return render(
    <EmployeesPage employees={[employee]} canManage query="" activeFilter="ALL" />,
  );
}

describe('Диалог сотрудника: форма открывается с данными записи', () => {
  it('при редактировании подставляет ФИО, табельный номер и признак допуска', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Редактировать' }));

    // Диалог живёт всё время работы экрана: без сброса ключа поля оставались пустыми,
    // и чтобы переключить признак, приходилось заново вводить ФИО и табельный номер.
    expect((screen.getByLabelText('ФИО') as HTMLInputElement).value).toBe('Иванов Иван Иванович');
    expect((screen.getByLabelText('Табельный номер') as HTMLInputElement).value).toBe('000123');
    expect(
      (screen.getByLabelText('Может привлекаться работником РЦ') as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('при создании нового сотрудника поля пустые, признак включён', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    expect((screen.getByLabelText('ФИО') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Табельный номер') as HTMLInputElement).value).toBe('');
    expect(
      (screen.getByLabelText('Может привлекаться работником РЦ') as HTMLInputElement).checked,
    ).toBe(true);
  });
});

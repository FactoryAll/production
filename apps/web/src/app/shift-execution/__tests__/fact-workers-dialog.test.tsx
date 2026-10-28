import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const reportAction = vi.fn().mockResolvedValue({ success: true, warnings: [] });

vi.mock('../actions', () => ({
  acceptProductionOrderLineAction: vi.fn(),
  reportProductionFactAction: (...args: unknown[]) => reportAction(...args),
  correctFactByOperatorAction: vi.fn(),
  getAvailableBalanceAction: vi.fn().mockResolvedValue({ available: 279, unit: 'кг' }),
}));

import ShiftExecutionPage from '../_client-page';

const WORK_CENTER_ID = 'abc13ba9-8924-4a59-bc13-8ce4d8ce457d';

const PETROV = { id: 'emp-2', fullName: 'Петров П.П.', tabNumber: '0002' };
const SIDOROV = { id: 'emp-3', fullName: 'Сидоров С.С.', tabNumber: '0003' };

function makeLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'line-1',
    orderId: 'po-1',
    workCenterId: WORK_CENTER_ID,
    productId: 'mass-1',
    plannedQuantity: new Decimal(40),
    operatorId: 'emp-1',
    status: 'ACCEPTED' as const,
    comment: null,
    substitutionReasonId: null,
    createdAt: new Date('2026-10-05T12:59:47.000Z'),
    updatedAt: new Date('2026-10-05T12:59:47.000Z'),
    order: {
      id: 'po-1',
      status: 'IN_PROGRESS' as const,
      shift: { number: 1, date: new Date('2026-10-05T00:00:00.000Z') },
    },
    workCenter: { id: WORK_CENTER_ID, code: '03', name: '03.Тубировка крем', producesMass: true },
    product: {
      id: 'mass-1',
      code: 'M001',
      name: 'Масса крема',
      unit: 'кг',
      category: 'MASS' as const,
    },
    facts: [],
    workerAssignments: [],
    ...overrides,
  };
}

function renderPage(lines: Array<ReturnType<typeof makeLine>>) {
  return render(
    <ShiftExecutionPage
      lines={lines as never}
      defectReasons={[]}
      consumableProducts={[]}
      absenceReasons={[
        { id: 'reason-1', code: 'ILLNESS', name: 'Болезнь' },
        { id: 'reason-2', code: 'ABSENTEEISM', name: 'Прогул' },
      ]}
      workerCandidates={[PETROV, SIDOROV]}
      employeeId="emp-1"
    />,
  );
}

function openReportDialog(line: ReturnType<typeof makeLine>) {
  renderPage([line]);
  fireEvent.click(screen.getByRole('button', { name: 'Внести итог' }));
  return screen.getByRole('dialog');
}

describe('T-093: подтверждение состава работников при вводе итога', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportAction.mockResolvedValue({ success: true, warnings: [] });
  });

  it('показывает назначенных работников отмеченными', () => {
    const dialog = openReportDialog(makeLine({ workerAssignments: [{ employeeId: 'emp-2', employee: PETROV }] }));

    expect(dialog.textContent).toContain('Работники смены');
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(dialog.textContent).toContain('Петров П.П.');
  });

  it('снятая отметка требует причину неявки из справочника', async () => {
    const dialog = openReportDialog(makeLine({ workerAssignments: [{ employeeId: 'emp-2', employee: PETROV }] }));

    fireEvent.click(screen.getByRole('checkbox'));
    // Появился выбор причины с действующими причинами из справочника.
    const select = screen.getByRole('combobox', { name: 'Причина неявки: Петров П.П.' });
    expect(select.textContent).toContain('Болезнь');
    expect(select.textContent).toContain('Прогул');

    // Заполняем выпуск и пробуем сохранить без причины — сохранение отклоняется на экране.
    // Первое числовое поле в диалоге — выпуск; остальные (брак, простои) не трогаем.
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Внести итог' }));

    expect(reportAction).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain('Укажите причину неявки для каждого, кто не вышел');
  });

  it('отправляет состав снимком вместе с итогом', async () => {
    const dialog = openReportDialog(
      makeLine({ workerAssignments: [{ employeeId: 'emp-2', employee: PETROV }] }),
    );

    // Первое числовое поле в диалоге — выпуск; остальные (брак, простои) не трогаем.
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Внести итог' }));

    const formData = reportAction.mock.calls[0][1] as FormData;
    const workers = JSON.parse(String(formData.get('workers')));
    expect(workers).toEqual([
      { employeeId: 'emp-2', worked: true, absenceReasonId: null, comment: null },
    ]);
  });

  it('добавленный работник без причины словами не сохраняется', async () => {
    const dialog = openReportDialog(makeLine());

    fireEvent.change(screen.getByRole('combobox', { name: 'Добавить работника' }), {
      target: { value: 'emp-3' },
    });
    // Первое числовое поле в диалоге — выпуск; остальные (брак, простои) не трогаем.
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Внести итог' }));

    expect(reportAction).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain('Укажите причину, по которой работника добавили в состав');
  });

  it('добавленный работник с причиной уходит с признаком «не назначен» на сервере', async () => {
    const dialog = openReportDialog(makeLine());

    fireEvent.change(screen.getByRole('combobox', { name: 'Добавить работника' }), {
      target: { value: 'emp-3' },
    });
    fireEvent.change(screen.getByPlaceholderText('Почему добавили (обязательно)'), {
      target: { value: 'Вышел вместо заболевшего' },
    });
    // Первое числовое поле в диалоге — выпуск; остальные (брак, простои) не трогаем.
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Внести итог' }));

    const formData = reportAction.mock.calls[0][1] as FormData;
    const workers = JSON.parse(String(formData.get('workers')));
    expect(workers).toEqual([
      {
        employeeId: 'emp-3',
        worked: true,
        absenceReasonId: null,
        comment: 'Вышел вместо заболевшего',
      },
    ]);
  });
});

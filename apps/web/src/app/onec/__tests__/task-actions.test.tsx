import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const markTaskProcessedAction = vi.fn();
const unmarkTaskProcessedAction = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

vi.mock('../actions', () => ({
  markTaskProcessedAction: (...args: unknown[]) => markTaskProcessedAction(...args),
  unmarkTaskProcessedAction: (...args: unknown[]) => unmarkTaskProcessedAction(...args),
}));

import TaskActions from '../[id]/_task-actions';

describe('Действия задачи для 1С (T-052, M12 §8, BR-4/BR-8, Р-17)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('в статусе «Ожидает» показывает кнопку отметки и подтверждает успех', async () => {
    markTaskProcessedAction.mockResolvedValue({ success: true });

    render(<TaskActions taskId="task-1" status="PENDING" />);
    fireEvent.click(screen.getByRole('button', { name: /Отметить обработано/ }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Задача отмечена как обработанная');
    });
    expect(markTaskProcessedAction).toHaveBeenCalledWith('task-1');
    expect(refresh).toHaveBeenCalled();
  });

  it('показывает ошибку серверного действия, а не молчит', async () => {
    markTaskProcessedAction.mockResolvedValue({ success: false, error: 'Задача не найдена' });

    render(<TaskActions taskId="task-1" status="PENDING" />);
    fireEvent.click(screen.getByRole('button', { name: /Отметить обработано/ }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Задача не найдена');
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('для обработанной задачи показывает отмену и требует причину (Р-17)', async () => {
    unmarkTaskProcessedAction.mockResolvedValue({
      success: false,
      error: 'Причина отмены обязательна (Р-17)',
    });

    render(<TaskActions taskId="task-1" status="PROCESSED" />);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить обработку' }));

    expect(screen.getByRole('dialog')).toBeTruthy();

    const dialogButtons = screen.getAllByRole('button', { name: 'Отменить обработку' });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Причина отмены обязательна (Р-17)');
    });
    // Диалог не закрывается до исправления причины (дефект 6/8.1 ручного тестирования).
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('закрывает диалог и обновляет данные после успешной отмены', async () => {
    unmarkTaskProcessedAction.mockResolvedValue({ success: true });

    render(<TaskActions taskId="task-1" status="PROCESSED" />);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить обработку' }));
    fireEvent.change(screen.getByLabelText('Причина отмены'), {
      target: { value: 'Документ создан ошибочно' },
    });

    const dialogButtons = screen.getAllByRole('button', { name: 'Отменить обработку' });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(refresh).toHaveBeenCalled();
  });
});

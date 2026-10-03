import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const archiveOldAuditAction = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

vi.mock('../actions', () => ({
  archiveOldAuditAction: (...args: unknown[]) => archiveOldAuditAction(...args),
}));

import ArchiveAuditButton from '../_archive-button';

describe('Кнопка архивации аудита (Р-16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('показывает количество архивированных записей', async () => {
    archiveOldAuditAction.mockResolvedValue({ success: true, archived: 4 });

    render(<ArchiveAuditButton />);
    fireEvent.click(screen.getByRole('button', { name: /Архивировать старые записи/ }));

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Записей переведено в архив: 4');
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('показывает ошибку серверного действия (не молчит)', async () => {
    archiveOldAuditAction.mockResolvedValue({
      success: false,
      error: 'Архивация аудита доступна только администратору (Р-16)',
    });

    render(<ArchiveAuditButton />);
    fireEvent.click(screen.getByRole('button', { name: /Архивировать старые записи/ }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Архивация аудита доступна только администратору (Р-16)',
      );
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

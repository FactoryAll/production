import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ObjectHistoryList } from '../object-history';
import type { AuditRecordItem } from '@/app/audit/queries';

function record(partial: Partial<AuditRecordItem>): AuditRecordItem {
  return {
    id: 'a-1',
    userId: 'user-1',
    userLogin: 'ivanov',
    role: 'NP',
    action: 'UPDATE',
    objectType: 'ProductionOrder',
    objectId: 'po-1',
    field: 'status',
    oldValue: 'DRAFT',
    newValue: 'CONFIRMED',
    createdAt: '2026-10-03T10:00:00.000Z',
    archived: false,
    ...partial,
  };
}

describe('История изменений объекта (M13 §8)', () => {
  it('показывает записи «кто, когда, что изменил»', () => {
    render(<ObjectHistoryList records={[record({})]} />);

    expect(screen.getByText('ivanov')).toBeTruthy();
    expect(screen.getByText('NP')).toBeTruthy();
    expect(screen.getByText('изменение')).toBeTruthy();
    expect(screen.getByText('status: DRAFT → CONFIRMED')).toBeTruthy();
  });

  it('помечает архивные записи (Р-16)', () => {
    render(<ObjectHistoryList records={[record({ archived: true })]} />);
    expect(screen.getByText('архив')).toBeTruthy();
  });

  it('показывает пустое состояние, если изменений нет', () => {
    render(<ObjectHistoryList records={[]} />);
    expect(screen.getByText('История изменений пуста.')).toBeTruthy();
  });
});

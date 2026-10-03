import { describe, it, expect } from 'vitest';
import type { GoodsTransfer } from '@prisma/client';
import { TRANSFER_STATUS_LABELS, transferStatusLabel } from '../labels';

describe('transferStatusLabel', () => {
  const statuses: GoodsTransfer['status'][] = [
    'DRAFT',
    'SUBMITTED',
    'RECEIVED',
    'DISCREPANCY',
    'RECONCILED',
    'CANCELLED',
  ];

  it('maps every transfer status to a Russian label', () => {
    expect(transferStatusLabel('DRAFT')).toBe('Черновик');
    expect(transferStatusLabel('SUBMITTED')).toBe('Отправлено');
    expect(transferStatusLabel('RECEIVED')).toBe('Принято');
    expect(transferStatusLabel('DISCREPANCY')).toBe('Расхождение');
    expect(transferStatusLabel('RECONCILED')).toBe('Согласовано');
    expect(transferStatusLabel('CANCELLED')).toBe('Отменено');
  });

  it('covers all statuses in the label map', () => {
    for (const status of statuses) {
      expect(TRANSFER_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it('falls back to the raw status for unknown values', () => {
    expect(transferStatusLabel('UNKNOWN' as GoodsTransfer['status'])).toBe('UNKNOWN');
  });

  it('is a pure synchronous helper (safe to call during render)', () => {
    // Regression guard: the helper must not be a Server Reference.
    // Everything exported from a 'use server' file becomes a Server Reference,
    // and calling it during render throws
    // "Server Functions cannot be called during initial render".
    const result = transferStatusLabel('DRAFT');
    expect(typeof result).toBe('string');
    expect(result).not.toBeInstanceOf(Promise);
  });
});

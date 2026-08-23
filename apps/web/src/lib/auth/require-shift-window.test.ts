import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('requireShiftWindow', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function setupMocks({ roles, withinWindow }: { roles: string[]; withinWindow: boolean }) {
    vi.doMock('./shift-window', () => ({
      isWithinShiftWindow: vi.fn().mockReturnValue(withinWindow),
    }));

    vi.doMock('./session', () => ({
      requireSession: vi.fn().mockResolvedValue({
        userId: 'user-1',
        user: {
          id: 'user-1',
          passwordHash: 'hashed',
          roles: roles.map((code) => ({ role: { code } })),
        },
      }),
    }));

    const { requireShiftWindow } = await import('./require-shift-window');
    const { isWithinShiftWindow } = await import('./shift-window');
    return { requireShiftWindow, isWithinShiftWindow };
  }

  it('succeeds for single OPR role inside shift window', async () => {
    const { requireShiftWindow, isWithinShiftWindow } = await setupMocks({ roles: ['OPR'], withinWindow: true });
    await expect(requireShiftWindow()).resolves.toMatchObject({ userId: 'user-1' });
    expect(isWithinShiftWindow).toHaveBeenCalled();
  });

  it('throws for single OPR role outside shift window', async () => {
    const { requireShiftWindow } = await setupMocks({ roles: ['OPR'], withinWindow: false });
    await expect(requireShiftWindow()).rejects.toThrow('Вне рабочего времени');
  });

  it('skips shift window check when OPR has additional roles', async () => {
    const { requireShiftWindow, isWithinShiftWindow } = await setupMocks({ roles: ['OPR', 'NP'], withinWindow: false });
    await expect(requireShiftWindow()).resolves.toMatchObject({ userId: 'user-1' });
    expect(isWithinShiftWindow).not.toHaveBeenCalled();
  });

  it('skips shift window check for non-OPR role', async () => {
    const { requireShiftWindow, isWithinShiftWindow } = await setupMocks({ roles: ['NP'], withinWindow: false });
    await expect(requireShiftWindow()).resolves.toMatchObject({ userId: 'user-1' });
    expect(isWithinShiftWindow).not.toHaveBeenCalled();
  });
});

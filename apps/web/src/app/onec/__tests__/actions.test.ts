import { describe, it, expect, vi, beforeEach } from 'vitest';
import { markTaskProcessed, unmarkTaskProcessed } from '../actions';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

interface MockTx {
  taskForOneC: { update: ReturnType<typeof vi.fn> };
}

function buildDeps(task: Record<string, unknown> | null, status = 'PENDING') {
  const tx: MockTx = { taskForOneC: { update: vi.fn().mockResolvedValue(undefined) } };
  const writeAudit = vi.fn();
  const requirePermission = vi.fn().mockResolvedValue({
    userId: 'user-s1c',
    user: { roles: [{ role: { code: 'S1C' } }] },
  });
  const prisma = {
    taskForOneC: {
      findUnique: vi.fn().mockResolvedValue(
        task === null
          ? null
          : {
              id: 'task-1',
              type: 'PRODUCTION',
              sourceId: 'po-1',
              sourceType: 'PRODUCTION_ORDER',
              status,
              data: { taskType: 'PRODUCTION', output: [], consumption: [] },
              processedAt: null,
              processedById: null,
              lastChangedAt: new Date(),
              createdAt: new Date(),
              ...task,
            },
      ),
    },
    $transaction: vi.fn(async (cb: (tx: MockTx) => Promise<unknown>) => cb(tx)),
  };

  return {
    deps: {
      prisma: prisma as unknown as Parameters<typeof markTaskProcessed>[1]['prisma'],
      writeAudit,
      requirePermission,
    },
    tx,
    writeAudit,
    requirePermission,
  };
}

describe('markTaskProcessed (BR-4, UC-M12-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('требует право onec:process — отметку ставит только С1С', async () => {
    const { deps, requirePermission } = buildDeps({});
    await markTaskProcessed('task-1', deps);
    expect(requirePermission).toHaveBeenCalledWith('onec:process');
  });

  it('переводит задачу в «Обработано» и фиксирует автора отметки', async () => {
    const { deps, tx } = buildDeps({});

    await markTaskProcessed('task-1', deps);

    const update = tx.taskForOneC.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'task-1' });
    expect(update.data).toMatchObject({ status: 'PROCESSED', processedById: 'user-s1c' });
    expect(update.data.processedAt).toBeInstanceOf(Date);
  });

  it('пишет аудит смены статуса с атрибуцией по праву действия (Р-23)', async () => {
    const { deps, writeAudit } = buildDeps({});

    await markTaskProcessed('task-1', deps);

    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'UPDATE',
        objectType: 'TaskForOneC',
        objectId: 'task-1',
        field: 'status',
        oldValue: 'PENDING',
        newValue: 'PROCESSED',
        permission: 'onec:process',
      }),
    );
  });

  it('не даёт отметить уже обработанную задачу', async () => {
    const { deps } = buildDeps({}, 'PROCESSED');
    await expect(markTaskProcessed('task-1', deps)).rejects.toThrow(
      'Задача уже отмечена как обработанная',
    );
  });

  it('не даёт отметить несуществующую задачу', async () => {
    const { deps } = buildDeps(null);
    await expect(markTaskProcessed('missing', deps)).rejects.toThrow('Задача не найдена');
  });
});

describe('unmarkTaskProcessed (Р-17, BR-8, UC-M12-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('требует обязательную причину', async () => {
    const { deps, tx } = buildDeps({}, 'PROCESSED');

    await expect(unmarkTaskProcessed('task-1', { reason: '   ' }, deps)).rejects.toThrow(
      'Причина отмены обязательна (Р-17)',
    );
    expect(tx.taskForOneC.update).not.toHaveBeenCalled();
  });

  it('возвращает задачу в «Ожидает» и очищает отметку', async () => {
    const { deps, tx } = buildDeps({}, 'PROCESSED');

    await unmarkTaskProcessed('task-1', { reason: 'Документ создан ошибочно' }, deps);

    expect(tx.taskForOneC.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { status: 'PENDING', processedAt: null, processedById: null },
    });
  });

  it('фиксирует отмену и причину в аудите (Р-17)', async () => {
    const { deps, writeAudit } = buildDeps({}, 'PROCESSED');

    await unmarkTaskProcessed('task-1', { reason: 'Документ создан ошибочно' }, deps);

    const records = writeAudit.mock.calls.map((call) => call[1]);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      action: 'CANCEL',
      objectType: 'TaskForOneC',
      field: 'status',
      oldValue: 'PROCESSED',
      newValue: 'PENDING',
      permission: 'onec:process',
    });
    expect(records[1]).toMatchObject({
      action: 'CANCEL',
      field: 'reason',
      newValue: 'Документ создан ошибочно',
    });
  });

  it('не даёт отменить обработку задачи в статусе «Ожидает»', async () => {
    const { deps } = buildDeps({}, 'PENDING');
    await expect(
      unmarkTaskProcessed('task-1', { reason: 'причина' }, deps),
    ).rejects.toThrow('Задача не отмечена как обработанная');
  });
});

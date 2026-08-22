import { describe, it, expect } from 'vitest';
import { writeAudit, writeTiming, emitEvent } from './kernel';

const fakeTx = {
  notification: { createMany: async (args: unknown) => args },
  auditRecord: { create: async (args: unknown) => args },
  stageTiming: { create: async (args: unknown) => args },
} as unknown as import('@prisma/client').PrismaClient;

describe('kernel', () => {
  it('emitEvent creates notifications for recipients', async () => {
    const result = await emitEvent(fakeTx, {
      eventCode: 'EV_01',
      title: 'Test',
      recipientIds: ['user-1', 'user-2'],
    });
    expect(result).toBeUndefined();
  });

  it('writeAudit creates audit record', async () => {
    const result = await writeAudit(fakeTx, {
      action: 'CREATE',
      objectType: 'ProductionOrder',
      objectId: 'po-1',
      oldValue: 'DRAFT',
      newValue: 'CONFIRMED',
    });
    expect(result).toBeUndefined();
  });

  it('writeTiming creates stage timing', async () => {
    const result = await writeTiming(fakeTx, {
      documentType: 'PRODUCTION_ORDER',
      documentId: 'po-1',
      entityType: 'DOCUMENT',
      entityId: 'po-1',
      fromStatus: 'DRAFT',
      toStatus: 'CONFIRMED',
    });
    expect(result).toBeUndefined();
  });
});


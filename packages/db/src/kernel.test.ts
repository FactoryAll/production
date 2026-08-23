import { describe, it, expect } from 'vitest';
import { RoleCode } from '@prisma/client';
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

  it('writeAudit creates audit record with explicit role', async () => {
    const result = await writeAudit(fakeTx, {
      action: 'CREATE',
      objectType: 'ProductionOrder',
      objectId: 'po-1',
      oldValue: 'DRAFT',
      newValue: 'CONFIRMED',
      role: 'ADM',
    });
    expect(result).toBeUndefined();
  });

  it('writeAudit auto-attributes OPR for production_order:report with [NP, OPR]', async () => {
    const create = vi.fn(async (args: { data: { role: string } }) => args.data);
    const tx = { auditRecord: { create } } as unknown as typeof fakeTx;

    await writeAudit(tx, {
      action: 'CREATE',
      objectType: 'ProductionOrder',
      objectId: 'po-1',
      userId: 'user-1',
      userRoles: [RoleCode.NP, RoleCode.OPR],
      permission: 'production_order:report',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'OPR' }) }));
  });

  it('writeAudit auto-attributes NP for stock:read with [NP, OPR]', async () => {
    const create = vi.fn(async (args: { data: { role: string } }) => args.data);
    const tx = { auditRecord: { create } } as unknown as typeof fakeTx;

    await writeAudit(tx, {
      action: 'UPDATE',
      objectType: 'StockBalance',
      objectId: 'sb-1',
      userId: 'user-1',
      userRoles: [RoleCode.NP, RoleCode.OPR],
      permission: 'stock:read',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'NP' }) }));
  });

  it('writeAudit throws when no role has the permission', async () => {
    await expect(writeAudit(fakeTx, {
      action: 'CREATE',
      objectType: 'WorkCenter',
      objectId: 'wc-1',
      userId: 'user-1',
      userRoles: [RoleCode.OPR],
      permission: 'nsi:manage',
    })).rejects.toThrow('No role has permission nsi:manage');
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

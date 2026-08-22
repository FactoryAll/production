import type { Prisma, PrismaClient, EventCode, AuditAction, DocumentType, EntityType } from '@prisma/client';

export type TxClient = PrismaClient | Prisma.TransactionClient;

export interface EmitEventInput {
  eventCode: EventCode;
  title: string;
  body?: string;
  deepLink?: string;
  payload?: Record<string, unknown>;
  recipientIds: string[];
}

export async function emitEvent(tx: TxClient, input: EmitEventInput): Promise<void> {
  if (!input.recipientIds.length) return;
  await tx.notification.createMany({
    data: input.recipientIds.map((recipientId) => ({
      eventCode: input.eventCode,
      recipientId,
      title: input.title,
      body: input.body ?? null,
      deepLink: input.deepLink ?? null,
      payload: input.payload ? JSON.stringify(input.payload) : null,
    })),
  });
}

export interface WriteAuditInput {
  action: AuditAction;
  objectType: string;
  objectId: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  userId?: string;
  role?: string;
}

export async function writeAudit(tx: TxClient, input: WriteAuditInput): Promise<void> {
  await tx.auditRecord.create({
    data: {
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      field: input.field ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      userId: input.userId ?? null,
      role: input.role ?? null,
    },
  });
}

export interface WriteTimingInput {
  documentType: DocumentType;
  documentId: string;
  entityType: EntityType;
  entityId: string;
  fromStatus: string;
  toStatus: string;
  transitionedAt?: Date;
  initiatorRole?: string;
  initiatorId?: string;
}

export async function writeTiming(tx: TxClient, input: WriteTimingInput): Promise<void> {
  await tx.stageTiming.create({
    data: {
      documentType: input.documentType,
      documentId: input.documentId,
      entityType: input.entityType,
      entityId: input.entityId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      transitionedAt: input.transitionedAt ?? new Date(),
      initiatorRole: input.initiatorRole ?? null,
      initiatorId: input.initiatorId ?? null,
    },
  });
}


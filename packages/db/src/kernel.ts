import type { Prisma, PrismaClient, EventCode, AuditAction, DocumentType, EntityType, RoleCode } from '@prisma/client';
import { getAttributeRole, type PermissionCode } from '@prodtrack/contracts';

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
  /** @deprecated Pass userRoles and permission for automatic attribution. */
  role?: string;
  userRoles?: RoleCode[];
  permission?: PermissionCode;
}

export async function writeAudit(tx: TxClient, input: WriteAuditInput): Promise<void> {
  let role = input.role ?? null;

  if (input.userRoles && input.permission) {
    const attributedRole = getAttributeRole(input.userRoles, input.permission);
    if (!attributedRole) {
      throw new Error(`No role has permission ${input.permission}`);
    }
    role = attributedRole;
  }

  await tx.auditRecord.create({
    data: {
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      field: input.field ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      userId: input.userId ?? null,
      role,
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

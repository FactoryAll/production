import { describe, it, expect } from 'vitest';
import {
  ProductCategory,
  FactCategory,
  EventCode,
  TaskType,
  SubstitutionReason,
  ProductionOrderStatus,
  ProductionOrderLineStatus,
  TransferStatus,
  StockMovementType,
  WarehouseType,
  RoleCode,
  DocumentType,
  EntityType,
  TaskForOneCType,
  TaskForOneCStatus,
  AuditAction,
  EVENT_CODES,
  ALL_ROLES,
  STOCK_MOVEMENT_TYPES,
  WAREHOUSE_TYPES,
  DOCUMENT_TYPES,
  ENTITY_TYPES,
  TASK_FOR_ONE_C_TYPES,
  TASK_FOR_ONE_C_STATUSES,
  AUDIT_ACTIONS,
  isEventCode,
  isRoleCode,
  isStockMovementType,
  isWarehouseType,
  isDocumentType,
  isEntityType,
  isTaskForOneCType,
  isTaskForOneCStatus,
  isAuditAction,
  isProductCategory,
  isFactCategory,
} from './index';

describe('contracts enums', () => {
  it('ProductCategory has MASS and GP', () => {
    expect(ProductCategory.MASS).toBe('MASS');
    expect(ProductCategory.GP).toBe('GP');
  });

  it('FactCategory has MASS, GP and PF', () => {
    expect(FactCategory.MASS).toBe('MASS');
    expect(FactCategory.GP).toBe('GP');
    expect(FactCategory.PF).toBe('PF');
  });

  it('EventCode contains EV-01…EV-10', () => {
    expect(EventCode.EV_01).toBe('EV-01');
    expect(EventCode.EV_10).toBe('EV-10');
    expect(EVENT_CODES).toHaveLength(10);
    expect(EVENT_CODES).toContain('EV-05');
  });

  it('TaskType has PRODUCTION and TRANSFER', () => {
    expect(TaskType.PRODUCTION).toBe('PRODUCTION');
    expect(TaskType.TRANSFER).toBe('TRANSFER');
  });

  it('SubstitutionReason has preset values', () => {
    expect(SubstitutionReason.ILLNESS).toBe('ILLNESS');
    expect(SubstitutionReason.OTHER).toBe('OTHER');
  });

  it('ProductionOrderStatus matches Prisma native enum', () => {
    expect(ProductionOrderStatus.DRAFT).toBe('DRAFT');
    expect(ProductionOrderStatus.CONFIRMED).toBe('CONFIRMED');
    expect(ProductionOrderStatus.IN_PROGRESS).toBe('IN_PROGRESS');
    expect(ProductionOrderStatus.COMPLETED).toBe('COMPLETED');
    expect(ProductionOrderStatus.CANCELLED).toBe('CANCELLED');
  });

  it('ProductionOrderLineStatus matches Prisma native enum', () => {
    expect(ProductionOrderLineStatus.ASSIGNED).toBe('ASSIGNED');
    expect(ProductionOrderLineStatus.ACCEPTED).toBe('ACCEPTED');
    expect(ProductionOrderLineStatus.REPORTED).toBe('REPORTED');
  });

  it('TransferStatus matches Prisma native enum', () => {
    expect(TransferStatus.DRAFT).toBe('DRAFT');
    expect(TransferStatus.SUBMITTED).toBe('SUBMITTED');
    expect(TransferStatus.RECEIVED).toBe('RECEIVED');
    expect(TransferStatus.DISCREPANCY).toBe('DISCREPANCY');
    expect(TransferStatus.RECONCILED).toBe('RECONCILED');
    expect(TransferStatus.CANCELLED).toBe('CANCELLED');
  });

  it('StockMovementType matches Prisma native enum', () => {
    expect(StockMovementType.RECEIPT).toBe('RECEIPT');
    expect(StockMovementType.WRITE_OFF).toBe('WRITE_OFF');
    expect(StockMovementType.CONSUMPTION).toBe('CONSUMPTION');
    expect(StockMovementType.RETURN).toBe('RETURN');
    expect(STOCK_MOVEMENT_TYPES).toHaveLength(4);
  });

  it('WarehouseType matches Prisma native enum', () => {
    expect(WarehouseType.PRODUCTION).toBe('PRODUCTION');
    expect(WarehouseType.FINISHED_GOODS).toBe('FINISHED_GOODS');
    expect(WAREHOUSE_TYPES).toHaveLength(2);
  });

  it('RoleCode matches Prisma native enum', () => {
    expect(RoleCode.NP).toBe('NP');
    expect(RoleCode.OPR).toBe('OPR');
    expect(RoleCode.KSGP).toBe('KSGP');
    expect(RoleCode.USGP).toBe('USGP');
    expect(RoleCode.S1C).toBe('S1C');
    expect(RoleCode.ADM).toBe('ADM');
    expect(ALL_ROLES).toHaveLength(6);
  });

  it('DocumentType matches Prisma native enum', () => {
    expect(DocumentType.PRODUCTION_ORDER).toBe('PRODUCTION_ORDER');
    expect(DocumentType.GOODS_TRANSFER).toBe('GOODS_TRANSFER');
    expect(DOCUMENT_TYPES).toHaveLength(2);
  });

  it('EntityType matches Prisma native enum', () => {
    expect(EntityType.DOCUMENT).toBe('DOCUMENT');
    expect(EntityType.LINE).toBe('LINE');
    expect(ENTITY_TYPES).toHaveLength(2);
  });

  it('TaskForOneCType matches Prisma native enum', () => {
    expect(TaskForOneCType.PRODUCTION).toBe('PRODUCTION');
    expect(TaskForOneCType.TRANSFER).toBe('TRANSFER');
    expect(TASK_FOR_ONE_C_TYPES).toHaveLength(2);
  });

  it('TaskForOneCStatus matches Prisma native enum', () => {
    expect(TaskForOneCStatus.PENDING).toBe('PENDING');
    expect(TaskForOneCStatus.PROCESSED).toBe('PROCESSED');
    expect(TaskForOneCStatus.CANCELLED).toBe('CANCELLED');
    expect(TASK_FOR_ONE_C_STATUSES).toHaveLength(3);
  });

  it('AuditAction matches Prisma native enum', () => {
    expect(AuditAction.CREATE).toBe('CREATE');
    expect(AuditAction.UPDATE).toBe('UPDATE');
    expect(AuditAction.DELETE).toBe('DELETE');
    expect(AuditAction.LOGIN).toBe('LOGIN');
    expect(AuditAction.LOGOUT).toBe('LOGOUT');
    expect(AuditAction.CANCEL).toBe('CANCEL');
    expect(AUDIT_ACTIONS).toHaveLength(6);
  });

  it('type guards accept valid enum values', () => {
    expect(isEventCode('EV-01')).toBe(true);
    expect(isEventCode('EV-99')).toBe(false);
    expect(isRoleCode('ADM')).toBe(true);
    expect(isRoleCode('GUEST')).toBe(false);
    expect(isStockMovementType('CONSUMPTION')).toBe(true);
    expect(isStockMovementType('TRANSFER')).toBe(false);
    expect(isWarehouseType('PRODUCTION')).toBe(true);
    expect(isDocumentType('PRODUCTION_ORDER')).toBe(true);
    expect(isEntityType('LINE')).toBe(true);
    expect(isTaskForOneCType('TRANSFER')).toBe(true);
    expect(isTaskForOneCStatus('PENDING')).toBe(true);
    expect(isAuditAction('DELETE')).toBe(true);
  });

  it('type guards reject non-string values', () => {
    expect(isEventCode(null)).toBe(false);
    expect(isRoleCode(123)).toBe(false);
    expect(isStockMovementType(undefined)).toBe(false);
  });
});

describe('category type guards', () => {
  it('isProductCategory accepts MASS and GP', () => {
    expect(isProductCategory('MASS')).toBe(true);
    expect(isProductCategory('GP')).toBe(true);
    expect(isProductCategory('PF')).toBe(false);
  });

  it('isFactCategory accepts MASS, GP and PF', () => {
    expect(isFactCategory('MASS')).toBe(true);
    expect(isFactCategory('GP')).toBe(true);
    expect(isFactCategory('PF')).toBe(true);
    expect(isFactCategory('OTHER')).toBe(false);
  });
});
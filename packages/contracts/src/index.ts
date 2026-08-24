// Shared enums and constants for ProdTrack

export enum ProductCategory {
  MASS = 'MASS',
  GP = 'GP',
}

export enum FactCategory {
  MASS = 'MASS',
  GP = 'GP',
  PF = 'PF',
}

export enum StockCategory {
  MASS = 'MASS',
  PF = 'PF',
  GP = 'GP',
}

export enum TaskType {
  PRODUCTION = 'PRODUCTION',
  TRANSFER = 'TRANSFER',
}

export enum SubstitutionReason {
  ILLNESS = 'ILLNESS',
  NO_SHOW = 'NO_SHOW',
  LEFT_SHIFT = 'LEFT_SHIFT',
  OTHER = 'OTHER',
}

export enum ProductionOrderStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum ProductionOrderLineStatus {
  ASSIGNED = 'ASSIGNED',
  ACCEPTED = 'ACCEPTED',
  REPORTED = 'REPORTED',
}

export enum TransferStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  RECEIVED = 'RECEIVED',
  DISCREPANCY = 'DISCREPANCY',
  RECONCILED = 'RECONCILED',
  CANCELLED = 'CANCELLED',
}

export enum EventCode {
  EV_01 = 'EV-01',
  EV_02 = 'EV-02',
  EV_03 = 'EV-03',
  EV_04 = 'EV-04',
  EV_05 = 'EV-05',
  EV_06 = 'EV-06',
  EV_07 = 'EV-07',
  EV_08 = 'EV-08',
  EV_09 = 'EV-09',
  EV_10 = 'EV-10',
}

export enum StockMovementType {
  RECEIPT = 'RECEIPT',
  ISSUE = 'ISSUE',
  CONSUMPTION = 'CONSUMPTION',
  RETURN = 'RETURN',
}

export enum WarehouseType {
  PRODUCTION = 'PRODUCTION',
  FINISHED_GOODS = 'FINISHED_GOODS',
}

export enum RoleCode {
  NP = 'NP',
  OPR = 'OPR',
  KSGP = 'KSGP',
  USGP = 'USGP',
  S1C = 'S1C',
  ADM = 'ADM',
}

export enum DocumentType {
  PRODUCTION_ORDER = 'PRODUCTION_ORDER',
  GOODS_TRANSFER = 'GOODS_TRANSFER',
}

export enum EntityType {
  DOCUMENT = 'DOCUMENT',
  LINE = 'LINE',
}

export enum TaskForOneCType {
  PRODUCTION = 'PRODUCTION',
  TRANSFER = 'TRANSFER',
}

export enum TaskForOneCStatus {
  PENDING = 'PENDING',
  PROCESSED = 'PROCESSED',
  CANCELLED = 'CANCELLED',
}

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  CANCEL = 'CANCEL',
}

// Constants arrays derived from enums
export const EVENT_CODES = Object.values(EventCode);
export const ALL_ROLES = Object.values(RoleCode);
export const STOCK_MOVEMENT_TYPES = Object.values(StockMovementType);
export const WAREHOUSE_TYPES = Object.values(WarehouseType);
export const DOCUMENT_TYPES = Object.values(DocumentType);
export const ENTITY_TYPES = Object.values(EntityType);
export const TASK_FOR_ONE_C_TYPES = Object.values(TaskForOneCType);
export const TASK_FOR_ONE_C_STATUSES = Object.values(TaskForOneCStatus);
export const AUDIT_ACTIONS = Object.values(AuditAction);
export const PRODUCTION_ORDER_STATUSES = Object.values(ProductionOrderStatus);
export const PRODUCTION_ORDER_LINE_STATUSES = Object.values(ProductionOrderLineStatus);
export const TRANSFER_STATUSES = Object.values(TransferStatus);
export const PRODUCT_CATEGORIES = Object.values(ProductCategory);
export const FACT_CATEGORIES = Object.values(FactCategory);
export const STOCK_CATEGORIES = Object.values(StockCategory);
export const SUBSTITUTION_REASONS = Object.values(SubstitutionReason);
export const TASK_TYPES = Object.values(TaskType);

// Type aliases for enum value unions
export type ProductCategoryValue = `${ProductCategory}`;
export type FactCategoryValue = `${FactCategory}`;
export type StockCategoryValue = `${StockCategory}`;
export type TaskTypeValue = `${TaskType}`;
export type SubstitutionReasonValue = `${SubstitutionReason}`;
export type ProductionOrderStatusValue = `${ProductionOrderStatus}`;
export type ProductionOrderLineStatusValue = `${ProductionOrderLineStatus}`;
export type TransferStatusValue = `${TransferStatus}`;
export type EventCodeValue = `${EventCode}`;
export type StockMovementTypeValue = `${StockMovementType}`;
export type WarehouseTypeValue = `${WarehouseType}`;
export type RoleCodeValue = `${RoleCode}`;
export type DocumentTypeValue = `${DocumentType}`;
export type EntityTypeValue = `${EntityType}`;
export type TaskForOneCTypeValue = `${TaskForOneCType}`;
export type TaskForOneCStatusValue = `${TaskForOneCStatus}`;
export type AuditActionValue = `${AuditAction}`;

// Helper type guards
export function isEventCode(value: unknown): value is EventCode {
  return typeof value === 'string' && EVENT_CODES.includes(value as EventCode);
}

export function isRoleCode(value: unknown): value is RoleCode {
  return typeof value === 'string' && ALL_ROLES.includes(value as RoleCode);
}

export function isStockMovementType(value: unknown): value is StockMovementType {
  return typeof value === 'string' && STOCK_MOVEMENT_TYPES.includes(value as StockMovementType);
}

export function isWarehouseType(value: unknown): value is WarehouseType {
  return typeof value === 'string' && WAREHOUSE_TYPES.includes(value as WarehouseType);
}

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === 'string' && DOCUMENT_TYPES.includes(value as DocumentType);
}

export function isEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && ENTITY_TYPES.includes(value as EntityType);
}

export function isTaskForOneCType(value: unknown): value is TaskForOneCType {
  return typeof value === 'string' && TASK_FOR_ONE_C_TYPES.includes(value as TaskForOneCType);
}

export function isTaskForOneCStatus(value: unknown): value is TaskForOneCStatus {
  return typeof value === 'string' && TASK_FOR_ONE_C_STATUSES.includes(value as TaskForOneCStatus);
}

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === 'string' && AUDIT_ACTIONS.includes(value as AuditAction);
}

export function isProductionOrderStatus(value: unknown): value is ProductionOrderStatus {
  return typeof value === 'string' && PRODUCTION_ORDER_STATUSES.includes(value as ProductionOrderStatus);
}

export function isProductionOrderLineStatus(value: unknown): value is ProductionOrderLineStatus {
  return typeof value === 'string' && PRODUCTION_ORDER_LINE_STATUSES.includes(value as ProductionOrderLineStatus);
}

export function isTransferStatus(value: unknown): value is TransferStatus {
  return typeof value === 'string' && TRANSFER_STATUSES.includes(value as TransferStatus);
}
export function isProductCategory(value: unknown): value is ProductCategory {
  return typeof value === 'string' && PRODUCT_CATEGORIES.includes(value as ProductCategory);
}

export function isFactCategory(value: unknown): value is FactCategory {
  return typeof value === 'string' && FACT_CATEGORIES.includes(value as FactCategory);
}

export function isStockCategory(value: unknown): value is StockCategory {
  return typeof value === 'string' && STOCK_CATEGORIES.includes(value as StockCategory);
}
export * from './access';

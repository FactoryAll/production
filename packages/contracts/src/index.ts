// Shared enums and constants for ProdTrack

export enum ProductCategory {
  MASS = 'MASS',
  GP = 'GP'
}

export enum FactCategory {
  MASS = 'MASS',
  GP = 'GP',
  PF = 'PF'
}

export enum TaskType {
  PRODUCTION = 'PRODUCTION',
  TRANSFER = 'TRANSFER'
}

export enum SubstitutionReason {
  ILLNESS = 'ILLNESS',
  NO_SHOW = 'NO_SHOW',
  LEFT_SHIFT = 'LEFT_SHIFT',
  OTHER = 'OTHER'
}

export enum ProductionOrderStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export enum ProductionOrderLineStatus {
  ASSIGNED = 'ASSIGNED',
  ACCEPTED = 'ACCEPTED',
  REPORTED = 'REPORTED'
}

export enum TransferStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  RECEIVED = 'RECEIVED',
  DISCREPANCY = 'DISCREPANCY',
  RECONCILED = 'RECONCILED',
  CANCELLED = 'CANCELLED'
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
  EV_10 = 'EV-10'
}

export const EVENT_CODES = Object.values(EventCode);

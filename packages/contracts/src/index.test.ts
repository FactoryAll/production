import { describe, it, expect } from 'vitest';
import { ProductCategory, FactCategory, EventCode, TaskType, SubstitutionReason } from './index';

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
  });

  it('TaskType has PRODUCTION and TRANSFER', () => {
    expect(TaskType.PRODUCTION).toBe('PRODUCTION');
    expect(TaskType.TRANSFER).toBe('TRANSFER');
  });

  it('SubstitutionReason has preset values', () => {
    expect(SubstitutionReason.ILLNESS).toBe('ILLNESS');
    expect(SubstitutionReason.OTHER).toBe('OTHER');
  });
});
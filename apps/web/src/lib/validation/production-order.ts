import type { PrismaClient, WorkCenter, Product, Employee } from '@prisma/client';
import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ProductionOrderLineInput {
  workCenterId: string;
  productId: string;
  plannedQuantity: number | string;
  operatorId: string;
  workerIds?: string[];
}

export interface ProductionOrderInput {
  shiftId: string;
  lines: ProductionOrderLineInput[];
}

export async function validateProductionOrderLine(
  line: ProductionOrderLineInput,
  workCenter: WorkCenter,
  product: Product,
  operator: Employee,
): Promise<ValidationResult> {
  const errors: string[] = [];

  if (!workCenter.active) {
    errors.push('РЦ деактивирован');
  }
  if (!product.active) {
    errors.push('Номенклатура деактивирована');
  }
  if (!operator.active) {
    errors.push('Сотрудник деактивирован');
  }

  if (workCenter.producesMass && product.category !== 'MASS') {
    errors.push('Массу можно планировать только на РЦ 01/02');
  }
  if (!workCenter.producesMass && product.category !== 'GP') {
    errors.push('ГП можно планировать только на РЦ 03–12');
  }

  const quantity = typeof line.plannedQuantity === 'number' ? line.plannedQuantity : Number(line.plannedQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    errors.push('Плановое количество должно быть больше 0');
  }

  return { valid: errors.length === 0, errors };
}

export async function validateProductionOrder(
  input: ProductionOrderInput,
  prisma: PrismaClient,
): Promise<ValidationResult> {
  const errors: string[] = [];

  if (!input.lines.length) {
    errors.push('Добавьте хотя бы одну строку ПЗ');
  }

  const shift = await prisma.shift.findUnique({ where: { id: input.shiftId } });
  if (!shift) {
    errors.push('Смена не найдена');
  } else if (!shift.active) {
    errors.push('Смена деактивирована');
  }

  const workCenterIds = [...new Set(input.lines.map((line) => line.workCenterId).filter(Boolean))];
  const productIds = [...new Set(input.lines.map((line) => line.productId).filter(Boolean))];
  const operatorIds = [...new Set(input.lines.map((line) => line.operatorId).filter(Boolean))];

  const [workCenters, products, employees] = await Promise.all([
    prisma.workCenter.findMany({ where: { id: { in: workCenterIds } } }),
    prisma.product.findMany({ where: { id: { in: productIds } } }),
    prisma.employee.findMany({ where: { id: { in: operatorIds } } }),
  ]);

  const workCenterById = new Map(workCenters.map((wc) => [wc.id, wc]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const seenWorkCenters = new Set<string>();

  for (let i = 0; i < input.lines.length; i++) {
    const line = input.lines[i];
    const row = i + 1;

    if (!line.workCenterId || !line.productId || !line.operatorId) {
      errors.push('Заполните РЦ, номенклатуру, количество и Оператора (строка ' + row + ')');
      continue;
    }

    const workCenter = workCenterById.get(line.workCenterId);
    const product = productById.get(line.productId);
    const operator = employeeById.get(line.operatorId);

    if (!workCenter || !product || !operator) {
      errors.push('Заполните РЦ, номенклатуру, количество и Оператора (строка ' + row + ')');
      continue;
    }

    if (seenWorkCenters.has(workCenter.id)) {
      errors.push('РЦ может встречаться в ПЗ только один раз: ' + workCenter.name);
      continue;
    }
    seenWorkCenters.add(workCenter.id);

    const lineResult = await validateProductionOrderLine(line, workCenter, product, operator);
    for (const err of lineResult.errors) {
      errors.push(err + ' (строка ' + row + ')');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function parsePositiveDecimal(raw: unknown): Prisma.Decimal {
  const value = raw as Prisma.Decimal.Value;
  if (value instanceof Decimal) {
    if (value.lessThanOrEqualTo(0)) {
      throw new Error('Плановое количество должно быть больше 0');
    }
    return value;
  }

  const str = typeof value === 'string' ? value.trim() : String(value);
  if (!str) {
    throw new Error('Плановое количество должно быть больше 0');
  }

  const normalized = str.replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error('Плановое количество должно быть больше 0');
  }

  return new Decimal(num);
}

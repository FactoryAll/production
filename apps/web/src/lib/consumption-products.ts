import type { Product } from '@prisma/client';

/**
 * Что оператор может указать в поле «Потребление» при внесении итога.
 *
 * Правило владельца продукта (23.10.2026, ОПЭ-31): РЦ, который **не производит Массу**,
 * потребляет Массу как источник для своего производства (ГП и ПФ). Значит в списке ему
 * положена только Масса: предлагать ГП — значит разрешать списать со склада готовую
 * продукцию в качестве сырья.
 *
 * РЦ, который Массу производит (Реактор, Миксер), — источник, а не потребитель Массы;
 * его список оставляем полным (Масса + ГП), прежнее поведение.
 */
export function filterConsumableProducts<T extends Pick<Product, 'category'>>(
  products: T[],
  workCenterProducesMass: boolean,
): T[] {
  if (workCenterProducesMass) {
    return products;
  }
  return products.filter((product) => product.category === 'MASS');
}

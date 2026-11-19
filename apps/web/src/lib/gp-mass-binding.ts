/**
 * Привязки изделия: одна Масса и одна Туба на готовую продукцию (решение владельца 19.11.2026).
 *
 * Зачем отдельный модуль. Раньше оператор на ГП-строке мог выбрать **любую** Массу с остатком —
 * правило существовало только в голове и в спецификации 1С. Теперь у изделия есть привязка,
 * и она должна проверяться **везде, где пишется потребление**: в исполнении смены, в «Вводе
 * за Оператора» и в корректировке факта НП. Это тот же урок, что `ОПЭ-70/71` и `ОПЭ-83`:
 * правило, живущее в форме, обходится соседним путём ввода.
 *
 * Что здесь, а что нет:
 *   — здесь: какая Масса разрешена изделию, на каких РЦ это изделие фасуют, сколько Массы
 *     (или Тубы) идёт на единицу, и тексты отказов;
 *   — не здесь: склад и остатки (`stock-service`), категории РЦ (`consumable-stock`).
 *
 * Правило действует только для изделий **с** привязкой. Пустая привязка означает «как раньше»
 * (любая Масса) — иначе релиз остановил бы планирование 100+ позиций, у которых привязки ещё нет.
 */

export interface ProductBinding {
  /** Код готовой продукции. */
  code: string;
  /** Привязанная Масса: код и норма на единицу продукции (кг). */
  massCode?: string | null;
  massQuantity?: number | string | null;
  /** Привязанная Туба: код и норма на единицу продукции (шт). */
  tubeCode?: string | null;
  tubeQuantity?: number | string | null;
  /** Коды РЦ, на которых это изделие фасуют. Пусто — ограничения нет. */
  packagingWorkCenterCodes?: string[];
}

/** Норма как число; пустое или битое значение — `null`, а не `NaN` в расчёте. */
export function bindingQuantity(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Можно ли планировать изделие на этом РЦ.
 *
 * Пустой список фасовочных РЦ — «без ограничения» (решение владельца: список заполняется
 * постепенно, и до его заполнения система ведёт себя как раньше). РЦ Массы (01, 02) сюда
 * не относятся: там планируется Масса, а не готовая продукция.
 */
export function isPackagingWorkCenterAllowed(
  binding: Pick<ProductBinding, 'packagingWorkCenterCodes'> | undefined,
  workCenterCode: string,
): boolean {
  const allowed = binding?.packagingWorkCenterCodes ?? [];
  if (allowed.length === 0) return true;
  return allowed.includes(workCenterCode);
}

/**
 * Можно ли списать эту Массу на этой ГП.
 *
 * `null` — привязки нет, проверять нечего (действует старое правило «любая Масса с остатком»).
 * `false` — привязка есть и она другая.
 */
export function isMassAllowedForProduct(
  binding: Pick<ProductBinding, 'massCode'> | undefined,
  massProductCode: string,
): boolean | null {
  const bound = binding?.massCode ?? null;
  if (!bound) return null;
  return bound === massProductCode;
}

/** Текст отказа для обычного ввода: человек должен понять, что не так и что делать. */
export function massBindingViolationText(boundMassCode: string): string {
  return (
    `В потребление этой продукции идёт только Масса ${boundMassCode} — так записано в привязке изделия. ` +
    'Если нужна другая Масса, это оформляется через «Ввести за Оператора» с указанием причины'
  );
}

/**
 * Сколько Массы предположить к списанию: норма × количество выпуска.
 *
 * Округления не делаем: количество в системе целое (ОПЭ-32), и решение, округлять вверх
 * или вниз, принимает человек, а не скрипт. Возвращаем как есть — форма покажет число,
 * оператор его поправит или обнулит.
 */
export function suggestedMassQuantity(
  binding: Pick<ProductBinding, 'massQuantity'> | undefined,
  outputQuantity: number | string,
): number | null {
  const norm = bindingQuantity(binding?.massQuantity);
  const output = Number(outputQuantity);
  if (norm === null || !Number.isFinite(output) || output <= 0) return null;
  return norm * output;
}

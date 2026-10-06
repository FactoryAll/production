/**
 * Разбор формы «Корректировать факт» (M04, Р-18, T-073).
 *
 * Обычный модуль без 'use server': из файлов серверных действий синхронные хелперы
 * экспортировать нельзя (правило проекта, урок Фазы 4).
 */

export interface CorrectProductionFactInput {
  quantity: number;
  defectQuantity?: number;
  defectReasonId?: string;
  stopsDurationMinutes?: number;
  /**
   * Состав потребления (Р-10). Поле не передано — потребление не меняется;
   * пустой список — потребления у факта нет.
   */
  consumption?: { productId: string; quantity: number }[];
  correctionReason: string;
}

export function parseCorrectFactFormData(formData: FormData): CorrectProductionFactInput {
  const quantity = Number(formData.get('quantity'));
  const defectQuantityRaw = formData.get('defectQuantity');
  const stopRaw = formData.get('stopsDurationMinutes');
  const consumptionRaw = formData.get('consumption')?.toString();

  return {
    quantity,
    defectQuantity: defectQuantityRaw ? Number(defectQuantityRaw) : undefined,
    defectReasonId: (formData.get('defectReasonId') as string) || undefined,
    stopsDurationMinutes: stopRaw ? Number(stopRaw) : undefined,
    consumption: consumptionRaw ? JSON.parse(consumptionRaw) : undefined,
    correctionReason: formData.get('correctionReason') as string,
  };
}

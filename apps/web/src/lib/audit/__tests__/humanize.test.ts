import { describe, it, expect } from 'vitest';
import { auditKeyLabel, humanizeAuditValue, humanizeAuditObject } from '../humanize';

/**
 * Замечание владельца 14.11.2026: в журнале аудита лежал дамп вида
 *   transfer: {"id":"b35b2488-…","status":"DRAFT","sourceWarehouseId":"3096fa83-…",…}
 * и ценности в нём не было. Проверяем, что теперь значение читается человеком.
 */
describe('человекочитаемый аудит (14.11.2026)', () => {
  const names = {
    '3096fa83-8bf9-4442-a7a2-849ac943e958': 'Производственный склад',
    'a58413ef-16f4-4261-9533-ac6c6f4b5975': 'Склад ГП',
    '8244b342-b3ba-4e57-b9e4-188cd289c1ec': 'GECO Паста, 200 мл (шт)',
  };

  it('раскладывает payload перемещения по полям и заменяет идентификаторы названиями', () => {
    const raw = JSON.stringify({
      id: 'b35b2488-2809-49d4-be21-dfb9d2bcea66',
      status: 'DRAFT',
      sourceWarehouseId: '3096fa83-8bf9-4442-a7a2-849ac943e958',
      destinationWarehouseId: 'a58413ef-16f4-4261-9533-ac6c6f4b5975',
      lines: [{ productId: '8244b342-b3ba-4e57-b9e4-188cd289c1ec', plannedQuantity: 2592 }],
    });

    const text = humanizeAuditValue(raw, names);

    expect(text).not.toBeNull();
    expect(text).toContain('склад-источник: Производственный склад');
    expect(text).toContain('склад-получатель: Склад ГП');
    expect(text).toContain('номенклатура: GECO Паста, 200 мл (шт)');
    expect(text).toContain('количество по плану: 2592');
    // Статус читается по-русски, а не кодом.
    expect(text).toContain('статус: Черновик');
    // Ни одного сырого UUID в выводе.
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('неизвестный идентификатор показывает коротким кодом, а не целиком', () => {
    const text = humanizeAuditValue(JSON.stringify({ productId: 'deadbeef-1111-2222-3333-444455556666' }), {});
    expect(text).toBe('номенклатура: #deadbeef');
  });

  it('не-JSON значения не трогает: отдаёт null, экран печатает как есть', () => {
    expect(humanizeAuditValue('DRAFT', names)).toBeNull();
    expect(humanizeAuditValue(null, names)).toBeNull();
  });

  it('переводит ключи и вложенные объекты', () => {
    expect(auditKeyLabel('sourceWarehouseId')).toBe('склад-источник');
    expect(auditKeyLabel('неизвестныйКлюч')).toBe('неизвестныйКлюч');
    expect(humanizeAuditObject({ defectQuantity: 0 }, names)).toBe('брак: 0');
  });
});

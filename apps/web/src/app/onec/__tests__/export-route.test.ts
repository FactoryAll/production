import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/access', () => ({ requireAnyPermission: vi.fn() }));
vi.mock('@prodtrack/db', () => ({
  prisma: { taskForOneC: { findMany: vi.fn() } },
}));

import { requireAnyPermission } from '@/lib/auth/access';
import { prisma } from '@prodtrack/db';
import { ONE_C_EXPORT_LIMIT } from '../queries';
import { GET } from '../export/route';

const transferRecord = {
  id: 'task-1',
  type: 'TRANSFER',
  sourceId: 'tr-1',
  sourceType: 'GOODS_TRANSFER',
  status: 'PENDING',
  data: {
    taskType: 'TRANSFER',
    transferId: 'tr-1',
    status: 'SUBMITTED',
    sourceWarehouse: 'Производственный склад',
    destinationWarehouse: 'Склад ГП',
    submittedAt: null,
    lines: [
      {
        productCode: 'GP-001',
        productName: 'Крем',
        plannedQuantity: '100.00',
        actualQuantity: null,
        unit: 'шт',
      },
    ],
  },
  processedAt: null,
  processedById: null,
  lastChangedAt: new Date('2026-10-06T09:00:00.000Z'),
  createdAt: new Date('2026-10-06T09:00:00.000Z'),
};

describe('CSV-экспорт рабочего места 1С (T-053, Р-06, Р-24)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAnyPermission as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: 'user-s1c' });
    (prisma.taskForOneC.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([transferRecord]);
  });

  it('требует право onec:read и отдаёт 403 без него', async () => {
    (requireAnyPermission as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Forbidden'));

    const response = await GET(new Request('http://localhost/onec/export'));

    expect(response.status).toBe(403);
    expect(prisma.taskForOneC.findMany).not.toHaveBeenCalled();
  });

  it('отдаёт CSV-файл с реквизитами задач обоих типов', async () => {
    const response = await GET(new Request('http://localhost/onec/export'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toContain('attachment; filename="onec-tasks-');

    // Response.text() снимает BOM при UTF-8-декодировании, поэтому проверяем байты.
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const body = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(body.startsWith('\uFEFF')).toBe(true);
    expect(body).toContain('Тип;Документ;Статус');
    expect(body).toContain('Перемещение');
    expect(body).toContain('GP-001');
    expect(body).toContain('100.00');
  });

  it('учитывает фильтры списка и ограничивает объём выгрузки', async () => {
    await GET(new Request('http://localhost/onec/export?type=TRANSFER&status=PENDING'));

    expect(prisma.taskForOneC.findMany).toHaveBeenCalledWith({
      where: { type: 'TRANSFER', status: 'PENDING' },
      orderBy: [{ status: 'asc' }, { lastChangedAt: 'desc' }],
      take: ONE_C_EXPORT_LIMIT,
    });
  });

  it('неизвестные фильтры не сужают выгрузку', async () => {
    await GET(new Request('http://localhost/onec/export?type=UNKNOWN&status=UNKNOWN'));

    expect(prisma.taskForOneC.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});

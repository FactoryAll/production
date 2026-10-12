// Шаблон файла загрузки номенклатуры: отдаётся тем же кодом, что и разбирает файл,
// поэтому структура колонок в шаблоне и в парсере не может разойтись.

import { hasPermission } from '@prodtrack/contracts';
import { requireSession } from '@/lib/auth/session';
import { buildProductImportTemplate } from '@/lib/nsi-import/xlsx';

export const dynamic = 'force-dynamic';

const TEMPLATE_FILE_NAME = 'nomenclature-import-template.xlsx';

export async function GET() {
  const session = await requireSession();
  const roles = session.user.roles.map((ur) => ur.role.code);

  if (!hasPermission(roles, 'nsi:manage')) {
    return new Response('Доступ запрещён', { status: 403 });
  }

  const buffer = await buildProductImportTemplate();

  return new Response(buffer, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="' + TEMPLATE_FILE_NAME + '"',
      'Cache-Control': 'no-store',
    },
  });
}

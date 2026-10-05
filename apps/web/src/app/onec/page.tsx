export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { AccessDenied } from '@/components/access-denied';
import { Pagination } from '@/components/pagination';
import { checkPageAccess } from '@/lib/auth/page-guard';

import {
  formatTaskDateTime,
  oneCStatusLabel,
  oneCTypeLabel,
  taskDocumentLabel,
  taskSummary,
} from '@/lib/onec/labels';
import {
  getOneCTasksPage,
  parseOneCStatusFilter,
  parseOneCTypeFilter,
} from './queries';

interface OneCPageProps {
  searchParams: {
    type?: string;
    status?: string;
    page?: string;
  };
}

/**
 * Экран «Рабочее место 1С» (T-051, M12 §8, BR-7).
 *
 * Единый список задач TaskForOneC обоих типов (Р-24) с фильтром по типу и статусу,
 * колонкой «последнее изменение» (Р-18) и переходом в карточку задачи.
 * Доступ: право `onec:read` — С1С и АДМ (00 §4.2).
 */
export default async function OneCServerPage({ searchParams }: OneCPageProps) {
  const access = await checkPageAccess('onec:read');
  if (!access.allowed) {
    return (
      <AccessDenied
        action="рабочее место 1С"
        allowedRoles={['S1C', 'ADM']}
        requiredPermission="onec:read"
      />
    );
  }

  const filter = {
    type: parseOneCTypeFilter(searchParams.type),
    status: parseOneCStatusFilter(searchParams.status),
  };

  const result = await getOneCTasksPage(filter, searchParams.page);
  const tasks = result.items;

  // Экспорт отдаёт то же множество задач, что видно в списке (Р-06).
  const exportParams = new URLSearchParams();
  if (filter.type !== 'ALL') exportParams.set('type', filter.type);
  if (filter.status !== 'ALL') exportParams.set('status', filter.status);
  const exportHref = exportParams.toString() ? `/onec/export?${exportParams}` : '/onec/export';

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-graphite">Рабочее место 1С</h1>
        <p className="text-sm text-machine-gray">
          Подготовленные данные для ручного создания документов «Производство» и «Перемещение»
          (M12). Отметка «обработано» ставится вручную после создания документа в 1С.
          Данные «Перемещения» появляются, когда принимающая сторона подтвердила количество
          (приёмка без расхождений или согласование расхождения).
        </p>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-steel-graphite">
          Тип задачи
          <select
            name="type"
            defaultValue={filter.type}
            className="h-[var(--input-height)] rounded-md border border-mist-metal bg-white px-3 text-sm text-graphite"
          >
            <option value="ALL">Все типы</option>
            <option value="PRODUCTION">Производство</option>
            <option value="TRANSFER">Перемещение</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-steel-graphite">
          Статус
          <select
            name="status"
            defaultValue={filter.status}
            className="h-[var(--input-height)] rounded-md border border-mist-metal bg-white px-3 text-sm text-graphite"
          >
            <option value="ALL">Все статусы</option>
            <option value="PENDING">Ожидает</option>
            <option value="PROCESSED">Обработано</option>
          </select>
        </label>

        <button
          type="submit"
          className="h-[var(--button-height)] rounded-md bg-deep-industry-blue px-6 text-sm font-medium text-white"
        >
          Показать
        </button>

        <a
          href={exportHref}
          className="flex h-[var(--button-height)] items-center rounded-md border border-mist-metal bg-white px-6 text-sm font-medium text-graphite hover:bg-cold-white-gray"
        >
          Экспорт CSV
        </a>
      </form>

      {tasks.length === 0 ? (
        <p className="text-sm text-machine-gray">Задач нет.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-mist-metal text-left text-machine-gray">
              <th className="py-2 pr-4 font-medium">Тип</th>
              <th className="py-2 pr-4 font-medium">Документ</th>
              <th className="py-2 pr-4 font-medium">Данные</th>
              <th className="py-2 pr-4 font-medium">Статус</th>
              <th className="py-2 pr-4 font-medium">Последнее изменение</th>
              <th className="py-2 pr-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} className="border-b border-mist-metal/60">
                <td className="py-2 pr-4 text-graphite">{oneCTypeLabel(task.type)}</td>
                <td className="py-2 pr-4 text-graphite">{taskDocumentLabel(task.data)}</td>
                <td className="py-2 pr-4 text-steel-graphite">{taskSummary(task.data)}</td>
                <td className="py-2 pr-4">
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
                      task.status === 'PROCESSED'
                        ? 'bg-cold-white-gray text-machine-gray'
                        : 'bg-signal-amber text-graphite'
                    }`}
                  >
                    {oneCStatusLabel(task.status)}
                  </span>
                </td>
                <td className="py-2 pr-4 text-steel-graphite">
                  {formatTaskDateTime(task.lastChangedAt)}
                </td>
                <td className="py-2 pr-4">
                  <Link
                    href={`/onec/${task.id}`}
                    className="font-medium text-deep-industry-blue hover:underline"
                  >
                    Открыть
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Pagination
        pathname="/onec"
        searchParams={searchParams}
        page={result.page}
        hasNextPage={result.hasNextPage}
      />
    </main>
  );
}

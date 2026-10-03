export const dynamic = 'force-dynamic';

import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';

import { Pagination } from '@/components/pagination';

import ArchiveAuditButton from './_archive-button';
import { auditActionLabel, auditChangeLabel, auditObjectLabel, auditRoleLabel } from './labels';
import { getAuditPage, type AuditFilter } from './queries';

interface AuditPageProps {
  searchParams: {
    userId?: string;
    objectType?: string;
    objectId?: string;
    from?: string;
    to?: string;
    showArchived?: string;
    page?: string;
  };
}

/**
 * Экран «Аудит» M13 (T-047).
 *
 * Доступ: АДМ и НП (M13 §3, BR-3). Журнал append-only — экран только читает записи.
 * Архивные записи (Р-16) скрыты от всех, кроме АДМ; флаг «показать архив» доступен только АДМ.
 */
export default async function AuditServerPage({ searchParams }: AuditPageProps) {
  const access = await checkPageAccess('audit:read');
  if (!access.allowed) {
    return (
      <AccessDenied
        action="просмотр аудита"
        allowedRoles={['NP', 'ADM']}
        requiredPermission="audit:read"
      />
    );
  }

  const { roles } = access;
  // BR-6 (Р-16): архивные записи видит только АДМ.
  const canShowArchived = roles.includes('ADM');
  const showArchived = canShowArchived && searchParams.showArchived === 'on';

  const filter: AuditFilter = {
    userId: searchParams.userId?.trim() || undefined,
    objectType: searchParams.objectType?.trim() || undefined,
    objectId: searchParams.objectId?.trim() || undefined,
    from: searchParams.from?.trim() || undefined,
    to: searchParams.to?.trim() || undefined,
    showArchived,
  };

  const result = await getAuditPage(filter, canShowArchived, searchParams.page);
  const records = result.items;

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-graphite">Аудит</h1>
        <p className="text-sm text-machine-gray">
          Неизменяемый журнал значимых изменений и действий пользователей (M13).
          Архивные записи старше 12 месяцев скрыты (Р-16).
        </p>
        {canShowArchived && (
          <div className="mt-4">
            <ArchiveAuditButton />
          </div>
        )}
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-steel-graphite">
          Идентификатор пользователя
          <input
            type="text"
            name="userId"
            defaultValue={filter.userId ?? ''}
            className="h-[var(--input-height)] w-64 rounded-md border border-mist-metal bg-white px-3 text-sm text-graphite"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-steel-graphite">
          Тип объекта
          <input
            type="text"
            name="objectType"
            defaultValue={filter.objectType ?? ''}
            placeholder="например, ProductionOrder"
            className="h-[var(--input-height)] w-56 rounded-md border border-mist-metal bg-white px-3 text-sm text-graphite"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-steel-graphite">
          Идентификатор объекта
          <input
            type="text"
            name="objectId"
            defaultValue={filter.objectId ?? ''}
            className="h-[var(--input-height)] w-64 rounded-md border border-mist-metal bg-white px-3 text-sm text-graphite"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-steel-graphite">
          Период с
          <input
            type="date"
            name="from"
            defaultValue={filter.from ?? ''}
            className="h-[var(--input-height)] rounded-md border border-mist-metal bg-white px-3 text-sm text-graphite"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-steel-graphite">
          Период по
          <input
            type="date"
            name="to"
            defaultValue={filter.to ?? ''}
            className="h-[var(--input-height)] rounded-md border border-mist-metal bg-white px-3 text-sm text-graphite"
          />
        </label>

        {canShowArchived && (
          <label className="flex items-center gap-2 text-sm text-steel-graphite">
            <input
              type="checkbox"
              name="showArchived"
              defaultChecked={showArchived}
              className="h-4 w-4 rounded border-mist-metal"
            />
            Показать архив
          </label>
        )}

        <button
          type="submit"
          className="h-[var(--button-height)] rounded-md bg-deep-industry-blue px-6 text-sm font-medium text-white"
        >
          Показать
        </button>
      </form>

      {records.length === 0 ? (
        <p className="text-sm text-machine-gray">Записей нет.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-mist-metal text-left text-machine-gray">
              <th className="py-2 pr-4 font-medium">Время</th>
              <th className="py-2 pr-4 font-medium">Пользователь</th>
              <th className="py-2 pr-4 font-medium">Роль</th>
              <th className="py-2 pr-4 font-medium">Действие</th>
              <th className="py-2 pr-4 font-medium">Объект</th>
              <th className="py-2 pr-4 font-medium">Изменение</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id} className="border-b border-mist-metal/60">
                <td className="py-2 pr-4 text-steel-graphite">
                  {new Date(record.createdAt).toLocaleString('ru-RU')}
                </td>
                <td className="py-2 pr-4 text-graphite">{record.userLogin ?? '—'}</td>
                <td className="py-2 pr-4 text-steel-graphite">
                  {auditRoleLabel(record.role)}
                </td>
                <td className="py-2 pr-4 text-graphite">{auditActionLabel(record.action)}</td>
                <td className="py-2 pr-4 text-steel-graphite">
                  {auditObjectLabel(record.objectType)}
                  <span className="ml-1 font-mono text-xs text-machine-gray">
                    {record.objectId.slice(0, 8)}
                  </span>
                  {record.archived && (
                    <span className="ml-2 rounded-sm bg-cold-white-gray px-1 text-xs text-machine-gray">
                      архив
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4 text-steel-graphite">
                  {auditChangeLabel(record.field, record.oldValue, record.newValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Pagination
        pathname="/audit"
        searchParams={searchParams}
        page={result.page}
        hasNextPage={result.hasNextPage}
      />
    </main>
  );
}

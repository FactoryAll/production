export const dynamic = 'force-dynamic';

import { DocumentType } from '@prodtrack/contracts';
import { AccessDenied } from '@/components/access-denied';
import { Pagination } from '@/components/pagination';
import { checkPageAccess } from '@/lib/auth/page-guard';
import { formatDuration } from '@/lib/format';

import {
  documentTypeLabel,
  entityTypeLabel,
  initiatorLabel,
  transitionLabel,
} from './labels';
import {
  buildStageDurationGroups,
  getDocumentTimingRecords,
  getOwnDocumentIds,
  getTimingPage,
  type TimingFilter,
} from './queries';
import { timingScope } from './scope';

interface TimingPageProps {
  searchParams: {
    documentType?: string;
    documentId?: string;
    page?: string;
  };
}

const ALL_ROLES = ['NP', 'OPR', 'KSGP', 'USGP', 'S1C', 'ADM'];

/**
 * Экран «Хронометраж» M10 (T-046).
 *
 * Показывает записи переходов и длительности этапов по документу.
 * Область видимости: ОПР — только свои РЦ (M10 §3), остальные роли — весь хронометраж.
 */
export default async function TimingServerPage({ searchParams }: TimingPageProps) {
  const access = await checkPageAccess('timing:read');
  if (!access.allowed) {
    return (
      <AccessDenied
        action="просмотр хронометража"
        allowedRoles={ALL_ROLES}
        requiredPermission="timing:read"
      />
    );
  }

  const { session, roles } = access;
  const documentType =
    searchParams.documentType === DocumentType.PRODUCTION_ORDER ||
    searchParams.documentType === DocumentType.GOODS_TRANSFER
      ? (searchParams.documentType as DocumentType)
      : undefined;
  const documentId = searchParams.documentId?.trim() || undefined;

  const filter: TimingFilter = { documentType, documentId };

  if (timingScope(roles) === 'OWN_WORK_CENTER') {
    // ОПР видит только переходы по своим ПЗ (M10 §3).
    filter.documentIds = session.user.employeeId
      ? await getOwnDocumentIds(session.user.employeeId)
      : [];
    filter.documentType = DocumentType.PRODUCTION_ORDER;
  }

  const result = await getTimingPage(filter, searchParams.page);
  const records = result.items;

  // Длительности этапов показываем, когда выбран конкретный документ (M10 §8).
  //
  // Дефект №6 ручного тестирования v1.2.0: в фильтре пользователь вводит префикс
  // идентификатора (как он показан в таблице), а расчёт искал точное совпадение
  // с полным UUID — блок оставался пустым. Полный id и тип берём из найденных
  // записей: они уже отфильтрованы (и, для ОПР, ограничены своими РЦ).
  const matchedRecord = documentId
    ? records.find((record) => record.documentId.startsWith(documentId))
    : undefined;

  // Длительности считаем раздельно по сущностям: документ и каждая строка РЦ
  // (дефект №7: смешанная цепочка давала бессмысленные этапы).
  const stageGroups = matchedRecord
    ? buildStageDurationGroups(
        await getDocumentTimingRecords(
          matchedRecord.documentType,
          matchedRecord.documentId,
        ),
      )
    : [];

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-graphite">Хронометраж</h1>
        <p className="text-sm text-machine-gray">
          Время статусных переходов документов и длительности этапов (M10).
          {timingScope(roles) === 'OWN_WORK_CENTER' ? ' Показаны только ваши РЦ.' : ''}
        </p>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-steel-graphite">
          Тип документа
          <select
            name="documentType"
            defaultValue={documentType ?? ''}
            className="h-[var(--input-height)] rounded-md border border-mist-metal bg-white px-3 text-sm text-graphite"
          >
            <option value="">Все</option>
            <option value={DocumentType.PRODUCTION_ORDER}>ПЗ</option>
            <option value={DocumentType.GOODS_TRANSFER}>Перемещение</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-steel-graphite">
          Документ (id)
          <input
            type="text"
            name="documentId"
            defaultValue={documentId ?? ''}
            placeholder="идентификатор документа"
            className="h-[var(--input-height)] w-72 rounded-md border border-mist-metal bg-white px-3 text-sm text-graphite"
          />
        </label>

        <button
          type="submit"
          className="h-[var(--button-height)] rounded-md bg-deep-industry-blue px-6 text-sm font-medium text-white"
        >
          Показать
        </button>
      </form>

      {documentId && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-graphite">Длительность этапов</h2>
          {stageGroups.length === 0 ? (
            <p className="text-sm text-machine-gray">Записей по документу нет.</p>
          ) : (
            stageGroups.map((group) => (
            <div key={group.entityType + group.entityId} className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-steel-graphite">
                {group.entityType === 'DOCUMENT' ? 'Документ' : 'Строка РЦ'}
                {group.entityType === 'LINE' ? ' ' + group.entityId.slice(0, 8) : ''}
              </h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-mist-metal text-left text-machine-gray">
                  <th className="py-2 pr-4 font-medium">Этап</th>
                  <th className="py-2 pr-4 font-medium">Начало</th>
                  <th className="py-2 pr-4 font-medium">Окончание</th>
                  <th className="py-2 pr-4 font-medium">Длительность (чч:мм)</th>
                </tr>
              </thead>
              <tbody>
                {group.stages.map((stage, index) => (
                  <tr
                    key={stage.fromStatus + '-' + String(stage.toStatus) + '-' + String(index)}
                    className="border-b border-mist-metal/60"
                  >
                    <td className="py-2 pr-4 text-graphite">
                      {transitionLabel(stage.fromStatus, stage.toStatus)}
                      {stage.isCurrent ? ' (текущий)' : ''}
                    </td>
                    <td className="py-2 pr-4 text-steel-graphite">
                      {stage.startedAt
                        ? new Date(stage.startedAt).toLocaleString('ru-RU')
                        : '—'}
                    </td>
                    <td className="py-2 pr-4 text-steel-graphite">
                      {stage.endedAt ? new Date(stage.endedAt).toLocaleString('ru-RU') : '—'}
                    </td>
                    <td className="py-2 pr-4 text-graphite">
                      {stage.durationMs === null
                        ? '—'
                        : formatDuration(stage.durationMs / 60000)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            ))
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-graphite">Записи переходов</h2>
        {records.length === 0 ? (
          <p className="text-sm text-machine-gray">Записей нет.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-mist-metal text-left text-machine-gray">
                <th className="py-2 pr-4 font-medium">Время</th>
                <th className="py-2 pr-4 font-medium">Тип</th>
                <th className="py-2 pr-4 font-medium">Документ</th>
                <th className="py-2 pr-4 font-medium">Сущность</th>
                <th className="py-2 pr-4 font-medium">Переход</th>
                <th className="py-2 pr-4 font-medium">Инициатор</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="border-b border-mist-metal/60">
                  <td className="py-2 pr-4 text-steel-graphite">
                    {new Date(record.transitionedAt).toLocaleString('ru-RU')}
                  </td>
                  <td className="py-2 pr-4 text-steel-graphite">
                    {documentTypeLabel(record.documentType)}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-graphite">
                    {record.documentId.slice(0, 8)}
                  </td>
                  <td className="py-2 pr-4 text-steel-graphite">
                    {entityTypeLabel(record.entityType)}
                  </td>
                  <td className="py-2 pr-4 text-graphite">
                    {transitionLabel(record.fromStatus, record.toStatus)}
                  </td>
                  <td className="py-2 pr-4 text-steel-graphite">
                    {initiatorLabel(record.initiatorRole, record.initiatorId)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <Pagination
          pathname="/timing"
          searchParams={searchParams}
          page={result.page}
          hasNextPage={result.hasNextPage}
        />
      </section>
    </main>
  );
}

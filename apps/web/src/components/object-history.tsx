// Вкладка «История» в карточке объекта (M13 §8).
//
// Обычный модуль — ни 'use server', ни 'use client': список отрисовывается
// серверным компонентом, а презентационная часть вынесена и покрыта тестом.

import { Card } from '@prodtrack/ui';
import { auditActionLabel, auditChangeLabel, auditObjectLabel, auditRoleLabel } from '@/app/audit/labels';
import { getObjectHistory, type AuditRecordItem } from '@/app/audit/queries';

interface ObjectHistoryProps {
  objectType: string;
  objectId: string;
  /** АДМ видит и архивные записи (M13 BR-6, Р-16); остальным архив недоступен. */
  canShowArchived?: boolean;
}

/** Презентационная часть: список аудит-записей по объекту. */
export function ObjectHistoryList({ records }: { records: AuditRecordItem[] }) {
  if (records.length === 0) {
    return (
      <Card className="p-6 text-sm text-machine-gray">
        История изменений пуста.
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-mist-metal text-left text-machine-gray">
            <th className="px-4 py-2 font-medium">Время</th>
            <th className="px-4 py-2 font-medium">Пользователь</th>
            <th className="px-4 py-2 font-medium">Роль</th>
            <th className="px-4 py-2 font-medium">Действие</th>
            <th className="px-4 py-2 font-medium">Изменение</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id} className="border-b border-mist-metal/60">
              <td className="px-4 py-2 text-steel-graphite">
                {new Date(record.createdAt).toLocaleString('ru-RU')}
              </td>
              <td className="px-4 py-2 text-graphite">{record.userLogin ?? '—'}</td>
              <td className="px-4 py-2 text-steel-graphite">{auditRoleLabel(record.role)}</td>
              <td className="px-4 py-2 text-graphite">{auditActionLabel(record.action)}</td>
              <td className="px-4 py-2 text-steel-graphite">
                {auditChangeLabel(record.field, record.oldValue, record.newValue)}
                {record.archived && (
                  <span className="ml-2 rounded-sm bg-cold-white-gray px-1 text-xs text-machine-gray">
                    архив
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** Серверная часть: подгружает историю объекта и отдаёт её презентационному списку. */
export async function ObjectHistory({
  objectType,
  objectId,
  canShowArchived = false,
}: ObjectHistoryProps) {
  const records = await getObjectHistory(objectType, objectId, canShowArchived);

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold text-graphite">
        История изменений ({auditObjectLabel(objectType)})
      </h2>
      <ObjectHistoryList records={records} />
    </section>
  );
}

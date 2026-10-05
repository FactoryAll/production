export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { AccessDenied } from '@/components/access-denied';
import { checkPageAccess } from '@/lib/auth/page-guard';
import { hasPermission } from '@prodtrack/contracts';
import { transferStatusLabel } from '@/app/transfers/labels';

import TaskActions from './_task-actions';

import {
  factCategoryLabel,
  formatTaskDateTime,
  oneCStatusLabel,
  oneCTypeLabel,
  taskDocumentLabel,
} from '@/lib/onec/labels';
import { getOneCTaskById } from '../queries';

interface OneCTaskPageProps {
  params: { id: string };
}

/**
 * Карточка задачи для 1С (T-051, M12 §8, UC-M12-2).
 *
 * Показывает структурированные реквизиты для копирования в 1С: номенклатуру, количество
 * и потребление (Р-10) по документу «Производство» либо строки Перемещения. Экран только
 * читает данные; отметка «обработано» — T-052.
 */
export default async function OneCTaskServerPage({ params }: OneCTaskPageProps) {
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

  const detail = await getOneCTaskById(params.id);
  if (!detail) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-bold text-graphite">Задача не найдена</h1>
        <p className="mt-2 text-sm text-machine-gray">
          Задача удалена или ссылка устарела.
        </p>
        <Link href="/onec" className="mt-4 inline-block text-sm font-medium text-deep-industry-blue hover:underline">
          ← К списку задач
        </Link>
      </main>
    );
  }

  const { task, processedByLogin } = detail;
  const data = task.data;
  // BR-4: отметку «обработано» ставит только С1С (право onec:process).
  const canProcess = hasPermission(access.roles, 'onec:process');

  return (
    <main className="p-6">
      <div className="mb-6">
        <Link href="/onec" className="text-sm font-medium text-deep-industry-blue hover:underline">
          ← К списку задач
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-graphite">
          {oneCTypeLabel(task.type)}: {taskDocumentLabel(data)}
        </h1>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="text-machine-gray">Статус:</dt>
            <dd className="font-medium text-graphite">{oneCStatusLabel(task.status)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-machine-gray">Последнее изменение:</dt>
            <dd className="text-steel-graphite">{formatTaskDateTime(task.lastChangedAt)}</dd>
          </div>
          {task.processedAt && (
            <div className="flex gap-2">
              <dt className="text-machine-gray">Обработано:</dt>
              <dd className="text-steel-graphite">
                {formatTaskDateTime(task.processedAt)}
                {processedByLogin ? ` (${processedByLogin})` : ''}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {canProcess && (
        <div className="mb-6">
          <TaskActions taskId={task.id} status={task.status} />
        </div>
      )}

      {!canProcess && (
        <p className="mb-6 text-sm text-machine-gray">
          Отметку «обработано» ставит специалист 1С (роль С1С).
        </p>
      )}

      {!data && (
        <p className="text-sm text-signal-amber">
          Данные задачи не распознаны. Сообщите администратору системы.
        </p>
      )}

      {data?.taskType === 'PRODUCTION' && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-2 text-lg font-bold text-graphite">Выпуск (Масса и ГП, Р-10)</h2>
            {data.output.length === 0 ? (
              <p className="text-sm text-machine-gray">Выпуск не зафиксирован.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-mist-metal text-left text-machine-gray">
                    <th className="py-2 pr-4 font-medium">РЦ</th>
                    <th className="py-2 pr-4 font-medium">Номенклатура</th>
                    <th className="py-2 pr-4 font-medium">Категория</th>
                    <th className="py-2 pr-4 font-medium">Количество</th>
                    <th className="py-2 pr-4 font-medium">Ед.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.output.map((line) => (
                    <tr key={`${line.workCenterCode}|${line.productCode}|${line.category}`} className="border-b border-mist-metal/60">
                      <td className="py-2 pr-4 text-steel-graphite">{line.workCenterName}</td>
                      <td className="py-2 pr-4 text-graphite">
                        {line.productCode} — {line.productName}
                      </td>
                      <td className="py-2 pr-4 text-steel-graphite">{factCategoryLabel(line.category)}</td>
                      <td className="py-2 pr-4 font-medium text-graphite">{line.quantity}</td>
                      <td className="py-2 pr-4 text-steel-graphite">{line.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-lg font-bold text-graphite">Потребление Массы и ПФ (Р-10)</h2>
            {data.consumption.length === 0 ? (
              <p className="text-sm text-machine-gray">Потребление не зафиксировано.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-mist-metal text-left text-machine-gray">
                    <th className="py-2 pr-4 font-medium">РЦ</th>
                    <th className="py-2 pr-4 font-medium">Номенклатура</th>
                    <th className="py-2 pr-4 font-medium">Количество</th>
                    <th className="py-2 pr-4 font-medium">Ед.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.consumption.map((line) => (
                    <tr key={`${line.workCenterCode}|${line.productCode}`} className="border-b border-mist-metal/60">
                      <td className="py-2 pr-4 text-steel-graphite">{line.workCenterName}</td>
                      <td className="py-2 pr-4 text-graphite">
                        {line.productCode} — {line.productName}
                      </td>
                      <td className="py-2 pr-4 font-medium text-graphite">{line.quantity}</td>
                      <td className="py-2 pr-4 text-steel-graphite">{line.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {data?.taskType === 'TRANSFER' && (
        <section>
          <h2 className="mb-2 text-lg font-bold text-graphite">
            Перемещение: {data.sourceWarehouse} → {data.destinationWarehouse}
          </h2>
          <p className="mb-2 text-sm text-machine-gray">
            Статус Перемещения: {transferStatusLabel(data.status)}
            {data.submittedAt ? ` · отправлено ${formatTaskDateTime(data.submittedAt)}` : ''}
          </p>
          {data.lines.length === 0 ? (
            <p className="text-sm text-machine-gray">Строк нет.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-mist-metal text-left text-machine-gray">
                  <th className="py-2 pr-4 font-medium">Номенклатура</th>
                  <th className="py-2 pr-4 font-medium">Заявлено</th>
                  <th className="py-2 pr-4 font-medium">Фактически принято</th>
                  <th className="py-2 pr-4 font-medium">Ед.</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr key={line.productCode} className="border-b border-mist-metal/60">
                    <td className="py-2 pr-4 text-graphite">
                      {line.productCode} — {line.productName}
                    </td>
                    <td className="py-2 pr-4 font-medium text-graphite">{line.plannedQuantity}</td>
                    <td className="py-2 pr-4 text-steel-graphite">{line.actualQuantity ?? '—'}</td>
                    <td className="py-2 pr-4 text-steel-graphite">{line.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}

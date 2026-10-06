'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, Card } from '@prodtrack/ui';
import { formatDuration } from '@/lib/format';
import { documentTypeLabel, statusLabel } from '@/app/timing/labels';
import { formatAge, plural } from '@/lib/dashboard/aggregates';
import {
  DASHBOARD_PERIODS,
  DASHBOARD_PERIOD_LABELS,
  type DashboardPeriod,
} from '@/lib/dashboard/period';
import type { DashboardScope } from '@/lib/dashboard/scope';
import type { DashboardDocumentFilter } from '@/lib/dashboard/document-filter';
import type {
  DashboardDocumentRow,
  InProductionSummary,
  ReceivedTotals,
  TransferTotals,
} from '@/lib/dashboard/queries';
import type { CategoryTotals, StageDurationSummary } from '@/lib/dashboard/aggregates';
import { DOCUMENT_STATUS_OPTIONS, DOCUMENT_TYPE_OPTIONS } from './filters';

interface DashboardPageProps {
  /** Отпечаток состояния данных на момент рендера (M11 BR-2): с ним сравнивается кадр канала. */
  revision: string;
  period: DashboardPeriod;
  filter: DashboardDocumentFilter;
  scope: DashboardScope;
  inProduction: InProductionSummary;
  produced: CategoryTotals;
  transfers: TransferTotals;
  received: ReceivedTotals;
  durations: StageDurationSummary[];
  documents: DashboardDocumentRow[];
  /** Интервал опроса SSE-канала, мс (0 отключает подписку — используется в тестах). */
  refreshIntervalMs?: number;
}

const CATEGORY_LABELS: { key: keyof CategoryTotals; label: string; unit: string }[] = [
  { key: 'mass', label: 'Масса', unit: 'кг' },
  { key: 'pf', label: 'Полуфабрикат', unit: 'шт' },
  { key: 'gp', label: 'Готовая продукция', unit: 'шт' },
];

function formatQuantity(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function KpiCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="rounded-xl border border-mist-metal bg-graphite-surface p-5">
      <p className="mb-2 text-sm font-medium text-machine-gray">{title}</p>
      {children}
    </Card>
  );
}

function KpiValue({ value, unit }: { value: string; unit?: string }) {
  return (
    <p className="font-sans text-2xl font-bold text-signal-amber">
      {value}
      {unit ? <span className="ml-1 text-base font-medium text-graphite">{unit}</span> : null}
    </p>
  );
}

export default function DashboardPage({
  revision,
  period,
  filter,
  scope,
  inProduction,
  produced,
  transfers,
  received,
  durations,
  documents,
  refreshIntervalMs = 5000,
}: DashboardPageProps) {
  const router = useRouter();

  // Real-time (M11 BR-2, UC-M11-2): канал дашборда присылает отпечаток состояния данных.
  // Обновляем экран только когда он отличается от того, что был при рендере, — иначе
  // каждое подключение вызывало бы лишнюю перезагрузку данных.
  useEffect(() => {
    if (refreshIntervalMs <= 0 || typeof EventSource === 'undefined') {
      return undefined;
    }

    const source = new EventSource('/api/events/dashboard');
    source.onmessage = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { revision: string };
        if (payload.revision !== revision) {
          router.refresh();
        }
      } catch {
        // Некорректный кадр канала не должен ломать экран.
      }
    };
    source.onerror = () => {
      // Канал сам переподключится; падать не нужно.
    };

    return () => source.close();
  }, [refreshIntervalMs, revision, router]);

  const durationChart = durations.map((item) => ({
    stage: statusLabel(item.fromStatus) + ' → ' + statusLabel(item.toStatus),
    minutes: Math.round(item.averageMs / 60000),
  }));

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-graphite">Сводный дашборд</h1>
        {scope === 'OWN_WORK_CENTER' && (
          <p className="text-sm text-neutral-600">Показатели — в разрезе ваших РЦ (M11 §3).</p>
        )}
      </div>

      {/* Период виджетов (Р-08) и фильтры списка документов (M11 §8). */}
      <form method="get" action="/dashboard" className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="period" className="block text-sm font-medium text-graphite">
            Период
          </label>
          <select
            id="period"
            name="period"
            defaultValue={period}
            className="h-[var(--button-height-sm)] rounded-md border border-mist-metal bg-white px-3 font-sans text-graphite"
          >
            {DASHBOARD_PERIODS.map((value) => (
              <option key={value} value={value}>
                {DASHBOARD_PERIOD_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="type" className="block text-sm font-medium text-graphite">
            Тип документа
          </label>
          <select
            id="type"
            name="type"
            defaultValue={filter.type}
            className="h-[var(--button-height-sm)] rounded-md border border-mist-metal bg-white px-3 font-sans text-graphite"
          >
            {DOCUMENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="status" className="block text-sm font-medium text-graphite">
            Статус
          </label>
          <select
            id="status"
            name="status"
            defaultValue={filter.status}
            className="h-[var(--button-height-sm)] rounded-md border border-mist-metal bg-white px-3 font-sans text-graphite"
          >
            <option value="ALL">Все статусы</option>
            {DOCUMENT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Применить
        </Button>
      </form>

      {/* Ключевые показатели North Star (00 §1, M11 UC-M11-1). */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Производится (ПЗ текущей смены)">
          <KpiValue value={formatQuantity(inProduction.plannedMass)} unit="кг" />
          <p className="mt-1 text-sm text-graphite">{formatQuantity(inProduction.plannedGp)} шт ГП</p>
          <p className="mt-1 text-xs text-machine-gray">
            {inProduction.ordersCount} ПЗ, {inProduction.workCenterCount} РЦ
          </p>
        </KpiCard>

        <KpiCard title="Произведено за период">
          <KpiValue value={formatQuantity(produced.mass)} unit="кг" />
          <p className="mt-1 text-sm text-graphite">
            ПФ {formatQuantity(produced.pf)} шт · ГП {formatQuantity(produced.gp)} шт
          </p>
        </KpiCard>

        <KpiCard title="В перемещении (открытые)">
          <KpiValue value={formatQuantity(transfers.plannedQuantity)} unit="шт" />
          <p className="mt-1 text-xs text-machine-gray">
            {transfers.count} {plural(transfers.count, 'перемещение', 'перемещения', 'перемещений')}
          </p>
        </KpiCard>

        <KpiCard title="Принято на склад ГП за период">
          <KpiValue value={formatQuantity(received.quantity)} unit="шт" />
          <p className="mt-1 text-xs text-machine-gray">
            {received.count} {plural(received.count, 'приёмка', 'приёмки', 'приёмок')}
          </p>
        </KpiCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Р-08: статусы ПЗ текущей смены по РЦ. */}
        <Card className="rounded-xl border border-mist-metal bg-graphite-surface p-6">
          <h2 className="mb-4 font-sans text-lg font-semibold text-graphite">
            Статусы ПЗ текущей смены по РЦ
          </h2>
          {inProduction.lines.length === 0 ? (
            <p className="text-sm text-neutral-600">
              Нет ПЗ текущей смены в статусе «Подтверждено» или «В работе».
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-graphite-surface">
                  <tr>
                    <th className="border-b border-mist-metal px-3 py-2 font-bold text-graphite">РЦ</th>
                    <th className="border-b border-mist-metal px-3 py-2 font-bold text-graphite">Продукция</th>
                    <th className="border-b border-mist-metal px-3 py-2 font-bold text-graphite">План</th>
                    <th className="border-b border-mist-metal px-3 py-2 font-bold text-graphite">Статус строки</th>
                  </tr>
                </thead>
                <tbody>
                  {inProduction.lines.map((line) => (
                    <tr key={line.orderId + ':' + line.workCenterId} className="hover:bg-neutral-100">
                      <td className="border-b border-mist-metal px-3 py-2 text-graphite">
                        {line.workCenterCode} — {line.workCenterName}
                      </td>
                      <td className="border-b border-mist-metal px-3 py-2 text-graphite">
                        {line.productCode} — {line.productName}
                      </td>
                      <td className="border-b border-mist-metal px-3 py-2 text-graphite">
                        {formatQuantity(line.plannedQuantity)}
                      </td>
                      <td className="border-b border-mist-metal px-3 py-2 text-graphite">
                        {statusLabel(line.lineStatus)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Р-08: объёмы произведённого по категориям. */}
        <Card className="rounded-xl border border-mist-metal bg-graphite-surface p-6">
          <h2 className="mb-4 font-sans text-lg font-semibold text-graphite">
            Объёмы произведённого по категориям
          </h2>
          <table className="w-full text-left text-sm">
            <thead className="bg-graphite-surface">
              <tr>
                <th className="border-b border-mist-metal px-3 py-2 font-bold text-graphite">Категория</th>
                <th className="border-b border-mist-metal px-3 py-2 font-bold text-graphite">Количество</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORY_LABELS.map((category) => (
                <tr key={category.key} className="hover:bg-neutral-100">
                  <td className="border-b border-mist-metal px-3 py-2 text-graphite">{category.label}</td>
                  <td className="border-b border-mist-metal px-3 py-2 text-graphite">
                    {formatQuantity(produced[category.key])} {category.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Р-08: длительности этапов из хронометража M10. */}
      <Card className="rounded-xl border border-mist-metal bg-graphite-surface p-6">
        <h2 className="mb-4 font-sans text-lg font-semibold text-graphite">Длительности этапов</h2>
        {durations.length === 0 ? (
          <p className="text-sm text-neutral-600">За период переходов не зафиксировано.</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={durationChart} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-mist-metal)" />
                  <XAxis type="number" tick={{ fill: 'var(--color-graphite)' }} unit=" мин" />
                  <YAxis
                    type="category"
                    dataKey="stage"
                    width={200}
                    tick={{ fill: 'var(--color-graphite)', fontSize: 12 }}
                  />
                  <Tooltip formatter={(value) => [value + ' мин', 'Средняя']} />
                  <Bar dataKey="minutes" name="Средняя" fill="var(--color-deep-industry-blue)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-graphite-surface">
                  <tr>
                    <th className="border-b border-mist-metal px-3 py-2 font-bold text-graphite">Этап</th>
                    <th className="border-b border-mist-metal px-3 py-2 font-bold text-graphite">Переходов</th>
                    <th className="border-b border-mist-metal px-3 py-2 font-bold text-graphite">Средняя</th>
                    <th className="border-b border-mist-metal px-3 py-2 font-bold text-graphite">Максимум</th>
                  </tr>
                </thead>
                <tbody>
                  {durations.map((item) => (
                    <tr key={item.fromStatus + ':' + item.toStatus} className="hover:bg-neutral-100">
                      <td className="border-b border-mist-metal px-3 py-2 text-graphite">
                        {statusLabel(item.fromStatus)} → {statusLabel(item.toStatus)}
                      </td>
                      <td className="border-b border-mist-metal px-3 py-2 text-graphite">{item.count}</td>
                      <td className="border-b border-mist-metal px-3 py-2 text-graphite">
                        {formatDuration(item.averageMs / 60000)}
                      </td>
                      <td className="border-b border-mist-metal px-3 py-2 text-graphite">
                        {formatDuration(item.maxMs / 60000)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* M11 BR-1: все документы жизненного цикла со статусами и возрастом. */}
      <Card className="rounded-xl border border-mist-metal bg-graphite-surface p-6">
        <h2 className="mb-4 font-sans text-lg font-semibold text-graphite">
          Документы жизненного цикла
        </h2>
        {documents.length === 0 ? (
          <p className="text-sm text-neutral-600">По заданным условиям документов нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-graphite-surface">
                <tr>
                  <th className="border-b border-mist-metal px-3 py-2 font-bold text-graphite">Тип</th>
                  <th className="border-b border-mist-metal px-3 py-2 font-bold text-graphite">Документ</th>
                  <th className="border-b border-mist-metal px-3 py-2 font-bold text-graphite">Статус</th>
                  <th className="border-b border-mist-metal px-3 py-2 font-bold text-graphite">Возраст</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={document.type + ':' + document.id} className="hover:bg-neutral-100">
                    <td className="border-b border-mist-metal px-3 py-2 text-graphite">
                      {documentTypeLabel(document.type)}
                    </td>
                    <td className="border-b border-mist-metal px-3 py-2">
                      <a href={document.href} className="text-deep-industry-blue hover:underline">
                        {document.title}
                      </a>
                    </td>
                    <td className="border-b border-mist-metal px-3 py-2 text-graphite">
                      {statusLabel(document.status)}
                    </td>
                    <td className="border-b border-mist-metal px-3 py-2 text-graphite">
                      {formatAge(document.ageMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

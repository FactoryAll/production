'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import { Card } from '@prodtrack/ui';
import { formatDuration } from '@/lib/format';
import type { SerializableShiftReportData } from './page';
// TODO T-064: render own-only notice when data.canReadAll is false

// TODO T-060: include this screen in Phase 2 release checklist and manual QA.

interface ShiftReportClientPageProps {
  data: SerializableShiftReportData;
}

const CATEGORY_LABELS: Record<string, string> = {
  MASS: 'Масса',
  PF: 'Полуфабрикат',
  GP: 'Готовая продукция',
};

const CATEGORY_COLORS = {
  MASS: 'var(--color-deep-industry-blue)',
  PF: 'var(--color-signal-amber)',
  GP: 'var(--color-steel-graphite)',
};

const DEFECT_BAR_COLOR = 'var(--color-steel-graphite)';
const STOPS_BAR_COLOR = 'var(--color-machine-gray)';

const PALETTE = [
  'var(--color-deep-industry-blue)',
  'var(--color-signal-amber)',
  'var(--color-steel-graphite)',
  'var(--color-machine-gray)',
  'var(--color-mist-metal)',
];

function normalizeOutputStructure(outputStructure: SerializableShiftReportData['outputStructure']): Array<{
  category: 'MASS' | 'PF' | 'GP';
  productName: string;
  quantity: number;
  share: number;
}> {
  return (['MASS', 'PF', 'GP'] as const)
    .flatMap((category) =>
      outputStructure[category].map((item) => ({
        ...item,
        category,
        share: 0,
      })),
    )
    .map((item) => {
      const groupTotal = outputStructure[item.category].reduce((sum, i) => sum + i.quantity, 0);
      return {
        ...item,
        share: groupTotal > 0 ? Math.round((item.quantity / groupTotal) * 100) : 0,
      };
    });
}

export default function ShiftReportClientPage({ data }: ShiftReportClientPageProps) {
  const { order, planVsFact, outputStructure, defectsByReason, stopsByDuration, consumptionByProduct } = data;

  const normalizedOutput = useMemo(() => normalizeOutputStructure(outputStructure), [outputStructure]);

  const totalOutput = useMemo(
    () =>
      (['MASS', 'PF', 'GP'] as const).reduce(
        (sum, category) => sum + outputStructure[category].reduce((s, item) => s + item.quantity, 0),
        0,
      ),
    [outputStructure],
  );

  const totalStopsCount = useMemo(
    () => stopsByDuration.reduce((sum, item) => sum + item.count, 0),
    [stopsByDuration],
  );
  const totalStopsMinutes = useMemo(
    () => stopsByDuration.reduce((sum, item) => sum + item.totalMinutes, 0),
    [stopsByDuration],
  );

  const columns = useMemo<
    ColumnDef<{ productName: string; quantity: number; unit: string }>[]
  >(
    () => [
      {
        accessorKey: 'productName',
        header: 'Продукт',
      },
      {
        accessorKey: 'quantity',
        header: 'Количество',
        cell: ({ getValue }) => (getValue() as number).toLocaleString('ru-RU'),
      },
      {
        accessorKey: 'unit',
        header: 'ЕИ',
      },
    ],
    [],
  );

  const table = useReactTable({
    data: consumptionByProduct,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: {
      sorting: [{ id: 'quantity', desc: true }],
    },
  });

  function formatShiftDate(): string {
    const date = new Date(order.shift.date).toLocaleDateString('ru-RU');
    return `Смена ${order.shift.number} (${date}, ${order.shift.start}–${order.shift.end})`;
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-xl border border-mist-metal bg-graphite-surface p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <p className="text-sm text-neutral-500">Производственное задание</p>
            <p className="font-sans text-lg font-medium text-graphite">
              {order.id.slice(0, 8)}
            </p>
          </div>
          <div>
            <p className="text-sm text-neutral-500">Смена</p>
            <p className="font-sans text-lg font-medium text-graphite">{formatShiftDate()}</p>
          </div>
          <div>
            <p className="text-sm text-neutral-500">Статус</p>
            <p className="font-sans text-lg font-medium text-graphite">
              {order.status === 'COMPLETED' ? 'Завершено' : order.status}
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-xl border border-mist-metal bg-graphite-surface p-6">
          <h2 className="mb-4 font-sans text-lg font-semibold text-graphite">
            План/факт по РЦ
          </h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={planVsFact}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-mist-metal)" />
                <XAxis dataKey="workCenterCode" tick={{ fill: "var(--color-graphite)" }} />
                <YAxis tick={{ fill: "var(--color-graphite)" }} />
                <Tooltip
                  formatter={(value, name, props) => {
                    const item = props?.payload as (typeof planVsFact)[number];
                    if (name === 'Факт') {
                      const deviation = item.actual - item.planned;
                      return [
                        `${value} (откл. ${deviation > 0 ? '+' : ''}${deviation.toLocaleString('ru-RU')})`,
                        name,
                      ];
                    }
                    return [value, name];
                  }}
                  labelFormatter={(label) => `РЦ ${label}`}
                />
                <Legend />
                <Bar dataKey="planned" name="План" fill="var(--color-deep-industry-blue)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" name="Факт" fill="var(--color-signal-amber)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="rounded-xl border border-mist-metal bg-graphite-surface p-6">
          <h2 className="mb-4 font-sans text-lg font-semibold text-graphite">
            Структура выпуска
          </h2>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 16, right: 120, bottom: 16, left: 16 }}>
                <Pie
                  data={normalizedOutput}
                  dataKey="quantity"
                  nameKey="productName"
                  cx="40%"
                  cy="50%"
                  outerRadius={90}
                  labelLine
                  label={(entry) => {
                    const label = entry.productName as string;
                    const short = label.length > 14 ? label.slice(0, 13) + '…' : label;
                    return `${short}: ${entry.share}%`;
                  }}
                >
                  {normalizedOutput.map((entry, index) => (
                    <Cell
                      key={`${entry.category}-${entry.productName}`}
                      fill={PALETTE[index % PALETTE.length]}
                    />
                  ))}
                </Pie>
                <Legend
                  verticalAlign="middle"
                  align="right"
                  layout="vertical"
                  formatter={(value) => CATEGORY_LABELS[value as string] ?? value}
                />
                <Tooltip
                  formatter={(value, _name, props) => {
                    const item = props?.payload as { productName: string; category: string; share: number } | undefined;
                    return item ? [`${value} (${item.share}% выбранной категории)`, item.productName] : [value, ''];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="rounded-xl border border-mist-metal bg-graphite-surface p-6">
          <h2 className="mb-4 font-sans text-lg font-semibold text-graphite">
            Брак по причинам
          </h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={defectsByReason}
                layout="vertical"
                margin={{ left: 32 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-mist-metal)" />
                <XAxis type="number" tick={{ fill: "var(--color-graphite)" }} />
                <YAxis
                  type="category"
                  dataKey="reasonName"
                  tick={{ fill: "var(--color-graphite)", fontSize: 12 }}
                  width={120}
                />
                <Tooltip formatter={(value) => [value, 'Количество брака']} />
                <Bar
                  dataKey="quantity"
                  name="Брак"
                  fill={DEFECT_BAR_COLOR}
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="rounded-xl border border-mist-metal bg-graphite-surface p-6">
          <h2 className="mb-4 font-sans text-lg font-semibold text-graphite">
            Остановки по длительности
          </h2>
          <div className="mb-4 text-sm text-neutral-500">
            Всего: {totalStopsCount} остановок, {formatDuration(totalStopsMinutes)}
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stopsByDuration}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-mist-metal)" />
                <XAxis dataKey="durationRange" tick={{ fill: "var(--color-graphite)" }} />
                <YAxis tick={{ fill: "var(--color-graphite)" }} />
                <Tooltip
                  formatter={(value, name, props) => {
                    const item = props?.payload as (typeof stopsByDuration)[number];
                    if (name === 'Количество') {
                      return [`${value} (${formatDuration(item.totalMinutes)})`, name];
                    }
                    return [value, name];
                  }}
                />
                <Bar
                  dataKey="count"
                  name="Количество"
                  fill={STOPS_BAR_COLOR}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="rounded-xl border border-mist-metal bg-graphite-surface p-6">
        <h2 className="mb-4 font-sans text-lg font-semibold text-graphite">
          Потребление материалов
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-mist-metal">
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-4 py-3 text-left font-sans text-sm font-medium text-graphite"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-neutral-100 last:border-b-0">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-4 py-3 font-body text-sm text-graphite"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

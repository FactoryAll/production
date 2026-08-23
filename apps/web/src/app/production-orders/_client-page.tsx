'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { Button, Card } from '@prodtrack/ui';
import type { ProductionOrder, ProductionOrderLine, Shift, WorkCenter } from '@prisma/client';

interface ProductionOrdersPageProps {
  orders: Array<
    ProductionOrder & {
      shift: Shift;
      lines: Array<ProductionOrderLine & { workCenter: WorkCenter }>;
    }
  >;
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Черновик',
  CONFIRMED: 'Подтверждено',
  IN_PROGRESS: 'В работе',
  COMPLETED: 'Завершено',
  CANCELLED: 'Отменено',
};

function formatShift(shift: Shift): string {
  const date = new Date(shift.date).toLocaleDateString('ru-RU');
  return 'Смена ' + shift.number + ' (' + date + ', ' + shift.start + '–' + shift.end + ')';
}

export default function ProductionOrdersPage({ orders }: ProductionOrdersPageProps) {
  const columns = useMemo<
    ColumnDef<
      ProductionOrder & {
        shift: Shift;
        lines: Array<ProductionOrderLine & { workCenter: WorkCenter }>;
      },
      unknown
    >[]
  >(
    () => [
      {
        accessorKey: 'id',
        header: '№ ПЗ',
        cell: ({ getValue }) => (getValue() as string).slice(0, 8),
      },
      {
        id: 'shift',
        header: 'Смена',
        cell: ({ row }) => formatShift(row.original.shift),
      },
      {
        accessorKey: 'status',
        header: 'Статус',
        cell: ({ getValue }) => STATUS_LABELS[getValue() as string] ?? getValue(),
      },
      {
        accessorKey: 'createdAt',
        header: 'Дата создания',
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleString('ru-RU'),
      },
      {
        id: 'actions',
        header: 'Действия',
        cell: () => (
          <span className="text-neutral-500">Просмотр (T-025)</span>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: orders,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-graphite">Производственные задания</h1>
        <Link href="/production-orders/new">
          <Button variant="cta">Создать ПЗ</Button>
        </Link>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-base font-sans">
            <thead className="bg-graphite-surface">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="cursor-pointer select-none border-b border-mist-metal px-4 py-3 font-bold text-graphite"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        <span className="inline-block w-4">
                          {header.column.getIsSorted() === 'asc'
                            ? '↑'
                            : header.column.getIsSorted() === 'desc'
                              ? '↓'
                              : ''}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-neutral-100">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="border-b border-mist-metal px-4 py-3 text-graphite"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 && (
            <p className="px-4 py-8 text-center text-neutral-500">Нет производственных заданий. Создайте первое ПЗ.</p>
          )}
        </div>
      </Card>
    </div>
  );
}

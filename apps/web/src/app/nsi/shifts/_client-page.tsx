'use client';

import { useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { Card } from '@prodtrack/ui';
import { emptyListLabel, NsiListControls } from '@/components/nsi-list-controls';
import type { ShiftRow } from './queries';

interface ShiftsPageProps {
  shifts: ShiftRow[];
  /** Текущий поисковый запрос (применяется на сервере, M01 §8). */
  query: string;
  /** Текущий фильтр активности (применяется на сервере). */
  activeFilter: 'ALL' | 'ACTIVE' | 'INACTIVE';
}

function formatDate(date: Date): string {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Смены — только просмотр (T-075, решение владельца 06.10.2026).
 *
 * Запись смены создаётся автоматически при сохранении ПЗ: НП выбирает дату и номер,
 * поэтому создавать, править и деактивировать смены вручную больше не нужно.
 */
export default function ShiftsPage({ shifts, query, activeFilter }: ShiftsPageProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }]);

  const columns = useMemo<ColumnDef<ShiftRow, unknown>[]>(
    () => [
      {
        accessorKey: 'date',
        header: 'Дата',
        cell: ({ getValue }) => formatDate(getValue() as Date),
      },
      {
        accessorKey: 'number',
        header: 'Смена',
        cell: ({ getValue }) => `Смена ${getValue() as number}` ,
      },
      {
        accessorKey: 'start',
        header: 'Начало',
        cell: ({ getValue }) => getValue() as string,
      },
      {
        accessorKey: 'end',
        header: 'Окончание',
        cell: ({ getValue }) => getValue() as string,
      },
      {
        id: 'orders',
        header: 'ПЗ',
        cell: ({ row }) => row.original._count.orders,
      },
      {
        accessorKey: 'active',
        header: 'Статус',
        cell: ({ getValue }) => ((getValue() as boolean) ? 'Активна' : 'Неактивна'),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: shifts,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold text-graphite">Смены</h1>
      <p className="text-sm text-neutral-600">
        Смены создаются автоматически при сохранении ПЗ: НП выбирает дату и номер смены, запись заводится
        системой. Экран — только для просмотра (T-075).
      </p>

      <NsiListControls
        action="/nsi/shifts"
        query={query}
        activeFilter={activeFilter}
        placeholder="Поиск по дате (ГГГГ-ММ-ДД)"
      />

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
              {table.getRowModel().rows.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="border-b border-mist-metal px-4 py-6 text-center text-machine-gray"
                  >
                    {emptyListLabel(query, activeFilter)}
                  </td>
                </tr>
              )}
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
        </div>
      </Card>
    </div>
  );
}

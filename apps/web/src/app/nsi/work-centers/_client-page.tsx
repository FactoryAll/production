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
import { Button, Card } from '@prodtrack/ui';
import { emptyListLabel, NsiListControls } from '@/components/nsi-list-controls';
import { WorkCenterDialog } from './_components/work-center-dialog';
import { ToggleWorkCenterButton } from './_components/toggle-work-center-button';
import type { WorkCenter } from '@prisma/client';

interface WorkCentersPageProps {
  workCenters: WorkCenter[];
  canManage: boolean;
  /** Текущий поисковый запрос (применяется на сервере, M01 §8). */
  query: string;
  /** Текущий фильтр активности (применяется на сервере). */
  activeFilter: 'ALL' | 'ACTIVE' | 'INACTIVE';
}

export default function WorkCentersPage({
  workCenters,
  canManage,
  query,
  activeFilter,
}: WorkCentersPageProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'code', desc: false }]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WorkCenter | null>(null);

  const columns = useMemo<ColumnDef<WorkCenter, unknown>[]>(
    () => [
      {
        accessorKey: 'code',
        header: 'Код',
        cell: ({ getValue }) => getValue() as string,
      },
      {
        accessorKey: 'name',
        header: 'Наименование',
        cell: ({ row, getValue }) => {
          const wc = row.original;
          return (
            <span className={!wc.active ? 'opacity-60' : undefined}>
              {getValue() as string} {!wc.active && '(неактивно)'}
            </span>
          );
        },
      },
      {
        accessorKey: 'producesMass',
        header: 'Производит массу',
        cell: ({ getValue }) => ((getValue() as boolean) ? 'Да' : 'Нет'),
      },
      {
        accessorKey: 'active',
        header: 'Статус',
        cell: ({ getValue }) => ((getValue() as boolean) ? 'Активен' : 'Неактивен'),
      },
      {
        id: 'actions',
        header: 'Действия',
        cell: ({ row }) => {
          const wc = row.original;
          if (!canManage) {
            return null;
          }
          return (
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(wc);
                  setDialogOpen(true);
                }}
              >
                Редактировать
              </Button>
              <ToggleWorkCenterButton id={wc.id} active={wc.active} />
            </div>
          );
        },
      },
    ],
    [canManage],
  );

  const table = useReactTable({
    data: workCenters,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-graphite">Рабочие центры</h1>
        {canManage && (
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            Создать
          </Button>
        )}
      </div>

      <NsiListControls
        action="/nsi/work-centers"
        query={query}
        activeFilter={activeFilter}
        placeholder="Поиск по коду или названию"
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

      <WorkCenterDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        initial={editing}
      />
    </div>
  );
}
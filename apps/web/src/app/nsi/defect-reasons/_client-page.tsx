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
import { DefectReasonDialog } from './_components/defect-reason-dialog';
import { ToggleDefectReasonButton } from './_components/toggle-defect-reason-button';
import type { DefectReason } from '@prisma/client';

interface DefectReasonsPageProps {
  defectReasons: DefectReason[];
  canManage: boolean;
  /** Текущий поисковый запрос (применяется на сервере, M01 §8). */
  query: string;
  /** Текущий фильтр активности (применяется на сервере). */
  activeFilter: 'ALL' | 'ACTIVE' | 'INACTIVE';
}

export default function DefectReasonsPage({
  defectReasons,
  canManage,
  query,
  activeFilter,
}: DefectReasonsPageProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'code', desc: false }]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DefectReason | null>(null);

  const columns = useMemo<ColumnDef<DefectReason, unknown>[]>(
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
          const dr = row.original;
          return (
            <span className={!dr.active ? 'opacity-60' : undefined}>
              {getValue() as string} {!dr.active && '(неактивно)'}
            </span>
          );
        },
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
          const dr = row.original;
          if (!canManage) {
            return null;
          }
          return (
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(dr);
                  setDialogOpen(true);
                }}
              >
                Редактировать
              </Button>
              <ToggleDefectReasonButton id={dr.id} active={dr.active} />
            </div>
          );
        },
      },
    ],
    [canManage],
  );

  const table = useReactTable({
    data: defectReasons,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-graphite">Причины брака</h1>
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
        action="/nsi/defect-reasons"
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

      <DefectReasonDialog
        // Диалог смонтирован постоянно, поэтому состояние формы сбрасывается сменой ключа:
        // иначе поля остаются от предыдущего открытия (дефект, найденный на v2.0.0).
        key={editing?.id ?? 'new'}
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
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
import { Button, Card, Input } from '@prodtrack/ui';
import { WarehouseDialog } from './_components/warehouse-dialog';
import { ToggleWarehouseButton } from './_components/toggle-warehouse-button';
import type { Warehouse } from '@prisma/client';

interface WarehousesPageProps {
  warehouses: Warehouse[];
}

export default function WarehousesPage({ warehouses }: WarehousesPageProps) {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);

  const filtered = useMemo(() => {
    return warehouses.filter((w) => {
      const matchesSearch =
        w.name.toLowerCase().includes(search.toLowerCase()) ||
        (w.description ?? '').toLowerCase().includes(search.toLowerCase());
      const matchesActive =
        activeFilter === 'ALL'
          ? true
          : activeFilter === 'ACTIVE'
            ? w.active
            : !w.active;
      return matchesSearch && matchesActive;
    });
  }, [warehouses, search, activeFilter]);

  const columns = useMemo<ColumnDef<Warehouse, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Название',
        cell: ({ row, getValue }) => {
          const w = row.original;
          return (
            <span className={!w.active ? 'opacity-60' : undefined}>
              {getValue() as string} {!w.active && '(неактивно)'}
            </span>
          );
        },
      },
      {
        accessorKey: 'description',
        header: 'Описание',
        cell: ({ getValue }) => (getValue() as string | null) ?? '—',
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
          const w = row.original;
          return (
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(w);
                  setDialogOpen(true);
                }}
              >
                Редактировать
              </Button>
              <ToggleWarehouseButton id={w.id} active={w.active} />
            </div>
          );
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-graphite">Склады</h1>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <Input
          placeholder="Поиск по названию или описанию"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
          className="h-[var(--button-height-sm)] rounded-md border border-mist-metal bg-white px-3 font-sans text-graphite"
        >
          <option value="ALL">Все</option>
          <option value="ACTIVE">Активные</option>
          <option value="INACTIVE">Неактивные</option>
        </select>
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
        </div>
      </Card>

      {editing && (
        <WarehouseDialog
          open={dialogOpen}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
          initial={editing}
        />
      )}
    </div>
  );
}

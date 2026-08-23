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
import { ShiftDialog } from './_components/shift-dialog';
import { ToggleShiftButton } from './_components/toggle-shift-button';
import type { Shift } from '@prisma/client';

interface ShiftsPageProps {
  shifts: Shift[];
}

function formatDate(date: Date): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function ShiftsPage({ shifts }: ShiftsPageProps) {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'date', desc: true },
    { id: 'number', desc: false },
  ]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);

  const filtered = useMemo(() => {
    return shifts.filter((s) => {
      const matchesSearch = formatDate(s.date).includes(search);
      const matchesActive =
        activeFilter === 'ALL'
          ? true
          : activeFilter === 'ACTIVE'
            ? s.active
            : !s.active;
      return matchesSearch && matchesActive;
    });
  }, [shifts, search, activeFilter]);

  const columns = useMemo<ColumnDef<Shift, unknown>[]>(
    () => [
      {
        accessorKey: 'date',
        header: 'Дата',
        cell: ({ getValue }) => formatDate(getValue() as Date),
      },
      {
        accessorKey: 'number',
        header: 'Смена',
        cell: ({ getValue }) => `Смена ${getValue() as number}`,
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
        accessorKey: 'active',
        header: 'Статус',
        cell: ({ row, getValue }) => {
          const s = row.original;
          return (
            <span className={!s.active ? 'opacity-60' : undefined}>
              {(getValue() as boolean) ? 'Активна' : 'Неактивна'} {!s.active && '(неактивно)'}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: 'Действия',
        cell: ({ row }) => {
          const s = row.original;
          return (
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(s);
                  setDialogOpen(true);
                }}
              >
                Редактировать
              </Button>
              <ToggleShiftButton id={s.id} active={s.active} />
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
        <h1 className="text-2xl font-semibold text-graphite">Смены</h1>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          Создать
        </Button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <Input
          placeholder="Поиск по дате (ГГГГ-ММ-ДД)"
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

      <ShiftDialog
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

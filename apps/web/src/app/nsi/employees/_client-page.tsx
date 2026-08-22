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
import { EmployeeDialog } from './_components/employee-dialog';
import { ToggleEmployeeButton } from './_components/toggle-employee-button';
import type { Employee } from '@prisma/client';

interface EmployeesPageProps {
  employees: Employee[];
}

export default function EmployeesPage({ employees }: EmployeesPageProps) {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'tabNumber', desc: false }]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  const filtered = useMemo(() => {
    return employees.filter((e) => {
      const matchesSearch =
        e.fullName.toLowerCase().includes(search.toLowerCase()) ||
        e.tabNumber.toLowerCase().includes(search.toLowerCase());
      const matchesActive =
        activeFilter === 'ALL'
          ? true
          : activeFilter === 'ACTIVE'
            ? e.active
            : !e.active;
      return matchesSearch && matchesActive;
    });
  }, [employees, search, activeFilter]);

  const columns = useMemo<ColumnDef<Employee, unknown>[]>(
    () => [
      {
        accessorKey: 'tabNumber',
        header: 'Табельный номер',
        cell: ({ getValue }) => getValue() as string,
      },
      {
        accessorKey: 'fullName',
        header: 'ФИО',
        cell: ({ row, getValue }) => {
          const e = row.original;
          return (
            <span className={!e.active ? 'opacity-60' : undefined}>
              {getValue() as string} {!e.active && '(неактивно)'}
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
          const e = row.original;
          return (
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(e);
                  setDialogOpen(true);
                }}
              >
                Редактировать
              </Button>
              <ToggleEmployeeButton id={e.id} active={e.active} />
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
        <h1 className="text-2xl font-semibold text-graphite">Сотрудники</h1>
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
          placeholder="Поиск по ФИО или табельному номеру"
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

      <EmployeeDialog
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

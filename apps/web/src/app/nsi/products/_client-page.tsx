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
import { ProductDialog } from './_components/product-dialog';
import { ToggleProductButton } from './_components/toggle-product-button';
import type { Product } from '@prisma/client';

interface ProductsPageProps {
  products: Product[];
  canManage: boolean;
  /** Текущий поисковый запрос (применяется на сервере, M01 §8). */
  query: string;
  /** Текущий фильтр активности (применяется на сервере). */
  activeFilter: 'ALL' | 'ACTIVE' | 'INACTIVE';
}

export default function ProductsPage({
  products,
  canManage,
  query,
  activeFilter,
}: ProductsPageProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'code', desc: false }]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const columns = useMemo<ColumnDef<Product, unknown>[]>(
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
          const p = row.original;
          return (
            <span className={!p.active ? 'opacity-60' : undefined}>
              {getValue() as string} {!p.active && '(неактивно)'}
            </span>
          );
        },
      },
      {
        accessorKey: 'category',
        header: 'Категория',
        cell: ({ getValue }) => {
          const val = getValue() as string;
          return val === 'MASS' ? 'Масса' : val === 'GP' ? 'ГП' : val;
        },
      },
      {
        accessorKey: 'unit',
        header: 'ЕИ',
        cell: ({ getValue }) => getValue() as string,
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
          const p = row.original;
          if (!canManage) {
            return null;
          }
          return (
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(p);
                  setDialogOpen(true);
                }}
              >
                Редактировать
              </Button>
              <ToggleProductButton id={p.id} active={p.active} />
            </div>
          );
        },
      },
    ],
    [canManage],
  );

  const table = useReactTable({
    data: products,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-graphite">Номенклатура</h1>
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

      {/* Поиск и фильтр применяются на сервере (T-058), поэтому форма отправляет GET-запрос. */}
      <form method="get" action="/nsi/products" className="flex flex-col gap-4 sm:flex-row">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Поиск по коду или наименованию"
          className="max-w-sm"
        />
        <select
          name="active"
          defaultValue={activeFilter}
          className="h-[var(--button-height-sm)] rounded-md border border-mist-metal bg-white px-3 font-sans text-graphite"
        >
          <option value="ALL">Все</option>
          <option value="ACTIVE">Активные</option>
          <option value="INACTIVE">Неактивные</option>
        </select>
        <Button type="submit" variant="secondary">
          Найти
        </Button>
      </form>

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
                    {query || activeFilter !== 'ALL'
                      ? 'По заданным условиям ничего не найдено.'
                      : 'Список пуст.'}
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

      <ProductDialog
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

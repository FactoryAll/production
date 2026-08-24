'use client';

import { useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import { Card, Input } from '@prodtrack/ui';
import type { StockBalanceRow } from '@/lib/stock-service';
import type { StockCategory, WarehouseType } from '@prisma/client';

function categoryLabel(category: StockCategory): string {
  switch (category) {
    case 'MASS':
      return 'Масса';
    case 'PF':
      return 'ПФ';
    case 'GP':
      return 'ГП';
    default:
      return category;
  }
}

function warehouseLabel(type: WarehouseType): string {
  return type === 'PRODUCTION' ? 'Производственный склад' : 'Склад ГП';
}

interface StockTableProps {
  balances: StockBalanceRow[];
}

export function StockTable({ balances }: StockTableProps) {
  const [activeTab, setActiveTab] = useState<WarehouseType>('PRODUCTION');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | StockCategory>('ALL');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return balances.filter((row) => {
      const matchesWarehouse = row.warehouse.type === activeTab;
      const matchesCategory = categoryFilter === 'ALL' || row.stockCategory === categoryFilter;
      const matchesSearch =
        q === '' ||
        row.product.code.toLowerCase().includes(q) ||
        row.product.name.toLowerCase().includes(q);
      return matchesWarehouse && matchesCategory && matchesSearch;
    });
  }, [balances, activeTab, categoryFilter, search]);

  const columns = useMemo<ColumnDef<StockBalanceRow>[]>(
    () => [
      {
        accessorFn: (row) => row.product.code,
        id: 'code',
        header: 'Код',
      },
      {
        accessorFn: (row) => row.product.name,
        id: 'name',
        header: 'Наименование',
      },
      {
        accessorFn: (row) => row.stockCategory,
        id: 'category',
        header: 'Категория',
        cell: ({ getValue }) => categoryLabel(getValue() as StockCategory),
      },
      {
        accessorFn: (row) => row.product.unit,
        id: 'unit',
        header: 'ЕИ',
      },
      {
        accessorFn: (row) => row.quantity,
        id: 'quantity',
        header: 'Остаток',
        cell: ({ getValue }) => {
          const value = Number(getValue());
          const negative = value < 0;
          return (
            <span className={negative ? 'text-[var(--color-signal-amber)] font-medium' : undefined}>
              {value.toFixed(2)}
            </span>
          );
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const tabs: WarehouseType[] = ['PRODUCTION', 'FINISHED_GOODS'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setActiveTab(type)}
            className={[
              'rounded-md px-4 py-2 text-sm font-medium transition-colors',
              activeTab === type
                ? 'bg-deep-industry-blue text-white'
                : 'bg-white text-graphite hover:bg-neutral-100 border border-mist-metal',
            ].join(' ')}
          >
            {warehouseLabel(type)}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <Input
          placeholder="Поиск по коду или наименованию"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as 'ALL' | StockCategory)}
          className="h-[var(--button-height-sm)] rounded-md border border-mist-metal bg-white px-3 font-sans text-graphite"
        >
          <option value="ALL">Все категории</option>
          <option value="MASS">Масса</option>
          <option value="PF">ПФ</option>
          <option value="GP">ГП</option>
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
                      className="border-b border-mist-metal px-4 py-3 font-bold text-graphite"
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
              {table.getRowModel().rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-6 text-center text-neutral-500">
                    Остатки не найдены
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

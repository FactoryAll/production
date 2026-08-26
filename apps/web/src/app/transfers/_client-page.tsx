'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import { Button, Card } from '@prodtrack/ui';
import { hasPermission } from '@prodtrack/contracts';
import type { GoodsTransfer, TransferLine, Warehouse, Product } from '@prisma/client';
import { transferStatusLabel, submitGoodsTransferAction } from './actions';

interface TransferWithLines extends GoodsTransfer {
  sourceWarehouse: Warehouse;
  destinationWarehouse: Warehouse;
  lines: Array<TransferLine & { product: Product }>;
}

interface TransfersPageProps {
  transfers: TransferWithLines[];
  userRoles: string[];
}

const STATUS_FILTERS: Array<{ value: GoodsTransfer['status'] | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Все' },
  { value: 'DRAFT', label: 'Черновик' },
  { value: 'SUBMITTED', label: 'Отправлено' },
  { value: 'RECEIVED', label: 'Принято' },
  { value: 'DISCREPANCY', label: 'Расхождение' },
  { value: 'RECONCILED', label: 'Согласовано' },
  { value: 'CANCELLED', label: 'Отменено' },
];

export default function TransfersPage({ transfers, userRoles }: TransfersPageProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [statusFilter, setStatusFilter] = useState<GoodsTransfer['status'] | 'ALL'>('ALL');
  const [submitTransferId, setSubmitTransferId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canCreate = hasPermission(userRoles, 'transfer:create');
  const canUpdate = hasPermission(userRoles, 'transfer:update');

  const filteredTransfers = useMemo(() => {
    if (statusFilter === 'ALL') return transfers;
    return transfers.filter((t) => t.status === statusFilter);
  }, [transfers, statusFilter]);

  function handleSubmit(transferId: string) {
    setSubmitError(null);
    startTransition(async () => {
      const result = await submitGoodsTransferAction(transferId);
      setSubmitTransferId(null);
      if (result.success) {
        router.refresh();
      } else {
        setSubmitError(result.error ?? 'Не удалось отправить перемещение');
      }
    });
  }

  const columns = useMemo<ColumnDef<TransferWithLines>[]>(
    () => [
      {
        accessorKey: 'id',
        header: '№ Перемещения',
        cell: ({ getValue }) => (getValue() as string).slice(0, 8),
      },
      {
        id: 'source',
        header: 'Склад-источник',
        cell: ({ row }) => row.original.sourceWarehouse.name,
      },
      {
        id: 'destination',
        header: 'Склад-приёмник',
        cell: ({ row }) => row.original.destinationWarehouse.name,
      },
      {
        accessorKey: 'status',
        header: 'Статус',
        cell: ({ row }) => transferStatusLabel(row.original.status),
      },
      {
        accessorKey: 'createdAt',
        header: 'Дата создания',
        cell: ({ getValue }) => new Date(getValue() as string).toLocaleString('ru-RU'),
      },
      {
        id: 'actions',
        header: 'Действия',
        cell: ({ row }) => {
          const isDraft = row.original.status === 'DRAFT';
          return (
            <div className="flex items-center gap-2">
              {isDraft && canUpdate && (
                <Button
                  variant="cta"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSubmitTransferId(row.original.id);
                    setSubmitError(null);
                  }}
                  disabled={isPending}
                >
                  Отправить
                </Button>
              )}
              {isDraft && canCreate && (
                <Link href={`/transfers/${row.original.id}/edit`}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={(e) => e.stopPropagation()}
                    disabled={isPending}
                  >
                    Редактировать
                  </Button>
                </Link>
              )}
              <Link href={`/transfers/${row.original.id}`}>
                <Button variant="secondary" size="sm" onClick={(e) => e.stopPropagation()} disabled={isPending}>
                  Открыть
                </Button>
              </Link>
            </div>
          );
        },
      },
    ],
    [canCreate, canUpdate, isPending],
  );

  const table = useReactTable({
    data: filteredTransfers,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const selectedTransfer = submitTransferId
    ? transfers.find((t) => t.id === submitTransferId) ?? null
    : null;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-graphite">Перемещения</h1>
        {canCreate && (
          <Link href="/transfers/new">
            <Button variant="cta">Создать перемещение</Button>
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setStatusFilter(filter.value)}
            className={[
              'rounded-md px-4 py-2 text-sm font-medium transition-colors',
              statusFilter === filter.value
                ? 'bg-deep-industry-blue text-white'
                : 'bg-white text-graphite hover:bg-neutral-100 border border-mist-metal',
            ].join(' ')}
          >
            {filter.label}
          </button>
        ))}
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
                <tr
                  key={row.id}
                  className="hover:bg-neutral-100 cursor-pointer"
                  onClick={() => router.push(`/transfers/${row.original.id}`)}
                >
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
              {filteredTransfers.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-8 text-center text-neutral-500">
                    Нет перемещений. Создайте первое перемещение.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {selectedTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-md border border-mist-metal bg-graphite-surface p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-bold text-graphite">Отправить перемещение?</h3>
            <p className="text-graphite">
              Остатки ГП будут списаны с Производственного склада. КСГП получит уведомление о приёмке.
            </p>
            {submitError && <p className="mt-2 text-sm text-signal-amber">{submitError}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setSubmitTransferId(null);
                  setSubmitError(null);
                }}
                disabled={isPending}
              >
                Отмена
              </Button>
              <Button
                variant="cta"
                onClick={() => selectedTransfer && handleSubmit(selectedTransfer.id)}
                disabled={isPending}
              >
                {isPending ? 'Отправка...' : 'Отправить'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

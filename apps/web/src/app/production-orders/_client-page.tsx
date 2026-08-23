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
import { Button, Card, Dialog } from '@prodtrack/ui';
import { hasPermission } from '@prodtrack/contracts';
import type { ProductionOrder, ProductionOrderLine, Shift, WorkCenter } from '@prisma/client';
import { confirmProductionOrderAction } from './actions';

interface ProductionOrdersPageProps {
  orders: Array<
    ProductionOrder & {
      shift: Shift;
      lines: Array<ProductionOrderLine & { workCenter: WorkCenter }>;
    }
  >;
  userRoles: string[];
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

export default function ProductionOrdersPage({ orders, userRoles }: ProductionOrdersPageProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOrderId, setConfirmOrderId] = useState<string | null>(null);
  const canConfirm = hasPermission(userRoles, 'production_order:confirm');

  function handleConfirm(orderId: string) {
    startTransition(async () => {
      const result = await confirmProductionOrderAction(orderId);
      setConfirmOrderId(null);
      if (result.success) {
        router.refresh();
      }
    });
  }
  const columns = useMemo<
    ColumnDef<
      ProductionOrder & {
        shift: Shift;
        lines: Array<ProductionOrderLine & { workCenter: WorkCenter }>;
      },
      unknown
    >[]
  >(
    () => {
      const canConfirmDraft = canConfirm;
      return [
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
        cell: ({ row }) => {
          const isDraft = row.original.status === 'DRAFT';
          return (
            <div className="flex items-center gap-2">
              {isDraft && canConfirmDraft && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setConfirmOrderId(row.original.id)}
                  disabled={isPending}
                >
                  Подтвердить
                </Button>
              )}
              {!isDraft && <span className="text-neutral-500">—</span>}
            </div>
          );
        },
      },
    ];
  },
  [canConfirm, isPending],
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

      <Dialog
        open={confirmOrderId !== null}
        onClose={() => setConfirmOrderId(null)}
        title="Подтвердить ПЗ?"
      >
        <p className="text-graphite">
          Операторы получат уведомления. После подтверждения корректировка будет возможна только до первого отчёта Оператора.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmOrderId(null)} disabled={isPending}>
            Отмена
          </Button>
          <Button
            variant="cta"
            onClick={() => confirmOrderId && handleConfirm(confirmOrderId)}
            disabled={isPending || !confirmOrderId}
          >
            {isPending ? 'Подтверждение...' : 'Подтвердить'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

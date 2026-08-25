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
import { Button, Card, Dialog, Label } from '@prodtrack/ui';
import { hasPermission } from '@prodtrack/contracts';
import type { ProductionOrder, ProductionOrderLine, Shift, WorkCenter } from '@prisma/client';
import { confirmProductionOrderAction, cancelProductionOrderAction } from './actions';

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

function lineProgressLabel(lines: ProductionOrderLine[]): string {
  const total = lines.length;
  if (total === 0) return '';
  const reported = lines.filter((line) => line.status === 'REPORTED').length;
  const accepted = lines.filter((line) => line.status === 'ACCEPTED').length;
  const assigned = lines.filter((line) => line.status === 'ASSIGNED').length;
  if (reported === total) return 'все РЦ отчитались';
  if (assigned === total) return 'ожидает подтверждения';
  return `${reported} из ${total} РЦ отчитались, ${accepted} в работе, ${assigned} не приняты`;
}

export default function ProductionOrdersPage({ orders, userRoles }: ProductionOrdersPageProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOrderId, setConfirmOrderId] = useState<string | null>(null);
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
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

  function handleCancel(orderId: string) {
    const trimmedReason = cancelReason.trim();
    if (trimmedReason.length === 0) {
      setCancelError('Укажите причину отмены');
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set('reason', trimmedReason);
      const result = await cancelProductionOrderAction(orderId, formData);
      if (result.success) {
        setCancelOrderId(null);
        setCancelReason('');
        setCancelError(null);
        router.refresh();
      } else {
        setCancelError(result.error ?? 'Не удалось отменить ПЗ');
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
          cell: ({ row }) => {
            const statusLabel = STATUS_LABELS[row.original.status] ?? row.original.status;
            const progress = lineProgressLabel(row.original.lines);
            return (
              <div>
                <span>{statusLabel}</span>
                {progress && row.original.status !== 'COMPLETED' && row.original.status !== 'CANCELLED' && (
                  <p className="text-xs text-neutral-500">{progress}</p>
                )}
              </div>
            );
          },
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
          const isCancellable = (row.original.status === 'DRAFT' || row.original.status === 'CONFIRMED') &&
            !row.original.lines.some((line) => line.status === 'REPORTED');
          return (
            <div className="flex items-center gap-2">
              {isDraft && canConfirmDraft && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmOrderId(row.original.id);
                  }}
                  disabled={isPending}
                >
                  Подтвердить
                </Button>
              )}
              {isCancellable && canConfirmDraft && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCancelOrderId(row.original.id);
                    setCancelReason('');
                    setCancelError(null);
                  }}
                  disabled={isPending}
                >
                  Отменить ПЗ
                </Button>
              )}
              <Link href={'/production-orders/' + row.original.id}>
                <Button variant="secondary" size="sm" onClick={(e) => e.stopPropagation()}>
                  Открыть
                </Button>
              </Link>
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
                <tr
                  key={row.id}
                  className="hover:bg-neutral-100 cursor-pointer"
                  onClick={() => router.push('/production-orders/' + row.original.id)}
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

      <Dialog
        open={cancelOrderId !== null}
        onClose={() => {
          setCancelOrderId(null);
          setCancelReason('');
          setCancelError(null);
        }}
        title="Отменить ПЗ?"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (cancelOrderId) handleCancel(cancelOrderId);
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Причина отмены</Label>
            <textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCancelReason(e.target.value)}
              placeholder="Укажите причину отмены"
              required
              rows={3}
              className="flex min-h-[80px] w-full rounded-md border border-mist-metal bg-white px-3 py-2 text-base text-graphite placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-deep-industry-blue"
            />
          </div>
          {cancelError && <p className="text-sm text-signal-amber">{cancelError}</p>}
          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                setCancelOrderId(null);
                setCancelReason('');
                setCancelError(null);
              }}
              disabled={isPending}
            >
              Не отменять
            </Button>
            <Button variant="danger" type="submit" disabled={isPending || !cancelOrderId}>
              {isPending ? 'Отмена...' : 'Отменить ПЗ'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

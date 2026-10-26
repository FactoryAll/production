import Link from 'next/link';
import { daysSinceShift, type OverdueOrder } from '@/app/notifications/overdue-queries';

/**
 * Напоминание о незакрытых ПЗ сверх срока (ОПЭ-60).
 *
 * Решение владельца 26.10.2026: напоминание висит у НП при каждом обновлении экрана,
 * пока ПЗ не закрыто, — «чтобы надоедало». Поэтому это не уведомление в центре,
 * а блок, который считается на сервере при каждой отрисовке.
 */
export function OverdueReminder({ orders }: { orders: OverdueOrder[] }) {
  if (orders.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-signal-amber/40 bg-signal-amber/10">
      <div className="mx-auto max-w-7xl px-4 py-2 text-sm">
        <p className="font-medium text-graphite">
          Незакрытые ПЗ сверх срока: {orders.length}
        </p>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/production-orders/${order.id}`}
                className="underline decoration-dotted underline-offset-2 hover:text-deep-industry-blue"
              >
                ПЗ {order.id.slice(0, 8)} — смена {order.shiftNumber} от{' '}
                {new Date(order.shiftDate).toLocaleDateString('ru-RU')} (висит{' '}
                {daysSinceShift(order.shiftDate)} дн.)
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

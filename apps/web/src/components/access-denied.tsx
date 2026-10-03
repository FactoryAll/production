import Link from 'next/link';
import { Card } from '@prodtrack/ui';

const ROLE_LABELS: Record<string, string> = {
  NP: 'Начальник производства (НП)',
  OPR: 'Оператор (ОПР)',
  KSGP: 'Кладовщик склада ГП (КСГП)',
  USGP: 'Учётчик склада ГП (УСГП)',
  S1C: 'Специалист 1С (С1С)',
  ADM: 'Администратор (АДМ)',
};

export interface AccessDeniedProps {
  /** Действие, для которого не хватает прав: «приёмка перемещения». */
  action: string;
  /** Коды ролей, у которых есть право на это действие. */
  allowedRoles?: string[];
  /** Код права — техническая информация для поддержки. */
  requiredPermission?: string;
}

export function AccessDenied({ action, allowedRoles, requiredPermission }: AccessDeniedProps) {
  return (
    <main className="p-6">
      <Card className="max-w-2xl space-y-3">
        <h1 className="text-2xl font-bold text-graphite">Доступ запрещён</h1>
        <p className="text-graphite">
          Для вашей роли недоступно действие: <strong>{action}</strong>.
        </p>
        {allowedRoles && allowedRoles.length > 0 && (
          <p className="text-sm text-neutral-600">
            Действие доступно ролям: {allowedRoles.map((code) => ROLE_LABELS[code] ?? code).join(', ')}.
          </p>
        )}
        <p className="text-sm text-neutral-600">
          Если доступ необходим, обратитесь к администратору системы.
        </p>
        {requiredPermission && (
          <p className="text-xs text-neutral-500">Техническая информация: требуется право {requiredPermission}.</p>
        )}
        <div className="pt-2">
          <Link href="/dashboard" className="text-sm font-medium text-deep-industry-blue hover:underline">
            ← Вернуться на главную
          </Link>
        </div>
      </Card>
    </main>
  );
}

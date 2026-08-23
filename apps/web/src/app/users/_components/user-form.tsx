'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RoleCode } from '@prodtrack/contracts';
import { Label } from '@prodtrack/ui';
import { Select } from '@prodtrack/ui';
import { CheckboxList } from '@prodtrack/ui';
import { Switch } from '@prodtrack/ui';
import type { User, Employee } from '@prisma/client';

const ROLE_OPTIONS = Object.values(RoleCode).map((code) => ({
  value: code,
  label: code,
}));

interface UserFormProps {
  mode: 'create' | 'edit';
  user?: User & { roles: { role: { code: string } }[]; employee: Employee | null };
  employees: { id: string; fullName: string; tabNumber: string }[];
  action: (formData: FormData) => Promise<{ success: boolean; error?: string }>;
  onReset?: (formData: FormData) => Promise<{ success: boolean; tempPassword?: string; error?: string }>;
}

export function UserForm({ mode, user, employees, action, onReset }: UserFormProps) {
  const router = useRouter();
  const [roles, setRoles] = useState<string[]>(user?.roles.map((ur) => ur.role.code) ?? []);
  const [active, setActive] = useState(user?.active ?? true);
  const [lastRoleWarning, setLastRoleWarning] = useState(false);
  const [result, setResult] = useState<{ success: boolean; tempPassword?: string; error?: string } | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    if (mode === 'edit' && roles.length === 0 && active) {
      setLastRoleWarning(true);
      return;
    }

    setIsPending(true);
    setResult(null);
    const res = await action(formData);
    setIsPending(false);
    if (res.success) {
      router.push('/users');
      router.refresh();
    } else {
      setResult(res);
    }
  }

  async function handleReset() {
    if (!onReset || !user) return;
    setIsPending(true);
    const res = await onReset(new FormData());
    setIsPending(false);
    setResult(res);
  }

  function handleRoleChange(next: string[]) {
    setRoles(next);
    if (next.length > 0) setLastRoleWarning(false);
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Label htmlFor="login">Логин</Label>
        <input
          id="login"
          name="login"
          type="text"
          defaultValue={user?.login ?? ''}
          readOnly={mode === 'edit'}
          required
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm disabled:bg-neutral-100"
        />
      </div>

      {mode === 'create' && (
        <div className="space-y-2">
          <Label htmlFor="password">Пароль</Label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <p className="text-xs text-neutral-500">Минимум 8 символов, буквы и цифры.</p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="employeeId">Сотрудник</Label>
        <Select
          id="employeeId"
          name="employeeId"
          options={employees.map((e) => ({
            value: e.id,
            label: e.fullName + ' (' + e.tabNumber + ')',
          }))}
          defaultValue={user?.employeeId ?? ''}
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Роли</Label>
        <CheckboxList name="roles" options={ROLE_OPTIONS} selected={roles} onChange={handleRoleChange} />
        {lastRoleWarning && (
          <p className="text-sm text-amber-700">
            Пользователь без ролей не сможет войти в систему. Чтобы продолжить, заблокируйте пользователя.
          </p>
        )}
      </div>

      {mode === 'edit' && (
        <div className="flex items-center gap-3">
          <Switch checked={active} onChange={setActive} label={active ? 'Активен' : 'Заблокирован'} />
          <input type="hidden" name="active" value={String(active)} />
        </div>
      )}

      {result?.error && <p className="text-sm text-red-600">{result.error}</p>}
      {result?.tempPassword && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-800">
          <p>Временный пароль сгенерирован. Покажите его пользователю один раз.</p>
          <pre className="mt-1 font-mono">{result.tempPassword}</pre>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex h-12 items-center rounded-md bg-deep-industry-blue px-4 text-sm font-medium text-white hover:bg-opacity-90 disabled:opacity-50"
        >
          {mode === 'create' ? 'Создать' : 'Сохранить'}
        </button>
        {mode === 'edit' && onReset && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleReset}
            className="inline-flex h-12 items-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Сбросить пароль
          </button>
        )}
      </div>
    </form>
  );
}
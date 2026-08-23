import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  type ColumnDef,
  flexRender,
} from '@tanstack/react-table';
import type { User, Employee, Role } from '@prisma/client';
import { toggleUserActiveAction } from '../actions';

export interface UsersSearchParams {
  q?: string;
  active?: string;
}

interface UserRow extends User {
  employee: Employee | null;
  roles: { role: Role }[];
}

interface UsersTableProps {
  users: UserRow[];
  searchParams: UsersSearchParams;
}

function StatusCell({ active }: { active: boolean }) {
  return (
    <span className={active ? 'text-green-700' : 'text-red-700'}>
      {active ? 'Активен' : 'Заблокирован'}
    </span>
  );
}

function ToggleButton({ user }: { user: UserRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await toggleUserActiveAction(user.id, !user.active);
          router.refresh();
        });
      }}
      className="text-sm text-deep-industry-blue hover:underline disabled:opacity-50"
    >
      {user.active ? 'Заблокировать' : 'Разблокировать'}
    </button>
  );
}

export function UsersTable({ users, searchParams }: UsersTableProps) {
  const router = useRouter();

  const columns: ColumnDef<UserRow>[] = [
    {
      accessorKey: 'login',
      header: 'Логин',
      cell: ({ row }) => (
        <Link href={'/users/' + row.original.id + '/edit'} className="text-deep-industry-blue hover:underline">
          {row.original.login}
        </Link>
      ),
    },
    {
      accessorFn: (row) => row.employee?.fullName ?? '—',
      id: 'employee',
      header: 'Сотрудник',
    },
    {
      accessorFn: (row) => row.roles.map((ur) => ur.role.name).join(', ') || '—',
      id: 'roles',
      header: 'Роли',
    },
    {
      accessorFn: (row) => row.active,
      id: 'status',
      header: 'Статус',
      cell: ({ row }) => <StatusCell active={row.original.active} />,
    },
    {
      id: 'actions',
      header: 'Действия',
      cell: ({ row }) => <ToggleButton user={row.original} />,
    },
  ];

  const table = useReactTable({
    data: users,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  function updateSearch(newParams: Record<string, string | undefined>) {
    const url = new URLSearchParams();
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value) url.set(key, value);
    });
    Object.entries(newParams).forEach(([key, value]) => {
      if (value) url.set(key, value);
      else url.delete(key);
    });
    router.push('/users?' + url.toString());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          defaultValue={searchParams.q ?? ''}
          placeholder="Поиск по логину или ФИО"
          className="w-64 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          onChange={(e) => updateSearch({ q: e.target.value || undefined })}
        />
        <select
          value={searchParams.active ?? ''}
          onChange={(e) => updateSearch({ active: e.target.value || undefined })}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          <option value="">Все</option>
          <option value="true">Активные</option>
          <option value="false">Заблокированные</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-md border border-neutral-200">
        <table className="min-w-full text-sm">
          <thead className="bg-graphite-surface">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-4 py-3 text-left font-semibold text-neutral-700">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="hover:bg-neutral-50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
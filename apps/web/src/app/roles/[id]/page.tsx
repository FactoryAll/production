import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getRoleWithPermissions } from '../../users/data';
import { ROLE_PERMISSIONS } from '@prodtrack/contracts';

export const dynamic = 'force-dynamic';

interface RolePageProps {
  params: { id: string };
}

export default async function RolePage({ params }: RolePageProps) {
  const role = await getRoleWithPermissions(params.id);
  if (!role) notFound();

  const dbPermissions = role.permissions.map((p: { code: string }) => p.code);
  const allPermissions = ROLE_PERMISSIONS[role.code as keyof typeof ROLE_PERMISSIONS] ?? [];

  return (
    <main className="p-6">
      <Link href="/roles" className="text-sm text-deep-industry-blue hover:underline">← Назад к ролям</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold">
        {role.name} ({role.code})
      </h1>
      <p className="mb-4 text-sm text-neutral-600">
        Права роли определяются матрицей доступа и не редактируются в MVP.
      </p>
      <ul className="list-disc space-y-1 rounded-md border border-neutral-200 bg-white p-4 pl-8 text-sm">
        {allPermissions.map((code: string) => (
          <li key={code} className={dbPermissions.includes(code) ? 'text-neutral-900' : 'text-neutral-400'}>
            {code}
          </li>
        ))}
      </ul>
    </main>
  );
}
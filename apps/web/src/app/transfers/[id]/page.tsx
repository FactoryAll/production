export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { getTransferById } from '../actions';
import TransferCard from './_client-card';
import { requireSession } from '@/lib/auth/session';

interface TransferPageProps {
  params: { id: string };
}

export default async function TransferPage({ params }: TransferPageProps) {
  const [transfer, session] = await Promise.all([getTransferById(params.id), requireSession()]);
  if (!transfer) {
    notFound();
  }
  const userRoles = session.user.roles.map((ur) => ur.role.code);
  return <TransferCard transfer={transfer} userRoles={userRoles} />;
}

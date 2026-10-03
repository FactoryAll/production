// Область видимости хронометража (M10 §3): ОПР видит только свой РЦ,
// остальные роли — весь хронометраж.

import { ALL_ROLES } from '@prodtrack/contracts';

export type TimingScope = 'ALL' | 'OWN_WORK_CENTER';

/** Роли, для которых M10 §3 ограничивает просмотр своим РЦ. */
const SCOPED_ROLES = ['OPR'];

export function timingScope(userRoles: string[]): TimingScope {
  const knownRoles = userRoles.filter((role) => (ALL_ROLES as string[]).includes(role));
  const hasUnscopedRole = knownRoles.some((role) => !SCOPED_ROLES.includes(role));

  if (hasUnscopedRole) {
    return 'ALL';
  }
  // Только ОПР (или роли неизвестны) — просмотр ограничен своим РЦ.
  return knownRoles.length > 0 ? 'OWN_WORK_CENTER' : 'ALL';
}

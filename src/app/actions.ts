import { api } from '../shared/api/client';
import type { Role } from '../shared/engine/types';
import { currentRoute, roleFromParam, roleToParam, setParams } from './router';

/** Switch the console role: URL (so Back works) plus an audit event. */
export function switchRole(next: Role): void {
  const prev = roleFromParam(currentRoute().params.get('role'));
  if (prev === next) return;
  setParams({ role: next === 'ROLE_ADMIN' ? null : roleToParam(next) }, { replace: false });
  void api.logRoleChange(prev, next);
}

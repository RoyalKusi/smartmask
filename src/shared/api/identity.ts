import type { Role } from '../engine/types';

/** The signed-in demo principal for each console role. */
export const DEFAULT_PRINCIPAL: Record<Role, string> = {
  ROLE_ADMIN: 'n.sibanda',
  ROLE_SUPPORT: 'p.iyer',
  ROLE_ANALYST: 's.nair',
};

/**
 * Domain entities of the feature-sliced layout: the vocabulary every feature shares.
 * Pure types and tiny helpers; no React, no I/O.
 */
export type { ColumnRecord, ColumnOverride, Decision } from '../shared/data/catalogTypes';
export type { AuditEvent, AuditBody, ChainVerdict } from '../shared/engine/audit';
export type { AnomalyAlert } from '../shared/data/anomalies';
export type { Policy, PolicyRule } from '../shared/engine/policyCore';
export type { Principal } from '../shared/data/principals';
export { COLUMN_STATES, ROLES, TAGS } from '../shared/engine/types';
export type { ColumnState, Role, Tag, Family, Dialect, Violation } from '../shared/engine/types';

import type { ColumnState, Role, Tag } from '../shared/engine/types';

export const ROLE_LABEL: Record<Role, string> = { ROLE_ADMIN: 'Admin', ROLE_SUPPORT: 'Support', ROLE_ANALYST: 'Analyst' };

export const TAG_LABEL: Record<Tag, string> = {
  PII_HIGH: 'PII (high)',
  FINANCIAL_CONFIDENTIAL: 'Financial, confidential',
  PII_MEDIUM: 'PII (medium)',
};

/** Whether a column state means the engine masks it for non-Admin roles. */
export const isMasked = (s: ColumnState): boolean => s !== 'CLEAR';

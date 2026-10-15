export type Role = 'ROLE_ADMIN' | 'ROLE_SUPPORT' | 'ROLE_ANALYST';
export const ROLES: readonly Role[] = ['ROLE_ADMIN', 'ROLE_SUPPORT', 'ROLE_ANALYST'];
export type Tag = 'PII_HIGH' | 'FINANCIAL_CONFIDENTIAL' | 'PII_MEDIUM';
export const TAGS: readonly Tag[] = ['PII_HIGH', 'FINANCIAL_CONFIDENTIAL', 'PII_MEDIUM'];
export type ColumnState = 'ENFORCED' | 'ENFORCED_ML' | 'REVIEW' | 'CLEAR' | 'OVERRIDDEN';
export const COLUMN_STATES: readonly ColumnState[] = ['ENFORCED', 'ENFORCED_ML', 'REVIEW', 'CLEAR', 'OVERRIDDEN'];
export type Dialect = 'postgresql' | 'sqlite' | 'mysql';
export type BackendId = 'core_pg' | 'ledger_lite' | 'crm_mysql' | (string & {});
export type Value = string | number | boolean | null;

export type Family =
  | 'PAN'
  | 'SSN'
  | 'AADHAAR'
  | 'IBAN'
  | 'ACCOUNT_NO'
  | 'EMAIL'
  | 'PHONE'
  | 'PERSON_NAME'
  | 'DOB'
  | 'ADDRESS'
  | 'BALANCE'
  | 'AMOUNT'
  | 'SALARY'
  | 'FREE_TEXT'
  | 'OTHER';

export const FAMILY_TAG: Partial<Record<Family, Tag>> = {
  PAN: 'PII_HIGH',
  SSN: 'PII_HIGH',
  AADHAAR: 'PII_HIGH',
  IBAN: 'PII_HIGH',
  ACCOUNT_NO: 'PII_HIGH',
  EMAIL: 'PII_MEDIUM',
  PHONE: 'PII_MEDIUM',
  PERSON_NAME: 'PII_MEDIUM',
  DOB: 'PII_MEDIUM',
  ADDRESS: 'PII_MEDIUM',
  BALANCE: 'FINANCIAL_CONFIDENTIAL',
  AMOUNT: 'FINANCIAL_CONFIDENTIAL',
  SALARY: 'FINANCIAL_CONFIDENTIAL',
};

export class EngineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly position?: number,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export interface Violation {
  code: 'SM-PRED-001' | 'SM-DERIVED-001' | 'SM-PARSE-001' | 'SM-AUDIT-001' | 'SM-CAT-002';
  message: string;
  column?: string;
}

export const VIOLATION_TITLES: Record<Violation['code'], string> = {
  'SM-PRED-001': 'Predicate on a tagged column',
  'SM-DERIVED-001': 'Derived expression over a tagged column',
  'SM-PARSE-001': 'SQL could not be parsed',
  'SM-AUDIT-001': 'Audit queue full',
  'SM-CAT-002': 'Unknown table or column',
};

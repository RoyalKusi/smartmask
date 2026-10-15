import { createRng, type Rng } from '../engine/prng';
import { groupPan, luhnValid, makeIban, makePan } from '../engine/validators';
import type { BackendId, Dialect, Value } from '../engine/types';
import {
  AGENT_TEAMS,
  BRANCH_NAMES,
  CAMPAIGNS,
  CITIES,
  CURRENCIES,
  LEDGER_ACCOUNTS,
  MERCHANTS,
  MESSAGE_BODIES,
  NAMES,
  TICKET_SUBJECTS,
  type Locale,
} from './lists';
import { DAY, DEMO_NOW, SIZES, getPool, iso, isoDate, money, type Pool } from './pool';

export interface RowCtx {
  i: number;
  rng: Rng;
  pool: Pool;
}
export type Gen = (c: RowCtx) => Value;
export interface ColumnSpec {
  name: string;
  type: string;
  gen: Gen;
}
export interface TableSpec {
  name: string;
  backend: BackendId;
  rows: number;
  description: string;
  columns: ColumnSpec[];
}

export const BACKENDS: {
  id: BackendId;
  label: string;
  dialect: Dialect;
  engine: string;
  approach: 'views' | 'ast';
}[] = [
  { id: 'core_pg', label: 'core_pg', dialect: 'postgresql', engine: 'PostgreSQL 16', approach: 'views' },
  { id: 'ledger_lite', label: 'ledger_lite', dialect: 'sqlite', engine: 'SQLite 3.45', approach: 'ast' },
  { id: 'crm_mysql', label: 'crm_mysql', dialect: 'mysql', engine: 'MySQL 8.4', approach: 'ast' },
];

const c = (name: string, type: string, gen: Gen): ColumnSpec => ({ name, type, gen });
const cust = (x: RowCtx) => x.pool.customers[x.i % SIZES.customers]!;
const rndCust = (x: RowCtx) => x.pool.customers[x.rng.int(0, SIZES.customers - 1)]!;
const ago = (x: RowCtx, minDays: number, maxDays: number): number =>
  DEMO_NOW - x.rng.int(minDays, maxDays) * DAY - x.rng.int(0, 86_399) * 1000;
const seq =
  (start: number): Gen =>
  (x) =>
    start + x.i;
const nullable =
  (p: number, g: Gen): Gen =>
  (x) =>
    x.rng.chance(p) ? null : g(x);
const oneOf =
  (items: readonly Value[]): Gen =>
  (x) =>
    x.rng.pick(items);
const wOf =
  (items: readonly (readonly [Value, number])[]): Gen =>
  (x) =>
    x.rng.weighted(items);

function emailFor(first: string, last: string, rng: Rng, domain: string): string {
  const f = first
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  const l = last
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return `${f}.${l}${rng.chance(0.2) ? rng.int(1, 99) : ''}@${domain}`;
}
const fullNameOf = (x: RowCtx): string => {
  const l = x.rng.weighted([
    ['IN', 40],
    ['UK', 25],
    ['US', 20],
    ['ZW', 15],
  ] as const) as Locale;
  return `${x.rng.pick(NAMES[l].first)} ${x.rng.pick(NAMES[l].last)}`;
};
const phoneIN = (x: RowCtx): string => `+91${x.rng.int(6, 9)}${x.rng.digits(9)}`;

/** Digits drawn from a restricted alphabet and Luhn-failing: the legacy PAN column whose S is 0.725. */
const LEGACY_ALPHABET = [...'0123456'];
const LEGACY_POOL_SIZE = 15;
const legacyPool: string[] = [];
function legacyPan(x: RowCtx): string {
  if (x.i === 0) return '4111-2345-6789-1111';
  if (!legacyPool.length) {
    const r = createRng('legacy-pan-pool');
    while (legacyPool.length < LEGACY_POOL_SIZE) {
      let d = '4111';
      for (let k = 0; k < 12; k++) d += r.pick(LEGACY_ALPHABET);
      if (!luhnValid(d)) legacyPool.push(groupPan(d));
    }
  }
  return legacyPool[(x.i * 7 + 3) % legacyPool.length] as string;
}

const txnStart = DEMO_NOW - 120 * DAY;
const MCC_DESC = MERCHANTS;

export const TABLES: TableSpec[] = [
  {
    name: 'customers',
    backend: 'core_pg',
    rows: SIZES.customers,
    description: 'Retail customer master',
    columns: [
      c('customer_id', 'bigint', (x) => cust(x).id),
      c('first_name', 'varchar(60)', (x) => cust(x).first),
      c('last_name', 'varchar(60)', (x) => cust(x).last),
      c('full_name', 'varchar(120)', (x) => `${cust(x).first} ${cust(x).last}`),
      c('email', 'varchar(160)', (x) => cust(x).email),
      c('phone', 'varchar(20)', (x) => cust(x).phone),
      c('dob', 'date', (x) => cust(x).dob),
      c('ssn', 'varchar(11)', (x) => cust(x).ssn),
      c('aadhaar_no', 'varchar(14)', (x) => cust(x).aadhaar),
      c('address_line', 'varchar(200)', (x) => cust(x).address),
      c('city', 'varchar(60)', (x) => cust(x).city),
      c('postcode', 'varchar(12)', (x) => cust(x).postcode),
      c('country_code', 'char(2)', (x) => cust(x).country),
      c(
        'kyc_status',
        'varchar(12)',
        wOf([
          ['VERIFIED', 86],
          ['PENDING', 10],
          ['EXPIRED', 4],
        ]),
      ),
      c(
        'segment',
        'varchar(12)',
        wOf([
          ['MASS', 70],
          ['AFFLUENT', 25],
          ['PRIVATE', 5],
        ]),
      ),
      c('created_at', 'timestamp', (x) => iso(cust(x).createdMs)),
      c(
        'risk_band',
        'varchar(8)',
        wOf([
          ['LOW', 60],
          ['MEDIUM', 30],
          ['HIGH', 10],
        ]),
      ),
      c(
        'preferred_lang',
        'char(2)',
        (x) => ({ IN: 'en', ZW: 'en', UK: 'en', US: x.rng.pick(['en', 'es']) })[cust(x).locale],
      ),
      c('marketing_opt_in', 'boolean', (x) => x.rng.chance(0.42)),
    ],
  },
  {
    name: 'accounts',
    backend: 'core_pg',
    rows: SIZES.accounts,
    description: 'Deposit and current accounts',
    columns: [
      c('account_id', 'bigint', (x) => x.pool.accounts[x.i]!.id),
      c('customer_id', 'bigint', (x) => x.pool.accounts[x.i]!.customerId),
      c('account_no', 'varchar(12)', (x) => x.pool.accounts[x.i]!.accountNo),
      c('iban', 'varchar(34)', (x) => x.pool.accounts[x.i]!.iban),
      c(
        'product_code',
        'varchar(8)',
        wOf([
          ['SAV01', 50],
          ['CUR01', 30],
          ['SAL01', 15],
          ['FD01', 5],
        ]),
      ),
      c('currency', 'char(3)', (x) => x.pool.accounts[x.i]!.currency),
      c('balance', 'numeric(14,2)', (x) => money(x.pool.accounts[x.i]!.balance)),
      c('available_balance', 'numeric(14,2)', (x) =>
        money(Math.max(0, x.pool.accounts[x.i]!.balance - x.rng.int(0, 5000))),
      ),
      c('opened_on', 'date', (x) => isoDate(ago(x, 60, 3500))),
      c(
        'status',
        'varchar(10)',
        wOf([
          ['ACTIVE', 90],
          ['DORMANT', 7],
          ['CLOSED', 3],
        ]),
      ),
      c('branch_id', 'int', (x) => x.rng.int(1, 60)),
      c('overdraft_limit', 'numeric(12,2)', (x) => money(x.rng.pick([0, 0, 0, 10000, 25000, 50000]))),
      c('last_activity', 'timestamp', (x) => iso(ago(x, 0, 90))),
    ],
  },
  {
    name: 'cards',
    backend: 'core_pg',
    rows: SIZES.cards,
    description: 'Debit and credit cards (test PAN ranges)',
    columns: [
      c('card_id', 'bigint', (x) => x.pool.cards[x.i]!.id),
      c('customer_id', 'bigint', (x) => x.pool.cards[x.i]!.customerId),
      c('account_id', 'bigint', (x) => x.pool.cards[x.i]!.accountId),
      c('card_no', 'varchar(19)', (x) => x.pool.cards[x.i]!.pan),
      c('card_brand', 'varchar(12)', (x) => x.pool.cards[x.i]!.brand),
      c('expiry', 'char(5)', (x) => `${String(x.rng.int(1, 12)).padStart(2, '0')}/${x.rng.int(27, 33)}`),
      c('cardholder_name', 'varchar(120)', (x) => {
        const p = x.pool.customers[x.pool.cards[x.i]!.customerId - 1]!;
        return `${p.first} ${p.last}`.toUpperCase();
      }),
      c(
        'status',
        'varchar(10)',
        wOf([
          ['ACTIVE', 88],
          ['BLOCKED', 6],
          ['EXPIRED', 4],
          ['PENDING', 2],
        ]),
      ),
      c('issued_on', 'date', (x) => isoDate(ago(x, 30, 1800))),
      c('credit_limit', 'numeric(12,2)', (x) => money(x.rng.pick([0, 25000, 50000, 100000, 250000]))),
      c('pin_attempts', 'smallint', (x) =>
        x.rng.weighted([
          [0, 90],
          [1, 7],
          [2, 2],
          [3, 1],
        ]),
      ),
    ],
  },
  {
    name: 'transactions',
    backend: 'core_pg',
    rows: 60000,
    description: 'Card and account transactions',
    columns: [
      c('txn_id', 'bigint', seq(9_000_001)),
      c('account_id', 'bigint', (x) => x.pool.accounts[x.rng.int(0, SIZES.accounts - 1)]!.id),
      c('card_no', 'varchar(19)', (x) =>
        x.rng.chance(0.18) ? null : x.pool.cards[x.rng.int(0, SIZES.cards - 1)]!.pan,
      ),
      c('merchant_name', 'varchar(80)', (x) => x.rng.pick(MCC_DESC)[0]),
      c('mcc', 'char(4)', (x) => x.rng.pick(MCC_DESC)[1]),
      c('amount', 'numeric(12,2)', (x) => money(Math.min(250000, x.rng.logNormal(6.2, 1.3)))),
      c('currency', 'char(3)', oneOf(CURRENCIES)),
      c('txn_ts', 'timestamp', (x) =>
        iso(txnStart + Math.floor((x.i / 60000) * 120 * DAY) + x.rng.int(0, 600) * 1000),
      ),
      c(
        'channel',
        'varchar(12)',
        wOf([
          ['CARD_POS', 45],
          ['CARD_ONLINE', 20],
          ['UPI', 15],
          ['NEFT', 8],
          ['ATM', 7],
          ['WIRE', 5],
        ]),
      ),
      c(
        'status',
        'varchar(10)',
        wOf([
          ['SETTLED', 93],
          ['PENDING', 4],
          ['DECLINED', 2],
          ['REVERSED', 1],
        ]),
      ),
      c('auth_code', 'char(6)', (x) => x.rng.digits(6)),
      c('merchant_city', 'varchar(60)', (x) =>
        x.rng.pick(CITIES[x.rng.pick(['IN', 'UK', 'US', 'ZW'] as Locale[])]),
      ),
      c('counterparty_iban', 'varchar(34)', (x) =>
        x.rng.chance(0.12) ? makeIban(x.rng.chance(0.5) ? 'GB' : 'DE', x.rng) : null,
      ),
    ],
  },
  {
    name: 'loans',
    backend: 'core_pg',
    rows: SIZES.loans,
    description: 'Retail loans',
    columns: [
      c('loan_id', 'bigint', (x) => x.pool.loans[x.i]!.id),
      c('customer_id', 'bigint', (x) => x.pool.loans[x.i]!.customerId),
      c('applicant_ssn', 'varchar(11)', (x) => x.pool.customers[x.pool.loans[x.i]!.customerId - 1]!.ssn),
      c('principal', 'numeric(14,2)', (x) => money(x.pool.loans[x.i]!.principal)),
      c('outstanding_balance', 'numeric(14,2)', (x) =>
        money(x.pool.loans[x.i]!.principal * x.rng.float(0.25, 1)),
      ),
      c('interest_rate', 'numeric(5,2)', (x) => Math.round(x.rng.float(7, 14) * 100) / 100),
      c('term_months', 'int', oneOf([12, 24, 36, 60, 120, 240])),
      c('emi_amount', 'numeric(12,2)', (x) =>
        money((x.pool.loans[x.i]!.principal / x.rng.pick([12, 24, 36, 60])) * 1.12),
      ),
      c(
        'status',
        'varchar(10)',
        wOf([
          ['CURRENT', 82],
          ['ARREARS', 9],
          ['CLOSED', 8],
          ['WRITTEN_OFF', 1],
        ]),
      ),
      c('disbursed_on', 'date', (x) => isoDate(ago(x, 20, 1500))),
      c('collateral_value', 'numeric(14,2)', (x) =>
        money(x.pool.loans[x.i]!.principal * x.rng.float(1.1, 1.8)),
      ),
    ],
  },
  {
    name: 'loan_payments',
    backend: 'core_pg',
    rows: 7000,
    description: 'Loan repayment postings',
    columns: [
      c('payment_id', 'bigint', seq(500_001)),
      c('loan_id', 'bigint', (x) => x.rng.int(1, SIZES.loans)),
      c('paid_on', 'date', (x) => isoDate(ago(x, 0, 540))),
      c('amount_paid', 'numeric(12,2)', (x) => money(x.rng.float(1500, 90000))),
      c(
        'method',
        'varchar(10)',
        wOf([
          ['AUTO_DEBIT', 60],
          ['UPI', 20],
          ['BRANCH', 10],
          ['CARD', 10],
        ]),
      ),
      c(
        'status',
        'varchar(10)',
        wOf([
          ['POSTED', 95],
          ['BOUNCED', 3],
          ['REVERSED', 2],
        ]),
      ),
      c(
        'payer_account_no',
        'varchar(12)',
        (x) => x.pool.accounts[x.rng.int(0, SIZES.accounts - 1)]!.accountNo,
      ),
    ],
  },
  {
    name: 'branches',
    backend: 'core_pg',
    rows: 60,
    description: 'Branch directory',
    columns: [
      c('branch_id', 'int', (x) => x.i + 1),
      c(
        'branch_name',
        'varchar(80)',
        (x) => `${BRANCH_NAMES[x.i % BRANCH_NAMES.length]} ${CITIES.IN[x.i % CITIES.IN.length]}`,
      ),
      c('city', 'varchar(60)', (x) => CITIES.IN[x.i % CITIES.IN.length]),
      c('region', 'varchar(20)', (x) => ['North', 'South', 'East', 'West', 'Central'][x.i % 5]),
      c('manager_email', 'varchar(160)', (x) => `branch${x.i + 1}.manager@meridiansavings.example`),
      c('phone', 'varchar(20)', phoneIN),
      c(
        'swift_bic',
        'varchar(11)',
        (x) => `MRDSIN${['BB', 'MM', 'DD', 'KK'][x.i % 4]}${String(x.i % 100).padStart(3, 'X')}`,
      ),
    ],
  },
  {
    name: 'beneficiaries',
    backend: 'core_pg',
    rows: 4000,
    description: 'Saved payees',
    columns: [
      c('beneficiary_id', 'bigint', seq(1)),
      c('customer_id', 'bigint', (x) => x.rng.int(1, SIZES.customers)),
      c('beneficiary_name', 'varchar(120)', fullNameOf),
      c('beneficiary_iban', 'varchar(34)', (x) => makeIban(x.rng.chance(0.6) ? 'GB' : 'DE', x.rng)),
      c(
        'bank_name',
        'varchar(80)',
        oneOf(['Meridian Savings Bank', 'Harbour Trust', 'Northgate Bank', 'Sable Commercial Bank']),
      ),
      c('added_on', 'date', (x) => isoDate(ago(x, 0, 900))),
      c(
        'nickname',
        'varchar(40)',
        oneOf(['Rent', 'Mum', 'School fees', 'Electric', 'Landlord', 'Savings pot']),
      ),
      c('mobile', 'varchar(20)', nullable(0.1, phoneIN)),
    ],
  },
  {
    name: 'kyc_documents',
    backend: 'core_pg',
    rows: 5200,
    description: 'Customer identity documents',
    columns: [
      c('doc_id', 'bigint', seq(1)),
      c('customer_id', 'bigint', (x) => (x.i < SIZES.customers ? x.i + 1 : x.rng.int(1, SIZES.customers))),
      c(
        'doc_type',
        'varchar(16)',
        wOf([
          ['PASSPORT', 35],
          ['NATIONAL_ID', 40],
          ['DRIVER_LICENCE', 25],
        ]),
      ),
      c(
        'ssn',
        'varchar(11)',
        (x) => x.pool.customers[x.i < SIZES.customers ? x.i : x.rng.int(0, SIZES.customers - 1)]!.ssn,
      ),
      c('aadhaar_no', 'varchar(14)', (x) => x.pool.customers[x.i < SIZES.customers ? x.i : 0]!.aadhaar),
      c('passport_no', 'varchar(9)', (x) => `${x.rng.pick([...'MNPRK'])}${x.rng.digits(7)}`),
      c('issue_date', 'date', (x) => isoDate(ago(x, 100, 3000))),
      c('expiry_date', 'date', (x) => isoDate(DEMO_NOW + x.rng.int(-200, 3000) * DAY)),
      c('verified_by', 'varchar(20)', (x) => `agent_${x.rng.int(1, 40)}`),
      c('verified_at', 'timestamp', (x) => iso(ago(x, 0, 700))),
      c(
        'status',
        'varchar(10)',
        wOf([
          ['VALID', 88],
          ['EXPIRED', 8],
          ['REJECTED', 4],
        ]),
      ),
    ],
  },
  {
    name: 'gl_entries',
    backend: 'ledger_lite',
    rows: 9000,
    description: 'General ledger postings',
    columns: [
      c('entry_id', 'integer', seq(1)),
      c('ledger_account', 'text', (x) => `GL${1000 + x.rng.int(0, 399)}`),
      c('posted_on', 'text', (x) => isoDate(ago(x, 0, 400))),
      c('debit', 'real', (x) => (x.rng.chance(0.5) ? money(x.rng.logNormal(8, 1.4)) : '0.00')),
      c('credit', 'real', (x) => (x.rng.chance(0.5) ? money(x.rng.logNormal(8, 1.4)) : '0.00')),
      c('narrative', 'text', (x) =>
        x.rng.pick([
          'Interest accrual',
          'Card settlement',
          'Fee income',
          'Branch cash deposit',
          'Loan disbursement',
          'FX revaluation',
        ]),
      ),
      c('batch_id', 'text', (x) => `B${202610}${String(x.rng.int(1, 400)).padStart(4, '0')}`),
      c('posted_by', 'text', (x) => `svc_ledger_${x.rng.int(1, 6)}`),
    ],
  },
  {
    name: 'ledger_accounts',
    backend: 'ledger_lite',
    rows: 400,
    description: 'Chart of accounts',
    columns: [
      c('ledger_account', 'text', (x) => `GL${1000 + x.i}`),
      c(
        'account_name',
        'text',
        (x) =>
          `${LEDGER_ACCOUNTS[x.i % LEDGER_ACCOUNTS.length]} ${['North', 'South', 'East', 'West', 'Central'][x.i % 5]}`,
      ),
      c('category', 'text', (x) => ['ASSET', 'LIABILITY', 'INCOME', 'EXPENSE'][x.i % 4]),
      c('currency', 'text', oneOf(CURRENCIES)),
      c('opening_balance', 'real', (x) => money(x.rng.logNormal(11, 1.5))),
      c('closing_balance', 'real', (x) => money(x.rng.logNormal(11, 1.5))),
      c('owner_email', 'text', (x) => `ledger.owner${(x.i % 25) + 1}@meridiansavings.example`),
    ],
  },
  {
    name: 'settlements',
    backend: 'ledger_lite',
    rows: 2500,
    description: 'Scheme settlement files',
    columns: [
      c('settlement_id', 'integer', seq(1)),
      c('txn_id', 'integer', (x) => 9_000_001 + x.rng.int(0, 59999)),
      c('counterparty_iban', 'text', (x) => makeIban(x.rng.chance(0.5) ? 'GB' : 'DE', x.rng)),
      c('amount', 'real', (x) => money(Math.min(250000, x.rng.logNormal(6.4, 1.2)))),
      c('currency', 'text', oneOf(CURRENCIES)),
      c('settled_on', 'text', (x) => isoDate(ago(x, 0, 120))),
      c(
        'status',
        'text',
        wOf([
          ['SETTLED', 94],
          ['HELD', 4],
          ['FAILED', 2],
        ]),
      ),
      c('order_ref', 'text', (x) => x.rng.digits(16)),
    ],
  },
  {
    name: 'fx_rates',
    backend: 'ledger_lite',
    rows: 900,
    description: 'Daily FX fixings',
    columns: [
      c('rate_id', 'integer', seq(1)),
      c('pair', 'text', (x) => ['USDINR', 'GBPINR', 'EURINR', 'USDZWG', 'GBPUSD'][x.i % 5]),
      c('rate', 'real', (x) => Math.round(x.rng.float(0.8, 90) * 10000) / 10000),
      c('as_of', 'text', (x) => isoDate(DEMO_NOW - Math.floor(x.i / 5) * DAY)),
      c('source', 'text', oneOf(['ECB', 'RBI', 'Reuters', 'Internal'])),
    ],
  },
  {
    name: 'legacy_cards',
    backend: 'ledger_lite',
    rows: 1500,
    description: 'Cards migrated from the legacy platform',
    columns: [
      c('legacy_id', 'integer', seq(1)),
      c('c1', 'text', (x) => groupPan(makePan(x.rng.chance(0.6) ? '4111' : '5555', x.rng))),
      c('card_no_legacy', 'text', legacyPan),
      c('holder_alias', 'text', (x) => `legacy-${x.rng.digits(5)}`),
      c('migrated_on', 'text', (x) => isoDate(ago(x, 100, 900))),
      c('source_system', 'text', oneOf(['CARDPRO', 'TSYS-OLD', 'MANUAL'])),
    ],
  },
  {
    name: 'reconciliation_runs',
    backend: 'ledger_lite',
    rows: 300,
    description: 'Nightly reconciliation runs',
    columns: [
      c('run_id', 'integer', seq(1)),
      c('started_at', 'text', (x) => iso(DEMO_NOW - ((300 - x.i) * DAY) / 2)),
      c('finished_at', 'text', (x) => iso(DEMO_NOW - ((300 - x.i) * DAY) / 2 + x.rng.int(120, 900) * 1000)),
      c('matched', 'integer', (x) => x.rng.int(1800, 2400)),
      c('unmatched', 'integer', (x) => x.rng.int(0, 40)),
      c('operator_email', 'text', (x) => `recon.ops${x.rng.int(1, 8)}@meridiansavings.example`),
      c(
        'status',
        'text',
        wOf([
          ['CLEAN', 85],
          ['BREAKS', 14],
          ['ABORTED', 1],
        ]),
      ),
    ],
  },
  {
    name: 'support_tickets',
    backend: 'crm_mysql',
    rows: 3000,
    description: 'Customer support tickets',
    columns: [
      c('ticket_id', 'bigint', seq(70_001)),
      c('customer_id', 'bigint', (x) => x.rng.int(1, SIZES.customers)),
      c('opened_at', 'datetime', (x) => iso(ago(x, 0, 200))),
      c('closed_at', 'datetime', (x) => (x.rng.chance(0.25) ? null : iso(ago(x, 0, 190)))),
      c(
        'channel',
        'varchar(12)',
        wOf([
          ['PHONE', 40],
          ['APP', 30],
          ['EMAIL', 20],
          ['BRANCH', 10],
        ]),
      ),
      c('category', 'varchar(20)', oneOf(['CARDS', 'LENDING', 'DEPOSITS', 'DISPUTE', 'DIGITAL'])),
      c(
        'priority',
        'varchar(8)',
        wOf([
          ['LOW', 50],
          ['NORMAL', 35],
          ['HIGH', 12],
          ['URGENT', 3],
        ]),
      ),
      c(
        'status',
        'varchar(10)',
        wOf([
          ['CLOSED', 70],
          ['OPEN', 20],
          ['WAITING', 10],
        ]),
      ),
      c('agent_id', 'int', (x) => x.rng.int(1, 40)),
      c('subject', 'varchar(120)', oneOf(TICKET_SUBJECTS)),
      c('ticket_ref', 'varchar(20)', (x) => `TKT-2026-${String(70_001 + x.i).padStart(6, '0')}`),
    ],
  },
  {
    name: 'ticket_messages',
    backend: 'crm_mysql',
    rows: 9000,
    description: 'Ticket conversation log',
    columns: [
      c('message_id', 'bigint', seq(1)),
      c('ticket_id', 'bigint', (x) => 70_001 + x.rng.int(0, 2999)),
      c('sent_at', 'datetime', (x) => iso(ago(x, 0, 200))),
      c(
        'sender_type',
        'varchar(10)',
        wOf([
          ['CUSTOMER', 45],
          ['AGENT', 50],
          ['SYSTEM', 5],
        ]),
      ),
      c('body', 'text', (x) =>
        x.rng.chance(0.04)
          ? `Customer asked us to follow up at ${rndCust(x).email}.`
          : x.rng.pick(MESSAGE_BODIES),
      ),
      c('attachment_count', 'tinyint', (x) =>
        x.rng.weighted([
          [0, 85],
          [1, 12],
          [2, 3],
        ]),
      ),
    ],
  },
  {
    name: 'contacts',
    backend: 'crm_mysql',
    rows: 4200,
    description: 'CRM contact points',
    columns: [
      c('contact_id', 'bigint', seq(1)),
      c('customer_id', 'bigint', (x) => x.i + 1),
      c('nomor_kartu', 'varchar(24)', (x) =>
        x.rng.chance(0.15) ? null : x.pool.cards[x.i % SIZES.cards]!.pan.replace(/-/g, '.'),
      ),
      c('contact_phone', 'varchar(20)', (x) => x.pool.customers[x.i]!.phone),
      c('contact_email', 'varchar(160)', (x) => x.pool.customers[x.i]!.email),
      c('preferred_channel', 'varchar(10)', oneOf(['EMAIL', 'SMS', 'PHONE', 'APP'])),
      c('consent_marketing', 'tinyint', (x) => (x.rng.chance(0.42) ? 1 : 0)),
      c('last_contacted', 'datetime', (x) => iso(ago(x, 0, 300))),
    ],
  },
  {
    name: 'campaigns',
    backend: 'crm_mysql',
    rows: 80,
    description: 'Marketing campaigns',
    columns: [
      c('campaign_id', 'int', seq(1)),
      c(
        'name',
        'varchar(80)',
        (x) =>
          `${CAMPAIGNS[x.i % CAMPAIGNS.length]} ${['Spring', 'Summer', 'Autumn', 'Winter'][Math.floor(x.i / 8) % 4]}`,
      ),
      c('objective', 'varchar(20)', oneOf(['ACQUISITION', 'RETENTION', 'CROSS_SELL'])),
      c('start_on', 'date', (x) => isoDate(DEMO_NOW - (80 - x.i) * 5 * DAY)),
      c('end_on', 'date', (x) => isoDate(DEMO_NOW - (80 - x.i) * 5 * DAY + 30 * DAY)),
      c('budget_amount', 'decimal(12,2)', (x) => money(x.rng.logNormal(11, 0.9))),
      c('owner_email', 'varchar(160)', (x) => `marketing.lead${x.rng.int(1, 6)}@meridiansavings.example`),
    ],
  },
  {
    name: 'consents',
    backend: 'crm_mysql',
    rows: 5000,
    description: 'Consent ledger',
    columns: [
      c('consent_id', 'bigint', seq(1)),
      c('customer_id', 'bigint', (x) => x.i + 1),
      c('purpose', 'varchar(20)', oneOf(['MARKETING', 'DATA_SHARING', 'PROFILING', 'OPEN_BANKING'])),
      c('granted_at', 'datetime', (x) => iso(ago(x, 0, 900))),
      c('revoked_at', 'datetime', (x) => (x.rng.chance(0.85) ? null : iso(ago(x, 0, 300)))),
      c('channel', 'varchar(10)', oneOf(['APP', 'WEB', 'BRANCH', 'PHONE'])),
    ],
  },
  {
    name: 'agents',
    backend: 'crm_mysql',
    rows: 40,
    description: 'Support agents',
    columns: [
      c('agent_id', 'int', (x) => x.i + 1),
      c('full_name', 'varchar(120)', fullNameOf),
      c('email', 'varchar(160)', (x) =>
        emailFor(x.rng.pick(NAMES.IN.first), x.rng.pick(NAMES.IN.last), x.rng, 'meridiansavings.example'),
      ),
      c('team', 'varchar(20)', (x) => AGENT_TEAMS[x.i % AGENT_TEAMS.length]),
      c('hired_on', 'date', (x) => isoDate(ago(x, 60, 3000))),
      c('phone', 'varchar(20)', phoneIN),
      c('supervisor_id', 'int', (x) => (x.i < 5 ? null : (x.i % 5) + 1)),
    ],
  },
  {
    name: 'kyc_review',
    backend: 'crm_mysql',
    rows: 0,
    description: 'Manual KYC review queue (currently empty)',
    columns: [
      c('review_id', 'bigint', seq(1)),
      c('customer_id', 'bigint', () => null),
      c('ssn', 'varchar(11)', () => null),
      c('reviewer_id', 'int', () => null),
      c('decision', 'varchar(12)', () => null),
      c('reviewed_at', 'datetime', () => null),
    ],
  },
];

export function tableByName(name: string): TableSpec | undefined {
  const n = name.toLowerCase();
  return TABLES.find((t) => t.name === n);
}

export const BACKEND_BY_ID = new Map(BACKENDS.map((b) => [b.id, b]));
export const COLUMN_COUNT = TABLES.reduce((s, t) => s + t.columns.length, 0);

export function generateRows(spec: TableSpec, limit?: number): Value[][] {
  const pool = getPool();
  const rng = createRng(`table:${spec.name}`);
  const n = limit === undefined ? spec.rows : Math.min(limit, spec.rows);
  const rows: Value[][] = [];
  for (let i = 0; i < n; i++) {
    const ctx: RowCtx = { i, rng, pool };
    rows.push(spec.columns.map((col) => col.gen(ctx)));
  }
  return rows;
}

export interface Sample {
  id: string;
  backend: 'core_pg' | 'ledger_lite' | 'crm_mysql';
  title: string;
  expect: string;
  sql: string;
}

export const SAMPLES: Sample[] = [
  { id: 'canonical', backend: 'core_pg', title: 'Canonical demo row', expect: 'Admin sees 4111-1111-1111-1111 and 128450.00; Support 4111-XXXX-XXXX-1111 and a bucket; Analyst a token and [REDACTED].',
    sql: 'SELECT c.card_no, a.balance\nFROM cards c\nJOIN accounts a ON a.account_id = c.account_id\nWHERE c.customer_id = 1' },
  { id: 'tokenjoin', backend: 'core_pg', title: 'Joins on identifiers still work', expect: 'As Analyst, ssn and kyc_ssn show the same token because equal inputs give equal tokens.',
    sql: 'SELECT c.ssn, k.ssn AS kyc_ssn, l.principal\nFROM customers c\nJOIN kyc_documents k ON k.customer_id = c.customer_id\nJOIN loans l ON l.applicant_ssn = c.ssn\nLIMIT 20' },
  { id: 'cte', backend: 'core_pg', title: 'CTE and subquery', expect: 'Masking is applied at the outermost projection, through the CTE and the IN subquery.',
    sql: "WITH arrears AS (\n  SELECT customer_id FROM loans WHERE status = 'ARREARS'\n)\nSELECT c.customer_id, c.full_name, c.email\nFROM customers c\nWHERE c.customer_id IN (SELECT customer_id FROM arrears)\nLIMIT 15" },
  { id: 'unicode', backend: 'core_pg', title: 'Unicode names and plus-addressing', expect: 'Partial masking keeps the first letter of names with diacritics; plus-tags are dropped from emails.',
    sql: "SELECT customer_id, first_name, email\nFROM customers\nWHERE segment = 'PRIVATE'\nLIMIT 12" },
  { id: 'probe', backend: 'core_pg', title: 'Literal probe on a tagged column', expect: 'Rejected with SM-PRED-001 for Support and Analyst; Admin may run it.',
    sql: "SELECT customer_id\nFROM cards\nWHERE card_no = '4111-1111-1111-1111'" },
  { id: 'derived', backend: 'core_pg', title: 'Derived expression over a tagged column', expect: 'Rejected with SM-DERIVED-001 for Support and Analyst.',
    sql: 'SELECT SUBSTR(card_no, 1, 4) AS bin, COUNT(*) AS n\nFROM cards\nGROUP BY SUBSTR(card_no, 1, 4)' },
  { id: 'agg', backend: 'core_pg', title: 'Untagged aggregates are fine', expect: 'COUNT(*) over untagged columns is allowed for every role.',
    sql: 'SELECT segment, COUNT(*) AS customers\nFROM customers\nGROUP BY segment\nORDER BY customers DESC' },
  { id: 'parse', backend: 'core_pg', title: 'Unparseable SQL', expect: 'Rejected with SM-PARSE-001 and logged in the audit chain.',
    sql: 'SELEC customer_id FROM customers' },
  { id: 'legacy', backend: 'ledger_lite', title: 'Legacy cards: c1 and Luhn-failing PAN', expect: 'c1 is in REVIEW (masked fail-closed); card_no_legacy is ENFORCED by name plus format despite failing Luhn.',
    sql: 'SELECT legacy_id, c1, card_no_legacy\nFROM legacy_cards\nLIMIT 10' },
  { id: 'orderref', backend: 'ledger_lite', title: 'Order reference that is not a card', expect: 'order_ref is a 16-digit REVIEW column (S≈0.46), so it is masked until a person clears it.',
    sql: "SELECT settlement_id, order_ref, amount\nFROM settlements\nWHERE status = 'HELD'" },
  { id: 'ledger', backend: 'ledger_lite', title: 'Ledger balances', expect: 'Balances are FINANCIAL_CONFIDENTIAL: bucketed for Support, redacted for Analyst.',
    sql: 'SELECT ledger_account, account_name, closing_balance\nFROM ledger_accounts\nORDER BY ledger_account\nLIMIT 15' },
  { id: 'nomor', backend: 'crm_mysql', title: 'nomor_kartu (promoted by the classifier)', expect: 'Rules miss the dotted format, but the classifier (M ≥ 0.85) promotes the column to ENFORCED_ML.',
    sql: 'SELECT contact_id, nomor_kartu, contact_email\nFROM contacts\nLIMIT 15' },
  { id: 'tickets', backend: 'crm_mysql', title: 'Open support tickets', expect: 'Ticket metadata is untagged and visible to every role.',
    sql: "SELECT ticket_id, category, priority, status\nFROM support_tickets\nWHERE status = 'OPEN'\nORDER BY ticket_id DESC\nLIMIT 20" },
  { id: 'emptytbl', backend: 'crm_mysql', title: 'Empty table with a strong column name', expect: 'kyc_review.ssn has no rows but a strong dictionary hit, so it is floored at S=0.40 (REVIEW).',
    sql: 'SELECT review_id, ssn\nFROM kyc_review' },
];

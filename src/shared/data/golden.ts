export interface GoldenQuery {
  id: string;
  title: string;
  sql: string;
}

/** Fixed queries used to diff a policy change against the live policy before approval. */
export const GOLDEN_QUERIES: GoldenQuery[] = [
  {
    id: 'g1',
    title: 'Card and balance for the canonical customer',
    sql: 'SELECT c.card_no, a.balance FROM cards c JOIN accounts a ON a.account_id = c.account_id WHERE c.customer_id = 1',
  },
  {
    id: 'g2',
    title: 'Customer contact card',
    sql: "SELECT customer_id, full_name, email, phone FROM customers WHERE city = 'Mumbai' LIMIT 20",
  },
  {
    id: 'g3',
    title: 'Identifier join across tables',
    sql: 'SELECT c.ssn, l.principal FROM customers c JOIN loans l ON l.applicant_ssn = c.ssn LIMIT 20',
  },
  {
    id: 'g4',
    title: 'Declined transactions',
    sql: "SELECT card_no, amount, merchant_name FROM transactions WHERE status = 'DECLINED' LIMIT 25",
  },
  {
    id: 'g5',
    title: 'Arrears exposure',
    sql: "SELECT loan_id, principal, outstanding_balance FROM loans WHERE status = 'ARREARS' LIMIT 20",
  },
];

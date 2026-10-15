import { describe, expect, it } from 'vitest';
import { dataset } from '../../src/shared/data/dataset';
import { COLUMN_COUNT, TABLES } from '../../src/shared/data/schema';
import { E164_RE, EMAIL_RE, ibanValid, luhnValid } from '../../src/shared/engine/validators';

describe('synthetic dataset', () => {
  it('is deterministic: two checksums of the same table match', async () => {
    expect(await dataset.checksum('branches')).toBe(await dataset.checksum('branches'));
  });
  it('has the stated volumes', () => {
    expect(TABLES).toHaveLength(22);
    expect(COLUMN_COUNT).toBeGreaterThan(185);
    expect(dataset.get('customers')!.rows).toHaveLength(5000);
    expect(dataset.get('transactions')!.rows).toHaveLength(60000);
    expect(dataset.get('kyc_review')!.rows).toHaveLength(0);
    expect(new Set(TABLES.map((t) => t.backend)).size).toBe(3);
  });
  it('contains the canonical demo row', () => {
    const cards = dataset.get('cards')!;
    expect(cards.rows[0]![cards.columns.indexOf('card_no')]).toBe('4111-1111-1111-1111');
    const accts = dataset.get('accounts')!;
    expect(accts.rows[0]![accts.columns.indexOf('balance')]).toBe('128450.00');
  });
  it('PANs are Luhn-valid, IBANs mod-97 valid, emails and phones well formed', () => {
    const cards = dataset.get('cards')!;
    const ci = cards.columns.indexOf('card_no');
    for (const r of cards.rows.slice(0, 500)) expect(luhnValid(String(r[ci]))).toBe(true);
    const acc = dataset.get('accounts')!;
    const ii = acc.columns.indexOf('iban');
    for (const r of acc.rows.slice(0, 300)) expect(ibanValid(String(r[ii]))).toBe(true);
    const cu = dataset.get('customers')!;
    const ei = cu.columns.indexOf('email');
    const pi = cu.columns.indexOf('phone');
    for (const r of cu.rows.slice(0, 500)) {
      expect(EMAIL_RE.test(String(r[ei]))).toBe(true);
      if (r[pi] !== null) expect(E164_RE.test(String(r[pi]))).toBe(true);
    }
  });
  it('exercises nulls, empty strings, plus-addressing, unicode and duplicate SSNs across tables', () => {
    const cu = dataset.get('customers')!;
    const col = (n: string) => cu.columns.indexOf(n);
    expect(cu.rows.some((r) => r[col('phone')] === null)).toBe(true);
    expect(cu.rows.some((r) => r[col('address_line')] === '')).toBe(true);
    expect(cu.rows.some((r) => String(r[col('email')]).includes('+'))).toBe(true);
    expect(cu.rows.some((r) => /[^\x00-\x7f]/.test(String(r[col('first_name')])))).toBe(true);
    const ssn = new Set(cu.rows.map((r) => r[col('ssn')]));
    const kyc = dataset.get('kyc_documents')!;
    expect(kyc.rows.slice(0, 50).every((r) => ssn.has(r[kyc.columns.indexOf('ssn')] as string))).toBe(true);
  });
  it('base tables are frozen: writes throw', () => {
    const cards = dataset.get('cards')!;
    expect(() => {
      (cards.rows[0] as unknown as string[])[0] = 'x';
    }).toThrow();
  });
});

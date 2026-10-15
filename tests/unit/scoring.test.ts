import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  THRESH_ML,
  combineScore,
  nameScore,
  scoreColumn,
  stateFromScore,
  tokenize,
} from '../../src/shared/engine/scoring';
import { catalogMap } from './helpers';

describe('scoring formula', () => {
  it('S = 0.30 N + 0.55 P + 0.15 E', () => {
    expect(combineScore(1, 1, 1)).toBeCloseTo(1, 10);
    expect(combineScore(1, 0.65, 0.45)).toBeCloseTo(0.725, 3);
    expect(combineScore(0, 0, 0)).toBe(0);
  });
  it('thresholds: >=0.70 ENFORCED, 0.40..0.70 REVIEW, <0.40 CLEAR', () => {
    expect(stateFromScore(0.7, 0)).toBe('ENFORCED');
    expect(stateFromScore(0.699, 0.5)).toBe('REVIEW');
    expect(stateFromScore(0.4, 0)).toBe('REVIEW');
    expect(stateFromScore(0.399, 0)).toBe('CLEAR');
  });
  it('ML promotes at M >= 0.85 and never clears a column', () => {
    expect(stateFromScore(0.1, THRESH_ML)).toBe('ENFORCED_ML');
    expect(stateFromScore(0.55, 0.9)).toBe('ENFORCED_ML');
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (s, m) => {
          const withMl = stateFromScore(s, m);
          const without = stateFromScore(s, 0);
          // The classifier can only move a column towards masking.
          if (without === 'ENFORCED') expect(withMl).toBe('ENFORCED');
          if (without === 'REVIEW') expect(['REVIEW', 'ENFORCED_ML']).toContain(withMl);
          if (without === 'CLEAR') expect(['CLEAR', 'ENFORCED_ML']).toContain(withMl);
        },
      ),
    );
  });
  it('tokenises camelCase, snake_case and digits', () => {
    expect(tokenize('cardNo')).toEqual(['card', 'no']);
    expect(tokenize('nomor_kartu')).toEqual(['nomor', 'kartu']);
    expect(tokenize('c1')).toEqual(['c', '1']);
  });
  it('name dictionary is conservative for look-alikes', () => {
    expect(nameScore('card_no').n).toBe(1);
    expect(nameScore('merchant_name').n).toBeLessThan(0.5);
    expect(nameScore('first_name').n).toBe(1);
    expect(nameScore('status').n).toBe(0);
  });
  it('an empty table with a strong dictionary hit is floored at S = 0.40', () => {
    const r = scoreColumn('ssn', [], true);
    expect(r.s).toBe(0.4);
    expect(r.state).toBe('REVIEW');
    expect(r.emptyTableFloor).toBe(true);
  });
});

describe('seeded edge cases', () => {
  const get = (id: string) => catalogMap.get(id)!;
  it('16-digit order_ref that is not a card lands in REVIEW near 0.45', () => {
    const r = get('settlements.order_ref');
    expect(r.state).toBe('REVIEW');
    expect(r.s).toBeGreaterThan(0.42);
    expect(r.s).toBeLessThan(0.5);
  });
  it('nomor_kartu is missed by rules but promoted by the classifier', () => {
    const r = get('contacts.nomor_kartu');
    expect(r.s).toBeLessThan(0.4);
    expect(r.m).toBeGreaterThanOrEqual(0.85);
    expect(r.state).toBe('ENFORCED_ML');
  });
  it('c1 holding card-shaped values is held for review', () => {
    const r = get('legacy_cards.c1');
    expect(r.state).toBe('REVIEW');
    expect(r.family).toBe('PAN');
  });
  it('Luhn-failing legacy PAN is still tagged by name plus format with S = 0.725', () => {
    const r = get('legacy_cards.card_no_legacy');
    expect(r.s.toFixed(3)).toBe('0.725');
    expect(r.state).toBe('ENFORCED');
    expect(r.tag).toBe('PII_HIGH');
  });
  it('empty kyc_review.ssn is floored at 0.40', () => {
    expect(get('kyc_review.ssn').s).toBe(0.4);
    expect(get('kyc_review.ssn').state).toBe('REVIEW');
  });
  it('the catalog has 22 tables and about 190 columns, with all five states except OVERRIDDEN present', () => {
    expect(new Set([...catalogMap.values()].map((r) => r.table)).size).toBe(22);
    expect(catalogMap.size).toBeGreaterThanOrEqual(185);
    expect(catalogMap.size).toBeLessThanOrEqual(195);
    const states = new Set([...catalogMap.values()].map((r) => r.state));
    for (const s of ['ENFORCED', 'ENFORCED_ML', 'REVIEW', 'CLEAR']) expect(states.has(s as never)).toBe(true);
  });
  it('catalog never stores raw values, only shapes', () => {
    const json = JSON.stringify([...catalogMap.values()]);
    expect(json).not.toContain('4111-1111-1111-1111');
    expect(json).not.toMatch(/@example\.(com|in)/);
  });
});

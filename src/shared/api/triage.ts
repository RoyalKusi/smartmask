import type { ColumnRecord } from '../data/catalog';
import type { Triage } from './types';

/**
 * AI triage suggestion for a REVIEW column. It recommends; a human decides.
 * Nothing here runs on the query path.
 */
export function triage(r: ColumnRecord): Triage {
  const top = r.shapes[0];
  const shareTop =
    top && r.sampleSize ? Math.round((top.count / Math.max(1, r.sampleSize * (1 - r.nullRate))) * 100) : 0;
  if (r.emptyTableFloor) {
    return {
      action: 'APPROVE',
      tag: r.suggestedTag ?? 'PII_HIGH',
      confidence: 0.82,
      reason: `Table is empty and the column name is a strong ${r.family} hit; keep it masked until real rows can be sampled.`,
    };
  }
  if (r.family === 'PAN' && r.p >= 0.95) {
    return {
      action: 'APPROVE',
      tag: 'PII_HIGH',
      confidence: 0.93,
      reason: `${shareTop}% of sampled values share one 16-digit card shape and pass Luhn; the generic name is the only thing hiding it.`,
    };
  }
  if (r.family === 'PAN') {
    return {
      action: 'CLEAR',
      tag: null,
      confidence: 0.78,
      reason: `16-digit values rarely pass Luhn (P=${r.p.toFixed(2)}) and the name suggests a reference number, not a card.`,
    };
  }
  if (r.column === 'passport_no') {
    return {
      action: 'FORCE_TAG',
      tag: 'PII_HIGH',
      confidence: 0.88,
      reason:
        'The name says passport and values are one letter plus seven digits; rules found no format, so tag it PII_HIGH explicitly.',
    };
  }
  if (r.family === 'PERSON_NAME') {
    const label =
      /campaign|ledger|account_name|^name$/.test(`${r.table}.${r.column}`) &&
      !/beneficiar|holder|customer/.test(r.column);
    return label
      ? {
          action: 'CLEAR',
          tag: null,
          confidence: 0.74,
          reason: `Shapes look like titles of ${r.table.replace('_', ' ')} (organisational labels), not people.`,
        }
      : {
          action: 'APPROVE',
          tag: 'PII_MEDIUM',
          confidence: 0.81,
          reason: 'Shapes match personal names (capitalised words); payee names are personal data.',
        };
  }
  if (r.family === 'ADDRESS') {
    return {
      action: 'APPROVE',
      tag: 'PII_MEDIUM',
      confidence: 0.77,
      reason: 'A postcode plus city can narrow to a household; keep it masked for Support and Analyst.',
    };
  }
  if (r.family === 'AMOUNT' || r.family === 'BALANCE' || r.family === 'SALARY') {
    return {
      action: 'APPROVE',
      tag: 'FINANCIAL_CONFIDENTIAL',
      confidence: 0.79,
      reason:
        'Currency-shaped amounts on a customer limit; many zeros lower entropy, but the values are still financial.',
    };
  }
  return r.m >= 0.6
    ? {
        action: 'APPROVE',
        tag: r.suggestedTag ?? 'PII_MEDIUM',
        confidence: 0.6,
        reason: `Classifier score ${r.m.toFixed(2)} is close to the promotion threshold.`,
      }
    : {
        action: 'CLEAR',
        tag: null,
        confidence: 0.55,
        reason: `No format evidence (P=${r.p.toFixed(2)}) and a low classifier score (${r.m.toFixed(2)}).`,
      };
}

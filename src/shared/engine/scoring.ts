import {
  E164_RE,
  EMAIL_RE,
  digitsOnly,
  ibanValid,
  luhnValid,
  panFormat,
  ssnValid,
  verhoeffValid,
} from './validators';
import { FAMILY_TAG, type ColumnState, type Family, type Tag, type Value } from './types';

export const W_NAME = 0.3;
export const W_PATTERN = 0.55;
export const W_ENTROPY = 0.15;
export const THRESH_ENFORCED = 0.7;
export const THRESH_REVIEW = 0.4;
export const THRESH_ML = 0.85;

export function combineScore(n: number, p: number, e: number): number {
  return W_NAME * n + W_PATTERN * p + W_ENTROPY * e;
}

export function stateFromScore(s: number, m: number): ColumnState {
  const base: ColumnState = s >= THRESH_ENFORCED ? 'ENFORCED' : s >= THRESH_REVIEW ? 'REVIEW' : 'CLEAR';
  // The classifier may only promote. It can never clear a column.
  return base !== 'ENFORCED' && m >= THRESH_ML ? 'ENFORCED_ML' : base;
}

export function tokenize(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9À-ɏ]+|(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/)
    .filter(Boolean);
}

interface NameRule {
  family: Family;
  weight: number;
  all?: string[];
  any?: string[];
}

const NAME_QUALIFIERS = [
  'first',
  'last',
  'full',
  'middle',
  'maiden',
  'given',
  'family',
  'customer',
  'holder',
  'applicant',
  'cardholder',
];
const NAME_ANTI = [
  'merchant',
  'branch',
  'product',
  'bank',
  'campaign',
  'file',
  'team',
  'city',
  'table',
  'schema',
  'plan',
];

const NAME_RULES: NameRule[] = [
  { family: 'PAN', weight: 1, any: ['pan', 'cc', 'ccn'] },
  { family: 'PAN', weight: 1, all: ['card'], any: ['no', 'num', 'number', 'nbr', 'nr'] },
  { family: 'PAN', weight: 0.6, any: ['card'] },
  { family: 'SSN', weight: 1, any: ['ssn'] },
  { family: 'SSN', weight: 1, all: ['social', 'security'] },
  { family: 'AADHAAR', weight: 1, any: ['aadhaar', 'aadhar', 'uidai'] },
  { family: 'IBAN', weight: 1, any: ['iban'] },
  { family: 'ACCOUNT_NO', weight: 1, any: ['passport'] },
  { family: 'ACCOUNT_NO', weight: 1, all: ['account'], any: ['no', 'num', 'number', 'nbr'] },
  { family: 'ACCOUNT_NO', weight: 1, any: ['acct'] },
  { family: 'EMAIL', weight: 1, any: ['email', 'emailaddr'] },
  { family: 'EMAIL', weight: 0.6, any: ['mail'] },
  { family: 'PHONE', weight: 1, any: ['phone', 'mobile', 'msisdn', 'telephone', 'cell'] },
  { family: 'PHONE', weight: 0.8, any: ['tel', 'contactno'] },
  { family: 'PERSON_NAME', weight: 1, any: ['surname', 'fname', 'lname', 'forename'] },
  { family: 'DOB', weight: 1, any: ['dob', 'birth', 'birthdate', 'birthday'] },
  { family: 'ADDRESS', weight: 1, any: ['address', 'addr', 'street'] },
  { family: 'ADDRESS', weight: 0.8, any: ['postcode', 'zip', 'pincode', 'postal'] },
  { family: 'BALANCE', weight: 1, any: ['balance', 'bal'] },
  { family: 'SALARY', weight: 1, any: ['salary', 'income', 'wage', 'earnings'] },
  { family: 'AMOUNT', weight: 0.8, any: ['amount', 'amt', 'principal', 'emi', 'limit', 'overdraft'] },
];

export interface NameMatch {
  n: number;
  family: Family | null;
}

export function nameScore(column: string): NameMatch {
  const tokens = tokenize(column);
  const set = new Set(tokens);
  let best: NameMatch = { n: 0, family: null };
  for (const rule of NAME_RULES) {
    if (rule.all && !rule.all.every((t) => set.has(t))) continue;
    if (rule.any && !rule.any.some((t) => set.has(t))) continue;
    if (rule.weight > best.n) best = { n: rule.weight, family: rule.family };
  }
  if (set.has('name') || set.has('nm')) {
    const qualified = NAME_QUALIFIERS.some((q) => set.has(q));
    const anti = NAME_ANTI.some((q) => set.has(q));
    const w = anti ? 0.3 : qualified ? 1 : 0.6;
    if (w > best.n) best = { n: w, family: 'PERSON_NAME' };
  }
  return best;
}

/** Multilingual semantic lexicon the classifier uses where the rule dictionary has no entry. */
const SEMANTIC_LEXICON: Record<string, [Family, number]> = {
  kartu: ['PAN', 0.92],
  tarjeta: ['PAN', 0.92],
  carte: ['PAN', 0.9],
  karte: ['PAN', 0.9],
  kaart: ['PAN', 0.9],
  kad: ['PAN', 0.85],
  telepon: ['PHONE', 0.9],
  telefono: ['PHONE', 0.9],
  telefon: ['PHONE', 0.9],
  handy: ['PHONE', 0.85],
  alamat: ['ADDRESS', 0.9],
  direccion: ['ADDRESS', 0.9],
  adresse: ['ADDRESS', 0.9],
  nama: ['PERSON_NAME', 0.8],
  nombre: ['PERSON_NAME', 0.8],
  nom: ['PERSON_NAME', 0.7],
  surel: ['EMAIL', 0.9],
  correo: ['EMAIL', 0.9],
  saldo: ['BALANCE', 0.9],
  solde: ['BALANCE', 0.9],
  guthaben: ['BALANCE', 0.9],
  gaji: ['SALARY', 0.9],
  sueldo: ['SALARY', 0.9],
  nik: ['SSN', 0.85],
  ktp: ['SSN', 0.85],
};

function semanticName(column: string): { score: number; family: Family | null } {
  let best: { score: number; family: Family | null } = { score: 0, family: null };
  for (const t of tokenize(column)) {
    const hit = SEMANTIC_LEXICON[t];
    if (hit && hit[1] > best.score) best = { score: hit[1], family: hit[0] };
  }
  return best;
}

const isName = (s: string): boolean => /^[\p{Lu}][\p{L}'’.-]+(\s[\p{L}'’.-]+){0,3}$/u.test(s);

interface Evidence {
  /** Rule-engine evidence in [0, 1] for one sampled value, with the family it supports. */
  p: number;
  family: Family | null;
  /** Looser classifier-only evidence that ignores separators and obfuscation. */
  loose: number;
  looseFamily: Family | null;
}

function evidence(v: string, nameFamily: Family | null, n: number): Evidence {
  const raw = v.trim();
  const dig = digitsOnly(raw);
  const hasSep = /[ -]/.test(raw);
  let e: Evidence = { p: 0, family: null, loose: 0, looseFamily: null };
  const set = (p: number, family: Family): void => {
    if (p > e.p) e = { ...e, p, family };
  };
  const setLoose = (loose: number, family: Family): void => {
    if (loose > e.loose) e = { ...e, loose, looseFamily: family };
  };

  if (panFormat(raw)) set(luhnValid(raw) ? 1 : hasSep ? 0.65 : 0.55, 'PAN');
  if (ssnValid(raw)) set(1, 'SSN');
  if (/^\d{4} \d{4} \d{4}$/.test(raw)) set(verhoeffValid(raw) ? 1 : 0.65, 'AADHAAR');
  if (/^[A-Za-z]{2}\d{2}[ ]?[A-Za-z0-9 ]{10,32}$/.test(raw) && raw.replace(/\s/g, '').length >= 15) {
    if (ibanValid(raw)) set(1, 'IBAN');
  }
  if (EMAIL_RE.test(raw)) set(1, 'EMAIL');
  if (E164_RE.test(raw.replace(/[ -]/g, ''))) set(1, 'PHONE');

  // Name-conditioned weak shapes: only count when the column name already hints at the family.
  if (n >= 0.6 && nameFamily) {
    if (nameFamily === 'PERSON_NAME' && isName(raw)) set(0.6, 'PERSON_NAME');
    if (
      (nameFamily === 'BALANCE' || nameFamily === 'AMOUNT' || nameFamily === 'SALARY') &&
      /^-?\d+(\.\d{1,2})?$/.test(raw)
    )
      set(0.7, nameFamily);
    if (nameFamily === 'DOB' && /^\d{4}-\d{2}-\d{2}/.test(raw)) set(0.6, 'DOB');
    if (nameFamily === 'ADDRESS' && /\d/.test(raw) && /\s/.test(raw)) set(0.6, 'ADDRESS');
    if (nameFamily === 'ACCOUNT_NO' && /^\d{8,18}$/.test(raw)) set(0.6, 'ACCOUNT_NO');
  }

  // Classifier-only: separators are noise (dots, NBSP, slashes), so look at the bare digit run.
  if (dig.length >= 13 && dig.length <= 19 && /^[\d\s.\-/\u00a0]+$/.test(raw))
    setLoose(luhnValid(dig) ? 1 : 0.4, 'PAN');
  if (dig.length === 9 && /^[\d\s.\-/]+$/.test(raw)) setLoose(0.5, 'SSN');
  if (dig.length === 12 && /^[\d\s.\-/]+$/.test(raw)) setLoose(verhoeffValid(dig) ? 0.9 : 0.35, 'AADHAAR');
  if (/[\w.+-]+\s?(\[at\]|\(at\)| at )\s?[\w.-]+/i.test(raw)) setLoose(0.8, 'EMAIL');
  if (e.p > 0 && e.loose < e.p) e = { ...e, loose: e.p, looseFamily: e.family };
  return e;
}

export function shannonEntropy(strings: readonly string[]): number {
  const counts = new Map<string, number>();
  let total = 0;
  for (const s of strings) {
    for (const ch of s) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
      total++;
    }
  }
  if (!total) return 0;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

export function entropyScore(values: readonly string[]): number {
  if (!values.length) return 0;
  const h = shannonEntropy(values);
  const distinct = new Set(values).size / values.length;
  return Math.min(1, 0.6 * Math.min(1, h / 4) + 0.4 * distinct);
}

export interface MlContribution {
  feature: string;
  weight: number;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

export interface ScoreResult {
  n: number;
  p: number;
  e: number;
  s: number;
  m: number;
  family: Family;
  tag: Tag | null;
  suggestedTag: Tag | null;
  state: ColumnState;
  nullRate: number;
  emptyRate: number;
  sampleSize: number;
  emptyTableFloor: boolean;
  mlContributions: MlContribution[];
}

function fam(counts: Map<Family, number>): Family | null {
  let best: Family | null = null;
  let bc = 0;
  for (const [f, c] of counts) {
    if (c > bc) {
      best = f;
      bc = c;
    }
  }
  return best;
}

/**
 * Score one column from its name and a sample of its values.
 * S = 0.30 N + 0.55 P + 0.15 E ; classifier score M may promote but never clears.
 */
export function scoreColumn(column: string, sample: readonly Value[], tableIsEmpty = false): ScoreResult {
  const name = nameScore(column);
  const sem = semanticName(column);
  const nulls = sample.filter((v) => v === null).length;
  const strings = sample.filter((v): v is string | number | boolean => v !== null).map((v) => String(v));
  const empties = strings.filter((s) => s.trim() === '').length;
  const values = strings.filter((s) => s.trim() !== '');

  let pSum = 0;
  let looseSum = 0;
  const pFam = new Map<Family, number>();
  const lFam = new Map<Family, number>();
  for (const v of values) {
    const ev = evidence(v, name.family, name.n);
    pSum += ev.p;
    looseSum += ev.loose;
    if (ev.family) pFam.set(ev.family, (pFam.get(ev.family) ?? 0) + 1);
    if (ev.looseFamily) lFam.set(ev.looseFamily, (lFam.get(ev.looseFamily) ?? 0) + 1);
  }
  const p = values.length ? pSum / values.length : 0;
  const loose = values.length ? looseSum / values.length : 0;
  const e = entropyScore(values);
  let s = combineScore(name.n, p, e);
  const floor = tableIsEmpty && name.n >= 1;
  if (floor) s = Math.max(s, THRESH_REVIEW);

  const terms: MlContribution[] = [
    { feature: 'bias', weight: -4 },
    { feature: 'multilingual name embedding', weight: 3.2 * sem.score },
    { feature: 'separator-insensitive value shape', weight: 3.4 * loose },
    { feature: 'rule pattern evidence', weight: 1.1 * p },
    { feature: 'value entropy', weight: 0.6 * e },
  ];
  const m = tableIsEmpty
    ? sigmoid(terms[0]!.weight + terms[1]!.weight)
    : sigmoid(terms.reduce((a, t) => a + t.weight, 0));

  const nameFamily = name.n >= 0.8 || (name.n >= 0.6 && p >= 0.5) ? name.family : null;
  const family: Family =
    (p >= 0.5 ? fam(pFam) : null) ??
    nameFamily ??
    (sem.score >= 0.7 ? sem.family : null) ??
    (loose >= 0.6 ? fam(lFam) : null) ??
    (values.some((v) => v.length > 60) ? 'FREE_TEXT' : 'OTHER');

  const state = stateFromScore(s, m);
  const suggestedTag = FAMILY_TAG[family] ?? null;
  const tag = state === 'ENFORCED' || state === 'ENFORCED_ML' ? (suggestedTag ?? 'PII_MEDIUM') : null;
  return {
    n: name.n,
    p,
    e,
    s,
    m,
    family,
    tag,
    suggestedTag,
    state,
    nullRate: sample.length ? nulls / sample.length : 0,
    emptyRate: strings.length ? empties / strings.length : 0,
    sampleSize: sample.length,
    emptyTableFloor: floor,
    mlContributions: terms,
  };
}

const shapeOf = (v: string): string => {
  const out = v
    .slice(0, 28)
    .replace(/\p{Lu}/gu, 'A')
    .replace(/\p{Ll}/gu, 'a')
    .replace(/\d/g, '9');
  return v.length > 28 ? `${out}…` : out;
};

export interface ShapeBin {
  shape: string;
  count: number;
}

/** Shape histogram only (digits→9, letters→a/A). Raw values are never stored in the catalog. */
export function shapeHistogram(sample: readonly Value[], top = 6): ShapeBin[] {
  const counts = new Map<string, number>();
  for (const v of sample) {
    if (v === null) continue;
    const key = String(v) === '' ? '(empty)' : shapeOf(String(v));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([shape, count]) => ({ shape, count }))
    .sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape))
    .slice(0, top);
}

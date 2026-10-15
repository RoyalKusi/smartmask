import type { Rng } from './prng';

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

export function luhnValid(input: string): boolean {
  const d = digitsOnly(input);
  if (d.length < 12) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function luhnCheckDigit(partial: string): number {
  let sum = 0;
  let alt = true;
  for (let i = partial.length - 1; i >= 0; i--) {
    let n = partial.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return (10 - (sum % 10)) % 10;
}

/** Build a 16-digit PAN with a valid Luhn digit from a prefix. */
export function makePan(prefix: string, rng: Rng): string {
  const body = prefix + rng.digits(15 - prefix.length);
  return body + luhnCheckDigit(body);
}

export function groupPan(pan: string, sep = '-'): string {
  return pan.replace(/(\d{4})(?=\d)/g, `$1${sep}`);
}

const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
] as const;
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;
const VINV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9] as const;

const vd = (c: number, d: number): number => (VD[c] as readonly number[])[d] as number;
const vp = (i: number, d: number): number => (VP[i % 8] as readonly number[])[d] as number;

export function verhoeffValid(input: string): boolean {
  const d = digitsOnly(input);
  if (d.length < 2) return false;
  let c = 0;
  const rev = d.split('').reverse();
  for (let i = 0; i < rev.length; i++) c = vd(c, vp(i, Number(rev[i])));
  return c === 0;
}

export function verhoeffCheckDigit(partial: string): number {
  let c = 0;
  const rev = partial.split('').reverse();
  for (let i = 0; i < rev.length; i++) c = vd(c, vp(i + 1, Number(rev[i])));
  return VINV[c] as number;
}

export function makeAadhaar(rng: Rng): string {
  const body = String(rng.int(2, 9)) + rng.digits(10);
  return body + verhoeffCheckDigit(body);
}

export function formatAadhaar(a: string): string {
  return `${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`;
}

function mod97(numeric: string): number {
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return rem;
}

function ibanNumeric(rearranged: string): string {
  let out = '';
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    out += code >= 65 && code <= 90 ? String(code - 55) : ch;
  }
  return out;
}

export function ibanValid(input: string): boolean {
  const iban = input.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  return mod97(ibanNumeric(iban.slice(4) + iban.slice(0, 4))) === 1;
}

export function makeIban(country: 'GB' | 'DE', rng: Rng): string {
  const bban =
    country === 'GB'
      ? rng.pick(['NWBK', 'BARC', 'LOYD', 'HBUK']) + rng.digits(14)
      : rng.digits(18);
  const check = 98 - mod97(ibanNumeric(`${bban}${country}00`));
  const iban = `${country}${String(check).padStart(2, '0')}${bban}`;
  return iban.replace(/(.{4})/g, '$1 ').trim();
}

export function ssnValid(input: string): boolean {
  const m = /^(\d{3})-(\d{2})-(\d{4})$/.exec(input);
  if (!m) return false;
  const [, area, group, serial] = m as unknown as [string, string, string, string];
  return area !== '000' && area !== '666' && Number(area) < 900 && group !== '00' && serial !== '0000';
}

export function makeSsn(rng: Rng): string {
  let area = rng.int(1, 899);
  if (area === 666) area = 667;
  return `${String(area).padStart(3, '0')}-${String(rng.int(1, 99)).padStart(2, '0')}-${String(rng.int(1, 9999)).padStart(4, '0')}`;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;
export const E164_RE = /^\+[1-9]\d{7,14}$/;

/** Does a PAN-like format match (13–19 digits, optional 4-4-4-4 style separators)? */
export function panFormat(input: string): boolean {
  return /^\d{4}([ -]?)\d{4}\1\d{4}\1\d{1,7}$/.test(input) || /^\d{13,19}$/.test(input);
}

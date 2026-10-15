import { toHex } from './hash';
import type { Family, Value } from './types';

export type MaskFn = 'PLAINTEXT' | 'PARTIAL_KEEP' | 'PARTIAL_EMAIL' | 'BUCKET' | 'REDACT' | 'HMAC_TOKEN';
export const MASK_FNS: readonly MaskFn[] = [
  'PLAINTEXT',
  'PARTIAL_KEEP',
  'PARTIAL_EMAIL',
  'BUCKET',
  'REDACT',
  'HMAC_TOKEN',
];

export interface MaskArgs {
  keep_first?: number;
  keep_last?: number;
  width?: number;
}

export const REDACTED = '[REDACTED]';
export const DEFAULT_BUCKET_WIDTH = 50000;

/** Default PARTIAL_KEEP profile per detected family: how many leading/trailing characters survive. */
export function partialProfile(family: Family | undefined): { first: number; last: number } {
  switch (family) {
    case 'PAN':
    case 'IBAN':
      return { first: 4, last: 4 };
    case 'SSN':
    case 'AADHAAR':
    case 'PHONE':
    case 'ACCOUNT_NO':
      return { first: 0, last: 4 };
    case 'PERSON_NAME':
      return { first: 1, last: 0 };
    case 'EMAIL':
      return { first: 1, last: 0 };
    default:
      return { first: 0, last: 2 };
  }
}

const isAlnum = (ch: string): boolean => /[\p{L}\p{N}]/u.test(ch);

/** Keep the first/last N letters or digits, replace the rest with X, preserve separators. */
export function partialKeep(value: Value, first: number, last: number): Value {
  if (value === null) return null;
  const chars = Array.from(String(value));
  const alnumIdx = chars.map((c, i) => (isAlnum(c) ? i : -1)).filter((i) => i >= 0);
  const total = alnumIdx.length;
  // Never reveal more than half of a value, so very short values cannot leak in full.
  const budget = Math.floor(total / 2);
  if (first + last > budget) {
    last = Math.min(last, budget);
    first = Math.min(first, budget - last);
  }
  const out = chars.slice();
  alnumIdx.forEach((idx, pos) => {
    const keep = pos < first || pos >= total - last;
    if (!keep) out[idx] = 'X';
  });
  return out.join('');
}

/** r***@e***.in : first character of the local part, first of the domain, and the TLD. Plus-tags are dropped. */
export function partialEmail(value: Value): Value {
  if (value === null) return null;
  const s = String(value);
  const at = s.lastIndexOf('@');
  if (at < 1) return partialKeep(s, 1, 0);
  const local = Array.from(s.slice(0, at));
  const domain = s.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const host = Array.from(dot > 0 ? domain.slice(0, dot) : domain);
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0] ?? ''}***@${host[0] ?? ''}***${tld}`;
}

function groupThousands(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function bucket(value: Value, width = DEFAULT_BUCKET_WIDTH): Value {
  // NULL and empty string carry no amount: they pass through (revealing only absence) rather than becoming a bucket for 0.
  if (value === null || value === '') return value;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || width <= 0) return REDACTED;
  const lo = Math.floor(n / width) * width;
  return `${groupThousands(lo)}–${groupThousands(lo + width - 1)}`;
}

export function redact(value: Value): Value {
  return value === null ? null : REDACTED;
}

const encoder = new TextEncoder();

/**
 * Deterministic HMAC-SHA-256 pseudonymisation. One HKDF-derived key per tag, so
 * equal inputs always yield equal tokens (joins keep working) while tags stay domain-separated.
 */
export class TokenVault {
  private readonly keys = new Map<string, Promise<CryptoKey>>();
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly masterSecret: string,
    private readonly salt = 'smartmask/v1',
  ) {}

  private key(tag: string): Promise<CryptoKey> {
    let k = this.keys.get(tag);
    if (!k) {
      k = (async () => {
        const base = await crypto.subtle.importKey('raw', encoder.encode(this.masterSecret), 'HKDF', false, [
          'deriveKey',
        ]);
        return crypto.subtle.deriveKey(
          {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: encoder.encode(this.salt),
            info: encoder.encode(`token:${tag}`),
          },
          base,
          { name: 'HMAC', hash: 'SHA-256', length: 256 },
          false,
          ['sign'],
        );
      })();
      this.keys.set(tag, k);
    }
    return k;
  }

  async token(tag: string, value: string): Promise<string> {
    const ck = `${tag}\u0000${value}`;
    const hit = this.cache.get(ck);
    if (hit) return hit;
    const sig = await crypto.subtle.sign('HMAC', await this.key(tag), encoder.encode(value));
    const tok = `tok_${toHex(sig).slice(0, 24)}`;
    this.cache.set(ck, tok);
    return tok;
  }

  /** Synchronous lookup of a token that was primed earlier; undefined when not primed (callers fail closed). */
  peek(tag: string, value: string): string | undefined {
    return this.cache.get(`${tag}\u0000${value}`);
  }

  async prime(pairs: Iterable<readonly [string, string]>): Promise<void> {
    const work: Promise<string>[] = [];
    for (const [tag, v] of pairs) if (!this.cache.has(`${tag}\u0000${v}`)) work.push(this.token(tag, v));
    await Promise.all(work);
  }
}

export interface MaskContext {
  tag: string;
  family?: Family;
  vault: TokenVault;
}

/** Apply one masking function. Missing tokens fail closed to [REDACTED]. */
export function applyMask(fn: MaskFn, value: Value, args: MaskArgs, ctx: MaskContext): Value {
  switch (fn) {
    case 'PLAINTEXT':
      return value;
    case 'PARTIAL_KEEP': {
      const p = partialProfile(ctx.family);
      return partialKeep(value, args.keep_first ?? p.first, args.keep_last ?? p.last);
    }
    case 'PARTIAL_EMAIL':
      return ctx.family === 'EMAIL' || (typeof value === 'string' && value.includes('@'))
        ? partialEmail(value)
        : applyMask('PARTIAL_KEEP', value, args, ctx);
    case 'BUCKET':
      return bucket(value, args.width ?? DEFAULT_BUCKET_WIDTH);
    case 'REDACT':
      return redact(value);
    case 'HMAC_TOKEN': {
      if (value === null) return null;
      return ctx.vault.peek(ctx.tag, String(value)) ?? REDACTED;
    }
  }
}

import { describe, expect, it } from 'vitest';
import { sha256Hex, sha256HexSync } from '../../src/shared/engine/hash';
import { TokenVault, applyMask, bucket, partialEmail, partialKeep, redact } from '../../src/shared/engine/masking';

describe('masking functions', () => {
  it('PARTIAL_KEEP keeps first/last alphanumerics and preserves separators', () => {
    expect(partialKeep('4111-1111-1111-1111', 4, 4)).toBe('4111-XXXX-XXXX-1111');
    expect(partialKeep('123-45-6789', 0, 4)).toBe('XXX-XX-6789');
    expect(partialKeep('Zoë Müller', 1, 0)).toBe('ZXX XXXXXX');
    expect(partialKeep(null, 4, 4)).toBeNull();
    expect(partialKeep('12', 0, 4)).toBe('X2');
    expect(partialKeep('AB', 4, 4)).toBe('XB');
  });

  it('PARTIAL_EMAIL drops plus-tags and unicode is handled', () => {
    expect(partialEmail('ravi.kumar+bank@example.in')).toBe('r***@e***.in');
    expect(partialEmail('josé@example.com')).toBe('j***@e***.com');
    expect(partialEmail(null)).toBeNull();
  });

  it('BUCKET uses width 50,000', () => {
    expect(bucket('128450.00', 50000)).toBe('100,000–149,999');
    expect(bucket(0, 50000)).toBe('0–49,999');
    expect(bucket(2_400_000, 50000)).toBe('2,400,000–2,449,999');
  });

  it('REDACT hides every value but keeps NULL', () => {
    expect(redact('anything')).toBe('[REDACTED]');
    expect(redact(null)).toBeNull();
  });

  it('HMAC_TOKEN is tok_ + 24 hex, deterministic, domain-separated per tag', async () => {
    const v = new TokenVault('secret');
    const a = await v.token('PII_HIGH', '123-45-6789');
    const b = await v.token('PII_HIGH', '123-45-6789');
    const c = await v.token('PII_MEDIUM', '123-45-6789');
    const d = await v.token('PII_HIGH', '123-45-6780');
    expect(a).toMatch(/^tok_[0-9a-f]{24}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(applyMask('HMAC_TOKEN', '123-45-6789', {}, { tag: 'PII_HIGH', vault: v })).toBe(a);
  });

  it('fails closed when a token was not primed', () => {
    expect(applyMask('HMAC_TOKEN', 'never-primed', {}, { tag: 'PII_HIGH', vault: new TokenVault('x') })).toBe('[REDACTED]');
  });
});

describe('sha256', () => {
  it('sync implementation matches Web Crypto', async () => {
    for (const s of ['', 'abc', 'Meridian Savings Bank', 'é'.repeat(100), 'x'.repeat(1000)]) {
      expect(sha256HexSync(s)).toBe(await sha256Hex(s));
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/shared/engine/prng';
import { ibanValid, luhnValid, makeAadhaar, makeIban, makePan, makeSsn, ssnValid, verhoeffValid } from '../../src/shared/engine/validators';

describe('validators and generators', () => {
  const rng = createRng(42);
  it('Luhn accepts the demo PAN and rejects the Luhn-failing one', () => {
    expect(luhnValid('4111-1111-1111-1111')).toBe(true);
    expect(luhnValid('4111-2345-6789-1111')).toBe(false);
  });
  it('generated PANs are Luhn-valid in the Visa and Mastercard test ranges', () => {
    for (let i = 0; i < 200; i++) {
      expect(luhnValid(makePan('4111', rng))).toBe(true);
      expect(luhnValid(makePan('5555', rng))).toBe(true);
    }
  });
  it('generated Aadhaar-style numbers pass Verhoeff and corrupted ones fail', () => {
    for (let i = 0; i < 200; i++) {
      const a = makeAadhaar(rng);
      expect(verhoeffValid(a)).toBe(true);
      const bad = a.slice(0, 11) + String((Number(a[11]) + 1) % 10);
      expect(verhoeffValid(bad)).toBe(false);
    }
  });
  it('generated IBANs satisfy mod-97', () => {
    for (let i = 0; i < 100; i++) {
      expect(ibanValid(makeIban('GB', rng))).toBe(true);
      expect(ibanValid(makeIban('DE', rng))).toBe(true);
    }
    expect(ibanValid('GB00 NWBK 6016 1331 9268 19')).toBe(false);
  });
  it('SSN-style identifiers are structurally valid', () => {
    for (let i = 0; i < 200; i++) expect(ssnValid(makeSsn(rng))).toBe(true);
  });
});

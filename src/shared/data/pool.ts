import { createRng, type Rng } from '../engine/prng';
import { formatAadhaar, groupPan, makeAadhaar, makeIban, makePan, makeSsn } from '../engine/validators';
import { CITIES, EMAIL_DOMAINS, LOCALE_WEIGHTS, NAMES, STREETS, type Locale } from './lists';

import { DAY, DEMO_NOW, isoDate } from './clock';

export { DAY, DEMO_NOW, iso, isoDate, money } from './clock';

export interface Person {
  id: number;
  first: string;
  last: string;
  locale: Locale;
  email: string;
  phone: string | null;
  dob: string;
  ssn: string;
  aadhaar: string | null;
  address: string | null;
  city: string;
  postcode: string | null;
  country: string;
  createdMs: number;
}

export interface AccountRec {
  id: number;
  customerId: number;
  accountNo: string;
  iban: string;
  balance: number;
  currency: string;
}

export interface CardRec {
  id: number;
  customerId: number;
  accountId: number;
  pan: string;
  brand: 'VISA' | 'MASTERCARD';
}

export interface LoanRec {
  id: number;
  customerId: number;
  principal: number;
}

export interface Pool {
  customers: Person[];
  accounts: AccountRec[];
  cards: CardRec[];
  loans: LoanRec[];
  cardsByAccount: Map<number, CardRec[]>;
}

const COUNTRY: Record<Locale, string> = { IN: 'IN', ZW: 'ZW', UK: 'GB', US: 'US' };
const strip = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

function phoneFor(locale: Locale, rng: Rng): string {
  switch (locale) {
    case 'IN':
      return `+91${rng.int(6, 9)}${rng.digits(9)}`;
    case 'ZW':
      return `+2637${rng.int(1, 8)}${rng.digits(7)}`;
    case 'UK':
      return `+447${rng.digits(9)}`;
    case 'US':
      return `+1${rng.int(2, 9)}${rng.digits(2)}${rng.int(2, 9)}${rng.digits(6)}`;
  }
}

function postcodeFor(locale: Locale, rng: Rng): string | null {
  const L = 'ABCDEFGHJKLMNPRSTUVWXY';
  switch (locale) {
    case 'IN':
      return `${rng.int(1, 8)}${rng.digits(5)}`;
    case 'UK':
      return `${rng.pick([...'SWMLEBNG'])}${rng.pick([...'ABCDEJKLMNPRSTUWXY'])}${rng.int(1, 19)} ${rng.int(1, 9)}${rng.pick([...L])}${rng.pick([...L])}`;
    case 'US':
      return rng.digits(5);
    case 'ZW':
      return null;
  }
}

function makePerson(id: number, rng: Rng): Person {
  const locale = rng.weighted(LOCALE_WEIGHTS);
  const nm = NAMES[locale];
  let first = rng.pick(nm.first);
  let last = rng.pick(nm.last);
  let localPart: string;
  if (id === 1) {
    first = 'Aarav';
    last = 'Mehta';
  }
  const unicodeEmail = rng.chance(0.03) && /\P{ASCII}/u.test(first + last);
  localPart = unicodeEmail
    ? `${first}.${last}`.toLowerCase().replace(/[^\p{L}.]/gu, '')
    : `${strip(first)}.${strip(last)}`;
  if (rng.chance(0.3)) localPart += rng.int(1, 99);
  if (rng.chance(0.08)) localPart += `+${rng.pick(['bank', 'shop', 'news', 'cards'])}`;
  const email = `${localPart}@${rng.pick(EMAIL_DOMAINS[locale])}`;
  const age = rng.int(18, 84);
  const dobMs = DEMO_NOW - age * 365.25 * DAY - rng.int(0, 364) * DAY;
  const addrRoll = rng.next();
  const city = rng.pick(CITIES[locale]);
  return {
    id,
    first,
    last,
    locale,
    email,
    phone: rng.chance(0.03) ? null : phoneFor(locale, rng),
    dob: isoDate(dobMs),
    ssn: makeSsn(rng),
    aadhaar: locale === 'IN' ? formatAadhaar(makeAadhaar(rng)) : null,
    address: addrRoll < 0.02 ? '' : addrRoll < 0.03 ? null : `${rng.int(1, 240)} ${rng.pick(STREETS)}`,
    city,
    postcode: postcodeFor(locale, rng),
    country: COUNTRY[locale],
    createdMs: DEMO_NOW - rng.int(30, 3200) * DAY,
  };
}

export const SIZES = { customers: 5000, accounts: 6500, cards: 6000, loans: 1800 } as const;

let cached: Pool | null = null;

export function getPool(): Pool {
  if (cached) return cached;
  const rng = createRng('pool:v1');
  const customers: Person[] = [];
  for (let i = 1; i <= SIZES.customers; i++) customers.push(makePerson(i, rng));

  const accounts: AccountRec[] = [];
  for (let i = 1; i <= SIZES.accounts; i++) {
    const customerId = i <= SIZES.customers ? i : rng.int(1, SIZES.customers);
    const raw = rng.chance(0.05) ? 0 : Math.min(2_400_000, rng.logNormal(10.4, 1.6));
    accounts.push({
      id: i,
      customerId,
      accountNo: `${rng.pick(['301', '302', '455', '620'])}${rng.digits(9)}`,
      iban: makeIban(rng.chance(0.7) ? 'GB' : 'DE', rng),
      balance: i === 1 ? 128450 : Math.round(raw * 100) / 100,
      currency: rng.weighted([
        ['INR', 40],
        ['GBP', 25],
        ['USD', 20],
        ['ZWG', 15],
      ]),
    });
  }

  const cards: CardRec[] = [];
  const cardsByAccount = new Map<number, CardRec[]>();
  for (let i = 1; i <= SIZES.cards; i++) {
    const acct =
      i === 1 ? (accounts[0] as AccountRec) : (accounts[rng.int(0, accounts.length - 1)] as AccountRec);
    const visa = i === 1 ? true : rng.chance(0.6);
    const pan = i === 1 ? '4111111111111111' : makePan(visa ? '4111' : '5555', rng);
    const rec: CardRec = {
      id: i,
      customerId: acct.customerId,
      accountId: acct.id,
      pan: groupPan(pan),
      brand: visa ? 'VISA' : 'MASTERCARD',
    };
    cards.push(rec);
    const list = cardsByAccount.get(acct.id) ?? [];
    list.push(rec);
    cardsByAccount.set(acct.id, list);
  }

  const loans: LoanRec[] = [];
  for (let i = 1; i <= SIZES.loans; i++) {
    loans.push({
      id: i,
      customerId: rng.int(1, SIZES.customers),
      principal: Math.round(Math.min(2_000_000, Math.max(20_000, rng.logNormal(12.1, 0.8)))),
    });
  }
  cached = { customers, accounts, cards, loans, cardsByAccount };
  return cached;
}

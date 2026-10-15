import { createRng } from '../engine/prng';
import type { Role } from '../engine/types';
import { DAY, DEMO_NOW, iso } from './pool';

export interface Principal {
  id: string;
  name: string;
  email: string;
  role: Role;
  group: string;
  lastSeen: string;
  location: string;
}

const ROSTER: [string, string, Role, string][] = [
  ['n.sibanda', 'Nokuthula Sibanda', 'ROLE_ADMIN', 'platform-admins'],
  ['a.mehta', 'Aarav Mehta', 'ROLE_ADMIN', 'platform-admins'],
  ['o.taylor', 'Oliver Taylor', 'ROLE_ADMIN', 'security-governance'],
  ['svc.etl', 'ETL Service Account', 'ROLE_ADMIN', 'service-accounts'],
  ['p.iyer', 'Priya Iyer', 'ROLE_SUPPORT', 'cards-support'],
  ['t.moyo', 'Tendai Moyo', 'ROLE_SUPPORT', 'cards-support'],
  ['i.green', 'Isla Green', 'ROLE_SUPPORT', 'cards-support'],
  ['r.dube', 'Rudo Dube', 'ROLE_SUPPORT', 'lending-support'],
  ['k.singh', 'Karan Singh', 'ROLE_SUPPORT', 'lending-support'],
  ['m.evans', 'Mia Evans', 'ROLE_SUPPORT', 'deposits-support'],
  ['f.ncube', 'Farai Ncube', 'ROLE_SUPPORT', 'deposits-support'],
  ['a.kulkarni', 'Ananya Kulkarni', 'ROLE_SUPPORT', 'disputes-support'],
  ['j.lopez', 'José Lopez', 'ROLE_SUPPORT', 'disputes-support'],
  ['m.desai', 'Meera Desai', 'ROLE_ANALYST', 'risk-analytics'],
  ['t.chikwanha', 'Tafara Chikwanha', 'ROLE_ANALYST', 'risk-analytics'],
  ['h.walker', 'Harry Walker', 'ROLE_ANALYST', 'risk-analytics'],
  ['s.nair', 'Siddharth Nair', 'ROLE_ANALYST', 'finance-bi'],
  ['z.muller', 'Zoë Müller', 'ROLE_ANALYST', 'finance-bi'],
  ['l.davis', 'Logan Davis', 'ROLE_ANALYST', 'finance-bi'],
  ['v.reddy', 'Vihaan Reddy', 'ROLE_ANALYST', 'fraud-ops'],
  ['c.mutasa', 'Chipo Mutasa', 'ROLE_ANALYST', 'fraud-ops'],
  ['e.hughes', 'Eilidh Hughes', 'ROLE_ANALYST', 'fraud-ops'],
  ['d.joshi', 'Diya Joshi', 'ROLE_ANALYST', 'marketing-insights'],
  ['n.okafor', 'Niamh Okafor', 'ROLE_ANALYST', 'marketing-insights'],
  ['b.makoni', 'Blessing Makoni', 'ROLE_ANALYST', 'marketing-insights'],
];

const LOCATIONS = ['Mumbai', 'Harare', 'London', 'Austin', 'Bengaluru', 'Bulawayo'];

export const PRINCIPALS: Principal[] = (() => {
  const rng = createRng('principals');
  return ROSTER.map(([id, name, role, group]) => ({
    id,
    name,
    email: `${id.replace(/^svc\./, 'svc-')}@meridiansavings.example`,
    role,
    group,
    lastSeen: iso(DEMO_NOW - rng.int(2, 60 * 24 * 6) * 60_000 - (id === 'svc.etl' ? 0 : DAY / 24)),
    location: id.startsWith('svc.') ? 'Datacentre' : rng.pick(LOCATIONS),
  }));
})();

export const principalById = (id: string): Principal | undefined => PRINCIPALS.find((p) => p.id === id);
export const principalsOf = (role: Role): Principal[] => PRINCIPALS.filter((p) => p.role === role);

export interface PolicyVersionLog {
  version: number;
  at: string;
  author: string;
  reason: string;
}

export const POLICY_HISTORY: PolicyVersionLog[] = [
  { version: 1, at: '2026-04-02 09:12:00', author: 'n.sibanda', reason: 'Initial policy: Admin plaintext, Support partial, Analyst redacted.' },
  { version: 2, at: '2026-05-19 14:40:00', author: 'o.taylor', reason: 'Added BUCKET (width 50,000) for Support on FINANCIAL_CONFIDENTIAL.' },
  { version: 3, at: '2026-06-30 11:05:00', author: 'o.taylor', reason: 'Analyst PII_HIGH moved from REDACT to HMAC_TOKEN so joins keep working.' },
  { version: 4, at: '2026-08-11 16:22:00', author: 'n.sibanda', reason: 'Email-specific rule: PARTIAL_EMAIL for Support.' },
  { version: 5, at: '2026-09-04 10:31:00', author: 'a.mehta', reason: 'Tightened Analyst PII_MEDIUM to REDACT after privacy review.' },
  { version: 6, at: '2026-10-02 08:50:00', author: 'o.taylor', reason: 'Fail-closed default made explicit (fail_mode: closed).' },
  { version: 7, at: '2026-10-09 13:15:00', author: 'n.sibanda', reason: 'Support FINANCIAL_CONFIDENTIAL bucket width confirmed at 50,000.' },
];

export interface ScanLog {
  id: string;
  at: string;
  backend: string;
  columns: number;
  enforced: number;
  review: number;
  durationMs: number;
}

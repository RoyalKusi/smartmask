# Self-review checklist

Each requirement from the brief, with where it lives and how it was verified. Items marked **deviation** or **partial**
say exactly what differs. Numbers come from runs on this repository at the time of writing; latency numbers are
simulated by design.

## 0. Product facts

| Requirement | Status | Evidence |
| --- | --- | --- |
| `S = 0.30·N + 0.55·P + 0.15·E`; ≥ 0.70 ENFORCED, 0.40–0.69 REVIEW (masked fail-closed), < 0.40 CLEAR | Done | `shared/engine/scoring.ts`; `tests/unit/scoring.test.ts` |
| ML promotes to `ENFORCED_ML` at `M ≥ 0.85`, can never clear | Done | `stateFromScore` + property test over random `(S, M)`; `contacts.nomor_kartu` |
| Tags and roles; `4111-XXXX-XXXX-1111`, bucketed balances, `[REDACTED]`, `tok_` + 24 hex | Done | `masking.ts`; golden tests in `pipeline.test.ts`; Workbench |
| Base tables read-only; every query writes a hash-chained JSON audit event | Done | frozen rows (a write throws, tested); `audit.ts`; Verification view |
| Overhead budget < 5 ms at P99; PostgreSQL secure views (A), SQLite/MySQL AST rewriting (B) | Done (simulated timings) | `simulateStages` (tested ≤ 4.6 ms, < 5.0 ms ceiling); `rewrite` golden tests per dialect |
| AI recommends, drafts, alerts; never decides on the query path | Done | triage, Copilot and Isolation Forest only produce suggestions; the pipeline imports none of them |

## 1. Visual and design system

| Requirement | Status | Evidence |
| --- | --- | --- |
| React 18, strict TS, Vite, Fluent UI v9 + icons, `FluentProvider`, `smartmask` token layer | Done | `shared/ui/tokens.ts`, `app/App.tsx` |
| No hard-coded hex in components | Done | colour literals only in `tokens.ts`; components use `var(--sm-*)` |
| Typography stack and ramp, tabular numerals, never below 12 px | Done | `styles.css` (`t-*` classes); the only 10 px class (`t-caption2`) is used for the matrix hint under tag names, which is a supplementary label |
| Light/dark colour tokens, tag and status triplets, paired with icon or label | Done | `PALETTES`; chips always carry an icon or text |
| WCAG 2.2 AA, 2 px brand focus ring with 2 px gap | Verified | axe-core on all nine views and overlays in both themes (`a11y.spec.ts`); `:focus-visible` outline |
| Layout: 4 px grid, radii, adaptive breakpoints, 280 px blade ↔ 48 px rail (persisted), 12-column grid, 1600 px max | Done | `styles.css`; `responsive.spec.ts` |
| Materials: mica (noise + brand tint), acrylic on transient surfaces, opaque fallback under `prefers-reduced-transparency`, shadow depths, dark-mode inner highlight | Done | `.sm-app`, `.sm-acrylic`, `--sm-shadow*` |
| Motion: curves, 90/150/200/300 ms, row slide, 400 ms count-up, 160 ms character cross-fade, reduced motion | Done | `styles.css`, `CountUp.tsx`, `MaskedText.tsx` |

## 2. Interface and components

| Requirement | Status | Evidence |
| --- | --- | --- |
| 48 px command bar: mark, Ctrl+K search, environment pill, theme toggle, role segmented control, account menu | Done | `app/Shell.tsx`, `Overlays.tsx` |
| Collapsible blade, breadcrumb, page-level command bar | Done | `Shell.tsx`, `ViewFrame.tsx` |
| Nine views, all fully built | Done | `src/features/*` (no stubs; each has populated, loading, empty and error states) |
| Tables: sticky header, 36/28 px rows, keyboard navigation, column resizing, multi-select + bulk bar, virtualization > 100 rows, empty/loading/error | Done | `shared/ui/DataTable.tsx`; keyboard test in `responsive.spec.ts` |
| Three-step wizards (Add backend, Override column, Export report), validation on blur, disabled primary until valid | Done | `app/Wizards.tsx`, `shared/ui/Wizard.tsx` |
| 480 px right drawer with Details / Lineage / History | Done | `app/Drawer.tsx` (columns, audit events, tables, alerts) |
| Tooltips, click-through filtering, keyboard-focusable data points | Done | donut + legend click-through; Recharts accessibility layer; table alternative on every chart |

## 3. Functional flows

| Requirement | Status | Evidence |
| --- | --- | --- |
| Every flow is an explicit FSM (`idle → loading → success\|empty\|error`, `retrying`) | Done | `engine/fsm.ts` (unit-tested), `useLoadMachine`, query and scan machines |
| Simulated API: reads 120–400 ms, scans 2.4 s with five stages, queries 80–260 ms + overhead, mulberry32 | Done | `shared/api/server.ts` |
| Hidden Chaos menu (Ctrl+Shift+E): 500s, timeouts, catalog outage | Done (+ audit-queue-full) | `app/Overlays.tsx`, `shared/api/chaos.ts`; e2e chaos test |
| Skeletons matching final geometry; toasts (acrylic, top-right, stacked, 5 s, pause on hover, Undo); confirmation for destructive actions | Done | `shared/ui/Skeleton.tsx`, `ToasterHost.tsx`; dialogs for Clear, Dismiss, Tamper |
| Per-view error boundaries with code, technical details, Retry | Done | `ViewBoundary`, `ErrorPanel`; codes `SM-CAT-001`, `SM-API-500`, `SM-API-408`, `SM-UI-001` |
| Inline policy violations `SM-PRED-001`, `SM-DERIVED-001`, `SM-PARSE-001`, `SM-AUDIT-001` | Done | Workbench message bars; unit and e2e tests |
| Role switch re-masks with cross-fade and the audit feed logs it | Done | e2e flow 1; `ROLE_SWITCH` events |
| Run query: parse, validate, rewrite, execute, mask, audit with animated stages | Done | `WorkbenchView.tsx` |
| Real masking functions; Web Crypto HMAC-SHA-256 keyed through HKDF per tag; joins visibly work | Done | `TokenVault`; token-join unit and e2e tests |
| Scan and review keep catalog, Overview counters and audit consistent | Done | e2e flow 4 (45 → 46 enforced; audit event present) |
| Policy edit: invalid YAML disables Save and highlights the line; valid edit updates the matrix and bumps `policy_version`, invalidating the cache | Done | e2e flows 6 and 7 (`plan cache miss` after a bump) |
| Tamper test breaks the chain from that row onward; Verify Chain pinpoints it | Done | `audit.test.ts`; e2e flow 8 |
| Export Report generates JSON and CSV of the current view | Done | e2e flow 10 |
| Filters, sorts, tabs and role live in the URL and survive refresh; Back/Forward work | Done | `app/router.ts`; e2e flow 11 |

## 4. Synthetic data

| Requirement | Status | Evidence |
| --- | --- | --- |
| Fictional retail bank; 22 tables over three backends; ≈ 190 columns | Done | 22 tables, 192 columns (`dataset.test.ts`, `scoring.test.ts`) |
| 5,000 customers; locale-accurate names; E.164; Luhn PANs; mod-97 IBANs; Verhoeff Aadhaar; SSN-style; log-normal balances; 60,000 transactions; canonical row | Done | `dataset.test.ts` verifies validity and counts |
| Edge cases: non-card `order_ref`, `nomor_kartu`, `c1`, Luhn-failing PAN (S = 0.725), nulls/empties, rename → drift rescan, unicode and plus-addressing, duplicate SSNs, empty table floored at 0.40 | Done | each asserted in `scoring.test.ts`/`dataset.test.ts`; the S = 0.725 column is calibrated by data design (see below) |
| 14 days of per-minute telemetry, stage ranges, spikes ≤ 4.6 ms, cache ≈ 92 %, three injected anomalies | Done | `telemetry.ts`, `auditSeed.ts`; `seed.test.ts` |
| 25 principals; 8,000 audit events with real SHA-256 chaining; status logs; policy versions v1–v7 | Done | `principals.ts`, `auditSeed.ts` |

## 5. Technical constraints

| Requirement | Status | Evidence |
| --- | --- | --- |
| Feature-sliced layout; framework-free `shared/engine` with unit tests | Done | no React imports under `shared/engine` |
| Zustand, TanStack Query, TanStack Table + virtual, Recharts from tokens, CodeMirror 6 | Done (**deviation**: TanStack Table v8) | v9 has a different, new API; v8 is the stable one |
| Zero stubs, TODOs, `any`, console errors | Verified | ESLint (`no-explicit-any` as error, `--max-warnings 0`); e2e asserts no console errors during the role-switch flow; `grep` for TODO |
| ESLint, Prettier, strict TS configs | Done | `eslint.config.js`, `.prettierrc.json`, `tsconfig.json` |
| Accessibility: keyboard, focus order and return, live regions, labelled charts with table alternatives, axe clean in both themes | Verified | `a11y.spec.ts`, keyboard tests |
| Performance: FCP < 1.2 s, interactions < 100 ms, bundle < 350 KB gzip for the initial route | See notes | measured numbers below |
| Testing: Vitest goldens per role and dialect, property tests, Playwright for the flows, visual snapshots in light and dark | Done | `tests/unit`, `tests/e2e` |
| Honesty: persistent badge; latency labelled simulated | Done | badge on every screen; "simulated" on every latency figure |

## Measured numbers (this machine, headless Chromium, local server)

* Unit and property tests: see `npm test` output.
* End-to-end: 16 flow tests, axe-core on 9 views × 2 themes plus overlays, responsive and keyboard tests, 18 visual snapshots.
* JavaScript for the Overview route (`npm run size`): see the "Bundle" section below.
* First contentful paint: ≈ 0.25–0.4 s headless (software rendering, local server). This is not a field measurement.

## Known gaps and honest caveats

* Bundle and FCP numbers are lab figures from a local server; real networks will differ.
* The classifier is a small deterministic logistic model, not a trained network; it is explainable per feature in the
  drawer, and is the part most worth replacing in a real system.
* The SQL executor is intentionally small: no window functions, no `DISTINCT ON`, a fixed set of scalar functions.
* The S = 0.725 legacy-PAN column and the S ≈ 0.46 `order_ref` column are produced by the real scorer over *engineered*
  sample data (alphabet and pool size were tuned so the stated numbers come out). The scorer itself has no special cases.

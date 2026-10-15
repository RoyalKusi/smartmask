import { Button, DrawerBody, DrawerHeader, DrawerHeaderTitle, OverlayDrawer, Tab, TabList } from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';
import { useMemo, type ReactNode } from 'react';
import { applyMask, TokenVault } from '../shared/engine/masking';
import { resolveMask, type Policy } from '../shared/engine/policyCore';
import { ROLES, type Family } from '../shared/engine/types';
import type { AuditEvent, ColumnRecord } from '../shared/api/types';
import { effectiveTag } from '../shared/data/catalogTypes';
import { Chip, OutcomeChip, RoleChip, StateChip, TagChip } from '../shared/ui/Chips';
import { fmtTime, roleLabel, shortHash } from '../shared/ui/format';
import { NpeBars } from '../shared/ui/Gauge';
import { useAnomalies, useAudit, useColumns, usePolicy, useVerification } from './queries';
import { setParams, useParam } from './router';

type Kind = 'column' | 'audit' | 'table' | 'alert';

const EXAMPLE: Partial<Record<Family, string>> = {
  PAN: '4111-1111-1111-1111', SSN: '123-45-6789', AADHAAR: '2345 6789 0123', IBAN: 'GB82 WEST 1234 5698 7654 32', EMAIL: 'aarav.mehta@example.in',
  PHONE: '+919876543210', PERSON_NAME: 'Aarav Mehta', BALANCE: '128450.00', AMOUNT: '48250.00', SALARY: '86000.00', DOB: '1989-04-17', ADDRESS: '14 Station Road', ACCOUNT_NO: '301245678901',
};
const demoVault = new TokenVault('drawer-illustration-only');

export function ContextDrawer() {
  const [open, setOpen] = useParam('open', '');
  const [tab] = useParam('dtab', 'details');
  const [kind, id] = open.includes(':') ? ([open.slice(0, open.indexOf(':')) as Kind, open.slice(open.indexOf(':') + 1)] as const) : ([null, ''] as const);
  return (
    <OverlayDrawer
      open={!!kind}
      position="end"
      onOpenChange={(_, d) => !d.open && setOpen(null, false)}
      style={{ width: 480, maxWidth: '100vw' }}
      className="sm-acrylic"
      aria-label="Details"
      modalType="non-modal"
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={<Button appearance="subtle" aria-label="Close details" icon={<Dismiss24Regular />} onClick={() => setOpen(null, false)} />}
        >
          {kind === 'column' ? 'Column' : kind === 'audit' ? 'Audit event' : kind === 'table' ? 'Base table' : kind === 'alert' ? 'Anomaly' : ''}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        {kind && (
          <div className="sm-drawer-body">
            <TabList selectedValue={tab} onTabSelect={(_, d) => setParams({ dtab: d.value === 'details' ? null : String(d.value) }, { replace: true })}>
              <Tab value="details">Details</Tab>
              <Tab value="lineage">Lineage</Tab>
              <Tab value="history">History</Tab>
            </TabList>
            {kind === 'column' && <ColumnPanel id={id} tab={tab} />}
            {kind === 'audit' && <AuditPanel id={Number(id)} tab={tab} />}
            {kind === 'table' && <TablePanel name={id} tab={tab} />}
            {kind === 'alert' && <AlertPanel id={id} tab={tab} />}
          </div>
        )}
      </DrawerBody>
    </OverlayDrawer>
  );
}

function Missing({ what }: { what: string }) {
  return <p className="t-secondary">{what} is not available (it may have been renamed or removed by a rescan).</p>;
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="sm-kv">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ColumnPanel({ id, tab }: { id: string; tab: string }) {
  const cols = useColumns();
  const policy = usePolicy();
  const audit = useAudit();
  const rec = cols.data?.find((c) => c.id === id);
  if (cols.isPending) return <p>Loading…</p>;
  if (!rec) return <Missing what={id} />;
  if (tab === 'lineage') return <ColumnLineage rec={rec} policy={policy.data?.policy} />;
  if (tab === 'history') {
    const related = (audit.data?.events ?? []).filter((e) => e.event_type !== 'QUERY' && e.detail.includes(rec.id)).slice(-6).reverse();
    return (
      <div className="sm-stack">
        <ul className="sm-timeline" aria-label="Decision history">
          {[...rec.history].reverse().map((h, i) => (
            <li key={i} data-tone={h.action === 'CLEAR' ? 'warn' : h.action === 'SCAN' ? undefined : 'ok'}>
              <div className="t-body1s">{h.action.replace('_', ' ')} <span className="t-secondary">· {h.from ?? '∅'} → {h.to}</span></div>
              <div className="t-caption1 t-tertiary">{fmtTime(h.at)} · {h.by}</div>
              <div>{h.reason}</div>
            </li>
          ))}
        </ul>
        {related.length > 0 && (
          <>
            <h3 className="t-subtitle2" style={{ margin: 0 }}>Related audit events</h3>
            <ul className="sm-timeline">
              {related.map((e) => (
                <li key={e.id}>
                  <button className="sm-th-btn" style={{ all: 'unset', cursor: 'pointer', color: 'var(--sm-brand)' }} onClick={() => setParams({ open: `audit:${e.id}`, dtab: null }, { replace: false })}>#{e.id} {e.event_type}</button>
                  <div className="t-caption1 t-tertiary">{fmtTime(e.timestamp)}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }
  const eff = effectiveTag(rec);
  return (
    <div className="sm-stack">
      <div className="t-subtitle1 sm-mono">{rec.table}.{rec.column}</div>
      <div className="sm-row"><StateChip state={rec.state} /><TagChip tag={eff?.tag ?? rec.tag} />{rec.state === 'REVIEW' && <Chip tone="warn">Masked fail-closed</Chip>}</div>
      <KV rows={[
        ['Backend', rec.backend], ['Data type', <span className="sm-mono">{rec.dtype}</span>], ['Detected family', rec.family],
        ['Rows / sampled', `${rec.rowCount.toLocaleString('en-US')} / ${rec.sampleSize}`],
        ['Null / empty', `${(rec.nullRate * 100).toFixed(1)}% / ${(rec.emptyRate * 100).toFixed(1)}%`],
        ['Last scanned', fmtTime(rec.scannedAt)],
      ]} />
      <div className="sm-card" style={{ padding: 12 }}>
        <div className="t-subtitle2" style={{ marginBottom: 8 }}>Score S = 0.30·N + 0.55·P + 0.15·E</div>
        <NpeBars n={rec.n} p={rec.p} e={rec.e} />
        <div className="t-caption1 sm-num" style={{ marginTop: 8 }}>
          N {rec.n.toFixed(2)} · P {rec.p.toFixed(3)} · E {rec.e.toFixed(3)} → <strong>S {rec.s.toFixed(3)}</strong> · classifier M {rec.m.toFixed(2)}
          {rec.emptyTableFloor && ' · empty-table floor at 0.40'}
        </div>
        <div className="t-caption1 t-secondary">≥ 0.70 ENFORCED · 0.40–0.69 REVIEW (masked) · &lt; 0.40 CLEAR · M ≥ 0.85 promotes to ENFORCED_ML, never clears.</div>
      </div>
      {rec.override && <KV rows={[['Override', rec.override.mode === 'CLEAR' ? 'Cleared (unmasked)' : `Forced ${rec.override.tag}`], ['Justification', rec.override.justification]]} />}
      <div>
        <h3 className="t-subtitle2" style={{ margin: '0 0 8px' }}>Value shapes (no raw values stored)</h3>
        <div className="sm-histo">
          {rec.shapes.map((s) => (
            <div key={s.shape} className="sm-histo-row">
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.shape}>{s.shape}</span>
              <span className="sm-histo-bar"><i style={{ width: `${(s.count / (rec.shapes[0]?.count || 1)) * 100}%` }} /></span>
              <span style={{ textAlign: 'right' }}>{s.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ColumnLineage({ rec, policy }: { rec: ColumnRecord; policy: Policy | undefined }) {
  const eff = effectiveTag(rec);
  const example = EXAMPLE[rec.family] ?? 'Example value';
  const items = useMemo(() => ROLES.map((role) => {
    if (!eff || !policy) return { role, fn: 'PLAINTEXT', out: example };
    const r = resolveMask(policy, role, eff.tag, rec.family);
    const out = r.fn === 'HMAC_TOKEN' ? 'tok_…(24 hex)' : String(applyMask(r.fn, example, r.args, { tag: eff.tag, family: rec.family, vault: demoVault }) ?? '');
    return { role, fn: r.fn, out };
  }), [eff, policy, rec.family, example]);
  const Box = ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="sm-card" style={{ padding: 10 }}><div className="t-caption1 t-tertiary">{title}</div><div>{children}</div></div>
  );
  return (
    <div className="sm-stack" aria-label="Lineage">
      <Box title="Base column (read-only)"><span className="sm-mono">{rec.backend}.{rec.table}.{rec.column}</span></Box>
      <div aria-hidden className="t-tertiary">↓ sampled {rec.sampleSize} rows</div>
      <Box title="Scanner · rules"><span className="sm-num">N {rec.n.toFixed(2)} · P {rec.p.toFixed(2)} · E {rec.e.toFixed(2)} → S {rec.s.toFixed(3)}</span></Box>
      <div aria-hidden className="t-tertiary">↓ ML may only promote</div>
      <Box title="Classifier"><span className="sm-num">M {rec.m.toFixed(2)}</span> {rec.mlContributions.filter((c) => c.feature !== 'bias').map((c) => <span key={c.feature} className="t-caption1 t-secondary"> · {c.feature} {c.weight >= 0 ? '+' : ''}{c.weight.toFixed(1)}</span>)}</Box>
      <div aria-hidden className="t-tertiary">↓ decision</div>
      <Box title="Catalog state"><StateChip state={rec.state} /> <TagChip tag={eff?.tag ?? null} /></Box>
      <div aria-hidden className="t-tertiary">↓ policy v{policy?.version ?? '—'}: illustrative output for a sample {rec.family.toLowerCase().replace('_', ' ')} value</div>
      <table className="sm-matrix" aria-label="Masking per role">
        <thead><tr><th scope="col">Role</th><th scope="col">Function</th><th scope="col">Output</th></tr></thead>
        <tbody>{items.map((i) => <tr key={i.role}><td>{roleLabel(i.role)}</td><td className="sm-mono">{i.fn}</td><td className="sm-mono">{i.out}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function AuditPanel({ id, tab }: { id: number; tab: string }) {
  const audit = useAudit();
  const events = audit.data?.events;
  const idx = events ? events.findIndex((e) => e.id === id) : -1;
  if (audit.isPending) return <p>Loading…</p>;
  const e: AuditEvent | undefined = events?.[idx];
  if (!e || !events) return <Missing what={`Event #${id}`} />;
  const prev = events[idx - 1];
  const next = events[idx + 1];
  const open = (ev: AuditEvent | undefined): void => ev && setParams({ open: `audit:${ev.id}` }, { replace: false });
  if (tab === 'lineage') {
    const st = e.stages;
    return (
      <div className="sm-stack">
        <p className="t-secondary" style={{ margin: 0 }}>Pipeline stages recorded for this query (simulated timings).</p>
        {st ? (
          <table className="sm-matrix"><thead><tr><th scope="col">Stage</th><th scope="col">Time</th></tr></thead>
            <tbody>
              {(['parse', 'policy', 'mutation', 'render', 'audit'] as const).map((k) => <tr key={k}><td>{k}</td><td className="sm-num">{st[k].toFixed(3)} ms</td></tr>)}
              <tr><td><strong>overhead</strong></td><td className="sm-num"><strong>{e.execution_time_ms.toFixed(3)} ms</strong></td></tr>
            </tbody>
          </table>
        ) : <p>No stage timings (not a query event).</p>}
        <h3 className="t-subtitle2" style={{ margin: 0 }}>Columns accessed</h3>
        <div className="sm-row">{e.columns_accessed.length ? e.columns_accessed.map((c) => <span key={c} className="sm-code">{c}</span>) : <span className="t-tertiary">none</span>}</div>
        <h3 className="t-subtitle2" style={{ margin: 0 }}>Masking applied</h3>
        <div className="sm-row">{e.masking_applied.length ? e.masking_applied.map((m) => <span key={m.column} className="sm-code">{m.column} → {m.function}</span>) : <span className="t-tertiary">none</span>}</div>
      </div>
    );
  }
  if (tab === 'history') {
    return (
      <div className="sm-stack">
        <p className="t-secondary" style={{ margin: 0 }}>Position in the hash chain. Each event commits to its predecessor.</p>
        <ul className="sm-timeline">
          {prev && <li><Button size="small" appearance="subtle" onClick={() => open(prev)}>#{prev.id} previous</Button><div className="sm-mono t-caption1">{shortHash(prev.event_hash, 24)}</div></li>}
          <li data-tone="ok"><strong>#{e.id} this event</strong><div className="sm-mono t-caption1">prev {shortHash(e.prev_hash, 24)}</div><div className="sm-mono t-caption1">hash {shortHash(e.event_hash, 24)}</div></li>
          {next && <li><Button size="small" appearance="subtle" onClick={() => open(next)}>#{next.id} next</Button><div className="sm-mono t-caption1">links to {shortHash(next.prev_hash, 24)}</div></li>}
        </ul>
      </div>
    );
  }
  return (
    <div className="sm-stack">
      <div className="sm-row"><Chip tone="brand">{e.event_type}</Chip><RoleChip role={e.requesting_role} /><OutcomeChip outcome={e.outcome} code={e.code} /></div>
      <KV rows={[
        ['Event id', `#${e.id}`], ['Timestamp', fmtTime(e.timestamp)], ['Principal', e.principal], ['Backend', e.backend],
        ['Query hash', <span className="sm-mono">{shortHash(e.query_hash, 20)}</span>], ['Engine overhead', `${e.execution_time_ms.toFixed(3)} ms (simulated)`],
        ['Rows returned', e.rows_returned], ['Policy version', `v${e.policy_version}`], ['Detail', e.detail],
        ['prev_hash', <span className="sm-mono">{e.prev_hash}</span>], ['event_hash', <span className="sm-mono">{e.event_hash}</span>],
      ]} />
    </div>
  );
}

function TablePanel({ name, tab }: { name: string; tab: string }) {
  const v = useVerification();
  const row = v.data?.baseline.find((b) => b.table === name);
  if (v.isPending) return <p>Loading…</p>;
  if (!row) return <Missing what={name} />;
  const batches = (v.data?.history ?? []).filter((h) => h.tables.some((t) => t.table === name));
  if (tab === 'history') {
    return (
      <ul className="sm-timeline" aria-label="Verification history">
        {batches.slice(0, 20).map((b) => {
          const t = b.tables.find((x) => x.table === name);
          return (
            <li key={b.id} data-tone={t && t.before === t.after ? 'ok' : 'bad'}>
              <div className="t-body1s">{b.label}</div>
              <div className="t-caption1 t-tertiary">{fmtTime(b.at)} · {b.actor}</div>
              <div className="sm-mono t-caption1">{t && t.before === t.after ? 'before = after' : 'MISMATCH'} · {shortHash(t?.after ?? '', 18)}</div>
            </li>
          );
        })}
      </ul>
    );
  }
  if (tab === 'lineage') {
    return (
      <div className="sm-stack">
        <p className="t-secondary" style={{ margin: 0 }}>Base tables are read-only. Every role reads through the engine; only the Evaluator connection can see this table directly.</p>
        <KV rows={[['Backend', row.backend], ['Table', <span className="sm-mono">{row.table}</span>], ['Access path', row.backend === 'core_pg' ? 'Per-role secure views (Approach A)' : 'AST-rewritten projections (Approach B)']]} />
      </div>
    );
  }
  return <KV rows={[['Table', <span className="sm-mono">{row.table}</span>], ['Backend', row.backend], ['Rows', row.rows.toLocaleString('en-US')], ['SHA-256', <span className="sm-mono">{row.sha}</span>], ['Batches touching it', batches.length]]} />;
}

function AlertPanel({ id, tab }: { id: string; tab: string }) {
  const q = useAnomalies();
  const a = q.data?.alerts.find((x) => x.id === id);
  if (q.isPending) return <p>Loading…</p>;
  if (!a) return <Missing what={id} />;
  const evs = q.data?.events[id] ?? [];
  if (tab === 'history') {
    return (
      <ul className="sm-timeline">
        <li data-tone="warn"><div className="t-body1s">Raised by Isolation Forest</div><div className="t-caption1 t-tertiary">{fmtTime(a.firstSeen)}</div></li>
        <li data-tone={a.status === 'open' ? undefined : 'ok'}><div className="t-body1s">Status: {a.status}</div><div className="t-caption1 t-tertiary">Acknowledge or dismiss from the alert list.</div></li>
      </ul>
    );
  }
  if (tab === 'lineage') {
    return (
      <div className="sm-stack">
        <p className="t-secondary" style={{ margin: 0 }}>First {evs.length} audit events behind this alert.</p>
        <ul className="sm-timeline">
          {evs.slice(0, 12).map((e) => (
            <li key={e.id}><Button size="small" appearance="subtle" onClick={() => setParams({ open: `audit:${e.id}`, dtab: null }, { replace: false })}>#{e.id}</Button> <span className="t-caption1 t-tertiary">{fmtTime(e.timestamp)} · {e.outcome}</span><div className="t-caption1" style={{ overflowWrap: 'anywhere' }}>{e.detail}</div></li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="sm-stack">
      <div className="sm-row"><RoleChip role={a.role} /><Chip tone={a.score >= 0.7 ? 'bad' : 'warn'}>Isolation score {a.score.toFixed(3)}</Chip><Chip tone="neutral">{a.status}</Chip></div>
      <KV rows={[['Principal', a.principal], ['Day (IST)', a.day], ['Why flagged', a.summary], ['Events', a.eventIds.length]]} />
      <p className="t-caption1 t-secondary" style={{ margin: 0 }}>The model recommends and alerts. It never changes a masking decision on the query path.</p>
    </div>
  );
}

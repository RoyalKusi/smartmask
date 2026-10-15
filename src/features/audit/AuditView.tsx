import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Input,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Option,
  ProgressBar,
} from '@fluentui/react-components';
import {
  Bug24Regular,
  History24Regular,
  Link24Regular,
  Search24Regular,
  ShieldCheckmark24Regular,
  ArrowUndo24Regular,
} from '@fluentui/react-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { bodyOf, hashEvent, type AuditEvent } from '../../shared/engine/audit';
import { api } from '../../shared/api/client';
import { describeError } from '../../shared/api/errors';
import { ROLES } from '../../shared/engine/types';
import { Chip, OutcomeChip, RoleChip } from '../../shared/ui/Chips';
import { DataTable, type Column, type SortSpec } from '../../shared/ui/DataTable';
import { fmtInt, fmtTime, roleLabel, shortHash } from '../../shared/ui/format';
import { useNotify } from '../../shared/ui/Notify';
import { EmptyPanel, Region, useLoadMachine } from '../../shared/ui/Region';
import { TableSkeleton } from '../../shared/ui/Skeleton';
import { useFocusReturn } from '../../shared/ui/useFocusReturn';
import { ViewFrame, useExportProvider } from '../../shared/ui/ViewFrame';
import { useAudit } from '../../app/queries';
import { setParams, useListParam, useParam } from '../../app/router';
import { useUi } from '../../app/store';

const EVENT_TYPES = [
  'QUERY',
  'ROLE_SWITCH',
  'POLICY_PUBLISH',
  'REVIEW_DECISION',
  'SCAN',
  'ALERT_ACTION',
  'BACKEND_ADDED',
  'EXPORT',
  'SCHEMA_DRIFT',
];
const selfCheck = new WeakMap<AuditEvent, boolean>();
const selfOk = (e: AuditEvent): boolean => {
  let v = selfCheck.get(e);
  if (v === undefined) {
    v = hashEvent(bodyOf(e), e.prev_hash) === e.event_hash;
    selfCheck.set(e, v);
  }
  return v;
};

type RowStatus = 'linked' | 'broken' | 'untrusted';

export default function AuditView() {
  const q = useAudit();
  const m = useLoadMachine(q, (d) => d.events.length === 0);
  const qc = useQueryClient();
  const notify = useNotify();
  const density = useUi((s) => s.density);
  const [roles, setRoles] = useListParam('role_f');
  const [outcomes, setOutcomes] = useListParam('outcome');
  const [types, setTypes] = useListParam('type');
  const [text, setText] = useParam('q', '');
  const [sortRaw, setSortRaw] = useParam('sort', 'id:desc');
  const [selected, setSelected] = useState<string[]>([]);
  const [verifying, setVerifying] = useState<number | null>(null);
  const [confirmTamper, setConfirmTamper] = useState(false);
  useFocusReturn(confirmTamper);

  const events = useMemo(() => q.data?.events ?? [], [q.data]);
  const verdict = q.data?.verdict ?? null;
  const tamperedAt = q.data?.tamperedAt ?? null;
  const brokenAt = verdict && !verdict.ok ? verdict.brokenAt : null;

  const statusOf = useMemo(
    () =>
      (e: AuditEvent, idx: number): RowStatus => {
        if (brokenAt !== null) return idx < brokenAt ? 'linked' : idx === brokenAt ? 'broken' : 'untrusted';
        return selfOk(e) ? 'linked' : 'broken';
      },
    [brokenAt],
  );

  const indexById = useMemo(() => new Map(events.map((e, i) => [e.id, i])), [events]);
  const filtered = useMemo(() => {
    const needle = text.trim().toLowerCase().replace(/^#/, '');
    return events.filter(
      (e) =>
        (!roles.length || roles.includes(e.requesting_role)) &&
        (!outcomes.length || outcomes.includes(e.outcome)) &&
        (!types.length || types.includes(e.event_type)) &&
        (!needle ||
          String(e.id) === needle ||
          `${e.principal} ${e.detail} ${e.backend} ${e.code ?? ''} ${e.query_hash ?? ''}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [events, roles, outcomes, types, text]);

  useExportProvider(() => ({
    name: 'audit-trail',
    rows: filtered.slice(0, 5000).map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      type: e.event_type,
      principal: e.principal,
      role: e.requesting_role,
      backend: e.backend,
      outcome: e.outcome,
      code: e.code ?? '',
      query_hash: e.query_hash ?? '',
      columns_accessed: e.columns_accessed.join(' '),
      masking_applied: e.masking_applied.map((x) => `${x.column}:${x.function}`).join(' '),
      execution_time_ms: e.execution_time_ms,
      prev_hash: e.prev_hash,
      event_hash: e.event_hash,
    })),
    summary: {
      totalEvents: events.length,
      filtered: filtered.length,
      chain: verdict
        ? verdict.ok
          ? 'verified'
          : `broken at #${events[verdict.brokenAt ?? 0]?.id}`
        : 'unverified',
      exportedRowsCap: 5000,
    },
  }));

  const columns = useMemo<Column<AuditEvent>[]>(
    () => [
      {
        id: 'id',
        header: '#',
        width: 76,
        align: 'right',
        sortValue: (e) => e.id,
        cell: (e) => <span className="sm-num">{e.id}</span>,
      },
      {
        id: 'ts',
        header: 'Timestamp (UTC)',
        width: 170,
        sortValue: (e) => e.timestamp,
        cell: (e) => <span className="sm-num">{fmtTime(e.timestamp)}</span>,
        card: 'hide',
      },
      {
        id: 'type',
        header: 'Event',
        width: 150,
        sortValue: (e) => e.event_type,
        cell: (e) => <Chip tone={e.event_type === 'QUERY' ? 'brand' : 'neutral'}>{e.event_type}</Chip>,
        filter: {
          options: EVENT_TYPES.map((t) => ({ value: t, label: t })),
          selected: types,
          onChange: setTypes,
        },
        card: 'title',
      },
      {
        id: 'principal',
        header: 'Principal',
        width: 120,
        sortValue: (e) => e.principal,
        cell: (e) => e.principal,
      },
      {
        id: 'role',
        header: 'Role',
        width: 120,
        sortValue: (e) => e.requesting_role,
        cell: (e) => <RoleChip role={e.requesting_role} />,
        filter: {
          options: ROLES.map((r) => ({ value: r, label: roleLabel(r) })),
          selected: roles,
          onChange: setRoles,
        },
      },
      {
        id: 'outcome',
        header: 'Outcome',
        width: 190,
        sortValue: (e) => e.outcome,
        cell: (e) => <OutcomeChip outcome={e.outcome} code={e.code} />,
        filter: {
          options: [
            { value: 'ALLOWED', label: 'Allowed' },
            { value: 'DENIED', label: 'Denied' },
          ],
          selected: outcomes,
          onChange: setOutcomes,
        },
      },
      {
        id: 'cols',
        header: 'Columns',
        width: 84,
        align: 'right',
        sortValue: (e) => e.columns_accessed.length,
        cell: (e) => <span className="sm-num">{e.columns_accessed.length}</span>,
      },
      {
        id: 'ms',
        header: 'Overhead',
        width: 96,
        align: 'right',
        sortValue: (e) => e.execution_time_ms,
        cell: (e) => (
          <span className="sm-num">{e.execution_time_ms ? `${e.execution_time_ms.toFixed(2)} ms` : '—'}</span>
        ),
      },
      {
        id: 'chain',
        header: 'Chain',
        width: 150,
        cell: (e) => {
          const st = statusOf(e, indexById.get(e.id) ?? 0);
          return st === 'linked' ? (
            <Chip tone="ok" icon={<Link24Regular style={{ width: 14, height: 14 }} aria-hidden />}>
              Linked
            </Chip>
          ) : st === 'broken' ? (
            <Chip tone="bad" icon={<Bug24Regular style={{ width: 14, height: 14 }} aria-hidden />}>
              Hash mismatch
            </Chip>
          ) : (
            <Chip tone="warn">After break</Chip>
          );
        },
      },
      {
        id: 'hash',
        header: 'event_hash',
        width: 150,
        cell: (e) => (
          <span className="sm-mono" title={e.event_hash}>
            {shortHash(e.event_hash, 14)}
          </span>
        ),
        card: 'hide',
      },
    ],
    [types, roles, outcomes, statusOf, indexById, setTypes, setRoles, setOutcomes],
  );

  const sort: SortSpec | null = sortRaw
    ? { id: sortRaw.split(':')[0] as string, desc: sortRaw.endsWith(':desc') }
    : null;
  const hasFilters = roles.length > 0 || outcomes.length > 0 || types.length > 0 || text !== '';

  const verify = async (): Promise<void> => {
    setVerifying(0);
    try {
      const v = await api.verifyChain((n) => setVerifying(n));
      await qc.invalidateQueries({ queryKey: ['audit'] });
      notify(
        v.ok
          ? {
              title: 'Audit chain verified',
              body: `${fmtInt(v.checked)} events, every hash and link intact.`,
            }
          : {
              title: 'Audit chain BROKEN',
              body: `First inconsistency at event #${events[v.brokenAt ?? 0]?.id}.`,
              intent: 'error',
            },
      );
    } catch (e) {
      notify({ title: 'Verification failed to run', body: describeError(e).message, intent: 'error' });
    } finally {
      setVerifying(null);
    }
  };

  return (
    <ViewFrame
      title="Audit Trail"
      icon={<History24Regular />}
      subtitle="Every query writes a JSON event whose hash commits to the previous event (SHA-256). Tamper with one and verification fails visibly."
      commands={
        <>
          <Button
            appearance="primary"
            icon={<ShieldCheckmark24Regular />}
            disabled={verifying !== null}
            onClick={() => void verify()}
          >
            Verify chain
          </Button>
          {tamperedAt === null ? (
            <Button icon={<Bug24Regular />} onClick={() => setConfirmTamper(true)}>
              Tamper test…
            </Button>
          ) : (
            <Button
              icon={<ArrowUndo24Regular />}
              onClick={async () => {
                await api.restoreAudit();
                await qc.invalidateQueries({ queryKey: ['audit'] });
                notify({ title: 'Event restored from backup', body: 'Chain verified again.' });
              }}
            >
              Restore corrupted event
            </Button>
          )}
        </>
      }
    >
      <div className="sm-stack" style={{ gap: 12 }}>
        {verifying !== null && (
          <div className="sm-card" role="status" aria-live="polite">
            <div className="t-body1s" style={{ marginBottom: 6 }}>
              Verifying chain… {fmtInt(verifying)} / {fmtInt(events.length)}
            </div>
            <ProgressBar value={events.length ? verifying / events.length : 0} thickness="large" />
          </div>
        )}
        {verdict?.ok && (
          <MessageBar intent="success">
            <MessageBarBody>
              <MessageBarTitle>Chain verified</MessageBarTitle>
              {fmtInt(verdict.checked)} events, no breaks · verified {fmtTime(verdict.at)}
            </MessageBarBody>
          </MessageBar>
        )}
        {verdict && !verdict.ok && (
          <MessageBar intent="error" role="alert" layout="multiline">
            <MessageBarBody>
              <MessageBarTitle>
                Chain BROKEN at event #{events[verdict.brokenAt ?? 0]?.id} (
                {verdict.fault === 'hash_mismatch'
                  ? 'stored hash does not match the event contents'
                  : 'link to the previous event is wrong'}
                )
              </MessageBarTitle>
              {fmtInt(events.length - (verdict.brokenAt ?? 0) - 1)} later events can no longer be trusted
              until the break is investigated. Verified {fmtTime(verdict.at)}.
            </MessageBarBody>
            <MessageBarActions>
              <Button size="small" onClick={() => setText(String(events[verdict.brokenAt ?? 0]?.id ?? ''))}>
                Show event
              </Button>
            </MessageBarActions>
          </MessageBar>
        )}
        {!verdict && tamperedAt !== null && (
          <MessageBar intent="warning" layout="multiline">
            <MessageBarBody>
              <MessageBarTitle>An event was modified</MessageBarTitle>The chain has not been re-verified yet.
              The row whose contents no longer match its hash is already flagged; run Verify chain to see
              exactly where trust ends.
            </MessageBarBody>
          </MessageBar>
        )}

        <div
          className="sm-card sm-filterbar"
          style={{ marginBottom: 0 }}
          role="search"
          aria-label="Filter audit events"
        >
          <div className="sm-field" style={{ minWidth: 240 }}>
            <label htmlFor="aud-q">Search</label>
            <Input
              id="aud-q"
              contentBefore={<Search24Regular />}
              value={text}
              placeholder="principal, detail, code, #id"
              onChange={(_, d) => setText(d.value || null)}
            />
          </div>
          <div className="sm-field">
            <label id="aud-r">Role</label>
            <Dropdown
              aria-labelledby="aud-r"
              multiselect
              placeholder="Any role"
              value={roles.map(roleLabel).join(', ')}
              selectedOptions={roles}
              onOptionSelect={(_, d) => setRoles(d.selectedOptions)}
            >
              {ROLES.map((r) => (
                <Option key={r} value={r} text={roleLabel(r)}>
                  {roleLabel(r)}
                </Option>
              ))}
            </Dropdown>
          </div>
          <div className="sm-field">
            <label id="aud-o">Outcome</label>
            <Dropdown
              aria-labelledby="aud-o"
              multiselect
              placeholder="Any outcome"
              value={outcomes.join(', ')}
              selectedOptions={outcomes}
              onOptionSelect={(_, d) => setOutcomes(d.selectedOptions)}
            >
              <Option value="ALLOWED">ALLOWED</Option>
              <Option value="DENIED">DENIED</Option>
            </Dropdown>
          </div>
          <div className="sm-field">
            <label id="aud-t">Event type</label>
            <Dropdown
              aria-labelledby="aud-t"
              multiselect
              placeholder="Any type"
              value={types.join(', ')}
              selectedOptions={types}
              onOptionSelect={(_, d) => setTypes(d.selectedOptions)}
            >
              {EVENT_TYPES.map((t) => (
                <Option key={t} value={t}>
                  {t}
                </Option>
              ))}
            </Dropdown>
          </div>
          {hasFilters && (
            <Button
              appearance="subtle"
              onClick={() =>
                setParams({ role_f: null, outcome: null, type: null, q: null }, { replace: true })
              }
            >
              Clear filters
            </Button>
          )}
        </div>

        <Region
          machine={m}
          skeleton={<TableSkeleton rows={12} height={560} />}
          empty={
            <EmptyPanel title="No audit events">
              Run a query in the Workbench to write the first event.
            </EmptyPanel>
          }
        >
          {filtered.length === 0 ? (
            <EmptyPanel
              title="No events match these filters"
              action={
                <Button
                  onClick={() =>
                    setParams({ role_f: null, outcome: null, type: null, q: null }, { replace: true })
                  }
                >
                  Clear filters
                </Button>
              }
            >
              Try a different role, outcome or search term.
            </EmptyPanel>
          ) : (
            <DataTable<AuditEvent>
              rows={filtered}
              columns={columns}
              getId={(e) => String(e.id)}
              ariaLabel="Audit events"
              sort={sort}
              onSortChange={(s) => setSortRaw(s ? `${s.id}:${s.desc ? 'desc' : 'asc'}` : null)}
              selectable
              selected={selected}
              onSelectedChange={setSelected}
              density={density}
              height="min(66vh, 680px)"
              onOpen={(e) => setParams({ open: `audit:${e.id}`, dtab: null }, { replace: false })}
              bulkActions={(sel) => (
                <span className="t-secondary">
                  {sel.filter((e) => e.outcome === 'DENIED').length} denied of {sel.length}
                </span>
              )}
              footer={<Chip tone="neutral">{fmtInt(events.length)} in chain</Chip>}
            />
          )}
        </Region>
      </div>

      <Dialog open={confirmTamper} onOpenChange={(_, d) => setConfirmTamper(d.open)} modalType="alert">
        <DialogSurface
          className="sm-acrylic"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setConfirmTamper(false);
          }}
          style={{ borderRadius: 'var(--sm-r-dlg)', boxShadow: 'var(--sm-shadow28)' }}
        >
          <DialogBody>
            <DialogTitle>Corrupt one audit event?</DialogTitle>
            <DialogContent>
              This simulates an attacker editing a stored event without being able to re-seal it. Verification
              will fail at that row and mark every later row untrusted. You can restore the event afterwards.
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setConfirmTamper(false)}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={async () => {
                  setConfirmTamper(false);
                  const t = await api.tamperAudit();
                  await qc.invalidateQueries({ queryKey: ['audit'] });
                  notify({
                    title: `Event #${t.id} corrupted`,
                    body: 'Run Verify chain to see the chain break.',
                    intent: 'warning',
                  });
                }}
              >
                Corrupt event
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </ViewFrame>
  );
}

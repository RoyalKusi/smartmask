import { Checkbox, Dropdown, Field, Option, Radio, RadioGroup } from '@fluentui/react-components';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { describeError } from '../shared/api/errors';
import { api } from '../shared/api/client';
import { DEFAULT_PRINCIPAL } from '../shared/api/identity';
import type { Dialect, Tag } from '../shared/engine/types';
import { TAGS } from '../shared/engine/types';
import { TagChip, StateChip } from '../shared/ui/Chips';
import { download, toCsv } from '../shared/ui/format';
import { useNotify } from '../shared/ui/Notify';
import { ValidatedField, Wizard } from '../shared/ui/Wizard';
import { useBackends, useColumns } from './queries';
import { currentRoute, roleFromParam, setParams } from './router';
import { useUi } from './store';

export function AddBackendWizard() {
  const open = useUi((s) => s.addBackendOpen);
  const setOpen = useUi((s) => s.setAddBackendOpen);
  const qc = useQueryClient();
  const notify = useNotify();
  const { data: backends } = useBackends();
  const [name, setName] = useState('');
  const [dialect, setDialect] = useState<Dialect>('postgresql');
  const [host, setHost] = useState('');
  const [database, setDatabase] = useState('');
  const [user, setUser] = useState('');
  useEffect(() => {
    if (open) { setName(''); setDialect('postgresql'); setHost(''); setDatabase(''); setUser(''); }
  }, [open]);

  const nameErr = (v: string): string | null =>
    !/^[a-z][a-z0-9_]{2,30}$/.test(v) ? 'Use 3–31 lowercase letters, digits or underscores, starting with a letter.' : backends?.some((b) => b.id === v) ? 'A backend with this name already exists.' : null;
  const hostErr = (v: string): string | null => (/^[a-z0-9.-]+:\d{2,5}$|^file:\/.+/i.test(v) ? null : 'Use host:port (for example db.internal:5432) or file:/path/to.db.');
  const dbErr = (v: string): string | null => (/^[A-Za-z0-9_.-]{1,48}$/.test(v) ? null : 'Enter a database name (letters, digits, _ . -).');
  const userErr = (v: string): string | null => (/^[A-Za-z0-9_.-]{2,32}$/.test(v) ? null : 'Enter a service user (2–32 characters).');

  const m = useMutation({
    mutationFn: () => api.addBackend({ label: name, dialect, host }),
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: ['backends'] });
      notify({ title: `Backend ${b.label} added`, body: 'Registered with 0 tables. Scan it to discover columns.' });
      setOpen(false);
      setParams({ conn: b.id });
    },
  });

  return (
    <Wizard
      open={open}
      title="Add backend"
      finishLabel="Test connection and add"
      busy={m.isPending}
      error={m.error ? `${describeError(m.error).code}: ${describeError(m.error).message}` : null}
      onCancel={() => setOpen(false)}
      onFinish={() => m.mutate()}
      steps={[
        {
          label: 'Engine',
          valid: !nameErr(name),
          content: (
            <div className="sm-stack">
              <ValidatedField label="Backend name" value={name} onChange={setName} validate={nameErr} hint="Becomes the catalog schema id, e.g. risk_pg." placeholder="risk_pg" />
              <Field label="Engine" required hint="PostgreSQL uses secure views (Approach A); SQLite and MySQL use AST rewriting (Approach B).">
                <Dropdown value={{ postgresql: 'PostgreSQL', sqlite: 'SQLite', mysql: 'MySQL' }[dialect]} selectedOptions={[dialect]} onOptionSelect={(_, d) => setDialect(d.optionValue as Dialect)}>
                  <Option value="postgresql">PostgreSQL</Option>
                  <Option value="sqlite">SQLite</Option>
                  <Option value="mysql">MySQL</Option>
                </Dropdown>
              </Field>
            </div>
          ),
        },
        {
          label: 'Connection',
          valid: !hostErr(host) && !dbErr(database) && !userErr(user),
          content: (
            <div className="sm-stack">
              <ValidatedField label="Host" value={host} onChange={setHost} validate={hostErr} placeholder="risk-pg.meridian.internal:5432" />
              <ValidatedField label="Database" value={database} onChange={setDatabase} validate={dbErr} placeholder="risk" />
              <ValidatedField label="Service user" value={user} onChange={setUser} validate={userErr} placeholder="smartmask_reader" />
              <p className="t-caption1 t-secondary" style={{ margin: 0 }}>No password is requested: this prototype never opens a real connection.</p>
            </div>
          ),
        },
        {
          label: 'Review',
          valid: !nameErr(name) && !hostErr(host) && !dbErr(database) && !userErr(user),
          content: (
            <dl className="sm-kv">
              <dt>Name</dt><dd className="sm-mono">{name}</dd>
              <dt>Engine</dt><dd>{dialect}</dd>
              <dt>Approach</dt><dd>{dialect === 'postgresql' ? 'A · per-role secure views' : 'B · AST rewriting'}</dd>
              <dt>Endpoint</dt><dd className="sm-mono">{host}/{database} as {user}</dd>
              <dt>Next</dt><dd>The connection is tested, the backend is registered, and a scan is offered. A BACKEND_ADDED event is written to the audit chain.</dd>
            </dl>
          ),
        },
      ]}
    />
  );
}

export function OverrideWizard() {
  const id = useUi((s) => s.overrideColumnId);
  const setId = useUi((s) => s.setOverrideColumn);
  const { data: cols } = useColumns();
  const qc = useQueryClient();
  const notify = useNotify();
  const open = id !== null;
  const rec = cols?.find((c) => c.id === id);
  const [mode, setMode] = useState<'TAG' | 'CLEAR'>('TAG');
  const [tag, setTag] = useState<Tag>('PII_HIGH');
  const [why, setWhy] = useState('');
  const [ack, setAck] = useState(false);
  useEffect(() => {
    if (open) { setMode('TAG'); setTag(rec?.suggestedTag ?? 'PII_HIGH'); setWhy(''); setAck(false); }
    // Reset only when the wizard opens for a different column.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const whyErr = (v: string): string | null => (v.trim().length >= 12 ? null : 'Explain the decision in at least 12 characters; it is stored in the audit trail.');
  const m = useMutation({
    mutationFn: () => api.decide({ columnId: id as string, action: 'OVERRIDE', mode, ...(mode === 'TAG' ? { tag } : {}), reason: why.trim() }, DEFAULT_PRINCIPAL[roleFromParam(currentRoute().params.get('role'))]),
    onSuccess: ({ previous }) => {
      void qc.invalidateQueries();
      notify({
        title: `Override applied to ${previous.id}`,
        body: mode === 'CLEAR' ? 'Column is now unmasked for every role.' : `Column is forced to ${tag}.`,
        undo: () => { void api.undoDecision(previous, DEFAULT_PRINCIPAL.ROLE_ADMIN).then(() => qc.invalidateQueries()); },
      });
      setId(null);
    },
  });
  if (!rec) return open ? <Wizard open title="Override column" steps={[{ label: 'Column', valid: false, content: <p>Loading column…</p> }, { label: 'Decision', valid: false, content: null }, { label: 'Confirm', valid: false, content: null }]} finishLabel="Apply" onCancel={() => setId(null)} onFinish={() => undefined} /> : null;
  return (
    <Wizard
      open={open}
      title="Override column"
      finishLabel={mode === 'CLEAR' ? 'Unmask column' : 'Apply override'}
      busy={m.isPending}
      error={m.error ? `${describeError(m.error).code}: ${describeError(m.error).message}` : null}
      onCancel={() => setId(null)}
      onFinish={() => m.mutate()}
      steps={[
        {
          label: 'Column',
          valid: true,
          content: (
            <dl className="sm-kv">
              <dt>Column</dt><dd className="sm-mono">{rec.backend}.{rec.id}</dd>
              <dt>Current state</dt><dd><StateChip state={rec.state} /></dd>
              <dt>Current tag</dt><dd><TagChip tag={rec.tag} /></dd>
              <dt>Score</dt><dd>S = {rec.s.toFixed(3)} · M = {rec.m.toFixed(2)}</dd>
            </dl>
          ),
        },
        {
          label: 'Decision',
          valid: !whyErr(why),
          content: (
            <div className="sm-stack">
              <Field label="Override type">
                <RadioGroup value={mode} onChange={(_, d) => setMode(d.value as 'TAG' | 'CLEAR')}>
                  <Radio value="TAG" label="Force a tag (mask the column)" />
                  <Radio value="CLEAR" label="Clear (unmask the column for every role)" />
                </RadioGroup>
              </Field>
              {mode === 'TAG' && (
                <Field label="Tag">
                  <Dropdown value={tag} selectedOptions={[tag]} onOptionSelect={(_, d) => setTag(d.optionValue as Tag)}>
                    {TAGS.map((t) => <Option key={t} value={t}>{t}</Option>)}
                  </Dropdown>
                </Field>
              )}
              <ValidatedField label="Justification" value={why} onChange={setWhy} validate={whyErr} multiline placeholder="Why is this override correct?" />
            </div>
          ),
        },
        {
          label: 'Confirm',
          valid: mode === 'TAG' || ack,
          content: (
            <div className="sm-stack">
              <dl className="sm-kv">
                <dt>Column</dt><dd className="sm-mono">{rec.id}</dd>
                <dt>Change</dt><dd>{rec.state} → OVERRIDDEN ({mode === 'CLEAR' ? 'unmasked' : tag})</dd>
                <dt>Justification</dt><dd>{why}</dd>
              </dl>
              {mode === 'CLEAR' && <Checkbox checked={ack} onChange={(_, d) => setAck(!!d.checked)} label="I understand this exposes the column in plaintext to Support and Analyst." />}
            </div>
          ),
        },
      ]}
    />
  );
}

export function ExportWizard() {
  const { exportOpen, setExportOpen, exportProvider } = useUi();
  const notify = useNotify();
  const [format, setFormat] = useState<'json' | 'csv' | 'both'>('both');
  const [name, setName] = useState('');
  const [summary, setSummary] = useState(true);
  const [busy, setBusy] = useState(false);
  const payload = exportOpen && exportProvider ? exportProvider() : null;
  useEffect(() => {
    if (exportOpen) { setFormat('both'); setName(''); setSummary(true); }
  }, [exportOpen]);
  const base = (name || payload?.name || 'report').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  const nameErr = (v: string): string | null => (v === '' || /^[A-Za-z0-9 _-]{3,40}$/.test(v) ? null : 'Use 3–40 letters, digits, spaces, - or _. Leave blank for the default.');

  const finish = async (): Promise<void> => {
    if (!payload) return;
    setBusy(true);
    const route = currentRoute();
    const meta = {
      generatedAt: new Date().toISOString(),
      view: route.view,
      role: roleFromParam(route.params.get('role')),
      filters: Object.fromEntries(route.params.entries()),
      note: 'Synthetic data, simulated engine. Latency figures are simulated, not measured.',
      ...(summary ? { summary: payload.summary ?? {} } : {}),
    };
    if (format === 'json' || format === 'both') download(`${base}.json`, 'application/json', JSON.stringify({ ...meta, rows: payload.rows }, null, 2));
    if (format === 'csv' || format === 'both') download(`${base}.csv`, 'text/csv', toCsv(payload.rows));
    await api.logExport(payload.name, format.toUpperCase(), DEFAULT_PRINCIPAL[roleFromParam(route.params.get('role'))]);
    setBusy(false);
    setExportOpen(false);
    notify({ title: 'Report exported', body: `${payload.rows.length} row(s) as ${format === 'both' ? 'JSON and CSV' : format.toUpperCase()}.` });
  };

  return (
    <Wizard
      open={exportOpen}
      title="Export report"
      finishLabel="Download"
      busy={busy}
      onCancel={() => setExportOpen(false)}
      onFinish={() => void finish()}
      steps={[
        {
          label: 'Format',
          valid: !!payload,
          content: (
            <div className="sm-stack">
              <p style={{ margin: 0 }}>{payload ? <>Exporting <strong>{payload.rows.length}</strong> row(s) from the current view with its filters and sort.</> : 'This view has nothing to export yet.'}</p>
              <Field label="Format">
                <RadioGroup value={format} onChange={(_, d) => setFormat(d.value as typeof format)}>
                  <Radio value="both" label="JSON and CSV" />
                  <Radio value="json" label="JSON (with metadata)" />
                  <Radio value="csv" label="CSV (rows only)" />
                </RadioGroup>
              </Field>
            </div>
          ),
        },
        {
          label: 'Options',
          valid: !nameErr(name),
          content: (
            <div className="sm-stack">
              <ValidatedField label="File name" value={name} onChange={setName} validate={nameErr} required={false} placeholder={payload?.name ?? 'report'} />
              <Checkbox checked={summary} onChange={(_, d) => setSummary(!!d.checked)} label="Include summary and filter metadata in JSON" />
            </div>
          ),
        },
        {
          label: 'Review',
          valid: !!payload,
          content: (
            <dl className="sm-kv">
              <dt>Files</dt><dd className="sm-mono">{format !== 'csv' && `${base}.json `}{format !== 'json' && `${base}.csv`}</dd>
              <dt>Rows</dt><dd>{payload?.rows.length ?? 0}</dd>
              <dt>Role</dt><dd>{roleFromParam(currentRoute().params.get('role')).replace('ROLE_', '')}: exports contain only what this view shows</dd>
              <dt>Audit</dt><dd>An EXPORT event is written to the hash chain.</dd>
            </dl>
          ),
        },
      ]}
    />
  );
}

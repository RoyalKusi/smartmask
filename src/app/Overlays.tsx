import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Input, Switch } from '@fluentui/react-components';
import { Search24Regular } from '@fluentui/react-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { setChaos, useChaos } from '../shared/api/chaos';
import { ROLES } from '../shared/engine/types';
import { roleLabel } from '../shared/ui/format';
import { useNotify } from '../shared/ui/Notify';
import { NAV } from './nav';
import { navigate, useRoute } from './router';
import { switchRole } from './actions';
import { useUi } from './store';

interface Cmd {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, toggleTheme, setExportOpen, setAddBackendOpen, setChaosOpen } = useUi();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const notify = useNotify();
  const { view } = useRoute();

  const cmds = useMemo<Cmd[]>(
    () => [
      ...NAV.map((n) => ({ id: `go-${n.id}`, label: `Go to ${n.label}`, hint: 'Navigate', run: () => navigate(n.id) })),
      ...ROLES.map((r) => ({ id: `role-${r}`, label: `Switch role to ${roleLabel(r)}`, hint: 'Role', run: () => switchRole(r) })),
      { id: 'theme', label: 'Toggle light / dark theme', hint: 'Appearance', run: toggleTheme },
      { id: 'scan', label: 'Run a discovery scan', hint: 'Discovery', run: () => navigate('discovery', { scan: '1' }) },
      { id: 'drift', label: 'Simulate schema drift (rename a column)', hint: 'Discovery', run: () => navigate('discovery', { drift: '1' }) },
      { id: 'export', label: `Export report for the current view`, hint: 'Export', run: () => setExportOpen(true) },
      { id: 'backend', label: 'Add a backend', hint: 'Connections', run: () => setAddBackendOpen(true) },
      { id: 'tamper', label: 'Open the audit tamper test', hint: 'Audit', run: () => navigate('audit') },
      { id: 'chaos', label: 'Open chaos tools', hint: 'Ctrl+Shift+E', run: () => setChaosOpen(true) },
      { id: 'copy', label: 'Copy link to this view', hint: view, run: () => { void navigator.clipboard?.writeText(window.location.href); notify({ title: 'Link copied', body: 'Filters, sorts, tabs and role are included.' }); } },
    ],
    [toggleTheme, setExportOpen, setAddBackendOpen, setChaosOpen, notify, view],
  );
  const shown = useMemo(() => cmds.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase())), [cmds, q]);

  useEffect(() => {
    if (paletteOpen) {
      opener.current = document.activeElement as HTMLElement | null;
      setQ('');
      setIdx(0);
    } else if (opener.current && document.contains(opener.current)) {
      const el = opener.current;
      setTimeout(() => el.focus(), 0);
    }
  }, [paletteOpen]);
  useEffect(() => setIdx(0), [q]);

  const run = (c: Cmd | undefined): void => {
    if (!c) return;
    setPaletteOpen(false);
    setTimeout(c.run, 0);
  };

  return (
    <Dialog open={paletteOpen} onOpenChange={(_, d) => setPaletteOpen(d.open)} modalType="modal">
      <DialogSurface className="sm-acrylic" style={{ padding: 0, borderRadius: 'var(--sm-r-dlg)', boxShadow: 'var(--sm-shadow28)', maxWidth: 560, width: '94vw', top: 80, alignSelf: 'flex-start', position: 'fixed' }}>
        <DialogBody style={{ display: 'block' }}>
          <DialogTitle className="sm-visually-hidden">Command palette</DialogTitle>
          <div style={{ padding: 12, borderBottom: '1px solid var(--sm-stroke-subtle)' }}>
            <Input
              value={q}
              onChange={(_, d) => setQ(d.value)}
              contentBefore={<Search24Regular />}
              placeholder="Type a command or view name"
              aria-label="Search commands"
              autoFocus
              style={{ width: '100%' }}
              role="combobox"
              aria-expanded
              aria-controls="sm-palette-list"
              aria-activedescendant={shown[idx] ? `pal-${shown[idx]?.id}` : undefined}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(shown.length - 1, i + 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
                else if (e.key === 'Enter') { e.preventDefault(); run(shown[idx]); }
              }}
            />
          </div>
          <ul id="sm-palette-list" role="listbox" aria-label="Commands" style={{ listStyle: 'none', margin: 0, padding: 4, maxHeight: 360, overflow: 'auto' }}>
            {shown.map((c, i) => (
              <li
                key={c.id}
                id={`pal-${c.id}`}
                role="option"
                aria-selected={i === idx}
                onMouseEnter={() => setIdx(i)}
                onClick={() => run(c)}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 4, cursor: 'pointer', background: i === idx ? 'color-mix(in srgb, var(--sm-brand) 12%, transparent)' : undefined }}
              >
                <span>{c.label}</span>
                <span className="t-caption1 t-tertiary">{c.hint}</span>
              </li>
            ))}
            {!shown.length && <li className="t-secondary" style={{ padding: 16 }}>No command matches “{q}”.</li>}
          </ul>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export function ChaosDialog() {
  const { chaosOpen, setChaosOpen } = useUi();
  const flags = useChaos();
  const notify = useNotify();
  const rows: { key: keyof typeof flags; label: string; desc: string }[] = [
    { key: 'fail500', label: 'Inject HTTP 500 on reads', desc: 'Every API read fails with SM-API-500.' },
    { key: 'timeout', label: 'Inject timeouts', desc: 'Reads hang for 3 s, then fail with SM-API-408.' },
    { key: 'catalogOutage', label: 'Catalog outage', desc: 'Discovery, columns and the review queue fail with SM-CAT-001; scans abort at the catalog stage.' },
    { key: 'auditFull', label: 'Audit queue full', desc: 'Queries are refused with SM-AUDIT-001 (SmartMask fails closed).' },
  ];
  return (
    <Dialog open={chaosOpen} onOpenChange={(_, d) => setChaosOpen(d.open)}>
      <DialogSurface className="sm-acrylic" style={{ borderRadius: 'var(--sm-r-dlg)', boxShadow: 'var(--sm-shadow28)', maxWidth: 520 }}>
        <DialogBody>
          <DialogTitle>Chaos tools</DialogTitle>
          <DialogContent>
            <p className="t-secondary" style={{ marginTop: 0 }}>Inject failures into the simulated API to demonstrate error panels, retry, and fail-closed behaviour. Open with Ctrl+Shift+E.</p>
            <div className="sm-stack">
              {rows.map((r) => (
                <Switch key={r.key} label={{ children: r.label }} checked={flags[r.key]} onChange={(_, d) => setChaos({ [r.key]: d.checked })} />
              ))}
              <ul className="t-caption1 t-secondary" style={{ margin: 0, paddingLeft: 18 }}>
                {rows.map((r) => <li key={r.key}>{r.desc}</li>)}
              </ul>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => { setChaos({ fail500: false, timeout: false, catalogOutage: false, auditFull: false }); notify({ title: 'Chaos cleared', intent: 'info' }); }}>Clear all</Button>
            <Button appearance="primary" onClick={() => setChaosOpen(false)}>Done</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}


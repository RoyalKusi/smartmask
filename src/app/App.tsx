import { FluentProvider } from '@fluentui/react-components';
import { QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react';
import { boot, subscribeChanges } from '../shared/api/client';
import { setChaos, useChaos } from '../shared/api/chaos';
import { applyPalette, fluentTheme } from '../shared/ui/tokens';
import { ViewBoundary } from '../shared/ui/ErrorBoundary';
import { NotifyProvider } from '../shared/ui/Notify';
import { CardsSkeleton, TableSkeleton } from '../shared/ui/Skeleton';
import { queryClient } from './queries';
import { useRoute, type ViewId } from './router';
import { Blade, CommandBar } from './Shell';
import { useUi } from './store';
import { NAV } from './nav';

const OverlayHost = lazy(() => import('./OverlayHost'));

const VIEWS: Record<ViewId, ComponentType> = {
  overview: lazy(() => import('../features/overview/OverviewView')),
  discovery: lazy(() => import('../features/discovery/DiscoveryView')),
  review: lazy(() => import('../features/review/ReviewView')),
  policy: lazy(() => import('../features/policy/PolicyView')),
  workbench: lazy(() => import('../features/workbench/WorkbenchView')),
  verification: lazy(() => import('../features/verification/VerificationView')),
  audit: lazy(() => import('../features/audit/AuditView')),
  performance: lazy(() => import('../features/performance/PerformanceView')),
  anomalies: lazy(() => import('../features/anomalies/AnomaliesView')),
};

/** Throws once when the Chaos menu asks for it, so the per-view error boundary can be demonstrated. */
function CrashProbe() {
  const { crashNext } = useChaos();
  if (crashNext) {
    queueMicrotask(() => setChaos({ crashNext: false }));
    throw new Error('Injected view crash (Chaos menu): rendering failed on purpose');
  }
  return null;
}

function Frame() {
  const { view } = useRoute();
  const View = VIEWS[view];
  const label = NAV.find((n) => n.id === view)?.label ?? view;
  const {
    navCollapsed,
    navOpen,
    boot: b,
    paletteOpen,
    chaosOpen,
    exportOpen,
    addBackendOpen,
    overrideColumnId,
  } = useUi();
  const { params } = useRoute();
  // Dialogs, the drawer and wizards load the first time one is requested.
  const [wantOverlay, setWantOverlay] = useState(false);
  if (
    !wantOverlay &&
    (paletteOpen || chaosOpen || exportOpen || addBackendOpen || overrideColumnId || params.get('open'))
  )
    setWantOverlay(true);
  return (
    <div className="sm-app">
      <CommandBar />
      <div className="sm-body" data-collapsed={navCollapsed} data-open={navOpen}>
        <Blade />
        <main className="sm-main" id="main" tabIndex={-1}>
          {!b.ready && (
            <div
              role="progressbar"
              aria-label="Starting the simulated engine"
              aria-valuenow={b.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{ height: 3, background: 'var(--sm-stroke-subtle)' }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${b.pct}%`,
                  background: 'var(--sm-brand)',
                  transition: 'width 300ms',
                }}
              />
            </div>
          )}
          <div className="sm-content">
            <ViewBoundary label={label} resetKey={view}>
              <Suspense
                fallback={
                  <div className="sm-stack" role="status" aria-label="Loading view">
                    <CardsSkeleton count={4} />
                    <TableSkeleton rows={6} />
                  </div>
                }
              >
                <CrashProbe />
                <View />
              </Suspense>
            </ViewBoundary>
          </div>
        </main>
      </div>
      <aside className="sm-footer sm-acrylic sm-badge-sim" aria-label="Prototype notice">
        <span aria-hidden>●</span> Synthetic data, simulated engine
      </aside>
      {wantOverlay && (
        <Suspense fallback={null}>
          <OverlayHost />
        </Suspense>
      )}
      <div aria-live="polite" className="sm-visually-hidden" id="sm-live" />
    </div>
  );
}

export function App() {
  const theme = useUi((s) => s.theme);
  const { setBoot, setPaletteOpen, setChaosOpen } = useUi();
  useEffect(() => applyPalette(theme), [theme]);

  useEffect(() => {
    boot((s) => setBoot({ label: s.label, pct: s.pct }))
      .then(() => setBoot({ ready: true, pct: 100 }))
      .catch((e: unknown) => setBoot({ error: String(e) }));
    return subscribeChanges((keys) =>
      keys.forEach((k) => void queryClient.invalidateQueries({ queryKey: [k] })),
    );
  }, [setBoot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setChaosOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen, setChaosOpen]);

  return (
    <QueryClientProvider client={queryClient}>
      <FluentProvider theme={fluentTheme(theme)} style={{ background: 'transparent', height: '100%' }}>
        <NotifyProvider>
          <Frame />
        </NotifyProvider>
      </FluentProvider>
    </QueryClientProvider>
  );
}

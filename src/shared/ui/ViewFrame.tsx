import { Button } from '@fluentui/react-components';
import { ArrowDownload24Regular } from '@fluentui/react-icons';
import { useEffect, type ReactNode } from 'react';
import { useLatest } from './useLatest';
import { useUi, type ExportPayload } from '../../app/store';

export function ViewFrame({
  title,
  subtitle,
  icon,
  commands,
  children,
  exportable = true,
}: {
  title: string;
  subtitle?: ReactNode;
  icon: ReactNode;
  commands?: ReactNode;
  children: ReactNode;
  exportable?: boolean;
}) {
  const setExportOpen = useUi((s) => s.setExportOpen);
  return (
    <section className="sm-page" aria-labelledby="view-title">
      <nav aria-label="Breadcrumb" className="sm-crumbs">
        <span>SmartMask</span>
        <span aria-hidden>›</span>
        <span aria-current="page">{title}</span>
      </nav>
      <div className="sm-viewhead">
        <div>
          <h1 id="view-title" className="t-title2" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {icon}
            {title}
          </h1>
          {subtitle && (
            <div className="t-secondary" style={{ marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
        <div className="sm-pagecmds" role="toolbar" aria-label={`${title} commands`}>
          {commands}
          {exportable && (
            <Button icon={<ArrowDownload24Regular />} onClick={() => setExportOpen(true)}>
              Export report
            </Button>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Register what "Export report" produces for the current view. */
export function useExportProvider(build: () => ExportPayload): void {
  const set = useUi((s) => s.setExportProvider);
  const ref = useLatest(build);
  useEffect(() => {
    set(() => ref.current());
    return () => set(null);
  }, [set, ref]);
}

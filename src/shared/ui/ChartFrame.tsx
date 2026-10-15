import { Button } from '@fluentui/react-components';
import { Table24Regular, DataPie24Regular } from '@fluentui/react-icons';
import { useState, type ReactNode } from 'react';
import { PALETTES } from './tokens';
import { useUi } from '../../app/store';

export function useChartColors() {
  const theme = useUi((s) => s.theme);
  return PALETTES[theme];
}

export interface TableAlt {
  columns: string[];
  rows: (string | number)[][];
}

/** Chart wrapper: labelled figure, description for assistive tech, and a data-table alternative. */
export function ChartFrame({
  title,
  description,
  children,
  table,
  actions,
  height = 260,
}: {
  title: string;
  description: string;
  children: ReactNode;
  table: TableAlt;
  actions?: ReactNode;
  height?: number;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="sm-card" style={{ margin: 0 }} aria-label={title}>
      <div className="sm-card-head">
        <figcaption className="t-subtitle1">{title}</figcaption>
        <div className="sm-row">
          {actions}
          <Button
            size="small"
            appearance="subtle"
            icon={asTable ? <DataPie24Regular /> : <Table24Regular />}
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
          >
            {asTable ? 'Show chart' : 'View as table'}
          </Button>
        </div>
      </div>
      <p className="sm-visually-hidden">{description}</p>
      {asTable ? (
        <div style={{ maxHeight: height, overflow: 'auto' }}>
          <table className="sm-matrix">
            <caption className="sm-visually-hidden">{title}</caption>
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j} className="sm-num">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </figure>
  );
}

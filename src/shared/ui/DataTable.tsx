import {
  Button,
  Checkbox,
  Menu,
  MenuDivider,
  MenuItem,
  MenuItemCheckbox,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@fluentui/react-components';
import {
  ArrowSortDown16Regular,
  ArrowSortUp16Regular,
  Filter16Filled,
  Filter16Regular,
  ChevronDown16Regular,
} from '@fluentui/react-icons';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useCompact } from './useMedia';
import { Skel } from './Skeleton';

export interface Column<T> {
  id: string;
  header: string;
  width: number;
  minWidth?: number;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null;
  align?: 'left' | 'right';
  filter?: {
    options: { value: string; label: string }[];
    selected: string[];
    onChange: (v: string[]) => void;
  };
  /** Compact card view: 'title' is the card heading, 'hide' omits the field. */
  card?: 'title' | 'hide';
}

export interface SortSpec {
  id: string;
  desc: boolean;
}

interface Props<T> {
  rows: readonly T[];
  columns: Column<T>[];
  getId: (r: T) => string;
  ariaLabel: string;
  sort: SortSpec | null;
  onSortChange: (s: SortSpec | null) => void;
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  bulkActions?: (rows: T[], clear: () => void) => ReactNode;
  onOpen?: (row: T) => void;
  activeId?: string | null;
  density?: 'comfortable' | 'compact';
  height?: number | string;
  footer?: ReactNode;
  animateRows?: boolean;
}

const VIRTUALIZE_ABOVE = 100;

export function DataTable<T>(props: Props<T>) {
  const {
    rows,
    columns,
    getId,
    ariaLabel,
    sort,
    onSortChange,
    selectable,
    selected = [],
    onSelectedChange,
    bulkActions,
    onOpen,
    activeId,
    density = 'comfortable',
    height = 'min(68vh, 720px)',
    footer,
    animateRows,
  } = props;
  const compact = useCompact();
  const uid = useId();
  const rowH = density === 'compact' ? 28 : 36;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [sizing, setSizing] = useState<ColumnSizingState>({});
  const [wrapW, setWrapW] = useState(0);
  const seen = useRef<Set<string>>(new Set());

  const selection = useMemo<RowSelectionState>(
    () => Object.fromEntries(selected.map((id) => [id, true])),
    [selected],
  );
  const sorting = useMemo<SortingState>(() => (sort ? [{ id: sort.id, desc: sort.desc }] : []), [sort]);

  const defs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((c) => ({
        id: c.id,
        header: c.header,
        size: c.width,
        minSize: c.minWidth ?? 60,
        enableSorting: !!c.sortValue,
        accessorFn: (r: T) => (c.sortValue ? c.sortValue(r) : null),
        sortUndefined: 'last' as const,
        cell: (ctx) => c.cell(ctx.row.original),
      })),
    [columns],
  );

  // TanStack Table's instance is not memoisable; this app does not use the React Compiler.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<T>({
    data: rows as T[],
    columns: defs,
    getRowId: (r) => getId(r),
    state: { sorting, columnSizing: sizing, rowSelection: selection },
    onColumnSizingChange: setSizing,
    onSortingChange: (u) => {
      const next = typeof u === 'function' ? u(sorting) : u;
      const first = next[0];
      onSortChange(first ? { id: first.id, desc: first.desc } : null);
    },
    onRowSelectionChange: (u) => {
      const next = typeof u === 'function' ? u(selection) : u;
      onSelectedChange?.(Object.keys(next).filter((k) => next[k]));
    },
    enableRowSelection: !!selectable,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: true,
  });

  const model = table.getRowModel().rows;
  const count = model.length;
  const virtualize = count > VIRTUALIZE_ABOVE;
  const virt = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (compact ? 168 : rowH),
    overscan: 8,
    measureElement: compact ? (el) => el.getBoundingClientRect().height : undefined,
  });
  const items =
    virtualize || compact
      ? virt.getVirtualItems()
      : model.map((_, index) => ({ index, start: index * rowH, size: rowH, key: index }));
  const totalH = virtualize || compact ? virt.getTotalSize() : count * rowH;

  useEffect(() => {
    if (active >= count) setActive(Math.max(0, count - 1));
  }, [count, active]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const moveTo = useCallback(
    (i: number) => {
      const n = Math.max(0, Math.min(count - 1, i));
      setActive(n);
      if (virtualize || compact) virt.scrollToIndex(n, { align: 'auto' });
      else {
        const el = scrollRef.current;
        if (el) {
          const top = n * rowH + 36;
          if (top - rowH < el.scrollTop) el.scrollTop = top - rowH - 36;
          else if (top + rowH > el.scrollTop + el.clientHeight) el.scrollTop = top + rowH - el.clientHeight;
        }
      }
    },
    [count, virt, virtualize, compact, rowH],
  );

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('button, [role=menuitem], input')) return;
    const page = Math.max(1, Math.floor(((scrollRef.current?.clientHeight ?? 400) - 36) / rowH));
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveTo(active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveTo(active - 1);
        break;
      case 'PageDown':
        e.preventDefault();
        moveTo(active + page);
        break;
      case 'PageUp':
        e.preventDefault();
        moveTo(active - page);
        break;
      case 'Home':
        e.preventDefault();
        moveTo(0);
        break;
      case 'End':
        e.preventDefault();
        moveTo(count - 1);
        break;
      case 'Enter': {
        const r = model[active];
        if (r && onOpen) {
          e.preventDefault();
          onOpen(r.original);
        }
        break;
      }
      case ' ': {
        const r = model[active];
        if (r && selectable) {
          e.preventDefault();
          r.toggleSelected();
        }
        break;
      }
      case 'a':
      case 'A':
        if ((e.ctrlKey || e.metaKey) && selectable) {
          e.preventDefault();
          table.toggleAllRowsSelected(true);
        }
        break;
      case 'Escape':
        if (selected.length) onSelectedChange?.([]);
        break;
    }
  };

  const selectedRows = useMemo(
    () => model.filter((r) => selection[r.id]).map((r) => r.original),
    [model, selection],
  );
  const allSelected = count > 0 && model.every((r) => selection[r.id]);
  const someSelected = selected.length > 0 && !allSelected;
  const cols = table.getVisibleLeafColumns();
  const checkW = selectable ? 40 : 0;
  const baseW = cols.reduce((s, c) => s + c.getSize(), 0);
  // Columns stretch to fill a wide container; below that width the grid scrolls horizontally.
  const scale = wrapW > baseW + checkW && baseW > 0 ? (wrapW - checkW - 2) / baseW : 1;
  const colW = (n: number): number => Math.floor(n * scale);
  const totalW = cols.reduce((s, c) => s + colW(c.getSize()), 0) + checkW;
  const titleCol = columns.find((c) => c.card === 'title') ?? columns[0];

  return (
    <div className="sm-table" style={{ height }}>
      {selected.length > 0 && selectable && (
        <div className="sm-bulkbar" role="toolbar" aria-label="Bulk actions">
          <strong>{selected.length} selected</strong>
          {bulkActions?.(selectedRows, () => onSelectedChange?.([]))}
          <Button size="small" appearance="subtle" onClick={() => onSelectedChange?.([])}>
            Clear selection
          </Button>
        </div>
      )}
      <div
        className="sm-table-scroll"
        ref={scrollRef}
        role="grid"
        aria-label={ariaLabel}
        aria-rowcount={count + 1}
        aria-multiselectable={selectable || undefined}
        aria-activedescendant={count ? `${uid}-r${active}` : undefined}
        tabIndex={0}
        onKeyDown={onKey}
      >
        {!compact && (
          <div className="sm-thead" role="row" style={{ width: totalW }}>
            {selectable && (
              <div className="sm-th" role="columnheader" style={{ width: checkW, padding: '0 8px' }}>
                <Checkbox
                  aria-label="Select all rows"
                  checked={allSelected ? true : someSelected ? 'mixed' : false}
                  onChange={(_, d) => table.toggleAllRowsSelected(!!d.checked)}
                />
              </div>
            )}
            {table.getHeaderGroups()[0]?.headers.map((h) => {
              const col = columns.find((c) => c.id === h.column.id) as Column<T>;
              const sorted = h.column.getIsSorted();
              const hasMenu = col.sortValue || col.filter;
              const filtered = (col.filter?.selected.length ?? 0) > 0;
              return (
                <div
                  key={h.id}
                  className="sm-th"
                  role="columnheader"
                  aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                  data-align={col.align}
                  style={{ width: colW(h.getSize()) }}
                >
                  {hasMenu ? (
                    <Menu>
                      <MenuTrigger disableButtonEnhancement>
                        <button className="sm-th-btn" aria-label={`${col.header} column menu`}>
                          <span>{col.header}</span>
                          {sorted === 'asc' && <ArrowSortUp16Regular aria-hidden />}
                          {sorted === 'desc' && <ArrowSortDown16Regular aria-hidden />}
                          {filtered ? (
                            <Filter16Filled aria-hidden style={{ color: 'var(--sm-brand)' }} />
                          ) : (
                            <ChevronDown16Regular aria-hidden />
                          )}
                        </button>
                      </MenuTrigger>
                      <MenuPopover>
                        <MenuList
                          checkedValues={{ [`f-${col.id}`]: col.filter?.selected ?? [] }}
                          onCheckedValueChange={(_, d) => col.filter?.onChange(d.checkedItems)}
                        >
                          {col.sortValue && (
                            <>
                              <MenuItem
                                icon={<ArrowSortUp16Regular />}
                                onClick={() => onSortChange({ id: col.id, desc: false })}
                              >
                                Sort ascending
                              </MenuItem>
                              <MenuItem
                                icon={<ArrowSortDown16Regular />}
                                onClick={() => onSortChange({ id: col.id, desc: true })}
                              >
                                Sort descending
                              </MenuItem>
                              <MenuItem disabled={sorted === false} onClick={() => onSortChange(null)}>
                                Clear sort
                              </MenuItem>
                            </>
                          )}
                          {col.filter && (
                            <>
                              {col.sortValue && <MenuDivider />}
                              <MenuItem disabled icon={<Filter16Regular />}>
                                Filter {col.header.toLowerCase()}
                              </MenuItem>
                              {col.filter.options.map((o) => (
                                <MenuItemCheckbox key={o.value} name={`f-${col.id}`} value={o.value}>
                                  {o.label}
                                </MenuItemCheckbox>
                              ))}
                              <MenuItem disabled={!filtered} onClick={() => col.filter?.onChange([])}>
                                Clear filter
                              </MenuItem>
                            </>
                          )}
                        </MenuList>
                      </MenuPopover>
                    </Menu>
                  ) : (
                    <span>{col.header}</span>
                  )}
                  <div
                    className="sm-resize"
                    role="separator"
                    aria-label={`Resize ${col.header}`}
                    aria-orientation="vertical"
                    data-active={h.column.getIsResizing()}
                    onMouseDown={h.getResizeHandler()}
                    onTouchStart={h.getResizeHandler()}
                    onDoubleClick={() => h.column.resetSize()}
                  />
                </div>
              );
            })}
          </div>
        )}
        <div
          role="rowgroup"
          style={{ position: 'relative', height: totalH, width: compact ? '100%' : totalW, minWidth: '100%' }}
          className={compact ? 'sm-cards' : undefined}
        >
          {items.map((vi) => {
            const row = model[vi.index];
            if (!row) return null;
            const isSel = !!selection[row.id];
            const isActive = vi.index === active;
            const isNew = animateRows && !seen.current.has(row.id);
            if (animateRows) seen.current.add(row.id);
            if (compact) {
              const rest = columns.filter((c) => c !== titleCol && c.card !== 'hide');
              return (
                <div
                  key={row.id}
                  ref={virt.measureElement}
                  data-index={vi.index}
                  id={`${uid}-r${vi.index}`}
                  role="row"
                  aria-selected={isSel}
                  className={`sm-rowcard${isNew ? ' sm-enter' : ''}`}
                  style={{ top: vi.start }}
                  tabIndex={-1}
                  onClick={() => {
                    setActive(vi.index);
                    onOpen?.(row.original);
                  }}
                >
                  <div className="t-body1s" role="gridcell">
                    {titleCol?.cell(row.original)}
                  </div>
                  <dl>
                    {rest.map((c) => (
                      <div key={c.id} style={{ display: 'contents' }} role="gridcell">
                        <dt>{c.header}</dt>
                        <dd>{c.cell(row.original)}</dd>
                      </div>
                    ))}
                  </dl>
                  {selectable && (
                    <Checkbox
                      label="Select"
                      checked={isSel}
                      onChange={() => row.toggleSelected()}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </div>
              );
            }
            return (
              <div
                key={row.id}
                id={`${uid}-r${vi.index}`}
                role="row"
                aria-rowindex={vi.index + 2}
                aria-selected={isSel}
                data-active={isActive && (activeId === undefined || true) ? 'true' : undefined}
                className={`sm-tr${isNew ? ' sm-enter' : ''}`}
                style={{
                  top: vi.start,
                  height: rowH,
                  width: totalW,
                  ...(activeId && getId(row.original) === activeId
                    ? { background: 'color-mix(in srgb, var(--sm-brand) 8%, var(--sm-bg-surface))' }
                    : {}),
                }}
                onClick={() => {
                  setActive(vi.index);
                }}
                onDoubleClick={() => onOpen?.(row.original)}
              >
                {selectable && (
                  <div className="sm-td" role="gridcell" style={{ width: checkW, padding: '0 8px' }}>
                    <Checkbox
                      aria-label={`Select row ${vi.index + 1}`}
                      checked={isSel}
                      onChange={() => row.toggleSelected()}
                    />
                  </div>
                )}
                {row.getVisibleCells().map((cell) => {
                  const col = columns.find((c) => c.id === cell.column.id) as Column<T>;
                  return (
                    <div
                      key={cell.id}
                      className="sm-td"
                      role="gridcell"
                      data-align={col.align}
                      style={{ width: colW(cell.column.getSize()) }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="sm-table-foot">
        <span>
          {count.toLocaleString('en-US')} row{count === 1 ? '' : 's'}
          {virtualize ? ' · virtualized' : ''}
          {onOpen ? ' · Enter opens details' : ''}
        </span>
        {footer}
      </div>
    </div>
  );
}

/** Shimmer rows for a table that is still loading. */
export function RowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ height: 36, padding: '0 12px', display: 'flex', alignItems: 'center' }}>
          <Skel h={12} w={`${40 + ((i * 17) % 50)}%`} />
        </div>
      ))}
    </>
  );
}

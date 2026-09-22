import type { ReactNode } from 'react';
import { EmptyState } from './States';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  /** Hide on narrow screens (card view). */
  hideSm?: boolean;
}

/** Table that turns into stacked cards on phones (labels come from headers). */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  rowClassName,
  dense,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  empty?: ReactNode;
  rowClassName?: (r: T) => string | undefined;
  dense?: boolean;
}) {
  if (!rows.length) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return (
    <div className="table-wrap">
      <table className={`table ${dense ? 'table-dense' : ''} ${onRowClick ? 'table-click' : ''}`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align || 'left', width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              className={rowClassName?.(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === 'Enter' ? onRowClick(r) : undefined) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} data-label={typeof c.header === 'string' ? c.header : ''} className={c.hideSm ? 'hide-sm' : undefined} style={{ textAlign: c.align || 'left' }}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

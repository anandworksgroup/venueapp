import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Wordmark } from './Brand';
import { Icons } from './icons';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number | null;
  end?: boolean;
}
export interface NavGroup {
  title?: string;
  items: NavItem[];
}

/**
 * App frame: sidebar on desktop; on small screens a top bar + slide-in menu,
 * plus an optional bottom tab bar (business portal on phones).
 */
export function Shell({ home, portalLabel, groups, userBlock, tabs, children, banner }: { home: string; portalLabel: string; groups: NavGroup[]; userBlock: ReactNode; tabs?: NavItem[]; children: ReactNode; banner?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const nav = (
    <nav className="side-nav" aria-label="Main">
      {groups.map((g, i) => (
        <div key={i} className="nav-group">
          {g.title && <div className="nav-group-title">{g.title}</div>}
          {g.items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
              {it.icon}
              <span>{it.label}</span>
              {it.badge ? <span className="nav-badge">{it.badge > 99 ? '99+' : it.badge}</span> : null}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
  return (
    <div className={`shell ${tabs ? 'has-tabs' : ''}`}>
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="sidebar-brand">
          <Wordmark size={24} light to={home} />
          <span className="portal-tag">{portalLabel}</span>
        </div>
        {nav}
        <div className="sidebar-foot">{userBlock}</div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn" aria-label="Open menu" onClick={() => setOpen(true)}>
            {Icons.menu}
          </button>
          <Wordmark size={20} to={home} />
          <span className="portal-tag portal-tag-dark">{portalLabel}</span>
        </header>
        {banner}
        <main className="content">{children}</main>
      </div>
      {tabs && (
        <nav className="bottom-tabs" aria-label="Quick navigation">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `bt-item ${isActive ? 'is-active' : ''}`}>
              <span className="bt-icon">
                {t.icon}
                {t.badge ? <span className="bt-badge">{t.badge > 9 ? '9+' : t.badge}</span> : null}
              </span>
              <span>{t.label}</span>
            </NavLink>
          ))}
          <button type="button" className="bt-item" onClick={() => setOpen(true)}>
            <span className="bt-icon">{Icons.more}</span>
            <span>More</span>
          </button>
        </nav>
      )}
    </div>
  );
}

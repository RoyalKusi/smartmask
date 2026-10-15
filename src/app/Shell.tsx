import {
  Button, Menu, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger, Tooltip, Persona,
} from '@fluentui/react-components';
import {
  Beaker24Regular, Navigation24Regular, PanelLeftContract24Regular, PanelLeftExpand24Regular, Search24Regular, Shield24Regular,
  WeatherMoon24Regular, WeatherSunny24Regular, TableSimple24Regular, Info16Regular,
} from '@fluentui/react-icons';
import { useChaos, anyChaos } from '../shared/api/chaos';
import { PRINCIPALS } from '../shared/data/principals';
import { DEFAULT_PRINCIPAL } from '../shared/api/identity';
import { ROLES, type Role } from '../shared/engine/types';
import { roleLabel } from '../shared/ui/format';
import { NAV } from './nav';
import { roleToParam, useRole, useRoute } from './router';
import { switchRole } from './actions';
import { useOverview } from './queries';
import { useUi } from './store';

export function CommandBar() {
  const role = useRole();
  const { theme, toggleTheme, navCollapsed, setNavCollapsed, navOpen, setNavOpen, setPaletteOpen, setChaosOpen, density, setDensity } = useUi();
  const chaos = useChaos();
  const me = PRINCIPALS.find((p) => p.id === DEFAULT_PRINCIPAL[role]);
  return (
    <header className="sm-cmdbar">
      <Button
        appearance="subtle"
        icon={<Navigation24Regular />}
        aria-label="Toggle navigation"
        aria-expanded={navOpen}
        className="sm-show-compact"
        onClick={() => setNavOpen(!navOpen)}
        id="sm-hamburger"
      />
      <Button
        appearance="subtle"
        icon={navCollapsed ? <PanelLeftExpand24Regular /> : <PanelLeftContract24Regular />}
        aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
        className="sm-hide-compact"
        id="sm-collapse"
        onClick={() => setNavCollapsed(!navCollapsed)}
      />
      <div className="sm-brand">
        <span className="sm-brand-mark"><Shield24Regular aria-hidden /></span>
        <span className="sm-hide-compact">SmartMask Console</span>
      </div>
      <button className="sm-search" onClick={() => setPaletteOpen(true)} aria-label="Search and commands (Control K)" aria-haspopup="dialog">
        <Search24Regular aria-hidden />
        <span className="label">Search views, columns, commands</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="sm-spacer" />
      <span className="sm-env-pill" title="Every record in this console is synthetic.">
        <Beaker24Regular aria-hidden style={{ width: 16, height: 16 }} />
        <span>Demo<span className="long"> · Synthetic data</span></span>
      </span>
      {anyChaos(chaos) && (
        <Button size="small" appearance="outline" onClick={() => setChaosOpen(true)} aria-label="Chaos injection is active">
          Chaos on
        </Button>
      )}
      <Tooltip content={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} relationship="label">
        <Button appearance="subtle" icon={theme === 'dark' ? <WeatherSunny24Regular /> : <WeatherMoon24Regular />} onClick={toggleTheme} />
      </Tooltip>
      <div role="radiogroup" aria-label="Role" className="sm-segment">
        {ROLES.map((r: Role) => (
          <button key={r} role="radio" aria-checked={role === r} onClick={() => switchRole(r)} data-testid={`role-${roleToParam(r)}`}>
            {roleLabel(r)}
          </button>
        ))}
      </div>
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button appearance="subtle" aria-label={`Account menu, signed in as ${me?.name ?? 'user'}`} style={{ padding: 2 }}>
            <Persona name={me?.name} size="extra-small" avatar={{ color: 'colorful' }} textAlignment="center" />
          </Button>
        </MenuTrigger>
        <MenuPopover className="sm-acrylic">
          <MenuList>
            <MenuItem disabled icon={<Info16Regular />}>
              {me?.name} · {roleLabel(role)}
            </MenuItem>
            <MenuDivider />
            <MenuItem icon={<TableSimple24Regular />} onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}>
              Table density: {density === 'compact' ? 'Compact (28 px)' : 'Comfortable (36 px)'}
            </MenuItem>
            <MenuItem onClick={() => setPaletteOpen(true)}>Command palette</MenuItem>
            <MenuItem onClick={() => window.location.reload()}>Reset demo state</MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </header>
  );
}

export function Blade() {
  const { view } = useRoute();
  const role = useRole();
  const setNavOpen = useUi((s) => s.setNavOpen);
  const overview = useOverview();
  const reviewCount = overview.data?.review;
  const q = role === 'ROLE_ADMIN' ? '' : `?role=${roleToParam(role)}`;
  return (
    <>
      <nav className="sm-blade" aria-label="Primary">
        {NAV.map((n) => (
          <a
            key={n.id}
            href={`#/${n.id}${q}`}
            className="sm-nav-item"
            aria-current={view === n.id ? 'page' : undefined}
            aria-label={n.label}
            title={n.label}
            onClick={() => setNavOpen(false)}
          >
            {n.icon}
            <span className="sm-nav-label">{n.label}</span>
            {n.id === 'review' && reviewCount !== undefined && <span className="sm-nav-badge">{reviewCount}</span>}
          </a>
        ))}
      </nav>
      <div className="sm-scrim" onClick={() => setNavOpen(false)} aria-hidden />
    </>
  );
}

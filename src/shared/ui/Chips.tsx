import {
  CheckmarkCircle16Filled, Eye16Regular, EyeOff16Regular, Flash16Regular, Info16Regular, LockClosed16Regular, ShieldError16Regular,
  Warning16Regular, Sparkle16Regular, Person16Regular, Dismiss16Regular, Edit16Regular, ArrowSync16Regular,
} from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import type { ColumnState, Role, Tag } from '../engine/types';

export function Chip({ tone, icon, children, title }: { tone: string; icon?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span className="sm-chip" data-tone={tone} title={title}>
      {icon}
      {children}
    </span>
  );
}

const TAG_TONE: Record<Tag, string> = { PII_HIGH: 'high', FINANCIAL_CONFIDENTIAL: 'fin', PII_MEDIUM: 'med' };
const TAG_ICON: Record<Tag, ReactNode> = {
  PII_HIGH: <ShieldError16Regular aria-hidden />,
  FINANCIAL_CONFIDENTIAL: <LockClosed16Regular aria-hidden />,
  PII_MEDIUM: <Eye16Regular aria-hidden />,
};

export function TagChip({ tag }: { tag: Tag | null }) {
  if (!tag) return <span className="t-tertiary">—</span>;
  return (
    <Chip tone={TAG_TONE[tag]} icon={TAG_ICON[tag]}>
      {tag}
    </Chip>
  );
}

const STATE_META: Record<ColumnState, { tone: string; icon: ReactNode; label: string }> = {
  ENFORCED: { tone: 'ok', icon: <CheckmarkCircle16Filled aria-hidden />, label: 'ENFORCED' },
  ENFORCED_ML: { tone: 'brand', icon: <Sparkle16Regular aria-hidden />, label: 'ENFORCED_ML' },
  REVIEW: { tone: 'warn', icon: <Warning16Regular aria-hidden />, label: 'REVIEW' },
  CLEAR: { tone: 'neutral', icon: <EyeOff16Regular aria-hidden />, label: 'CLEAR' },
  OVERRIDDEN: { tone: 'fin', icon: <Edit16Regular aria-hidden />, label: 'OVERRIDDEN' },
};

export function StateChip({ state }: { state: ColumnState }) {
  const m = STATE_META[state];
  return (
    <Chip tone={m.tone} icon={m.icon}>
      {m.label}
    </Chip>
  );
}

export function RoleChip({ role }: { role: Role }) {
  const label = role.replace('ROLE_', '');
  return (
    <Chip tone={role === 'ROLE_ADMIN' ? 'fin' : role === 'ROLE_SUPPORT' ? 'brand' : 'ok'} icon={<Person16Regular aria-hidden />}>
      {label}
    </Chip>
  );
}

export function OutcomeChip({ outcome, code }: { outcome: 'ALLOWED' | 'DENIED'; code?: string | null }) {
  return outcome === 'ALLOWED' ? (
    <Chip tone="ok" icon={<CheckmarkCircle16Filled aria-hidden />}>
      ALLOWED
    </Chip>
  ) : (
    <Chip tone="bad" icon={<Dismiss16Regular aria-hidden />} title={code ?? undefined}>
      DENIED{code ? ` · ${code}` : ''}
    </Chip>
  );
}

export function InfoChip({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return (
    <Chip tone={tone} icon={<Info16Regular aria-hidden />}>
      {children}
    </Chip>
  );
}

export { Flash16Regular, ArrowSync16Regular };

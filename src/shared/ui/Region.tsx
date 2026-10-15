import {
  ArrowClockwise24Regular,
  CloudDismiss24Regular,
  DocumentSearch24Regular,
} from '@fluentui/react-icons';
import { Button } from '@fluentui/react-components';
import { useEffect, useReducer, type ReactNode } from 'react';
import { useLatest } from './useLatest';
import { LOAD_TRANSITIONS, transition, type LoadEvent, type LoadState } from '../engine/fsm';
import { describeError } from '../api/errors';

interface QueryLike<T> {
  status: 'pending' | 'error' | 'success';
  data: T | undefined;
  error: unknown;
  refetch: () => Promise<unknown>;
}

export interface LoadMachine {
  state: LoadState;
  error: { code: string; message: string; technical: string } | null;
  retry: () => void;
}

/**
 * Drives the explicit idle → loading → success | empty | error (+ retrying) machine from a TanStack query.
 * Every transition goes through the declared table in shared/engine/fsm.
 */
export function useLoadMachine<T>(q: QueryLike<T>, isEmpty: (d: T) => boolean = () => false): LoadMachine {
  const [state, dispatch] = useReducer(
    (s: LoadState, e: LoadEvent) => transition(LOAD_TRANSITIONS, s, e).state,
    'idle' as LoadState,
  );
  const emptyRef = useLatest(isEmpty);
  useEffect(() => {
    if (state === 'idle') dispatch('FETCH');
  }, [state]);
  useEffect(() => {
    if (q.status === 'success' && q.data !== undefined) {
      const ev: LoadEvent = emptyRef.current(q.data) ? 'RESOLVE_EMPTY' : 'RESOLVE';
      if (state === 'loading' || state === 'retrying') dispatch(ev);
      else if (state === 'success' && ev === 'RESOLVE_EMPTY') dispatch(ev);
      else if (state === 'empty' && ev === 'RESOLVE') dispatch(ev);
      else if (state === 'error') dispatch('FETCH');
    } else if (q.status === 'error' && (state === 'loading' || state === 'retrying')) dispatch('REJECT');
  }, [q.status, q.data, state, emptyRef]);
  return {
    state,
    error: q.status === 'error' ? describeError(q.error) : null,
    retry: () => {
      dispatch('RETRY');
      void q.refetch();
    },
  };
}

export function ErrorPanel({
  code,
  message,
  technical,
  onRetry,
  retrying,
}: {
  code: string;
  message: string;
  technical: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="sm-card" role="alert">
      <div className="sm-panel-msg">
        <CloudDismiss24Regular className="sm-icon-xl" aria-hidden />
        <div className="t-subtitle1">Something went wrong here</div>
        <div>{message}</div>
        <div>
          Error code <span className="sm-code">{code}</span>
        </div>
        <details className="sm-details">
          <summary>Technical details</summary>
          <pre>{technical}</pre>
        </details>
        {onRetry && (
          <Button
            appearance="primary"
            icon={<ArrowClockwise24Regular />}
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
        )}
      </div>
    </div>
  );
}

export function EmptyPanel({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="sm-card">
      <div className="sm-panel-msg">
        <DocumentSearch24Regular className="sm-icon-xl" aria-hidden />
        <div className="t-subtitle1">{title}</div>
        {children && <div>{children}</div>}
        {action}
      </div>
    </div>
  );
}

export function Region({
  machine,
  skeleton,
  empty,
  children,
}: {
  machine: LoadMachine;
  skeleton: ReactNode;
  empty: ReactNode;
  children: ReactNode;
}) {
  switch (machine.state) {
    case 'idle':
    case 'loading':
      return <>{skeleton}</>;
    case 'retrying':
      return (
        <div>
          <div className="sm-visually-hidden" role="status">
            Retrying
          </div>
          {skeleton}
        </div>
      );
    case 'error':
      return (
        <ErrorPanel
          code={machine.error?.code ?? 'SM-UI-001'}
          message={machine.error?.message ?? 'Unexpected error'}
          technical={machine.error?.technical ?? ''}
          onRetry={machine.retry}
        />
      );
    case 'empty':
      return <>{empty}</>;
    case 'success':
      return <>{children}</>;
  }
}

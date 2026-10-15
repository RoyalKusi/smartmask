import { describe, expect, it } from 'vitest';
import {
  LOAD_TRANSITIONS,
  QUERY_TRANSITIONS,
  SCAN_TRANSITIONS,
  transition,
} from '../../src/shared/engine/fsm';

describe('explicit state machines', () => {
  it('load: idle → loading → success | empty | error, with retrying', () => {
    expect(transition(LOAD_TRANSITIONS, 'idle', 'FETCH').state).toBe('loading');
    expect(transition(LOAD_TRANSITIONS, 'loading', 'RESOLVE').state).toBe('success');
    expect(transition(LOAD_TRANSITIONS, 'loading', 'RESOLVE_EMPTY').state).toBe('empty');
    expect(transition(LOAD_TRANSITIONS, 'loading', 'REJECT').state).toBe('error');
    expect(transition(LOAD_TRANSITIONS, 'error', 'RETRY').state).toBe('retrying');
    expect(transition(LOAD_TRANSITIONS, 'retrying', 'RESOLVE').state).toBe('success');
    expect(transition(LOAD_TRANSITIONS, 'retrying', 'REJECT').state).toBe('error');
  });
  it('no transition is implicit: undeclared events are rejected and leave the state unchanged', () => {
    expect(transition(LOAD_TRANSITIONS, 'idle', 'RESOLVE')).toEqual({ state: 'idle', ok: false });
    expect(transition(LOAD_TRANSITIONS, 'success', 'REJECT')).toEqual({ state: 'success', ok: false });
    expect(transition(LOAD_TRANSITIONS, 'loading', 'RETRY')).toEqual({ state: 'loading', ok: false });
    expect(transition(QUERY_TRANSITIONS, 'idle', 'NEXT').ok).toBe(false);
  });
  it('query pipeline walks parse → validate → rewrite → execute → mask → audit → done and can reject early', () => {
    let s = transition(QUERY_TRANSITIONS, 'idle', 'RUN').state;
    const seen = [s];
    while (s !== 'done') {
      s = transition(QUERY_TRANSITIONS, s, 'NEXT').state;
      seen.push(s);
    }
    expect(seen).toEqual(['parse', 'validate', 'rewrite', 'execute', 'mask', 'audit', 'done']);
    expect(transition(QUERY_TRANSITIONS, 'validate', 'REJECT').state).toBe('rejected');
    expect(transition(QUERY_TRANSITIONS, 'execute', 'REJECT').ok).toBe(false);
  });
  it('scan has five stages then completes, and can fail at any stage', () => {
    let s = transition(SCAN_TRANSITIONS, 'idle', 'START').state;
    const seen = [s];
    while (s !== 'complete') {
      s = transition(SCAN_TRANSITIONS, s, 'NEXT').state;
      seen.push(s);
    }
    expect(seen).toEqual(['connect', 'catalog', 'sample', 'score', 'classify', 'complete']);
    expect(transition(SCAN_TRANSITIONS, 'sample', 'FAIL').state).toBe('failed');
    expect(transition(SCAN_TRANSITIONS, 'failed', 'START').state).toBe('connect');
  });
});

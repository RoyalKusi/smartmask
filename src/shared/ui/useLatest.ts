import { useLayoutEffect, useRef, type MutableRefObject } from 'react';

/** A ref that always holds the latest value, updated after render so event handlers never see stale closures. */
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

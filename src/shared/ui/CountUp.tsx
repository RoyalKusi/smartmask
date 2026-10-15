import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './useMedia';

/** Numbers count up over 400 ms (instant under reduced motion). */
export function CountUp({
  value,
  decimals = 0,
  suffix = '',
}: {
  value: number;
  decimals?: number;
  suffix?: string;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced) return undefined;
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const step = (t: number): void => {
      const p = Math.min(1, (t - start) / 400);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(origin + (value - origin) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  const display = reduced ? value : shown;
  return (
    <span className="sm-num" aria-label={`${value.toFixed(decimals)}${suffix}`}>
      <span aria-hidden>
        {display.toLocaleString('en-US', {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}
        {suffix}
      </span>
    </span>
  );
}

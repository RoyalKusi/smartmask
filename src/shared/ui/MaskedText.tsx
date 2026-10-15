import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './useMedia';

const STEP = 160;

function Chars({ text, total }: { text: string; total: number }) {
  const chars = Array.from(text);
  const per = Math.min(STEP / Math.max(1, total), 12);
  return (
    <>
      {chars.map((c, i) => (
        <span key={i} style={{ animationDelay: `${Math.min(i * per, STEP - 40)}ms` }}>
          {c}
        </span>
      ))}
    </>
  );
}

/**
 * Renders a possibly-masked value. When the displayed text changes (for example after a role switch)
 * it cross-fades character by character over 160 ms; with reduced motion it simply swaps.
 */
export function MaskedText({
  value,
  mono = true,
}: {
  value: string | number | boolean | null | undefined;
  mono?: boolean;
}) {
  const text = value === null || value === undefined ? '∅' : String(value);
  const reduced = useReducedMotion();
  const prev = useRef(text);
  const [old, setOld] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  useEffect(() => {
    if (prev.current === text) return;
    if (!reduced) {
      setOld(prev.current);
      setGen((g) => g + 1);
      const t = window.setTimeout(() => setOld(null), STEP + 60);
      prev.current = text;
      return () => window.clearTimeout(t);
    }
    prev.current = text;
    return undefined;
  }, [text, reduced]);
  const isNull = value === null || value === undefined;
  return (
    <span
      className={`sm-xfade${mono ? ' sm-mono' : ''}`}
      style={isNull ? { color: 'var(--sm-fg-tertiary)' } : undefined}
      title={text}
    >
      {old !== null && (
        <span className="out" aria-hidden key={`o${gen}`}>
          <Chars text={old} total={Math.max(old.length, 1)} />
        </span>
      )}
      <span className="in" key={`i${gen}`}>
        {gen === 0 ? text : <Chars text={text} total={Math.max(text.length, 1)} />}
      </span>
    </span>
  );
}

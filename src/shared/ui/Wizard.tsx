import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Textarea } from '@fluentui/react-components';
import { Checkmark16Filled } from '@fluentui/react-icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface WizardStep {
  label: string;
  content: ReactNode;
  valid: boolean;
}

interface Props {
  open: boolean;
  title: string;
  steps: WizardStep[];
  finishLabel: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onFinish: () => void;
}

/** Three-step wizard. Primary stays disabled until the current step is valid; focus returns to the opener on close. */
export function Wizard({ open, title, steps, finishLabel, busy, error, onCancel, onFinish }: Props) {
  const [step, setStep] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement as HTMLElement | null;
      setStep(0);
      return undefined;
    }
    const el = opener.current;
    if (el && document.contains(el)) setTimeout(() => el.focus(), 0);
    return undefined;
  }, [open]);
  const last = step === steps.length - 1;
  const cur = steps[step] as WizardStep;
  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onCancel()} modalType="modal">
      <DialogSurface className="sm-acrylic" style={{ borderRadius: 'var(--sm-r-dlg)', boxShadow: 'var(--sm-shadow28)', maxWidth: 640, width: '94vw' }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            <ol aria-label="Wizard progress" style={{ display: 'flex', gap: 8, listStyle: 'none', padding: 0, margin: '0 0 16px', flexWrap: 'wrap' }}>
              {steps.map((s, i) => (
                <li key={s.label} aria-current={i === step ? 'step' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: i > step ? 0.6 : 1, fontWeight: i === step ? 600 : 400 }}>
                  <span
                    style={{
                      width: 22, height: 22, borderRadius: 11, display: 'grid', placeItems: 'center', fontSize: 12,
                      background: i <= step ? 'var(--sm-brand)' : 'var(--sm-stroke-subtle)', color: i <= step ? 'var(--sm-on-brand)' : 'var(--sm-fg-primary)',
                    }}
                  >
                    {i < step ? <Checkmark16Filled aria-hidden /> : i + 1}
                  </span>
                  {s.label}
                  {i < steps.length - 1 && <span aria-hidden style={{ margin: '0 4px', color: 'var(--sm-fg-tertiary)' }}>›</span>}
                </li>
              ))}
            </ol>
            <div key={step} className="sm-page">{cur.content}</div>
            {error && <div role="alert" className="sm-chip" data-tone="bad" style={{ marginTop: 12, height: 'auto', padding: '6px 10px', whiteSpace: 'normal' }}>{error}</div>}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button appearance="secondary" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>Back</Button>
            {last ? (
              <Button appearance="primary" disabled={steps.some((s) => !s.valid) || busy} onClick={onFinish}>{busy ? 'Working…' : finishLabel}</Button>
            ) : (
              <Button appearance="primary" disabled={!cur.valid} onClick={() => setStep(step + 1)}>Next</Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

/** Text field that validates on blur and reports its message through Fluent's Field. */
export function ValidatedField({
  label, value, onChange, validate, hint, multiline, placeholder, required = true, type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  validate: (v: string) => string | null;
  hint?: string;
  multiline?: boolean;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'password' | 'number';
}) {
  const [touched, setTouched] = useState(false);
  const err = touched ? validate(value) : null;
  return (
    <Field label={label} required={required} hint={hint} validationState={err ? 'error' : 'none'} validationMessage={err ?? undefined}>
      {multiline ? (
        <Textarea value={value} onChange={(_, d) => onChange(d.value)} onBlur={() => setTouched(true)} placeholder={placeholder} rows={3} resize="vertical" />
      ) : (
        <Input value={value} onChange={(_, d) => onChange(d.value)} onBlur={() => setTouched(true)} placeholder={placeholder} type={type} />
      )}
    </Field>
  );
}

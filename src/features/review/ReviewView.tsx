import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Option,
} from '@fluentui/react-components';
import {
  Checkmark24Regular,
  ClipboardTaskListLtr24Regular,
  Dismiss24Regular,
  Tag24Regular,
  BotSparkle24Regular,
} from '@fluentui/react-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { describeError } from '../../shared/api/errors';
import { api } from '../../shared/api/client';
import { DEFAULT_PRINCIPAL } from '../../shared/api/identity';
import type { ColumnRecord, ReviewItem } from '../../shared/api/types';
import { TAGS, type Tag } from '../../shared/engine/types';
import { Chip, StateChip, TagChip } from '../../shared/ui/Chips';
import { NpeBars } from '../../shared/ui/Gauge';
import { useNotify } from '../../shared/ui/Notify';
import { EmptyPanel, Region, useLoadMachine } from '../../shared/ui/Region';
import { CardsSkeleton } from '../../shared/ui/Skeleton';
import { useFocusReturn } from '../../shared/ui/useFocusReturn';
import { ValidatedField } from '../../shared/ui/Wizard';
import { ViewFrame, useExportProvider } from '../../shared/ui/ViewFrame';
import { useReview } from '../../app/queries';
import { setParams, useRole } from '../../app/router';

type Pending = { item: ReviewItem; action: 'CLEAR' | 'FORCE_TAG' } | null;

function Histogram({ rec }: { rec: ColumnRecord }) {
  const max = rec.shapes[0]?.count ?? 1;
  return (
    <div className="sm-histo" role="table" aria-label={`Value shapes for ${rec.id}`}>
      {rec.shapes.slice(0, 4).map((s) => (
        <div key={s.shape} className="sm-histo-row" role="row">
          <span role="cell" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.shape}>
            {s.shape}
          </span>
          <span role="cell" className="sm-histo-bar">
            <i style={{ width: `${(s.count / max) * 100}%` }} />
          </span>
          <span role="cell" style={{ textAlign: 'right' }}>
            {s.count}
          </span>
        </div>
      ))}
    </div>
  );
}

function ReviewCard({
  item,
  onApprove,
  onPending,
  busy,
}: {
  item: ReviewItem;
  onApprove: (i: ReviewItem) => void;
  onPending: (p: Pending) => void;
  busy: boolean;
}) {
  const r = item.record;
  const t = item.triage;
  const tagWord = t.tag ?? '';
  return (
    <article className="sm-card sm-stack" aria-labelledby={`rv-${r.id}`} style={{ gap: 10 }}>
      <div className="sm-card-head" style={{ marginBottom: 0 }}>
        <button
          id={`rv-${r.id}`}
          className="sm-mono t-subtitle2"
          style={{ all: 'unset', cursor: 'pointer', color: 'var(--sm-brand)', fontWeight: 600 }}
          onClick={() => setParams({ open: `column:${r.id}`, dtab: null }, { replace: false })}
        >
          {r.table}.{r.column}
        </button>
        <StateChip state={r.state} />
      </div>
      <div className="sm-row">
        <Chip tone="neutral">{r.backend}</Chip>
        <Chip tone="neutral">{r.family.replace('_', ' ')}</Chip>
        <TagChip tag={r.suggestedTag} />
        <span className="t-caption1 t-tertiary">masked fail-closed until decided</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 12, alignItems: 'center' }}>
        <NpeBars n={r.n} p={r.p} e={r.e} />
        <div className="sm-num t-body1">
          S <strong>{r.s.toFixed(3)}</strong> <span className="t-secondary">(0.40–0.69 = REVIEW)</span>
          <br />
          <span className="t-secondary">Classifier M {r.m.toFixed(2)} · promotes at ≥ 0.85</span>
        </div>
      </div>
      <div>
        <div className="t-caption1 t-tertiary" style={{ marginBottom: 4 }}>
          Sampled value shapes ({r.sampleSize} rows, no raw values)
        </div>
        <Histogram rec={r} />
      </div>
      <div className="sm-ai" role="note">
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 2 }}>
          <BotSparkle24Regular
            aria-hidden
            style={{ width: 18, height: 18, flex: 'none', marginTop: 1, color: 'var(--sm-brand)' }}
          />
          <div>
            <strong>
              AI triage:{' '}
              {t.action === 'APPROVE'
                ? `Approve as ${tagWord}`
                : t.action === 'FORCE_TAG'
                  ? `Force-tag ${tagWord}`
                  : 'Clear'}
            </strong>
            <span className="t-caption1 t-secondary">
              {' '}
              · {Math.round(t.confidence * 100)}% · recommends only
            </span>
          </div>
        </div>
        {t.reason}
      </div>
      <div className="sm-row" role="group" aria-label={`Decide ${r.id}`}>
        <Button
          size="small"
          appearance="primary"
          icon={<Checkmark24Regular />}
          disabled={busy}
          onClick={() => onApprove(item)}
        >
          Approve
        </Button>
        <Button
          size="small"
          icon={<Dismiss24Regular />}
          disabled={busy}
          onClick={() => onPending({ item, action: 'CLEAR' })}
        >
          Clear…
        </Button>
        <Button
          size="small"
          icon={<Tag24Regular />}
          disabled={busy}
          onClick={() => onPending({ item, action: 'FORCE_TAG' })}
        >
          Force-tag…
        </Button>
      </div>
    </article>
  );
}

function DecisionDialog({
  pending,
  onClose,
  onConfirm,
}: {
  pending: Pending;
  onClose: () => void;
  onConfirm: (why: string, tag: Tag) => Promise<void>;
}) {
  const [why, setWhy] = useState('');
  const [tag, setTag] = useState<Tag>('PII_HIGH');
  const [busy, setBusy] = useState(false);
  const open = pending !== null;
  useFocusReturn(open);
  const err = (v: string): string | null =>
    v.trim().length >= 12
      ? null
      : 'Explain the decision in at least 12 characters; it is written to the audit trail.';
  const isClear = pending?.action === 'CLEAR';
  return (
    <Dialog
      open={open}
      onOpenChange={(_, d) => {
        if (!d.open) {
          setWhy('');
          onClose();
        }
      }}
      modalType="alert"
    >
      <DialogSurface
        className="sm-acrylic"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setWhy('');
            onClose();
          }
        }}
        style={{ borderRadius: 'var(--sm-r-dlg)', boxShadow: 'var(--sm-shadow28)' }}
      >
        <DialogBody>
          <DialogTitle>{isClear ? 'Clear this column?' : 'Force-tag this column'}</DialogTitle>
          <DialogContent>
            <div className="sm-stack">
              <p style={{ margin: 0 }}>
                <span className="sm-mono">{pending?.item.record.id}</span>
                {isClear
                  ? ' will be treated as non-sensitive and shown unmasked to every role. This is a destructive change to protection.'
                  : ' will be masked with the tag you choose, whatever its score.'}
              </p>
              {!isClear && (
                <Field label="Tag">
                  <Dropdown
                    value={tag}
                    selectedOptions={[tag]}
                    onOptionSelect={(_, d) => setTag(d.optionValue as Tag)}
                  >
                    {TAGS.map((t) => (
                      <Option key={t} value={t}>
                        {t}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
              )}
              <ValidatedField
                label="Justification"
                value={why}
                onChange={setWhy}
                validate={err}
                multiline
                placeholder={
                  isClear ? 'Why is this column safe to expose?' : 'Why must this column be masked?'
                }
              />
            </div>
          </DialogContent>
          <DialogActions>
            <Button
              appearance="secondary"
              onClick={() => {
                setWhy('');
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              appearance="primary"
              disabled={!!err(why) || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm(why.trim(), tag);
                  setWhy('');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Saving…' : isClear ? 'Clear column' : 'Force-tag'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export default function ReviewView() {
  const q = useReview();
  const m = useLoadMachine(q, (d) => d.length === 0);
  const qc = useQueryClient();
  const notify = useNotify();
  const role = useRole();
  const actor = DEFAULT_PRINCIPAL[role];
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  useExportProvider(() => ({
    name: 'review-queue',
    rows: (q.data ?? []).map(({ record: r, triage: t }) => ({
      column: r.id,
      backend: r.backend,
      family: r.family,
      S: +r.s.toFixed(3),
      M: +r.m.toFixed(3),
      aiSuggestion: t.action,
      aiTag: t.tag ?? '',
      aiReason: t.reason,
    })),
    summary: { pending: q.data?.length ?? 0 },
  }));

  const decide = async (
    item: ReviewItem,
    action: 'APPROVE' | 'CLEAR' | 'FORCE_TAG',
    reason: string,
    tag?: Tag,
  ): Promise<void> => {
    setBusy(true);
    try {
      const res = await api.decide(
        { columnId: item.record.id, action, ...(tag ? { tag } : {}), reason },
        actor,
      );
      await qc.invalidateQueries();
      const verb = action === 'APPROVE' ? 'Approved' : action === 'CLEAR' ? 'Cleared' : 'Force-tagged';
      notify({
        title: `${verb} ${res.next.id}`,
        body: action === 'CLEAR' ? 'Column is now unmasked.' : `Enforced as ${res.next.tag}.`,
        undo: () => {
          void api.undoDecision(res.previous, actor).then(() => qc.invalidateQueries());
        },
      });
    } catch (e) {
      const d = describeError(e);
      notify({ title: `Could not save the decision (${d.code})`, body: d.message, intent: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ViewFrame
      title="Review Queue"
      icon={<ClipboardTaskListLtr24Regular />}
      subtitle="Columns scoring 0.40–0.69 are masked fail-closed until a person decides. The AI suggestion is advice, never an automatic decision."
    >
      <Region
        machine={m}
        skeleton={<CardsSkeleton count={6} height={400} min={360} />}
        empty={
          <EmptyPanel title="The review queue is clear">
            Every REVIEW column has a decision. New candidates appear after the next scan or schema change.
          </EmptyPanel>
        }
      >
        <div className="sm-review-grid">
          {[...(q.data ?? [])]
            .sort((a, b) => b.record.s - a.record.s)
            .map((item) => (
              <ReviewCard
                key={item.record.id}
                item={item}
                busy={busy}
                onApprove={(i) =>
                  void decide(
                    i,
                    'APPROVE',
                    `Approved as suggested (${i.triage.tag ?? i.record.suggestedTag}). ${i.triage.reason}`,
                    i.triage.tag ?? i.record.suggestedTag ?? 'PII_MEDIUM',
                  )
                }
                onPending={setPending}
              />
            ))}
        </div>
      </Region>
      <DecisionDialog
        pending={pending}
        onClose={() => setPending(null)}
        onConfirm={async (why, tag) => {
          if (!pending) return;
          await decide(pending.item, pending.action, why, pending.action === 'FORCE_TAG' ? tag : undefined);
          setPending(null);
        }}
      />
    </ViewFrame>
  );
}

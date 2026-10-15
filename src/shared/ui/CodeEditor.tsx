import { closeBrackets } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { sql, PostgreSQL, MySQL, SQLite } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { forceLinting, linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import type { Dialect } from '../engine/types';

/** Highlight classes map to --sm-* tokens in styles.css, so both themes stay AA without literals here. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], class: 'sm-tok-kw' },
  { tag: [t.string, t.special(t.string)], class: 'sm-tok-str' },
  { tag: [t.number, t.bool, t.null], class: 'sm-tok-num' },
  { tag: [t.comment, t.lineComment, t.blockComment], class: 'sm-tok-com' },
  { tag: [t.propertyName, t.definition(t.propertyName)], class: 'sm-tok-key' },
  { tag: [t.atom, t.labelName, t.typeName], class: 'sm-tok-prop' },
]);

export interface EditorProps {
  value: string;
  onChange?: (v: string) => void;
  language: 'sql' | 'yaml';
  dialect?: Dialect;
  ariaLabel: string;
  height?: number | string;
  readOnly?: boolean;
  diagnostics?: (text: string) => Diagnostic[];
  /** Bump to re-run the linter when diagnostics depend on external state. */
  lintKey?: unknown;
  onRun?: () => void;
  placeholderText?: string;
}

export function CodeEditor({ value, onChange, language, dialect, ariaLabel, height = 220, readOnly, diagnostics, lintKey, onRun, placeholderText }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, diagnostics, onRun });
  cb.current = { onChange, diagnostics, onRun };

  useEffect(() => {
    if (!host.current) return undefined;
    const lang: Extension =
      language === 'yaml' ? yaml() : sql({ dialect: dialect === 'mysql' ? MySQL : dialect === 'sqlite' ? SQLite : PostgreSQL });
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), history(), bracketMatching(), closeBrackets(),
        keymap.of([
          { key: 'Mod-Enter', run: () => { cb.current.onRun?.(); return true; } },
          indentWithTab, ...defaultKeymap, ...historyKeymap,
        ]),
        lang,
        syntaxHighlighting(highlight),
        lintGutter(),
        linter((v) => cb.current.diagnostics?.(v.state.doc.toString()) ?? [], { delay: 150 }),
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'aria-multiline': 'true' }),
        EditorState.readOnly.of(!!readOnly),
        EditorView.lineWrapping,
        placeholder(placeholderText ?? ''),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cb.current.onChange?.(u.state.doc.toString());
        }),
        EditorView.theme({ '&': { height: typeof height === 'number' ? `${height}px` : height }, '.cm-scroller': { overflow: 'auto' } }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    return () => {
      view.current?.destroy();
      view.current = null;
    };
    // The editor is created once per language/dialect; value and lint updates are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, dialect, readOnly, ariaLabel, height]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    if (view.current) forceLinting(view.current);
  }, [lintKey, value]);

  return <div className="sm-editor" ref={host} />;
}

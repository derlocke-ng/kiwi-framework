// The markdown editor every app uses: a toolbar (the same commands as the
// Kiwi Blog admin editor), write and preview panes side by side on wide
// screens and switchable on phones, word count, keyboard shortcuts. It edits
// a value; saving and conflicts are the caller's (see useDraft).
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Icon } from '../components';
import { useT } from '../hooks';
import { Markdown } from './Markdown';
import '../../shared/widgets.css';

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** The "Done" button; left out when not given. */
  onDone?: () => void;
  /** Ctrl+S / ⌘S. */
  onSave?: () => void;
  /** Words at the right of the status line, e.g. draftStatus(draft.status). */
  status?: string;
  /** Shown as a bar with the two choices while set. */
  conflict?: { onTheirs: () => void; onMine: () => void } | null;
  /** Past 90 % of it the word count says how full the text is. */
  maxLength?: number;
  placeholder?: string;
  autoFocus?: boolean;
  /** The text area's id, for a page with one editor that links to it. */
  inputId?: string;
}

type Cmd = 'bold' | 'italic' | 'h2' | 'h3' | 'link' | 'quote' | 'ul' | 'ol' | 'task' | 'code' | 'codeblock' | 'table';

export function MarkdownEditor({
  value,
  onChange,
  onDone,
  onSave,
  status = '',
  conflict = null,
  maxLength,
  placeholder,
  autoFocus = false,
  inputId,
}: MarkdownEditorProps) {
  const t = useT();
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const [pane, setPane] = useState<'write' | 'preview'>('write');
  const preview = useDeferredValue(value);

  useEffect(() => {
    if (autoFocus) ta.current?.focus();
  }, [autoFocus]);

  /** Replace a range so the browser's undo history keeps it. */
  const replaceRange = (start: number, end: number, text: string) => {
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, text)) {
      el.setRangeText(text, start, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  const wrap = (before: string, after: string, placeholderText: string) => {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value: v } = el;
    const sel = v.slice(s, e) || placeholderText;
    replaceRange(s, e, before + sel + after);
    el.setSelectionRange(s + before.length, s + before.length + sel.length);
  };
  const prefixLines = (prefix: string | ((i: number) => string)) => {
    const el = ta.current;
    if (!el) return;
    const v = el.value;
    const start = v.lastIndexOf('\n', el.selectionStart - 1) + 1;
    let end = v.indexOf('\n', el.selectionEnd);
    if (end === -1) end = v.length;
    const out = v
      .slice(start, end)
      .split('\n')
      .map((line, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + line.replace(/^(#{1,6} |> |- \[[ xX]\] |- |\d+\. )/, ''))
      .join('\n');
    replaceRange(start, end, out);
  };
  const insertBlock = (text: string) => {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: s, value: v } = el;
    const before = s === 0 || v[s - 1] === '\n' ? (s > 1 && v[s - 2] !== '\n' ? '\n' : '') : '\n\n';
    replaceRange(s, el.selectionEnd, `${before}${text}\n`);
  };
  const commands: Record<Cmd, () => void> = {
    bold: () => wrap('**', '**', t('note.boldText')),
    italic: () => wrap('_', '_', t('note.italicText')),
    code: () => wrap('`', '`', t('note.code')),
    h2: () => prefixLines('## '),
    h3: () => prefixLines('### '),
    quote: () => prefixLines('> '),
    ul: () => prefixLines('- '),
    ol: () => prefixLines((i) => `${i + 1}. `),
    task: () => prefixLines('- [ ] '),
    link: () => {
      const url = prompt(t('note.linkUrl'), 'https://');
      if (url) wrap('[', `](${url})`, t('note.linkText'));
    },
    codeblock: () => {
      const el = ta.current;
      const sel = el ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
      insertBlock(`\`\`\`\n${sel || t('note.code')}\n\`\`\``);
    },
    table: () => insertBlock(t('note.tableTemplate')),
  };
  const tool = (cmd: Cmd, title: string, label: React.ReactNode) => (
    <button type="button" data-cmd={cmd} title={title} onClick={() => commands[cmd]()}>
      {label}
    </button>
  );
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const cmd = ({ b: 'bold', i: 'italic', k: 'link', s: 'save' } as Record<string, Cmd | 'save'>)[e.key.toLowerCase()];
    if (!cmd) return;
    e.preventDefault();
    if (cmd === 'save') onSave?.();
    else commands[cmd]();
  };

  const words = (value.match(/\S+/g) || []).length;
  const full = maxLength && value.length > maxLength * 0.9 ? ` · ${t('note.ofMax', { p: Math.round((value.length / maxLength) * 100) })}` : '';
  return (
    <form className="note editor" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
      <div className="md-toolbar" role="toolbar" aria-label={t('note.formatting')}>
        {tool('bold', t('note.bold'), <b>B</b>)}
        {tool('italic', t('note.italic'), <i>I</i>)}
        {tool('h2', t('note.heading'), 'H2')}
        {tool('h3', t('note.subheading'), 'H3')}
        {tool('link', t('note.link'), <Icon name="link" />)}
        {tool('quote', t('note.quote'), '❝')}
        {tool('ul', t('note.bulleted'), '•≡')}
        {tool('ol', t('note.numbered'), '1.')}
        {tool('task', t('note.checklist'), <Icon name="list-checks" />)}
        {tool('code', t('note.inlineCode'), '</>')}
        {tool('codeblock', t('note.codeBlock'), '{ }')}
        {tool('table', t('note.table'), '▦')}
        <span className="spacer" />
        <span className="pane-switch" role="tablist">
          {(['write', 'preview'] as const).map((p) => (
            <button key={p} type="button" data-pane={p} role="tab" aria-selected={pane === p} className={pane === p ? 'active' : ''} onClick={() => setPane(p)}>
              {t(`note.${p}`)}
            </button>
          ))}
        </span>
      </div>
      <div className="alert" hidden={!conflict}>
        <span>{t('note.conflict')}</span>
        <button type="button" className="btn btn-sm" data-act="theirs" onClick={() => conflict?.onTheirs()}>
          {t('note.loadTheirs')}
        </button>
        <button type="button" className="btn btn-sm" data-act="mine" onClick={() => conflict?.onMine()}>
          {t('note.keepMine')}
        </button>
      </div>
      <div className="panes" data-show={pane}>
        <textarea
          ref={ta}
          id={inputId}
          className="md-input"
          spellCheck
          placeholder={placeholder ?? t('note.placeholder')}
          aria-label={t('note.text')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Markdown source={preview} className="md md-preview" empty={<p className="empty-list">{t('note.nothingToPreview')}</p>} />
      </div>
      <div className="editor-status">
        <span className="stats">{`${t('note.words', { n: words })}${full}`}</span>
        <span className="spacer" />
        <span className="save-state">{status}</span>
        {onDone ? (
          <button type="button" className="btn btn-sm btn-primary" data-act="done" onClick={onDone}>
            <Icon name="check" />
            <span>{t('common.done')}</span>
          </button>
        ) : null}
      </div>
    </form>
  );
}

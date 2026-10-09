// A board's note: rendered markdown with tickable tasks, and the editor
// (saves after a pause, asks when another device changed the text meanwhile).
import { useState } from 'react';
import { relTime, tErr } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { Markdown } from '../../../ui/widgets/Markdown';
import { MarkdownEditor } from '../../../ui/widgets/MarkdownEditor';
import { draftStatus, useDraft } from '../../../ui/widgets/useDraft';
import type { Board } from '../data/boards.js';

/** A note is one encrypted, compressed event; this keeps it well under relay message limits. */
const MAX = 60_000;
const fail = (err: unknown) => toast(tErr(err), 'error');

export function NoteBody({ board }: { board: Board }) {
  const t = useT();
  const remote: string = board.doc?.md ?? '';
  const [editing, setEditing] = useState(() => board.canEdit && !remote);
  const draft = useDraft({ remote, save: (text) => board.setDoc(text), maxLength: MAX });
  if (editing) {
    return (
      <div className="note editor">
        <MarkdownEditor
          inputId="md"
          value={draft.text}
          onChange={draft.setText}
          onSave={() => void draft.flush()}
          onDone={() => {
            void draft.flush();
            setEditing(false);
          }}
          status={draftStatus(draft.status)}
          conflict={draft.conflict ? { onTheirs: draft.takeTheirs, onMine: draft.keepMine } : null}
          maxLength={MAX}
          autoFocus
        />
      </div>
    );
  }
  return (
    <div className="note">
      <div className="note-bar">
        <span className="note-meta">{board.doc?.u ? t('note.updated', { when: relTime(board.doc.u) }) : ''}</span>
        {board.canEdit ? (
          <button type="button" className="btn btn-sm" data-act="edit" onClick={() => setEditing(true)}>
            <Icon name="pencil" />
            <span>{t('common.edit')}</span>
          </button>
        ) : null}
      </div>
      <Markdown
        id="noteView"
        source={remote}
        onChange={board.canEdit ? (next) => void board.setDoc(next).catch(fail) : undefined}
        empty={<p className="empty-list">{t(board.canEdit ? 'note.emptyEdit' : 'note.emptyView')}</p>}
      />
    </div>
  );
}

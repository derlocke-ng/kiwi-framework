// A text that several devices edit: typing is saved after a pause, changes
// from elsewhere are applied when nothing is unsaved here, and a clash is
// reported instead of silently overwriting either side.
//
//   const draft = useDraft({ remote: board.doc.md, save: (text) => board.setDoc(text) });
//   <MarkdownEditor value={draft.text} onChange={draft.setText} status={draftStatus(draft.status)} conflict={…} />
import { useCallback, useEffect, useRef, useState } from 'react';
import { t, tErr } from '../../shared/i18n.js';
import { toast } from '../toast';

export type DraftStatus = 'saved' | 'editing' | 'saving' | 'notSaved' | 'tooLong';

export interface Draft {
  text: string;
  setText: (text: string) => void;
  status: DraftStatus;
  /** The text changed elsewhere while this device had unsaved changes. */
  conflict: boolean;
  /** Drop the local changes and take the other device's text. */
  takeTheirs: () => void;
  /** Keep the local text and save it over the other device's. */
  keepMine: () => void;
  /** Save now instead of after the pause. */
  flush: () => Promise<void> | void;
}

export function useDraft({
  remote,
  save,
  delay = 700,
  maxLength = Number.POSITIVE_INFINITY,
}: {
  remote: string;
  save: (text: string) => Promise<unknown> | unknown;
  delay?: number;
  maxLength?: number;
}): Draft {
  const [text, setTextState] = useState(remote);
  const [status, setStatus] = useState<DraftStatus>('saved');
  const [conflict, setConflict] = useState(false);
  const latest = useRef(remote); // what the person sees
  const saved = useRef<string | null>(remote); // what we know is on the network
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const run = useCallback(async () => {
    timer.current = null;
    const value = latest.current;
    if (value.length > maxLength) return setStatus('tooLong');
    if (value === saved.current) return setStatus('saved');
    setStatus('saving');
    const before = saved.current;
    saved.current = value;
    try {
      await saveRef.current(value);
      if (latest.current === value) setStatus('saved');
    } catch (err) {
      saved.current = before; // a later save tries again
      setStatus('notSaved');
      toast(tErr(err), 'error');
    }
  }, [maxLength]);

  const flush = useCallback(() => {
    if (timer.current == null) return;
    clearTimeout(timer.current);
    return run();
  }, [run]);

  const setText = useCallback(
    (value: string) => {
      latest.current = value;
      setTextState(value);
      setStatus('editing');
      if (timer.current != null) clearTimeout(timer.current);
      timer.current = setTimeout(run, delay);
    },
    [run, delay],
  );

  // Another device saved: take it when nothing is pending here, else ask.
  useEffect(() => {
    if (remote === latest.current || remote === saved.current) return;
    if (latest.current === saved.current && timer.current == null) {
      latest.current = remote;
      saved.current = remote;
      setTextState(remote);
    } else {
      setConflict(true);
    }
  }, [remote]);

  const takeTheirs = useCallback(() => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
    latest.current = remoteRef.current;
    saved.current = remoteRef.current;
    setTextState(remoteRef.current);
    setConflict(false);
    setStatus('saved');
  }, []);

  const keepMine = useCallback(() => {
    setConflict(false);
    saved.current = null;
    if (timer.current != null) clearTimeout(timer.current);
    void run();
  }, [run]);

  // Leaving the editor saves what was typed.
  useEffect(
    () => () => {
      if (timer.current != null) {
        clearTimeout(timer.current);
        void run();
      }
    },
    [run],
  );

  return { text, setText, status, conflict, takeTheirs, keepMine, flush };
}

/** The status line's words for a draft status. */
export const draftStatus = (status: DraftStatus): string =>
  ({ saved: t('note.saved'), editing: t('note.editing'), saving: t('note.saving'), notSaved: t('note.notSaved'), tooLong: t('note.tooLong') })[status];

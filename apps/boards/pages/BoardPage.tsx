// One board: its title (tap to rename), who may edit, share and the menu,
// and its content: a checklist or inventory (ItemList) or a note
// (MarkdownEditor with useDraft). Keys that came in the link move into the
// wallet and out of the address bar.
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { tErr } from '../../../shared/i18n.js';
import { listToMarkdown } from '../../../shared/items.js';
import { confirmDialog } from '../../../shared/ui.js';
import { useMount } from '../../../ui/AppShell';
import { Icon } from '../../../ui/components';
import { useKiwi, useT, useTick } from '../../../ui/hooks';
import { openMenu } from '../../../ui/menu';
import { copyText, download, toast } from '../../../ui/toast';
import { Modal } from '../../../ui/widgets/Modal';
import { Board, copyBoard } from '../data/boards.js';
import { healBoard } from '../data/heal.js';
import { boardHash, parseBoardInput } from '../data/links.js';
import { safeFilename } from '../menu.js';
import { go, useWallet } from '../state';
import { ListBody } from './ListBody';
import { NoteBody } from './NoteBody';
import { ShareDialog } from './ShareDialog';

const TITLE = 120;
const fail = (err: unknown) => toast(tErr(err), 'error');

function StateView({ board }: { board: Board }) {
  const t = useT();
  const unlock = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const r = parseBoardInput(String(new FormData(e.currentTarget).get('link') || ''));
    if (!r || r.pub !== board.pub || !(r.k || r.w)) return toast(t('board.unlock.noKey'), 'error');
    go(boardHash(r));
  };
  if (board.state === 'loading' || board.state === 'missing') {
    return (
      <div className="state">
        <span className="spinner" />
        {board.state === 'loading' ? <p>{t('board.state.loading')}</p> : <p dangerouslySetInnerHTML={{ __html: t('board.state.missing') }} />}
      </div>
    );
  }
  if (board.state === 'deleted') {
    return (
      <div className="state">
        <p>{t('board.state.deleted')}</p>
      </div>
    );
  }
  return (
    <div className="state">
      <Icon name="lock" className="big" />
      <p>{t('board.state.locked')}</p>
      <form id="unlock" className="unlock" onSubmit={unlock}>
        <input name="link" placeholder={t('board.state.pasteLink')} autoComplete="off" spellCheck={false} required />
        <button type="submit" className="btn btn-primary">
          {t('common.open')}
        </button>
      </form>
    </div>
  );
}

function DuplicateDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const t = useT();
  const { net } = useKiwi();
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      const title = String(new FormData(e.currentTarget).get('title') || '').trim() || board.info.title;
      const entry = await copyBoard(board, { title }, net);
      await wallet.upsert(entry);
      onClose();
      go(boardHash({ pub: entry.pub }));
    } catch (err) {
      setBusy(false);
      fail(err);
    }
  };
  return (
    <Modal open title={t('board.duplicate.title')} onClose={onClose}>
      <form className="form" id="duplicate" onSubmit={submit}>
        <p className="modal-text">{t('board.duplicate.text')}</p>
        <label className="field">
          {t('board.duplicate.titleLabel')}
          <input name="title" maxLength={TITLE} defaultValue={t('board.duplicate.copySuffix', { title: board.info.title })} required />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t('board.duplicate.action')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function BoardPage({ route }: { route: { pub: string; w: string | null; k: string | null } }) {
  const t = useT();
  const kiwi = useKiwi();
  const mount = useMount();
  const wallet = useWallet();
  const saved = wallet.get(route.pub);
  const w = route.w || saved?.w || null;
  const k = route.k || saved?.k || null;
  // One Board per address and keys; it reads the device first, then the relays.
  const board = useMemo(() => new Board({ pub: route.pub, w, k }, kiwi.net), [route.pub, w, k, kiwi.net]);
  useEffect(() => {
    board.open();
    return () => board.close();
  }, [board]);
  useTick((fn) => board.on(fn));
  const [renaming, setRenaming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const menuBtn = useRef<HTMLButtonElement | null>(null);

  // Keep secrets out of the address bar and history once we have them.
  useEffect(() => {
    if (route.w || route.k) history.replaceState(null, '', boardHash({ pub: route.pub }));
  }, [route.pub, route.w, route.k]);

  const ready = board.state === 'ready';
  const info = board.info;
  // Remember the board (and newer keys or title) in the wallet; push its events out again now and then.
  useEffect(() => {
    if (!ready) return;
    const entry = wallet.get(board.pub);
    const fields = { type: info.type, mode: info.mode, title: info.title };
    const save = !entry
      ? wallet.upsert({ pub: board.pub, w, k, ...fields })
      : entry.title !== fields.title || entry.type !== fields.type || entry.mode !== fields.mode || (w && !entry.w) || (k && !entry.k)
        ? wallet.upsert({ ...entry, ...fields, w: w || entry.w, k: k || entry.k })
        : null;
    Promise.resolve(save).catch(fail);
    wallet.setLocal(board.pub, { opened: Date.now() });
    healBoard(board.pub, kiwi.net).catch(() => {});
  }, [ready, info?.title, info?.type, info?.mode, board, w, k, wallet, kiwi.net]);

  const title = info?.title || (board.state === 'locked' ? t('board.locked') : board.state === 'deleted' ? t('board.deleted') : t('common.loading'));
  useEffect(() => {
    document.title = `${title} · ${mount.name}`;
    return () => {
      document.title = mount.name;
    };
  }, [title, mount.name]);

  const asMarkdown = () =>
    info.type === 'note' ? board.doc?.md || '' : listToMarkdown(info.title, [...board.items.values()], info.mode, t('common.untitled'));
  const menu = () => {
    const entry = wallet.get(board.pub);
    const items: any[] = [];
    if (ready) {
      items.push({ label: t('board.menu.copyText'), icon: 'copy', run: () => copyText(asMarkdown(), t('common.text')) });
      items.push({ label: t('board.menu.download'), icon: 'download', run: () => download(safeFilename(info.title, 'md'), asMarkdown(), 'text/markdown') });
      items.push({ label: t('board.menu.duplicate'), icon: 'copy', run: () => setDuplicating(true) });
    }
    if (entry) {
      items.push({
        label: entry.pinned ? t('board.menu.unpin') : t('board.menu.pin'),
        icon: entry.pinned ? 'pin-off' : 'pin',
        run: () => wallet.upsert({ ...entry, pinned: !entry.pinned }).catch(fail),
      });
      items.push('-');
      items.push({ label: t('board.menu.remove'), icon: 'x', run: removeMine });
    }
    if (ready && board.canEdit) items.push({ label: t('board.menu.delete'), icon: 'trash-2', danger: true, run: destroy });
    if (menuBtn.current) openMenu(menuBtn.current, items);
  };
  async function removeMine() {
    const ok = await confirmDialog({
      title: t('board.remove.title'),
      message: board.canEdit ? t('board.remove.textEdit') : t('board.remove.textView'),
      confirm: t('common.remove'),
      danger: true,
    });
    if (!ok) return;
    await wallet.remove(board.pub);
    go('#/');
  }
  async function destroy() {
    const ok = await confirmDialog({
      title: t('board.delete.title'),
      message: t('board.delete.text', { title: info.title }),
      confirm: t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await board.destroy();
      await wallet.remove(board.pub);
      toast(t('board.delete.done'), 'success');
      go('#/');
    } catch (err) {
      fail(err);
    }
  }
  const rename = async (value: string, save: boolean) => {
    setRenaming(false);
    const next = value.trim();
    if (save && next && next !== info.title) await board.setInfo({ title: next }).catch(fail);
  };

  const editable = board.canEdit && ready;
  return (
    <section className="board">
      <div className="board-head">
        <a className="icon-btn back" href="#/" aria-label={t('app.backToBoards')}>
          <Icon name="chevron-left" />
        </a>
        <div className="board-titles">
          {renaming ? (
            <input
              className="title-input"
              defaultValue={info.title || ''}
              maxLength={TITLE}
              // biome-ignore lint/a11y/noAutofocus: the title was tapped to be edited
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void rename(e.currentTarget.value, true);
                if (e.key === 'Escape') void rename(e.currentTarget.value, false);
              }}
              onBlur={(e) => void rename(e.currentTarget.value, true)}
            />
          ) : (
            <h1
              className={`board-name${editable ? ' editable' : ''}`}
              id="boardName"
              title={editable ? t('board.rename') : ''}
              onClick={() => editable && setRenaming(true)}
            >
              {title}
            </h1>
          )}
          <div className="board-tags" id="boardTags">
            {ready ? (
              <span className="tag">
                <Icon name={board.canEdit ? 'pencil' : 'eye'} />
                {t(board.canEdit ? 'board.canEdit' : 'board.viewOnly')}
              </span>
            ) : null}
          </div>
        </div>
        <div className="board-actions" id="boardActions">
          {ready ? (
            <button type="button" className="btn btn-sm" data-act="share" onClick={() => setSharing(true)}>
              <Icon name="share-2" />
              <span>{t('board.share')}</span>
            </button>
          ) : null}
          {ready || saved || board.state !== 'loading' ? (
            <button type="button" className="icon-btn" data-act="menu" aria-label={t('common.more')} ref={menuBtn} onClick={menu}>
              <Icon name="ellipsis" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="board-body" id="boardBody">
        {ready ? info.type === 'note' ? <NoteBody board={board} /> : <ListBody board={board} /> : <StateView board={board} />}
      </div>
      {sharing && ready ? <ShareDialog board={board} onClose={() => setSharing(false)} /> : null}
      {duplicating && ready ? <DuplicateDialog board={board} onClose={() => setDuplicating(false)} /> : null}
    </section>
  );
}

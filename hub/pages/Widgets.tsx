// Sample data for every widget. Developer-facing, so the gallery's own
// labels are English; the widgets inside it are translated as everywhere.
import { useState } from 'react';
import { DISTRIBUTION } from '../../shared/distribution.js';
import { fingerprint } from '../../shared/events.js';
import { relTime } from '../../shared/i18n.js';
import { randomId } from '../../shared/util.js';
import { StatusPill, Toasts, TopBar } from '../../ui/components';
import { useEvents } from '../../ui/useEvents';
import type { ListItem, NewItem } from '../../ui/widgets';
import { Collection, draftStatus, Feed, ItemList, Markdown, MarkdownEditor, Modal, useDraft } from '../../ui/widgets';

const NOTE = '## A note\n\nSome **bold** and a [link](https://example.org).\n\n- [ ] first task\n- [x] second task\n';
const now = Date.now();
const SAMPLE: ListItem[] = [
  { id: 'a', t: 'milk', d: 0, q: 2, o: 0, c: now, u: now },
  { id: 'b', t: '# Dairy', d: 0, q: null, o: 1, c: now, u: now },
  { id: 'c', t: 'eggs', d: 0, q: null, o: 2, c: now, u: now },
  { id: 'd', t: 'butter', d: 1, q: null, o: 3, c: now, u: now },
];
const STOCK: ListItem[] = [
  { id: 'r', t: 'rice', d: 0, q: 3, o: 0, c: now, u: now },
  { id: 's', t: 'soap', d: 0, q: 0, o: 1, c: now, u: now },
];

/** A list kept in React state, the way an app keeps one in its events. */
function useLocalList(initial: ListItem[]) {
  const [items, setItems] = useState(initial);
  return {
    items,
    onAdd: (add: NewItem[]) => {
      const fresh = add.map((x) => ({ ...x, id: randomId(), c: Date.now(), u: Date.now() }));
      setItems((list) => [...list, ...fresh]);
      return fresh.map((x) => x.id);
    },
    onUpdate: (id: string, patch: Partial<ListItem>) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...patch, u: Date.now() } : x))),
    onRemove: (id: string) => setItems((list) => list.filter((x) => x.id !== id)),
    onRestore: (item: ListItem) => setItems((list) => [...list, item]),
  };
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="card gallery-section" id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function EditorDemo() {
  // "remote" is the text on the network; the button below plays another device.
  const [remote, setRemote] = useState(NOTE);
  const [saves, setSaves] = useState(0);
  const [editing, setEditing] = useState(true);
  const save = async (text: string) => {
    await new Promise((r) => setTimeout(r, 30));
    setRemote(text);
    setSaves((n) => n + 1);
  };
  const draft = useDraft({ remote, save, delay: 1500 });
  return (
    <Section id="editor" title="Markdown editor, draft and view">
      {editing ? (
        <MarkdownEditor
          value={draft.text}
          onChange={draft.setText}
          onSave={() => void draft.flush()}
          onDone={() => {
            void draft.flush();
            setEditing(false);
          }}
          status={draftStatus(draft.status)}
          conflict={draft.conflict ? { onTheirs: draft.takeTheirs, onMine: draft.keepMine } : null}
          maxLength={60_000}
        />
      ) : (
        <>
          <button type="button" className="btn btn-sm" id="editAgain" onClick={() => setEditing(true)}>
            Edit
          </button>
          <Markdown id="mdView" source={remote} onChange={(next) => void save(next)} />
        </>
      )}
      <div className="gallery-controls">
        <button type="button" className="btn btn-sm" id="remoteEdit" onClick={() => setRemote((r) => `${r}\nA line from another device.\n`)}>
          Another device edits
        </button>
        <span className="muted small">
          saves: <b id="saves">{saves}</b>
        </span>
      </div>
      <pre id="savedText" className="gallery-pre">
        {remote}
      </pre>
    </Section>
  );
}

function ListsDemo() {
  const check = useLocalList(SAMPLE);
  const count = useLocalList(STOCK);
  return (
    <>
      <Section id="checklist" title="Checklist">
        <ItemList mode="check" {...check} />
      </Section>
      <Section id="inventory" title="Inventory">
        <ItemList mode="count" {...count} />
      </Section>
      <Section id="readonly" title="Read only">
        <ItemList mode="check" items={check.items} canEdit={false} />
      </Section>
    </>
  );
}

interface Spot {
  id: string;
  name: string;
  pinned: boolean;
}
function CollectionDemo() {
  const [spots, setSpots] = useState<Spot[]>([
    { id: 'seeds', name: 'Seedbank', pinned: false },
    { id: 'gems', name: 'Gem store', pinned: true },
    { id: 'tools', name: 'Tool shed', pinned: false },
    { id: 'books', name: 'Book swap', pinned: false },
  ]);
  return (
    <Section id="collection" title="Collection with pinning and search">
      <Collection
        items={spots}
        keyOf={(s) => s.id}
        textOf={(s) => s.name}
        isPinned={(s) => s.pinned}
        onPin={(s, pinned) => setSpots((list) => list.map((x) => (x.id === s.id ? { ...x, pinned } : x)))}
        compare={(a, b) => a.name.localeCompare(b.name)}
        renderItem={(s) => <div className="gallery-card">{s.name}</div>}
        empty={<p>No spots.</p>}
      />
    </Section>
  );
}

function FeedDemo() {
  const [auto, setAuto] = useState(false);
  const feed = useEvents({ filters: [{ kinds: [1] }], pageSize: 5 });
  return (
    <Section id="feed" title="Feed (kind 1 notes from your relays)">
      <label className="check-row">
        <input type="checkbox" id="autoLoad" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        <span>Load more by scrolling</span>
      </label>
      <Feed
        items={feed.events}
        keyOf={(ev) => ev.id}
        hasMore={feed.hasMore}
        loading={feed.loading}
        onLoadMore={feed.loadMore}
        autoLoad={auto}
        renderItem={(ev) => (
          <article className="gallery-card" data-pubkey={ev.pubkey}>
            <p className="gallery-note">{ev.content}</p>
            <p className="muted small">
              <code>{fingerprint(ev.pubkey)}</code> · {relTime(ev.created_at * 1000)}
            </p>
          </article>
        )}
      />
    </Section>
  );
}

function ModalDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Section id="modal" title="Modal">
      <button type="button" className="btn btn-sm" id="openModal" onClick={() => setOpen(true)}>
        Open a modal
      </button>
      <Modal open={open} title="A modal" onClose={() => setOpen(false)} id="demoModal">
        <p className="modal-text">Escape, the close button or a tap outside closes it.</p>
      </Modal>
    </Section>
  );
}

export function Widgets() {
  return (
    <>
      <TopBar brand={{ href: './', html: DISTRIBUTION.brandHtml, label: DISTRIBUTION.name }} right={<StatusPill href="settings.html#relays" />} />
      <main className="settings gallery">
        <h1>Widgets</h1>
        <EditorDemo />
        <ListsDemo />
        <CollectionDemo />
        <FeedDemo />
        <ModalDemo />
      </main>
      <Toasts />
    </>
  );
}

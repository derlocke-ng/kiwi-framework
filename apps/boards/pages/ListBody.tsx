// A board's checklist or inventory: the ItemList widget on the board's
// events. The device remembers the counts for the start page and whether the
// done section is open.
import { useEffect } from 'react';
import { stats } from '../../../shared/items.js';
import { ItemList, type ListItem, type NewItem } from '../../../ui/widgets/ItemList';
import type { Board } from '../data/boards.js';
import { useWallet } from '../state';

export function ListBody({ board }: { board: Board }) {
  const wallet = useWallet();
  const items = [...board.items.values()] as ListItem[];
  const s = stats(items);
  useEffect(() => {
    wallet.setLocal(board.pub, { total: s.total, done: s.done });
  }, [wallet, board.pub, s.total, s.done]);
  return (
    <ItemList
      items={items}
      mode={board.info.mode === 'count' ? 'count' : 'check'}
      canEdit={board.canEdit}
      onAdd={(add: NewItem[]) => Promise.all(add.map((x) => board.addItem(x)))}
      onUpdate={(id, patch) => board.updateItem(id, patch)}
      onRemove={(id) => board.removeItem(id)}
      onRestore={(item) => board.addItem(item)}
      showDone={wallet.localOf(board.pub).showDone ?? true}
      onShowDone={(open) => wallet.setLocal(board.pub, { showDone: open })}
    />
  );
}

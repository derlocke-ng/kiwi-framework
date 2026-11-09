# market

A market on nostr: listings with photos for the community a mount serves, found by category and by where the buyer is, sealed before they leave the browser. Buyers write to a seller in the chat (a message about the listing is drafted for them) or use the contact the seller gave, shown on request. One of the framework's own apps; [Armory](https://github.com/derlocke-ng/armory) mounts it as **Trading Post**, its market for hemp (seeds, cuttings, gear), for people with an account (`requireAccount: true`, no age check).

## What is on the wire

- A **listing** is a kind 30830 addressable event: `d` a random id, `a` the space, `key` the id of the key it is sealed with (the space's, or one of the seller's audiences for a listing to friends or a circle), `expiration` (NIP-40, 30 to 90 days), and for a listing to the space its search labels; content sealed to `{ v: 1, title, text, category, price, from, ships: [<country>|"EU"|"WW"…], pickup, media: [<media object>…], contact, status: "open"|"reserved"|"sold", name, at }`. Editing, renewing and marking it reserved or sold republish it under the same `d`; deleting publishes `{ del: 1 }` under the same key.
- **Search labels** are NIP-32 `l` tags in the namespace `wjs/label`: for each of `cat:<category>`, `from:<country>`, `to:<destination>`, `cat:<category>|to:<destination>`, `pickup:<country>`, `cat:<category>|pickup:<country>`, the first 16 hex characters of HKDF-SHA-256 under the space key with info `wjs/label/v1|<word>` (`shared/sealed.js`). A buyer in Austria looking for seeds asks for the labels of `cat:seeds|to:AT`, `…|to:EU` and `…|to:WW`. The relays match codes; anyone who knows the space computes them too.
- **Reports**: NIP-56 with the listing's `a`, `e` and `["k", "30830"]`. One by a moderator of the space folds a listing away on its own, three by anyone else do.

## Files

| File | What |
|---|---|
| `data/market.js` | a listing checked, its words and labels, a buyer's search, posting, status, deleting, reporting, routes |
| `state.ts` | the context and the hooks the pages share |
| `pages/Home.tsx` | the listings: all (filtered by category and place), mine, saved |
| `pages/Listing.tsx` | a listing as a card and in full |
| `pages/Panels.tsx` | a listing and a seller in a panel over the listings |
| `pages/Compose.tsx` | the form for a listing |
| `pages/MarketSettings.tsx` | my country, a default contact, how long listings stay up |

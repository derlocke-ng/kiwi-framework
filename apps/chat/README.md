# chat

Private messages between accounts and live rooms that vanish, on nostr. One of the framework's own apps; [Armory](https://github.com/derlocke-ng/armory) mounts it as **Uplink** (`framework: 'chat'`), live at <https://derlocke-ng.github.io/armory/uplink/>.

## Messages

A message is a **NIP-17** rumor (kind 14: the text and a `p` tag for the reader) sealed and gift-wrapped (**NIP-59**, kind 1059) once for the reader and once for the writer's own key, so every device of both people sees the conversation and relays see only that some key received a wrapped note: not who wrote, not to whom, not what. The wraps live in the event store like everything else (synced, healed, backed up); once unwrapped on a device they go into the store's `chat` table, which the screens read by conversation. Messages go to friends (the suite's People); one from someone else shows up marked as such, with "add as friend" and "block" one tap away, and a blocked person's messages vanish on every device. Read marks are the device's own.

## Rooms

A room is a link: its `#secret` names the room (relays see a hash of it) and is the key everything in it is sealed with. Messages and presence are **ephemeral** nostr events (kinds 21710 and 21700) tagged with the room's id: relays pass them to whoever is in the room right now and keep nothing, so a room has no history and is gone when the last person leaves. Everyone speaks under a key made for the visit; the nickname travels inside the sealed content. No account is needed. This is what EnigmaJS did, on nostr.

## Files

| File | What |
|---|---|
| `main.tsx`, `App.tsx` | the page; routes `#/` (rooms and conversations), `#/dm/<pk>`, `#/room/<secret>`, `#/settings` |
| `data/dm.js` | `DirectMessages`: wrapping, unwrapping, the inbox, read marks |
| `data/rooms.js` | `Room`: joining, presence, saying, who is here |
| `pages/` | `Home`, `Conversation` (with the `Composer`), `RoomView`, `ChatSettings` |
| `chat.css`, `locales/` | the app's own styles and strings |

`node test/e2e/chat.mjs` runs two accounts and some strangers against a local relay on a test hub; Armory runs the same suite against its site.

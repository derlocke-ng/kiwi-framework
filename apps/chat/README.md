# chat

Private messages between accounts and live rooms that vanish, on nostr. One of the framework's own apps; [Armory](https://github.com/derlocke-ng/armory) mounts it as **Uplink** (`framework: 'chat'`), live at <https://derlocke-ng.github.io/armory/uplink/>.

## Messages

A message is a **NIP-17** rumor (kind 14: the text and a `p` tag for the reader) sealed and gift-wrapped (**NIP-59**, kind 1059) once for the reader and once for the writer's own key, so every device of both people sees the conversation and relays see only that some key received a wrapped note: not who wrote, not to whom, not what. The wraps live in the event store like everything else (synced, healed, backed up); once unwrapped on a device they go into the store's `chat` table, which the screens read by conversation. Messages go to friends (the suite's People); one from someone else shows up marked as such, with "add as friend" and "block" one tap away, and a blocked person's messages vanish on every device. Read marks are the device's own.

## Groups

A group stays until its host closes it. It is a key pair: its pubkey is where its events live and its secret signs them (relays see one anonymous author); every event is sealed with the group's read key and carries, inside, an event signed by the member who wrote it. The invite link holds neither key, only the group's address, its host and an invite token: opening it knocks (a sealed note to the host), the host lets the person in (or lets anyone with the link in), and only then do the keys travel to them, sealed to their own key. Members can invite friends directly. When someone leaves or is removed, the host hands the others a new read key, so what follows stays theirs. The host can reset the invite link and close the group, which drops it on every member's device. The protocol is in the framework's `docs/protocol.md`, §7b.

## Rooms

A room is a link: its `#secret` names the room (relays see a hash of it) and is the key everything in it is sealed with. Messages and presence are **ephemeral** nostr events (kinds 21710 and 21700) tagged with the room's id: relays pass them to whoever is in the room right now and keep nothing, so a room has no history and is gone when the last person leaves. Everyone speaks under a key made for the visit; the nickname travels inside the sealed content. No account is needed. This is what EnigmaJS did, on nostr.

## Files

| File | What |
|---|---|
| `main.tsx`, `App.tsx` | the page; routes `#/` (rooms and conversations), `#/dm/<pk>`, `#/room/<secret>`, `#/settings` |
| `shared/chat.js` (framework) | `DirectMessages`: wrapping, unwrapping, the inbox, read marks; started by the runtime on every page, so the hub counts unread messages and any app can send into a conversation |
| `data/rooms.js` | `Room`: joining, presence, saying, who is here |
| `shared/groups.js` (framework) | `Groups`: the groups a person is in, knocks and keys, joins and leaves, re-keying, closing; started by the runtime |
| `pages/` | `Home` (Messages and Groups tabs), `Conversation` (with the `Composer`), `GroupView` (the door, the group), `RoomView`, `ChatSettings` |
| `chat.css`, `locales/` | the app's own styles and strings |

`node test/e2e/chat.mjs` runs two accounts and some strangers against a local relay on a test hub; Armory runs the same suite against its site.

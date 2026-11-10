# chat

Private messages between accounts, groups and live rooms that vanish, on nostr. A message carries the writer's name inside the seal, so the reader can name them before they are friends; a group is made and spoken in without waiting for a relay (the outbox delivers). One of the framework's own apps; [Armory](https://github.com/derlocke-ng/armory) mounts it as **Uplink** (`framework: 'chat'`), live at <https://derlocke-ng.github.io/armory/uplink/>.

## Messages

A message is a **NIP-17** rumor (kind 14: the text and a `p` tag for the reader) sealed and gift-wrapped (**NIP-59**, kind 1059) once for the reader and once for the writer's own key, so every device of both people sees the conversation and relays see only that some key received a wrapped note: not who wrote, not to whom, not what. The wraps live in the event store like everything else (synced, healed, backed up); once unwrapped on a device they go into the store's `chat` table, which the screens read by conversation. Messages go to friends (the suite's People); one from someone else shows up marked as such, with "add as friend" and "block" one tap away, and a blocked person's messages vanish on every device. Read marks are the device's own.

## Groups

A group stays until its host closes it. It is a key pair: its pubkey is where its events live and its secret signs them (relays see one anonymous author); every event is sealed with the group's read key and carries, inside, an event signed by the member who wrote it. The invite link holds neither key, only the group's address, its host and an invite token: opening it knocks (a sealed note to the host), the host lets the person in (or lets anyone with the link in), and only then do the keys travel to them, sealed to their own key. The host is told of a knock on whatever page of the hub they are (and the group's row in the list says who waits); the person who knocked is told when they are in. The host's device answers, so a knock waits until one of the host's devices is online, also in a group that lets anyone with the link in. Members invite friends from inside the group: the keys travel sealed to the friend, who sees an invitation in the Groups tab and says yes or no; a live room is offered the same way, so no link has to change hands among friends. The friends list in the site settings opens a conversation with a friend. When someone leaves or is removed, the host hands the others a new read key, so what follows stays theirs. The host can reset the invite link and close the group, which drops it on every member's device. The protocol is in the framework's `docs/protocol.md`, §7b.

## After a message is sent

Tap a message for its actions: a reaction (one a person; tap it again, or the chip under the message, to take it back), reply (the answer quotes it; a tap on the quote goes to it), copy, edit (your own text; both sides see it marked as edited), pin (above the conversation, for both sides; a tap on the bar goes to the message, the next tap to the next pin) and delete (your own, for both sides). Each is a sealed event of its own, sent like the messages (a gift-wrapped rumor in a conversation, a member's event inside the group's seal), and every device folds them into what it shows, in whatever order they came (`shared/chatlog.js`). A conversation or a group can make its messages **disappear** after five minutes to four weeks (either person in a conversation, the host in a group): each message then carries NIP-40's expiration inside and out, relays that keep to it drop the copies and every device running this app forgets them on time. Conversations can be pinned to the top of the lists, and the **search** (the magnifier) looks through every conversation and group on the device. The protocol is §7c of the framework's `docs/protocol.md`.

## Calls

The phone and camera buttons above a conversation or a group ring the others: a sealed step in the conversation (so a missed or declined call, or how long one lasted, is a line there on every device), with the secret of a room in which the browsers find each other (sealed ephemeral events on the hub's relays, as Payload's direct transfers do). Voice and pictures then go straight between the browsers (WebRTC). In a call: the microphone, the camera (on or off at any time), the other camera of a phone, hang up; elsewhere in the chat a green bar leads back. A friend's call rings on every page of the hub (in the chat as a card with answer, answer with video and decline; elsewhere as a toast); a stranger's is only a line. A group's call rings everyone in it and anyone joins from its line; it suits a handful of people. Where two networks allow no direct path, a TURN server the hub names (`ice`, `HUB_ICE`) carries the call. `calling.ts` holds the call this page is in; `shared/calls.js` the media.

## Rooms

A room is a link: its `#secret` names the room (relays see a hash of it) and is the key everything in it is sealed with. Messages and presence are **ephemeral** nostr events (kinds 21710 and 21700) tagged with the room's id: relays pass them to whoever is in the room right now and keep nothing, so a room has no history and is gone when the last person leaves. Everyone speaks under a key made for the visit; the nickname travels inside the sealed content. Leaving tells the room, so the others drop the name at once; a reload puts the person straight back in as the same person (the tab keeps the visit's key and name in session storage). No account is needed. This is what EnigmaJS did, on nostr.

## Files

| File | What |
|---|---|
| `main.tsx`, `App.tsx` | the page; routes `#/` (conversations), `#/groups`, `#/dm/<pk>`, `#/group/…` (either with `?m=<id>` to show a message), `#/room/<secret>`, `#/search`, `#/call` (the call; `#/call/<id>` a ringing one), `#/settings` |
| `shared/chat.js` (framework) | `DirectMessages`: wrapping, unwrapping, the inbox, read marks; started by the runtime on every page, so the hub counts unread messages and any app can send into a conversation |
| `data/rooms.js` | `Room`: joining, presence, saying, who is here |
| `shared/groups.js` (framework) | `Groups`: the groups a person is in, knocks and keys, joins and leaves, re-keying, closing; started by the runtime |
| `shared/chatlog.js` (framework) | replies, reactions, edits, pins, deletions and timers: reading them from events and folding them into messages |
| `shared/calls.js` (framework), `calling.ts` | a call's media and room; the call this page is in, and its steps |
| `pages/` | `Call` (the call, the ringing card, the bar back), `Home` (Messages and Groups tabs), `Thread` (the messages, their actions, the pin bar and the `Composer`, for conversations and groups), `Conversation`, `GroupView` (the door, the group), `Search`, `RoomView`, `ChatSettings` |
| `chat.css`, `locales/` | the app's own styles and strings |

`node test/e2e/chat.mjs` runs two accounts and some strangers against a local relay on a test hub; Armory runs the same suite against its site.

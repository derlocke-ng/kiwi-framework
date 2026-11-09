# The kiwi protocol, version 1

What a kiwi hub reads and writes: every event kind, tag, content format, key derivation and file format the framework and its apps use, as of October 2026. This is the document a new client would be written from if every line of UI code were lost. It is versioned: anything that changes the meaning of an event on a relay bumps the version and gets a migration note at the end. The decision record is in [`architecture.md`](architecture.md); this file states only what is on the wire.

Everything here is a nostr event ([NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md)): `{ id, pubkey, created_at, kind, tags, content, sig }`, Schnorr-signed, published to the user's relay list. Keys are 32 bytes, written as 64 hex characters; `npub`/`nsec` ([NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md)) only in the UI. Where a NIP exists for a thing, we use the NIP and say so; our own kinds live in ranges nobody else uses.

## 1. Conventions

- **Addressable events** (kinds 30000–39999) are identified by `kind:pubkey:d`; a relay keeps the newest per address. Newest means greater `created_at`, and on a tie the lower `id` wins (NIP-01). Because `created_at` has one-second resolution, a device never signs two events for the same address with the same timestamp: it uses `max(now, last + 1)` per address (`stamp()`), where `last` is the newest `created_at` it has signed **or seen** for that address. Seen counts every version the device has read from its store or received from a relay, so an edit always supersedes what the person was looking at, even when another device's clock runs ahead of this one's; stamping by the local clock alone would let relays and stores drop the edit as older. Clients apply the same rule when merging.
- **Ephemeral events** (20000–29999) are passed on by relays and not stored.
- **Deletion** is a new version of the addressable event whose content is `{ "del": 1, "u": <ms> }` (sealed where the kind is sealed). Tombstones are kept by clients so a deleted thing cannot come back from a relay that missed the deletion. NIP-09 deletion events (kind 5) are not relied on.
- **Sealed content** means the content string is `seal(key, value)`: the JSON of `value` as UTF-8, gzip-compressed when longer than 1024 bytes and smaller compressed (then version 2, else version 1), encrypted with AES-256-GCM under a 32-byte key with a random 12-byte IV and the one-byte version as additional data; the result is base64url of `version (1 byte) | iv (12) | ciphertext+tag`. Nothing but the version byte is readable without the key.
- **Derived keys** are HKDF-SHA-256 over a secret with an ASCII label as `info`, no salt, 32 bytes out: `deriveKey(secret, label)`.
- **The self key** is `deriveKey(sk, "wjs/self")`: what a user seals things to themselves with (settings, wallets).
- **Timestamps** in content (`c`, `u`, `created`, `at`) are milliseconds since the epoch unless the field is a nostr `created_at`, which is seconds. The `wjs` prefix in labels and storage keys is historical and part of the protocol; it does not change.

## 2. Identity

A user is a nostr key pair. Every browser starts with a key of its own (the **device key**). An **account** makes one key available on every device without a server:

```
name      = trim(NFKC(username)).toLowerCase(), matching ^[\p{L}\p{N}][\p{L}\p{N}._-]{2,39}$
password  = NFKC(password), at least 10 characters
salt      = sha256("wjs/account/v1|" + name)
dk        = scrypt(password, salt, N=2^16, r=8, p=1, dkLen=64)
lookupSk  = dk[0..32)        lookupPk = pubkey(lookupSk)
wrapKey   = dk[32..64)
```

| | |
|---|---|
| kind | **30790** (addressable) |
| author | the user's key (`sk`'s pubkey) |
| tags | `["d", lookupPk]`, `["v","2"]` |
| content | `seal(wrapKey, { "v": 2, "sk": <user secret key hex>, "alias": <name> })` |

Login is one request for two addresses: `{ kinds: [30790], "#d": [lookupPk] }` and the first form's `{ kinds: [30790], authors: [lookupPk], "#d": ["account"] }` (v1: authored by the lookup key, content `{ "v": 1, … }`), newest first; the first event that opens with `wrapKey` wins, and in today's form it must be authored by the key it holds. Nobody who lacks both username and password can compute `lookupPk`, so the event cannot be found, spammed or overwritten; names need not be unique, since a different password is a different lookup key. Creating an account first fetches both addresses and refuses if an event opens to a different key.

**Retiring a password.** The user's key authors today's entry, so it can replace it: an empty event at the same address with `["retired","1"]` (newest wins on every relay), followed by a kind **5** deletion with `["a", "30790:<user pubkey>:<lookupPk>"]`. A password change publishes the new password's entry and retires the old; a sign-in with a first-form entry republishes it in today's form and retires the first form (an empty event and a kind 5 signed by the lookup key, which only that sign-in holds). An empty entry opens nothing.

Keys travel in other forms: `nsec`, 64 hex characters, or an `ncryptsec` ([NIP-49](https://github.com/nostr-protocol/nips/blob/master/49.md), log n = 16) for an encrypted export.

## 3. Settings that follow the account

| | |
|---|---|
| kind | **30791** (addressable) |
| author | the user |
| tags | `["d", <namespace>]` |
| content | `seal(selfKey, <object>)` |

One event per namespace. Namespaces and their keys today:

| `d` | keys |
|---|---|
| `suite` | `theme` (`"light"` \| `"dark"` \| unset), `lang` (a language code the hub ships), `hiddenApps` (mount ids), `appOrder` (mount ids in the person's order; empty or unset: the hub's), `mediaServers` (media server base URLs, first choice first; unset: the hub's, §9) |
| `people` | see §5 |
| `loadout` | the boards app's own preferences |
| `devboard` | `saved` (addresses), `type` (`"hiring"` \| `"available"`), `contact` |

A client merges by the addressable rule and caches the last object locally so screens draw before relays answer. Unknown keys are preserved on write.

## 4. Blocking and reporting

**Block list**: a [NIP-51](https://github.com/nostr-protocol/nips/blob/master/51.md) mute list, kind **10000** (replaceable), with no public tags. The private part is the content: NIP-44 v2 encryption, with the conversation key of the user's own key pair (`getConversationKey(sk, pk)`), of the JSON array of tags `["p", <pubkey>]` or `["p", <pubkey>, <reason>]`. Other NIP-51 clients read the same list; relays and other people learn nothing. Apps check it before showing a post, accepting a message, a friend request or a share.

**Report**: [NIP-56](https://github.com/nostr-protocol/nips/blob/master/56.md), kind **1984**. Tags `["p", <pubkey>, <type>]` and, when about one event, `["e", <id>, <type>]`; apps that report addressable events add `["a", <address>]` and `["k", <kind>]`. Types: `spam`, `illegal`, `impersonation`, `nudity`, `malware`, `profanity`, `other`. Content is an optional note, at most 500 characters. A report may carry NIP-32 tags asking for a mark instead (§13, *Marks*). Reports are public and signed; relay operators act on them, and clients may hide what many trusted people reported.

## 5. People: friends, circles, sharing

Everything private between two people travels as a [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) gift wrap: a **rumor** (unsigned event) inside a **seal** (kind 13, signed by the sender) inside a **gift wrap** (kind **1059**, signed by a throwaway key, `["p", <recipient>]`, `created_at` randomised up to two days back). Relays see only that some key received a wrapped note. An inbox asks for `{ kinds: [1059], "#p": [me], since: now − 30 days }`.

Rumors carry `["p", <recipient>]` and JSON content:

| rumor kind | content | meaning |
|---|---|---|
| **7801** friend request | `{ "name": <sender's alias> }` | asks to be friends |
| **7802** friend accept | `{ "name": <alias> }` | friends now, both ways |
| **7803** friend remove | `{}` | not friends any more |
| **7804** share | `{ "app": <app id, ≤ 32 chars>, "payload": <object> }` | something for one of the recipient's apps; `payload.url` is what a notice opens |
| **14** private message ([NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md)) | the text, plain (≤ 4000 characters) | the chat: wrapped once for the reader and once for the writer's own key, so the writer's other devices hold the conversation too; a device unwraps each wrap once and keeps the message in its store's `chat` table |
| **15** file message ([NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md)) | the file's URL | a file in the chat, wrapped like a message: the file is encrypted on the sender's media servers (§9, *Files in messages*), the rumor carries `file-type`, `encryption-algorithm` (`aes-gcm`), `decryption-key`, `decryption-nonce`, `x`, `ox`, `size`, `dim`, and `file-name` (ours) |

Friendship is mutual and symmetric: a request answered by an accept makes both sides friends; two crossing requests are an acceptance; a request from someone already a friend is answered with an accept again; a remove drops the friend on both sides. Each wrap is processed once (`seen`, the last 500 ids). The recipient's state is the `people` settings namespace (§3):

```
friends   [{ "pk", "name", "since" }]
incoming  [{ "pk", "name", "at" }]      requests waiting for me
outgoing  [{ "pk", "at" }]              requests I sent
circles   [{ "id", "name", "members": [pk] }]   named groups of friends, private
shares    [{ "id", "app", "from", "name", "payload", "at" }]   the last 100, until an app consumes them
seen      [event id]
```

Shares go only to friends; a share from a non-friend or a blocked key is dropped. Loadout shares `{ "type": "board", "url", ... }` (a board link with the keys of the chosen role); Payload a transfer link.

## 6. Boards (Loadout): lists, inventory, notes

A **board** is its own key pair. Whoever holds the board's secret key `w` can write; whoever holds the read key `k = deriveKey(w, "wjs/loadout/read")` can read. The board's public key `pub = pubkey(w)` is its identity. A link carries the role: `<app url>#/b/<pub>?w=<w>` to edit, `<app url>#/b/<pub>?k=<k>` to view.

Board events are signed by `w` and sealed with `k`:

| kind | `d` | content (sealed) |
|---|---|---|
| **30701** info | `info` | `{ "v": 1, "type": "list" \| "note", "title", "mode": "check" \| "count", "created" }` |
| **30702** item | item id (random, base64url) | `{ "t": <text>, "d": 0 \| 1 (done), "q": <quantity or null>, "o": <order>, "c": <created ms>, "u": <updated ms> }` |
| **30703** doc | `body` | `{ "md": <markdown>, "u": <updated ms> }` |

A board is `type: "note"` with one doc, or a list whose `mode` is `check` (to-do, groceries) or `count` (inventory). Deleting an item, the doc or the board writes `{ "del": 1, "u" }` to that address.

The **wallet** is the user's own list of boards, one event per board, sealed to the self key:

| | |
|---|---|
| kind | **30700** (addressable) |
| author | the user |
| `d` | `sha256("wjs/loadout/wallet|" + pub)` as hex, first 32 characters |
| content | `seal(selfKey, { "pub", "w" or null, "k", "type", "title", "mode", ... })` |

A device signed in as the user subscribes to `{ kinds: [30700], authors: [me] }` and gets every board on every device; a board someone shared arrives as a share (§5) and is added to the wallet.

## 7. Notices (DevBoard): a public noticeboard

Public, signed, rate-limited by proof of work ([NIP-13](https://github.com/nostr-protocol/nips/blob/master/13.md)), expiring ([NIP-40](https://github.com/nostr-protocol/nips/blob/master/40.md)).

| | |
|---|---|
| kind | **30810** (addressable) |
| tags | `["d", <note id>]`, `["expiration", <unix seconds>]`, `["t", <tag>]…`, `["nonce", <n>, <target bits>]` |
| content | `{ "type": "hiring" \| "available", "title" ≤ 80, "text" ≤ 300, "tags" ≤ 10 × 24, "rate" ≤ 60, "contact" ≤ 200 }` |

Rules a client enforces on what it shows, whatever a relay accepts: the id has at least **16** leading zero bits and the nonce tag targets at least that; the expiration lies after `created_at` and at most 31 days after it; at most 3 live notes per key are shown in full (the rest collapsed); contact details are shown on request only. Deleting a note writes `{ "del": 1 }` with a one-day expiration to the same address.

**Votes** are [NIP-25](https://github.com/nostr-protocol/nips/blob/master/25.md) reactions, kind **7**, with tags `["e", <note id>]`, `["p", <author>]`, `["a", <address>]`, `["k", "30810"]`, content `+` or `-`, and an empty content to take a vote back; the newest reaction per voter and note counts. **Reports** are §4 reports with the `a` and `k` tags. Votes and reports need **8** bits of proof of work. A client subscribes to `{ kinds: [30810], since }` and `{ kinds: [7, 1984], "#k": ["30810"], since }`.

## 7b. Groups (chat)

A group is a key pair. Its pubkey is where its events live and its secret (`w`) signs them, so relays see one anonymous author; the content of every event is `seal(k, <inner event>)` with the group's current read key `k`, and the inner event is signed by the member who wrote it (`verifyEvent` on open), so members see who. Kinds: **30720** `GROUP_INFO` (addressable, `d` = `info`; inner content `{ "name", "host", "closed", "open" }`, believed only when the inner signature is the host's, who is named in the invite link), **7820** `GROUP_MESSAGE` (inner content the text, ≤ 4000 characters, with an `["ms", <0–999>]` tag for order within a second), **7821** `GROUP_JOIN` (`{ "name" }`), **7822** `GROUP_LEAVE`, **7823** `GROUP_KICK` (`{ "pk" }`, host-signed). Membership is what was announced: joins minus leaves and kicks.

Neither key is in the invite link: `#/group/<pub>/<host>/<invite token>/<name>`. Opening it **knocks**: a rumor of kind **7824** `GROUP_KNOCK` (`{ "pub", "invite", "name" }`) gift-wrapped to the host (§5). The host admits (or, when the group is `open` and the token is current, their device admits by itself) by sending a rumor of kind **7825** `GROUP_KEYS` (`{ "pub", "w", "k", "host", "name" }`) wrapped to the person; a member who invites friends sends them the same. A device accepts keys from the host, or from a friend. Keys answering the device's own knock put it in the group at once; keys arriving unasked (a friend or the host inviting) wait as an **invitation** the person says yes or no to. Keys for a group it already holds count as a **re-key** when they come from the host. A **live room** is offered the same way: kind **7826** `ROOM_INVITE` (`{ "secret", "name" }`) wrapped to a friend, who opens the room from the invitation; the secret never has to travel as a link. When someone leaves or is removed, the host makes a new `k`, sends it to everyone still in, and republishes the info under it; members keep every `k` they were given and open with the newest first. Closing is the info with `closed: true`: every member's device drops the group. The groups a person is in and the knocks they wait on are in their account's settings (kind 30791, `d` = `chat`).

## 8. Live rooms (Payload, pong, chat)

**Chat rooms** are on nostr already: a room is named by its link's `#secret`; its public id is `sha256("wjs|room|chat|" + secret)` as hex, and its key is `HKDF(secret, "wjs/room/chat")` (`shared/events.js` `deriveKey`). A message is an **ephemeral** event of kind **21710** with `["h", <room id>]` and content `seal(key, { "nick": <≤ 24 chars>, "text": <≤ 2000 chars> })`; presence is kind **21700** with the same tag and `seal(key, { "nick" })`, sent on entering, every 30 s, when someone new appears and on returning to the foreground (someone silent for 75 s has left); `{ "nick", "hello": true }` is the first ping of a visit (and the one on returning), which the others answer with a ping of their own so the newcomer's list fills now; `{ "nick", "bye": true }` says the person left, so the others drop them at once. A tab keeps its visit key and name in session storage, so a reload brings the same person back, not a newcomer beside a ghost. Each visit signs with a key made for it, so relays learn no identity; relays pass ephemeral events to the room's subscribers and store nothing, so a room has no history. Anyone with the link is in the room; there is no account.


Payload and pong still signal through gun and WebRTC (a room is named by `sha256("wjs|room|" + secret)`, frames are AES-GCM sealed with a key derived from the secret). The nostr kinds **21700** (presence), **21701** (signal) and **21702** (data), ephemeral, are reserved for their move to nostr: presence and signaling encrypted to the room secret, data frames when WebRTC fails. Their content formats are defined when that lands.

## 9. Files

**Backup** (what the hub's settings page exports and restores): a JSON file

```
{ "kind": "wjs-backup", "v": 1,
  "kdf":    { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": <base64url> },
  "cipher": { "name": "AES-GCM", "iv": <base64url> },
  "data":   <base64url ciphertext> }
```

The key is PBKDF2-SHA-256 of the NFKC passphrase; the plaintext is the JSON payload `{ "app": "kiwi", "v": 3, "created": <ISO 8601>, "identity": { "sk", "pk", "alias", "created" }, "events": [<every event this device holds>] }`. Restoring adopts the identity and republishes every event, so a backup repairs relays as well as devices. Older files with `"kind": "loadout-backup"` are accepted.

**Key export**: an `ncryptsec` (NIP-49) in a text file.

**Media** (photos and attachments) live on [Blossom](https://github.com/hzrd149/blossom) servers: `PUT <server>/upload` (BUD-02), `GET <server>/<sha256>` (BUD-01), `HEAD <server>/upload` before files over 256 KB (BUD-06), `DELETE <server>/<sha256>`. Every request that changes something carries `Authorization: Nostr <base64(event)>`, a kind **24242** event with `["t", "upload" | "delete"]`, `["expiration", <now + 300>]` and `["x", <sha256>]`. A client tries the person's servers in order and takes the first that stores the file.

What an app keeps, inside its own event's content, is the **media object**:

```
{ "url": <where it was stored>, "sha256": <hex, of the stored bytes>, "size": <bytes>,
  "mime": <type of the clear file>, "width"?, "height"?,
  "key"?: <hex, 32 bytes>,
  "thumb"?: { "url", "sha256", "width", "height" } }
```

With `key`, the stored bytes are `iv (12 bytes) || AES-256-GCM ciphertext and tag`, uploaded as `application/octet-stream`; the key is random per file and the thumbnail uses the same key with its own IV. A media object with a key only ever travels inside encrypted content. Without `key` the file is stored as it is, and a client uploads that way only when the app marks the file public or the person agreed to it after no server took the encrypted file. A reader fetches `url`, then `<server>/<sha256>` from its own servers, and must reject bytes whose SHA-256 differs. Photos are re-encoded before upload (long side at most 2048 px, a 480 px thumbnail; JPEG, or WebP for PNG and WebP input), which drops the metadata cameras write.

**Files in messages** (`shared/files.js`): a file sent in the chat is encrypted on the device with AES-256-GCM, a random 32-byte key and 12-byte nonce of its own, and the ciphertext with its tag, nothing in front, is uploaded to the sender's media servers as `application/octet-stream`. The message describes it as NIP-17's kind 15 does: the URL as content, `["file-type", <mime>]`, `["encryption-algorithm", "aes-gcm"]`, `["decryption-key", <hex>]`, `["decryption-nonce", <hex>]`, `["x", <sha256 of the stored bytes>]`, `["ox", <sha256 of the file>]`, `["size", <bytes>]`, `["dim", "<w>x<h>"]` for a photo, and `["file-name", <name>]` (ours; not `name`, which carries the writer's name in our messages). A reader fetches it from the URL or the sender's servers, checks `x`, decrypts, checks `ox`. No thumbnail: NIP-17 encrypts one with the same key and nonce as the file, which AES-GCM must never do. In a group (§7b) the inner event of a message carries the same tags and the URL as its content. At most 100 MB.

**Hub manifest and catalog**: `kiwi.manifest` (ini: `NAME`, `DESCRIPTION`, `VERSION`, `CATEGORY` = Framework | Hub | App, `COMPONENTS=web`, `FRAMEWORK`, `KINDS`, `TAGS`, `HOMEPAGE`, `LICENSE`) in every repository and app folder; `apps.list` in a catalog, one repository per line with `path=`, `ref=`, `branch=` options. Not events, but part of what a hub reads.

## 10. Relays

A user's relay list is local today (`wjs.relays`), defaulting to the distribution's. Planned: [NIP-65](https://github.com/nostr-protocol/nips/blob/master/65.md) relay lists (kind 10002) and the NIP-17 inbox list (kind 10050), so two people on different relay sets still reach each other; links then carry relay hints. Devices heal relays: on every (re)connect, a device compares each watched author's events with the relay's and republishes what is missing, at most every ten minutes per relay and author, 150 ms apart.

## 11. Reserved and planned

| kind | for |
|---|---|
| 30023 | long-form articles (NIP-23): the blog app |
| 4550 | NIP-72 approvals by a space's moderators (not read yet; §12) |
| 10002, 10050 | relay lists (§10) |
| 10063 | the person's media servers ([BUD-03](https://github.com/hzrd149/blossom/blob/master/buds/03.md)), so others can find their files; the list is in the suite settings until then |
| 21701–21702 | live rooms for Payload and pong (§8); 21700 presence and 21710 chat-room messages are in use |
| 30720, 7820–7826 | chat groups and invitations (§7b) |
| 5 | deletion (NIP-09) of a retired account entry (§2) |
| 10002, 10050 | relay list (NIP-65) and inbox list (NIP-17) per network (§9) |
| 30830 | in use: market listings (§14) |
| 30820, 30822, 7805 | in use: feed entries and comments, audience keys (§13) |
| 34550 | in use: space definitions (§12) |

## Changes

- **v1** (October 2026): this document, written from the code of kiwi-framework 0.1.0 and Armory. No event format changed.
- **v1, clarified**: `created_at` of a new version is after every version the device has seen, not only the ones it signed (fixes edits from a device with a slow clock being dropped). No format changed.
- **v1, extended**: the media object and Blossom authorization (§9); the suite keys `appOrder` and `mediaServers`. No existing format changed.
- **v1, extended** (0.18): spaces (§12): the definition event, the `a` tag a note carries, the `s=` and `h=` of a link. A note in no space is what it was; a board on a space shows only notes that name it.
- **v1, extended** (0.19): audiences and the feed (§13): the audience keys and their rumor (kind 7805), the space key, feed entries (30820) and comments (30822). No existing format changed.
- **v1, extended** (0.20): the market (§14): listings (30830), search labels (NIP-32 `l` tags keyed with the space key); a feed entry's `label`; a chat link's `?text=` draft. No existing format changed.


## 9. Relay lists, inboxes and hints

Every person publishes, on each network a hub has (its own relays, and the public area's when it has one), a **relay list**, kind **10002**, with `["r", <relay>]` for each of that network's relays, and an **inbox list**, kind **10050**, with `["relay", <relay>]` for the same. Both go to that network's relays and, outside a locked hub's own network, to the hub's directory relays. They are published when a network's relays connect, at most once a day, at once when the relays change.

Every sealed note (kind 14 messages and every other rumor a gift wrap carries: friend requests, shares, knocks, keys, room invitations) has a tag `["relays", <relay>, …]` inside the seal: the writer's relays on the network the note travels on, so the reader can answer without a lookup. A writer sends a gift wrap to the network's relays (the outbox) and to the reader's inbox relays that are not among them: those the reader named in their last sealed note, else their kind 10050 (or the read relays of their kind 10002) from the network's relays and the directory relays.

A link carries hints to where its events live: `r=<relay without its scheme>`, up to three, in the fragment's query (`#/b/<pub>?w=…&r=relay.example`, `#/group/…/<name>?r=…`, `#/room/<secret>?r=…`); `wss://` is implied, `ws://` for `localhost`. Group keys (kind 7825) and room invitations (7826) carry the same as `"relays": [<relay>, …]` in their content. A hub that opens such a link reads, and writes, those relays besides its own; a hub whose own relays are locked neither puts hints in its links nor follows them.

## 12. Spaces

A **space** is a named, owned community that a hub's boards, feeds and markets serve ([NIP-72](https://github.com/nostr-protocol/nips/blob/master/72.md) community): its definition is an addressable event, its address is what every post in it names, and two hubs that name the same address serve the same space.

| | |
|---|---|
| kind | **34550** (addressable) |
| author | the space's owner |
| tags | `["d", <id>]` (the id: `^[a-z0-9][a-z0-9-]{1,39}$`), `["name", <≤ 80>]`, `["description", <≤ 600>]`, `["relay", <url>]`… (the space's own relays), `["p", <pubkey>, "", "moderator"]`…; ours, which other clients ignore: `["adult", "1"]`, `["lang", <code>]`…, `["region", <≤ 40>]`, `["rules", <≤ 2000>]` |
| content | empty |

The space's address is `34550:<owner>:<id>`. **A space nobody owns** is one a hub ships in its configuration without an owner: its key is `sk = sha256("wjs/space/v1|" + <hub id> + "|" + <space id>)`, so every build of that hub, and any hub that copies the address, finds the same space; the hub's configuration is its definition, and the hub's devices publish that definition under the derived key when the relays lack it or hold another, so other clients see the space too (the key is public knowledge, so a definition under it is a courtesy, not a claim). **An owned space** is defined by its owner alone: the hub shows the configuration until the relays answer, then the newest definition's name, texts, moderators and flags. In both forms the relays a hub uses for a space are its configuration's (`relays` in `distribution.js`, or `spaces.<id>.relays` in `hub.local.json`), not the event's.

**Posts in a space** carry `["a", <space address>, <relay>]`, the relay being one where the post lives (NIP-72); a client reads a space with `{ "#a": [<address>] }` and shows nothing in it that does not name it, and nothing on a board in no space that names one. Today the notes of §7 carry it (their deletions too); feed and market posts will. Votes and reports keep their `a` tag to the post. A **report by one of the space's moderators** (its owner or a `p … moderator`) collapses a note by itself; approvals (kind 4550) are not read yet.

**A space's relays** are a network of their own on a hub (shared/relays.js, `space:<id>`): a mount on the space reads and writes them and nothing else, its people's lists, settings and sealed notes stay on the hub's or the public network, and no relay list (§9) is published on them. A space without relays lives on its mount's network.

**A link into a space** carries `s=<space address>` and `h=<the page it was made on, without its hash>` in the fragment's query besides the `r=` hints (§9): `<app url>#/n/<author>/<d>?s=34550%3A…%3Ajobs&h=https%3A%2F%2Fhub.example%2Fjobs%2F&r=relay.example`. A hub that opens it on a mount of the same app that serves another space goes to its mount for that space; a hub with none says whose space it is and offers `h=` as the way back. The link names the app, the space and the item; the host in `h=` is a courtesy, not the address.

## 13. Audiences and the feed

**Audiences.** A person's audiences are `me`, `friends` and each circle (`c:<circle id>`, §5). Each has an epoch, starting at 1 when it is first used; its key is

```
k   = HKDF-SHA-256(sk, info = "wjs/audience/v1/<audience>/<epoch>"), 32 bytes, no salt
kid = hex(sha256(k))[0..16)
```

so every device holding the key `sk` derives every audience key it ever used. The epochs, and whom each audience's current key went to, are in the person's account settings (§3, `d` = `audiences`: `ep:<audience>` the epoch, `to:<audience>` `{ "e": <epoch>, "pks": [<pubkey>…] }`). The current key goes to each member once, as a rumor of kind **7805** `AUDIENCE_KEY` in a gift wrap to them alone (§5): `{ "kid": <kid>, "k": <hex of k> }`. A reader checks that `kid` is the key's hash and keeps the key under `got:<author>` in their own `audiences` settings (`{ <kid>: <hex> }`, the last twelve per author). When someone who was given the current key is no longer a member (unfriended, blocked, taken out of the circle), the next use starts a new epoch and its key goes to those still in. Members added later are given the current key. `me` is never given to anyone.

**The space key** (§12): `k = HKDF-SHA-256(sha256(<space address>), info = "wjs/space/read/v1")`, `kid` as above. It is public knowledge to anyone who has the address: a way to keep a community's posts off plain view, not a secret.

**Entries.**

| | |
|---|---|
| kind | **30820** (addressable) |
| tags | `["d", <random id>]`, `["a", <space address>, <relay>]` (on a mount on a space, §12), `["key", <kid>]` |
| content | `seal(k, { "v": 1, "text": <≤ 5000, markdown>, "media": [<media object, §9>…] (≤ 6, each with its own key), "tags": [<hashtag>…] (≤ 10, lowercase), "name": <the writer's alias, ≤ 40>, "at": <ms of the first version>, "label"?: "adult" \| "ad" })` |

`k` is the key `kid` names: the space key for an entry to the space, else one of the author's audience keys. A reader without the key does not show the entry. An entry with a `label` (for adults, or an ad) is shown to people with an account on the reading hub only; everyone else sees that it is there. Editing republishes under the same `d` (keeping `at`), possibly under another key; deleting publishes `seal(k, { "del": 1, "u": <ms> })` under the same key.

**Comments**: kind **30822** (addressable), `["d", <random id>]`, `["a", <entry address>]`, the entry's space `a` tag, `["key", <the entry's kid>]`, content `seal(k, { "text": <≤ 1000>, "name", "at" })` with the entry's key; deleted like entries. **Likes**: NIP-25 kind 7, `+` (an empty content takes it back; the newest per person counts), with `["a", <entry address>]`, `["p", <author>]`, `["k", "30820"]`. **Reports**: §4, with `["a", <entry address>]`, `["e", <entry id>, <type>]`, `["k", "30820"]`. A report by one of the space's moderators folds an entry away on its own; otherwise three reports by people the reader has not blocked do. Likes, reports and who commented on what are visible to relays; what an entry or a comment says is not.

**Marks.** An entry whose writer did not label it can still be marked for adults or as an ad, which has the same effect as the writer's `label` (`shared/social.js`):

- A person asks for a mark with a §4 report of type `other` carrying [NIP-32](https://github.com/nostr-protocol/nips/blob/master/32.md) tags `["L", "wjs/mark"]`, `["l", "adult" | "ad", "wjs/mark"]`. Such a report does not count towards folding. Two of them for the same mark, by people the reader has not blocked, mark the entry (18+ before ad).
- A moderator of the space marks with a NIP-32 label event, kind **1985**: `["L", "wjs/mark"]`, `["l", "adult" | "ad" | "none", "wjs/mark"]`, `["a", <entry address>]`, `["p", <author>]`, `["k", "30820"]`, the space's `a` tag; empty content. `none` means "fine as it is". A moderator's report asking for a mark counts as such a label. Only labels by the space's moderators (§12) count; the newest decides, by `created_at`, then the lower id.
- A moderator's label is a review: it is stamped after every report and label the moderator's device has seen on the entry, and from then on it decides the mark (`none` clears any), and only reports made after it count towards folding. So `none` also lifts a fold that reports caused; a moderator's own report still folds.
- The writer's own `label` stands whatever the marks say. A hub shows its moderators the entries with reports made since the last review.

## 14. The market

**Listings.**

| | |
|---|---|
| kind | **30830** (addressable) |
| tags | `["d", <random id>]`, `["a", <space address>, <relay>]`, `["key", <kid>]` (§13: the space key, or one of the seller's audience keys for a listing to friends or a circle), `["expiration", <unix seconds>]` (NIP-40, 1 to 90 days after the version), and on a listing to the space `["L", "wjs/label"]` and its search labels |
| content | `seal(k, { "v": 1, "title": <≤ 100>, "text": <≤ 3000, markdown>, "category": "seeds" \| "cuttings" \| "gear" \| "other", "price": <≤ 40, free text>, "from": <ISO 3166-1 alpha-2>, "ships": [<country> \| "EU" \| "WW"…] (≤ 30; empty: pickup only), "pickup": <bool>, "media": [<media object>…] (≤ 8), "contact": <≤ 200>, "status": "open" \| "reserved" \| "sold", "name": <≤ 40>, "at": <ms of the first version> })` |

A listing needs a title, a category and a country; a reader drops one that has expired (its seller still sees it, to renew). Marking it reserved or sold, changing or renewing it republishes it under the same `d`; deleting publishes `seal(k, { "del": 1, "u" })` with a one-day expiration. Reports: §4 with `["a", <listing address>]`, `["e", …]`, `["k", "30830"]`; one by a moderator of the space folds a listing away by itself.

**Who sells** (`shared/sellers.js`). A market mount may have a rule, `sellers: { space, posts, likes }` in the distribution (and in `hub.json`'s mounts): someone sells there when they have `posts` entries in the feed space `space` (§13: sealed to the space, not to an audience; the newest version not a deletion), each with a `+` as the newest reaction of at least `likes` people other than the writer whom the reader has not blocked; or when a moderator of the market's space approved them. An approval is a NIP-32 label, kind **1985**: `["L", "wjs/seller"]`, `["l", "approved" | "revoked", "wjs/seller"]`, `["p", <seller>]`, the market space's `a` tag; empty content. The newest by any of the space's moderators counts; `revoked` stands over the posts. A reader does not show a listing whose seller does not sell there (its seller and the space's moderators see it, marked); the form for a new listing tells someone who does not sell yet what it takes. Without a rule anyone sells. `posts: 0`: approval only.

**Search labels** let a relay filter what it cannot read. For each word of a listing (`cat:<category>`, `from:<country>`, `to:<destination>` for each place it ships to, `cat:<category>|to:<destination>`, and with pickup `pickup:<country>` and `cat:<category>|pickup:<country>`) the listing carries `["l", <label>, "wjs/label"]` with

```
label = hex(HKDF-SHA-256(<space key>, info = "wjs/label/v1|" + <word>))[0..16)
```

A buyer asks `{ "kinds": [30830], "#a": [<space>], "#l": [<labels>] }` for the words of their search, any of which matches: a buyer in Austria looking for seeds asks for `cat:seeds|to:AT`, `cat:seeds|to:EU` and `cat:seeds|to:WW`. Anyone who knows the space's address computes the same labels: they keep a listing's category and countries off plain view, as the space key keeps its content, and do not make them secret. A listing to friends or a circle carries no labels.

**Contact.** A buyer writes to a seller in the chat; a chat link may carry a draft, `#/dm/<pubkey>?text=<the message>`, which the chat puts in its composer unsent. The listing's `contact` is shown on request.

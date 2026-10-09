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
| author | `lookupPk` |
| tags | `["d","account"]`, `["v","1"]` |
| content | `seal(wrapKey, { "v": 1, "sk": <user secret key hex>, "alias": <name> })` |

Login is one request: `{ kinds: [30790], authors: [lookupPk], "#d": ["account"] }`, newest first, the first event that opens with `wrapKey` wins. Nobody who lacks both username and password can compute `lookupPk`, so the event cannot be found, spammed or overwritten; names need not be unique, since a different password is a different lookup key. Creating an account first fetches that address and refuses if an event opens to a different key.

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
| `suite` | `theme` (`"light"` \| `"dark"` \| unset), `lang` (a language code the hub ships), `hiddenApps` (mount ids) |
| `people` | see §5 |
| `loadout` | the boards app's own preferences |
| `devboard` | `saved` (addresses), `type` (`"hiring"` \| `"available"`), `contact` |

A client merges by the addressable rule and caches the last object locally so screens draw before relays answer. Unknown keys are preserved on write.

## 4. Blocking and reporting

**Block list**: a [NIP-51](https://github.com/nostr-protocol/nips/blob/master/51.md) mute list, kind **10000** (replaceable), with no public tags. The private part is the content: NIP-44 v2 encryption, with the conversation key of the user's own key pair (`getConversationKey(sk, pk)`), of the JSON array of tags `["p", <pubkey>]` or `["p", <pubkey>, <reason>]`. Other NIP-51 clients read the same list; relays and other people learn nothing. Apps check it before showing a post, accepting a message, a friend request or a share.

**Report**: [NIP-56](https://github.com/nostr-protocol/nips/blob/master/56.md), kind **1984**. Tags `["p", <pubkey>, <type>]` and, when about one event, `["e", <id>, <type>]`; apps that report addressable events add `["a", <address>]` and `["k", <kind>]`. Types: `spam`, `illegal`, `impersonation`, `nudity`, `malware`, `profanity`, `other`. Content is an optional note, at most 500 characters. Reports are public and signed; relay operators act on them, and clients may hide what many trusted people reported.

## 5. People: friends, circles, sharing

Everything private between two people travels as a [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) gift wrap: a **rumor** (unsigned event) inside a **seal** (kind 13, signed by the sender) inside a **gift wrap** (kind **1059**, signed by a throwaway key, `["p", <recipient>]`, `created_at` randomised up to two days back). Relays see only that some key received a wrapped note. An inbox asks for `{ kinds: [1059], "#p": [me], since: now − 30 days }`.

Rumors carry `["p", <recipient>]` and JSON content:

| rumor kind | content | meaning |
|---|---|---|
| **7801** friend request | `{ "name": <sender's alias> }` | asks to be friends |
| **7802** friend accept | `{ "name": <alias> }` | friends now, both ways |
| **7803** friend remove | `{}` | not friends any more |
| **7804** share | `{ "app": <app id, ≤ 32 chars>, "payload": <object> }` | something for one of the recipient's apps; `payload.url` is what a notice opens |

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

## 8. Live rooms (Payload, pong)

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

**Hub manifest and catalog**: `kiwi.manifest` (ini: `NAME`, `DESCRIPTION`, `VERSION`, `CATEGORY` = Framework | Hub | App, `COMPONENTS=web`, `FRAMEWORK`, `KINDS`, `TAGS`, `HOMEPAGE`, `LICENSE`) in every repository and app folder; `apps.list` in a catalog, one repository per line with `path=`, `ref=`, `branch=` options. Not events, but part of what a hub reads.

## 10. Relays

A user's relay list is local today (`wjs.relays`), defaulting to the distribution's. Planned: [NIP-65](https://github.com/nostr-protocol/nips/blob/master/65.md) relay lists (kind 10002) and the NIP-17 inbox list (kind 10050), so two people on different relay sets still reach each other; links then carry relay hints. Devices heal relays: on every (re)connect, a device compares each watched author's events with the relay's and republishes what is missing, at most every ten minutes per relay and author, 150 ms apart.

## 11. Reserved and planned

| kind | for |
|---|---|
| 30023 | long-form articles (NIP-23): the blog app |
| 34550 and related | community definitions (NIP-72): spaces; posts and listings then carry `["a", <space address>]` |
| 10002, 10050 | relay lists (§10) |
| 21700–21702 | live rooms (§8) |
| market and feed kinds | to be assigned in the 307xx/308xx ranges when those apps land |

## Changes

- **v1** (October 2026): this document, written from the code of kiwi-framework 0.1.0 and Armory. No event format changed.
- **v1, clarified**: `created_at` of a new version is after every version the device has seen, not only the ones it signed (fixes edits from a device with a slow clock being dropped). No format changed.

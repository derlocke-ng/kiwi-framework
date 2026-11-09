# payload

The suite's file share. One of the framework's own apps; [Armory](https://github.com/derlocke-ng/armory) mounts it as **Payload** (`framework: 'payload'`), live at <https://derlocke-ng.github.io/armory/payload/>.

Drop files, then choose how they go:

1. **A link.** Each file is encrypted on the device with a key of its own and uploaded to the person's media servers (Blossom, the same servers photos and chat files use); a list of them, encrypted with a key of its own, goes beside them. The link carries that list's hash, key, nonce and server after the `#`, which browsers never send to a server. Whoever has the link downloads, checks and decrypts the files, also when the sender is offline. Links are kept in the account (the app's settings, sealed to the key) and listed under **Links**, where deleting one removes its files from the server (`data/shares.js`).
2. **To people.** The same upload, then a sealed file message (NIP-17, kind 15) to each friend and group chosen: it arrives in their conversation in the chat, as the chat's own files do (`shared/files.js`, `shared/chat.js`, `shared/groups.js`).
3. **Directly.** From this open page to the other open page, nothing stored anywhere, any size: the old Payload, now finding the other side through the hub's nostr relays (`sender.js`, `receiver.js` on `shared/p2p.js`).

**Received** lists the files people sent in the chat, conversations and groups, newest first, to download again, with the way to the conversation they came in.

## The direct transfer

- **Finding each other.** The link's `#secret` names a room; presence and the connection's offer and answer are ephemeral nostr events (kinds 21700, 21701) sealed to the room's key (AES-256-GCM) and signed by a key made for the visit, on the page's relays, which keep none of it.
- **Connecting.** The receiver sets up a WebRTC data channel to the sender; WebRTC encrypts the channel itself (DTLS). When there is no direct path (both on mobile data, strict firewalls), the transfer goes through the relays instead, as sealed ephemeral frames (kind 21702) of at most 24 KB: slower, but without a TURN server. *Always through the relays* in the settings does that by choice, so the other side never learns this device's address.
- **Integrity.** Before sharing, the sender hashes every 64 KB piece with SHA-256 and publishes a root over all of them. The receiver checks each piece, asks again for any that do not match, and checks the root before saving. Both sides show the same short *fingerprint*.
- **Resuming.** When the connection drops, the receiver reconnects and asks only for what it still misses.

## Limits

- Links and files to people: at most 100 MB a file (what media servers take), 20 files a link. Bigger goes directly.
- A direct transfer needs both pages open, and anyone with its link can download while the sender shares. Received files are put together in memory, so very large ones depend on the receiving device's RAM. The two browsers learn each other's IP addresses on a direct path, and the STUN servers (Google, Cloudflare) see them too.

## Files

| File | What |
|---|---|
| `App.tsx`, `state.ts` | the routes (send, received, links, a link's files, a direct transfer's receiving side, settings) and what the screens share |
| `pages/Send.tsx`, `pages/SendTo.tsx` | the drop, the three ways, a link made, sending to friends and groups |
| `pages/Received.tsx`, `pages/Links.tsx`, `pages/OpenLink.tsx` | files from the chat, the links made here, a link opened |
| `pages/Direct.tsx`, `sender.js`, `receiver.js`, `transfer.js` | the direct transfer: the screens, sharing and receiving without the page, chunking and integrity |
| `data/shares.js` | links: upload, the link's fragment, opening, deleting |
| `locales/` | the strings, in eight languages |

Tests: `test/unit/payload.test.js` (pieces and frames), `test/unit/payload-shares.test.js` (a link against a local Blossom server), `test/e2e/payload.mjs` (the three ways in two browsers: directly and through the relays with a corrupted piece, a link opened elsewhere and deleted, files to a friend showing up under Received). Armory runs the same suite against its site.

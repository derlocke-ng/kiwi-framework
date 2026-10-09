# payload

Send files straight from one browser to another while you're both online. One of the framework's own apps, React like the rest; [Armory](https://github.com/derlocke-ng/armory) mounts it as **Payload** (`framework: 'payload'`), live at <https://derlocke-ng.github.io/armory/payload/>. Its texts are English for now.

1. Drop files on the page. Payload hashes them and gives you a link (and a QR code).
2. The other person opens the link and presses *Download*.
3. Keep your tab open until they're done — nothing is uploaded anywhere; the files go from your browser to theirs. Several people can download at once.

## How it works

- **Finding each other.** The link's `#secret` names a room on the gun network and is the key everything in it is encrypted with (AES-256-GCM). Relays only see encrypted presence and signaling messages.
- **Connecting.** The receiver sets up a WebRTC data channel to the sender. The offer and answer travel encrypted through gun, so a relay can't swap in its own keys. WebRTC encrypts the channel itself (DTLS).
- **When there is no direct path** (both on mobile data, strict firewalls), the transfer continues through gun relays instead, as encrypted 64 KB frames that the receiver deletes from the relay once they've arrived. It is slower, but it works without a TURN server.
- **Integrity.** Before sharing, the sender hashes every 64 KB piece with SHA-256 and publishes a root hash over all of them. The receiver checks each piece as it arrives and asks again for any that don't match, then checks the root before saving. Both sides show the same short *fingerprint* you can compare out loud.
- **Resuming.** If the connection drops, the receiver reconnects and only asks for the pieces it is still missing.

## Limits

- Both sides must be online at the same time; it is a transfer, not storage.
- Anyone with the link can download while you share. Press *Stop sharing* when you're done.
- Received files are assembled in memory before saving, so very large files (several GB) depend on the receiving device's RAM.
- The two browsers learn each other's IP addresses (that's how a direct connection works). The STUN servers used to find a direct path (Google and Cloudflare) see your IP too.

## Files

| File | What |
|---|---|
| `main.tsx`, `App.tsx` | the page: sending (drop, fingerprinting, the link, receivers) and receiving (the files, progress, download) |
| `sender.js`, `receiver.js` | sharing and receiving, without the page: rooms, pieces, hashes, retries, reconnecting |
| `transfer.js` | chunking and integrity, unit tested (`test/unit/payload.test.js`) |
| `payload.css` | the app's own styles |

`node test/e2e/payload.mjs` sends real files between two browsers, directly and through a local gun relay with a corrupted piece on the way; Armory runs the same suite against its site.

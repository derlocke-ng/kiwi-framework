# kiwi-modules: what a public relay accepts

For the session on `derlocke-ng/kiwi-modules`. Ask the owner before pushing, tagging or releasing anything there; kiwi-server takes it by vendoring a tag, with the owner's yes. Not needed until the owner puts a relay on the internet (kiwi-modules 0.7's `reverse-proxy.public`); the owner has said Armory does not need one for now.

## Why

A relay inside the mesh is written to by the fleet's own people. One on the internet is written to by anyone, and strfry's `writePolicy.plugin` is empty in `modules/nostr-relay/strfry.conf.j2`: it would take everything. A hub's relay for its spaces should accept what belongs there and little else.

## What to decide with the owner, then build as a setting of `nostr-relay`

- **Space posts**: events carrying one of the hub's space addresses (`#a` = `34550:<owner>:<id>`, from the hub's `hub.json`, `spaces[].address`): feed entries (30820), listings (30830), notices (30810), comments (30822), reactions (7), reports (1984), labels (1985: marks and seller approvals), deletions (5), and the space definitions themselves (34550). A space's relay carries nothing else of a person's (no mail, no settings, no relay lists: those stay on the hub's network, kiwi-framework `docs/architecture.md`, spaces).
- **A hub's own relay** (not only its spaces): also gift wraps (1059) for people's mail, settings (30791), relay lists (10002, 10050), boards (30700–30703), groups (30720, 7820–7823): or simply writes from keys with an account on the hub, which the relay cannot see; a write policy by kind is the practical one.
- Optionally writes from a list of keys, or with proof of work (NIP-13); rate limits per IP and per key.

A strfry write-policy plugin is a small script reading JSON lines on stdin; check the module's image can run one (strfry starts it as a subprocess).

## How to test

`kiwi-modules render` with the setting on; golden files; on a test master behind `reverse-proxy.public` with `acme_staging`: `nak event` of an allowed kind is accepted, a kind 1 note from a stranger is refused with a reason.

## Done when

The setting exists, is documented and tested, tagged and vendored into kiwi-server with the owner's yes; then this file is deleted here.

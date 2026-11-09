# kiwi-modules (and kiwi-server, which vendors it): a relay, or a hub, on a public host

For the session on `derlocke-ng/kiwi-modules`. Ask the owner before pushing, tagging or releasing anything there; kiwi-server takes the result by vendoring a tag (`tools/vendor.sh`), which is its own session's job, also with the owner's yes.

## Why

A kiwi hub is static pages plus relays. Armory, the first hub, is public already: GitHub Pages serves its pages, and its posts live on public relays nobody of ours runs. What a self-hosted machine adds for a public hub is **a relay of its own**: Armory's spaces (Outpost, Trading Post, DevBoard) can name it (`spaces[].relays` in Armory's `distribution.js`, or `HUB_SPACE_RELAYS` for a container), and then a moderator's decision can be carried out where the posts are, and the posts do not depend on strangers' relays keeping them. A whole hub on a public host (the `hub` module's image on the internet) is the same problem plus the pages.

Inside the VPN this works today: the `hub` preset (nostr-relay + hub behind the reverse proxy, behind the VPN client), TLS from the fleet CA. On a public host two things are missing. The owner's rule: nginx, as the reverse-proxy module has it; no Caddy.

## What to change

1. **Certificates a browser trusts.** Browsers outside the mesh do not trust the fleet CA, and the page needs HTTPS (its encryption, WebCrypto, exists in a secure context only; the framework says so on a plain-HTTP page from 0.21). `modules/reverse-proxy` takes a certificate as files (`tls_fullchain`, `tls_privkey`) or issues one from the fleet CA; add ACME:
   - a setting, e.g. `tls: fleet | files | acme` and `acme_email`;
   - HTTP-01 through the nginx that is there: the port-80 server answers `/.well-known/acme-challenge/` from a directory shared with an ACME client container (acme.sh or certbot, pinned by digest like the other images), everything else redirects to HTTPS as now;
   - issue for the `server_name`s the modules announce that are public (see 2), renew on a timer (a systemd timer in the bundle, or the client's own loop), reload nginx after a renewal;
   - the first start has no certificate yet: nginx must start on a self-signed or fleet one and switch after issuance (check how the module's render step and `kiwi-stack apply` order this).
2. **Only what is meant to be public answers on the public address.** kiwi-server's `docs/ROADMAP.md` problem 37: a node publishes 80/443 (and more) on its host, which on a VPS is the internet, so today a VPS has to be a master. Proposed there: `reverse-proxy.network_mode: vpn-client` or a stack setting `exposure: lan | mesh`, and `validate` warning when a node with a public address publishes ports. What a public relay needs on top: a per-server flag the announcing module sets (e.g. `nginx.public: true` for `nostr-relay` when a setting asks for it, and for `hub`), and the proxy listening on the public address for those server blocks only, the admin pages staying on the mesh.
3. **A public relay that is not everybody's.** strfry's `writePolicy.plugin` is empty in `modules/nostr-relay/strfry.conf.j2`. A relay on the internet for a hub's spaces should accept what belongs there and little else. To decide with the owner, then build as a setting of the module:
   - events carrying one of the hub's space addresses (`#a` = `34550:<owner>:<id>`, listed in the hub's `hub.json` under `spaces[].address`): feed entries (30820), listings (30830), notices (30810), comments (30822), reactions (7), reports (1984), labels (1985), deletions (5), and the space definitions themselves (34550). A space's relay carries nothing else of a person's (no mail, no settings, no relay lists: those stay on the hub's network, `docs/architecture.md`, spaces);
   - or writes from a list of keys, or with proof of work (NIP-13);
   - rate limits per IP and per key.
   A strfry write-policy plugin is a small script reading JSON lines on stdin; check what image the module uses and whether it can run one (strfry runs the plugin as a subprocess).
4. **Nothing in the `hub` module itself**: it passes `HUB_SPACE_RELAYS` already (0.4.1).

## Not known yet, to check

- Which host and which names the owner wants (`relay.<domain>` on a VPS of the fleet; the test master "sorbet" for trying it).
- Whether a public relay sits on the master (safe today, problem 37) or on a node with problem 37 fixed.
- The ACME client's image and how its renewal fits `kiwi-stack apply` (units it installs, `status`, `health`).

## How to test

- `kiwi-modules render` of a public-relay example (an `examples/public-relay.yaml`), golden files in `tests/`, `validate` warning for a node with a public address and published admin pages.
- On the test host: ACME staging first, then production; `curl -sI https://relay.<domain>` shows a trusted certificate; `curl -H 'Accept: application/nostr+json' https://relay.<domain>` answers NIP-11; a websocket client (`nak req -k 1 wss://relay.<domain>`) connects from outside the mesh; the admin pages do not answer on the public address.
- With the framework: a test build of Armory whose `outpost` space names `wss://relay.<domain>` (a local `hub.local.json`, `spaces.outpost.relays`), opened on a phone outside the VPN: posts land on that relay and only there.

## Done when

A node (or the master) on a VPS serves `wss://relay.<domain>` with a certificate browsers trust, renewed by itself, accepting what the owner decided, with nothing else of the node reachable from the internet; documented in the module's README; tagged and vendored into kiwi-server with the owner's yes. Then Armory can name the relay for its spaces (a one-line change in Armory's `distribution.js`), and this file is deleted here.

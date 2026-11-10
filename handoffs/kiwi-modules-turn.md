# kiwi-modules: a TURN server for a hub's calls, and the `hub` module passing it (`HUB_ICE`)

For the session on `derlocke-ng/kiwi-modules`. Ask the owner before pushing, tagging or releasing anything there; kiwi-server takes it by vendoring a tag, with the owner's yes. Nothing here is urgent: calls work without it wherever two browsers find a direct path.

**Status (November 2026):** done on the branch `turn-server`, [PR #29](https://github.com/derlocke-ng/kiwi-modules/pull/29) (0.24.0), at the owner's ask, waiting for the owner to merge. The module runs coturn in the host's network with one generated login, and the hub module passes `HUB_ICE` by itself. Left to do once it is merged: the tag, vendoring into kiwi-server (with the owner's yes), and a call between two phones on mobile data through a master that runs it. Then this file goes.

## Why

From kiwi-framework 0.31 the chat (Armory's Uplink) has voice and video calls. The browsers find each other through sealed events on the hub's relays and then send voice and pictures straight to each other (WebRTC). Between some networks (two phones on mobile data, a strict company firewall) no direct path exists; then only a **TURN** server carries the call: it relays the encrypted media (DTLS-SRTP) and cannot hear them. Without one, the call screen says that there is no direct connection and that this hub names no TURN server. A self-hosted hub should not depend on someone else's TURN, so the stack wants one of its own.

The framework's side is done: a hub's container reads `HUB_ICE` (STUN and TURN addresses, space-separated, e.g. `stun:turn.sh3.home:3478 turn:turn.sh3.home:3478 turns:turn.sh3.home:5349`), `HUB_ICE_USERNAME` and `HUB_ICE_CREDENTIAL`, and writes them to `hub.local.json` as `"ice": [{ "urls": [...], "username", "credential" }]` (`container/entrypoint.sh`); `shared/hubconfig.js` applies them and the calls then use only those (no public STUN). The login is in the page for anyone who opens the hub, so it must be a login for this purpose alone.

## What to change (a proposal; check against the module conventions)

- A module `turn` running **coturn** (`coturn/coturn`, pinned by version): `listening-port=3478`, `tls-listening-port=5349` with the master's certificate when `reverse-proxy.public` has one, `realm=<hub host>`, `lt-cred-mech` with one user, a relay port range (e.g. 49160–49200/udp) opened on the host, `no-cli`, `no-multicast-peers`, and **denied peer ranges** for private and loopback addresses (`denied-peer-ip=10.0.0.0-10.255.255.255` and the others) unless the hub is meant for the mesh only, so the server cannot be used to reach the master's own network.
- Settings: `enabled` (default false), `public` (reachable from the internet, like `reverse-proxy.public`; else the mesh only), `username` (default `kiwi`), `credential` (generated once and kept, like other modules' secrets), `ports`.
- `modules/hub/module.yaml` and its `docker-compose.yml.j2`: when `turn` is enabled on the same master, pass `HUB_ICE=stun:<host>:3478 turn:<host>:3478?transport=udp turn:<host>:3478?transport=tcp` (and `turns:<host>:5349` with TLS), `HUB_ICE_USERNAME` and `HUB_ICE_CREDENTIAL`; a hub setting `ice` (a list of addresses) for a TURN server elsewhere.
- A test in `tests/test_render.py` for both.

Not known yet, to check: whether the masters' firewalls (the mesh, `reverse-proxy.public`) need a rule for the UDP range; coturn's memory on a small master; whether time-limited credentials (coturn's `use-auth-secret` with a REST-style login made by the hub) are wanted instead of one fixed login. They would need a small service in the hub container that signs a login per page; the framework would read it from `hub.local.json` as it does now, so a later change.

## How to test

`kiwi-modules render` with `turn: { enabled: true }` and a `hub`: the hub's environment has `HUB_ICE`, `HUB_ICE_USERNAME`, `HUB_ICE_CREDENTIAL`; `curl https://hub.<host>/hub.local.json` shows `"ice"`. Then two phones on mobile data (not the same Wi-Fi) call each other in Uplink on that hub: the call connects; `chrome://webrtc-internals` shows a `relay` candidate pair. Without the module, the same call shows "No direct connection".

## Done when

The module and the hub setting are there, rendered, tested, documented, tagged and vendored into kiwi-server with the owner's yes, and a call between two phones on mobile data connects on a hub that uses it; then this file is deleted here.

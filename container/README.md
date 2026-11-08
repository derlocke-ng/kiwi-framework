# A hub as a container

What a kiwi-node (or any machine with podman or docker) runs to host a hub: the distribution's site, built in the image, served by nginx, configured for its network by environment variables at start.

| file | what |
|---|---|
| `Dockerfile` | copy it to a distribution's repository root (Armory has it): a multi-stage build, `npm run build` in `node:22-alpine`, the site served by `nginx:1-alpine` |
| `nginx.conf` | the server block: hashed assets immutable, pages, worker and JSON revalidated on every load |
| `entrypoint.sh` | runs before nginx serves; writes `hub.local.json` from `HUB_*` |

## Configuration at start

The site is built once, with the relays and policy its `distribution.js` names. The page reads `hub.local.json` beside it before it connects (`shared/hubconfig.js`), and the entrypoint writes that file from the environment, so one image serves many networks:

| variable | meaning |
|---|---|
| `HUB_RELAYS` | the hub's own relays, comma- or space-separated: `wss://relay.sh3.home` inside a VPN |
| `HUB_PUBLIC_RELAYS` | the public area's relays; set and empty: no public area |
| `HUB_DIRECTORY_RELAYS` | where relay lists are published and asked for, so people on hubs that share no relay find each other; never used on a locked hub's own network |
| `HUB_RELAYS_LOCKED` | `true`: a person cannot replace the hub's relays (a private hub) |
| `HUB_REQUIRE_HUB` | `true`: the hub's pages wait while none of its relays is reachable (inside a VPN) |
| `HUB_PUBLIC_MOUNTS` | the mounts on the public network, by id: `uplink` |
| `HUB_USER_MOUNTS` | `true`: a person may follow a space the hub does not ship |
| `HUB_SPACE_RELAYS` | a space's own relays, per space id, spaces separated by `;`: `jobs=wss://relay.sh3.home;gems=wss://a,wss://b`; an id with an empty list puts that space on its mount's network |

Nothing set: no `hub.local.json`, the site runs as built. `hub.json` next to it is the hub as built (name, versions, relays, policy, spaces with their addresses, mounts), for catalogs and tools; it never changes at start.

```sh
docker build -t ghcr.io/you/your-hub .
docker run --rm -p 8080:80 \
  -e HUB_RELAYS=wss://relay.sh3.home -e HUB_RELAYS_LOCKED=true -e HUB_REQUIRE_HUB=true \
  -e HUB_PUBLIC_RELAYS=wss://nos.lol -e HUB_PUBLIC_MOUNTS=uplink \
  ghcr.io/you/your-hub
```

## On a kiwi-node

[kiwi-modules](https://github.com/derlocke-ng/kiwi-modules) has the two modules a hub needs: `nostr-relay` (strfry behind the node's reverse proxy, at `relay.<host>`, TLS from the fleet CA, reachable through the mesh) and `hub` (this image behind the proxy at `hub.<host>`, its `HUB_*` set from the module's settings, the node's own relay as the default). The `hub` preset of the node profile is the two of them behind the VPN client. A private hub is the preset as it comes; a semi-public one adds `public_relays` and `public_mounts`; a public one is `relays` naming public relays and `relays_locked: false`.

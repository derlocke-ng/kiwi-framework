# A hub as a container

What a kiwi master (or any machine with podman or docker) runs to host a hub: the distribution's site, built in the image, served by nginx, configured for its network by environment variables at start.

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
| `HUB_ACCOUNT_MOUNTS` | the mounts that ask for an account (username and password), by id: `tradingpost`; someone on a key alone is told why and sent to sign in or register |
| `HUB_REQUIRE_ACCOUNT` | `true`: every mount asks for an account |
| `HUB_SPACE_RELAYS` | a space's own relays, per space id, spaces separated by `;`: `jobs=wss://relay.sh3.home;gems=wss://a,wss://b`; an id with an empty list puts that space on its mount's network |
| `HUB_MODERATORS` | npubs (or hex keys) who moderate every space the hub defines, besides those it ships with: a company hub's managers |

Nothing set: no `hub.local.json`, the site runs as built. `hub.json` next to it is the hub as built (name, versions, relays, policy, spaces with their addresses, mounts), for catalogs and tools; it never changes at start.

```sh
docker build -t ghcr.io/you/your-hub .
docker run --rm -p 8080:80 \
  -e HUB_RELAYS=wss://relay.sh3.home -e HUB_RELAYS_LOCKED=true -e HUB_REQUIRE_HUB=true \
  -e HUB_PUBLIC_RELAYS=wss://nos.lol -e HUB_PUBLIC_MOUNTS=uplink \
  ghcr.io/you/your-hub
```

## On a kiwi master

[kiwi-modules](https://github.com/derlocke-ng/kiwi-modules) has the two modules a hub needs, for a master since 0.6.0 (the machine made to face the internet; a node's role is its LAN): `nostr-relay` (strfry behind the master's reverse proxy, at `relay.<host>`) and `hub` (this image behind the proxy at `hub.<host>`, its `HUB_*` set from the module's settings, the master's own relay as the default). A master lists them in its `modules:` (`examples/hub.yaml` there). As it comes the hub is private: its relay reachable through the mesh only, TLS from the fleet CA. A semi-public one adds `public_relays` and `public_mounts`; a public one sets `reverse-proxy.public` (below).

## Inside a network, or on the internet

The same image serves both; only `HUB_*` and the address differ. Two things hold everywhere:

- **HTTPS.** The page seals and opens everything with the browser's WebCrypto, which exists in a secure context only: a hub opened over plain `http://` (other than `localhost`) says so and stops (`ui/SecureGate.tsx`). Its relays are `wss://` for the same reason: an `https` page cannot open a plain `ws://` socket.
- **Relays people can reach.** The relays a hub names are the ones every visitor's browser connects to.

**Inside a VPN** (a private hub for a household, a team): `hub` and `nostr-relay` on a master as they come. nginx (kiwi-modules' `reverse-proxy`, in the WireGuard server's namespace) serves `hub.<host>` and `relay.<host>` to the mesh with certificates from the fleet CA, which the fleet's machines trust; a phone in the VPN needs the CA installed once. `HUB_RELAYS_LOCKED=true` and `HUB_REQUIRE_HUB=true` make it private.

**On the internet:** a static hub needs no machine of its own (Armory is GitHub Pages and public relays). What a machine of your own adds is a **relay**: a space names it (`spaces[].relays` in `distribution.js`, `HUB_SPACE_RELAYS` in a container), its posts then live there, and its moderators' decisions can be carried out where the posts are. kiwi-modules 0.7 publishes a hub and its relay from a master: `reverse-proxy.public` publishes 80 and 443 from the WireGuard server's namespace, a site whose name is outside the fleet's domain (`hub_domain`, `relay_domain`) answers the internet and every other site, the admin pages among them, the mesh only; Let's Encrypt gives the public names their certificates and renews them (`acme_email`, `acme_staging` to try). Which names a hub uses is its owner's call. What a public relay accepts is still open: `handoffs/kiwi-modules-relay-write-policy.md`.

# kiwi-modules: who may write to a hub's public relay (members, by NIP-42)

For the session on `derlocke-ng/kiwi-modules`: a branch and a pull request, the owner merges (its rules: version free, `VERSION` in `kiwi.manifest` and `lib/kiwimodules/__init__.py`, a CHANGELOG entry, `python3 -m unittest discover -s tests`, a render test per setting). kiwi-server takes it with `tools/vendor.sh`.

## Why

kiwi-modules 0.8.0 lets the internet write to a public relay only from keys listed in `write_pubkeys`. That cannot carry a kiwi hub, even for people known in advance, because much of what a hub's pages write is not signed by the person:

- every Loadout board is its own key pair (kinds 30700–30703);
- a chat group's events are signed by the group's key (30720, 7820–7823);
- every sealed note (messages and files, friend requests, shares, invitations, audience keys) is a NIP-59 gift wrap, kind 1059, signed by a one-time key;
- the hub's own spaces are defined (34550) under a key derived from the hub's id (kiwi-framework `docs/protocol.md` §12).

With a person's key listed, their settings and feed posts get through from the internet; their boards, groups and messages are refused. And people who register on a hub are not known in advance.

## What the hub needs

**Authenticate the connection, not each event** (NIP-42). strfry supports it: with `relay.auth.serviceUrl` set (`wss://<relay_domain>`), a connection can prove a key, and the write-policy plugin receives it as `authed` (the plugin input, strfry `docs/plugins.md`). Today `relay.kiwi-network.eu` does not advertise 42.

**The owner's decision (November 2026): who counts as a member is a setting of the relay**, `members`:

- `registered`: any key that has an account on this hub. An account is a kind 30790 event authored by the person's key with `["v", "2"]` and a non-empty content (`docs/protocol.md` §2; a retired one has `["retired", "1"]` and empty content). The relay accepts such an event from anyone, as the sign-up, when it carries NIP-13 proof of work of at least `register_pow` bits (a setting; the framework will put it on new account entries) and passes a per-IP rate limit; from then on that key is a member. Moderators can ban (below).
- `approved`: a key a moderator approved. The members are a NIP-51 list, kind 30000 with `["d", "members"]` and `["p", <member>]` tags, signed by one of the admins (`write_pubkeys`); the newest such list counts. Registering still stores the account (as above) and asks to join; until approved the key reads only.
- In both: the keys in `write_pubkeys` are admins and always write; `open_writes: true` stays as it is.

**What the write plugin accepts**, in this order:

1. from the mesh: everything (as 0.8.0);
2. a connection authenticated as an admin or a member (and not banned): everything it sends, whoever signed the event;
3. from anyone: a gift wrap (1059) whose `p` tag is a member or an admin (people outside can still write to the hub's people), and, in either mode, a sign-up (30790 as above);
4. otherwise refuse with a NIP-01 prefix the client acts on: `auth-required: …` when the connection has not authenticated, `restricted: …` when it has but its key may not write.

**Bans**: a NIP-51 list, kind 30000 with `["d", "banned"]`, signed by an admin; a banned key is refused even when it is a member.

The plugin needs to look up stored events (accounts, the members and banned lists); a strfry plugin can keep its own index of them as they pass through it, rebuilt at start from `strfry scan` (check what is practical in the module's image).

## What the framework does (kiwi-framework 0.24)

- The hub's pages answer a relay's AUTH challenge with the person's key, on the hub's own relays only (never on public relays, directory relays or guests), and send again what was refused with `auth-required:`.
- A new account entry carries NIP-13 proof of work (the bits the hub asks for, from `hub.local.json`).
- For `approved`, the moderators get the join requests and an Approve button that publishes the members list, with the work board (0.25).

## How to test

Render tests for `members`, `register_pow`, the auth service URL. On a test master behind `reverse-proxy.public`: an unauthenticated write is refused with `auth-required:`; after AUTH as a registered key, a board event (signed by a board key) is accepted; a gift wrap to a member from an unauthenticated stranger is accepted; one to a non-member is refused; a sign-up without proof of work is refused, with it accepted; a banned key is refused after AUTH.

## Done when

The setting is in `nostr-relay`, documented and tested, merged by the owner and vendored into kiwi-server; then this file is deleted here, and the framework's side is checked against the test hub (`hub.kiwi-network.eu`) by the owner.

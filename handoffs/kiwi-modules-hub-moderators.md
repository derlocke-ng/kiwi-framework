# kiwi-modules: the `hub` module passes a hub's moderators (`HUB_MODERATORS`)

For the session on `derlocke-ng/kiwi-modules`. Ask the owner before pushing, tagging or releasing anything there; kiwi-server takes it by vendoring a tag, with the owner's yes.

## Why

From kiwi-framework 0.23 a hub's container reads `HUB_MODERATORS`: npubs (or hex keys) who moderate every space the hub defines, besides the moderators its distribution ships with (`container/entrypoint.sh` writes them to `hub.local.json` as `moderators`; `shared/hubconfig.js` applies them). A company hub on a kiwi master names its managers this way: they fold posts, mark them, approve sellers on a market, and later manage the work board. Armory's own moderators are in its `distribution.js`; this is for hubs that run the same image elsewhere.

## What to change

- `modules/hub/module.yaml`: a setting `moderators` (a list of npubs or 64-hex keys; empty by default), shown next to `account_mounts`, with help text: "npubs who moderate every space this hub defines: they fold and mark posts and approve sellers; a company's managers."
- `modules/hub/docker-compose.yml.j2`: pass it as `HUB_MODERATORS`, space-separated, only when set (as `HUB_ACCOUNT_MOUNTS` is passed).
- `validate`: each entry is `npub1` and 58 bech32 characters, or 64 lowercase hex characters.
- The example `examples/hub.yaml`: a commented line showing it.

## How to test

`kiwi-modules render examples/hub.yaml` with `moderators: [npub1…]` set: the hub's environment has `HUB_MODERATORS=npub1…`; golden files updated. On a master: `curl https://hub.<host>/hub.local.json` shows `"moderators": ["npub1…"]`, and that key's account sees the Reported tab in a feed on one of the hub's spaces.

## Done when

The setting is in the module, rendered, validated, documented, tagged and vendored into kiwi-server with the owner's yes; then this file is deleted here.

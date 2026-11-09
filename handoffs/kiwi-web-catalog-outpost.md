# kiwi-web-catalog: list Outpost (and the framework's feed)

**Repository:** derlocke-ng/kiwi-web-catalog · **Written:** November 2026, with kiwi-framework 0.19.0 and Armory's Outpost

## Why

Armory 0.19 (its commit "Outpost: grow reports on a space of their own") added a tool, **Outpost**: the framework's `feed` app mounted on Armory's `outpost` space. Its catalog entry is `apps/outpost/kiwi.manifest` in the Armory repository, the same kind of file DevBoard, Uplink, Payload and pongjs carry. kiwi-framework 0.19.0 added the `feed` app itself, with `apps/feed/kiwi.manifest`. If the catalog lists Armory's tools and the framework's apps (the architecture says it does: one line per repository, `path=` for an app inside a hub's repository, `ref=` to pin a version), Outpost and the feed are missing.

## The change

1. Find how Armory's DevBoard is listed in `apps.list` (a line naming `https://github.com/derlocke-ng/armory` with `path=apps/devboard`, possibly a `ref=`). Add Outpost the same way, with `path=apps/outpost`.
2. If the framework's own apps are listed (e.g. `path=apps/notices` on kiwi-framework), add `path=apps/feed` the same way.
3. If entries pin a `ref=`: Armory's current commit on `main`, and kiwi-framework's tag `v0.19.0`.

Not known when this was written (check first): the exact line syntax, whether framework apps are listed at all, whether the catalog has a check script or CI that validates the manifests it points at (then run it).

## The manifests it points at

- Armory `apps/outpost/kiwi.manifest`: `NAME=outpost`, `CATEGORY=App`, `FRAMEWORK=kiwi-framework`, `KINDS=30820 30822 7 1984 7805`, `ICON=icon.svg`, `HOMEPAGE=https://derlocke-ng.github.io/armory/outpost/`.
- kiwi-framework `apps/feed/kiwi.manifest`: `NAME=feed`, `CATEGORY=App`, `KINDS=30820 30822 7 1984 7805`.

## Done when

The catalog lists Outpost (and the feed, if framework apps are listed), its own checks pass, and the owner has said yes to the push.

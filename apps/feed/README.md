# feed

A feed on nostr: entries with photos, hashtags, likes and comments, for the community a mount serves, for friends, for one circle of them, or for yourself alone. Nothing leaves the browser in clear: every entry is sealed, and photos are encrypted with keys that travel inside it. One of the framework's own apps; [Armory](https://github.com/derlocke-ng/armory) mounts it as **Outpost**, its grow reports (`framework: 'feed'`).

## Who reads an entry

| audience | sealed with | who reads it |
|---|---|---|
| the space | a key derived from the space's address (`shared/spaces.js`) | everyone using a hub that serves the space; relays, crawlers and other nostr clients see ciphertext |
| friends | the writer's friends key in its current epoch (`shared/audiences.js`) | the writer's friends, including friends added later; someone unfriended reads nothing posted after |
| a circle | that circle's key | the circle's members, the same way |
| only me | a key no one else is ever given | the writer's own devices |

The audience keys are derived from the writer's key, so every device of theirs has them; the current one goes to each member once, as a gift-wrapped rumor (kind 7805), and a new epoch starts when someone leaves. A reader keeps the keys they were given in their encrypted account settings, so every device of theirs reads the same entries. The space key is not a secret: anyone can derive it from the address in a hub's `hub.json`. It keeps a community's entries off plain view, not from a determined reader.

## What is on the wire

- An **entry** is a kind 30820 addressable event: `d` a random id, `a` the space (on a mount on a space), `key` the id of the key it is sealed with (16 hex characters of its SHA-256); content sealed (`docs/protocol.md` §1) to `{ v: 1, text, media: [<media object>…], tags: [<hashtag>…], name, at }`. Editing republishes under the same `d`; deleting publishes `{ del: 1 }` under the same key.
- A **comment** is a kind 30822 addressable event with the entry's address in an `a` tag and the entry's `key`, sealed with the entry's key: `{ text, name, at }`.
- **Likes** are NIP-25 reactions (`+`, an empty content takes one back) with the entry's `a` and `["k", "30820"]`; **reports** NIP-56 with the entry's `a`, `e` and `k`. A report by one of the space's moderators folds an entry away on its own, three by anyone else do.

## Files

| File | What |
|---|---|
| `data/feed.js` | opening, posting, editing, deleting entries and comments; likes and reports; routes |
| `data/social.js` | the likes, comments and reports of the entries a page shows |
| `state.ts` | the context and the hooks the pages share |
| `pages/` | the feed (tabs: the space, friends, mine), an entry with its comments, a person, the composer, the settings |

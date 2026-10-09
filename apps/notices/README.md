# notices

A public noticeboard on nostr: pin that you are hiring or available, signed with your key, voted on by peers, gone when it expires. No server of ours and no sign-up; the suite's one account, block list and settings apply. One of the framework's own apps; [Armory](https://github.com/derlocke-ng/armory) mounts it as **DevBoard** (`framework: 'notices'`), live at <https://derlocke-ng.github.io/armory/devboard/>.

## What a note is

- A **kind 30810** addressable nostr event: a `d` tag per note, an `expiration` tag (NIP-40) between 24 hours and 30 days, one `t` tag per skill, and JSON content `{ type: "hiring" | "available", title, text, tags, rate, contact }`. Editing republishes under the same `d`; deleting publishes a `{ "del": 1 }` tombstone.
- **Proof of work** (NIP-13): a note needs 16 leading zero bits in its id, votes and reports 8. The framework's engine (`shared/pow.js` in kiwi-framework) mines in parallel workers with whichever SHA-256 is faster in that browser (the bundled one, or the native one where the JIT is off, as in Tor Browser), so a note takes a fraction of a second on a laptop and under a second on a phone, while a flood still costs hours of CPU. Events without the work are not shown, whatever a relay accepts.
- **Votes** are NIP-25 reactions (`+` or `-`; one per person and note, the newest wins, empty content takes a vote back). **Reports** are NIP-56 events (kind 1984) carrying the note's address.
- **Saved notes** live in the account's encrypted settings (kind 30791, `d` = `devboard`, DevBoard's id kept on the wire) and follow you to every device.

## Anti-spam, applied by every reader

Three live notes per person; the newest count and the rest collapse. Notes voted down to −5 collapse, as do notes three or more people reported. Blocked people (the suite's encrypted NIP-51 mute list) disappear with their notes, votes and reports. Ten votes per half minute. Because each client applies the rules itself, a relay that lets spam through still cannot put it on your board.

## Files

| File | What |
|---|---|
| `main.tsx`, `App.tsx` | the page for the mount it is served at; routes `#/` (the board) and `#/settings` |
| `data/notices.js` | the rules, reading and checking notes, votes and reports, publishing with proof of work |
| `pages/BoardView.tsx` | search, filters, skill chips, the notes, and the compose, contact and report dialogs |
| `pages/NoticesSettings.tsx` | defaults for new notes (type, contact, duration; kept in the account) and collapsed notes shown opened |
| `notices.css`, `locales/` | the app's own styles and strings |

## Testing

`node test/e2e/notices.mjs` runs several browsers against a local relay on a test hub with the app at `notices/`; Armory runs the same suite against its own site. The suite sets `localStorage` key `devboard.pow` to lower the difficulty, which readers honour only on that device.

# pong

Retro two-player Pong between two browsers, first to 7.

**Live:** <https://derlocke-ng.github.io/armory/pongjs/>

- **Host a game** and send the link or let them scan the QR code — or tick *List under open games* so anyone can join from the menu. **Practice vs CPU** works offline.
- Move with **W/S** or **↑/↓**, the mouse, touch (drag on the field) or the on-screen buttons on phones. **M** toggles sound.
- The field is a fixed 800×500, scaled to your screen, so a phone and a desktop see exactly the same game.

## How it works

The two browsers find each other through gun (the link's `#secret` names an encrypted room; see `shared/p2p.js`) and then play over a direct WebRTC data channel. When no direct path exists, the game runs through gun relays instead — a little laggier, but playable.

The host runs the game at 120 steps a second and sends ~30 snapshots a second; the guest sends its paddle position and draws the ball predicted forward between snapshots, so it moves smoothly. Your own paddle always moves locally, without waiting for the network. The rules and physics are in `game.js` (unit tested in `test/unit/pong.test.js`), the sessions, networking and drawing in `engine.js`, and the screens in `App.tsx` (React); `node test/e2e/pong.mjs` plays real games between browsers, and Armory runs the same suite against its site.

One of the framework's own apps; [Armory](https://github.com/derlocke-ng/armory) mounts it as **pongjs** (`framework: 'pong'`), live at <https://derlocke-ng.github.io/armory/pongjs/>. It keeps its green CRT: `style.css` gives the suite's top bar the same colours.

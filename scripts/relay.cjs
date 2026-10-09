// Local gun relay for development and tests: node scripts/relay.cjs [port]
// Point Loadout at it under Account → Relays: http://localhost:8765/gun
const path = require('path');
const http = require('http');
const Gun = require('gun');

const port = Number(process.argv[2] || process.env.PORT || 8765);
const file = process.env.RADATA || path.join(__dirname, '..', '.radata', String(port));
require('fs').mkdirSync(path.dirname(file), { recursive: true });
const server = http.createServer(Gun.serve(__dirname)).listen(port);
Gun({ web: server, file, multicast: false, axe: false });
console.log(`gun relay on http://localhost:${port}/gun`);

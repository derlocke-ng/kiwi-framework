#!/bin/sh
# A distribution from nothing: the framework's own config, one scaffolded app,
# a build. What a fork does on day one.
set -eu
FW=$(cd "$(dirname "$0")/.." && pwd)
D=$(mktemp -d)
cp "$FW/shared/distribution.js" "$D/distribution.js"
mkdir -p "$D/apps"
cd "$D"
node "$FW/scripts/new-app.mjs" demo "Demo" shield
# the same app mounted twice, as a hub with two markets would: each mount gets its own route
node -e "const fs=require('fs');const f=process.argv[1];fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/(\{ id: 'demo', app: 'demo'[^}]*\},)/, '\$1\n    { id: \'demo-two\', app: \'demo\', name: \'Demo Two\' },'))" "$D/distribution.js"
grep -q "demo-two" "$D/distribution.js"
# one of the framework's own apps (boards), mounted twice under names of the hub's choosing
node -e "const fs=require('fs');const f=process.argv[1];let s=fs.readFileSync(f,'utf8');s=s.replace(/apps: \[/, 'apps: [\n    { id: \'lists\', name: \'Lists\', icon: \'list-checks\', tags: [], framework: \'boards\' },');s=s.replace(/mounts: \[/, 'mounts: [\n    { id: \'lists\', app: \'lists\' },\n    { id: \'shopping\', app: \'lists\', name: \'Shopping\' },');fs.writeFileSync(f,s)" "$D/distribution.js"
grep -q "framework: 'boards'" "$D/distribution.js"
node "$FW/scripts/build-site.mjs" "$D/_site"
test -f "$D/_site/demo-two/index.html"
grep -q "'demo-two/'" "$D/_site/sw.js"
test -f "$D/_site/demo/index.html"
grep -q "^NAME=demo$" "$D/apps/demo/kiwi.manifest"
test -f "$D/_site/shared/distribution.js"
grep -q "hub.demo.text" "$D/_site/locales/en.json"
grep -q "<title>kiwi-framework</title>" "$D/_site/index.html"
ls "$D"/_site/assets/*.js > /dev/null
grep -q "'assets/" "$D/_site/sw.js"
grep -q "'demo/'" "$D/_site/sw.js"
node --check "$D/apps/demo/demo.js"
for r in lists shopping; do
  test -f "$D/_site/$r/index.html"
  ls "$D"/_site/$r/assets/*.js > /dev/null
  test -f "$D/_site/$r/locales/en.json"
  test -f "$D/_site/$r/icon.svg"
  grep -q "'$r/'" "$D/_site/sw.js"
done
grep -q '"name": "Lists"' "$D/_site/lists/manifest.webmanifest"
grep -q '"name": "Shopping"' "$D/_site/shopping/manifest.webmanifest"
echo "smoke: a fresh distribution with one app of its own and the framework's boards builds"
rm -rf "$D"

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
echo "smoke: a fresh distribution with one app builds"
rm -rf "$D"

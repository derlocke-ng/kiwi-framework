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
node "$FW/scripts/build-site.mjs" "$D/_site"
test -f "$D/_site/demo/index.html"
test -f "$D/_site/shared/distribution.js"
grep -q "hub.demo.text" "$D/_site/locales/en.json"
grep -q "'demo/'" "$D/_site/sw.js"
node --check "$D/apps/demo/demo.js"
echo "smoke: a fresh distribution with one app builds"
rm -rf "$D"

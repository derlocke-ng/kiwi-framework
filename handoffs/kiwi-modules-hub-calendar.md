# kiwi-modules: the calendar's way to Nextcloud (hub `caldav`, cloud `cors_origins`)

For the session on `derlocke-ng/kiwi-modules`: a branch and a pull request, the owner merges (its rules: the version free after `git fetch --tags`, `VERSION` in `kiwi.manifest` and `lib/kiwimodules/__init__.py`, a CHANGELOG entry on top, `python3 -m unittest discover -s tests`; a new hub setting needs `modules/hub/module.yaml`, a `HUB_*` line in its `docker-compose.yml.j2` and a test in `tests/test_render.py`). kiwi-server takes it with `tools/vendor.sh`.

## Why

kiwi-framework 0.24 has a calendar app (Armory mounts it): a person's calendars from their Nextcloud (any CalDAV server), the coming days or a month on the phone, events made, changed, deleted, repeating ones, reminders. The page talks CalDAV from the browser (tsdav and ical.js), so it must reach the Nextcloud one of two ways, the owner's decision of November 2026 ("both ways"):

1. **Through the hub**: the hub's container forwards `/remote.php/dav/` to a Nextcloud, and the page asks its own origin, so nothing needs CORS. The image does this when `HUB_CALDAV` is set (kiwi-framework `container/entrypoint.sh`, 0.24): it writes an nginx include and puts `"caldav": "/remote.php/dav/"` into `hub.local.json`, the address the calendar offers.
2. **Directly**, for a hub elsewhere (Armory on GitHub Pages, a person's own Nextcloud): the Nextcloud's nginx must answer CORS for that hub's origin. Nextcloud itself does not, and its answer to a preflight is not one a browser accepts.

## What to change

### `hub`: a setting `caldav`

- `modules/hub/module.yaml`: `key: caldav`, label "Nextcloud for the calendar", help "The Nextcloud the hub's calendar app reaches through the hub, e.g. https://cloud.<node hostname> (the `cloud` module's address). Empty: the calendar asks for a server.", default `""`. Validate: empty or `http(s)://…` with no path (the Nextcloud must be at the root of its name; kiwi's `cloud` is).
- `modules/hub/docker-compose.yml.j2`: `- HUB_CALDAV={{ caldav }}` (only when set, as the other optional ones are).
- `tests/test_render.py`: the variable is rendered when set and absent when not.

What the image then does (no change needed in kiwi-modules; for the review): nginx in the hub container gets

```nginx
location ^~ /remote.php/dav/ {
    proxy_pass <HUB_CALDAV>/remote.php/dav/;
    proxy_set_header Host $proxy_host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Cookie "";
    proxy_ssl_server_name on;
    …
}
location = /.well-known/caldav { return 301 /remote.php/dav/; }
```

so the hub container (on the master) must resolve the Nextcloud's name and reach it over the mesh; the upstream's certificate is not verified by nginx (its default), so the fleet CA needs no change in the image. Nextcloud sees requests from the hub's address with `Host: cloud.<node>`, which its `trusted_domains` has already. Check on a test master whether Nextcloud's brute-force protection should get the hub as a `trusted_proxies` entry (it counts failed logins per client address; through the hub every person is the hub). Say what you found.

### `cloud`: a setting `cors_origins`

- `modules/cloud/module.yaml`: `key: cors_origins`, a list, label "Hubs elsewhere that may use the calendar", help "Origins of kiwi hubs on other servers whose calendar app may talk to this Nextcloud from the browser, e.g. https://derlocke-ng.github.io (Armory). Empty: none; a hub of this fleet reaches it through its own container (`hub.caldav`).", default `[]`. Validate each as `https://host[:port]` with no path.
- The Nextcloud's nginx server (the `nginx.servers` entry of `cloud`, rendered by `reverse-proxy`): with any origin listed, a `map` in `http {}` and a location in the Nextcloud's server, before its `location /`:

```nginx
# http {}
map $http_origin $kiwi_dav_origin {
    default "";
    "https://derlocke-ng.github.io" $http_origin;   # one line per cors_origins entry
}

# the Nextcloud's server {}
location ^~ /remote.php/dav/ {
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin $kiwi_dav_origin always;
        add_header Access-Control-Allow-Methods "GET, PUT, DELETE, PROPFIND, REPORT, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, Depth, If-Match, If-None-Match, Prefer" always;
        add_header Access-Control-Max-Age 600 always;
        add_header Vary Origin always;
        return 204;
    }
    add_header Access-Control-Allow-Origin $kiwi_dav_origin always;
    add_header Access-Control-Expose-Headers "ETag, DAV, Location" always;
    add_header Vary Origin always;
    # add_header here drops the server's own: repeat HSTS (and any other the server adds)
    add_header Strict-Transport-Security "max-age=63072000" always;
    proxy_pass http://nextcloud-aio-apache:{{ apache_port }};
    # …and the rest of what the server's location / has (Connection, proxy_redirect off, timeouts, body size)
}
```

The preflight is answered by nginx (it carries no credentials, and Nextcloud would ask for them); `always` puts the headers on a 401 too, so the page can tell a wrong password from a server it cannot reach. An origin not in the list gets no `Access-Control-Allow-Origin` and the browser stops there. No `Allow-Credentials`: the page sends an app password in `Authorization` and no cookies. Where `reverse-proxy` renders servers from `nginx.servers` entries, this may need a small extension (a per-server `locations` list, or `extra_directives` that allow a block); choose what fits its templates.

- `tests/test_render.py`: the map and the location are rendered for two origins, and absent with none.

## How it was checked here

kiwi-framework's calendar suite (`test/e2e/calendar.mjs`, a CalDAV server laid out like Nextcloud) ran through nginx 1.24 both ways: the hub's container config with `HUB_CALDAV` (the page and `/remote.php/dav/` on one origin, the server sending no CORS), and the snippet above in front of the server with the page on another origin. Both passed every step: connecting (a wrong password said as such), making, reading, editing and deleting events, a weekly series with one occurrence taken out, a reminder.

## How to test on a fleet

On a test master with `hub` and a node with `cloud`: set `hub.caldav` to the node's Nextcloud; open the hub's calendar on a phone in the mesh, sign in with a Nextcloud app password (Settings → Security → Devices & sessions), make an event, see it in Nextcloud's own calendar and back. For `cors_origins`: list `https://derlocke-ng.github.io`, open Armory's calendar, give the Nextcloud's public or mesh address; `curl -i -X OPTIONS -H 'Origin: https://derlocke-ng.github.io' -H 'Access-Control-Request-Method: PROPFIND' https://cloud.<node>/remote.php/dav/` answers 204 with the origin, and with another origin without it.

## Done when

Both settings are in kiwi-modules, documented and tested, merged by the owner and vendored into kiwi-server; then this file is deleted here.

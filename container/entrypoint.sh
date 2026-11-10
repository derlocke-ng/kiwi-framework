#!/bin/sh
# Writes hub.local.json from the container's environment (container/Dockerfile
# puts this under /docker-entrypoint.d, so nginx runs it before it serves).
# The page reads the file before it connects (shared/hubconfig.js). Lists are
# comma- or space-separated. Nothing set: no file, the site runs as built.
#
#   HUB_RELAYS          the hub's own relays, e.g. wss://relay.sh3.home
#   HUB_PUBLIC_RELAYS   the public area's relays; empty: no public area
#   HUB_DIRECTORY_RELAYS  where relay lists are published and asked for (never on a locked hub's own network)
#   HUB_RELAYS_LOCKED   true: a person cannot replace the hub's relays (a private hub)
#   HUB_REQUIRE_HUB     true: the hub's pages wait while none of its relays is reachable
#   HUB_PUBLIC_MOUNTS   the mounts on the public network, e.g. uplink
#   HUB_USER_MOUNTS     true: a person may follow a space the hub does not ship
#   HUB_ACCOUNT_MOUNTS  the mounts that ask for an account (username and password), e.g. tradingpost
#   HUB_REQUIRE_ACCOUNT true: every mount asks for an account
#   HUB_SPACE_RELAYS    a space's own relays, per space id, spaces separated by ';':
#                       jobs=wss://relay.sh3.home;gems=wss://a,wss://b (an empty list: the mount's network)
#   HUB_MODERATORS      npubs (or hex keys) who moderate every space the hub defines, with those it ships with:
#                       a company hub's managers
#   HUB_REGISTER_POW    bits of proof of work on a new account entry: what the hub's members relay asks of a sign-up
#                       (kiwi-modules' nostr-relay `register_pow`, the same number)
#   HUB_CALDAV          a Nextcloud for the calendar app, e.g. https://cloud.sh3.home: nginx forwards
#                       /remote.php/dav/ there (and /.well-known/caldav to it), and the calendar offers this hub's
#                       own address, so the page needs no CORS from the Nextcloud
#   HUB_ICE             STUN and TURN servers for calls in the chat, e.g. stun:turn.sh3.home:3478 turn:turn.sh3.home:3478
#                       (only these are used then, none of the public defaults); a TURN server's login in
#   HUB_ICE_USERNAME, HUB_ICE_CREDENTIAL  (they are in the page: give the TURN server a login for this hub alone)
set -eu
root=${HUB_ROOT:-/usr/share/nginx/html}
out="$root/hub.local.json"

# the calendar's way to a Nextcloud: an nginx include, or none
confd=${HUB_NGINX_DIR:-/etc/nginx/hub.d}
mkdir -p "$confd" 2>/dev/null || true
dav="$confd/caldav.conf"
case "${HUB_CALDAV:-}" in
    '') rm -f "$dav" ;;
    http://*|https://*)
        upstream=$(printf '%s' "$HUB_CALDAV" | sed 's#/*$##')
        {
            printf '# HUB_CALDAV (container/entrypoint.sh): the calendar asks this hub, nginx asks the Nextcloud\n'
            printf 'location ^~ /remote.php/dav/ {\n'
            printf '    proxy_pass %s/remote.php/dav/;\n' "$upstream"
            printf '    proxy_set_header Host $proxy_host;\n'
            printf '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n'
            printf '    proxy_set_header X-Forwarded-Proto $scheme;\n'
            printf '    proxy_set_header Cookie "";\n'
            printf '    proxy_ssl_server_name on;\n'
            printf '    proxy_redirect off;\n'
            printf '    proxy_buffering off;\n'
            printf '    proxy_read_timeout 120s;\n'
            printf '    client_max_body_size 20m;\n'
            printf '    add_header Cache-Control "no-store" always;\n'
            printf '    add_header X-Content-Type-Options "nosniff" always;\n'
            printf '    add_header Referrer-Policy "no-referrer" always;\n'
            printf '}\n'
            printf 'location = /.well-known/caldav {\n'
            printf '    return 301 /remote.php/dav/;\n'
            printf '}\n'
        } > "$dav"
        echo "calendar: /remote.php/dav/ goes to $upstream"
        ;;
    *) echo "HUB_CALDAV must be an http(s) address, e.g. https://cloud.sh3.home; ignored" >&2; rm -f "$dav" ;;
esac

if [ -z "${HUB_RELAYS:-}${HUB_PUBLIC_RELAYS:-}${HUB_DIRECTORY_RELAYS:-}${HUB_RELAYS_LOCKED:-}${HUB_REQUIRE_HUB:-}${HUB_PUBLIC_MOUNTS:-}${HUB_USER_MOUNTS:-}${HUB_SPACE_RELAYS:-}${HUB_ACCOUNT_MOUNTS:-}${HUB_REQUIRE_ACCOUNT:-}${HUB_MODERATORS:-}${HUB_REGISTER_POW:-}${HUB_CALDAV:-}${HUB_ICE:-}" ]; then
    rm -f "$out"
    exit 0
fi

json_list() { # a comma- or space-separated list as a JSON array of strings
    printf '['
    first=1
    for item in $(printf '%s' "$1" | tr ',' ' '); do
        [ $first -eq 1 ] || printf ', '
        printf '"%s"' "$(printf '%s' "$item" | sed 's/["\\]/\\&/g')"
        first=0
    done
    printf ']'
}
bool() { # true/yes/1/on -> true, anything else -> false
    case "$(printf '%s' "$1" | tr 'A-Z' 'a-z')" in
        true|yes|1|on) printf 'true' ;;
        *) printf 'false' ;;
    esac
}

{
    printf '{\n'
    sep=''
    if [ -n "${HUB_RELAYS:-}" ]; then printf '%s  "relays": %s' "$sep" "$(json_list "$HUB_RELAYS")"; sep=',\n'; fi
    if [ -n "${HUB_PUBLIC_RELAYS+x}" ]; then printf "$sep"'  "publicRelays": %s' "$(json_list "${HUB_PUBLIC_RELAYS:-}")"; sep=',\n'; fi
    if [ -n "${HUB_DIRECTORY_RELAYS:-}" ]; then printf "$sep"'  "directoryRelays": %s' "$(json_list "$HUB_DIRECTORY_RELAYS")"; sep=',\n'; fi
    if [ -n "${HUB_PUBLIC_MOUNTS+x}" ]; then printf "$sep"'  "publicMounts": %s' "$(json_list "${HUB_PUBLIC_MOUNTS:-}")"; sep=',\n'; fi
    if [ -n "${HUB_ACCOUNT_MOUNTS+x}" ]; then printf "$sep"'  "accountMounts": %s' "$(json_list "${HUB_ACCOUNT_MOUNTS:-}")"; sep=',\n'; fi
    if [ -n "${HUB_MODERATORS:-}" ]; then printf "$sep"'  "moderators": %s' "$(json_list "$HUB_MODERATORS")"; sep=',\n'; fi
    if [ -f "$dav" ]; then printf "$sep"'  "caldav": "/remote.php/dav/"'; sep=',\n'; fi
    if [ -n "${HUB_ICE:-}" ]; then
        login=''
        if [ -n "${HUB_ICE_USERNAME:-}" ]; then login="$login, \"username\": \"$(printf '%s' "$HUB_ICE_USERNAME" | sed 's/["\\]/\\&/g')\""; fi
        if [ -n "${HUB_ICE_CREDENTIAL:-}" ]; then login="$login, \"credential\": \"$(printf '%s' "$HUB_ICE_CREDENTIAL" | sed 's/["\\]/\\&/g')\""; fi
        printf "$sep"'  "ice": [{ "urls": %s%s }]' "$(json_list "$HUB_ICE")" "$login"; sep=',\n'
    fi
    if [ -n "${HUB_SPACE_RELAYS:-}" ]; then
        spaces=''
        ssep=''
        # shellcheck disable=SC2086
        set -- $(printf '%s' "$HUB_SPACE_RELAYS" | tr ';' ' ')
        for entry in "$@"; do
            sid=${entry%%=*}
            list=${entry#*=}
            [ "$sid" = "$entry" ] && list=''
            [ -n "$sid" ] || continue
            spaces="$spaces$ssep\"$(printf '%s' "$sid" | sed 's/["\\]/\\&/g')\": { \"relays\": $(json_list "$list") }"
            ssep=', '
        done
        if [ -n "$spaces" ]; then printf "$sep"'  "spaces": { %s }' "$spaces"; sep=',\n'; fi
    fi
    policy=''
    psep=''
    if [ -n "${HUB_RELAYS_LOCKED:-}" ]; then policy="$policy$psep\"relays\": \"$([ "$(bool "$HUB_RELAYS_LOCKED")" = true ] && printf locked || printf open)\""; psep=', '; fi
    if [ -n "${HUB_REQUIRE_HUB:-}" ]; then policy="$policy$psep\"requireHub\": $(bool "$HUB_REQUIRE_HUB")"; psep=', '; fi
    if [ -n "${HUB_USER_MOUNTS:-}" ]; then policy="$policy$psep\"userMounts\": $(bool "$HUB_USER_MOUNTS")"; psep=', '; fi
    if [ -n "${HUB_REQUIRE_ACCOUNT:-}" ]; then policy="$policy$psep\"requireAccount\": $(bool "$HUB_REQUIRE_ACCOUNT")"; psep=', '; fi
    case "${HUB_REGISTER_POW:-}" in
        ''|*[!0-9]*) ;;
        *) policy="$policy$psep\"registerPow\": $((HUB_REGISTER_POW + 0))"; psep=', ' ;;
    esac
    if [ -n "$policy" ]; then printf "$sep"'  "policy": { %s }' "$policy"; sep=',\n'; fi
    printf '\n}\n'
} > "$out"
echo "hub.local.json: $(tr -d '\n' < "$out")"

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
#   HUB_SPACE_RELAYS    a space's own relays, per space id, spaces separated by ';':
#                       jobs=wss://relay.sh3.home;gems=wss://a,wss://b (an empty list: the mount's network)
set -eu
root=${HUB_ROOT:-/usr/share/nginx/html}
out="$root/hub.local.json"

if [ -z "${HUB_RELAYS:-}${HUB_PUBLIC_RELAYS:-}${HUB_DIRECTORY_RELAYS:-}${HUB_RELAYS_LOCKED:-}${HUB_REQUIRE_HUB:-}${HUB_PUBLIC_MOUNTS:-}${HUB_USER_MOUNTS:-}${HUB_SPACE_RELAYS:-}" ]; then
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
    if [ -n "$policy" ]; then printf "$sep"'  "policy": { %s }' "$policy"; sep=',\n'; fi
    printf '\n}\n'
} > "$out"
echo "hub.local.json: $(tr -d '\n' < "$out")"

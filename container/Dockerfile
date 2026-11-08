# A hub as a container: the distribution's site, built here, served by nginx.
# Copy this file to the root of a distribution's repository (Armory has it) and
#
#   docker build -t ghcr.io/you/your-hub .
#   docker run -p 8080:80 -e HUB_RELAYS=wss://relay.sh3.home ghcr.io/you/your-hub
#
# The HUB_* environment names what the deployment decides (the relays inside a
# VPN, the public area's relays, the policy): container/entrypoint.sh writes
# them to hub.local.json, which the page reads before it connects, so one
# image serves many networks. kiwi-modules' `hub` module runs this image.

FROM docker.io/library/node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM docker.io/library/nginx:1-alpine
COPY --from=build /src/node_modules/kiwi-framework/container/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/node_modules/kiwi-framework/container/entrypoint.sh /docker-entrypoint.d/40-hub-config.sh
COPY --from=build /src/_site /usr/share/nginx/html
RUN chmod +x /docker-entrypoint.d/40-hub-config.sh
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/hub.json || exit 1

# The production web front: the Angular build served by Caddy, which also
# proxies the API (/streamer, /strategy — WebSockets included) to the backend
# container and terminates HTTPS. One origin for the browser, so the app's
# production apiBase is '' and there is no CORS to configure.
#
# Built and run by autoTrader/deploy/docker-compose.vps.yml.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx ng build --configuration production

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist/autotrader-frontend/browser /srv

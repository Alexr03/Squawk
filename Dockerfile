# Squawk web: the static game, built with the PocketBase address baked in, served by nginx on 8080.
# Build from a full clone (the version's patch number counts commits): docker build --build-arg VITE_POCKETBASE_URL=https://squawk.x3.dev .
FROM node:24-alpine AS build
RUN apk add --no-cache git && npm i -g pnpm@11.5.2
WORKDIR /src
COPY . .
ARG VITE_POCKETBASE_URL=
ARG GITHUB_SHA=
ENV VITE_POCKETBASE_URL=$VITE_POCKETBASE_URL GITHUB_SHA=$GITHUB_SHA
RUN pnpm install --frozen-lockfile && pnpm --filter @squawk/web build

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

# PocketBase for Squawk: accounts (Discord), daily leaderboard, cloud saves and co-op rooms.
# pb_migrations/ is applied on start; entrypoint.sh creates the superuser from PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD.
FROM alpine:3.22
ARG PB_VERSION=0.40.5
ARG TARGETARCH=amd64
RUN apk add --no-cache ca-certificates unzip wget \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" -O /tmp/pb.zip \
 && unzip -q /tmp/pb.zip pocketbase -d /pb \
 && rm /tmp/pb.zip \
 && adduser -D -u 10002 pocketbase \
 && mkdir -p /pb/pb_data && chown pocketbase /pb/pb_data
COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks
COPY entrypoint.sh /pb/entrypoint.sh
USER 10002
WORKDIR /pb
EXPOSE 8090
VOLUME /pb/pb_data
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8090/api/health >/dev/null || exit 1
ENTRYPOINT ["/bin/sh", "/pb/entrypoint.sh"]

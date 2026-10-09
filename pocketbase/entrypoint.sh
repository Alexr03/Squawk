#!/bin/sh
# Apply the schema, make sure the admin superuser exists, then serve.
set -e
PB="/pb/pocketbase --dir=/pb/pb_data --migrationsDir=/pb/pb_migrations --hooksDir=/pb/pb_hooks"
$PB migrate up
if [ -n "$PB_SUPERUSER_EMAIL" ] && [ -n "$PB_SUPERUSER_PASSWORD" ]; then
  $PB superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD"
else
  echo "PB_SUPERUSER_EMAIL / PB_SUPERUSER_PASSWORD not set: no superuser created (the dashboard at /_/ will ask for one)." >&2
fi
exec $PB serve --http=0.0.0.0:8090

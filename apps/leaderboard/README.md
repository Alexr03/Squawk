# Squawk leaderboard + co-op rooms

A Cloudflare Worker with one KV namespace. It serves the daily-challenge leaderboard and the room codes that let co-op
players connect without copy-pasting invite codes. The game works without it: the leaderboard falls back to the
device, and co-op falls back to copy-paste codes.

## Routes

| Route | What |
| --- | --- |
| `GET /daily/:date` | `{entries}`: top 50 `{name, score, grade, at}` for a `YYYY-MM-DD` day |
| `POST /daily/:date` | `{name, score, grade}` → `{rank}` (`null` outside the top 50). Names are clamped to 20 printable characters, scores must be integers from 0 to 100000, one score per IP every 30 s |
| `POST /room` | `{code}`: a new 6-letter room (expires after 10 minutes without host activity) |
| `PUT/GET /room/:code/offer` | the host's current invite `{id, code}` (`null` until there is one) |
| `PUT/GET /room/:code/answer/:peer` | a guest's answer to invite `:peer` (`null` until there is one; a second PUT gets 409 because the invite was taken) |
| `GET /room/:code/peers` | `{peers}`: invite ids that have been answered |

CORS is open to any origin. Room keys expire after 10 minutes (KV TTL).

## Deploy

```sh
cd apps/leaderboard
npx wrangler login
npx wrangler kv namespace create SQUAWK   # paste the printed id into wrangler.toml
npx wrangler deploy                       # prints the worker URL
```

Then build the web app with the worker's URL:

```sh
VITE_LEADERBOARD_URL=https://squawk-leaderboard.<you>.workers.dev pnpm --filter @squawk/web build
```

For Cloudflare Pages, set `VITE_LEADERBOARD_URL` as a build environment variable instead. `npx wrangler dev` runs the
worker locally with a local KV.

## Notes

- KV's shortest expiry is 60 s, so the rate-limit key lives 60 s and stores the time of the last score. A second score
  is refused for 30 s after the first.
- KV is eventually consistent. Two players in the same region see writes almost at once, but players far apart can
  take longer to connect through a room. Copy-paste codes always work. Durable Objects would remove the delay if it
  matters.
- Tests: `pnpm test` from the repo root runs `src/index.test.ts` against an in-memory KV.

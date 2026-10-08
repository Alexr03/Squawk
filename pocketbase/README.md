# Squawk on PocketBase

Accounts (Discord sign-in), the daily-challenge leaderboard and cloud saves. The game works without it: scores and progress then stay on each device.

## Set up

1. Run [PocketBase](https://pocketbase.io) 0.23 or later with this folder's migrations:
   `./pocketbase serve --migrationsDir ./pb_migrations --hooksDir ./pb_hooks` (or copy both folders next to your
   PocketBase binary). The hook in `pb_hooks/` guards co-op room ownership, so don't leave it out.
   This creates the `scores`, `profiles`, `rooms` and `answers` collections and turns password sign-in off.
2. Create a Discord application at https://discord.com/developers/applications. Under OAuth2 add the redirect URL
   `https://<your-pocketbase-host>/api/oauth2-redirect`.
3. In the PocketBase admin: Collections → users → Options → OAuth2 → enable **Discord** with the app's client ID and secret.
4. Add your game's origin (e.g. `https://squawk.x3.dev`) to the allowed origins if you restrict CORS.
5. Build the game with `VITE_POCKETBASE_URL=https://<your-pocketbase-host>` (Cloudflare Pages: Settings → Environment variables).

## Co-op rooms

Hosting a co-op shift opens a room with an **8-digit code**; friends type it into Co-op → Join. Only the WebRTC handshake
passes through PocketBase (`rooms` and `answers`); the shift itself runs peer to peer between the players' browsers.
Hosting needs Discord sign-in, joining doesn't. Very strict networks (some corporate or mobile ones) can block direct
connections; a TURN server would cover those and isn't set up yet.

## Testing it locally

```sh
./pocketbase migrate up --migrationsDir ./pb_migrations
./pocketbase superuser upsert admin@test.local <password>
./pocketbase serve --migrationsDir ./pb_migrations --hooksDir ./pb_hooks
VITE_POCKETBASE_URL=http://127.0.0.1:8090 pnpm --filter @squawk/web exec vite --port 5175
node tools/pbcoop.mjs http://localhost:5175/ http://127.0.0.1:8090 admin@test.local <password>   # host + guest join by code
```

## What is stored

| Collection | Contents | Who can read it |
| --- | --- | --- |
| `users` | Discord identity, display name | Name is public (for the board) |
| `scores` | One row per player per day: score and grade, only ever raised | Everyone |
| `profiles` | Career progress (ratings, best grades, daily results) | Only its owner |
| `rooms`, `answers` | Co-op room codes and WebRTC handshakes (the room is deleted when the host leaves) | Anyone with the code |

Scores are submitted by the player's browser, so a determined player could fake one. The sim is deterministic, so a later step could verify submissions by replaying the shift's command log on the server.

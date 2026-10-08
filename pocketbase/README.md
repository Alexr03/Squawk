# Squawk on PocketBase

Accounts (Discord sign-in), the daily-challenge leaderboard and cloud saves. The game works without it: scores and progress then stay on each device.

## Set up

1. Run [PocketBase](https://pocketbase.io) 0.23 or later with this folder's migrations:
   `./pocketbase serve --migrationsDir ./pb_migrations` (or copy `pb_migrations/` next to your PocketBase binary).
   This creates the `scores` and `profiles` collections and turns password sign-in off.
2. Create a Discord application at https://discord.com/developers/applications. Under OAuth2 add the redirect URL
   `https://<your-pocketbase-host>/api/oauth2-redirect`.
3. In the PocketBase admin: Collections → users → Options → OAuth2 → enable **Discord** with the app's client ID and secret.
4. Add your game's origin (e.g. `https://squawk.x3.dev`) to the allowed origins if you restrict CORS.
5. Build the game with `VITE_POCKETBASE_URL=https://<your-pocketbase-host>` (Cloudflare Pages: Settings → Environment variables).

## What is stored

| Collection | Contents | Who can read it |
| --- | --- | --- |
| `users` | Discord identity, display name | Name is public (for the board) |
| `scores` | One row per player per day: score and grade, only ever raised | Everyone |
| `profiles` | Career progress (ratings, best grades, daily results) | Only its owner |

Scores are submitted by the player's browser, so a determined player could fake one. The sim is deterministic, so a later step could verify submissions by replaying the shift's command log on the server.

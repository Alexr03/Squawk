// Runs the leaderboard/rooms worker (apps/leaderboard) on Node with an in-memory KV, for testing without Cloudflare.
// Usage: node tools/lb-local.mjs [port=8787], then start the web app with VITE_LEADERBOARD_URL=http://localhost:8787
import http from 'node:http';
import { handle } from '../apps/leaderboard/src/index.ts';

const m = new Map();
const env = { SQUAWK: { get: async k => m.get(k) ?? null, put: async (k, v) => void m.set(k, v) } };
const port = +(process.argv[2] ?? 8787);
http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const r = await handle(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: { 'cf-connecting-ip': req.socket.remoteAddress ?? '' },
    body: req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' ? undefined : Buffer.concat(chunks) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`leaderboard worker on http://localhost:${port}`));

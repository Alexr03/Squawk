// Cached Overpass API client. Raw responses live in tools/pipeline/.cache (gitignored).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CACHE = new URL('./.cache/', import.meta.url);

export async function cached<T>(name: string, fetcher: () => Promise<T>, refresh = false): Promise<T> {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  const file = new URL(`${name}.json`, CACHE);
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const v = await fetcher();
  writeFileSync(file, JSON.stringify(v));
  return v;
}

export function overpass(name: string, query: string, refresh = false): Promise<any> {
  return cached(name, async () => {
    for (let attempt = 1; ; attempt++) {
      const r = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'User-Agent': 'squawk-pipeline/0.2', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (r.ok) return r.json();
      if (attempt >= 4) throw new Error(`Overpass ${r.status}: ${await r.text()}`);
      await new Promise(res => setTimeout(res, 15000 * attempt));
    }
  }, refresh);
}

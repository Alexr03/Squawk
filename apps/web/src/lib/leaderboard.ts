// Daily-challenge leaderboard client. Talks to the Cloudflare Worker in apps/leaderboard when VITE_LEADERBOARD_URL is set;
// otherwise keeps a local board so the feature still works offline.
export interface Entry { name: string; score: number; grade: string; at: number }

const BASE = (import.meta.env.VITE_LEADERBOARD_URL as string | undefined)?.replace(/\/$/, '');
const LOCAL = 'squawk.board';

function localBoard(key: string): Entry[] {
  try { return (JSON.parse(localStorage.getItem(LOCAL) ?? '{}')[key] ?? []) as Entry[]; } catch { return []; }
}
function saveLocal(key: string, list: Entry[]) {
  try { const all = JSON.parse(localStorage.getItem(LOCAL) ?? '{}'); all[key] = list; localStorage.setItem(LOCAL, JSON.stringify(all)); } catch { /* ignore */ }
}

export const online = !!BASE;

export async function fetchBoard(key: string): Promise<{ entries: Entry[]; online: boolean }> {
  if (BASE) {
    try {
      const r = await fetch(`${BASE}/daily/${key}`);
      if (r.ok) return { entries: (await r.json()).entries as Entry[], online: true };
    } catch { /* fall back */ }
  }
  return { entries: localBoard(key), online: false };
}

export async function submitScore(key: string, name: string, score: number, grade: string): Promise<string> {
  const entry: Entry = { name: name.slice(0, 20), score, grade, at: Date.now() };
  const local = [...localBoard(key), entry].sort((a, b) => b.score - a.score).slice(0, 50);
  saveLocal(key, local);
  if (!BASE) return 'Saved to your local board';
  try {
    const r = await fetch(`${BASE}/daily/${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entry) });
    if (!r.ok) return `Leaderboard said ${r.status}`;
    const { rank } = await r.json();
    return rank ? `Submitted — rank ${rank}` : 'Submitted';
  } catch { return 'Offline — saved locally'; }
}

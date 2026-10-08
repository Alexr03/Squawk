// Accounts, leaderboard and cloud saves on PocketBase. Optional: with no VITE_POCKETBASE_URL the game is fully local.
import PocketBase, { type RecordModel } from 'pocketbase';
import { loadProgress, saveProgress, type Progress } from './progress.ts';

const URL = (import.meta.env.VITE_POCKETBASE_URL as string | undefined)?.replace(/\/$/, '');
export const pb: PocketBase | null = URL ? new PocketBase(URL) : null;
pb?.autoCancellation(false);

export interface Account { id: string; name: string; email: string }
const toAccount = (r: RecordModel | null): Account | null => (r ? { id: r.id, name: (r.name as string) || (r.email as string)?.split('@')[0] || 'Controller', email: r.email as string } : null);

/** The signed-in player (null when signed out, or when there is no server). */
export const account = $state<{ user: Account | null }>({ user: toAccount(pb?.authStore.record ?? null) });
pb?.authStore.onChange((_t, r) => { account.user = toAccount(r); });

const friendly = (e: unknown) => {
  const d = (e as { response?: { message?: string; data?: Record<string, { message: string }> } })?.response;
  const field = d?.data && Object.values(d.data)[0]?.message;
  return field || d?.message || 'Could not reach the server';
};

/** Sign in with Discord (a popup). New accounts take the Discord display name. */
export async function signInWithDiscord(): Promise<string | null> {
  if (!pb) return 'No account server is set up';
  try {
    const auth = await pb.collection('users').authWithOAuth2({ provider: 'discord' });
    const meta = auth.meta as { name?: string; username?: string; rawUser?: { global_name?: string; username?: string } } | undefined;
    const discordName = meta?.rawUser?.global_name || meta?.name || meta?.username || meta?.rawUser?.username;
    if (discordName && !auth.record.name) { await pb.collection('users').update(auth.record.id, { name: discordName.slice(0, 20) }); await pb.collection('users').authRefresh(); }
    await syncProgress();
    return null;
  } catch (e) { return friendly(e); }
}
export function signOut() { pb?.authStore.clear(); }
export async function rename(name: string): Promise<string | null> {
  if (!pb || !account.user) return null;
  try { await pb.collection('users').update(account.user.id, { name: name.slice(0, 20) }); await pb.collection('users').authRefresh(); return null; } catch (e) { return friendly(e); }
}

// ------------------------------------------------------------------ cloud saves

/** Best of both: every career shift at its best grade, the higher shift count, every daily result. */
function merge(a: Progress, b: Progress): Progress {
  const passed = { ...a.passed };
  for (const [k, v] of Object.entries(b.passed)) if (!passed[k] || v.score > passed[k].score) passed[k] = v;
  const bests = { ...a.bests };
  for (const [k, v] of Object.entries(b.bests)) bests[k] = Math.max(bests[k] ?? 0, v);
  return { ratings: [...new Set([...a.ratings, ...b.ratings])], passed, bests, daily: { ...b.daily, ...a.daily }, shifts: Math.max(a.shifts, b.shifts) };
}

let profileId: string | null = null;
/** Pull the account's progress, merge it with this device's, and push the result back. */
export async function syncProgress() {
  if (!pb || !account.user) return;
  try {
    const list = await pb.collection('profiles').getList(1, 1, { filter: pb.filter('user = {:u}', { u: account.user.id }) });
    const remote = list.items[0];
    const merged = merge(loadProgress(), (remote?.progress as Progress | undefined) ?? loadProgress());
    saveProgress(merged);
    if (remote) { profileId = remote.id; await pb.collection('profiles').update(remote.id, { progress: merged }); }
    else profileId = (await pb.collection('profiles').create({ user: account.user.id, progress: merged })).id;
  } catch { /* offline: try again next time */ }
}
/** After a shift: push this device's progress. */
export async function pushProgress() {
  if (!pb || !account.user) return;
  if (!profileId) return syncProgress();
  try { await pb.collection('profiles').update(profileId, { progress: loadProgress() }); } catch { /* offline */ }
}

// ------------------------------------------------------------------ leaderboard

export interface Entry { name: string; score: number; grade: string; at: number }

export async function boardFromServer(day: string): Promise<Entry[] | null> {
  if (!pb) return null;
  try {
    const r = await pb.collection('scores').getList(1, 50, { filter: pb.filter('day = {:d}', { d: day }), sort: '-score', expand: 'user' });
    return r.items.map(i => ({ name: (i.expand?.user?.name as string) || (i.name as string) || 'Controller', score: i.score as number, grade: i.grade as string, at: Date.parse(i.created) }));
  } catch { return null; }
}

/** One entry per player per day: kept only if it beats their earlier score. Returns a status line, or null if not signed in. */
export async function scoreToServer(day: string, score: number, grade: string): Promise<string | null> {
  if (!pb || !account.user) return null;
  try {
    const mine = (await pb.collection('scores').getList(1, 1, { filter: pb.filter('day = {:d} && user = {:u}', { d: day, u: account.user.id }) })).items[0];
    if (mine && (mine.score as number) >= score) return `Your best today stays at ${(mine.score as number).toLocaleString('en-GB')}`;
    if (mine) await pb.collection('scores').update(mine.id, { score, grade });
    else await pb.collection('scores').create({ user: account.user.id, name: account.user.name, day, score, grade });
    const above = await pb.collection('scores').getList(1, 1, { filter: pb.filter('day = {:d} && score > {:s}', { d: day, s: score }) });
    return `Submitted as ${account.user.name}, rank ${above.totalItems + 1}`;
  } catch (e) { return `Leaderboard: ${friendly(e)}`; }
}

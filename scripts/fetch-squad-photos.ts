/* One-time squad-photo fetcher — bakes API-Football player photo URLs into
 * lib/player-photos.ts so every squad member has a headshot in the app,
 * including bench players who never appear in live match data.
 *
 * Designed to run over 2-3 days within the API-Football free tier
 * (100 requests/day, shared with the app's ingestion cron which caps
 * itself at 80/day):
 *
 *   npx tsx scripts/fetch-squad-photos.ts              # default budget: 16 teams
 *   npx tsx scripts/fetch-squad-photos.ts --budget 20  # override per-run budget
 *
 * Request cost: 1 request to map team IDs (first run only) + 1 request per
 * team squad. 48 teams total → three runs at the default budget.
 *
 * The script is resumable: progress (team-ID map + fetched squads) is
 * checkpointed to scripts/.squad-photos-progress.json (gitignored), and
 * lib/player-photos.ts is regenerated from the full checkpoint after every
 * run, so each run's output includes everything collected so far.
 *
 * Safety rails:
 * - Stops when the vendor's x-ratelimit-requests-remaining header drops
 *   below QUOTA_FLOOR, leaving headroom for the app's own ingestion.
 * - Sleeps between requests to respect the free tier's 10 req/min limit.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nrm, canon, canonPlayer } from "../lib/merge";
import { TEAM_PROFILES } from "../lib/teams";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROGRESS_FILE = resolve(ROOT, "scripts/.squad-photos-progress.json");
const OUTPUT_FILE = resolve(ROOT, "lib/player-photos.ts");

const API_BASE = "https://v3.football.api-sports.io";
const WC_LEAGUE = Number(process.env.WC_LEAGUE || 1);
const WC_SEASON = Number(process.env.WC_SEASON || 2026);
/* Stop when this few vendor requests remain today — the app's live
   enrichment and ingest cron need the rest. */
const QUOTA_FLOOR = 25;
/* Free tier allows 10 requests/minute — 7s spacing keeps us under it. */
const REQUEST_SPACING_MS = 7000;

interface SquadPlayer {
  name: string;
  number: number | null;
  position: string | null;
  photo: string | null;
}

interface Progress {
  /* API-Football team id → canonical team name (from /teams?league&season) */
  teamIds: Record<string, string>;
  /* canonical team name → squad (null photo entries kept for completeness) */
  squads: Record<string, SquadPlayer[]>;
}

function loadApiKey(): string {
  if (process.env.APIFOOTBALL_KEY) return process.env.APIFOOTBALL_KEY;
  // Fall back to .env.local so the script runs without exporting the key
  try {
    const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
    const match = env.match(/^APIFOOTBALL_KEY\s*=\s*"?([^"\n]+)"?/m);
    if (match) return match[1].trim();
  } catch { /* fall through */ }
  console.error("APIFOOTBALL_KEY not found in env or .env.local");
  process.exit(1);
}

function loadProgress(): Progress {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, "utf8")) as Progress;
  }
  return { teamIds: {}, squads: {} };
}

function saveProgress(progress: Progress): void {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

let quotaRemaining = Number.POSITIVE_INFINITY;

async function apiGet(key: string, path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "x-apisports-key": key },
    signal: AbortSignal.timeout(15000),
  });
  const remaining = res.headers.get("x-ratelimit-requests-remaining");
  // A missing header counts as zero — never assume unlimited quota
  quotaRemaining = remaining != null ? Number(remaining) : 0;
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  const body = await res.json() as { errors?: unknown; response?: unknown };
  const errs = body.errors;
  if (errs && (Array.isArray(errs) ? errs.length : Object.keys(errs as object).length)) {
    throw new Error(`${path} → API error: ${JSON.stringify(errs)}`);
  }
  return body.response;
}

/* Resolve all 48 World Cup team ids in a single request */
async function fetchTeamIds(key: string, progress: Progress): Promise<void> {
  console.log(`Fetching team ids (league ${WC_LEAGUE}, season ${WC_SEASON})...`);
  const response = await apiGet(key, `/teams?league=${WC_LEAGUE}&season=${WC_SEASON}`) as Array<{ team?: { id?: number; name?: string } }>;
  for (const entry of response || []) {
    const id = entry.team?.id;
    const name = entry.team?.name;
    if (id && name) progress.teamIds[String(id)] = canon(name);
  }
  saveProgress(progress);
  console.log(`Mapped ${Object.keys(progress.teamIds).length} teams (quota remaining: ${quotaRemaining})`);
}

async function fetchSquad(key: string, teamId: string, teamName: string, progress: Progress): Promise<void> {
  const response = await apiGet(key, `/players/squads?team=${teamId}`) as Array<{ players?: Array<{ name?: string; number?: number; position?: string; photo?: string }> }>;
  const players: SquadPlayer[] = (response?.[0]?.players || []).map(p => ({
    name: p.name || "",
    number: p.number ?? null,
    position: p.position ?? null,
    photo: p.photo ?? null,
  })).filter(p => p.name);
  progress.squads[teamName] = players;
  saveProgress(progress);
  console.log(`  ${teamName}: ${players.length} players, ${players.filter(p => p.photo).length} with photos (quota remaining: ${quotaRemaining})`);
}

/* Regenerate lib/player-photos.ts from everything collected so far.
   Keys use the same normalization as the app's runtime image index
   (nrm(canonPlayer(name)) + "|" + nrm(canon(team)), plus a name-only key)
   so PlayerAvatar lookups hit without extra work. */
/* Last whitespace token, normalized — used to join API-Football's
   abbreviated names ("E. Álvarez") to the app's full roster names
   ("Edson Alvarez"). */
function surnameKey(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return nrm(parts[parts.length - 1] || "");
}

function firstInitial(name: string): string {
  return nrm(name.trim()[0] || "");
}

/* Order-insensitive name key: normalized tokens, sorted and joined. Catches
   family-name-first listings ("Son Heung-Min" vs roster "Heungmin Son"). */
function tokenSetKey(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).map(nrm).sort().join("");
}

function generateOutput(progress: Progress): void {
  const entries = new Map<string, string>();
  for (const [team, players] of Object.entries(progress.squads)) {
    const teamKey = nrm(canon(team));
    for (const p of players) {
      if (!p.photo) continue;
      const nameKey = nrm(canonPlayer(p.name));
      if (!nameKey) continue;
      if (!entries.has(`${nameKey}|${teamKey}`)) entries.set(`${nameKey}|${teamKey}`, p.photo);
      if (!entries.has(`${nameKey}|`)) entries.set(`${nameKey}|`, p.photo);
    }

    /* Join against the app's static rosters so lookups by full roster name
       resolve even though the vendor abbreviates first names. Surname match
       first; on a surname collision within the squad, require the first
       initial to match too; still ambiguous → skip (never guess a face). */
    const roster = TEAM_PROFILES[canon(team)]?.squad || [];
    for (const rosterPlayer of roster) {
      const rosterKey = nrm(canonPlayer(rosterPlayer.name));
      if (!rosterKey || entries.has(`${rosterKey}|${teamKey}`)) continue;
      // Strongest first: same name tokens in any order (handles
      // family-name-first listings), then surname, then surname + initial.
      const byTokenSet = players.filter(p => p.photo && tokenSetKey(p.name) === tokenSetKey(rosterPlayer.name));
      let match = byTokenSet.length === 1 ? byTokenSet[0] : undefined;
      if (!match) {
        const bySurname = players.filter(p => p.photo && surnameKey(p.name) === surnameKey(rosterPlayer.name));
        if (bySurname.length === 1) match = bySurname[0];
        else if (bySurname.length > 1) {
          const byInitial = bySurname.filter(p => firstInitial(p.name) === firstInitial(rosterPlayer.name));
          if (byInitial.length === 1) match = byInitial[0];
        }
      }
      if (!match?.photo) continue;
      entries.set(`${rosterKey}|${teamKey}`, match.photo);
      if (!entries.has(`${rosterKey}|`)) entries.set(`${rosterKey}|`, match.photo);
    }
  }
  /* Every photo URL is https://media.api-sports.io/football/players/<id>.png —
     store only the numeric id and rebuild the URL at runtime, cutting the
     client-bundle weight of this file by ~70%. */
  const PHOTO_URL_RE = /^https:\/\/media\.api-sports\.io\/football\/players\/(\d+)\.png$/;
  const sorted = [...entries.entries()]
    .map(([k, url]) => {
      const id = PHOTO_URL_RE.exec(url)?.[1];
      if (!id) console.warn(`  Skipping non-standard photo URL for ${k}: ${url}`);
      return id ? ([k, Number(id)] as const) : null;
    })
    .filter((e): e is readonly [string, number] => !!e)
    .sort(([a], [b]) => a.localeCompare(b));
  const lines = sorted.map(([k, id]) => `  ${JSON.stringify(k)}: ${id},`);
  const teamCount = Object.keys(progress.squads).length;
  const file = `/* GENERATED FILE — do not edit by hand.
 * Produced by scripts/fetch-squad-photos.ts from API-Football squad data.
 * Keys: nrm(canonPlayer(name)) + "|" + nrm(canon(team)) — plus a name-only
 * variant ("name|") — matching the app's player-image index keys.
 * Values are API-Football player ids; playerPhotoUrl() rebuilds the CDN URL.
 * Covers ${teamCount}/48 squads (${sorted.length} entries). Re-run the script
 * to extend coverage; it regenerates this file from its checkpoint.
 * Photos are served by API-Football's media CDN (attributed provider).
 */

export const PLAYER_PHOTO_IDS: Record<string, number> = {
${lines.join("\n")}
};

export function playerPhotoUrl(id: number | undefined): string | null {
  return id ? \`https://media.api-sports.io/football/players/\${id}.png\` : null;
}
`;
  writeFileSync(OUTPUT_FILE, file);
  console.log(`\nWrote ${OUTPUT_FILE}: ${sorted.length} entries across ${teamCount}/48 squads`);
}

async function main(): Promise<void> {
  const budgetArg = process.argv.indexOf("--budget");
  const budget = budgetArg > -1 ? Math.max(1, Number(process.argv[budgetArg + 1]) || 16) : 16;
  const key = loadApiKey();
  const progress = loadProgress();

  if (Object.keys(progress.teamIds).length === 0) {
    await fetchTeamIds(key, progress);
    await sleep(REQUEST_SPACING_MS);
  }

  const pending = Object.entries(progress.teamIds).filter(([, name]) => !progress.squads[name]);
  console.log(`Squads fetched: ${Object.keys(progress.squads).length}/${Object.keys(progress.teamIds).length} — fetching up to ${budget} more this run\n`);

  let fetched = 0;
  for (const [teamId, teamName] of pending) {
    if (fetched >= budget) break;
    if (quotaRemaining < QUOTA_FLOOR) {
      console.log(`\nStopping: quota remaining (${quotaRemaining}) is at the safety floor (${QUOTA_FLOOR}).`);
      break;
    }
    try {
      await fetchSquad(key, teamId, teamName, progress);
      fetched++;
    } catch (err) {
      console.error(`  ${teamName}: FAILED — ${String(err)} (will retry next run)`);
    }
    await sleep(REQUEST_SPACING_MS);
  }

  generateOutput(progress);
  const remaining = Object.entries(progress.teamIds).filter(([, name]) => !progress.squads[name]).length;
  console.log(remaining > 0
    ? `${remaining} squads remaining — run the script again tomorrow.`
    : "All squads fetched. Coverage complete — this script is no longer needed.");
}

main().catch(err => { console.error(err); process.exit(1); });

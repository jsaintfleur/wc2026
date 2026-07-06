import { NextRequest, NextResponse } from "next/server";
import { DATA, type MatchEvent } from "@/lib/data";
import { canon, canonPlayer, mergeFixtures, nrm, type VendorFixture as MergeVendorFixture, type ScheduleMatch } from "@/lib/merge";
import { VERIFIED_RESULTS } from "@/lib/verified-results";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  applyEspnClocksToFixtures,
  assembleLiveFixtureBase,
  cappedDetailCandidates,
  extractEspnClocks,
  freshSnapshot,
  hasGoalAssistData,
  normalizeWc26Status,
  parseRemainingQuota,
  readThroughTtlCache,
  slimFixturesForLiveList,
  type LeaderboardStat,
  type EspnClock,
  type LiveSnapshot,
  type TimedCache,
  withVerifiedResults,
} from "@/lib/live-fixtures";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STARTS = DATA.starts;
const LEAGUE = process.env.WC_LEAGUE || "1";
const SEASON = process.env.WC_SEASON || "2026";
const PRE = 90 * 60000;
const POST = 6 * 60 * 60000;

// worldcup26.ir — free community API, no auth required
const WC26_URL = "https://worldcup26.ir/get/games";
const WC26_STADIUMS_URL = "https://worldcup26.ir/get/stadiums";
const ESPN_STATS_URL = "https://site.web.api.espn.com/apis/site/v2/sports/soccer/fifa.world/statistics?season=2026&limit=50";
const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

// In-memory, per-serverless-instance snapshot cache. A cold instance still does
// one full vendor fetch, then warm requests reuse the post-merge/post-slim
// response. 20s is invisible to a 30s poller during match windows; 120s avoids
// waste outside windows where scores do not change for hours.
let LAST: LiveSnapshot | null = null;
let STADIUM_CACHE: Record<string, string> | null = null;
const DETAIL_CACHE = new Map<number, { data: VendorFixture; ts: number }>();
let ESPN_LEADER_CACHE: TimedCache<LeaderboardStat[]> | null = null;
let ESPN_CLOCK_CACHE: TimedCache<EspnClock[]> | null = null;
const DETAIL_TTL = 30 * 60 * 1000;
const DETAIL_BATCH_SIZE = 20;
const ESPN_LEADER_TTL = 10 * 60 * 1000;
const ESPN_CLOCK_TTL = 45 * 1000;
const DETAIL_REQUEST_CAP = DETAIL_BATCH_SIZE;
// Paid API-Football tier is ~7,500/day, so preserving the final 500 requests
// leaves room for live match recovery and manual debugging. If the plan is
// downgraded, raise this floor or disable detail enrichment.
const DETAIL_QUOTA_FLOOR = 500;
const LIVE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

function hasRichDetails(fixture: unknown): boolean {
  const f = fixture as {
    events?: unknown[];
    stats?: { home?: Record<string, unknown>; away?: Record<string, unknown> };
    lineups?: unknown[];
    players?: unknown[];
    referee?: string;
    fixtureId?: number | null;
  };
  return !!(
    f.fixtureId ||
    (Array.isArray(f.events) && f.events.length > 0) ||
    (f.stats && (Object.keys(f.stats.home || {}).length > 0 || Object.keys(f.stats.away || {}).length > 0)) ||
    (Array.isArray(f.lineups) && f.lineups.length === 2) ||
    (Array.isArray(f.players) && f.players.length > 0) ||
    f.referee
  );
}

function inWindow(now: number): boolean {
  return STARTS.some(s => now >= s - PRE && now <= s + POST);
}

function activeWindowCount(now: number): number {
  return STARTS.filter(s => now >= s - PRE && now <= s + POST).length;
}

// ── worldcup26.ir integration ──────────────────────────────────────

type WC26Game = {
  id: string;
  home_team_name_en: string;
  away_team_name_en: string;
  home_score: string;
  away_score: string;
  home_penalty_score?: string | number | null;
  away_penalty_score?: string | number | null;
  home_scorers: string;
  away_scorers: string;
  group: string;
  matchday: string;
  local_date: string;
  stadium_id: string;
  finished: string;
  time_elapsed: string;
  type: string;
};

function scoreNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === "null") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Parse scorer strings like {"D. Bobadilla 7'(OG)","F. Balogun 31'","F. Balogun 45'+5'"}
function parseScorers(raw: string, teamName: string): Array<{
  minute: number; extra: number | null; type: "Goal"; detail: string;
  player: string; assist: string | null; team: string;
}> {
  if (!raw || raw === "null" || raw === '""') return [];
  // Strip outer braces and split by ","
  const inner = raw.replace(/^\{/, "").replace(/\}$/, "");
  if (!inner.trim()) return [];
  const entries = inner.split(/",\s*"/).map(s => s.replace(/^"|"$/g, ""));
  return entries.map(entry => {
    const isOG = /\(OG\)/i.test(entry);
    const isPen = /\(pen\.?\)/i.test(entry);
    // Extract minute — patterns like "7'", "45'+5'", "90'+8'", "90+5'"
    const minMatch = entry.match(/(\d+)'?\+(\d+)'/) || entry.match(/(\d+)'/);
    const minute = minMatch ? parseInt(minMatch[1], 10) : 0;
    const extra = minMatch?.[2] ? parseInt(minMatch[2], 10) : null;
    // Player name is everything before the minute number. The wc26 feed
    // frequently sends garbled transliterations ("Jvd Blingham"); normalize
    // through PLAYER_NORM here at the source so every consumer — match
    // drawer, timelines, goal toasts, stats — renders the canonical name.
    const player = canonPlayer(entry.replace(/\s*\d+'?\+?\d*'?(\(.*?\))?$/, "").trim());
    return {
      minute,
      extra,
      type: "Goal" as const,
      detail: isOG ? "Own Goal" : isPen ? "Penalty" : "Normal Goal",
      player,
      assist: null,
      team: teamName,
    };
  }).filter(e => e.player);
}

// Build a lookup from canon'd team pair → schedule match for correct timestamps/venues
const SCHEDULE_BY_PAIR: Map<string, { ts: number; venue: string; round: string }> = new Map();
for (const m of DATA.gs) {
  const key = [canon(m.t1), canon(m.t2)].sort().join("|");
  const v = DATA.venues[m.v];
  SCHEDULE_BY_PAIR.set(key, { ts: m.ts, venue: v?.common || "", round: `Group Stage - ${m.g}` });
}
// KO schedule entries indexed by timestamp for fallback lookup.
// Team pairs aren't known at build time, so we match by date window.
const KO_SCHEDULE_BY_TS: Array<{ ts: number; venue: string; round: string }> = DATA.ko.map(m => ({
  ts: m.ts, venue: DATA.venues[m.v]?.common || "", round: m.round,
}));

function venueNamesMatch(left: string | undefined, right: string | undefined): boolean {
  const a = nrm(left || "");
  const b = nrm(right || "");
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
}

async function fetchStadiumMap(): Promise<Record<string, string>> {
  if (STADIUM_CACHE) return STADIUM_CACHE;
  try {
    const r = await fetch(WC26_STADIUMS_URL, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return {};
    const data = await r.json();
    const map: Record<string, string> = {};
    for (const s of (data.stadiums || [])) {
      map[s.id] = s.name_en || s.fifa_name || "";
    }
    STADIUM_CACHE = map;
    return map;
  } catch {
    return {};
  }
}

// Round label from group + matchday + type
function roundLabel(game: WC26Game): string {
  if (game.type === "group") return `Group Stage - ${game.matchday}`;
  const labels: Record<string, string> = {
    r32: "Round of 32", r16: "Round of 16",
    qf: "Quarter-finals", sf: "Semi-finals",
    third: "Third-place", final: "Final",
  };
  return labels[game.type] || game.type;
}

async function fetchWC26(): Promise<{ ok: boolean; fixtures: unknown[] }> {
  const [gamesRes, stadiums] = await Promise.all([
    fetch(WC26_URL, { cache: "no-store", signal: AbortSignal.timeout(8000) }),
    fetchStadiumMap(),
  ]);
  if (!gamesRes.ok) return { ok: false, fixtures: [] };
  const data = await gamesRes.json();
  const games: WC26Game[] = data.games || [];

  // Only include matches that have kicked off or finished
  const active = games.filter(g => g.finished === "TRUE" || g.time_elapsed !== "notstarted");

  const fixtures = active.map(g => {
    const { status, elapsed } = normalizeWc26Status(g.time_elapsed, g.finished);
    const homeEvents = parseScorers(g.home_scorers, g.home_team_name_en);
    const awayEvents = parseScorers(g.away_scorers, g.away_team_name_en);
    const events = [...homeEvents, ...awayEvents].sort((a, b) => {
      const aMin = a.minute + (a.extra || 0) * 0.01;
      const bMin = b.minute + (b.extra || 0) * 0.01;
      return aMin - bMin;
    });

    // Look up correct timestamp and venue from our schedule using team pair.
    // Group stage matches are keyed by team pair; KO matches aren't (teams
    // aren't known at build time), so fall back to wc26's own date field
    // and try to find the closest KO schedule slot.
    const pairKey = [canon(g.home_team_name_en), canon(g.away_team_name_en)].sort().join("|");
    let scheduled = SCHEDULE_BY_PAIR.get(pairKey);
    const stadiumName = stadiums[g.stadium_id] || "";
    if (!scheduled && g.type !== "group" && g.local_date) {
      const wc26Ts = Date.parse(g.local_date);
      if (wc26Ts > 0) {
        const candidates = KO_SCHEDULE_BY_TS.filter(k => Math.abs(k.ts - wc26Ts) < 12 * 3600000 && k.round === roundLabel(g));
        const koMatch = candidates.find(k => venueNamesMatch(k.venue, stadiumName)) || candidates[0];
        if (koMatch) scheduled = koMatch;
      }
    }

    return {
      ts: scheduled?.ts || (g.local_date ? Date.parse(g.local_date) || 0 : 0),
      status,
      elapsed,
      venue: scheduled?.venue || stadiumName,
      round: scheduled?.round || roundLabel(g),
      home: g.home_team_name_en,
      away: g.away_team_name_en,
      gh: scoreNumber(g.home_score),
      ga: scoreNumber(g.away_score),
      penHome: scoreNumber(g.home_penalty_score),
      penAway: scoreNumber(g.away_penalty_score),
      events: events.length ? events : undefined,
      assistDataMissing: events.some(ev => ev.type === "Goal" && ev.detail !== "Own Goal") && !hasGoalAssistData(events),
    };
  });

  // Deduplicate: wc26 can return the same match multiple times (e.g. R32
  // fixtures appear under different matchday IDs). Keep the entry with the
  // most event data and a valid timestamp.
  const deduped: typeof fixtures = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    const key = [canon(f.home), canon(f.away)].sort().join("|");
    if (seen.has(key)) {
      const prevIdx = seen.get(key)!;
      const prev = deduped[prevIdx];
      const prevScore = (prev.ts > 0 ? 100 : 0) + (prev.events?.length || 0);
      const currScore = (f.ts > 0 ? 100 : 0) + (f.events?.length || 0);
      if (currScore > prevScore) deduped[prevIdx] = f;
    } else {
      seen.set(key, deduped.length);
      deduped.push(f);
    }
  }

  return { ok: true, fixtures: deduped };
}

// ── API-Football (legacy vendor) ───────────────────────────────────

interface FixtureResponse {
  ok: boolean;
  http?: number;
  errors?: unknown;
  fixtures?: unknown[];
  quota?: { limit: string | null; remaining: string | null };
}

type VendorStat = { type?: string; value?: string | number | null };
type VendorPlayer = {
  player?: { id?: number; name?: string; number?: number; pos?: string; grid?: string | null; photo?: string | null; image?: string | null };
  statistics?: Array<{
    games?: { minutes?: number | null; rating?: string | number | null };
    goals?: { total?: number; assists?: number; saves?: number };
    shots?: { total?: number; on?: number };
    passes?: { total?: number; accuracy?: string | number | null };
    tackles?: { total?: number };
    duels?: { total?: number; won?: number };
    dribbles?: { attempts?: number; success?: number };
    fouls?: { drawn?: number; committed?: number };
    cards?: { yellow?: number; red?: number };
  }>;
};
type VendorFixture = {
  fixture?: { date?: string; status?: { short?: string; elapsed?: number }; venue?: { name?: string }; id?: number; referee?: string | null };
  league?: { round?: string };
  teams?: { home?: { name?: string }; away?: { name?: string } };
  goals?: { home?: number | null; away?: number | null };
  score?: { penalty?: { home?: number | null; away?: number | null } };
  events?: Array<{
    time?: { elapsed?: number; extra?: number | null };
    type?: string;
    detail?: string;
    player?: { name?: string };
    assist?: { name?: string | null };
    team?: { name?: string };
  }>;
  statistics?: Array<{ statistics?: VendorStat[] }>;
  lineups?: Array<{
    team?: { name?: string };
    formation?: string;
    startXI?: VendorPlayer[];
    substitutes?: VendorPlayer[];
  }>;
  players?: Array<{ team?: { name?: string }; players?: VendorPlayer[] }>;
};
function vendorEventType(type: string | undefined): MatchEvent["type"] {
  if (type === "Goal" || type === "Card" || type === "subst" || type === "Var") return type;
  if (/sub/i.test(type || "")) return "subst";
  if (/card/i.test(type || "")) return "Card";
  if (/var/i.test(type || "")) return "Var";
  return "Goal";
}

function mapVendorEvents(f: VendorFixture): MatchEvent[] {
  /* Names normalize through PLAYER_NORM at the source (see parseScorers)
     so abbreviated or transliterated vendor names never reach the UI. */
  return (f.events || []).map((e) => ({
    minute: e.time?.elapsed ?? 0,
    extra: e.time?.extra ?? null,
    type: vendorEventType(e.type),
    detail: e.detail || "",
    player: canonPlayer(e.player?.name ?? ""),
    assist: e.assist?.name ? canonPlayer(e.assist.name) : null,
    team: e.team?.name ?? "",
  }));
}

function mapVendorStats(f: VendorFixture) {
  const rawStats = f.statistics || [];
  const parseStats = (arr: VendorStat[]) => {
    const out: Record<string, string | number | null> = {};
    for (const s of arr) {
      if (s.type) out[s.type] = s.value ?? null;
    }
    return out;
  };
  return rawStats.length === 2
    ? { home: parseStats(rawStats[0]?.statistics || []), away: parseStats(rawStats[1]?.statistics || []) }
    : undefined;
}

function mapVendorLineups(f: VendorFixture) {
  const rawLineups = f.lineups || [];
  return rawLineups.length === 2
    ? rawLineups.map((l) => ({
      team: l.team?.name ?? "",
      formation: l.formation ?? "",
      startXI: (l.startXI || []).map((p) => ({
        name: p.player?.name ?? "", number: p.player?.number ?? 0,
        pos: p.player?.pos ?? "", grid: p.player?.grid ?? null,
        imageUrl: p.player?.photo ?? p.player?.image ?? null,
        headshotUrl: p.player?.photo ?? null,
      })),
      substitutes: (l.substitutes || []).map((p) => ({
        name: p.player?.name ?? "", number: p.player?.number ?? 0,
        pos: p.player?.pos ?? "", grid: p.player?.grid ?? null,
        imageUrl: p.player?.photo ?? p.player?.image ?? null,
        headshotUrl: p.player?.photo ?? null,
      })),
    }))
    : undefined;
}

function mapVendorPlayers(f: VendorFixture) {
  const rawPlayers = f.players || [];
  return rawPlayers.length
    ? rawPlayers.flatMap((t) => {
      const teamName = t.team?.name ?? "";
      return (t.players || []).map((p) => {
        const s = p.statistics?.[0] || {};
        return {
          id: p.player?.id ?? null, name: p.player?.name ?? "", number: p.player?.number ?? 0, team: teamName,
          imageUrl: p.player?.photo ?? p.player?.image ?? null,
          headshotUrl: p.player?.photo ?? null,
          minutes: s.games?.minutes ?? null, rating: s.games?.rating ?? null,
          goals: s.goals?.total ?? 0, assists: s.goals?.assists ?? 0,
          shots: s.shots?.total ?? 0, shotsOn: s.shots?.on ?? 0,
          passes: s.passes?.total ?? 0, passAccuracy: s.passes?.accuracy ? `${s.passes.accuracy}%` : null,
          tackles: s.tackles?.total ?? 0,
          duels: s.duels?.total ?? 0, duelsWon: s.duels?.won ?? 0,
          dribbles: s.dribbles?.attempts ?? 0, dribblesSuccess: s.dribbles?.success ?? 0,
          foulsDrawn: s.fouls?.drawn ?? 0, foulsCommitted: s.fouls?.committed ?? 0,
          yellowCards: s.cards?.yellow ?? 0, redCards: s.cards?.red ?? 0,
          saves: s.goals?.saves ?? 0,
        };
      });
    })
    : undefined;
}

function countPlayerStatSignals(players: unknown): number {
  if (!Array.isArray(players)) return 0;
  return players.reduce((sum, player) => {
    const assists = typeof player?.assists === "number" ? player.assists : 0;
    const yellows = typeof player?.yellowCards === "number" ? player.yellowCards : 0;
    const reds = typeof player?.redCards === "number" ? player.redCards : 0;
    return sum + Math.max(0, assists) + Math.max(0, yellows) + Math.max(0, reds);
  }, 0);
}

function chooseRicherPlayers(incoming: unknown, existing: unknown): unknown {
  if (!Array.isArray(incoming) || incoming.length === 0) return existing;
  if (!Array.isArray(existing) || existing.length === 0) return incoming;
  const incomingScore = countPlayerStatSignals(incoming);
  const existingScore = countPlayerStatSignals(existing);
  if (existingScore > incomingScore) return existing;
  if (incomingScore > existingScore) return incoming;
  return existing.length > incoming.length ? existing : incoming;
}

function countGoalAssists(events: unknown): number {
  if (!Array.isArray(events)) return 0;
  return events.filter((event) => (
    event?.type === "Goal" &&
    event?.detail !== "Own Goal" &&
    typeof event?.assist === "string" &&
    event.assist.trim().length > 0
  )).length;
}

function chooseRicherEvents(incoming: unknown, existing: unknown): unknown {
  if (!Array.isArray(incoming) || incoming.length === 0) return existing;
  if (!Array.isArray(existing) || existing.length === 0) return incoming;
  return countGoalAssists(existing) > countGoalAssists(incoming) ? existing : incoming;
}

function normalizeVendorFixture(f: VendorFixture) {
  const events = mapVendorEvents(f);
  const stats = mapVendorStats(f);
  const lineups = mapVendorLineups(f);
  const players = mapVendorPlayers(f);
  const ts = Date.parse(f.fixture?.date ?? "");
  const status = f.fixture?.status?.short;
  return {
    ts,
    status,
    elapsed: f.fixture?.status?.elapsed ?? null,
    venue: f.fixture?.venue?.name,
    round: f.league?.round,
    home: f.teams?.home?.name,
    away: f.teams?.away?.name,
    gh: f.goals?.home ?? null,
    ga: f.goals?.away ?? null,
    penHome: f.score?.penalty?.home ?? null,
    penAway: f.score?.penalty?.away ?? null,
    fixtureId: f.fixture?.id ?? null,
    events: events.length ? events : undefined,
    stats,
    lineups,
    players: players?.length ? players : undefined,
    referee: f.fixture?.referee ?? undefined,
  };
}

async function fetchFixtures(key: string): Promise<FixtureResponse> {
  let url = `https://v3.football.api-sports.io/fixtures?league=${LEAGUE}&season=${SEASON}`;
  let r = await fetch(url, { cache: "no-store", headers: { "x-apisports-key": key }, signal: AbortSignal.timeout(8000) });
  let body = await r.json().catch(() => ({}));
  if (r.ok && (!body.response || body.response.length === 0)) {
    const today = new Date().toISOString().slice(0, 10);
    url = `https://v3.football.api-sports.io/fixtures?date=${today}&league=${LEAGUE}`;
    r = await fetch(url, { cache: "no-store", headers: { "x-apisports-key": key }, signal: AbortSignal.timeout(8000) });
    body = await r.json().catch(() => ({}));
  }
  const quota = {
    limit: r.headers.get("x-ratelimit-requests-limit"),
    remaining: r.headers.get("x-ratelimit-requests-remaining"),
  };
  if (!r.ok || body.errors?.access) return { ok: false, http: r.status, errors: body.errors || null, quota };
  const fixtures = ((body.response || []) as VendorFixture[]).map(normalizeVendorFixture);
  return { ok: true, fixtures, quota };
}

async function fetchFixtureDetail(key: string, fixtureId: number): Promise<VendorFixture | null> {
  const cached = DETAIL_CACHE.get(fixtureId);
  if (cached && Date.now() - cached.ts < DETAIL_TTL) return cached.data;
  try {
    const r = await fetch(`https://v3.football.api-sports.io/fixtures?id=${fixtureId}`, {
      cache: "no-store",
      headers: { "x-apisports-key": key },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const body = await r.json().catch(() => ({}));
    const fixture = (body.response || [])[0] as VendorFixture | undefined;
    if (!fixture) return null;
    DETAIL_CACHE.set(fixtureId, { data: fixture, ts: Date.now() });
    return fixture;
  } catch {
    return null;
  }
}

async function fetchEspnLeaderStats(): Promise<LeaderboardStat[]> {
  const now = Date.now();
  const result = await readThroughTtlCache(ESPN_LEADER_CACHE, now, ESPN_LEADER_TTL, async () => {
    const res = await fetch(ESPN_STATS_URL, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "CompetTracker/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`ESPN leaders returned ${res.status}`);
    const data = await res.json().catch(() => ({}));
    const leaders = new Map<string, LeaderboardStat>();
    const ensure = (name: string, team: string) => {
      const key = `${canonPlayer(name)}|${canon(team)}`;
      const existing = leaders.get(key) || { name: canonPlayer(name), team: canon(team) };
      leaders.set(key, existing);
      return existing;
    };

    for (const category of data?.stats || []) {
      const field = category?.name === "goalsLeaders"
        ? "goals"
        : category?.name === "assistsLeaders"
          ? "assists"
          : null;
      if (!field) continue;
      for (const entry of category.leaders || []) {
        const athlete = entry.athlete || {};
        const name = athlete.displayName || athlete.shortName || "";
        const team = athlete.team?.displayName || athlete.team?.name || "";
        const value = Math.round(entry.value || 0);
        if (!name || !team || value <= 0) continue;
        const leader = ensure(name, team);
        const headshot =
          athlete.headshot?.href ||
          athlete.headshot ||
          athlete.image?.href ||
          athlete.image ||
          null;
        if (typeof headshot === "string" && headshot) {
          leader.headshotUrl ||= headshot;
          leader.imageUrl ||= headshot;
        }
        leader[field] = Math.max(leader[field] || 0, value);
        const appearances = (athlete.statistics || []).find((s: { name?: string }) => s.name === "appearances");
        if (appearances?.value) leader.matches = Math.max(leader.matches || 0, Math.round(appearances.value));
      }
    }

    const next = [...leaders.values()];
    return next;
  }, []);
  ESPN_LEADER_CACHE = result.cache;
  return result.data;
}

async function fetchEspnClockFeed(): Promise<EspnClock[]> {
  const now = Date.now();
  const result = await readThroughTtlCache(ESPN_CLOCK_CACHE, now, ESPN_CLOCK_TTL, async () => {
    const res = await fetch(ESPN_SCOREBOARD_URL, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "CompetTracker/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`ESPN scoreboard returned ${res.status}`);
    const data = await res.json().catch(() => ({}));
    return extractEspnClocks(data);
  }, []);
  ESPN_CLOCK_CACHE = result.cache;
  return result.data;
}

function needsEspnClock(fixtures: unknown[]): boolean {
  return fixtures.some(fixture => {
    const f = fixture as { status?: string; elapsed?: unknown };
    return f.status === "LIVE" || (["1H", "2H", "ET", "BT", "P"].includes(f.status || "") && typeof f.elapsed !== "number");
  });
}

function sourceRoundCounts(fixtures: unknown[] = []): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const fixture of fixtures) {
    const round = String((fixture as { round?: unknown }).round || "Unknown");
    counts[round] = (counts[round] || 0) + 1;
  }
  return counts;
}

function needsFixtureDetail(fixture: unknown): boolean {
  const f = fixture as { fixtureId?: number | null; status?: string; players?: unknown[] };
  if (!f.fixtureId || !DONE_STATUSES.has(f.status || "")) return false;
  if (Array.isArray(f.players) && f.players.length > 0) return false;
  // The season list endpoint often includes events but omits player arrays.
  // Per-fixture detail is required for reliable assist totals.
  return true;
}

async function enrichWithFixtureDetails(key: string, fixtures: unknown[], remaining?: string | null): Promise<{ requested: number; enriched: number; skipped: boolean }> {
  const quotaRemaining = parseRemainingQuota(remaining);
  if (quotaRemaining < DETAIL_QUOTA_FLOOR) {
    return { requested: 0, enriched: 0, skipped: true };
  }

  const { selected: needsDetail, deferred } = cappedDetailCandidates(fixtures, needsFixtureDetail, DETAIL_REQUEST_CAP);
  if (deferred > 0 && process.env.NODE_ENV !== "production") {
    console.info(`[live] deferred ${deferred} fixture detail requests after cap ${DETAIL_REQUEST_CAP}`);
  }
  let enriched = 0;
  for (let i = 0; i < needsDetail.length; i += DETAIL_BATCH_SIZE) {
    const batch = needsDetail.slice(i, i + DETAIL_BATCH_SIZE);
    const details = await Promise.all(batch.map(f => {
      const fixtureId = (f as { fixtureId: number }).fixtureId;
      return fetchFixtureDetail(key, fixtureId);
    }));

    details.forEach((detail, index) => {
      if (!detail) return;
      const normalized = normalizeVendorFixture(detail);
      const target = batch[index] as Record<string, unknown>;
      if (normalized.events?.some(ev => ev.type === "Goal" && !!ev.assist)) {
        target.events = normalized.events;
        target.assistDataMissing = false;
      }
      if (normalized.players?.length) target.players = normalized.players;
      if (normalized.stats) target.stats = normalized.stats;
      if (normalized.lineups?.length) target.lineups = normalized.lineups;
      if (normalized.referee) target.referee = normalized.referee;
      enriched++;
    });
  }
  return { requested: needsDetail.length, enriched, skipped: false };
}

// ── Opportunistic DB persistence ──────────────────────────────────
// Writes finished match results to the DB so the ISR-rendered page
// shows scores even when the live feed is idle.

const DONE_STATUSES = new Set(["FT", "AET", "PEN", "WO", "AWD"]);

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value == null
    ? undefined
    : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function persistFinished(fixtures: unknown[]): Promise<number> {
  const finished = fixtures.filter(f => {
    const fix = f as { status?: string; gh?: number | null; ga?: number | null };
    return DONE_STATUSES.has(fix.status || "") && fix.gh != null && fix.ga != null;
  }) as MergeVendorFixture[];
  if (!finished.length) return 0;

  type PersistableScheduleMatch = ScheduleMatch & {
    state?: {
      events: Prisma.JsonValue | null;
      stats: Prisma.JsonValue | null;
      lineups: Prisma.JsonValue | null;
      players: Prisma.JsonValue | null;
      referee: string | null;
    } | null;
  };
  let scheduleMatches: PersistableScheduleMatch[];
  try {
    const rows = await prisma.match.findMany({
      include: { homeTeam: true, awayTeam: true, venue: true, state: true },
      orderBy: { matchNumber: "asc" },
    });
    scheduleMatches = rows.map(m => ({
      id: m.id,
      matchNumber: m.matchNumber,
      kickoffTs: new Date(m.kickoffUtc).getTime(),
      venueCommon: m.venue.commonName,
      homeTeam: m.homeTeam?.name || null,
      awayTeam: m.awayTeam?.name || null,
      state: m.state,
    }));
  } catch {
    return 0;
  }

  const merged = mergeFixtures(scheduleMatches, finished);
  let written = 0;

  for (const { match, fixture } of merged) {
    const state = (match as PersistableScheduleMatch).state;
    const events = chooseRicherEvents(fixture.events, state?.events);
    const players = chooseRicherPlayers(fixture.players, state?.players);
    const stats = fixture.stats || state?.stats;
    const lineups = fixture.lineups || state?.lineups;
    const referee = fixture.referee || state?.referee || undefined;
    try {
      await prisma.matchState.upsert({
        where: { matchId: match.id },
        update: {
          status: fixture.status as string,
          elapsed: typeof fixture.elapsed === "number" ? fixture.elapsed : 90,
          homeGoals: typeof fixture.gh === "number" ? fixture.gh : null,
          awayGoals: typeof fixture.ga === "number" ? fixture.ga : null,
          events: toJson(events),
          stats: toJson(stats),
          lineups: toJson(lineups),
          players: toJson(players),
          referee,
          updatedAt: new Date(),
        },
        create: {
          matchId: match.id,
          status: fixture.status as string,
          elapsed: typeof fixture.elapsed === "number" ? fixture.elapsed : 90,
          homeGoals: typeof fixture.gh === "number" ? fixture.gh : null,
          awayGoals: typeof fixture.ga === "number" ? fixture.ga : null,
          events: toJson(events),
          stats: toJson(stats),
          lineups: toJson(lineups),
          players: toJson(players),
          referee,
        },
      });
      written++;
    } catch {
      // Non-critical — don't fail the live response
    }
  }
  return written;
}

// ── Route handler ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const apiFootballKey = process.env.APIFOOTBALL_KEY;
  const now = Date.now();
  /* Debug mode runs the full vendor fetch + detail enrichment on demand, so
     it requires the cron secret — otherwise anyone could loop it to burn
     API-Football quota. Fail-closed like the cron routes. */
  const debugRequested = request.nextUrl.searchParams.has("debug");
  const bearer = request.headers.get("authorization")?.replace("Bearer ", "");
  const cronSecret = process.env.CRON_SECRET;
  const debug = debugRequested && !!cronSecret && bearer === cronSecret;
  if (debugRequested && !debug) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const active = inWindow(now);
  const activeMatches = activeWindowCount(now);
  const snapshot = freshSnapshot(LAST, now, active);
  if (snapshot && !debug) {
    return NextResponse.json(
      { ...snapshot.response, servedFrom: "snapshot" },
      { headers: LIVE_RESPONSE_HEADERS }
    );
  }

  if (debug) {
    const [wc26, leaderboardStats] = await Promise.all([
      fetchWC26().catch(() => ({ ok: false, fixtures: [] })),
      fetchEspnLeaderStats(),
    ]);
    const apif = apiFootballKey
      ? await fetchFixtures(apiFootballKey).catch(e => ({ ok: false, http: 0, errors: String(e) } as FixtureResponse))
      : null;
    const debugBase = apif?.fixtures?.length ? [...apif.fixtures] : (wc26.ok ? [...wc26.fixtures] : []);
    const debugClockEnrichment = active && needsEspnClock(debugBase)
      ? await fetchEspnClockFeed().then(clocks => ({ clocks: clocks.length, applied: applyEspnClocksToFixtures(debugBase, clocks) })).catch(() => ({ clocks: 0, applied: 0 }))
      : { clocks: 0, applied: 0 };
    const detailEnrichment = apiFootballKey && debugBase.length
      ? await enrichWithFixtureDetails(apiFootballKey, debugBase, apif?.quota?.remaining)
      : { requested: 0, enriched: 0, skipped: !apiFootballKey };
    const merged = withVerifiedResults(debugBase);
    const richFixtureCount = (apif?.fixtures || []).filter(hasRichDetails).length;
    return NextResponse.json({
      configured: !!apiFootballKey,
      active, ts: now,
      wc26: { ok: wc26.ok, fixtureCount: wc26.fixtures.length, roundCounts: sourceRoundCounts(wc26.fixtures) },
      apiFootball: apif ? { ok: apif.ok, fixtureCount: apif.fixtures?.length ?? 0, richFixtureCount, quota: apif.quota, roundCounts: sourceRoundCounts(apif.fixtures || []) } : "not configured",
      enrichment: {
        required: true,
        healthy: !!(apiFootballKey && apif?.ok && (apif.fixtures?.length ?? 0) > 0),
        activeMatches,
        source: apif?.ok && (apif.fixtures?.length ?? 0) > 0 ? "api-football" : "missing",
        richFixtureCount,
        clockEnrichment: debugClockEnrichment,
        detailEnrichment,
      },
      verifiedCount: VERIFIED_RESULTS.length,
      mergedCount: merged.length,
      mergedRoundCounts: sourceRoundCounts(merged),
      leaderboardStats,
      source: apif?.ok && (apif.fixtures?.length ?? 0) > 0 ? "api-football+wc26" : wc26.ok ? "wc26" : "verified-only",
      sample: merged.slice(0, 3),
    }, { headers: LIVE_RESPONSE_HEADERS });
  }

  // Fetch from worldcup26.ir (primary) and optionally API-Football (enrichment)
  const [wc26, leaderboardStats] = await Promise.all([
    fetchWC26().catch(() => ({ ok: false, fixtures: [] as unknown[] })),
    fetchEspnLeaderStats(),
  ]);

  let apif: FixtureResponse | null = null;
  let apifFixtures: unknown[] = [];
  if (apiFootballKey) {
    apif = await fetchFixtures(apiFootballKey).catch(() => ({ ok: false, fixtures: [] } as FixtureResponse));
    if (apif.ok && apif.fixtures && apif.fixtures.length > 0) apifFixtures = apif.fixtures;
  }
  const richFixtureCount = apifFixtures.filter(hasRichDetails).length;
  const enrichment: {
    required: boolean;
    healthy: boolean;
    activeMatches: number;
    source: string;
    richFixtureCount: number;
    apiFootballConfigured: boolean;
    apiFootballOk: boolean;
    quota: FixtureResponse["quota"] | undefined;
    clockEnrichment?: { clocks: number; applied: number };
    detailEnrichment?: { requested: number; enriched: number; skipped: boolean };
  } = {
    required: true,
    healthy: !!(apiFootballKey && apif?.ok && apifFixtures.length > 0),
    activeMatches,
    source: apifFixtures.length > 0 ? "api-football" : wc26.ok ? "basic-fallback" : "none",
    richFixtureCount,
    apiFootballConfigured: !!apiFootballKey,
    apiFootballOk: !!apif?.ok,
    quota: apif?.quota,
  };

  const base = assembleLiveFixtureBase(apifFixtures, wc26.fixtures, wc26.ok);
  const clockEnrichment = active && needsEspnClock(base)
    ? await fetchEspnClockFeed().then(clocks => ({ clocks: clocks.length, applied: applyEspnClocksToFixtures(base, clocks) })).catch(() => ({ clocks: 0, applied: 0 }))
    : { clocks: 0, applied: 0 };
  enrichment.clockEnrichment = clockEnrichment;

  const detailEnrichment = apiFootballKey && base.length > 0
    ? await enrichWithFixtureDetails(apiFootballKey, base, apif?.quota?.remaining)
    : { requested: 0, enriched: 0, skipped: !apiFootballKey };
  enrichment.detailEnrichment = detailEnrichment;

  const fixtures = withVerifiedResults(base);
  const listFixtures = slimFixturesForLiveList(fixtures);
  const hasLiveData = wc26.ok || apifFixtures.length > 0;

  // Opportunistically persist finished results to DB so ISR pages show scores.
  // Only persist vendor-sourced fixtures, not verified results — verified data
  // is manually curated and may be added before a match truly finishes.
  if (base.length > 0) {
    persistFinished(base).catch(() => {});
  }

  if (!active && !hasLiveData) {
    const response = {
      configured: !!apiFootballKey,
      active: false,
      ts: now,
      fixtures: listFixtures,
      source: "verified-only",
      enrichment,
      leaderboardStats,
    };
    LAST = { response, ts: now };
    return NextResponse.json({ ...response, servedFrom: "fresh" }, { headers: LIVE_RESPONSE_HEADERS });
  }

  const response = {
    configured: !!apiFootballKey,
    active,
    ts: now,
    fixtures: listFixtures,
    source: apifFixtures.length > 0 ? "api-football+wc26" : wc26.ok ? "wc26" : "verified-only",
    enrichment,
    leaderboardStats,
  };
  LAST = { response, ts: now };

  return NextResponse.json({ ...response, servedFrom: "fresh" }, { headers: LIVE_RESPONSE_HEADERS });
}

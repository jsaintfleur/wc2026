import { NextRequest, NextResponse } from "next/server";
import { DATA } from "@/lib/data";
import { canon } from "@/lib/merge";
import { VERIFIED_RESULTS } from "@/lib/verified-results";

const STARTS = DATA.starts;
const LIVE_TTL = parseInt(process.env.LIVE_TTL || "420", 10);
const IDLE_TTL = parseInt(process.env.IDLE_TTL || "1800", 10);
const LEAGUE = process.env.WC_LEAGUE || "1";
const SEASON = process.env.WC_SEASON || "2026";
const PRE = 15 * 60000;
const POST = 155 * 60000;

// worldcup26.ir — free community API, no auth required
const WC26_URL = "https://worldcup26.ir/get/games";
const WC26_STADIUMS_URL = "https://worldcup26.ir/get/stadiums";

let LAST: { fixtures: unknown[]; ts: number } | null = null;
let STADIUM_CACHE: Record<string, string> | null = null;

function sameFixture(a: unknown, b: unknown): boolean {
  const left = a as { ts?: number; home?: string; away?: string };
  const right = b as { ts?: number; home?: string; away?: string };
  const dt = Math.abs((left.ts || 0) - (right.ts || 0));
  if (dt > 75 * 60000) return false;
  const lh = canon(left.home || "");
  const la = canon(left.away || "");
  const rh = canon(right.home || "");
  const ra = canon(right.away || "");
  return (lh === rh && la === ra) || (lh === ra && la === rh);
}

function withVerifiedResults(fixtures: unknown[] = []): unknown[] {
  // Verified results are manually confirmed and have richer data (full names, assists).
  // They replace any matching fixture from other sources.
  const merged: unknown[] = [];
  for (const f of fixtures) {
    const verifiedMatch = VERIFIED_RESULTS.find(v => sameFixture(f, v));
    merged.push(verifiedMatch || f);
  }
  // Add any verified results not covered by the fixture list
  for (const v of VERIFIED_RESULTS) {
    if (!merged.some(f => sameFixture(f, v))) merged.push(v);
  }
  return merged;
}

function inWindow(now: number): boolean {
  return STARTS.some(s => now >= s - PRE && now <= s + POST);
}

// ── worldcup26.ir integration ──────────────────────────────────────

type WC26Game = {
  id: string;
  home_team_name_en: string;
  away_team_name_en: string;
  home_score: string;
  away_score: string;
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
    // Extract minute — patterns like "7'", "45'+5'", "90'+8'"
    const minMatch = entry.match(/(\d+)'\+?(\d+)?'?/);
    const minute = minMatch ? parseInt(minMatch[1], 10) : 0;
    const extra = minMatch?.[2] ? parseInt(minMatch[2], 10) : null;
    // Player name is everything before the minute
    const player = entry.replace(/\s*\d+'.*$/, "").trim();
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

// Map worldcup26.ir time_elapsed to our status codes
function mapStatus(timeElapsed: string, finished: string): { status: string; elapsed: number | null } {
  if (finished === "TRUE") return { status: "FT", elapsed: 90 };
  switch (timeElapsed) {
    case "finished": return { status: "FT", elapsed: 90 };
    case "halftime": return { status: "HT", elapsed: 45 };
    case "notstarted": return { status: "NS", elapsed: null };
    default: {
      // During live play, time_elapsed may be a minute number like "34" or "67"
      const min = parseInt(timeElapsed, 10);
      if (!isNaN(min)) {
        if (min <= 45) return { status: "1H", elapsed: min };
        if (min <= 90) return { status: "2H", elapsed: min };
        return { status: "ET", elapsed: min };
      }
      return { status: "NS", elapsed: null };
    }
  }
}

// Build a lookup from canon'd team pair → schedule match for correct timestamps/venues
const SCHEDULE_BY_PAIR: Map<string, { ts: number; venue: string; round: string }> = new Map();
for (const m of DATA.gs) {
  const key = [canon(m.t1), canon(m.t2)].sort().join("|");
  const v = DATA.venues[m.v];
  SCHEDULE_BY_PAIR.set(key, { ts: m.ts, venue: v?.common || "", round: `Group Stage - ${m.g}` });
}
for (const m of DATA.ko) {
  SCHEDULE_BY_PAIR.set(m.mr, { ts: m.ts, venue: DATA.venues[m.v]?.common || "", round: m.round });
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
    fetch(WC26_URL, { signal: AbortSignal.timeout(8000) }),
    fetchStadiumMap(),
  ]);
  if (!gamesRes.ok) return { ok: false, fixtures: [] };
  const data = await gamesRes.json();
  const games: WC26Game[] = data.games || [];

  // Only include matches that have kicked off or finished
  const active = games.filter(g => g.finished === "TRUE" || g.time_elapsed !== "notstarted");

  const fixtures = active.map(g => {
    const { status, elapsed } = mapStatus(g.time_elapsed, g.finished);
    const homeEvents = parseScorers(g.home_scorers, g.home_team_name_en);
    const awayEvents = parseScorers(g.away_scorers, g.away_team_name_en);
    const events = [...homeEvents, ...awayEvents].sort((a, b) => {
      const aMin = a.minute + (a.extra || 0) * 0.01;
      const bMin = b.minute + (b.extra || 0) * 0.01;
      return aMin - bMin;
    });

    // Look up correct timestamp and venue from our schedule using team pair
    const pairKey = [canon(g.home_team_name_en), canon(g.away_team_name_en)].sort().join("|");
    const scheduled = SCHEDULE_BY_PAIR.get(pairKey);

    return {
      ts: scheduled?.ts || 0,
      status,
      elapsed,
      venue: scheduled?.venue || stadiums[g.stadium_id] || "",
      round: scheduled?.round || roundLabel(g),
      home: g.home_team_name_en,
      away: g.away_team_name_en,
      gh: parseInt(g.home_score, 10) || 0,
      ga: parseInt(g.away_score, 10) || 0,
      events: events.length ? events : undefined,
    };
  });

  return { ok: true, fixtures };
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
  player?: { name?: string; number?: number; pos?: string; grid?: string | null };
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

async function fetchFixtures(key: string): Promise<FixtureResponse> {
  let url = `https://v3.football.api-sports.io/fixtures?league=${LEAGUE}&season=${SEASON}`;
  let r = await fetch(url, { headers: { "x-apisports-key": key } });
  let body = await r.json().catch(() => ({}));
  if (r.ok && (!body.response || body.response.length === 0)) {
    const today = new Date().toISOString().slice(0, 10);
    url = `https://v3.football.api-sports.io/fixtures?date=${today}&league=${LEAGUE}`;
    r = await fetch(url, { headers: { "x-apisports-key": key } });
    body = await r.json().catch(() => ({}));
  }
  const quota = {
    limit: r.headers.get("x-ratelimit-requests-limit"),
    remaining: r.headers.get("x-ratelimit-requests-remaining"),
  };
  if (!r.ok) return { ok: false, http: r.status, errors: body.errors || null, quota };
  const fixtures = ((body.response || []) as VendorFixture[]).map((f) => {
    const events = (f.events || []).map((e) => ({
      minute: e.time?.elapsed ?? 0,
      extra: e.time?.extra ?? null,
      type: e.type,
      detail: e.detail,
      player: e.player?.name ?? "",
      assist: e.assist?.name ?? null,
      team: e.team?.name ?? "",
    }));
    const rawStats = f.statistics || [];
    const parseStats = (arr: VendorStat[]) => {
      const out: Record<string, string | number | null> = {};
      for (const s of arr) {
        if (s.type) out[s.type] = s.value ?? null;
      }
      return out;
    };
    const stats = rawStats.length === 2
      ? { home: parseStats(rawStats[0]?.statistics || []), away: parseStats(rawStats[1]?.statistics || []) }
      : undefined;
    const rawLineups = f.lineups || [];
    const lineups = rawLineups.length === 2
      ? rawLineups.map((l) => ({
        team: l.team?.name ?? "",
        formation: l.formation ?? "",
        startXI: (l.startXI || []).map((p) => ({
          name: p.player?.name ?? "", number: p.player?.number ?? 0,
          pos: p.player?.pos ?? "", grid: p.player?.grid ?? null,
        })),
        substitutes: (l.substitutes || []).map((p) => ({
          name: p.player?.name ?? "", number: p.player?.number ?? 0,
          pos: p.player?.pos ?? "", grid: p.player?.grid ?? null,
        })),
      }))
      : undefined;

    const rawPlayers = f.players || [];
    const players = rawPlayers.length
      ? rawPlayers.flatMap((t) => {
        const teamName = t.team?.name ?? "";
        return (t.players || []).map((p) => {
          const s = p.statistics?.[0] || {};
          return {
            name: p.player?.name ?? "", number: p.player?.number ?? 0, team: teamName,
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

    const referee = f.fixture?.referee ?? undefined;

    return {
      ts: Date.parse(f.fixture?.date ?? ""),
      status: f.fixture?.status?.short,
      elapsed: f.fixture?.status?.elapsed,
      venue: f.fixture?.venue?.name,
      round: f.league?.round,
      home: f.teams?.home?.name,
      away: f.teams?.away?.name,
      gh: f.goals?.home ?? null,
      ga: f.goals?.away ?? null,
      fixtureId: f.fixture?.id ?? null,
      events: events.length ? events : undefined,
      stats,
      lineups,
      players: players?.length ? players : undefined,
      referee,
    };
  });
  return { ok: true, fixtures, quota };
}

// ── Route handler ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const apiFootballKey = process.env.APIFOOTBALL_KEY;
  const now = Date.now();
  const debug = request.nextUrl.searchParams.has("debug");
  const active = inWindow(now);

  if (debug) {
    const wc26 = await fetchWC26().catch(() => ({ ok: false, fixtures: [] }));
    const apif = apiFootballKey
      ? await fetchFixtures(apiFootballKey).catch(e => ({ ok: false, http: 0, errors: String(e) } as FixtureResponse))
      : null;
    const merged = withVerifiedResults(wc26.ok ? wc26.fixtures : (apif?.fixtures || []));
    return NextResponse.json({
      configured: true,
      active, ts: now,
      wc26: { ok: wc26.ok, fixtureCount: wc26.fixtures.length },
      apiFootball: apif ? { ok: apif.ok, fixtureCount: apif.fixtures?.length ?? 0, quota: apif.quota } : "not configured",
      verifiedCount: VERIFIED_RESULTS.length,
      mergedCount: merged.length,
      source: apif?.ok && (apif.fixtures?.length ?? 0) > 0 ? "api-football+wc26" : wc26.ok ? "wc26" : "verified-only",
      sample: merged.slice(0, 3),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  // Fetch from worldcup26.ir (primary) and optionally API-Football (enrichment)
  const wc26 = await fetchWC26().catch(() => ({ ok: false, fixtures: [] as unknown[] }));

  let apifFixtures: unknown[] = [];
  if (apiFootballKey && active) {
    const apif = await fetchFixtures(apiFootballKey).catch(() => ({ ok: false, fixtures: [] } as FixtureResponse));
    if (apif.ok && apif.fixtures && apif.fixtures.length > 0) apifFixtures = apif.fixtures;
  }

  // Merge strategy: start with API-Football (richer data with stats/lineups),
  // then fill in any missing matches from worldcup26.ir, then verified results
  let base: unknown[] = [];
  if (apifFixtures.length > 0) {
    base = [...apifFixtures];
    // Add wc26 matches not already covered by API-Football
    for (const wf of wc26.fixtures) {
      if (!base.some(f => sameFixture(f, wf))) base.push(wf);
    }
  } else if (wc26.ok) {
    base = wc26.fixtures;
  }

  const fixtures = withVerifiedResults(base);
  const hasLiveData = wc26.ok || apifFixtures.length > 0;

  if (!active && !hasLiveData) {
    return NextResponse.json(
      { configured: true, active: false, ts: LAST ? LAST.ts : now, fixtures },
      { headers: { "Cache-Control": `public, s-maxage=${IDLE_TTL}, stale-while-revalidate=${IDLE_TTL * 2}` } }
    );
  }

  LAST = { fixtures, ts: now };

  return NextResponse.json(
    { configured: true, active, ts: now, fixtures, source: apifFixtures.length > 0 ? "api-football+wc26" : wc26.ok ? "wc26" : "verified-only" },
    { headers: { "Cache-Control": `public, s-maxage=${active ? LIVE_TTL : IDLE_TTL}, stale-while-revalidate=${active ? LIVE_TTL * 2 : IDLE_TTL * 2}` } }
  );
}

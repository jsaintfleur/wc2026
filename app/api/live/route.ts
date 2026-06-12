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

let LAST: { fixtures: unknown[]; ts: number } | null = null;

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
  const merged = [...fixtures];
  for (const verified of VERIFIED_RESULTS) {
    if (!merged.some(f => sameFixture(f, verified))) merged.push(verified);
  }
  return merged;
}

function inWindow(now: number): boolean {
  return STARTS.some(s => now >= s - PRE && now <= s + POST);
}

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
  /* Try league+season first; fall back to date-based query if no fixtures returned */
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

export async function GET(request: NextRequest) {
  const key = process.env.APIFOOTBALL_KEY;
  const now = Date.now();
  const debug = request.nextUrl.searchParams.has("debug");

  if (!key) {
    const fixtures = withVerifiedResults();
    return NextResponse.json(
      { configured: false, active: inWindow(now), ts: now, fixtures },
      { headers: { "Cache-Control": "public, s-maxage=120" } }
    );
  }

  const active = inWindow(now);

  if (debug) {
    const r = await fetchFixtures(key).catch(e => ({
      ok: false, http: 0, errors: String(e),
    } as FixtureResponse));
    return NextResponse.json({
      configured: true, debug: true, active, league: LEAGUE, season: SEASON,
      upstreamOk: r.ok, http: r.http || 200, quota: r.quota || null,
      fixtureCount: r.ok ? withVerifiedResults(r.fixtures).length : VERIFIED_RESULTS.length,
      upstreamFixtureCount: r.ok ? (r.fixtures?.length ?? 0) : 0,
      verifiedFixtureCount: VERIFIED_RESULTS.length,
      errors: r.errors || null,
      sample: r.ok ? withVerifiedResults(r.fixtures).slice(0, 3) : VERIFIED_RESULTS.slice(0, 3),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!active) {
    const fixtures = withVerifiedResults(LAST ? LAST.fixtures : []);
    return NextResponse.json(
      { configured: true, active: false, ts: LAST ? LAST.ts : now, fixtures },
      { headers: { "Cache-Control": `public, s-maxage=${IDLE_TTL}, stale-while-revalidate=${IDLE_TTL * 2}` } }
    );
  }

  try {
    const r = await fetchFixtures(key);
    if (!r.ok) throw new Error("upstream " + r.http);
    const fixtures = withVerifiedResults(r.fixtures);
    LAST = { fixtures, ts: now };
    return NextResponse.json(
      { configured: true, active: true, ts: now, fixtures, quota: r.quota },
      { headers: { "Cache-Control": `public, s-maxage=${LIVE_TTL}, stale-while-revalidate=${LIVE_TTL * 2}` } }
    );
  } catch {
    const fixtures = withVerifiedResults(LAST ? LAST.fixtures : []);
    return NextResponse.json(
      { configured: true, active: true, stale: true, ts: LAST ? LAST.ts : now, fixtures },
      { headers: { "Cache-Control": "public, s-maxage=120" } }
    );
  }
}

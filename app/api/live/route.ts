import { NextRequest, NextResponse } from "next/server";
import { DATA } from "@/lib/data";

const STARTS = DATA.starts;
const LIVE_TTL = parseInt(process.env.LIVE_TTL || "420", 10);
const IDLE_TTL = parseInt(process.env.IDLE_TTL || "1800", 10);
const LEAGUE = process.env.WC_LEAGUE || "1";
const SEASON = process.env.WC_SEASON || "2026";
const PRE = 15 * 60000;
const POST = 155 * 60000;

let LAST: { fixtures: unknown[]; ts: number } | null = null;

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

async function fetchFixtures(key: string): Promise<FixtureResponse> {
  const url = `https://v3.football.api-sports.io/fixtures?league=${LEAGUE}&season=${SEASON}`;
  const r = await fetch(url, { headers: { "x-apisports-key": key } });
  const body = await r.json().catch(() => ({}));
  const quota = {
    limit: r.headers.get("x-ratelimit-requests-limit"),
    remaining: r.headers.get("x-ratelimit-requests-remaining"),
  };
  if (!r.ok) return { ok: false, http: r.status, errors: body.errors || null, quota };
  const fixtures = (body.response || []).map((f: Record<string, Record<string, Record<string, unknown>>>) => ({
    ts: Date.parse(f.fixture.date as unknown as string),
    status: f.fixture.status && (f.fixture.status as Record<string, unknown>).short,
    elapsed: f.fixture.status && (f.fixture.status as Record<string, unknown>).elapsed,
    venue: f.fixture.venue && (f.fixture.venue as Record<string, unknown>).name,
    round: f.league && (f.league as Record<string, unknown>).round,
    home: f.teams && f.teams.home && (f.teams.home as Record<string, unknown>).name,
    away: f.teams && f.teams.away && (f.teams.away as Record<string, unknown>).name,
    gh: f.goals ? (f.goals as Record<string, unknown>).home : null,
    ga: f.goals ? (f.goals as Record<string, unknown>).away : null,
  }));
  return { ok: true, fixtures, quota };
}

export async function GET(request: NextRequest) {
  const key = process.env.APIFOOTBALL_KEY;
  const now = Date.now();
  const debug = request.nextUrl.searchParams.has("debug");

  if (!key) {
    return NextResponse.json(
      { configured: false, active: inWindow(now), fixtures: [] },
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
      fixtureCount: r.ok ? (r.fixtures?.length ?? 0) : 0,
      errors: r.errors || null,
      sample: r.ok ? (r.fixtures?.slice(0, 3) ?? null) : null,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!active) {
    return NextResponse.json(
      { configured: true, active: false, ts: now, fixtures: LAST ? LAST.fixtures : [] },
      { headers: { "Cache-Control": `public, s-maxage=${IDLE_TTL}, stale-while-revalidate=${IDLE_TTL * 2}` } }
    );
  }

  try {
    const r = await fetchFixtures(key);
    if (!r.ok) throw new Error("upstream " + r.http);
    LAST = { fixtures: r.fixtures!, ts: now };
    return NextResponse.json(
      { configured: true, active: true, ts: now, fixtures: r.fixtures, quota: r.quota },
      { headers: { "Cache-Control": `public, s-maxage=${LIVE_TTL}, stale-while-revalidate=${LIVE_TTL * 2}` } }
    );
  } catch {
    return NextResponse.json(
      { configured: true, active: true, stale: true, ts: LAST ? LAST.ts : now, fixtures: LAST ? LAST.fixtures : [] },
      { headers: { "Cache-Control": "public, s-maxage=120" } }
    );
  }
}

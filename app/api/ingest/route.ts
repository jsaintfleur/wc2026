import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mergeFixtures, type VendorFixture, type ScheduleMatch } from "@/lib/merge";
import { DATA } from "@/lib/data";

const STARTS = DATA.starts;
const PRE = 15 * 60_000;
const POST = 155 * 60_000;
const LEAGUE = process.env.WC_LEAGUE || "1";
const SEASON = process.env.WC_SEASON || "2026";
const DAILY_QUOTA_CAP = 80;

const LIVE_OR_DONE = new Set([
  "1H", "2H", "HT", "ET", "BT", "P", "LIVE", "SUSP", "INT",
  "FT", "AET", "PEN", "WO", "AWD",
]);

let quotaState = { date: "", count: 0 };
let lastGood: { fixtures: VendorFixture[]; ts: number } | null = null;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function inWindow(now: number): boolean {
  return STARTS.some(s => now >= s - PRE && now <= s + POST);
}

function checkQuota(): { ok: boolean; remaining: number } {
  const today = todayKey();
  if (quotaState.date !== today) {
    quotaState = { date: today, count: 0 };
  }
  return { ok: quotaState.count < DAILY_QUOTA_CAP, remaining: DAILY_QUOTA_CAP - quotaState.count };
}

function bumpQuota(): void {
  const today = todayKey();
  if (quotaState.date !== today) {
    quotaState = { date: today, count: 1 };
  } else {
    quotaState.count++;
  }
}

async function fetchFixtures(key: string): Promise<VendorFixture[]> {
  const url = `https://v3.football.api-sports.io/fixtures?league=${LEAGUE}&season=${SEASON}`;
  const r = await fetch(url, { headers: { "x-apisports-key": key }, cache: "no-store" });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const body = await r.json().catch(() => ({}));
  return (body.response || []).map((f: Record<string, Record<string, Record<string, unknown>>>) => ({
    ts: Date.parse(f.fixture.date as unknown as string),
    status: f.fixture.status && (f.fixture.status as Record<string, unknown>).short,
    elapsed: f.fixture.status && (f.fixture.status as Record<string, unknown>).elapsed,
    venue: f.fixture.venue && (f.fixture.venue as Record<string, unknown>).name,
    round: f.league && (f.league as Record<string, unknown>).round,
    home: f.teams && f.teams.home && (f.teams.home as Record<string, unknown>).name,
    away: f.teams && f.teams.away && (f.teams.away as Record<string, unknown>).name,
    gh: f.goals ? (f.goals as Record<string, unknown>).home : null,
    ga: f.goals ? (f.goals as Record<string, unknown>).away : null,
    fixtureId: f.fixture.id ? Number(f.fixture.id) : undefined,
  }));
}

async function loadScheduleMatches(): Promise<ScheduleMatch[]> {
  const rows = await prisma.match.findMany({
    include: { homeTeam: true, awayTeam: true, venue: true },
    orderBy: { matchNumber: "asc" },
  });
  return rows.map(m => ({
    id: m.id,
    matchNumber: m.matchNumber,
    kickoffTs: new Date(m.kickoffUtc).getTime(),
    venueCommon: m.venue.commonName,
    homeTeam: m.homeTeam?.name || null,
    awayTeam: m.awayTeam?.name || null,
  }));
}

async function runIngestion(fixtures: VendorFixture[]): Promise<{
  matched: number;
  upserted: number;
  skippedLowConfidence: number;
  skippedNoState: number;
}> {
  const scheduleMatches = await loadScheduleMatches();
  const merged = mergeFixtures(scheduleMatches, fixtures);

  let upserted = 0;
  let skippedNoState = 0;

  for (const { match, fixture } of merged) {
    if (!LIVE_OR_DONE.has(fixture.status as string)) {
      skippedNoState++;
      continue;
    }

    await prisma.matchState.upsert({
      where: { matchId: match.id },
      update: {
        status: fixture.status as string,
        elapsed: typeof fixture.elapsed === "number" ? fixture.elapsed : null,
        homeGoals: typeof fixture.gh === "number" ? fixture.gh : null,
        awayGoals: typeof fixture.ga === "number" ? fixture.ga : null,
        vendorFixtureId: fixture.fixtureId ? BigInt(fixture.fixtureId) : null,
        updatedAt: new Date(),
      },
      create: {
        matchId: match.id,
        status: fixture.status as string,
        elapsed: typeof fixture.elapsed === "number" ? fixture.elapsed : null,
        homeGoals: typeof fixture.gh === "number" ? fixture.gh : null,
        awayGoals: typeof fixture.ga === "number" ? fixture.ga : null,
        vendorFixtureId: fixture.fixtureId ? BigInt(fixture.fixtureId) : null,
      },
    });
    upserted++;
  }

  return {
    matched: merged.length,
    upserted,
    skippedLowConfidence: 0,
    skippedNoState,
  };
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get("authorization")?.replace("Bearer ", "");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && secret !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const force = request.nextUrl.searchParams.has("force");
  const active = inWindow(now);

  if (!active && !force) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "no match window",
      ts: now,
    });
  }

  const quota = checkQuota();
  if (!quota.ok) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: "daily quota exhausted",
      remaining: quota.remaining,
      ts: now,
    });
  }

  const key = process.env.APIFOOTBALL_KEY;
  if (!key) {
    return NextResponse.json({
      ok: false,
      error: "APIFOOTBALL_KEY not configured",
      ts: now,
    }, { status: 500 });
  }

  try {
    const fixtures = await fetchFixtures(key);
    bumpQuota();
    lastGood = { fixtures, ts: now };

    const result = await runIngestion(fixtures);

    return NextResponse.json({
      ok: true,
      ts: now,
      quotaRemaining: DAILY_QUOTA_CAP - quotaState.count,
      fixturesFetched: fixtures.length,
      ...result,
    });
  } catch (err) {
    console.error("[ingest] fetch failed:", err);

    if (lastGood && now - lastGood.ts < 10 * 60_000) {
      const result = await runIngestion(lastGood.fixtures);
      return NextResponse.json({
        ok: true,
        stale: true,
        staleSince: lastGood.ts,
        ts: now,
        ...result,
      });
    }

    return NextResponse.json({
      ok: false,
      error: "upstream fetch failed, no recent cache",
      ts: now,
    }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mergeFixtures, type VendorFixture, type ScheduleMatch } from "@/lib/merge";
import { DATA } from "@/lib/data";
import type { Prisma } from "@/lib/generated/prisma/client";

const STARTS = DATA.starts;
const PRE = 90 * 60_000;
const POST = 6 * 60 * 60_000;
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

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value == null
    ? undefined
    : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function fetchFixtures(key: string): Promise<VendorFixture[]> {
  const url = `https://v3.football.api-sports.io/fixtures?league=${LEAGUE}&season=${SEASON}`;
  const r = await fetch(url, { headers: { "x-apisports-key": key }, cache: "no-store" });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  const body = await r.json().catch(() => ({}));
  return (body.response || []).map((f: Record<string, unknown>) => {
    const fixture = f.fixture as Record<string, unknown> | undefined;
    const status = fixture?.status as Record<string, unknown> | undefined;
    const venue = fixture?.venue as Record<string, unknown> | undefined;
    const league = f.league as Record<string, unknown> | undefined;
    const teams = f.teams as { home?: { name?: string }; away?: { name?: string } } | undefined;
    const goals = f.goals as { home?: number | null; away?: number | null } | undefined;
    const score = f.score as { penalty?: { home?: number | null; away?: number | null } } | undefined;
    const events = ((f.events || []) as Array<{
      time?: { elapsed?: number; extra?: number | null };
      type?: string;
      detail?: string;
      player?: { name?: string };
      assist?: { name?: string | null };
      team?: { name?: string };
    }>).map(e => ({
      minute: e.time?.elapsed ?? 0,
      extra: e.time?.extra ?? null,
      type: e.type as "Goal" | "Card" | "subst" | "Var",
      detail: e.detail ?? "",
      player: e.player?.name ?? "",
      assist: e.assist?.name ?? null,
      team: e.team?.name ?? "",
    })).filter(e => e.type && e.player);
    const parseStats = (arr: Array<{ type?: string; value?: string | number | null }>) => {
      const out: Record<string, string | number | null> = {};
      for (const s of arr) if (s.type) out[s.type] = s.value ?? null;
      return out;
    };
    const rawStats = (f.statistics || []) as Array<{ statistics?: Array<{ type?: string; value?: string | number | null }> }>;
    const stats = rawStats.length === 2
      ? { home: parseStats(rawStats[0]?.statistics || []), away: parseStats(rawStats[1]?.statistics || []) }
      : undefined;
    const rawLineups = (f.lineups || []) as Array<{
      team?: { name?: string };
      formation?: string;
      startXI?: Array<{ player?: { name?: string; number?: number; pos?: string; grid?: string | null } }>;
      substitutes?: Array<{ player?: { name?: string; number?: number; pos?: string; grid?: string | null } }>;
    }>;
    const mapLineupPlayer = (p: { player?: { name?: string; number?: number; pos?: string; grid?: string | null } }) => ({
      name: p.player?.name ?? "",
      number: p.player?.number ?? 0,
      pos: p.player?.pos ?? "",
      grid: p.player?.grid ?? null,
    });
    const lineups = rawLineups.length === 2 ? rawLineups.map(l => ({
      team: l.team?.name ?? "",
      formation: l.formation ?? "",
      startXI: (l.startXI || []).map(mapLineupPlayer).filter(p => p.name),
      substitutes: (l.substitutes || []).map(mapLineupPlayer).filter(p => p.name),
    })) : undefined;
    const rawPlayers = (f.players || []) as Array<{
      team?: { name?: string };
      players?: Array<{
        player?: { name?: string; number?: number };
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
      }>;
    }>;
    const players = rawPlayers.flatMap(t => {
      const teamName = t.team?.name ?? "";
      return (t.players || []).map(p => {
        const s = p.statistics?.[0] || {};
        return {
          name: p.player?.name ?? "",
          number: p.player?.number ?? 0,
          team: teamName,
          minutes: s.games?.minutes ?? null,
          rating: s.games?.rating == null ? null : String(s.games.rating),
          goals: s.goals?.total ?? 0,
          assists: s.goals?.assists ?? 0,
          shots: s.shots?.total ?? 0,
          shotsOn: s.shots?.on ?? 0,
          passes: s.passes?.total ?? 0,
          passAccuracy: s.passes?.accuracy == null ? null : `${s.passes.accuracy}%`,
          tackles: s.tackles?.total ?? 0,
          duels: s.duels?.total ?? 0,
          duelsWon: s.duels?.won ?? 0,
          dribbles: s.dribbles?.attempts ?? 0,
          dribblesSuccess: s.dribbles?.success ?? 0,
          foulsDrawn: s.fouls?.drawn ?? 0,
          foulsCommitted: s.fouls?.committed ?? 0,
          yellowCards: s.cards?.yellow ?? 0,
          redCards: s.cards?.red ?? 0,
          saves: s.goals?.saves ?? 0,
        };
      }).filter(p => p.name);
    });

    return {
      ts: Date.parse(String(fixture?.date || "")),
      status: String(status?.short || ""),
      elapsed: typeof status?.elapsed === "number" ? status.elapsed : null,
      venue: String(venue?.name || ""),
      round: String(league?.round || ""),
      home: teams?.home?.name || "",
      away: teams?.away?.name || "",
      gh: goals?.home ?? null,
      ga: goals?.away ?? null,
      penHome: score?.penalty?.home ?? null,
      penAway: score?.penalty?.away ?? null,
      fixtureId: fixture?.id ? Number(fixture.id) : undefined,
      events: events.length ? events : undefined,
      stats,
      lineups,
      players: players.length ? players : undefined,
      referee: fixture?.referee ? String(fixture.referee) : undefined,
    };
  });
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
        events: toJson(fixture.events),
        stats: toJson(fixture.stats),
        lineups: toJson(fixture.lineups),
        players: toJson(fixture.players),
        referee: fixture.referee || null,
        updatedAt: new Date(),
      },
      create: {
        matchId: match.id,
        status: fixture.status as string,
        elapsed: typeof fixture.elapsed === "number" ? fixture.elapsed : null,
        homeGoals: typeof fixture.gh === "number" ? fixture.gh : null,
        awayGoals: typeof fixture.ga === "number" ? fixture.ga : null,
        vendorFixtureId: fixture.fixtureId ? BigInt(fixture.fixtureId) : null,
        events: toJson(fixture.events),
        stats: toJson(fixture.stats),
        lineups: toJson(fixture.lineups),
        players: toJson(fixture.players),
        referee: fixture.referee || null,
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

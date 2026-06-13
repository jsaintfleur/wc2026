import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { MOCK_FIXTURES } from "@/lib/data";
import { mergeFixtures, type VendorFixture, type ScheduleMatch } from "@/lib/merge";
import type { Prisma } from "@/lib/generated/prisma/client";

const LIVE_OR_DONE = new Set([
  "1H", "2H", "HT", "ET", "BT", "P", "LIVE", "SUSP", "INT",
  "FT", "AET", "PEN", "WO", "AWD",
]);

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value == null
    ? undefined
    : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function GET() {
  const fixtures: VendorFixture[] = MOCK_FIXTURES.map(f => ({ ...f, fixtureId: undefined }));

  const rows = await prisma.match.findMany({
    include: { homeTeam: true, awayTeam: true, venue: true },
    orderBy: { matchNumber: "asc" },
  });
  const scheduleMatches: ScheduleMatch[] = rows.map(m => ({
    id: m.id,
    matchNumber: m.matchNumber,
    kickoffTs: new Date(m.kickoffUtc).getTime(),
    venueCommon: m.venue.commonName,
    homeTeam: m.homeTeam?.name || null,
    awayTeam: m.awayTeam?.name || null,
  }));

  const merged = mergeFixtures(scheduleMatches, fixtures);

  let upserted = 0;
  let skippedNoState = 0;

  for (const { match, fixture } of merged) {
    if (!LIVE_OR_DONE.has(fixture.status)) {
      skippedNoState++;
      continue;
    }

    await prisma.matchState.upsert({
      where: { matchId: match.id },
      update: {
        status: fixture.status,
        elapsed: typeof fixture.elapsed === "number" ? fixture.elapsed : null,
        homeGoals: typeof fixture.gh === "number" ? fixture.gh : null,
        awayGoals: typeof fixture.ga === "number" ? fixture.ga : null,
        vendorFixtureId: null,
        events: toJson(fixture.events),
        stats: toJson(fixture.stats),
        lineups: toJson(fixture.lineups),
        players: toJson(fixture.players),
        referee: fixture.referee || null,
        updatedAt: new Date(),
      },
      create: {
        matchId: match.id,
        status: fixture.status,
        elapsed: typeof fixture.elapsed === "number" ? fixture.elapsed : null,
        homeGoals: typeof fixture.gh === "number" ? fixture.gh : null,
        awayGoals: typeof fixture.ga === "number" ? fixture.ga : null,
        vendorFixtureId: null,
        events: toJson(fixture.events),
        stats: toJson(fixture.stats),
        lineups: toJson(fixture.lineups),
        players: toJson(fixture.players),
        referee: fixture.referee || null,
      },
    });
    upserted++;
  }

  return NextResponse.json({
    ok: true,
    mock: true,
    fixturesInput: fixtures.length,
    matched: merged.length,
    upserted,
    skippedNoState,
    mergeDetails: merged.map(r => ({
      matchNumber: r.match.matchNumber,
      home: r.match.homeTeam,
      away: r.match.awayTeam,
      fixtureHome: r.fixture.home,
      fixtureAway: r.fixture.away,
      status: r.fixture.status,
      goals: `${r.fixture.gh ?? "-"} - ${r.fixture.ga ?? "-"}`,
    })),
  });
}

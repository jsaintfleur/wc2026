import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { LiveFixture, MatchEvent, MatchStats, PlayerMatchStat, TeamLineup } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DETAIL_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};

type RouteContext = {
  params: Promise<{ no: string }> | { no: string };
};

function asNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const matchNumber = asNumber(params.no);
  if (!matchNumber) {
    return NextResponse.json({ error: "invalid match number" }, { status: 400, headers: DETAIL_HEADERS });
  }

  try {
    const match = await prisma.match.findUnique({
      where: { matchNumber },
      include: { homeTeam: true, awayTeam: true, venue: true, state: true },
    });

    if (!match) {
      return NextResponse.json({ error: "match not found" }, { status: 404, headers: DETAIL_HEADERS });
    }

    const state = match.state;
    const detail: LiveFixture = {
      ts: new Date(match.kickoffUtc).getTime(),
      status: state?.status || "NS",
      elapsed: state?.elapsed ?? null,
      venue: match.venue.commonName,
      round: match.stage === "group" ? `Group Stage - ${match.groupLetter || ""}` : (match.round || ""),
      home: match.homeTeam?.name || "TBD",
      away: match.awayTeam?.name || "TBD",
      gh: state?.homeGoals ?? null,
      ga: state?.awayGoals ?? null,
      events: state?.events as unknown as MatchEvent[] | undefined,
      stats: state?.stats as unknown as MatchStats | undefined,
      lineups: state?.lineups as unknown as TeamLineup[] | undefined,
      players: state?.players as unknown as PlayerMatchStat[] | undefined,
      referee: state?.referee || undefined,
      fixtureId: state?.vendorFixtureId == null ? undefined : Number(state.vendorFixtureId),
    };

    return NextResponse.json({ matchNumber, fixture: detail }, { headers: DETAIL_HEADERS });
  } catch {
    return NextResponse.json({ error: "match detail unavailable" }, { status: 503, headers: DETAIL_HEADERS });
  }
}

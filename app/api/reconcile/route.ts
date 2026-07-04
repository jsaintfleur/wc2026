import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { VERIFIED_RESULTS } from "@/lib/verified-results";
import { canon } from "@/lib/merge";

const LIVE_STATUSES = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "SUSP", "INT"]);
const DONE_STATUSES = new Set(["FT", "AET", "PEN", "WO", "AWD"]);
const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;
const LOOKBACK_MS = 72 * 60 * 60 * 1000;

interface ReconcileResult {
  checked: number;
  staleFound: number;
  staleForcedFT: number;
  missingState: number;
  verifiedBackfilled: number;
  details: { matchNumber: number; status: string; action: string }[];
}

// Find verified result for a match by team-pair + time window
function findVerified(home: string, away: string, kickoffTs: number) {
  return VERIFIED_RESULTS.find(v => {
    const dt = Math.abs(v.ts - kickoffTs);
    if (dt > 75 * 60_000) return false;
    const a = canon(v.home), b = canon(v.away);
    const h = canon(home), w = canon(away);
    return (a === h && b === w) || (a === w && b === h);
  });
}

async function reconcile(): Promise<ReconcileResult> {
  const now = Date.now();
  const cutoff = new Date(now - LOOKBACK_MS);

  const matches = await prisma.match.findMany({
    where: { kickoffUtc: { gte: cutoff, lt: new Date(now) } },
    include: { state: true, homeTeam: true, awayTeam: true },
    orderBy: { kickoffUtc: "asc" },
  });

  const result: ReconcileResult = {
    checked: matches.length,
    staleFound: 0,
    staleForcedFT: 0,
    missingState: 0,
    verifiedBackfilled: 0,
    details: [],
  };

  for (const m of matches) {
    const kickoff = new Date(m.kickoffUtc).getTime();
    const elapsed = now - kickoff;
    const homeName = m.homeTeam?.name || "";
    const awayName = m.awayTeam?.name || "";

    // Backfill from verified results: if DB has no score or a stale live status,
    // and we have a verified FT result, write it. Never downgrade a good score.
    const verified = findVerified(homeName, awayName, kickoff);
    const hasGoodScore = m.state && DONE_STATUSES.has(m.state.status) && m.state.homeGoals != null && m.state.awayGoals != null;

    if (verified && !hasGoodScore) {
      await prisma.matchState.upsert({
        where: { matchId: m.id },
        update: {
          status: "FT",
          elapsed: 90,
          homeGoals: verified.gh,
          awayGoals: verified.ga,
          events: verified.events ? JSON.parse(JSON.stringify(verified.events)) : undefined,
          updatedAt: new Date(),
        },
        create: {
          matchId: m.id,
          status: "FT",
          elapsed: 90,
          homeGoals: verified.gh ?? 0,
          awayGoals: verified.ga ?? 0,
          events: verified.events ? JSON.parse(JSON.stringify(verified.events)) : undefined,
        },
      });
      result.verifiedBackfilled++;
      result.details.push({
        matchNumber: m.matchNumber,
        status: m.state?.status || "NO_STATE",
        action: "backfilled_from_verified",
      });
      continue;
    }

    if (!m.state) {
      if (elapsed > STALE_THRESHOLD_MS) {
        result.missingState++;
        result.details.push({
          matchNumber: m.matchNumber,
          status: "NO_STATE",
          action: "flagged_missing",
        });
      }
      continue;
    }

    // Force stale live statuses to FT, but only if we already have scores.
    // Never write FT with null goals — that's worse than leaving a stale status.
    if (LIVE_STATUSES.has(m.state.status) && elapsed > STALE_THRESHOLD_MS) {
      result.staleFound++;

      if (m.state.homeGoals != null && m.state.awayGoals != null) {
        await prisma.matchState.update({
          where: { matchId: m.id },
          data: { status: "FT", updatedAt: new Date() },
        });
        result.staleForcedFT++;
        result.details.push({
          matchNumber: m.matchNumber,
          status: m.state.status,
          action: "forced_ft_with_scores",
        });
      } else {
        result.details.push({
          matchNumber: m.matchNumber,
          status: m.state.status,
          action: "stale_but_no_scores_skipped",
        });
      }
    }
  }

  return result;
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get("authorization")?.replace("Bearer ", "");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || secret !== cronSecret) { // fail closed: missing CRON_SECRET denies access
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await reconcile();
    return NextResponse.json({ ok: true, ts: Date.now(), ...result });
  } catch (err) {
    console.error("[reconcile] failed:", err);
    return NextResponse.json({ ok: false, error: "reconciliation failed" }, { status: 500 });
  }
}

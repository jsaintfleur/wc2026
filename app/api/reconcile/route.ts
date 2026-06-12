import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const LIVE_STATUSES = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "SUSP", "INT"]);
const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;
const LOOKBACK_MS = 72 * 60 * 60 * 1000;

interface ReconcileResult {
  checked: number;
  staleFound: number;
  staleForcedFT: number;
  missingState: number;
  details: { matchNumber: number; status: string; action: string }[];
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
    details: [],
  };

  for (const m of matches) {
    const kickoff = new Date(m.kickoffUtc).getTime();
    const elapsed = now - kickoff;

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

    if (LIVE_STATUSES.has(m.state.status) && elapsed > STALE_THRESHOLD_MS) {
      result.staleFound++;

      await prisma.matchState.update({
        where: { matchId: m.id },
        data: { status: "FT", updatedAt: new Date() },
      });

      result.staleForcedFT++;
      result.details.push({
        matchNumber: m.matchNumber,
        status: m.state.status,
        action: "forced_ft",
      });
    }
  }

  return result;
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get("authorization")?.replace("Bearer ", "");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && secret !== cronSecret) {
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

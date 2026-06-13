// Shared team-name normalization and strict fixture-to-match merge logic.
// Used by both the client (tournament.tsx) and the server (ingestion worker).

import type { MatchEvent, MatchStats, PlayerMatchStat, TeamLineup } from "./data";

export const TEAM_NORM: Record<string, string> = {
  turkey: "Türkiye", czechrepublic: "Czechia", czechia: "Czechia",
  korearepublic: "South Korea", southkorea: "South Korea",
  usa: "United States", unitedstates: "United States",
  cotedivoire: "Ivory Coast", ivorycoast: "Ivory Coast",
  congodr: "DR Congo", drcongo: "DR Congo", democraticrepublicofcongo: "DR Congo",
  caboverde: "Cape Verde", capeverdeislands: "Cape Verde", capeverde: "Cape Verde",
  bosniaandherzegovina: "Bosnia & Herzegovina", bosniaherzegovina: "Bosnia & Herzegovina",
  curacao: "Curaçao",
};

export function nrm(s: string): string {
  return (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

export function canon(n: string): string {
  return TEAM_NORM[nrm(n)] || n;
}

const WINDOW_MS = 75 * 60_000;

export interface VendorFixture {
  ts: number;
  status: string;
  elapsed: number | null;
  venue: string;
  round: string;
  home: string;
  away: string;
  gh: number | null;
  ga: number | null;
  fixtureId?: number;
  events?: MatchEvent[];
  stats?: MatchStats;
  lineups?: TeamLineup[];
  players?: PlayerMatchStat[];
  referee?: string;
}

export interface ScheduleMatch {
  id: number;
  matchNumber: number;
  kickoffTs: number;
  venueCommon: string;
  homeTeam: string | null;
  awayTeam: string | null;
}

export interface MergeResult {
  match: ScheduleMatch;
  fixture: VendorFixture;
  confidence: "high" | "low";
}

// Strict merge: time window (75 min) + venue OR team-pair match.
// Returns only high-confidence merges — never writes a low-confidence match.
export function mergeFixtures(
  matches: ScheduleMatch[],
  fixtures: VendorFixture[],
): MergeResult[] {
  const results: MergeResult[] = [];

  for (const m of matches) {
    let best: VendorFixture | null = null;
    let bestDt = WINDOW_MS;
    let bestConfidence: "high" | "low" = "low";

    for (const f of fixtures) {
      const dt = Math.abs((f.ts || 0) - m.kickoffTs);
      if (dt > WINDOW_MS) continue;

      const fv = nrm(f.venue);
      const mv = nrm(m.venueCommon);
      const venOK = mv && fv && (fv === mv || fv.includes(mv) || mv.includes(fv));

      let teamOK = false;
      if (m.homeTeam && m.awayTeam) {
        const a = canon(f.home);
        const b = canon(f.away);
        teamOK = (a === m.homeTeam && b === m.awayTeam) || (a === m.awayTeam && b === m.homeTeam);
      }

      if (!venOK && !teamOK) continue;

      const confidence = teamOK ? "high" : (venOK ? "high" : "low");

      if (dt < bestDt || (dt === bestDt && confidence === "high" && bestConfidence === "low")) {
        bestDt = dt;
        best = f;
        bestConfidence = confidence;
      }
    }

    if (best && bestConfidence === "high") {
      results.push({ match: m, fixture: best, confidence: "high" });
    }
  }

  return results;
}

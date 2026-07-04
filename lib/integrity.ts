/* Tournament data-integrity validator — cross-checks the resolved match
 * list and the derived team records for the invariants that, when broken,
 * produce the classic drift bugs: missing matches, double counting,
 * mismatched goal totals, and knockout progressions that contradict
 * results. Pure functions; the app runs this in development and logs
 * anything it finds.
 */

import {
  buildTeamRecords,
  knockoutRoundDepth,
  matchWinner,
  type RecordMatchInput,
  type TeamRecord,
} from "./team-records";

export interface IntegrityIssue {
  level: "error" | "warn";
  code: string;
  message: string;
}

export function validateTournamentIntegrity(
  teams: string[],
  matches: RecordMatchInput[],
  records: Map<string, TeamRecord>,
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const push = (level: IntegrityIssue["level"], code: string, message: string) =>
    issues.push({ level, code, message });

  /* ── Match-level invariants ─────────────────────────────────── */
  const seenKeys = new Set<string>();
  const teamSet = new Set(teams);
  let completedWithBothTeams = 0;
  let totalGoalsHome = 0;
  let totalGoalsAway = 0;

  for (const match of matches) {
    if (seenKeys.has(match.key)) {
      push("error", "duplicate-match", `Match key "${match.key}" appears more than once.`);
    }
    seenKeys.add(match.key);

    if (match.home === match.away && match.home !== "TBD") {
      push("error", "self-match", `Match ${match.key} has ${match.home} on both sides.`);
    }
    for (const side of [match.home, match.away]) {
      if (side !== "TBD" && !teamSet.has(side)) {
        push("error", "unknown-team", `Match ${match.key} names "${side}", which is not a tournament team.`);
      }
    }

    if (match.status === "completed") {
      if (match.gh == null || match.ga == null) {
        push("warn", "completed-without-score", `Completed match ${match.key} (${match.home} vs ${match.away}) has no score.`);
        continue;
      }
      if (match.home === "TBD" || match.away === "TBD") {
        push("error", "completed-unresolved", `Completed match ${match.key} still has a TBD side.`);
        continue;
      }
      completedWithBothTeams++;
      totalGoalsHome += match.gh;
      totalGoalsAway += match.ga;
      /* Drawn knockout ties must carry a shootout result */
      if (knockoutRoundDepth(match.stage) > 0 && match.gh === match.ga && matchWinner(match) == null) {
        push("warn", "knockout-draw-unresolved", `Knockout match ${match.key} (${match.home} vs ${match.away}) is drawn with no penalty result.`);
      }
    }
  }

  /* ── Record-level invariants ────────────────────────────────── */
  /* Sum of matches played must equal exactly 2 × fully-counted matches:
     each completed match increments played once for each of its 2 teams. */
  let sumPlayed = 0;
  let sumGF = 0;
  let sumGA = 0;
  let sumW = 0;
  let sumD = 0;
  let sumL = 0;
  for (const record of records.values()) {
    sumPlayed += record.played;
    sumGF += record.goalsFor;
    sumGA += record.goalsAgainst;
    sumW += record.wins;
    sumD += record.draws;
    sumL += record.losses;
    if (record.played !== record.wins + record.draws + record.losses) {
      push("error", "wdl-mismatch", `${record.team}: played ${record.played} ≠ W${record.wins}+D${record.draws}+L${record.losses}.`);
    }
    if (record.goalDiff !== record.goalsFor - record.goalsAgainst) {
      push("error", "gd-mismatch", `${record.team}: goalDiff ${record.goalDiff} ≠ GF ${record.goalsFor} − GA ${record.goalsAgainst}.`);
    }
    if (record.eliminated && record.alive) {
      push("error", "status-contradiction", `${record.team} is both alive and eliminated.`);
    }
  }
  if (sumPlayed !== completedWithBothTeams * 2) {
    push("error", "played-total", `Sum of matches played (${sumPlayed}) ≠ 2 × completed matches (${completedWithBothTeams * 2}).`);
  }
  /* Goals scored across all teams must equal goals conceded — every goal
     for one side is a goal against the other. */
  if (sumGF !== sumGA) {
    push("error", "goal-balance", `Total goals for (${sumGF}) ≠ total goals against (${sumGA}).`);
  }
  if (sumGF !== totalGoalsHome + totalGoalsAway) {
    push("error", "goal-source", `Team goal totals (${sumGF}) ≠ match score totals (${totalGoalsHome + totalGoalsAway}).`);
  }
  /* Every win is someone's loss; draws come in pairs */
  if (sumW !== sumL) push("error", "win-loss-balance", `Total wins (${sumW}) ≠ total losses (${sumL}).`);
  if (sumD % 2 !== 0) push("error", "draw-parity", `Total draws (${sumD}) is odd — draws must come in pairs.`);

  /* ── Knockout progression ───────────────────────────────────── */
  /* The winner of each decided knockout tie must appear in a deeper round
     once that deeper round has any resolved participants; a knockout
     loser must never appear in a deeper round. */
  const deepestResolved = new Map<string, number>();
  for (const match of matches) {
    const depth = knockoutRoundDepth(match.stage);
    if (depth === 0) continue;
    for (const side of [match.home, match.away]) {
      if (side === "TBD") continue;
      deepestResolved.set(side, Math.max(deepestResolved.get(side) || 0, depth));
    }
  }
  for (const match of matches) {
    const depth = knockoutRoundDepth(match.stage);
    if (depth === 0 || depth >= 5 || match.status !== "completed") continue; // final/3rd feed nothing
    const winner = matchWinner(match);
    if (!winner || winner === "TBD") continue;
    const loser = winner === match.home ? match.away : match.home;
    const nextRoundResolved = matches.some(m => knockoutRoundDepth(m.stage) === depth + 1 && (m.home !== "TBD" || m.away !== "TBD"));
    if (nextRoundResolved && (deepestResolved.get(winner) || 0) <= depth) {
      push("warn", "winner-missing", `${winner} won a ${match.stage} tie but does not appear in the next round's resolved slots.`);
    }
    if (loser !== "TBD" && (deepestResolved.get(loser) || 0) > depth && !matches.some(m => knockoutRoundDepth(m.stage) === 5 && (m.home === loser || m.away === loser))) {
      push("error", "loser-advanced", `${loser} lost a ${match.stage} tie but appears in a deeper round.`);
    }
  }

  return issues;
}

/* Convenience wrapper: build records and validate in one call — what the
   dev-mode hook in the app uses. */
export function auditTournament(
  teams: string[],
  matches: RecordMatchInput[],
): { records: Map<string, TeamRecord>; issues: IntegrityIssue[] } {
  const records = buildTeamRecords(teams, matches);
  return { records, issues: validateTournamentIntegrity(teams, matches, records) };
}

/* Canonical per-team tournament records — the single source every surface
 * (Analytics Hub, team pages, map, stats) should derive W-D-L/goals/status
 * from, so views cannot drift apart. Pure functions over a resolved match
 * list; the caller resolves knockout participants via the shared bracket
 * builder before calling in (fixtures alone under-count: a tie whose
 * fixture the vendor has not published yet still has known participants).
 */

export type RecordMatchStatus = "completed" | "live" | "upcoming";

export interface RecordMatchInput {
  /* Unique per match — duplicates are an integrity error */
  key: string;
  stage: string; // "Group Stage" or the knockout round label
  ts: number;
  home: string; // canonical team name, or "TBD" when unresolved
  away: string;
  status: RecordMatchStatus;
  gh: number | null;
  ga: number | null;
  penHome?: number | null;
  penAway?: number | null;
}

export interface TeamRecord {
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  /* Group-stage points only (3/1/0) — knockout matches award none */
  groupPoints: number;
  knockoutWins: number;
  penaltyWins: number;
  cleanSheets: number;
  /* Matches still to play that name this team (live counts as remaining) */
  remaining: number;
  nextOpponent: string | null;
  nextTs: number | null;
  nextStage: string | null;
  /* Deepest knockout round the team has appeared in (0 = group stage) */
  roundReached: number;
  alive: boolean;
  eliminated: boolean;
}

export interface TeamRecordsOptions {
  /* From group standings: true once every group table is final */
  allGroupsComplete?: boolean;
  /* Teams that advanced out of the groups (winners, runners-up, best 3rds) */
  groupQualifiers?: Set<string>;
}

export function knockoutRoundDepth(stage: string): number {
  const s = stage.toLowerCase();
  if (s === "final") return 6;
  if (s.includes("third")) return 5;
  if (s.startsWith("semi")) return 4;
  if (s.startsWith("quarter")) return 3;
  if (s.includes("16")) return 2;
  if (s.includes("32")) return 1;
  return 0;
}

function isNamed(team: string): boolean {
  return !!team && team !== "TBD";
}

/* Winner of a completed match from the two scores, penalties breaking
   knockout draws. Returns null for group draws or missing scores. */
export function matchWinner(match: RecordMatchInput): string | null {
  if (match.status !== "completed" || match.gh == null || match.ga == null) return null;
  if (match.gh !== match.ga) return match.gh > match.ga ? match.home : match.away;
  if (match.penHome != null && match.penAway != null && match.penHome !== match.penAway) {
    return match.penHome > match.penAway ? match.home : match.away;
  }
  return null;
}

export function buildTeamRecords(
  teams: string[],
  matches: RecordMatchInput[],
  options: TeamRecordsOptions = {},
): Map<string, TeamRecord> {
  const records = new Map<string, TeamRecord>();
  for (const team of teams) {
    records.set(team, {
      team,
      played: 0, wins: 0, draws: 0, losses: 0,
      goalsFor: 0, goalsAgainst: 0, goalDiff: 0,
      groupPoints: 0, knockoutWins: 0, penaltyWins: 0, cleanSheets: 0,
      remaining: 0, nextOpponent: null, nextTs: null, nextStage: null,
      roundReached: 0, alive: true, eliminated: false,
    });
  }

  const ordered = [...matches].sort((a, b) => a.ts - b.ts);
  const knockoutLosers = new Set<string>();
  const knockoutAppearances = new Set<string>();

  for (const match of ordered) {
    const isKnockout = knockoutRoundDepth(match.stage) > 0;
    const home = records.get(match.home);
    const away = records.get(match.away);

    for (const [record, opponent] of [[home, match.away], [away, match.home]] as const) {
      if (!record) continue;
      if (isKnockout) {
        knockoutAppearances.add(record.team);
        record.roundReached = Math.max(record.roundReached, knockoutRoundDepth(match.stage));
      }
      if (match.status !== "completed") {
        record.remaining++;
        if (record.nextTs == null) {
          record.nextTs = match.ts;
          record.nextOpponent = isNamed(opponent) ? opponent : "TBD";
          record.nextStage = match.stage;
        }
      }
    }

    if (match.status !== "completed" || match.gh == null || match.ga == null || !home || !away) continue;

    const winner = matchWinner(match);
    const wasPens = match.gh === match.ga && winner != null;
    const apply = (record: TeamRecord, gf: number, ga: number) => {
      record.played++;
      record.goalsFor += gf;
      record.goalsAgainst += ga;
      record.goalDiff = record.goalsFor - record.goalsAgainst;
      if (ga === 0) record.cleanSheets++;
      /* Regulation result only in W-D-L: FIFA records a shootout tie as a
         draw for BOTH sides — the shootout outcome is captured separately
         in knockoutWins/penaltyWins and in elimination. */
      if (gf > ga) record.wins++;
      else if (gf < ga) record.losses++;
      else record.draws++;
      if (!isKnockout) record.groupPoints += gf > ga ? 3 : gf === ga ? 1 : 0;
      if (isKnockout && winner === record.team) {
        record.knockoutWins++;
        if (wasPens) record.penaltyWins++;
      }
    };
    apply(home, match.gh, match.ga);
    apply(away, match.ga, match.gh);

    /* Knockout elimination: the non-winner of a decided knockout tie is
       out — INCLUDING penalty defeats, which a plain score comparison
       misses. An undecided completed KO tie (data gap) eliminates nobody. */
    if (isKnockout && winner) {
      const loser = winner === match.home ? match.away : match.home;
      if (isNamed(loser)) knockoutLosers.add(loser);
    }
  }

  /* Alive/eliminated: a knockout defeat is definitive; a group exit is
     declared only when every group table is final AND the team neither
     qualified nor appears in any knockout tie. Ambiguity defaults to
     alive — never eliminate a team on incomplete data. */
  for (const record of records.values()) {
    const groupExit = !!options.allGroupsComplete
      && !!options.groupQualifiers
      && !options.groupQualifiers.has(record.team)
      && !knockoutAppearances.has(record.team);
    record.eliminated = knockoutLosers.has(record.team) || groupExit;
    record.alive = !record.eliminated;
  }

  return records;
}

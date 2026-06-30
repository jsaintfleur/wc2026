import type { LiveFixture, MatchEvent, PlayerMatchStat, TournamentData } from "./data";
import { canon, canonPlayer } from "./merge";

export const STATS_DONE_STATUSES = new Set(["FT", "AET", "PEN", "PEN_LIVE", "WO", "AWD"]);
export const STATS_LIVE_STATUSES = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "SUSP", "INT"]);

export type PlayerLeader = {
  name: string;
  team: string;
  goals: number;
  penalties: number;
  assists: number;
  yellows: number;
  reds: number;
  matches: number;
};

export type CombinedLeader = {
  name: string;
  team: string;
  goals: number;
  assists: number;
  total: number;
};

export type TeamGoalLeader = {
  team: string;
  goals: number;
  conceded: number;
  matches: number;
  gpm: number;
};

export type TournamentStats = {
  topScorers: PlayerLeader[];
  topAssisters: PlayerLeader[];
  topCombined: CombinedLeader[];
  topYellowCards: PlayerLeader[];
  topRedCards: PlayerLeader[];
  topTeams: TeamGoalLeader[];
  mostCarded: PlayerLeader[];
  minuteBuckets: number[];
  bucketLabels: string[];
  totalGoals: number;
  totalGoalsFromEvents: number;
  normalGoals: number;
  penGoals: number;
  ownGoals: number;
  totalYellows: number;
  totalReds: number;
  totalSubs: number;
  matchesPlayed: number;
  matchesWithEvents: number;
  matchesWithAssistData: number;
  avgGoals: number;
  cleanSheets: number;
};

type FinishedMatch = {
  key: string;
  home: string;
  away: string;
  gh: number;
  ga: number;
  events?: MatchEvent[];
  players?: PlayerMatchStat[];
  assistDataMissing?: boolean;
};

function teamNames(data: TournamentData): Set<string> {
  return new Set(Object.values(data.groups).flat().map(team => canon(team)));
}

function playerKey(name: string, team: string): string {
  return `${canonPlayer(name)}|${canon(team)}`;
}

function isValidPlayerName(name: string | null | undefined, teamSet: Set<string>): name is string {
  const trimmed = (name || "").trim();
  if (!trimmed || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(trimmed)) return false;
  const canonical = canon(trimmed);
  return !teamSet.has(canonical);
}

function ensurePlayer(players: Record<string, PlayerLeader>, name: string, team: string): PlayerLeader {
  const normalizedName = canonPlayer(name);
  const normalizedTeam = canon(team);
  const key = `${normalizedName}|${normalizedTeam}`;
  players[key] = players[key] || {
    name: normalizedName,
    team: normalizedTeam,
    goals: 0,
    penalties: 0,
    assists: 0,
    yellows: 0,
    reds: 0,
    matches: 0,
  };
  return players[key];
}

function isShootoutGoal(ev: MatchEvent): boolean {
  return ev.type === "Goal" && /shootout/i.test(ev.detail || "");
}

// Vendor APIs (API-Football, worldcup26.ir) sometimes emit "Missed Penalty"
// events with type="Goal" — these are NOT actual goals and must be excluded
// from all scoring tallies.
function isMissedPenalty(ev: MatchEvent): boolean {
  return ev.detail === "Missed Penalty";
}

function isOwnGoal(ev: MatchEvent): boolean {
  return ev.detail === "Own Goal";
}

function isPenaltyGoal(ev: MatchEvent): boolean {
  return ev.detail === "Penalty";
}

function addMinuteBucket(minuteBuckets: number[], ev: MatchEvent) {
  const m = ev.minute ?? 0;
  if (m <= 15) minuteBuckets[0]++;
  else if (m <= 30) minuteBuckets[1]++;
  else if (m <= 45) minuteBuckets[2]++;
  else if (m <= 60) minuteBuckets[3]++;
  else if (m <= 75) minuteBuckets[4]++;
  else if (m <= 90 && !ev.extra) minuteBuckets[5]++;
  else minuteBuckets[6]++;
}

function sortPlayersBy(value: keyof Pick<PlayerLeader, "goals" | "assists" | "yellows" | "reds">) {
  return (a: PlayerLeader, b: PlayerLeader) =>
    b[value] - a[value] ||
    b.goals - a.goals ||
    b.assists - a.assists ||
    a.name.localeCompare(b.name) ||
    a.team.localeCompare(b.team);
}

export function buildTournamentStats(data: TournamentData, fixtures: LiveFixture[]): TournamentStats {
  const players: Record<string, PlayerLeader> = {};
  const countryTeamNames = teamNames(data);
  const teamGoalsFromScores: Record<string, { goals: number; conceded: number; matches: number }> = {};
  const minuteBuckets = [0, 0, 0, 0, 0, 0, 0];
  let totalGoalsFromEvents = 0;
  let normalGoals = 0;
  let penGoals = 0;
  let ownGoals = 0;
  let totalYellows = 0;
  let totalReds = 0;
  let totalSubs = 0;
  let matchesWithAssistData = 0;

  const finishedMap = new Map<string, FinishedMatch>();

  for (const f of fixtures) {
    if (!STATS_DONE_STATUSES.has(f.status) || f.gh == null || f.ga == null) continue;
    const key = `${canon(f.home)}:${canon(f.away)}`;
    if (finishedMap.has(key)) continue;
    finishedMap.set(key, {
      key,
      home: f.home,
      away: f.away,
      gh: f.gh,
      ga: f.ga,
      events: f.events,
      players: f.players,
      assistDataMissing: f.assistDataMissing,
    });
  }

  for (const m of data.gs) {
    if (!m.dbStatus || !STATS_DONE_STATUSES.has(m.dbStatus) || m.dbGh == null || m.dbGa == null) continue;
    const key = `${canon(m.t1)}:${canon(m.t2)}`;
    if (finishedMap.has(key)) continue;
    finishedMap.set(key, {
      key,
      home: m.t1,
      away: m.t2,
      gh: m.dbGh,
      ga: m.dbGa,
      events: m.dbEvents,
      players: m.dbPlayers,
    });
  }

  const processCard = (ev: MatchEvent) => {
    if (!isValidPlayerName(ev.player, countryTeamNames)) return;
    const player = ensurePlayer(players, ev.player, ev.team || "");
    const isRed = ev.detail?.includes("Red") ?? false;
    if (isRed) {
      player.reds++;
      totalReds++;
    } else {
      player.yellows++;
      totalYellows++;
    }
  };

  const processGoal = (ev: MatchEvent) => {
    if (isShootoutGoal(ev) || isMissedPenalty(ev)) return;
    totalGoalsFromEvents++;
    if (isOwnGoal(ev)) ownGoals++;
    else if (isPenaltyGoal(ev)) penGoals++;
    else normalGoals++;
    addMinuteBucket(minuteBuckets, ev);

    if (!isOwnGoal(ev) && isValidPlayerName(ev.player, countryTeamNames)) {
      const scorer = ensurePlayer(players, ev.player, ev.team || "");
      scorer.goals++;
      if (isPenaltyGoal(ev)) scorer.penalties++;
    }

    if (!isOwnGoal(ev) && isValidPlayerName(ev.assist, countryTeamNames)) {
      const assister = ensurePlayer(players, ev.assist, ev.team || "");
      assister.assists++;
    }
  };

  let matchesWithEvents = 0;
  let cleanSheets = 0;

  for (const fm of finishedMap.values()) {
    if (fm.gh === 0) cleanSheets++;
    if (fm.ga === 0) cleanSheets++;

    const home = canon(fm.home);
    const away = canon(fm.away);
    teamGoalsFromScores[home] = teamGoalsFromScores[home] || { goals: 0, conceded: 0, matches: 0 };
    teamGoalsFromScores[home].goals += fm.gh;
    teamGoalsFromScores[home].conceded += fm.ga;
    teamGoalsFromScores[home].matches++;

    teamGoalsFromScores[away] = teamGoalsFromScores[away] || { goals: 0, conceded: 0, matches: 0 };
    teamGoalsFromScores[away].goals += fm.ga;
    teamGoalsFromScores[away].conceded += fm.gh;
    teamGoalsFromScores[away].matches++;

    const hasEvents = !!fm.events?.length;
    const hasPlayers = !!fm.players?.length;
    let eventHasAssist = false;
    if (hasEvents) {
      matchesWithEvents++;
      for (const ev of fm.events!) {
        if (ev.type === "Card") {
          processCard(ev);
          continue;
        }
        if (ev.type === "subst") {
          totalSubs++;
          continue;
        }
        if (ev.type === "Goal") processGoal(ev);
      }
      eventHasAssist = fm.events!.some(e => e.type === "Goal" && !isOwnGoal(e) && isValidPlayerName(e.assist, countryTeamNames));
    }

    if (hasPlayers) {
      let matchHasAssist = false;
      for (const p of fm.players!) {
        if (!isValidPlayerName(p.name, countryTeamNames) || !p.team) continue;
        const player = ensurePlayer(players, p.name, p.team);
        if (!hasEvents && p.goals > 0) player.goals += p.goals;
        if (!eventHasAssist && p.assists > 0) {
          player.assists += p.assists;
          matchHasAssist = true;
        }
        if (!hasEvents && p.yellowCards > 0) {
          player.yellows += p.yellowCards;
          totalYellows += p.yellowCards;
        }
        if (!hasEvents && p.redCards > 0) {
          player.reds += p.redCards;
          totalReds += p.redCards;
        }
      }
      if (eventHasAssist || matchHasAssist) matchesWithAssistData++;
    } else if (eventHasAssist) {
      matchesWithAssistData++;
    }
  }

  for (const f of fixtures) {
    if (STATS_DONE_STATUSES.has(f.status) || !STATS_LIVE_STATUSES.has(f.status)) continue;
    for (const ev of f.events || []) {
      if (ev.type === "Card") {
        processCard(ev);
        continue;
      }
      if (ev.type === "subst") {
        totalSubs++;
        continue;
      }
      if (ev.type === "Goal") processGoal(ev);
    }
  }

  for (const fm of finishedMap.values()) {
    const home = canon(fm.home);
    const away = canon(fm.away);
    const seen = new Set<string>();
    for (const p of Object.values(players)) {
      if ((canon(p.team) === home || canon(p.team) === away) && !seen.has(playerKey(p.name, p.team))) {
        p.matches++;
        seen.add(playerKey(p.name, p.team));
      }
    }
  }

  const matchesPlayed = finishedMap.size;
  const topTeams = Object.entries(teamGoalsFromScores)
    .map(([team, s]) => ({ team, goals: s.goals, conceded: s.conceded, matches: s.matches, gpm: s.matches > 0 ? +(s.goals / s.matches).toFixed(1) : 0 }))
    .sort((a, b) => b.goals - a.goals || a.team.localeCompare(b.team))
    .slice(0, 20);

  const totalGoalsFromScores = Object.values(teamGoalsFromScores).reduce((sum, s) => sum + s.goals, 0);
  const totalGoals = Math.max(totalGoalsFromEvents, totalGoalsFromScores);
  const avgGoals = matchesPlayed > 0 ? +(totalGoals / matchesPlayed).toFixed(1) : 0;
  const playerList = Object.values(players).filter(p =>
    isValidPlayerName(p.name, countryTeamNames) &&
    canon(p.name) !== canon(p.team)
  );
  const topScorers = playerList.filter(p => p.goals > 0).sort(sortPlayersBy("goals")).slice(0, 20);
  const topAssisters = playerList.filter(p => p.assists > 0).sort(sortPlayersBy("assists")).slice(0, 20);
  const topYellowCards = playerList.filter(p => p.yellows > 0).sort(sortPlayersBy("yellows")).slice(0, 20);
  const topRedCards = playerList.filter(p => p.reds > 0).sort(sortPlayersBy("reds")).slice(0, 20);
  const mostCarded = playerList
    .filter(p => p.yellows > 0 || p.reds > 0)
    .sort((a, b) => (b.yellows + b.reds * 3) - (a.yellows + a.reds * 3) || a.name.localeCompare(b.name))
    .slice(0, 20);
  const topCombined = playerList
    .map(p => ({ name: p.name, team: p.team, goals: p.goals, assists: p.assists, total: p.goals + p.assists }))
    .filter(p => p.total > 0)
    .sort((a, b) => b.total - a.total || b.goals - a.goals || a.name.localeCompare(b.name))
    .slice(0, 20);

  return {
    topScorers,
    topAssisters,
    topCombined,
    topYellowCards,
    topRedCards,
    topTeams,
    mostCarded,
    minuteBuckets,
    bucketLabels: ["1-15", "16-30", "31-45", "46-60", "61-75", "76-90", "90+"],
    totalGoals,
    totalGoalsFromEvents,
    normalGoals,
    penGoals,
    ownGoals,
    totalYellows,
    totalReds,
    totalSubs,
    matchesPlayed,
    matchesWithEvents,
    matchesWithAssistData,
    avgGoals,
    cleanSheets,
  };
}

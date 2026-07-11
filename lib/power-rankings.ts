import type { LiveFixture, MatchStats, PlayerMatchStat, TournamentData } from "./data";
import { canon } from "./merge";

export type CompetitiveStatus =
  | "Championship Favorite"
  | "Leading Contender"
  | "Strong Contender"
  | "Knockout Threat"
  | "Competitive"
  | "Under Pressure"
  | "Eliminated";

export type PowerRankingWeights = {
  tournamentPerformance: number;
  advancedPerformance: number;
  strengthOfOpposition: number;
  recentForm: number;
  matchDominance: number;
};

export type PowerRankingConfig = {
  weights: PowerRankingWeights;
  iterations: number;
  recentMatchWeights: number[];
};

export type TeamAdvancedMetrics = {
  xg: number | null;
  xga: number | null;
  shotQuality: number | null;
  bigChancesCreated: number | null;
  bigChancesAllowed: number | null;
  shotDifferential: number | null;
  finalThirdEntries: number | null;
  progressivePossession: number | null;
  pressSuccess: number | null;
  defensiveEfficiency: number | null;
  possession: number | null;
  passingAccuracy: number | null;
  shots: number;
  shotsOnTarget: number;
  corners: number;
  fouls: number;
};

export type TeamPowerRanking = {
  team: string;
  rank: number;
  previousRank: number | null;
  highestRank: number;
  lowestRank: number;
  movement: number | "NEW" | "UNCHANGED";
  score: number;
  previousScore: number | null;
  scoreChange: number | null;
  confidence: number;
  status: CompetitiveStatus;
  momentum: number;
  formRating: number;
  attackRating: number;
  defenseRating: number;
  midfieldRating: number;
  averageMatchRating: number | null;
  goals: number;
  assists: number;
  expectedGoals: number | null;
  expectedGoalsAgainst: number | null;
  possession: number | null;
  passingAccuracy: number | null;
  shots: number;
  conversionRate: number | null;
  cleanSheets: number;
  discipline: number;
  tournamentMvp: string | null;
  playerInForm: string | null;
  mostValuablePlayer: string | null;
  keyStrength: string;
  biggestWeakness: string;
  winProbabilityNextMatch: number | null;
  quarterfinalProbability: number;
  semifinalProbability: number;
  finalProbability: number;
  championshipProbability: number;
  components: Record<keyof PowerRankingWeights, number>;
  metrics: TeamAdvancedMetrics;
  trend: RankingSnapshotPoint[];
  explanation: string;
  movementReason: string;
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  goalDifference: number;
  goalsAllowed: number;
  stageReached: string;
  strengthUpsetValue?: number;
};

export type RankingSnapshotPoint = {
  matchNumber: number;
  ts: number;
  opponent: string;
  result: "W" | "D" | "L";
  score: number;
  rank: number;
  movement: number | "NEW" | "UNCHANGED";
};

export type PowerRankingSection = {
  key: string;
  title: string;
  rankings: TeamPowerRanking[];
};

export type MatchPreview = {
  matchNumber: number;
  teamA: string;
  teamB: string;
  powerScoreA: number;
  powerScoreB: number;
  winProbabilityA: number;
  drawProbability: number;
  winProbabilityB: number;
  upsetProbability: number;
  keyTacticalAdvantage: string;
  projectedMvp: string | null;
  predictedScore: string;
  predictionConfidence: number;
};

export type PowerRankingResult = {
  rankings: TeamPowerRanking[];
  sections: PowerRankingSection[];
  insights: string[];
  previews: MatchPreview[];
  matchesPlayed: number;
  updatedAt: number;
};

type FinishedPowerMatch = {
  no: number;
  ts: number;
  round: string;
  home: string;
  away: string;
  gh: number;
  ga: number;
  stats?: MatchStats;
  players?: PlayerMatchStat[];
};

type MutableTeam = {
  team: string;
  matches: FinishedPowerMatch[];
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  allowed: number;
  cleanSheets: number;
  assists: number;
  yellows: number;
  reds: number;
  playerRatings: Record<string, { rating: number; count: number; goals: number; assists: number }>;
  metrics: TeamAdvancedMetrics;
  stageReached: string;
  eliminated: boolean;
};

const DONE = new Set(["FT", "AET", "PEN", "PEN_LIVE", "WO", "AWD"]);

export const DEFAULT_POWER_RANKING_CONFIG: PowerRankingConfig = {
  weights: {
    tournamentPerformance: 0.4,
    advancedPerformance: 0.2,
    strengthOfOpposition: 0.15,
    recentForm: 0.15,
    matchDominance: 0.1,
  },
  iterations: 5,
  recentMatchWeights: [1, 0.82, 0.62, 0.44, 0.28],
};

const resultCache = new Map<string, PowerRankingResult>();

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function percent(n: number): number {
  return Math.round(clamp(n, 0, 1) * 100);
}

function allTeams(data: TournamentData): string[] {
  return Object.values(data.groups).flat();
}

function statNumber(stats: Record<string, string | number | null> | undefined, keys: string[]): number | null {
  if (!stats) return null;
  for (const key of keys) {
    const raw = stats[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const match = raw.match(/-?\d+(\.\d+)?/);
      if (match) return Number(match[0]);
    }
  }
  return null;
}

function statPercent(stats: Record<string, string | number | null> | undefined, keys: string[]): number | null {
  const n = statNumber(stats, keys);
  return n == null ? null : clamp(n, 0, 100);
}

function matchImportance(round: string, no: number): number {
  if (/Final/i.test(round) && !/Third/i.test(round)) return 1.9;
  if (/Semi/i.test(round)) return 1.65;
  if (/Quarter/i.test(round)) return 1.45;
  if (/16/i.test(round)) return 1.28;
  if (/32/i.test(round)) return 1.16;
  if (no >= 49 && no <= 72) return 1.08;
  return 1;
}

function stageValue(round: string): number {
  if (/Final/i.test(round) && !/Third/i.test(round)) return 18;
  if (/Semi/i.test(round)) return 14;
  if (/Quarter/i.test(round)) return 10;
  if (/16/i.test(round)) return 7;
  if (/32/i.test(round)) return 4;
  return 0;
}

function stageLabel(round: string): string {
  if (/Final/i.test(round) && !/Third/i.test(round)) return "Final";
  if (/Third/i.test(round)) return "Third Place";
  if (/Semi/i.test(round)) return "Semifinal";
  if (/Quarter/i.test(round)) return "Quarterfinal";
  if (/16/i.test(round)) return "Round of 16";
  if (/32/i.test(round)) return "Round of 32";
  return "Group Stage";
}

function mergeStatsForSide(target: TeamAdvancedMetrics, sideStats: Record<string, string | number | null> | undefined, oppStats: Record<string, string | number | null> | undefined, gf: number, ga: number) {
  const shots = statNumber(sideStats, ["Total Shots", "Total shots", "Shots total"]) ?? 0;
  const shotsOn = statNumber(sideStats, ["Shots on Goal", "Shots on goal", "Shots on Target"]) ?? 0;
  const oppShots = statNumber(oppStats, ["Total Shots", "Total shots", "Shots total"]) ?? 0;
  const corners = statNumber(sideStats, ["Corner Kicks", "Corners"]) ?? 0;
  const fouls = statNumber(sideStats, ["Fouls"]) ?? 0;
  const possession = statPercent(sideStats, ["Ball Possession", "Possession"]);
  const passAccuracy = statPercent(sideStats, ["Passes %", "Passes accurate", "Pass Accuracy", "Pass Accuracy %"]);
  const xg = statNumber(sideStats, ["Expected Goals", "xG"]);
  const xga = statNumber(sideStats, ["Expected Goals Against", "xGA"]);

  target.shots += shots;
  target.shotsOnTarget += shotsOn;
  target.corners += corners;
  target.fouls += fouls;
  target.shotDifferential = (target.shotDifferential ?? 0) + (shots - oppShots);
  target.xg = (target.xg ?? 0) + (xg ?? deriveXg(shots, shotsOn, gf));
  target.xga = (target.xga ?? 0) + (xga ?? deriveXg(oppShots, statNumber(oppStats, ["Shots on Goal", "Shots on goal", "Shots on Target"]) ?? 0, ga));
  target.bigChancesCreated = (target.bigChancesCreated ?? 0) + Math.max(0, Math.round(shotsOn / 2));
  target.bigChancesAllowed = (target.bigChancesAllowed ?? 0) + Math.max(0, Math.round((statNumber(oppStats, ["Shots on Goal", "Shots on goal", "Shots on Target"]) ?? 0) / 2));
  target.finalThirdEntries = (target.finalThirdEntries ?? 0) + Math.round(shots + corners * 1.5);
  target.progressivePossession = (target.progressivePossession ?? 0) + (possession ?? 50);
  target.pressSuccess = (target.pressSuccess ?? 0) + clamp(58 - fouls + Math.max(0, shots - oppShots), 25, 85);
  target.defensiveEfficiency = (target.defensiveEfficiency ?? 0) + clamp(70 - ga * 10 - oppShots * 0.8, 15, 95);
  if (possession != null) target.possession = (target.possession ?? 0) + possession;
  if (passAccuracy != null) target.passingAccuracy = (target.passingAccuracy ?? 0) + passAccuracy;
  target.shotQuality = (target.shotQuality ?? 0) + (shots > 0 ? (shotsOn / shots) * 100 : 0);
}

function deriveXg(shots: number, shotsOnTarget: number, goals: number): number {
  return round1(clamp(shots * 0.065 + shotsOnTarget * 0.16 + goals * 0.18, 0, 5));
}

function emptyMetrics(): TeamAdvancedMetrics {
  return {
    xg: 0,
    xga: 0,
    shotQuality: 0,
    bigChancesCreated: 0,
    bigChancesAllowed: 0,
    shotDifferential: 0,
    finalThirdEntries: 0,
    progressivePossession: 0,
    pressSuccess: 0,
    defensiveEfficiency: 0,
    possession: 0,
    passingAccuracy: 0,
    shots: 0,
    shotsOnTarget: 0,
    corners: 0,
    fouls: 0,
  };
}

function normalizeAverages(metrics: TeamAdvancedMetrics, matches: number): TeamAdvancedMetrics {
  if (matches === 0) return { ...metrics, xg: null, xga: null, shotQuality: null, bigChancesCreated: null, bigChancesAllowed: null, shotDifferential: null, finalThirdEntries: null, progressivePossession: null, pressSuccess: null, defensiveEfficiency: null, possession: null, passingAccuracy: null };
  const perMatchKeys: (keyof TeamAdvancedMetrics)[] = ["xg", "xga", "shotQuality", "bigChancesCreated", "bigChancesAllowed", "shotDifferential", "finalThirdEntries", "progressivePossession", "pressSuccess", "defensiveEfficiency", "possession", "passingAccuracy"];
  const out = { ...metrics };
  for (const key of perMatchKeys) {
    const value = out[key];
    out[key] = typeof value === "number" ? round1(value / matches) : null;
  }
  return out;
}

function fixtureKey(ts: number, a?: string, b?: string): string {
  return `${ts}|${canon(a || "")}|${canon(b || "")}`;
}

function collectFinishedMatches(data: TournamentData, fixtures: LiveFixture[]): FinishedPowerMatch[] {
  const matches = new Map<string, FinishedPowerMatch>();
  const fixtureByExact = new Map<string, LiveFixture>();
  const fixtureByTs = new Map<number, LiveFixture[]>();
  for (const fixture of fixtures) {
    if (!DONE.has(fixture.status) || fixture.gh == null || fixture.ga == null) continue;
    fixtureByExact.set(fixtureKey(fixture.ts, fixture.home, fixture.away), fixture);
    const tsGroup = fixtureByTs.get(fixture.ts) || [];
    tsGroup.push(fixture);
    fixtureByTs.set(fixture.ts, tsGroup);
  }

  for (const m of data.gs) {
    const exact = fixtureByExact.get(fixtureKey(m.ts, m.t1, m.t2)) || fixtureByExact.get(fixtureKey(m.ts, m.t2, m.t1));
    const near = exact || (fixtureByTs.get(m.ts) || []).find(f => {
      const teams = [canon(f.home), canon(f.away)];
      return teams.includes(canon(m.t1)) && teams.includes(canon(m.t2));
    });
    const gh = near ? (canon(near.home) === canon(m.t1) ? near.gh : near.ga) : m.dbGh;
    const ga = near ? (canon(near.home) === canon(m.t1) ? near.ga : near.gh) : m.dbGa;
    const status = near?.status || m.dbStatus;
    if (!status || !DONE.has(status) || gh == null || ga == null) continue;
    matches.set(`gs-${m.no}`, {
      no: m.no,
      ts: m.ts,
      round: `Group ${m.g}`,
      home: m.t1,
      away: m.t2,
      gh,
      ga,
      stats: near?.stats || m.dbStats,
      players: near?.players || m.dbPlayers,
    });
  }

  let koNo = 73;
  for (const m of data.ko) {
    const fixture = (fixtureByTs.get(m.ts) || []).find(f => DONE.has(f.status) && f.gh != null && f.ga != null);
    if (!fixture) {
      koNo++;
      continue;
    }
    matches.set(`ko-${koNo}`, {
      no: koNo,
      ts: m.ts,
      round: m.round,
      home: fixture.home,
      away: fixture.away,
      gh: fixture.gh!,
      ga: fixture.ga!,
      stats: fixture.stats,
      players: fixture.players,
    });
    koNo++;
  }

  return [...matches.values()].sort((a, b) => a.ts - b.ts || a.no - b.no);
}

function createTeam(team: string): MutableTeam {
  return {
    team,
    matches: [],
    wins: 0,
    draws: 0,
    losses: 0,
    goals: 0,
    allowed: 0,
    cleanSheets: 0,
    assists: 0,
    yellows: 0,
    reds: 0,
    playerRatings: {},
    metrics: emptyMetrics(),
    stageReached: "Pre-Tournament",
    eliminated: false,
  };
}

function applyPlayers(team: MutableTeam, players?: PlayerMatchStat[]) {
  for (const player of players || []) {
    if (canon(player.team) !== canon(team.team)) continue;
    team.assists += Math.max(0, player.assists || 0);
    team.yellows += Math.max(0, player.yellowCards || 0);
    team.reds += Math.max(0, player.redCards || 0);
    const rating = player.rating ? Number.parseFloat(player.rating) : NaN;
    if (!Number.isFinite(rating)) continue;
    const entry = team.playerRatings[player.name] || { rating: 0, count: 0, goals: 0, assists: 0 };
    entry.rating += rating;
    entry.count += 1;
    entry.goals += Math.max(0, player.goals || 0);
    entry.assists += Math.max(0, player.assists || 0);
    team.playerRatings[player.name] = entry;
  }
}

function applyMatch(team: MutableTeam, match: FinishedPowerMatch, side: "home" | "away") {
  const gf = side === "home" ? match.gh : match.ga;
  const ga = side === "home" ? match.ga : match.gh;
  const sideStats = match.stats?.[side];
  const oppStats = match.stats?.[side === "home" ? "away" : "home"];
  team.matches.push(match);
  team.goals += gf;
  team.allowed += ga;
  if (gf > ga) team.wins++;
  else if (gf === ga) team.draws++;
  else team.losses++;
  if (ga === 0) team.cleanSheets++;
  mergeStatsForSide(team.metrics, sideStats, oppStats, gf, ga);
  applyPlayers(team, match.players);
  team.stageReached = stageLabel(match.round);
  if (!/Group/i.test(match.round) && gf < ga) team.eliminated = true;
}

function scoreMapFromRankings(rankings: { team: string; score: number }[]): Record<string, number> {
  return Object.fromEntries(rankings.map(r => [canon(r.team), r.score]));
}

function calculateCore(data: TournamentData, matches: FinishedPowerMatch[], config: PowerRankingConfig, previous?: Map<string, { rank: number; score: number }>, trendMap?: Map<string, RankingSnapshotPoint[]>): TeamPowerRanking[] {
  const teams = new Map(allTeams(data).map(t => [canon(t), createTeam(t)]));
  for (const match of matches) {
    const home = teams.get(canon(match.home));
    const away = teams.get(canon(match.away));
    if (!home || !away) continue;
    applyMatch(home, match, "home");
    applyMatch(away, match, "away");
  }

  let opponentScores: Record<string, number> = Object.fromEntries([...teams.values()].map(t => [canon(t.team), 50]));
  let rankings: TeamPowerRanking[] = [];

  for (let iteration = 0; iteration < config.iterations; iteration++) {
    rankings = [...teams.values()].map(team => buildRanking(team, config, opponentScores, previous, trendMap));
  rankings.sort(compareRankings);
    rankings = rankings.map((ranking, index) => {
      const ranked = { ...ranking, rank: index + 1 };
      return { ...ranked, explanation: buildExplanation(ranked) };
    });
    opponentScores = scoreMapFromRankings(rankings);
  }

  const maxRank = rankings.length;
  return rankings.map(ranking => {
    const prior = previous?.get(canon(ranking.team));
    const movement = prior ? prior.rank - ranking.rank : "NEW";
    const scoreChange = prior ? round1(ranking.score - prior.score) : null;
    const trend = trendMap?.get(canon(ranking.team)) || [];
    const historicalRanks = [...trend.map(p => p.rank), ranking.rank];
    return {
      ...ranking,
      movement: movement === 0 ? "UNCHANGED" : movement,
      previousRank: prior?.rank ?? null,
      previousScore: prior?.score ?? null,
      scoreChange,
      highestRank: Math.min(...historicalRanks, maxRank),
      lowestRank: Math.max(...historicalRanks, ranking.rank),
      movementReason: buildMovementReason(ranking, movement === 0 ? "UNCHANGED" : movement, scoreChange),
      trend,
    };
  });
}

function compareRankings(a: TeamPowerRanking, b: TeamPowerRanking): number {
  return b.score - a.score || b.goalDifference - a.goalDifference || b.goals - a.goals || a.team.localeCompare(b.team);
}

function buildRanking(
  team: MutableTeam,
  config: PowerRankingConfig,
  opponentScores: Record<string, number>,
  previous?: Map<string, { rank: number; score: number }>,
  trendMap?: Map<string, RankingSnapshotPoint[]>,
): TeamPowerRanking {
  const matches = team.matches.length;
  const normalizedMetrics = normalizeAverages(team.metrics, matches);
  const gd = team.goals - team.allowed;
  const tournamentPerformance = matches
    ? clamp(48 + team.wins * 12 + team.draws * 4 - team.losses * 8 + gd * 4 + team.cleanSheets * 3 + Math.max(...team.matches.map(m => stageValue(m.round))), 0, 100)
    : 50;
  const advancedPerformance = matches
    ? clamp(50 + ((normalizedMetrics.xg ?? 0) - (normalizedMetrics.xga ?? 0)) * 9 + (normalizedMetrics.shotDifferential ?? 0) * 1.9 + ((normalizedMetrics.shotQuality ?? 0) - 32) * 0.35 + ((normalizedMetrics.defensiveEfficiency ?? 50) - 50) * 0.35, 0, 100)
    : 50;
  const strengthOfOpposition = matches
    ? clamp(team.matches.reduce((sum, match) => {
        const opponent = canon(match.home) === canon(team.team) ? match.away : match.home;
        const gf = canon(match.home) === canon(team.team) ? match.gh : match.ga;
        const ga = canon(match.home) === canon(team.team) ? match.ga : match.gh;
        const resultBonus = gf > ga ? 10 : gf === ga ? 2 : -4;
        return sum + (opponentScores[canon(opponent)] ?? 50) + resultBonus;
      }, 0) / matches, 0, 100)
    : 50;
  const recentForm = recentFormScore(team, config);
  const matchDominance = matches
    ? clamp(50 + gd * 5 + ((normalizedMetrics.shotDifferential ?? 0) * 2.3) + ((normalizedMetrics.possession ?? 50) - 50) * 0.45 + ((normalizedMetrics.xg ?? 0) - (normalizedMetrics.xga ?? 0)) * 7, 0, 100)
    : 50;

  const components = {
    tournamentPerformance,
    advancedPerformance,
    strengthOfOpposition,
    recentForm,
    matchDominance,
  };
  const weighted = Object.entries(config.weights).reduce((sum, [key, weight]) => sum + components[key as keyof PowerRankingWeights] * weight, 0);
  const confidence = percent(0.42 + Math.min(matches, 7) * 0.07 + (normalizedMetrics.xg != null ? 0.08 : 0) + (team.playerRatings ? 0.02 : 0));
  const attackRating = clamp(50 + team.goals * 5 + (normalizedMetrics.xg ?? 0) * 6 + (normalizedMetrics.shotsOnTarget / Math.max(matches, 1)) * 2, 0, 100);
  const defenseRating = clamp(76 - team.allowed * 5 + team.cleanSheets * 6 + (normalizedMetrics.defensiveEfficiency ?? 50) * 0.35, 0, 100);
  const midfieldRating = clamp(45 + (normalizedMetrics.possession ?? 50) * 0.45 + (normalizedMetrics.passingAccuracy ?? 78) * 0.25 + (normalizedMetrics.progressivePossession ?? 50) * 0.16, 0, 100);
  const probabilities = probabilityBundle(weighted, team.eliminated, team.stageReached);
  const status = competitiveStatus(weighted, probabilities.championshipProbability, recentForm, team.stageReached, team.eliminated);
  const averageMatchRating = averagePlayerRating(team);
  const leaders = topPlayers(team);
  const rankingBase: TeamPowerRanking = {
    team: team.team,
    rank: 0,
    previousRank: null,
    highestRank: 0,
    lowestRank: 0,
    movement: previous?.has(canon(team.team)) ? "UNCHANGED" : "NEW",
    score: round1(clamp(weighted, 0, 100)),
    previousScore: null,
    scoreChange: null,
    confidence,
    status,
    momentum: round1(recentForm - 50),
    formRating: round1(recentForm),
    attackRating: round1(attackRating),
    defenseRating: round1(defenseRating),
    midfieldRating: round1(midfieldRating),
    averageMatchRating,
    goals: team.goals,
    assists: team.assists,
    expectedGoals: normalizedMetrics.xg,
    expectedGoalsAgainst: normalizedMetrics.xga,
    possession: normalizedMetrics.possession,
    passingAccuracy: normalizedMetrics.passingAccuracy,
    shots: team.metrics.shots,
    conversionRate: team.metrics.shots > 0 ? round1((team.goals / team.metrics.shots) * 100) : null,
    cleanSheets: team.cleanSheets,
    discipline: team.yellows + team.reds * 3,
    tournamentMvp: leaders.mvp,
    playerInForm: leaders.form,
    mostValuablePlayer: leaders.mvp,
    keyStrength: keyStrength({ attackRating, defenseRating, midfieldRating, normalizedMetrics }),
    biggestWeakness: biggestWeakness({ attackRating, defenseRating, midfieldRating, normalizedMetrics }),
    winProbabilityNextMatch: null,
    quarterfinalProbability: probabilities.quarterfinalProbability,
    semifinalProbability: probabilities.semifinalProbability,
    finalProbability: probabilities.finalProbability,
    championshipProbability: probabilities.championshipProbability,
    components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, round1(v)])) as Record<keyof PowerRankingWeights, number>,
    metrics: normalizedMetrics,
    trend: trendMap?.get(canon(team.team)) || [],
    explanation: "",
    movementReason: "",
    matchesPlayed: matches,
    wins: team.wins,
    draws: team.draws,
    losses: team.losses,
    goalDifference: gd,
    goalsAllowed: team.allowed,
    stageReached: team.stageReached,
  };
  return {
    ...rankingBase,
    explanation: buildExplanation(rankingBase),
  };
}

function recentFormScore(team: MutableTeam, config: PowerRankingConfig): number {
  if (!team.matches.length) return 50;
  const recent = [...team.matches].sort((a, b) => b.ts - a.ts).slice(0, config.recentMatchWeights.length);
  let total = 0;
  let weights = 0;
  recent.forEach((match, index) => {
    const weight = config.recentMatchWeights[index] ?? 0.2;
    const gf = canon(match.home) === canon(team.team) ? match.gh : match.ga;
    const ga = canon(match.home) === canon(team.team) ? match.ga : match.gh;
    const result = gf > ga ? 72 : gf === ga ? 52 : 32;
    const dominance = clamp(50 + (gf - ga) * 10, 0, 100);
    total += (result * 0.7 + dominance * 0.3) * weight * matchImportance(match.round, match.no);
    weights += weight * matchImportance(match.round, match.no);
  });
  return weights ? clamp(total / weights, 0, 100) : 50;
}

function probabilityBundle(score: number, eliminated: boolean, stage: string) {
  if (eliminated) {
    return { quarterfinalProbability: 0, semifinalProbability: 0, finalProbability: 0, championshipProbability: 0 };
  }
  const strength = clamp((score - 35) / 55, 0.03, 0.96);
  const stageFloor = stage === "Final" ? 1 : stage === "Semifinal" ? 0.72 : stage === "Quarterfinal" ? 0.48 : stage === "Round of 16" ? 0.3 : stage === "Round of 32" ? 0.18 : 0.08;
  const quarterfinalProbability = percent(Math.max(stageFloor, strength * 0.68));
  const semifinalProbability = percent(Math.max(stage === "Final" || stage === "Semifinal" ? stageFloor : 0, strength * 0.42));
  const finalProbability = percent(Math.max(stage === "Final" ? 1 : 0, strength * 0.24));
  const championshipProbability = percent(Math.pow(strength, 2.2) * 0.42 + (stage === "Final" ? 0.32 : 0));
  return { quarterfinalProbability, semifinalProbability, finalProbability, championshipProbability };
}

function competitiveStatus(score: number, championshipProbability: number, form: number, stage: string, eliminated: boolean): CompetitiveStatus {
  if (eliminated) return "Eliminated";
  if (score >= 86 || championshipProbability >= 22 || stage === "Final") return "Championship Favorite";
  if (score >= 78 || championshipProbability >= 14) return "Leading Contender";
  if (score >= 70 || form >= 68) return "Strong Contender";
  if (score >= 62 || /Round|Quarter|Semi/.test(stage)) return "Knockout Threat";
  if (score >= 50) return "Competitive";
  return "Under Pressure";
}

function averagePlayerRating(team: MutableTeam): number | null {
  const entries = Object.values(team.playerRatings);
  const totalCount = entries.reduce((sum, p) => sum + p.count, 0);
  if (!totalCount) return null;
  return round1(entries.reduce((sum, p) => sum + p.rating, 0) / totalCount);
}

function topPlayers(team: MutableTeam): { mvp: string | null; form: string | null } {
  const rows = Object.entries(team.playerRatings)
    .map(([name, value]) => ({ name, avg: value.rating / value.count, impact: value.goals * 1.7 + value.assists + value.rating / value.count }))
    .sort((a, b) => b.impact - a.impact || a.name.localeCompare(b.name));
  return { mvp: rows[0]?.name || null, form: rows[0]?.name || null };
}

function keyStrength(input: { attackRating: number; defenseRating: number; midfieldRating: number; normalizedMetrics: TeamAdvancedMetrics }): string {
  const options = [
    { label: "Chance creation", value: input.attackRating },
    { label: "Defensive suppression", value: input.defenseRating },
    { label: "Midfield control", value: input.midfieldRating },
    { label: "Press and territory", value: input.normalizedMetrics.pressSuccess ?? 0 },
  ].sort((a, b) => b.value - a.value);
  return options[0].label;
}

function biggestWeakness(input: { attackRating: number; defenseRating: number; midfieldRating: number; normalizedMetrics: TeamAdvancedMetrics }): string {
  const options = [
    { label: "Finishing efficiency", value: input.attackRating },
    { label: "Chance prevention", value: input.defenseRating },
    { label: "Possession security", value: input.midfieldRating },
    { label: "Territory control", value: input.normalizedMetrics.progressivePossession ?? 50 },
  ].sort((a, b) => a.value - b.value);
  return options[0].label;
}

function buildExplanation(ranking: TeamPowerRanking): string {
  if (ranking.matchesPlayed === 0) {
    return `${ranking.team} starts on the baseline CPI because no completed tournament match is available yet.`;
  }
  const xgPart = ranking.expectedGoals != null && ranking.expectedGoalsAgainst != null
    ? `an estimated xG differential of ${round1(ranking.expectedGoals - ranking.expectedGoalsAgainst)}`
    : `a goal difference of ${ranking.goalDifference}`;
  return `${ranking.team} is #${ranking.rank || "-"} with a ${ranking.score.toFixed(1)} CPI after ${ranking.wins}-${ranking.draws}-${ranking.losses}, ${ranking.goalDifference >= 0 ? "+" : ""}${ranking.goalDifference} goal difference, ${ranking.cleanSheets} clean sheet${ranking.cleanSheets === 1 ? "" : "s"}, and ${xgPart}. ${ranking.keyStrength} is currently their strongest signal, while ${ranking.biggestWeakness.toLowerCase()} is the main limiter.`;
}

function buildMovementReason(ranking: TeamPowerRanking, movement: number | "NEW" | "UNCHANGED", scoreChange: number | null): string {
  if (movement === "NEW") return `${ranking.team} enters the CPI board after its first completed match signal.`;
  if (movement === "UNCHANGED") return `${ranking.team} holds position because the weighted CPI inputs changed by ${scoreChange == null ? "0.0" : Math.abs(scoreChange).toFixed(1)} points.`;
  const direction = movement > 0 ? "climbs" : "falls";
  return `${ranking.team} ${direction} ${Math.abs(movement)} place${Math.abs(movement) === 1 ? "" : "s"} as form (${ranking.formRating.toFixed(1)}), opponent-adjusted results (${ranking.components.strengthOfOpposition.toFixed(1)}), and dominance (${ranking.components.matchDominance.toFixed(1)}) update the CPI.`;
}

function buildTrendMap(data: TournamentData, matches: FinishedPowerMatch[], config: PowerRankingConfig): Map<string, RankingSnapshotPoint[]> {
  const trend = new Map<string, RankingSnapshotPoint[]>();
  let previous: Map<string, { rank: number; score: number }> | undefined;
  for (let i = 0; i < matches.length; i++) {
    const subset = matches.slice(0, i + 1);
    const rankings = calculateCore(data, subset, config, previous);
    for (const ranking of rankings) {
      const currentMatch = matches[i];
      if (canon(currentMatch.home) !== canon(ranking.team) && canon(currentMatch.away) !== canon(ranking.team)) continue;
      const gf = canon(currentMatch.home) === canon(ranking.team) ? currentMatch.gh : currentMatch.ga;
      const ga = canon(currentMatch.home) === canon(ranking.team) ? currentMatch.ga : currentMatch.gh;
      const opponent = canon(currentMatch.home) === canon(ranking.team) ? currentMatch.away : currentMatch.home;
      const points = trend.get(canon(ranking.team)) || [];
      points.push({
        matchNumber: currentMatch.no,
        ts: currentMatch.ts,
        opponent,
        result: gf > ga ? "W" : gf === ga ? "D" : "L",
        score: ranking.score,
        rank: ranking.rank,
        movement: ranking.movement,
      });
      trend.set(canon(ranking.team), points);
    }
    previous = new Map(rankings.map(r => [canon(r.team), { rank: r.rank, score: r.score }]));
  }
  return trend;
}

function buildSections(rankings: TeamPowerRanking[]): PowerRankingSection[] {
  const withMatches = rankings.filter(r => r.matchesPlayed > 0);
  const movers = withMatches.filter(r => typeof r.movement === "number");
  const by = (key: string, title: string, rows: TeamPowerRanking[]) => ({ key, title, rankings: rows.slice(0, 6) });
  return [
    by("top-movers", "Top Movers", movers.sort((a, b) => Math.abs(Number(b.movement)) - Math.abs(Number(a.movement)))),
    by("biggest-risers", "Biggest Risers", movers.filter(r => Number(r.movement) > 0).sort((a, b) => Number(b.movement) - Number(a.movement))),
    by("biggest-fallers", "Biggest Fallers", movers.filter(r => Number(r.movement) < 0).sort((a, b) => Number(a.movement) - Number(b.movement))),
    by("best-attack", "Best Attack", rankings.slice().sort((a, b) => b.attackRating - a.attackRating)),
    by("best-defense", "Best Defense", rankings.slice().sort((a, b) => b.defenseRating - a.defenseRating)),
    by("highest-press", "Highest Press", rankings.slice().sort((a, b) => (b.metrics.pressSuccess ?? 0) - (a.metrics.pressSuccess ?? 0))),
    by("most-clinical", "Most Clinical", rankings.filter(r => r.conversionRate != null).sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0))),
    by("highest-possession", "Highest Possession", rankings.filter(r => r.possession != null).sort((a, b) => (b.possession ?? 0) - (a.possession ?? 0))),
    by("most-efficient", "Most Efficient", rankings.slice().sort((a, b) => b.components.matchDominance - a.components.matchDominance)),
    by("best-form", "Best Form", rankings.slice().sort((a, b) => b.formRating - a.formRating)),
    by("dark-horses", "Dark Horses", rankings.filter(r => r.status === "Knockout Threat" || r.status === "Strong Contender").sort((a, b) => b.momentum - a.momentum)),
    by("tournament-favorites", "Tournament Favorites", rankings.slice().sort((a, b) => b.championshipProbability - a.championshipProbability)),
    by("trending-teams", "Trending Teams", rankings.slice().sort((a, b) => b.momentum - a.momentum)),
    by("upset-watch", "Upset Watch", rankings.filter(r => r.status !== "Eliminated").sort((a, b) => (b.strengthUpsetValue ?? 0) - (a.strengthUpsetValue ?? 0))),
  ].map(section => ({
    ...section,
    rankings: section.rankings.filter(Boolean),
  }));
}

function buildInsights(rankings: TeamPowerRanking[]): string[] {
  const rows = rankings.filter(r => r.matchesPlayed > 0);
  if (!rows.length) return ["CPI will activate as soon as completed match data is available."];
  const top = rows[0];
  const form = rows.slice().sort((a, b) => b.formRating - a.formRating)[0];
  const defense = rows.slice().sort((a, b) => b.defenseRating - a.defenseRating)[0];
  const xg = rows.filter(r => r.expectedGoals != null && r.expectedGoalsAgainst != null).sort((a, b) => ((b.expectedGoals! - b.expectedGoalsAgainst!) - (a.expectedGoals! - a.expectedGoalsAgainst!)))[0];
  return [
    `${top.team} leads the CPI at ${top.score.toFixed(1)} on the strength of ${top.keyStrength.toLowerCase()} and a ${top.goalDifference >= 0 ? "+" : ""}${top.goalDifference} goal difference.`,
    `${form.team} owns the best recent form rating at ${form.formRating.toFixed(1)}.`,
    `${defense.team} is the highest-rated defense with ${defense.cleanSheets} clean sheet${defense.cleanSheets === 1 ? "" : "s"} and a ${defense.defenseRating.toFixed(1)} defensive score.`,
    xg ? `${xg.team} has the strongest estimated xG differential at ${round1(xg.expectedGoals! - xg.expectedGoalsAgainst!)} per match.` : `${top.team} has the most complete score profile among teams with available data.`,
  ];
}

function buildPreviews(data: TournamentData, rankings: TeamPowerRanking[], matches: FinishedPowerMatch[]): MatchPreview[] {
  const finishedKeys = new Set(matches.map(m => `${m.ts}|${canon(m.home)}|${canon(m.away)}`));
  const byTeam = new Map(rankings.map(r => [canon(r.team), r]));
  const upcoming = data.gs
    .filter(m => !finishedKeys.has(`${m.ts}|${canon(m.t1)}|${canon(m.t2)}`))
    .slice(0, 4);
  return upcoming.map(m => {
    const a = byTeam.get(canon(m.t1));
    const b = byTeam.get(canon(m.t2));
    const scoreA = a?.score ?? 50;
    const scoreB = b?.score ?? 50;
    const diff = scoreA - scoreB;
    const winA = clamp(0.42 + diff / 180, 0.18, 0.72);
    const draw = clamp(0.24 - Math.abs(diff) / 500, 0.16, 0.28);
    const winB = 1 - winA - draw;
    const favorite = scoreA >= scoreB ? a : b;
    return {
      matchNumber: m.no,
      teamA: m.t1,
      teamB: m.t2,
      powerScoreA: round1(scoreA),
      powerScoreB: round1(scoreB),
      winProbabilityA: percent(winA),
      drawProbability: percent(draw),
      winProbabilityB: percent(winB),
      upsetProbability: percent(Math.min(winA, winB)),
      keyTacticalAdvantage: favorite?.keyStrength || "CPI balance",
      projectedMvp: favorite?.playerInForm || null,
      predictedScore: diff > 8 ? "2-0" : diff > 2 ? "2-1" : diff < -8 ? "0-2" : diff < -2 ? "1-2" : "1-1",
      predictionConfidence: percent(0.48 + Math.min(Math.abs(diff), 30) / 100),
    };
  });
}

export class PowerRankingEngine {
  private readonly config: PowerRankingConfig;

  constructor(config: Partial<PowerRankingConfig> = {}) {
    this.config = {
      ...DEFAULT_POWER_RANKING_CONFIG,
      ...config,
      weights: { ...DEFAULT_POWER_RANKING_CONFIG.weights, ...(config.weights || {}) },
      recentMatchWeights: config.recentMatchWeights || DEFAULT_POWER_RANKING_CONFIG.recentMatchWeights,
    };
  }

  calculate(data: TournamentData, fixtures: LiveFixture[], now = Date.now()): PowerRankingResult {
    const matches = collectFinishedMatches(data, fixtures);
    const cacheKey = JSON.stringify({
      starts: data.starts.length,
      fixtures: fixtures.map(f => [f.ts, f.home, f.away, f.status, f.gh, f.ga]),
      now: Math.floor(now / 60000),
      weights: this.config.weights,
    });
    const cached = resultCache.get(cacheKey);
    if (cached) return cached;

    const previousMatches = matches.slice(0, -1);
    const previousRankings = previousMatches.length
      ? calculateCore(data, previousMatches, this.config)
      : [];
    const previous = previousRankings.length
      ? new Map(previousRankings.map(r => [canon(r.team), { rank: r.rank, score: r.score }]))
      : undefined;
    const trendMap = buildTrendMap(data, matches, this.config);
    const rankings = calculateCore(data, matches, this.config, previous, trendMap).map(r => ({
      ...r,
      strengthUpsetValue: r.momentum + (100 - r.championshipProbability) * 0.12,
    }));
    const previews = buildPreviews(data, rankings, matches);
    const byTeam = new Map(rankings.map(r => [canon(r.team), r]));
    for (const preview of previews) {
      const a = byTeam.get(canon(preview.teamA));
      const b = byTeam.get(canon(preview.teamB));
      if (a) a.winProbabilityNextMatch = preview.winProbabilityA;
      if (b) b.winProbabilityNextMatch = preview.winProbabilityB;
    }
    const result: PowerRankingResult = {
      rankings,
      sections: buildSections(rankings),
      insights: buildInsights(rankings),
      previews,
      matchesPlayed: matches.length,
      updatedAt: now,
    };
    resultCache.set(cacheKey, result);
    const oldestKey = resultCache.keys().next().value;
    if (resultCache.size > 24 && oldestKey) resultCache.delete(oldestKey);
    return result;
  }
}

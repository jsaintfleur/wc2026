import type { Prisma } from "./generated/prisma/client";
import type { MatchEvent } from "./data";
import { canon, canonPlayer } from "./merge";
import { VERIFIED_RESULTS } from "./verified-results";

export type LeaderboardStat = {
  name: string;
  team: string;
  imageUrl?: string | null;
  headshotUrl?: string | null;
  avatarUrl?: string | null;
  goals?: number;
  assists?: number;
  matches?: number;
};

export type LiveSnapshotPayload = {
  configured: boolean;
  active: boolean;
  ts: number;
  fixtures: unknown[];
  source: string;
  enrichment: unknown;
  leaderboardStats: LeaderboardStat[];
};

export type LiveSnapshot = {
  response: LiveSnapshotPayload;
  ts: number;
};

export type TimedCache<T> = {
  data: T;
  ts: number;
};

export const LIVE_SNAPSHOT_ACTIVE_TTL = 20 * 1000;
export const LIVE_SNAPSHOT_IDLE_TTL = 120 * 1000;

export function liveSnapshotTtl(active: boolean): number {
  return active ? LIVE_SNAPSHOT_ACTIVE_TTL : LIVE_SNAPSHOT_IDLE_TTL;
}

export function freshSnapshot(snapshot: LiveSnapshot | null, now: number, active: boolean): LiveSnapshot | null {
  if (!snapshot) return null;
  return now - snapshot.ts < liveSnapshotTtl(active) ? snapshot : null;
}

export async function readThroughTtlCache<T>(
  cache: TimedCache<T> | null,
  now: number,
  ttl: number,
  fetchFresh: () => Promise<T>,
  empty: T,
): Promise<{ data: T; cache: TimedCache<T> | null; stale: boolean }> {
  if (cache && now - cache.ts < ttl) {
    return { data: cache.data, cache, stale: false };
  }
  try {
    const data = await fetchFresh();
    return { data, cache: { data, ts: now }, stale: false };
  } catch {
    // Stale data is better than dropping leaderboards completely during a
    // transient vendor error. Empty is used only before any successful fetch.
    return { data: cache?.data ?? empty, cache, stale: !!cache };
  }
}

export function hasGoalAssistData(events: MatchEvent[] | undefined): boolean {
  return !!events?.some(ev => ev.type === "Goal" && ev.detail !== "Own Goal" && !!ev.assist);
}

export function normalizeWc26Status(timeElapsed: string, finished: string): { status: string; elapsed: number | null } {
  if (finished === "TRUE") return { status: "FT", elapsed: 90 };
  const token = (timeElapsed || "").trim().toLowerCase();
  switch (token) {
    case "finished": return { status: "FT", elapsed: 90 };
    case "halftime":
    case "half-time":
    case "ht": return { status: "HT", elapsed: 45 };
    case "notstarted":
    case "not_started":
    case "not started": return { status: "NS", elapsed: null };
    case "live":
    case "inplay":
    case "in_play":
    case "playing": return { status: "LIVE", elapsed: null };
    default: {
      // During live play, time_elapsed may be a minute number like "34" or "67".
      const min = parseInt(token, 10);
      if (!Number.isNaN(min)) {
        if (min <= 45) return { status: "1H", elapsed: min };
        if (min <= 90) return { status: "2H", elapsed: min };
        return { status: "ET", elapsed: min };
      }
      // Preserve an in-play posture for unexpected non-empty tokens. Falling
      // back to NS hides live fixtures when the vendor changes token wording.
      return token ? { status: "LIVE", elapsed: null } : { status: "NS", elapsed: null };
    }
  }
}

export function estimateLiveElapsed(status: string | null | undefined, kickoffTs: number, elapsed: number | null | undefined, nowMs = Date.now()): number | null {
  if (typeof elapsed === "number" && Number.isFinite(elapsed) && elapsed > 0) return elapsed;
  if (!status || !Number.isFinite(kickoffTs) || kickoffTs <= 0) return elapsed ?? null;
  if (status === "HT") return 45;
  if (!["1H", "2H", "ET", "BT", "P", "LIVE"].includes(status)) return elapsed ?? null;

  const wallMinutes = Math.floor((nowMs - kickoffTs) / 60000) + 1;
  if (wallMinutes < 1) return elapsed ?? null;

  if (status === "1H") return Math.min(wallMinutes, 90);
  if (status === "2H") return Math.min(Math.max(wallMinutes, 46), 90);
  if (status === "ET") return Math.min(Math.max(wallMinutes, 91), 120);
  return Math.min(wallMinutes, 120);
}

export function sameFixture(a: unknown, b: unknown): boolean {
  const left = a as { home?: string; away?: string };
  const right = b as { home?: string; away?: string };
  const lh = canon(left.home || "");
  const la = canon(left.away || "");
  const rh = canon(right.home || "");
  const ra = canon(right.away || "");
  const teamsMatch = (lh === rh && la === ra) || (lh === ra && la === rh);
  if (!teamsMatch) return false;
  // In this tournament model, each team pair appears once, so team-pair matching
  // is the strictest stable key shared across vendors and verified fixtures.
  return true;
}

export function withVerifiedResults(fixtures: unknown[] = []): unknown[] {
  // Verified results are manually confirmed and may carry corrected player names.
  // They replace only core fixture fields while preserving enrichment from vendors.
  const merged: unknown[] = [];
  for (const f of fixtures) {
    const verifiedMatch = VERIFIED_RESULTS.find(v => sameFixture(f, v));
    if (verifiedMatch) {
      const original = f as Record<string, unknown>;
      const verified = { ...verifiedMatch } as Record<string, unknown>;
      if (!verified.fixtureId && original.fixtureId) verified.fixtureId = original.fixtureId;
      if (!verified.players && original.players) verified.players = original.players;
      if (!verified.stats && original.stats) verified.stats = original.stats;
      if (!verified.lineups && original.lineups) verified.lineups = original.lineups;
      if (!verified.referee && original.referee) verified.referee = original.referee;
      merged.push(verified);
    } else {
      merged.push(f);
    }
  }
  for (const v of VERIFIED_RESULTS) {
    if (!merged.some(f => sameFixture(f, v))) merged.push(v);
  }
  return merged;
}

function slimPlayerProjection(players: unknown) {
  if (!Array.isArray(players) || players.length === 0) return undefined;
  const slim = players
    .map(player => {
      const p = player as {
        name?: unknown;
        team?: unknown;
        minutes?: unknown;
        goals?: unknown;
        assists?: unknown;
        yellowCards?: unknown;
        redCards?: unknown;
        imageUrl?: unknown;
        headshotUrl?: unknown;
        avatarUrl?: unknown;
      };
      if (!p.name || !p.team) return null;
      const out: Record<string, unknown> = { name: String(p.name), team: String(p.team) };
      if (typeof p.minutes === "number") out.minutes = p.minutes;
      if (typeof p.goals === "number" && p.goals > 0) out.goals = p.goals;
      if (typeof p.assists === "number" && p.assists > 0) out.assists = p.assists;
      if (typeof p.yellowCards === "number" && p.yellowCards > 0) out.yellowCards = p.yellowCards;
      if (typeof p.redCards === "number" && p.redCards > 0) out.redCards = p.redCards;
      if (typeof p.imageUrl === "string" && p.imageUrl) out.imageUrl = p.imageUrl;
      if (typeof p.headshotUrl === "string" && p.headshotUrl) out.headshotUrl = p.headshotUrl;
      if (typeof p.avatarUrl === "string" && p.avatarUrl) out.avatarUrl = p.avatarUrl;
      return out;
    })
    .filter((player): player is Record<string, unknown> => !!player);
  return slim.length ? slim : undefined;
}

export function slimFixtureForLiveList(fixture: unknown): unknown {
  const f = fixture as Record<string, unknown>;
  const slim: Record<string, unknown> = {
    ts: f.ts,
    status: f.status,
    elapsed: f.elapsed,
    venue: f.venue,
    round: f.round,
    home: f.home,
    away: f.away,
    gh: f.gh,
    ga: f.ga,
  };
  for (const key of ["penHome", "penAway", "assistDataMissing", "events", "referee", "fixtureId"] as const) {
    if (f[key] !== undefined) slim[key] = f[key];
  }
  const players = slimPlayerProjection(f.players);
  if (players) slim.players = players;
  return slim;
}

export function slimFixturesForLiveList(fixtures: unknown[]): unknown[] {
  return fixtures.map(slimFixtureForLiveList);
}

export function mergeAssistNames(targetEvents: MatchEvent[] | undefined, sourceEvents: MatchEvent[] | undefined): MatchEvent[] | undefined {
  if (!targetEvents?.length || !sourceEvents?.length || hasGoalAssistData(targetEvents)) return targetEvents;
  const withAssists = sourceEvents.filter(ev => ev.type === "Goal" && !!ev.assist);
  if (!withAssists.length) return targetEvents;
  let changed = false;
  const merged = targetEvents.map(ev => {
    if (ev.type !== "Goal" || ev.assist) return ev;
    const source = withAssists.find(candidate => {
      if (candidate.type !== "Goal") return false;
      const minuteClose = Math.abs((ev.minute || 0) - (candidate.minute || 0)) <= 1;
      return minuteClose && !!ev.player && canonPlayer(ev.player) === canonPlayer(candidate.player || "");
    });
    if (!source?.assist) return ev;
    changed = true;
    return { ...ev, assist: source.assist };
  });
  return changed ? merged : targetEvents;
}

export function assembleLiveFixtureBase(apiFootballFixtures: unknown[], wc26Fixtures: unknown[], wc26Ok: boolean): unknown[] {
  // API-Football is richer, so it wins first; worldcup26 fills missing scores,
  // scorer events, penalties, and live status where the richer feed is sparse.
  if (apiFootballFixtures.length > 0) {
    const base = [...apiFootballFixtures];
    for (const wf of wc26Fixtures) {
      const idx = base.findIndex(f => sameFixture(f, wf));
      if (idx === -1) {
        base.push(wf);
        continue;
      }
      const existing = base[idx] as { events?: unknown[]; gh?: unknown; ga?: unknown; penHome?: unknown; penAway?: unknown; status?: unknown; elapsed?: unknown };
      const wc26Fix = wf as { events?: unknown[]; gh?: unknown; ga?: unknown; penHome?: unknown; penAway?: unknown; status?: unknown; elapsed?: unknown };
      const target = base[idx] as Record<string, unknown>;
      if (existing.gh == null && wc26Fix.gh != null) target.gh = wc26Fix.gh;
      if (existing.ga == null && wc26Fix.ga != null) target.ga = wc26Fix.ga;
      if (existing.penHome == null && wc26Fix.penHome != null) target.penHome = wc26Fix.penHome;
      if (existing.penAway == null && wc26Fix.penAway != null) target.penAway = wc26Fix.penAway;
      if (!existing.status && wc26Fix.status) target.status = wc26Fix.status;
      if (typeof wc26Fix.elapsed === "number" && (existing.elapsed == null || (typeof existing.elapsed === "number" && wc26Fix.elapsed > existing.elapsed))) {
        target.elapsed = wc26Fix.elapsed;
      }
      const existingEvents = existing.events as MatchEvent[] | undefined;
      const wc26Events = wc26Fix.events as MatchEvent[] | undefined;
      const enrichedWc26Events = mergeAssistNames(wc26Events, existingEvents);
      if ((!existingEvents || existingEvents.length === 0) && enrichedWc26Events && enrichedWc26Events.length > 0) {
        target.events = enrichedWc26Events;
        target.assistDataMissing = !hasGoalAssistData(enrichedWc26Events);
      } else if (hasGoalAssistData(existingEvents)) {
        target.assistDataMissing = false;
      }
    }
    return base;
  }
  return wc26Ok ? wc26Fixtures : [];
}

export function parseRemainingQuota(remaining?: string | null): number {
  // Fail closed: a missing or malformed vendor quota header means "do not spend
  // detail requests" instead of assuming infinite quota.
  if (remaining == null) return 0;
  const parsed = Number(remaining);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function cappedDetailCandidates(fixtures: unknown[], needsDetail: (fixture: unknown) => boolean, cap: number): { selected: unknown[]; deferred: number } {
  const candidates = fixtures.filter(needsDetail);
  return {
    selected: candidates.slice(0, cap),
    deferred: Math.max(0, candidates.length - cap),
  };
}

export function fixtureFromDbMatch(match: {
  kickoffUtc: Date;
  venue: { commonName: string };
  round: string | null;
  stage: string;
  groupLetter: string | null;
  homeTeam: { name: string } | null;
  awayTeam: { name: string } | null;
  state: {
    status: string;
    elapsed: number | null;
    homeGoals: number | null;
    awayGoals: number | null;
    vendorFixtureId: bigint | null;
    events: Prisma.JsonValue | null;
    stats: Prisma.JsonValue | null;
    lineups: Prisma.JsonValue | null;
    players: Prisma.JsonValue | null;
    referee: string | null;
  } | null;
}): unknown | null {
  if (!match.state) return null;
  const state = match.state;
  return {
    ts: match.kickoffUtc.getTime(),
    status: state.status,
    elapsed: state.elapsed,
    venue: match.venue.commonName,
    round: match.round || (match.groupLetter ? `Group Stage - ${match.groupLetter}` : match.stage),
    home: match.homeTeam?.name || "",
    away: match.awayTeam?.name || "",
    gh: state.homeGoals,
    ga: state.awayGoals,
    fixtureId: state.vendorFixtureId ? Number(state.vendorFixtureId) : undefined,
    events: state.events || undefined,
    stats: state.stats || undefined,
    lineups: state.lineups || undefined,
    players: state.players || undefined,
    referee: state.referee || undefined,
  };
}

export function assembleStoredLiveFixtures(matches: Parameters<typeof fixtureFromDbMatch>[0][]): unknown[] {
  const stored = matches.map(fixtureFromDbMatch).filter((fixture): fixture is unknown => !!fixture);
  return slimFixturesForLiveList(withVerifiedResults(stored));
}

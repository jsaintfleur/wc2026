/* Team Journey model — turns a team's matches into an ordered travel story:
 * grouped venue stops, distances between them, and a tournament summary
 * (cities visited, kilometres travelled, current status). Pure functions,
 * no React — shared by the map view and covered by unit tests.
 *
 * Everything derives from canonical tournament data passed in by the
 * caller (schedule + live overlay). Nothing here is hardcoded per team.
 */

export interface JourneyVenue {
  venueId: string;
  city: string;
  stadiumName: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  /* Optional — shown in the collapsible stadium details on journey stops */
  capacity?: number;
}

export interface JourneyMatchInput {
  /* Stable key for React lists and match-detail lookups */
  key: string;
  no: number;
  venueId: string;
  ts: number;
  stage: string;
  opponent: string;
  status: "live" | "completed" | "upcoming";
  /* Display score like "2-1" or "1-1 (4-2 pens)" — empty when unplayed */
  score: string;
  /* Result from the selected team's perspective; null when not completed */
  result: "W" | "D" | "L" | null;
}

export interface JourneyStop {
  key: string;
  venue: JourneyVenue;
  matches: JourneyMatchInput[];
  /* Stop state drives the timeline styling: completed stops are solid,
     the live stop pulses, upcoming stops are dashed/dimmed. */
  state: "completed" | "live" | "upcoming";
  /* Great-circle distance from the previous stop; null for the first */
  distanceFromPrevKm: number | null;
  /* True for the first upcoming stop of an alive team — the "next
     destination" that the map highlights with a pulsing marker. */
  isNext: boolean;
  stopNumber: number;
}

export type JourneyStatus = "alive" | "eliminated" | "champion" | "not-started";

export interface JourneySummary {
  status: JourneyStatus;
  citiesVisited: number;
  totalDistanceKm: number;
  matchesPlayed: number;
  nextVenue: JourneyVenue | null;
  currentRound: string;
  /* For eliminated teams: where and against whom the journey ended */
  endedIn: { city: string; opponent: string } | null;
}

export interface TeamJourneyModel {
  stops: JourneyStop[];
  summary: JourneySummary;
  /* Route coordinates in stop order — completed portion and upcoming
     portion share the boundary point so the map can draw a solid line
     that turns dashed at the team's current position. */
  completedPath: [number, number][];
  upcomingPath: [number, number][];
}

const EARTH_RADIUS_KM = 6371;

/* Great-circle distance between two [lat, lng] points (haversine) */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h)));
}

/* Points along a gentle arc between two coordinates — used by the map to
 * draw flight-path style curves instead of straight lines. The control
 * point sits perpendicular to the midpoint, offset ~12% of the distance,
 * flipped by longitude direction so eastbound and westbound legs bow the
 * same visual way. */
export function arcPoints(a: [number, number], b: [number, number], segments = 24): [number, number][] {
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dx = b[1] - a[1];
  const dy = b[0] - a[0];
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return [a, b];
  /* Perpendicular unit vector, scaled — bow northward for west→east legs */
  const bow = 0.12 * dist * (dx >= 0 ? 1 : -1);
  const control: [number, number] = [mid[0] + (dx / dist) * bow, mid[1] - (dy / dist) * bow];
  const points: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const inv = 1 - t;
    points.push([
      inv * inv * a[0] + 2 * inv * t * control[0] + t * t * b[0],
      inv * inv * a[1] + 2 * inv * t * control[1] + t * t * b[1],
    ]);
  }
  return points;
}

/* Build a curved multi-leg path through the given stop coordinates */
export function buildArcPath(points: [number, number][]): [number, number][] {
  if (points.length < 2) return points;
  const path: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const leg = arcPoints(points[i], points[i + 1]);
    // Skip the first point of subsequent legs to avoid duplicates
    path.push(...(i === 0 ? leg : leg.slice(1)));
  }
  return path;
}

function stopState(matches: JourneyMatchInput[]): JourneyStop["state"] {
  if (matches.some(m => m.status === "live")) return "live";
  if (matches.every(m => m.status === "completed")) return "completed";
  return "upcoming";
}

/* Rounds in bracket order for the "current round" summary line */
function roundRank(stage: string): number {
  const s = stage.toLowerCase();
  if (s === "final") return 6;
  if (s.includes("third")) return 5;
  if (s.startsWith("semi")) return 4;
  if (s.startsWith("quarter")) return 3;
  if (s.includes("16")) return 2;
  if (s.includes("32")) return 1;
  return 0;
}

export interface JourneyOptions {
  /* True once knockout fixtures exist with resolved (non-TBD) teams — the
     signal that lets a group-stage exit be distinguished from "the next
     round's fixtures simply haven't been published yet". */
  knockoutStarted?: boolean;
}

export function buildTeamJourney(
  matches: JourneyMatchInput[],
  venues: Record<string, JourneyVenue>,
  options: JourneyOptions = {},
): TeamJourneyModel {
  const ordered = [...matches].sort((a, b) => a.ts - b.ts);

  /* Group consecutive same-venue matches into one stop. A later return to
     an earlier city is a NEW stop — the journey is chronological, so
     grouping must never merge across an intervening venue. */
  const stops: JourneyStop[] = [];
  for (const match of ordered) {
    const venue = venues[match.venueId];
    if (!venue) continue; // defensive: unknown venue never silently drops others
    const last = stops[stops.length - 1];
    if (last && last.venue.venueId === match.venueId) {
      last.matches.push(match);
    } else {
      stops.push({
        key: match.key,
        venue,
        matches: [match],
        state: "upcoming",
        distanceFromPrevKm: null,
        isNext: false,
        stopNumber: stops.length + 1,
      });
    }
  }

  /* Second pass: states, distances, next-destination flag */
  let totalDistanceKm = 0;
  for (let i = 0; i < stops.length; i++) {
    stops[i].state = stopState(stops[i].matches);
    if (i > 0) {
      const prev = stops[i - 1].venue;
      const cur = stops[i].venue;
      const km = haversineKm([prev.latitude, prev.longitude], [cur.latitude, cur.longitude]);
      stops[i].distanceFromPrevKm = km;
      totalDistanceKm += km;
    }
  }
  const firstUpcoming = stops.find(s => s.state === "upcoming");
  if (firstUpcoming) firstUpcoming.isNext = true;

  /* Summary */
  const completedMatches = ordered.filter(m => m.status === "completed");
  const liveMatch = ordered.find(m => m.status === "live");
  const upcoming = ordered.filter(m => m.status === "upcoming");
  const lastCompleted = completedMatches[completedMatches.length - 1];

  const wonFinal = !!completedMatches.find(m => m.stage.toLowerCase() === "final" && m.result === "W");
  const lostKnockout = completedMatches.find(m => roundRank(m.stage) > 0 && m.result === "L");
  const knockoutWins = completedMatches.filter(m => roundRank(m.stage) > 0 && m.result === "W");
  const hasKnockoutAppearance = ordered.some(m => roundRank(m.stage) > 0);
  let status: JourneyStatus;
  if (ordered.length === 0 || (completedMatches.length === 0 && !liveMatch)) status = "not-started";
  else if (wonFinal) status = "champion";
  /* Definitive elimination: lost a knockout tie. */
  else if (lostKnockout) status = "eliminated";
  else if (liveMatch || upcoming.length > 0) status = "alive";
  /* Nothing scheduled — disambiguate: a team that WON its latest knockout
     match is alive and simply awaiting the next round's published fixture;
     a team with no knockout appearance at all once the knockout is underway
     went out in the groups. Default to alive when the signal is missing —
     never declare a team eliminated on incomplete data. */
  else if (knockoutWins.length > 0) status = "alive";
  else if (!hasKnockoutAppearance && options.knockoutStarted) status = "eliminated";
  else status = "alive";

  const currentStage = liveMatch?.stage
    || upcoming[0]?.stage
    || lastCompleted?.stage
    || "Group Stage";

  const summary: JourneySummary = {
    status,
    citiesVisited: new Set(stops.filter(s => s.state !== "upcoming").map(s => s.venue.city)).size,
    totalDistanceKm,
    matchesPlayed: completedMatches.length,
    nextVenue: status === "alive" ? (firstUpcoming?.venue || null) : null,
    currentRound: currentStage,
    endedIn: status === "eliminated" && lastCompleted && venues[lastCompleted.venueId]
      ? { city: venues[lastCompleted.venueId].city, opponent: lastCompleted.opponent }
      : null,
  };

  /* Route paths: completed portion runs through every stop that has been
     reached (completed or live); the upcoming portion continues from the
     last reached stop to future venues. */
  const coords = stops.map(s => [s.venue.latitude, s.venue.longitude] as [number, number]);
  const lastReachedIdx = (() => {
    let idx = -1;
    stops.forEach((s, i) => { if (s.state !== "upcoming") idx = i; });
    return idx;
  })();
  const completedPath = lastReachedIdx >= 1 ? buildArcPath(coords.slice(0, lastReachedIdx + 1)) : [];
  const upcomingPath = lastReachedIdx >= 0 && lastReachedIdx < stops.length - 1
    ? buildArcPath(coords.slice(lastReachedIdx))
    : lastReachedIdx === -1 && coords.length >= 2
      ? buildArcPath(coords)
      : [];

  return { stops, summary, completedPath, upcomingPath };
}

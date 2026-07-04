/* Unit tests for the Team Journey model (lib/journey.ts) — grouping,
 * distances, status derivation, next-destination flagging, and route
 * path splitting. Run via `npm test` (tsx --test). */

import test from "node:test";
import assert from "node:assert/strict";
import { buildTeamJourney, haversineKm, buildArcPath, type JourneyMatchInput, type JourneyVenue } from "../lib/journey";

/* Minimal venue fixtures with real coordinates so distance math is honest */
const VENUES: Record<string, JourneyVenue> = {
  KC: { venueId: "KC", city: "Kansas City", stadiumName: "Arrowhead Stadium", country: "USA", latitude: 39.049, longitude: -94.4839, timezone: "America/Chicago" },
  DAL: { venueId: "DAL", city: "Dallas", stadiumName: "AT&T Stadium", country: "USA", latitude: 32.7473, longitude: -97.0945, timezone: "America/Chicago" },
  MIA: { venueId: "MIA", city: "Miami", stadiumName: "Hard Rock Stadium", country: "USA", latitude: 25.958, longitude: -80.2389, timezone: "America/New_York" },
  NYC: { venueId: "NYC", city: "New York / New Jersey", stadiumName: "MetLife Stadium", country: "USA", latitude: 40.8135, longitude: -74.0745, timezone: "America/New_York" },
};

let ts = 1780000000000;
function m(partial: Partial<JourneyMatchInput> & { venueId: string }): JourneyMatchInput {
  ts += 4 * 86400000;
  return {
    key: `m-${ts}`,
    no: 1,
    ts,
    stage: "Group Stage",
    opponent: "Rivalia",
    status: "completed",
    score: "1-0",
    result: "W",
    ...partial,
  };
}

test("groups only consecutive same-venue stops; a return creates a new stop", () => {
  const journey = buildTeamJourney([
    m({ venueId: "KC" }),
    m({ venueId: "DAL" }),
    m({ venueId: "DAL" }),
    m({ venueId: "MIA" }),
    m({ venueId: "DAL" }),
  ], VENUES);
  assert.deepEqual(journey.stops.map(s => s.venue.venueId), ["KC", "DAL", "MIA", "DAL"]);
  assert.equal(journey.stops[1].matches.length, 2);
  assert.equal(journey.stops[3].matches.length, 1);
  assert.deepEqual(journey.stops.map(s => s.stopNumber), [1, 2, 3, 4]);
});

test("never drops a venue between other stops (Miami regression)", () => {
  const journey = buildTeamJourney([
    m({ venueId: "KC" }),
    m({ venueId: "DAL" }),
    m({ venueId: "DAL" }),
    m({ venueId: "MIA", stage: "Round of 32" }),
  ], VENUES);
  assert.ok(journey.stops.some(s => s.venue.city === "Miami"));
  assert.equal(journey.stops.length, 3);
});

test("distances are plausible great-circle values and accumulate", () => {
  const kcDal = haversineKm([39.049, -94.4839], [32.7473, -97.0945]);
  assert.ok(kcDal > 600 && kcDal < 800, `KC→Dallas ${kcDal}km should be ~740km`);
  const journey = buildTeamJourney([m({ venueId: "KC" }), m({ venueId: "DAL" }), m({ venueId: "MIA" })], VENUES);
  assert.equal(journey.stops[0].distanceFromPrevKm, null);
  assert.equal(journey.stops[1].distanceFromPrevKm, kcDal);
  assert.equal(journey.summary.totalDistanceKm, journey.stops.reduce((sum, s) => sum + (s.distanceFromPrevKm || 0), 0));
});

test("alive team: next upcoming stop is flagged and summarized", () => {
  const journey = buildTeamJourney([
    m({ venueId: "KC" }),
    m({ venueId: "DAL" }),
    m({ venueId: "NYC", status: "upcoming", score: "", result: null, stage: "Quarter-final" }),
  ], VENUES);
  assert.equal(journey.summary.status, "alive");
  assert.equal(journey.summary.nextVenue?.city, "New York / New Jersey");
  assert.equal(journey.stops[2].isNext, true);
  assert.equal(journey.summary.currentRound, "Quarter-final");
  assert.equal(journey.summary.matchesPlayed, 2);
});

test("losing a knockout match marks the journey eliminated with an ending", () => {
  const journey = buildTeamJourney([
    m({ venueId: "KC" }),
    m({ venueId: "MIA", stage: "Round of 32", result: "L", score: "0-2", opponent: "Rivalia" }),
  ], VENUES);
  assert.equal(journey.summary.status, "eliminated");
  assert.deepEqual(journey.summary.endedIn, { city: "Miami", opponent: "Rivalia" });
  assert.equal(journey.summary.nextVenue, null);
});

test("group-stage exit is eliminated once the knockout is underway", () => {
  const journey = buildTeamJourney([
    m({ venueId: "KC", result: "L", score: "0-1" }),
    m({ venueId: "DAL", result: "D", score: "1-1" }),
    m({ venueId: "MIA", result: "L", score: "0-3" }),
  ], VENUES, { knockoutStarted: true });
  assert.equal(journey.summary.status, "eliminated");
});

test("a knockout winner awaiting the next round's fixture stays alive", () => {
  // The R16 fixture isn't published yet: no upcoming matches, but the team
  // won its R32 tie — it must NOT read as eliminated (Argentina regression).
  const journey = buildTeamJourney([
    m({ venueId: "KC" }),
    m({ venueId: "DAL" }),
    m({ venueId: "DAL" }),
    m({ venueId: "DAL", stage: "Round of 32", result: "W", score: "2-0" }),
  ], VENUES, { knockoutStarted: true });
  assert.equal(journey.summary.status, "alive");
  assert.equal(journey.summary.nextVenue, null);
});

test("no false elimination when the knockout-started signal is missing", () => {
  const journey = buildTeamJourney([
    m({ venueId: "KC", result: "L", score: "0-1" }),
    m({ venueId: "DAL", result: "D", score: "1-1" }),
    m({ venueId: "MIA", result: "L", score: "0-3" }),
  ], VENUES);
  assert.equal(journey.summary.status, "alive");
});

test("winning the final crowns a champion", () => {
  const journey = buildTeamJourney([
    m({ venueId: "DAL", stage: "Semi-final" }),
    m({ venueId: "NYC", stage: "Final", result: "W", score: "2-0" }),
  ], VENUES);
  assert.equal(journey.summary.status, "champion");
});

test("route paths split at the last reached stop", () => {
  const journey = buildTeamJourney([
    m({ venueId: "KC" }),
    m({ venueId: "DAL" }),
    m({ venueId: "NYC", status: "upcoming", score: "", result: null }),
  ], VENUES);
  assert.ok(journey.completedPath.length > 2, "completed arc has interpolated points");
  assert.ok(journey.upcomingPath.length > 2, "upcoming arc continues to the next venue");
  // Both paths share the boundary stop (Dallas)
  assert.deepEqual(journey.completedPath[journey.completedPath.length - 1], journey.upcomingPath[0]);
});

test("single stop: no distances, no paths, journey just started", () => {
  const journey = buildTeamJourney([m({ venueId: "KC", status: "live", result: null, score: "" })], VENUES);
  assert.equal(journey.stops.length, 1);
  assert.equal(journey.summary.totalDistanceKm, 0);
  assert.equal(journey.completedPath.length, 0);
  assert.equal(journey.upcomingPath.length, 0);
  assert.equal(journey.summary.status, "alive");
});

test("arc path interpolates without duplicate joints", () => {
  const path = buildArcPath([[39, -94], [32, -97], [26, -80]]);
  for (let i = 1; i < path.length; i++) {
    assert.notDeepEqual(path[i], path[i - 1], `duplicate point at ${i}`);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { groupConsecutiveJourneyStops } from "../lib/map-journey";

test("groups only consecutive same-venue journey stops", () => {
  const matches = [
    { key: "m1", venueId: "KC" },
    { key: "m2", venueId: "DAL" },
    { key: "m3", venueId: "DAL" },
    { key: "m4", venueId: "MIA" },
    { key: "m5", venueId: "DAL" },
  ];

  const groups = groupConsecutiveJourneyStops(matches);

  assert.deepEqual(groups.map(group => group.venueId), ["KC", "DAL", "MIA", "DAL"]);
  assert.deepEqual(groups.map(group => group.matches.length), [1, 2, 1, 1]);
});

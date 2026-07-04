import assert from "node:assert/strict";
import test from "node:test";
import { resolveFilteredVenueSelection } from "../lib/map-filters";

test("keeps selected venue when it remains inside the active filter", () => {
  const result = resolveFilteredVenueSelection("METLIFE", new Set(["METLIFE", "LINC"]), ["METLIFE", "LINC"]);
  assert.deepEqual(result, { venueId: "METLIFE", closePanel: false });
});

test("moves selected venue to the first matching venue when filter excludes it", () => {
  const result = resolveFilteredVenueSelection("METLIFE", new Set(["AZT", "BBVA"]), ["METLIFE", "AZT", "BBVA"]);
  assert.deepEqual(result, { venueId: "AZT", closePanel: false });
});

test("closes venue panel when no venue matches the active filter", () => {
  const result = resolveFilteredVenueSelection("METLIFE", new Set(), ["METLIFE", "AZT", "BBVA"]);
  assert.deepEqual(result, { venueId: null, closePanel: true });
});

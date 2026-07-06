/* Tests for knockout fixture → schedule-row attribution (persistence path). */

import test from "node:test";
import assert from "node:assert/strict";
import { attributeKnockoutFixtures, type KnockoutSlotRow, type KnockoutFixtureLite } from "../lib/knockout-persistence";

const HOUR = 3_600_000;
const T0 = 1783000000000;

const slot = (partial: Partial<KnockoutSlotRow> & { id: number }): KnockoutSlotRow => ({
  matchNumber: 90 + partial.id,
  kickoffTs: T0,
  stage: "knockout",
  hasTeams: false,
  ...partial,
});

const fx = (partial: Partial<KnockoutFixtureLite>): KnockoutFixtureLite => ({
  ts: T0,
  round: "Round of 16",
  home: "Alpha",
  away: "Beta",
  ...partial,
});

test("unique fixture within the window attributes to the knockout row", () => {
  const { attributions, skipped } = attributeKnockoutFixtures(
    [slot({ id: 1, kickoffTs: T0 }), slot({ id: 2, kickoffTs: T0 + 6 * HOUR })],
    [fx({ ts: T0 + 30 * 60_000 })],
  );
  assert.equal(skipped.length, 0);
  assert.equal(attributions.length, 1);
  assert.equal(attributions[0].slot.id, 1);
});

test("two knockout rows in the same window is ambiguous — skipped with a reason", () => {
  const { attributions, skipped } = attributeKnockoutFixtures(
    [slot({ id: 1 }), slot({ id: 2, kickoffTs: T0 + 10 * 60_000 })],
    [fx({})],
  );
  assert.equal(attributions.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /ambiguous/);
});

test("two fixtures competing for one row is ambiguous — both skipped", () => {
  const { attributions, skipped } = attributeKnockoutFixtures(
    [slot({ id: 1 })],
    [fx({ home: "Alpha", away: "Beta" }), fx({ home: "Gamma", away: "Delta", ts: T0 + 5 * 60_000 })],
  );
  assert.equal(attributions.length, 0);
  assert.equal(skipped.length, 2);
});

test("group-stage rows and rows with teams are never attribution targets", () => {
  const { attributions } = attributeKnockoutFixtures(
    [slot({ id: 1, stage: "group" }), slot({ id: 2, hasTeams: true })],
    [fx({})],
  );
  assert.equal(attributions.length, 0);
});

test("non-knockout fixture rounds are ignored", () => {
  const { attributions } = attributeKnockoutFixtures(
    [slot({ id: 1 })],
    [fx({ round: "Group Stage - A" })],
  );
  assert.equal(attributions.length, 0);
});

test("fixtures far outside every window produce no attribution and no noise", () => {
  const { attributions, skipped } = attributeKnockoutFixtures(
    [slot({ id: 1 })],
    [fx({ ts: T0 + 12 * HOUR })],
  );
  assert.equal(attributions.length, 0);
  assert.equal(skipped.length, 0);
});

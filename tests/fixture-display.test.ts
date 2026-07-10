import assert from "node:assert/strict";
import test from "node:test";
import type { LiveFixture } from "../lib/data";
import { alignFixtureToDisplayTeams } from "../lib/fixture-display";

const baseFixture: LiveFixture = {
  ts: Date.UTC(2026, 6, 4, 17),
  status: "FT",
  elapsed: 90,
  venue: "NRG Stadium",
  round: "Round of 16",
  home: "France",
  away: "Paraguay",
  gh: 2,
  ga: 1,
  penHome: 5,
  penAway: 4,
  events: [
    { minute: 12, extra: null, type: "Goal", detail: "Normal Goal", player: "Kylian Mbappé", assist: null, team: "France" },
    { minute: 56, extra: null, type: "Goal", detail: "Normal Goal", player: "Miguel Almirón", assist: null, team: "Paraguay" },
  ],
  stats: {
    home: { "Total Shots": 14 },
    away: { "Total Shots": 8 },
  },
  lineups: [
    { team: "France", formation: "4-3-3", startXI: [], substitutes: [] },
    { team: "Paraguay", formation: "4-2-3-1", startXI: [], substitutes: [] },
  ],
};

test("alignFixtureToDisplayTeams swaps scores and team-sided payloads when vendor order is reversed from the displayed knockout order", () => {
  const aligned = alignFixtureToDisplayTeams(baseFixture, "Paraguay", "France");

  assert.equal(aligned?.home, "Paraguay");
  assert.equal(aligned?.away, "France");
  assert.equal(aligned?.gh, 1);
  assert.equal(aligned?.ga, 2);
  assert.equal(aligned?.penHome, 4);
  assert.equal(aligned?.penAway, 5);
  assert.equal(aligned?.stats?.home["Total Shots"], 8);
  assert.equal(aligned?.stats?.away["Total Shots"], 14);
  assert.equal(aligned?.lineups?.[0].team, "Paraguay");
  assert.equal(aligned?.lineups?.[1].team, "France");
  assert.deepEqual(aligned?.events?.map(event => event.team), ["France", "Paraguay"]);
});

test("alignFixtureToDisplayTeams keeps scores intact when vendor order already matches the display order", () => {
  const aligned = alignFixtureToDisplayTeams(baseFixture, "France", "Paraguay");

  assert.equal(aligned?.home, "France");
  assert.equal(aligned?.away, "Paraguay");
  assert.equal(aligned?.gh, 2);
  assert.equal(aligned?.ga, 1);
});

test("alignFixtureToDisplayTeams does not invent alignment for unresolved bracket placeholders", () => {
  const aligned = alignFixtureToDisplayTeams(baseFixture, "Winner M73", "Winner M74");

  assert.equal(aligned, baseFixture);
});

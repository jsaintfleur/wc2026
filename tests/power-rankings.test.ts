import test from "node:test";
import assert from "node:assert/strict";
import { DATA, type LiveFixture } from "../lib/data";
import { PowerRankingEngine } from "../lib/power-rankings";

function fixture(input: Partial<LiveFixture> & Pick<LiveFixture, "ts" | "home" | "away" | "gh" | "ga">): LiveFixture {
  return {
    status: "FT",
    elapsed: 90,
    venue: "Test Venue",
    round: "Group Stage",
    stats: {
      home: { "Ball Possession": "60%", "Total Shots": 16, "Shots on Goal": 7, "Corner Kicks": 6, Fouls: 9, "Passes accurate": "420 (88%)" },
      away: { "Ball Possession": "40%", "Total Shots": 7, "Shots on Goal": 2, "Corner Kicks": 2, Fouls: 14, "Passes accurate": "260 (76%)" },
    },
    ...input,
  };
}

test("PowerRankingEngine returns deterministic rankings for identical inputs", () => {
  const engine = new PowerRankingEngine();
  const fixtures = [
    fixture({ ts: DATA.gs[0].ts, home: "Mexico", away: "South Africa", gh: 2, ga: 0 }),
    fixture({ ts: DATA.gs[24].ts, home: "Czechia", away: "South Africa", gh: 3, ga: 1 }),
  ];

  const first = engine.calculate(DATA, fixtures, 1781800000000);
  const second = engine.calculate(DATA, fixtures, 1781800000000);

  assert.deepEqual(
    first.rankings.slice(0, 8).map(r => [r.team, r.rank, r.score, r.status]),
    second.rankings.slice(0, 8).map(r => [r.team, r.rank, r.score, r.status]),
  );
});

test("ranking rewards dominance and completed-match evidence over idle teams", () => {
  const engine = new PowerRankingEngine();
  const result = engine.calculate(DATA, [
    fixture({ ts: DATA.gs[0].ts, home: "Mexico", away: "South Africa", gh: 3, ga: 0 }),
  ], 1781300000000);

  const mexico = result.rankings.find(r => r.team === "Mexico");
  const idle = result.rankings.find(r => r.team === "Argentina");

  assert.ok(mexico);
  assert.ok(idle);
  assert.ok(mexico!.score > idle!.score);
  assert.equal(mexico!.goals, 3);
  assert.equal(mexico!.cleanSheets, 1);
  assert.ok(mexico!.expectedGoals != null);
});

test("movement and trend snapshots update after later completed matches", () => {
  const engine = new PowerRankingEngine();
  const result = engine.calculate(DATA, [
    fixture({ ts: DATA.gs[0].ts, home: "Mexico", away: "South Africa", gh: 2, ga: 0 }),
    fixture({ ts: DATA.gs[27].ts, home: "Mexico", away: "South Korea", gh: 1, ga: 1 }),
  ], 1781900000000);

  const mexico = result.rankings.find(r => r.team === "Mexico");
  assert.ok(mexico);
  assert.ok(mexico!.trend.length >= 2);
  assert.notEqual(mexico!.previousRank, null);
  assert.notEqual(mexico!.movement, "NEW");
  assert.match(mexico!.movementReason, /Mexico/);
});

test("competitive status is generated from model state and eliminated knockout teams become eliminated", () => {
  const engine = new PowerRankingEngine();
  const result = engine.calculate(DATA, [
    fixture({ ts: DATA.gs[0].ts, home: "Mexico", away: "South Africa", gh: 2, ga: 0 }),
    fixture({ ts: DATA.ko[0].ts, round: "Round of 32", home: "Mexico", away: "France", gh: 0, ga: 1 }),
  ], 1782800000000);

  const mexico = result.rankings.find(r => r.team === "Mexico");
  assert.ok(mexico);
  assert.equal(mexico!.status, "Eliminated");
  assert.equal(mexico!.championshipProbability, 0);
});

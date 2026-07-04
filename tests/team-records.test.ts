/* Tests for the canonical team-record engine and the integrity validator. */

import test from "node:test";
import assert from "node:assert/strict";
import { buildTeamRecords, matchWinner, type RecordMatchInput } from "../lib/team-records";
import { validateTournamentIntegrity, auditTournament } from "../lib/integrity";

let ts = 1780000000000;
function m(partial: Partial<RecordMatchInput> & { home: string; away: string }): RecordMatchInput {
  ts += 86400000;
  return {
    key: `m-${ts}`,
    stage: "Group Stage",
    ts,
    status: "completed",
    gh: 1,
    ga: 0,
    ...partial,
  };
}

const TEAMS = ["Alpha", "Beta", "Gamma", "Delta"];

test("basic W-D-L, goals, points, and clean sheets accumulate correctly", () => {
  const records = buildTeamRecords(TEAMS, [
    m({ home: "Alpha", away: "Beta", gh: 2, ga: 0 }),
    m({ home: "Gamma", away: "Alpha", gh: 1, ga: 1 }),
    m({ home: "Alpha", away: "Delta", gh: 0, ga: 3 }),
  ]);
  const alpha = records.get("Alpha")!;
  assert.equal(alpha.played, 3);
  assert.deepEqual([alpha.wins, alpha.draws, alpha.losses], [1, 1, 1]);
  assert.equal(alpha.goalsFor, 3);
  assert.equal(alpha.goalsAgainst, 4);
  assert.equal(alpha.goalDiff, -1);
  assert.equal(alpha.groupPoints, 4);
  assert.equal(alpha.cleanSheets, 1);
});

test("penalty shootout: draw for both, winner advances, loser eliminated", () => {
  const records = buildTeamRecords(TEAMS, [
    m({ home: "Alpha", away: "Beta", stage: "Round of 32", gh: 1, ga: 1, penHome: 3, penAway: 4 }),
  ]);
  const alpha = records.get("Alpha")!;
  const beta = records.get("Beta")!;
  // FIFA convention: shootout ties are statistical draws for both sides
  assert.deepEqual([alpha.wins, alpha.draws, alpha.losses], [0, 1, 0]);
  assert.deepEqual([beta.wins, beta.draws, beta.losses], [0, 1, 0]);
  // But the knockout outcome is decisive
  assert.equal(beta.knockoutWins, 1);
  assert.equal(beta.penaltyWins, 1);
  assert.equal(alpha.eliminated, true, "pens loser must be eliminated");
  assert.equal(beta.alive, true);
});

test("group points are never awarded for knockout matches", () => {
  const records = buildTeamRecords(TEAMS, [
    m({ home: "Alpha", away: "Beta", stage: "Quarter-final", gh: 2, ga: 0 }),
  ]);
  assert.equal(records.get("Alpha")!.groupPoints, 0);
  assert.equal(records.get("Alpha")!.knockoutWins, 1);
});

test("remaining matches and next opponent come from the earliest unplayed", () => {
  const records = buildTeamRecords(TEAMS, [
    m({ home: "Alpha", away: "Beta", gh: 1, ga: 0 }),
    m({ home: "Alpha", away: "Gamma", status: "upcoming", gh: null, ga: null }),
    m({ home: "Delta", away: "Alpha", status: "upcoming", gh: null, ga: null, stage: "Round of 32" }),
  ]);
  const alpha = records.get("Alpha")!;
  assert.equal(alpha.remaining, 2);
  assert.equal(alpha.nextOpponent, "Gamma");
  assert.equal(alpha.nextStage, "Group Stage");
});

test("TBD opponents do not create phantom team records", () => {
  const records = buildTeamRecords(TEAMS, [
    m({ home: "Alpha", away: "TBD", status: "upcoming", gh: null, ga: null, stage: "Round of 16" }),
  ]);
  assert.equal(records.get("Alpha")!.nextOpponent, "TBD");
  assert.equal(records.has("TBD"), false);
});

test("group exit requires complete groups + non-qualification + no knockout tie", () => {
  const played = [
    m({ home: "Alpha", away: "Beta", gh: 0, ga: 2 }),
  ];
  const noSignal = buildTeamRecords(TEAMS, played);
  assert.equal(noSignal.get("Alpha")!.alive, true, "no group signal → alive");
  const withSignal = buildTeamRecords(TEAMS, played, {
    allGroupsComplete: true,
    groupQualifiers: new Set(["Beta"]),
  });
  assert.equal(withSignal.get("Alpha")!.eliminated, true);
  assert.equal(withSignal.get("Beta")!.alive, true);
});

test("integrity: clean data produces zero issues", () => {
  const matches = [
    m({ home: "Alpha", away: "Beta", gh: 2, ga: 1 }),
    m({ home: "Gamma", away: "Delta", gh: 0, ga: 0 }),
  ];
  const { issues } = auditTournament(TEAMS, matches);
  assert.deepEqual(issues, []);
});

test("integrity: duplicates, self-matches, and unknown teams are flagged", () => {
  const dup = m({ home: "Alpha", away: "Beta" });
  const { issues } = auditTournament(TEAMS, [
    dup,
    { ...dup },
    m({ home: "Gamma", away: "Gamma" }),
    m({ home: "Alpha", away: "Narnia" }),
  ]);
  const codes = issues.map(i => i.code);
  assert.ok(codes.includes("duplicate-match"));
  assert.ok(codes.includes("self-match"));
  assert.ok(codes.includes("unknown-team"));
});

test("integrity: goal balance and played totals reconcile", () => {
  const matches = [
    m({ home: "Alpha", away: "Beta", gh: 3, ga: 2 }),
    m({ home: "Gamma", away: "Delta", gh: 1, ga: 1 }),
  ];
  const records = buildTeamRecords(TEAMS, matches);
  const issues = validateTournamentIntegrity(TEAMS, matches, records);
  assert.deepEqual(issues, []);
  // Corrupt a record to prove the checks fire
  records.get("Alpha")!.goalsFor = 99;
  const corrupted = validateTournamentIntegrity(TEAMS, matches, records);
  assert.ok(corrupted.some(i => i.code === "goal-balance" || i.code === "goal-source" || i.code === "gd-mismatch"));
});

test("integrity: knockout loser appearing deeper is an error", () => {
  const matches = [
    m({ home: "Alpha", away: "Beta", stage: "Round of 32", gh: 0, ga: 1 }),
    m({ home: "Alpha", away: "Gamma", stage: "Round of 16", status: "upcoming", gh: null, ga: null }),
  ];
  const { issues } = auditTournament(TEAMS, matches);
  assert.ok(issues.some(i => i.code === "loser-advanced"));
});

test("integrity: drawn knockout tie without pens is flagged", () => {
  const { issues } = auditTournament(TEAMS, [
    m({ home: "Alpha", away: "Beta", stage: "Semi-final", gh: 1, ga: 1 }),
  ]);
  assert.ok(issues.some(i => i.code === "knockout-draw-unresolved"));
});

test("integrity: completed raw knockout fixtures must attach to resolved bracket matches", () => {
  const { issues } = auditTournament(TEAMS, [
    m({ home: "Alpha", away: "Beta", stage: "Round of 32", gh: 2, ga: 0 }),
  ], {
    rawFixtures: [{
      round: "Round of 32",
      home: "Gamma",
      away: "Delta",
      status: "FT",
      gh: 1,
      ga: 0,
    }],
  });

  assert.ok(issues.some(i => i.code === "unattached-knockout-fixture"));
});

test("matchWinner: regulation, pens, and undecided", () => {
  assert.equal(matchWinner(m({ home: "A", away: "B", gh: 2, ga: 1 })), "A");
  assert.equal(matchWinner(m({ home: "A", away: "B", gh: 1, ga: 1, penHome: 2, penAway: 4 })), "B");
  assert.equal(matchWinner(m({ home: "A", away: "B", gh: 1, ga: 1 })), null);
});

test("Paraguay vs France regression: upcoming knockout fixture counts for both teams but not played totals", () => {
  const paraguayFranceTs = Date.parse("2026-07-04T17:00:00.000Z");
  const matches: RecordMatchInput[] = [
    {
      key: "r32-germany-paraguay",
      stage: "Round of 32",
      ts: Date.parse("2026-06-29T20:30:00.000Z"),
      home: "Germany",
      away: "Paraguay",
      status: "completed",
      gh: 1,
      ga: 1,
      penHome: 3,
      penAway: 4,
    },
    {
      key: "r32-france-sweden",
      stage: "Round of 32",
      ts: Date.parse("2026-06-30T17:00:00.000Z"),
      home: "France",
      away: "Sweden",
      status: "completed",
      gh: 3,
      ga: 0,
    },
    {
      key: "r16-paraguay-france",
      stage: "Round of 16",
      ts: paraguayFranceTs,
      home: "Paraguay",
      away: "France",
      status: "upcoming",
      gh: null,
      ga: null,
    },
  ];

  const records = buildTeamRecords(["Paraguay", "France", "Germany", "Sweden"], matches);
  const paraguay = records.get("Paraguay")!;
  const france = records.get("France")!;

  assert.equal(matches.filter(match => [match.home, match.away].includes("Paraguay") && [match.home, match.away].includes("France")).length, 1);
  assert.equal(paraguay.played, 1, "future France match must not count as played for Paraguay");
  assert.equal(france.played, 1, "future Paraguay match must not count as played for France");
  assert.equal(paraguay.remaining, 1);
  assert.equal(france.remaining, 1);
  assert.equal(paraguay.nextOpponent, "France");
  assert.equal(france.nextOpponent, "Paraguay");
  assert.equal(paraguay.nextTs, paraguayFranceTs);
  assert.equal(france.nextTs, paraguayFranceTs);
  assert.equal(paraguay.nextStage, "Round of 16");
  assert.equal(france.nextStage, "Round of 16");
  assert.equal(paraguay.alive, true);
  assert.equal(france.alive, true);
});

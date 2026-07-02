import assert from "node:assert/strict";
import test from "node:test";
import type { LiveFixture, TournamentData } from "../lib/data";
import { buildTournamentStats } from "../lib/stats";

const baseData: TournamentData = {
  venues: {},
  groups: {
    A: ["United States", "Mexico"],
  },
  hosts: [],
  gs: [],
  ko: [],
  flags: {
    "United States": "🇺🇸",
    Mexico: "🇲🇽",
  },
  gcolor: {},
  starts: [],
};

test("aggregates assists from completed match events", () => {
  const fixtures: LiveFixture[] = [{
    ts: 1,
    status: "FT",
    elapsed: 90,
    venue: "Test Stadium",
    round: "Group Stage",
    home: "United States",
    away: "Mexico",
    gh: 2,
    ga: 0,
    events: [
      { minute: 12, extra: null, type: "Goal", detail: "Normal Goal", player: "Folarin Balogun", assist: "Christian Pulisic", team: "United States" },
      { minute: 44, extra: null, type: "Goal", detail: "Normal Goal", player: "Gio Reyna", assist: "Christian Pulisic", team: "United States" },
    ],
  }];

  const stats = buildTournamentStats(baseData, fixtures);

  assert.equal(stats.topAssisters[0].name, "Christian Pulisic");
  assert.equal(stats.topAssisters[0].assists, 2);
  assert.equal(stats.matchesWithAssistData, 1);
});

test("updates assist leaderboard from live match events before full time", () => {
  const fixtures: LiveFixture[] = [{
    ts: 2,
    status: "1H",
    elapsed: 18,
    venue: "Test Stadium",
    round: "Group Stage",
    home: "United States",
    away: "Mexico",
    gh: 1,
    ga: 0,
    events: [
      { minute: 18, extra: null, type: "Goal", detail: "Normal Goal", player: "Ricardo Pepi", assist: "Timothy Weah", team: "United States" },
    ],
  }];

  const stats = buildTournamentStats(baseData, fixtures);

  assert.equal(stats.topAssisters[0].name, "Timothy Weah");
  assert.equal(stats.topAssisters[0].assists, 1);
  assert.equal(stats.matchesPlayed, 0);
});

test("falls back to player match stats when event data is unavailable", () => {
  const fixtures: LiveFixture[] = [{
    ts: 3,
    status: "FT",
    elapsed: 90,
    venue: "Test Stadium",
    round: "Group Stage",
    home: "United States",
    away: "Mexico",
    gh: 1,
    ga: 1,
    players: [
      {
        name: "Hirving Lozano",
        number: 22,
        team: "Mexico",
        minutes: 90,
        rating: "7.4",
        goals: 0,
        assists: 1,
        shots: 1,
        shotsOn: 0,
        passes: 21,
        passAccuracy: "82%",
        tackles: 1,
        duels: 4,
        duelsWon: 2,
        dribbles: 2,
        dribblesSuccess: 1,
        foulsDrawn: 1,
        foulsCommitted: 0,
        yellowCards: 0,
        redCards: 0,
        saves: 0,
      },
    ],
  }];

  const stats = buildTournamentStats(baseData, fixtures);

  assert.equal(stats.topAssisters[0].name, "Hirving Lozano");
  assert.equal(stats.topAssisters[0].assists, 1);
  assert.equal(stats.matchesWithAssistData, 1);
});

test("uses player assist totals when events exist without assist data", () => {
  const fixtures: LiveFixture[] = [{
    ts: 5,
    status: "FT",
    elapsed: 90,
    venue: "Test Stadium",
    round: "Group Stage",
    home: "United States",
    away: "Mexico",
    gh: 1,
    ga: 0,
    events: [
      { minute: 18, extra: null, type: "Goal", detail: "Normal Goal", player: "Ricardo Pepi", assist: null, team: "United States" },
    ],
    players: [
      {
        name: "Timothy Weah",
        number: 21,
        team: "United States",
        minutes: 90,
        rating: "7.8",
        goals: 0,
        assists: 1,
        shots: 1,
        shotsOn: 0,
        passes: 30,
        passAccuracy: "88%",
        tackles: 1,
        duels: 5,
        duelsWon: 3,
        dribbles: 1,
        dribblesSuccess: 1,
        foulsDrawn: 0,
        foulsCommitted: 0,
        yellowCards: 0,
        redCards: 0,
        saves: 0,
      },
    ],
  }];

  const stats = buildTournamentStats(baseData, fixtures);

  assert.equal(stats.topScorers[0].name, "Ricardo Pepi");
  assert.equal(stats.topAssisters[0].name, "Timothy Weah");
  assert.equal(stats.topAssisters[0].assists, 1);
  assert.equal(stats.matchesWithAssistData, 1);
});

test("prefers player assist totals over event assists when both sources exist", () => {
  const fixtures: LiveFixture[] = [{
    ts: 7,
    status: "FT",
    elapsed: 90,
    venue: "Test Stadium",
    round: "Group Stage",
    home: "United States",
    away: "Mexico",
    gh: 2,
    ga: 0,
    events: [
      { minute: 18, extra: null, type: "Goal", detail: "Normal Goal", player: "Ricardo Pepi", assist: "Timothy Weah", team: "United States" },
      { minute: 55, extra: null, type: "Goal", detail: "Normal Goal", player: "Folarin Balogun", assist: "Timothy Weah", team: "United States" },
    ],
    players: [
      {
        name: "Timothy Weah",
        number: 21,
        team: "United States",
        minutes: 90,
        rating: "8.1",
        goals: 0,
        assists: 2,
        shots: 1,
        shotsOn: 0,
        passes: 30,
        passAccuracy: "88%",
        tackles: 1,
        duels: 5,
        duelsWon: 3,
        dribbles: 1,
        dribblesSuccess: 1,
        foulsDrawn: 0,
        foulsCommitted: 0,
        yellowCards: 0,
        redCards: 0,
        saves: 0,
      },
    ],
  }];

  const stats = buildTournamentStats(baseData, fixtures);

  assert.equal(stats.topAssisters[0].name, "Timothy Weah");
  assert.equal(stats.topAssisters[0].assists, 2);
  assert.equal(stats.matchesWithAssistData, 1);
});

test("drops malformed country names from player leaderboards", () => {
  const fixtures: LiveFixture[] = [{
    ts: 6,
    status: "FT",
    elapsed: 90,
    venue: "Test Stadium",
    round: "Group Stage",
    home: "United States",
    away: "Mexico",
    gh: 1,
    ga: 0,
    events: [
      { minute: 18, extra: null, type: "Goal", detail: "Normal Goal", player: "United States", assist: null, team: "United States" },
      { minute: 40, extra: null, type: "Card", detail: "Yellow Card", player: "Mexico", assist: null, team: "Mexico" },
    ],
  }];

  const stats = buildTournamentStats(baseData, fixtures);

  assert.equal(stats.topScorers.length, 0);
  assert.equal(stats.topYellowCards.length, 0);
});

test("uses the same normalized model for goals and cards", () => {
  const fixtures: LiveFixture[] = [{
    ts: 4,
    status: "FT",
    elapsed: 90,
    venue: "Test Stadium",
    round: "Group Stage",
    home: "United States",
    away: "Mexico",
    gh: 1,
    ga: 0,
    events: [
      { minute: 10, extra: null, type: "Goal", detail: "Normal Goal", player: "Folarin Balogun", assist: null, team: "United States" },
      { minute: 30, extra: null, type: "Card", detail: "Yellow Card", player: "Edson Álvarez", assist: null, team: "Mexico" },
      { minute: 70, extra: null, type: "Card", detail: "Red Card", player: "Edson Álvarez", assist: null, team: "Mexico" },
    ],
  }];

  const stats = buildTournamentStats(baseData, fixtures);

  assert.equal(stats.topScorers[0].name, "Folarin Balogun");
  assert.equal(stats.topYellowCards[0].name, "Edson Álvarez");
  assert.equal(stats.topRedCards[0].name, "Edson Álvarez");
});

test("separates match-score goal totals from credited player leaderboard goals", () => {
  const fixtures = [
    {
      home: "United States",
      away: "Mexico",
      gh: 3,
      ga: 2,
      status: "FT",
      ts: Date.UTC(2026, 5, 11),
      events: [
        { type: "Goal", team: "United States", player: "Christian Pulisic", minute: 10, assist: "Timothy Weah" },
      ],
    },
  ];

  const stats = buildTournamentStats(baseData, fixtures);

  assert.equal(stats.totalGoals, 5);
  assert.equal(stats.totalGoalsFromEvents, 1);
  assert.equal(stats.totalPlayerGoals, 1);
  assert.equal(stats.totalAssists, 1);
  assert.equal(stats.topScorers[0].goals, 1);
  assert.equal(stats.topAssisters[0].name, "Timothy Weah");
});

test("keeps richer persisted player assists when live fixture payload is thinner", () => {
  const dataWithPersistedState: TournamentData = {
    ...baseData,
    gs: [{
      no: 1,
      iso: "2026-06-11",
      local: "12:00",
      et: "3:00 PM",
      g: "A",
      t1: "United States",
      t2: "Mexico",
      v: "TST",
      ts: Date.UTC(2026, 5, 11),
      dbStatus: "FT",
      dbGh: 1,
      dbGa: 0,
      dbPlayers: [{
        name: "Michael Olise",
        number: 11,
        team: "United States",
        minutes: 90,
        rating: "8.5",
        goals: 0,
        assists: 5,
        shots: 1,
        shotsOn: 1,
        passes: 45,
        passAccuracy: "90%",
        tackles: 0,
        duels: 3,
        duelsWon: 2,
        dribbles: 2,
        dribblesSuccess: 2,
        foulsDrawn: 1,
        foulsCommitted: 0,
        yellowCards: 0,
        redCards: 0,
        saves: 0,
      }],
    }],
  };

  const fixtures: LiveFixture[] = [{
    ts: Date.UTC(2026, 5, 11),
    status: "FT",
    elapsed: 90,
    venue: "Test Stadium",
    round: "Group Stage",
    home: "United States",
    away: "Mexico",
    gh: 1,
    ga: 0,
    events: [
      { minute: 20, extra: null, type: "Goal", detail: "Normal Goal", player: "Christian Pulisic", assist: null, team: "United States" },
    ],
  }];

  const stats = buildTournamentStats(dataWithPersistedState, fixtures);

  assert.equal(stats.topAssisters[0].name, "Michael Olise");
  assert.equal(stats.topAssisters[0].assists, 5);
  assert.equal(stats.matchesWithAssistData, 1);
});

test("keeps richer persisted player assists when live players are present but lower quality", () => {
  const dataWithPersistedState: TournamentData = {
    ...baseData,
    gs: [{
      no: 1,
      iso: "2026-06-11",
      local: "12:00",
      et: "3:00 PM",
      g: "A",
      t1: "France",
      t2: "Mexico",
      v: "TST",
      ts: Date.UTC(2026, 5, 11),
      dbStatus: "FT",
      dbGh: 3,
      dbGa: 0,
      dbPlayers: [{
        name: "Michael Olise",
        number: 11,
        team: "France",
        minutes: 90,
        rating: "8.5",
        goals: 0,
        assists: 5,
        shots: 1,
        shotsOn: 1,
        passes: 45,
        passAccuracy: "90%",
        tackles: 0,
        duels: 3,
        duelsWon: 2,
        dribbles: 2,
        dribblesSuccess: 2,
        foulsDrawn: 1,
        foulsCommitted: 0,
        yellowCards: 0,
        redCards: 0,
        saves: 0,
      }],
    }],
  };

  const fixtures: LiveFixture[] = [{
    ts: Date.UTC(2026, 5, 11),
    status: "FT",
    elapsed: 90,
    venue: "Test Stadium",
    round: "Group Stage",
    home: "France",
    away: "Mexico",
    gh: 3,
    ga: 0,
    players: [{
      name: "Alexander Isak",
      number: 9,
      team: "France",
      minutes: 90,
      rating: "7.5",
      goals: 0,
      assists: 3,
      shots: 1,
      shotsOn: 1,
      passes: 30,
      passAccuracy: "80%",
      tackles: 0,
      duels: 1,
      duelsWon: 1,
      dribbles: 0,
      dribblesSuccess: 0,
      foulsDrawn: 0,
      foulsCommitted: 0,
      yellowCards: 0,
      redCards: 0,
      saves: 0,
    }],
  }];

  const stats = buildTournamentStats(dataWithPersistedState, fixtures);

  assert.equal(stats.topAssisters[0].name, "Michael Olise");
  assert.equal(stats.topAssisters[0].assists, 5);
});

test("uses external leaderboard assists when match feeds are incomplete", () => {
  const fixtures: LiveFixture[] = [{
    ts: Date.UTC(2026, 5, 11),
    status: "FT",
    elapsed: 90,
    venue: "Test Stadium",
    round: "Group Stage",
    home: "France",
    away: "Mexico",
    gh: 1,
    ga: 0,
    players: [{
      name: "Alexander Isak",
      number: 9,
      team: "Sweden",
      minutes: 90,
      rating: "7.5",
      goals: 0,
      assists: 3,
      shots: 1,
      shotsOn: 1,
      passes: 30,
      passAccuracy: "80%",
      tackles: 0,
      duels: 1,
      duelsWon: 1,
      dribbles: 0,
      dribblesSuccess: 0,
      foulsDrawn: 0,
      foulsCommitted: 0,
      yellowCards: 0,
      redCards: 0,
      saves: 0,
    }],
  }];

  const stats = buildTournamentStats(baseData, fixtures, {
    players: [{ name: "Michael Olise", team: "France", assists: 5, matches: 4 }],
  });

  assert.equal(stats.topAssisters[0].name, "Michael Olise");
  assert.equal(stats.topAssisters[0].assists, 5);
});

test("prefers player card totals when events and player stats both exist", () => {
  const fixtures: LiveFixture[] = [{
    ts: Date.UTC(2026, 5, 11),
    status: "FT",
    elapsed: 90,
    venue: "Test Stadium",
    round: "Group Stage",
    home: "United States",
    away: "Mexico",
    gh: 1,
    ga: 0,
    events: [
      { minute: 20, extra: null, type: "Card", detail: "Yellow Card", player: "Tyler Adams", assist: null, team: "United States" },
    ],
    players: [{
      name: "Edson Álvarez",
      number: 4,
      team: "Mexico",
      minutes: 90,
      rating: "6.8",
      goals: 0,
      assists: 0,
      shots: 0,
      shotsOn: 0,
      passes: 40,
      passAccuracy: "85%",
      tackles: 4,
      duels: 7,
      duelsWon: 5,
      dribbles: 0,
      dribblesSuccess: 0,
      foulsDrawn: 1,
      foulsCommitted: 2,
      yellowCards: 2,
      redCards: 1,
      saves: 0,
    }],
  }];

  const stats = buildTournamentStats(baseData, fixtures);

  assert.equal(stats.totalYellows, 2);
  assert.equal(stats.totalReds, 1);
  assert.equal(stats.topYellowCards[0].name, "Edson Álvarez");
  assert.equal(stats.topRedCards[0].name, "Edson Álvarez");
});

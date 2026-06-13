import type { LiveFixture } from "./data";

// Verified full-time results used when the live-score vendor feed is empty.
// Keep this list narrow: only final scores confirmed by public match reports.
export const VERIFIED_RESULTS: LiveFixture[] = [
  {
    ts: 1781204400000,
    status: "FT",
    elapsed: 90,
    venue: "Estadio Azteca",
    round: "Group Stage - 1",
    home: "Mexico",
    away: "South Africa",
    gh: 2,
    ga: 0,
    events: [
      { minute: 9, extra: null, type: "Goal", detail: "Normal Goal", player: "Julián Quiñones", assist: null, team: "Mexico" },
      { minute: 67, extra: null, type: "Goal", detail: "Normal Goal", player: "Raúl Jiménez", assist: null, team: "Mexico" },
    ],
  },
  {
    ts: 1781229600000,
    status: "FT",
    elapsed: 90,
    venue: "Estadio Akron",
    round: "Group Stage - 1",
    home: "South Korea",
    away: "Czechia",
    gh: 2,
    ga: 1,
    events: [
      { minute: 59, extra: null, type: "Goal", detail: "Normal Goal", player: "Ladislav Krejčí", assist: null, team: "Czechia" },
      { minute: 67, extra: null, type: "Goal", detail: "Normal Goal", player: "Hwang In-beom", assist: null, team: "South Korea" },
      { minute: 80, extra: null, type: "Goal", detail: "Normal Goal", player: "Oh Hyeon-gyu", assist: "Hwang In-beom", team: "South Korea" },
    ],
  },
  {
    ts: 1781290800000,
    status: "FT",
    elapsed: 90,
    venue: "BMO Field",
    round: "Group Stage - 1",
    home: "Canada",
    away: "Bosnia & Herzegovina",
    gh: 1,
    ga: 1,
    events: [
      { minute: 21, extra: null, type: "Goal", detail: "Normal Goal", player: "Jovo Lukic", assist: null, team: "Bosnia & Herzegovina" },
      { minute: 78, extra: null, type: "Goal", detail: "Normal Goal", player: "Cyle Larin", assist: "Promise David", team: "Canada" },
    ],
  },
  {
    ts: 1781312400000,
    status: "FT",
    elapsed: 90,
    venue: "SoFi Stadium",
    round: "Group Stage - 1",
    home: "United States",
    away: "Paraguay",
    gh: 4,
    ga: 1,
    events: [
      { minute: 7, extra: null, type: "Goal", detail: "Own Goal", player: "Damián Bobadilla", assist: null, team: "Paraguay" },
      { minute: 31, extra: null, type: "Goal", detail: "Normal Goal", player: "Folarin Balogun", assist: "Christian Pulisic", team: "United States" },
      { minute: 45, extra: 5, type: "Goal", detail: "Normal Goal", player: "Folarin Balogun", assist: "Tyler Adams", team: "United States" },
      { minute: 73, extra: null, type: "Goal", detail: "Normal Goal", player: "Mauricio", assist: "Julio Enciso", team: "Paraguay" },
      { minute: 90, extra: 8, type: "Goal", detail: "Normal Goal", player: "Gio Reyna", assist: "Timothy Weah", team: "United States" },
    ],
  },
];

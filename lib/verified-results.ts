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
];

import assert from "node:assert/strict";
import test from "node:test";
import { claimKnockoutFixtureForSlot, type KnockoutSlotParticipant } from "../lib/knockout-fixtures";
import type { LiveFixture } from "../lib/data";

function fixture(partial: Partial<LiveFixture> & { home: string; away: string; ts: number; venue: string }): LiveFixture {
  return {
    round: "Round of 32",
    status: "FT",
    elapsed: 90,
    gh: 3,
    ga: 0,
    ...partial,
  };
}

test("does not attach a direct time/venue fixture when teams contradict the slot", () => {
  const franceSweden = fixture({
    ts: Date.parse("2026-06-30T17:00:00.000Z"),
    venue: "AT&T Stadium",
    home: "France",
    away: "Sweden",
  });
  const slotTeams: KnockoutSlotParticipant[] = [
    { name: "Ivory Coast" },
    { name: "Senegal" },
  ];

  const claimed = new Set<string>();
  const attached = claimKnockoutFixtureForSlot({
    directFixture: franceSweden,
    fixtures: [franceSweden],
    round: "Round of 32",
    slotTeams,
    claimedFixtureKeys: claimed,
  });

  assert.equal(attached, null);
});

test("attaches one completed unclaimed fixture by resolved slot team fallback", () => {
  const franceSweden = fixture({
    ts: Date.parse("2026-06-30T17:00:00.000Z"),
    venue: "AT&T Stadium",
    home: "France",
    away: "Sweden",
  });
  const slotTeams: KnockoutSlotParticipant[] = [
    { name: "France", seed: "1st Group I" },
    { name: "3rd Place Group C/D/F/G/H", placeholder: true },
  ];

  const attached = claimKnockoutFixtureForSlot({
    directFixture: null,
    fixtures: [franceSweden],
    round: "Round of 32",
    slotTeams,
    claimedFixtureKeys: new Set<string>(),
  });

  assert.equal(attached, franceSweden);
});

test("leaves ambiguous fallback unresolved", () => {
  const franceSweden = fixture({
    ts: Date.parse("2026-06-30T17:00:00.000Z"),
    venue: "AT&T Stadium",
    home: "France",
    away: "Sweden",
  });
  const franceJapan = fixture({
    ts: Date.parse("2026-06-30T21:00:00.000Z"),
    venue: "MetLife Stadium",
    home: "France",
    away: "Japan",
  });

  const attached = claimKnockoutFixtureForSlot({
    directFixture: null,
    fixtures: [franceSweden, franceJapan],
    round: "Round of 32",
    slotTeams: [{ name: "France" }, { name: "TBD", placeholder: true }],
    claimedFixtureKeys: new Set<string>(),
  });

  assert.equal(attached, null);
});

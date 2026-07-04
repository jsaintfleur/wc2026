import type { LiveFixture } from "./data";
import { canon } from "./merge";

const COMPLETED_KNOCKOUT_STATUSES = new Set(["FT", "AET", "PEN", "PEN_LIVE", "WO", "AWD"]);

export type KnockoutSlotParticipant = {
  name: string;
  seed?: string;
  placeholder?: boolean;
};

export function knockoutFixtureKey(fixture: Pick<LiveFixture, "ts" | "home" | "away" | "round">): string {
  const teams = [canon(fixture.home), canon(fixture.away)].sort().join("|");
  return `${fixture.round}|${fixture.ts}|${teams}`;
}

export function isDecidedKnockoutFixture(fixture: Pick<LiveFixture, "status" | "gh" | "ga" | "penHome" | "penAway">): boolean {
  if (!COMPLETED_KNOCKOUT_STATUSES.has(fixture.status) || fixture.gh == null || fixture.ga == null) return false;
  return fixture.gh !== fixture.ga ||
    (fixture.penHome != null && fixture.penAway != null && fixture.penHome !== fixture.penAway);
}

function sameRound(fixtureRound: string | undefined, slotRound: string): boolean {
  const fixture = (fixtureRound || "").toLowerCase();
  const slot = slotRound.toLowerCase();
  return !!fixture && (fixture === slot || fixture.includes(slot) || slot.includes(fixture));
}

function fixtureTeamSet(fixture: Pick<LiveFixture, "home" | "away">): Set<string> {
  return new Set([canon(fixture.home), canon(fixture.away)].filter(Boolean));
}

function resolvedSlotTeams(slotTeams: KnockoutSlotParticipant[]): string[] {
  return slotTeams
    .filter(team => !team.placeholder && team.name !== "TBD")
    .map(team => canon(team.name))
    .filter(Boolean);
}

export function fixtureFitsResolvedSlot(
  fixture: Pick<LiveFixture, "home" | "away">,
  slotTeams: KnockoutSlotParticipant[],
): boolean {
  const slot = resolvedSlotTeams(slotTeams);
  if (!slot.length) return false;
  const fixtureTeams = fixtureTeamSet(fixture);
  if (slot.length >= 2) return slot.every(team => fixtureTeams.has(team));
  return fixtureTeams.has(slot[0]);
}

export function claimKnockoutFixtureForSlot(options: {
  directFixture: LiveFixture | null;
  fixtures: LiveFixture[];
  round: string;
  slotTeams: KnockoutSlotParticipant[];
  claimedFixtureKeys: Set<string>;
}): LiveFixture | null {
  const { directFixture, fixtures, round, slotTeams, claimedFixtureKeys } = options;

  if (directFixture) {
    const key = knockoutFixtureKey(directFixture);
    if (!claimedFixtureKeys.has(key) && fixtureFitsResolvedSlot(directFixture, slotTeams)) {
      claimedFixtureKeys.add(key);
      return directFixture;
    }
  }

  const fallbackCandidates = fixtures.filter(fixture => {
    const key = knockoutFixtureKey(fixture);
    return !claimedFixtureKeys.has(key) &&
      sameRound(fixture.round, round) &&
      isDecidedKnockoutFixture(fixture) &&
      fixtureFitsResolvedSlot(fixture, slotTeams);
  });

  if (fallbackCandidates.length !== 1) return null;
  const fallback = fallbackCandidates[0];
  claimedFixtureKeys.add(knockoutFixtureKey(fallback));
  return fallback;
}

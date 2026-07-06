/* Knockout fixture → schedule-row attribution for persistence.
 *
 * Knockout rows in the database are created as placeholders (null team
 * ids), and the strict pair-merge used for group matches requires both
 * team names — so completed knockout fixtures never persisted, leaving
 * /api/match/:no empty for every knockout tie. Knockout kickoffs are
 * unique in the real schedule, so a timestamp window identifies the row —
 * but vendor feeds can synthesize colliding timestamps, so attribution
 * happens ONLY when the mapping is unambiguous in both directions:
 * exactly one candidate row for the fixture AND exactly one candidate
 * fixture for that row. Anything ambiguous is skipped and reported.
 */

import { knockoutRoundDepth } from "./team-records";

export interface KnockoutSlotRow {
  id: number;
  matchNumber: number;
  kickoffTs: number;
  /* "group" rows are never attribution targets */
  stage: string;
  /* Rows that already carry both team names take the normal named
     pair-merge path — exclude them here to avoid double writes. */
  hasTeams: boolean;
}

export interface KnockoutFixtureLite {
  ts: number;
  round?: string;
  home: string;
  away: string;
}

export interface KnockoutAttribution {
  fixtureIndex: number;
  slot: KnockoutSlotRow;
}

export interface KnockoutAttributionResult {
  attributions: KnockoutAttribution[];
  /* Human-readable reasons for skipped fixtures — surfaced in dev logs */
  skipped: string[];
}

const DEFAULT_WINDOW_MS = 75 * 60_000;

export function attributeKnockoutFixtures(
  slots: KnockoutSlotRow[],
  fixtures: KnockoutFixtureLite[],
  windowMs = DEFAULT_WINDOW_MS,
): KnockoutAttributionResult {
  const targets = slots.filter(slot => slot.stage !== "group" && !slot.hasTeams);
  const attributions: KnockoutAttribution[] = [];
  const skipped: string[] = [];

  /* Precompute candidates in both directions */
  const slotCandidates = new Map<number, KnockoutSlotRow[]>(); // fixtureIndex → slots
  const fixtureCandidates = new Map<number, number[]>(); // slot.id → fixtureIndexes

  fixtures.forEach((fixture, index) => {
    if (knockoutRoundDepth(fixture.round || "") === 0) return; // not knockout
    const near = targets.filter(slot => Math.abs(slot.kickoffTs - fixture.ts) <= windowMs);
    slotCandidates.set(index, near);
    for (const slot of near) {
      const list = fixtureCandidates.get(slot.id) || [];
      list.push(index);
      fixtureCandidates.set(slot.id, list);
    }
  });

  for (const [index, candidates] of slotCandidates) {
    const fixture = fixtures[index];
    const label = `${fixture.home} vs ${fixture.away} (${fixture.round || "knockout"})`;
    if (candidates.length === 0) continue; // nothing nearby — nothing to say
    if (candidates.length > 1) {
      skipped.push(`${label}: ${candidates.length} knockout rows within the window — ambiguous, not attributed.`);
      continue;
    }
    const slot = candidates[0];
    const rivals = fixtureCandidates.get(slot.id) || [];
    if (rivals.length > 1) {
      skipped.push(`${label}: match M${slot.matchNumber} has ${rivals.length} candidate fixtures — ambiguous, not attributed.`);
      continue;
    }
    attributions.push({ fixtureIndex: index, slot });
  }

  return { attributions, skipped };
}

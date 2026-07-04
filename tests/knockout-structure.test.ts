import assert from "node:assert/strict";
import test from "node:test";
import {
  KNOCKOUT_ROUND_MATCH_NUMBERS,
  KNOCKOUT_SOURCE_PAIRS,
  knockoutMatchRange,
  validateKnockoutMatchNumbers,
} from "../lib/knockout-structure";
import { DATA } from "../lib/data";

test("knockout match numbers are contiguous from M73 through M104", () => {
  assert.deepEqual(validateKnockoutMatchNumbers(), []);
  assert.equal(KNOCKOUT_ROUND_MATCH_NUMBERS.r32.length, 16);
  assert.equal(KNOCKOUT_ROUND_MATCH_NUMBERS.r16.length, 8);
  assert.equal(KNOCKOUT_ROUND_MATCH_NUMBERS.qf.length, 4);
  assert.equal(KNOCKOUT_ROUND_MATCH_NUMBERS.sf.length, 2);
  assert.equal(KNOCKOUT_ROUND_MATCH_NUMBERS.third.length, 1);
  assert.equal(KNOCKOUT_ROUND_MATCH_NUMBERS.final.length, 1);
});

test("knockout tab ranges use the full official match range", () => {
  assert.equal(knockoutMatchRange(KNOCKOUT_ROUND_MATCH_NUMBERS.r32), "M73-M88");
  assert.equal(knockoutMatchRange(KNOCKOUT_ROUND_MATCH_NUMBERS.r16), "M89-M96");
  assert.equal(knockoutMatchRange(KNOCKOUT_ROUND_MATCH_NUMBERS.qf), "M97-M100");
  assert.equal(knockoutMatchRange(KNOCKOUT_ROUND_MATCH_NUMBERS.sf), "M101-M102");
  assert.equal(knockoutMatchRange(KNOCKOUT_ROUND_MATCH_NUMBERS.third), "M103");
  assert.equal(knockoutMatchRange(KNOCKOUT_ROUND_MATCH_NUMBERS.final), "M104");
});

test("round of 32 schedule matches verified match-number order", () => {
  const r32 = DATA.ko.filter(match => match.round === "Round of 32");
  assert.equal(r32.length, 16);
  assert.deepEqual(r32.map((match, index) => ({
    no: KNOCKOUT_ROUND_MATCH_NUMBERS.r32[index],
    ts: new Date(match.ts).toISOString(),
    venue: match.v,
  })), [
    { no: 73, ts: "2026-06-28T19:00:00.000Z", venue: "SOFI" },
    { no: 74, ts: "2026-06-29T20:30:00.000Z", venue: "GILLETTE" },
    { no: 75, ts: "2026-06-30T01:00:00.000Z", venue: "BBVA" },
    { no: 76, ts: "2026-06-29T17:00:00.000Z", venue: "NRG" },
    { no: 77, ts: "2026-06-30T21:00:00.000Z", venue: "METLIFE" },
    { no: 78, ts: "2026-06-30T17:00:00.000Z", venue: "ATT" },
    { no: 79, ts: "2026-07-01T02:00:00.000Z", venue: "AZT" },
    { no: 80, ts: "2026-07-01T16:00:00.000Z", venue: "MBS" },
    { no: 81, ts: "2026-07-02T00:00:00.000Z", venue: "LEVI" },
    { no: 82, ts: "2026-07-01T20:00:00.000Z", venue: "LUMEN" },
    { no: 83, ts: "2026-07-02T23:00:00.000Z", venue: "BMO" },
    { no: 84, ts: "2026-07-02T19:00:00.000Z", venue: "SOFI" },
    { no: 85, ts: "2026-07-03T03:00:00.000Z", venue: "BCP" },
    { no: 86, ts: "2026-07-03T22:00:00.000Z", venue: "HARDROCK" },
    { no: 87, ts: "2026-07-04T01:30:00.000Z", venue: "ARROW" },
    { no: 88, ts: "2026-07-03T18:00:00.000Z", venue: "ATT" },
  ]);
});

test("round of 16 schedule and source pairs match verified ESPN/wc26 order", () => {
  const r16 = DATA.ko.filter(match => match.round === "Round of 16");
  assert.equal(r16.length, 8);
  assert.deepEqual(KNOCKOUT_ROUND_MATCH_NUMBERS.r16, [89, 90, 91, 92, 93, 94, 95, 96]);
  assert.deepEqual(KNOCKOUT_SOURCE_PAIRS.r16, [
    [0, 2],   // M89: W73 Canada vs W75 Morocco
    [1, 4],   // M90: W74 Paraguay vs W77 France
    [3, 5],   // M91: W76 Brazil vs W78 Norway
    [6, 7],   // M92: W79 Mexico    vs W80 England
    [10, 11], // M93: W83 Portugal vs W84 Spain
    [8, 9],   // M94: W81 United States vs W82 Belgium
    [13, 15], // M95: W86 Argentina vs W88 Egypt
    [12, 14], // M96: W85 Switzerland vs W87 Colombia
  ]);
  assert.deepEqual(r16.map((match, index) => ({
    no: KNOCKOUT_ROUND_MATCH_NUMBERS.r16[index],
    ts: new Date(match.ts).toISOString(),
    venue: match.v,
  })), [
    { no: 89, ts: "2026-07-04T17:00:00.000Z", venue: "NRG" },
    { no: 90, ts: "2026-07-04T21:00:00.000Z", venue: "LINC" },
    { no: 91, ts: "2026-07-05T20:00:00.000Z", venue: "METLIFE" },
    { no: 92, ts: "2026-07-06T00:00:00.000Z", venue: "AZT" },
    { no: 93, ts: "2026-07-06T19:00:00.000Z", venue: "ATT" },
    { no: 94, ts: "2026-07-07T00:00:00.000Z", venue: "LUMEN" },
    { no: 95, ts: "2026-07-07T16:00:00.000Z", venue: "MBS" },
    { no: 96, ts: "2026-07-07T20:00:00.000Z", venue: "BCP" },
  ]);
});

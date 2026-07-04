import assert from "node:assert/strict";
import test from "node:test";
import {
  KNOCKOUT_ROUND_MATCH_NUMBERS,
  knockoutMatchRange,
  validateKnockoutMatchNumbers,
} from "../lib/knockout-structure";

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

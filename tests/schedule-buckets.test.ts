import assert from "node:assert/strict";
import test from "node:test";
import { bucketScheduleItems, scheduleBucketStatus } from "../lib/schedule-buckets";

test("keeps unresolved same-day matches visible in today after kickoff", () => {
  assert.equal(scheduleBucketStatus({
    iso: "2026-07-04",
    ts: Date.parse("2026-07-04T17:00:00Z"),
    isLive: false,
    isDone: false,
  }, "2026-07-04", Date.parse("2026-07-04T20:00:00Z")), "today");
});

test("keeps unresolved past matches visible in previous results instead of dropping them", () => {
  assert.equal(scheduleBucketStatus({
    iso: "2026-07-03",
    ts: Date.parse("2026-07-03T17:00:00Z"),
    isLive: false,
    isDone: false,
  }, "2026-07-04", Date.parse("2026-07-04T20:00:00Z")), "previous");
});

test("puts each schedule item into exactly one display bucket", () => {
  const items = [
    { id: "live", iso: "2026-07-04", ts: 1, isLive: true, isDone: false },
    { id: "today", iso: "2026-07-04", ts: 2, isLive: false, isDone: false },
    { id: "future", iso: "2026-07-05", ts: 3, isLive: false, isDone: false },
    { id: "done", iso: "2026-07-03", ts: 4, isLive: false, isDone: true },
    { id: "unresolved-past", iso: "2026-07-03", ts: 5, isLive: false, isDone: false },
  ];

  const buckets = bucketScheduleItems(items, "2026-07-04", 10, item => item);

  assert.deepEqual(buckets.live.map(item => item.id), ["live"]);
  assert.deepEqual(buckets.today.map(item => item.id), ["today"]);
  assert.deepEqual(buckets.future.map(item => item.id), ["future"]);
  assert.deepEqual(buckets.previous.map(item => item.id), ["done", "unresolved-past"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleLiveFixtureBase,
  cappedDetailCandidates,
  estimateLiveElapsed,
  freshSnapshot,
  liveSnapshotTtl,
  normalizeWc26Status,
  parseRemainingQuota,
  readThroughTtlCache,
  slimFixturesForLiveList,
  withVerifiedResults,
  type LiveSnapshot,
} from "../lib/live-fixtures";

test("selects active and idle live snapshot TTLs", () => {
  assert.equal(liveSnapshotTtl(true), 20_000);
  assert.equal(liveSnapshotTtl(false), 120_000);
});

test("serves fresh snapshots within active and idle TTLs", () => {
  const snapshot: LiveSnapshot = {
    ts: 1_000,
    response: {
      configured: true,
      active: true,
      ts: 1_000,
      fixtures: [{ home: "United States", away: "Mexico" }],
      source: "wc26",
      enrichment: {},
      leaderboardStats: [],
    },
  };

  assert.equal(freshSnapshot(snapshot, 20_999, true), snapshot);
  assert.equal(freshSnapshot(snapshot, 21_000, true), null);
  assert.equal(freshSnapshot(snapshot, 120_999, false), snapshot);
  assert.equal(freshSnapshot(snapshot, 121_000, false), null);
});

test("read-through TTL cache returns fresh data inside TTL", async () => {
  let calls = 0;
  const cache = { data: ["cached"], ts: 1_000 };
  const result = await readThroughTtlCache(cache, 2_000, 10_000, async () => {
    calls++;
    return ["fresh"];
  }, [] as string[]);

  assert.equal(calls, 0);
  assert.deepEqual(result.data, ["cached"]);
  assert.equal(result.cache, cache);
});

test("read-through TTL cache serves stale data on fetch failure", async () => {
  const cache = { data: ["stale"], ts: 1_000 };
  const result = await readThroughTtlCache(cache, 20_000, 10_000, async () => {
    throw new Error("ESPN down");
  }, [] as string[]);

  assert.deepEqual(result.data, ["stale"]);
  assert.equal(result.cache, cache);
  assert.equal(result.stale, true);
});

test("read-through TTL cache returns empty only before first successful fetch", async () => {
  const result = await readThroughTtlCache<string[]>(null, 20_000, 10_000, async () => {
    throw new Error("ESPN down");
  }, []);

  assert.deepEqual(result.data, []);
  assert.equal(result.cache, null);
  assert.equal(result.stale, false);
});

test("quota parser fails closed when remaining header is missing or invalid", () => {
  assert.equal(parseRemainingQuota(null), 0);
  assert.equal(parseRemainingQuota(undefined), 0);
  assert.equal(parseRemainingQuota("oops"), 0);
  assert.equal(parseRemainingQuota("501"), 501);
});

test("worldcup26 live tokens normalize to in-play statuses", () => {
  assert.deepEqual(normalizeWc26Status("live", "FALSE"), { status: "LIVE", elapsed: null });
  assert.deepEqual(normalizeWc26Status("67", "FALSE"), { status: "2H", elapsed: 67 });
  assert.deepEqual(normalizeWc26Status("halftime", "FALSE"), { status: "HT", elapsed: 45 });
  assert.deepEqual(normalizeWc26Status("notstarted", "FALSE"), { status: "NS", elapsed: null });
  assert.deepEqual(normalizeWc26Status("finished", "TRUE"), { status: "FT", elapsed: 90 });
});

test("live elapsed fallback estimates display minute from kickoff", () => {
  const kickoff = Date.UTC(2026, 6, 4, 17, 0, 0);
  assert.equal(estimateLiveElapsed("LIVE", kickoff, null, kickoff + 48 * 60000 + 20_000), 49);
  assert.equal(estimateLiveElapsed("1H", kickoff, null, kickoff + 48 * 60000), 49);
  assert.equal(estimateLiveElapsed("2H", kickoff, null, kickoff + 66 * 60000), 67);
  assert.equal(estimateLiveElapsed("LIVE", kickoff, 32, kickoff + 48 * 60000), 32);
  assert.equal(estimateLiveElapsed("NS", kickoff, null, kickoff + 48 * 60000), null);
});

test("live assembly updates stale 45 minute with richer wc26 clock", () => {
  const base = [{
    ts: 1,
    status: "1H",
    elapsed: 45,
    venue: "NRG Stadium",
    round: "Round of 16",
    home: "Canada",
    away: "Morocco",
    gh: 0,
    ga: 0,
  }];
  const wc26 = [{
    ts: 1,
    status: "LIVE",
    elapsed: 66,
    venue: "NRG Stadium",
    round: "Round of 16",
    home: "Canada",
    away: "Morocco",
    gh: 0,
    ga: 0,
  }];

  const [fixture] = assembleLiveFixtureBase(base, wc26, true) as Array<{ elapsed: number }>;
  assert.equal(fixture.elapsed, 66);
});

test("detail enrichment candidates are hard capped at one batch", () => {
  const fixtures = Array.from({ length: 50 }, (_, index) => ({ fixtureId: index + 1 }));
  const { selected, deferred } = cappedDetailCandidates(fixtures, () => true, 20);

  assert.equal(selected.length, 20);
  assert.equal(deferred, 30);
});

test("live fixture assembly keeps rich API-Football data and backfills wc26 events", () => {
  const apiFootball = [{
    ts: 1,
    status: "FT",
    elapsed: 90,
    venue: "MetLife Stadium",
    round: "Group Stage - A",
    home: "Testland",
    away: "Examplestan",
    gh: 2,
    ga: 1,
    fixtureId: 101,
    players: [{ name: "Case Forward", team: "Testland", minutes: 90, assists: 1 }],
  }];
  const wc26 = [{
    ts: 1,
    status: "FT",
    elapsed: 90,
    venue: "MetLife Stadium",
    round: "Group Stage - A",
    home: "Testland",
    away: "Examplestan",
    gh: 2,
    ga: 1,
    events: [{ minute: 10, extra: null, type: "Goal", detail: "Normal Goal", player: "Case Forward", assist: null, team: "Testland" }],
  }];

  const base = assembleLiveFixtureBase(apiFootball, wc26, true);
  const output = slimFixturesForLiveList(withVerifiedResults(base));

  assert.deepEqual(output[0], {
    ts: 1,
    status: "FT",
    elapsed: 90,
    venue: "MetLife Stadium",
    round: "Group Stage - A",
    home: "Testland",
    away: "Examplestan",
    gh: 2,
    ga: 1,
    fixtureId: 101,
    events: [{ minute: 10, extra: null, type: "Goal", detail: "Normal Goal", player: "Case Forward", assist: null, team: "Testland" }],
    assistDataMissing: true,
    players: [{ name: "Case Forward", team: "Testland", minutes: 90, assists: 1 }],
  });
  assert.ok(output.length > 1, "verified results remain part of the assembled live shape");
});

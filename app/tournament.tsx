"use client";

import { Component, Fragment, memo, useEffect, useRef, useState, useCallback, useMemo, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { VenueFitRequest, VenueFocusRequest, VenueMapMarker, VenueRouteFitRequest } from "@/app/components/VenueMap";
import { HOST_VENUE_DETAILS, MOCK_FIXTURES, type TournamentData, type LiveFixture, type GroupStageMatch, type KnockoutMatch, type MatchEvent, type MatchStats, type PlayerMatchStat, type TeamLineup, type VenueDetails } from "@/lib/data";
import { nrm, canon, canonPlayer } from "@/lib/merge";
import { buildTournamentStats, type ExternalLeaderStat, type PlayerLeader, type TournamentStats } from "@/lib/stats";
import { TEAM_PROFILES, type PlayerInfo } from "@/lib/teams";
import { PLAYER_PHOTO_IDS, playerPhotoUrl } from "@/lib/player-photos";
import { groupConsecutiveJourneyStops } from "@/lib/map-journey";
import { resolveFilteredVenueSelection } from "@/lib/map-filters";
import { bucketScheduleItems } from "@/lib/schedule-buckets";
import { buildTeamJourney, type JourneyMatchInput, type JourneyVenue } from "@/lib/journey";
import { buildTeamRecords } from "@/lib/team-records";
import { auditTournament } from "@/lib/integrity";
import { claimKnockoutFixtureForSlot } from "@/lib/knockout-fixtures";
import { KNOCKOUT_ROUND_MATCH_NUMBERS, KNOCKOUT_SOURCE_PAIRS, knockoutMatchRange } from "@/lib/knockout-structure";
import TriondaBall from "@/app/components/TriondaBall";
import WorldCupTrophy from "@/app/components/WorldCupTrophy";

/* Favorites hook — persists to localStorage */
function useFavorites(): [Set<string>, (team: string) => void] {
  const [favs, setFavs] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      const saved = localStorage.getItem("compet-favs");
      return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const toggle = useCallback((team: string) => {
    setFavs(prev => {
      const next = new Set(prev);
      if (next.has(team)) next.delete(team); else next.add(team);
      try { localStorage.setItem("compet-favs", JSON.stringify([...next])); } catch { /* quota */ }
      return next;
    });
  }, []);
  return [favs, toggle];
}

const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const LIVE_STATUSES = new Set(["1H","2H","HT","ET","BT","P","LIVE","SUSP","INT"]);
const DONE_STATUSES = new Set(["FT","AET","PEN","PEN_LIVE","WO","AWD"]);

// 4 hours: even with ET + penalties + delays, a match can't be live after this
const STALE_LIVE_THRESHOLD = 4 * 60 * 60 * 1000;

function isStaleStatus(ts: number, status: string, now = Date.now()): boolean {
  if (!LIVE_STATUSES.has(status)) return false;
  return now - ts > STALE_LIVE_THRESHOLD;
}

type ViewType = "home" | "schedule" | "groups" | "bracket" | "teams" | "map" | "analytics" | "more" | "settings" | "stats" | "venues" | "about";
const VIEW_TYPES = ["home","schedule","groups","bracket","teams","map","analytics","more","settings","stats","venues","about"] as const;
function isViewType(value: string | null | undefined): value is ViewType {
  return !!value && (VIEW_TYPES as readonly string[]).includes(value);
}
type LiveStatus = "init" | "off" | "idle" | "active" | "paused" | "nofix";
type PersistedLiveData = {
  version: 1;
  savedAt: number;
  ts: number;
  source: "network" | "mock";
  fixtures: LiveFixture[];
  leaderboardStats?: ExternalLeaderStat[];
};
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type KnockoutRoundKey = "r32" | "r16" | "qf" | "sf" | "third" | "final";
type StandingRow = { t: string; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number };
type GroupStanding = { rows: StandingRow[]; played: number; complete: boolean };

const LIVE_DATA_CACHE_KEY = "compet-live-data-v1";
const LIVE_DATA_CACHE_VERSION = 1;
const LIVE_DATA_CACHE_TTL = 2 * 60 * 1000;
let startupLiveDataCache: PersistedLiveData | null | undefined;

function logLiveDataSource(message: string, details?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  /* Diagnostic chatter stays out of production consoles */
  if (process.env.NODE_ENV === "production") return;
  console.info(`[compet live-data] ${message}`, details || {});
}

function readPersistedLiveData(reason: string): PersistedLiveData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LIVE_DATA_CACHE_KEY);
    if (!raw) {
      logLiveDataSource(`${reason}: no localStorage live cache`);
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedLiveData>;
    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
    const ageMs = Date.now() - savedAt;
    if (parsed.version !== LIVE_DATA_CACHE_VERSION || !Array.isArray(parsed.fixtures) || ageMs > LIVE_DATA_CACHE_TTL) {
      window.localStorage.removeItem(LIVE_DATA_CACHE_KEY);
      logLiveDataSource(`${reason}: invalidated localStorage live cache`, {
        version: parsed.version,
        fixtureCount: Array.isArray(parsed.fixtures) ? parsed.fixtures.length : 0,
        ageMs,
        ttlMs: LIVE_DATA_CACHE_TTL,
      });
      return null;
    }
    logLiveDataSource(`${reason}: using localStorage as temporary fallback`, {
      fixtureCount: parsed.fixtures.length,
      ageMs,
      ts: parsed.ts,
    });
    return parsed as PersistedLiveData;
  } catch (error) {
    try { window.localStorage.removeItem(LIVE_DATA_CACHE_KEY); } catch { /* ignore */ }
    logLiveDataSource(`${reason}: failed to parse localStorage live cache`, { error: String(error) });
    return null;
  }
}

function getStartupLiveDataCache(): PersistedLiveData | null {
  if (startupLiveDataCache !== undefined) return startupLiveDataCache;
  startupLiveDataCache = readPersistedLiveData("startup");
  if (!startupLiveDataCache) logLiveDataSource("startup: falling back to bundled schedule until network responds");
  return startupLiveDataCache;
}

function persistLiveData(
  fixtures: LiveFixture[],
  ts: number,
  source: PersistedLiveData["source"],
  leaderboardStats: ExternalLeaderStat[] = startupLiveDataCache?.leaderboardStats || [],
) {
  if (typeof window === "undefined") return;
  const payload: PersistedLiveData = {
    version: LIVE_DATA_CACHE_VERSION,
    savedAt: Date.now(),
    ts,
    source,
    fixtures,
    leaderboardStats,
  };
  try {
    window.localStorage.setItem(LIVE_DATA_CACHE_KEY, JSON.stringify(payload));
    startupLiveDataCache = payload;
    logLiveDataSource("network success: replaced persisted live cache", {
      fixtureCount: fixtures.length,
      ts,
      source,
      ttlMs: LIVE_DATA_CACHE_TTL,
    });
  } catch (error) {
    logLiveDataSource("network success: could not persist live cache", { error: String(error) });
  }
}

const KO_ROUNDS: {
  key: KnockoutRoundKey;
  dataRound: string;
  label: string;
  short: string;
  matchNumbers: number[];
}[] = [
  // matchNumbers must be sequential (matching DB sort by matchNumber ASC)
  // since R32_SEEDS, KO_SOURCE_PAIRS, and pick() indices all use DB order
  { key: "r32", dataRound: "Round of 32", label: "Round of 32", short: "R32", matchNumbers: [...KNOCKOUT_ROUND_MATCH_NUMBERS.r32] },
  { key: "r16", dataRound: "Round of 16", label: "Round of 16", short: "R16", matchNumbers: [...KNOCKOUT_ROUND_MATCH_NUMBERS.r16] },
  { key: "qf", dataRound: "Quarter-final", label: "Quarterfinals", short: "QF", matchNumbers: [...KNOCKOUT_ROUND_MATCH_NUMBERS.qf] },
  { key: "sf", dataRound: "Semi-final", label: "Semifinals", short: "SF", matchNumbers: [...KNOCKOUT_ROUND_MATCH_NUMBERS.sf] },
  { key: "third", dataRound: "Third-place play-off", label: "Third Place", short: "3rd", matchNumbers: [...KNOCKOUT_ROUND_MATCH_NUMBERS.third] },
  { key: "final", dataRound: "Final", label: "Final", short: "Final", matchNumbers: [...KNOCKOUT_ROUND_MATCH_NUMBERS.final] },
];

const R32_SEEDS = [
  ["2A", "2B"],
  ["1E", "3ABCDF"],
  ["1F", "2C"],
  ["1C", "2F"],
  ["1I", "3CDFGH"],
  ["2E", "2I"],
  ["1A", "3CEFHI"],
  ["1L", "3EHIJK"],
  ["1D", "3BEFIJ"],
  ["1G", "3AEHIJ"],
  ["2K", "2L"],
  ["1H", "2J"],
  ["1B", "3EFGIJ"],
  ["1J", "2H"],
  ["1K", "3DEIJL"],
  ["2D", "2G"],
] as const;

const KO_SOURCE_PAIRS: Partial<Record<KnockoutRoundKey, [number, number][]>> = KNOCKOUT_SOURCE_PAIRS;

// ── FIFA Annex C: Third-Place Bracket Assignment Table ──
// Maps sorted qualifying-group key (8 letters, e.g. "BDEFIJKL") to an
// 8-char assignment string. Each character is the group whose 3rd-place
// team fills the slot facing that group winner. Column order: 1A 1B 1D 1E 1G 1I 1K 1L
const ANNEX_C: Record<string, string> = {
  "EFGHIJKL":"EJIFHGLK","DFGHIJKL":"HGIDJFLK","DEGHIJKL":"EJIDHGLK","DEFHIJKL":"EJIDHFLK","DEFGIJKL":"EGIDJFLK","DEFGHJKL":"EGJDHFLK",
  "DEFGHIKL":"EGIDHFLK","DEFGHIJL":"EGJDHFLI","DEFGHIJK":"EGJDHFIK","CFGHIJKL":"HGICJFLK","CEGHIJKL":"EJICHGLK","CEFHIJKL":"EJICHFLK",
  "CEFGIJKL":"EGICJFLK","CEFGHJKL":"EGJCHFLK","CEFGHIKL":"EGICHFLK","CEFGHIJL":"EGJCHFLI","CEFGHIJK":"EGJCHFIK","CDGHIJKL":"HGICJDLK",
  "CDFHIJKL":"CJIDHFLK","CDFGIJKL":"CGIDJFLK","CDFGHJKL":"CGJDHFLK","CDFGHIKL":"CGIDHFLK","CDFGHIJL":"CGJDHFLI","CDFGHIJK":"CGJDHFIK",
  "CDEHIJKL":"EJICHDLK","CDEGIJKL":"EGICJDLK","CDEGHJKL":"EGJCHDLK","CDEGHIKL":"EGICHDLK","CDEGHIJL":"EGJCHDLI","CDEGHIJK":"EGJCHDIK",
  "CDEFIJKL":"CJEDIFLK","CDEFHJKL":"CJEDHFLK","CDEFHIKL":"CEIDHFLK","CDEFHIJL":"CJEDHFLI","CDEFHIJK":"CJEDHFIK","CDEFGJKL":"CGEDJFLK",
  "CDEFGIKL":"CGEDIFLK","CDEFGIJL":"CGEDJFLI","CDEFGIJK":"CGEDJFIK","CDEFGHKL":"CGEDHFLK","CDEFGHJL":"CGJDHFLE","CDEFGHJK":"CGJDHFEK",
  "CDEFGHIL":"CGEDHFLI","CDEFGHIK":"CGEDHFIK","CDEFGHIJ":"CGJDHFEI","BFGHIJKL":"HJBFIGLK","BEGHIJKL":"EJIBHGLK","BEFHIJKL":"EJBFIHLK",
  "BEFGIJKL":"EJBFIGLK","BEFGHJKL":"EJBFHGLK","BEFGHIKL":"EGBFIHLK","BEFGHIJL":"EJBFHGLI","BEFGHIJK":"EJBFHGIK","BDGHIJKL":"HJBDIGLK",
  "BDFHIJKL":"HJBDIFLK","BDFGIJKL":"IGBDJFLK","BDFGHJKL":"HGBDJFLK","BDFGHIKL":"HGBDIFLK","BDFGHIJL":"HGBDJFLI","BDFGHIJK":"HGBDJFIK",
  "BDEHIJKL":"EJBDIHLK","BDEGIJKL":"EJBDIGLK","BDEGHJKL":"EJBDHGLK","BDEGHIKL":"EGBDIHLK","BDEGHIJL":"EJBDHGLI","BDEGHIJK":"EJBDHGIK",
  "BDEFIJKL":"EJBDIFLK","BDEFHJKL":"EJBDHFLK","BDEFHIKL":"EIBDHFLK","BDEFHIJL":"EJBDHFLI","BDEFHIJK":"EJBDHFIK","BDEFGJKL":"EGBDJFLK",
  "BDEFGIKL":"EGBDIFLK","BDEFGIJL":"EGBDJFLI","BDEFGIJK":"EGBDJFIK","BDEFGHKL":"EGBDHFLK","BDEFGHJL":"HGBDJFLE","BDEFGHJK":"HGBDJFEK",
  "BDEFGHIL":"EGBDHFLI","BDEFGHIK":"EGBDHFIK","BDEFGHIJ":"HGBDJFEI","BCGHIJKL":"HJBCIGLK","BCFHIJKL":"HJBCIFLK","BCFGIJKL":"IGBCJFLK",
  "BCFGHJKL":"HGBCJFLK","BCFGHIKL":"HGBCIFLK","BCFGHIJL":"HGBCJFLI","BCFGHIJK":"HGBCJFIK","BCEHIJKL":"EJBCIHLK","BCEGIJKL":"EJBCIGLK",
  "BCEGHJKL":"EJBCHGLK","BCEGHIKL":"EGBCIHLK","BCEGHIJL":"EJBCHGLI","BCEGHIJK":"EJBCHGIK","BCEFIJKL":"EJBCIFLK","BCEFHJKL":"EJBCHFLK",
  "BCEFHIKL":"EIBCHFLK","BCEFHIJL":"EJBCHFLI","BCEFHIJK":"EJBCHFIK","BCEFGJKL":"EGBCJFLK","BCEFGIKL":"EGBCIFLK","BCEFGIJL":"EGBCJFLI",
  "BCEFGIJK":"EGBCJFIK","BCEFGHKL":"EGBCHFLK","BCEFGHJL":"HGBCJFLE","BCEFGHJK":"HGBCJFEK","BCEFGHIL":"EGBCHFLI","BCEFGHIK":"EGBCHFIK",
  "BCEFGHIJ":"HGBCJFEI","BCDHIJKL":"HJBCIDLK","BCDGIJKL":"IGBCJDLK","BCDGHJKL":"HGBCJDLK","BCDGHIKL":"HGBCIDLK","BCDGHIJL":"HGBCJDLI",
  "BCDGHIJK":"HGBCJDIK","BCDFIJKL":"CJBDIFLK","BCDFHJKL":"CJBDHFLK","BCDFHIKL":"CIBDHFLK","BCDFHIJL":"CJBDHFLI","BCDFHIJK":"CJBDHFIK",
  "BCDFGJKL":"CGBDJFLK","BCDFGIKL":"CGBDIFLK","BCDFGIJL":"CGBDJFLI","BCDFGIJK":"CGBDJFIK","BCDFGHKL":"CGBDHFLK","BCDFGHJL":"CGBDHFLJ",
  "BCDFGHJK":"HGBCJFDK","BCDFGHIL":"CGBDHFLI","BCDFGHIK":"CGBDHFIK","BCDFGHIJ":"HGBCJFDI","BCDEIJKL":"EJBCIDLK","BCDEHJKL":"EJBCHDLK",
  "BCDEHIKL":"EIBCHDLK","BCDEHIJL":"EJBCHDLI","BCDEHIJK":"EJBCHDIK","BCDEGJKL":"EGBCJDLK","BCDEGIKL":"EGBCIDLK","BCDEGIJL":"EGBCJDLI",
  "BCDEGIJK":"EGBCJDIK","BCDEGHKL":"EGBCHDLK","BCDEGHJL":"HGBCJDLE","BCDEGHJK":"HGBCJDEK","BCDEGHIL":"EGBCHDLI","BCDEGHIK":"EGBCHDIK",
  "BCDEGHIJ":"HGBCJDEI","BCDEFJKL":"CJBDEFLK","BCDEFIKL":"CEBDIFLK","BCDEFIJL":"CJBDEFLI","BCDEFIJK":"CJBDEFIK","BCDEFHKL":"CEBDHFLK",
  "BCDEFHJL":"CJBDHFLE","BCDEFHJK":"CJBDHFEK","BCDEFHIL":"CEBDHFLI","BCDEFHIK":"CEBDHFIK","BCDEFHIJ":"CJBDHFEI","BCDEFGKL":"CGBDEFLK",
  "BCDEFGJL":"CGBDJFLE","BCDEFGJK":"CGBDJFEK","BCDEFGIL":"CGBDEFLI","BCDEFGIK":"CGBDEFIK","BCDEFGIJ":"CGBDJFEI","BCDEFGHL":"CGBDHFLE",
  "BCDEFGHK":"CGBDHFEK","BCDEFGHJ":"HGBCJFDE","BCDEFGHI":"CGBDHFEI","AFGHIJKL":"HJIFAGLK","AEGHIJKL":"EJIAHGLK","AEFHIJKL":"EJIFAHLK",
  "AEFGIJKL":"EJIFAGLK","AEFGHJKL":"EGJFAHLK","AEFGHIKL":"EGIFAHLK","AEFGHIJL":"EGJFAHLI","AEFGHIJK":"EGJFAHIK","ADGHIJKL":"HJIDAGLK",
  "ADFHIJKL":"HJIDAFLK","ADFGIJKL":"IGJDAFLK","ADFGHJKL":"HGJDAFLK","ADFGHIKL":"HGIDAFLK","ADFGHIJL":"HGJDAFLI","ADFGHIJK":"HGJDAFIK",
  "ADEHIJKL":"EJIDAHLK","ADEGIJKL":"EJIDAGLK","ADEGHJKL":"EGJDAHLK","ADEGHIKL":"EGIDAHLK","ADEGHIJL":"EGJDAHLI","ADEGHIJK":"EGJDAHIK",
  "ADEFIJKL":"EJIDAFLK","ADEFHJKL":"HJEDAFLK","ADEFHIKL":"HEIDAFLK","ADEFHIJL":"HJEDAFLI","ADEFHIJK":"HJEDAFIK","ADEFGJKL":"EGJDAFLK",
  "ADEFGIKL":"EGIDAFLK","ADEFGIJL":"EGJDAFLI","ADEFGIJK":"EGJDAFIK","ADEFGHKL":"HGEDAFLK","ADEFGHJL":"HGJDAFLE","ADEFGHJK":"HGJDAFEK",
  "ADEFGHIL":"HGEDAFLI","ADEFGHIK":"HGEDAFIK","ADEFGHIJ":"HGJDAFEI","ACGHIJKL":"HJICAGLK","ACFHIJKL":"HJICAFLK","ACFGIJKL":"IGJCAFLK",
  "ACFGHJKL":"HGJCAFLK","ACFGHIKL":"HGICAFLK","ACFGHIJL":"HGJCAFLI","ACFGHIJK":"HGJCAFIK","ACEHIJKL":"EJICAHLK","ACEGIJKL":"EJICAGLK",
  "ACEGHJKL":"EGJCAHLK","ACEGHIKL":"EGICAHLK","ACEGHIJL":"EGJCAHLI","ACEGHIJK":"EGJCAHIK","ACEFIJKL":"EJICAFLK","ACEFHJKL":"HJECAFLK",
  "ACEFHIKL":"HEICAFLK","ACEFHIJL":"HJECAFLI","ACEFHIJK":"HJECAFIK","ACEFGJKL":"EGJCAFLK","ACEFGIKL":"EGICAFLK","ACEFGIJL":"EGJCAFLI",
  "ACEFGIJK":"EGJCAFIK","ACEFGHKL":"HGECAFLK","ACEFGHJL":"HGJCAFLE","ACEFGHJK":"HGJCAFEK","ACEFGHIL":"HGECAFLI","ACEFGHIK":"HGECAFIK",
  "ACEFGHIJ":"HGJCAFEI","ACDHIJKL":"HJICADLK","ACDGIJKL":"IGJCADLK","ACDGHJKL":"HGJCADLK","ACDGHIKL":"HGICADLK","ACDGHIJL":"HGJCADLI",
  "ACDGHIJK":"HGJCADIK","ACDFIJKL":"CJIDAFLK","ACDFHJKL":"HJFCADLK","ACDFHIKL":"HFICADLK","ACDFHIJL":"HJFCADLI","ACDFHIJK":"HJFCADIK",
  "ACDFGJKL":"CGJDAFLK","ACDFGIKL":"CGIDAFLK","ACDFGIJL":"CGJDAFLI","ACDFGIJK":"CGJDAFIK","ACDFGHKL":"HGFCADLK","ACDFGHJL":"CGJDAFLH",
  "ACDFGHJK":"HGJCAFDK","ACDFGHIL":"HGFCADLI","ACDFGHIK":"HGFCADIK","ACDFGHIJ":"HGJCAFDI","ACDEIJKL":"EJICADLK","ACDEHJKL":"HJECADLK",
  "ACDEHIKL":"HEICADLK","ACDEHIJL":"HJECADLI","ACDEHIJK":"HJECADIK","ACDEGJKL":"EGJCADLK","ACDEGIKL":"EGICADLK","ACDEGIJL":"EGJCADLI",
  "ACDEGIJK":"EGJCADIK","ACDEGHKL":"HGECADLK","ACDEGHJL":"HGJCADLE","ACDEGHJK":"HGJCADEK","ACDEGHIL":"HGECADLI","ACDEGHIK":"HGECADIK",
  "ACDEGHIJ":"HGJCADEI","ACDEFJKL":"CJEDAFLK","ACDEFIKL":"CEIDAFLK","ACDEFIJL":"CJEDAFLI","ACDEFIJK":"CJEDAFIK","ACDEFHKL":"HEFCADLK",
  "ACDEFHJL":"HJFCADLE","ACDEFHJK":"HJECAFDK","ACDEFHIL":"HEFCADLI","ACDEFHIK":"HEFCADIK","ACDEFHIJ":"HJECAFDI","ACDEFGKL":"CGEDAFLK",
  "ACDEFGJL":"CGJDAFLE","ACDEFGJK":"CGJDAFEK","ACDEFGIL":"CGEDAFLI","ACDEFGIK":"CGEDAFIK","ACDEFGIJ":"CGJDAFEI","ACDEFGHL":"HGFCADLE",
  "ACDEFGHK":"HGECAFDK","ACDEFGHJ":"HGJCAFDE","ACDEFGHI":"HGECAFDI","ABGHIJKL":"HJBAIGLK","ABFHIJKL":"HJBAIFLK","ABFGIJKL":"IJBFAGLK",
  "ABFGHJKL":"HJBFAGLK","ABFGHIKL":"HGBAIFLK","ABFGHIJL":"HJBFAGLI","ABFGHIJK":"HJBFAGIK","ABEHIJKL":"EJBAIHLK","ABEGIJKL":"EJBAIGLK",
  "ABEGHJKL":"EJBAHGLK","ABEGHIKL":"EGBAIHLK","ABEGHIJL":"EJBAHGLI","ABEGHIJK":"EJBAHGIK","ABEFIJKL":"EJBAIFLK","ABEFHJKL":"EJBFAHLK",
  "ABEFHIKL":"EIBFAHLK","ABEFHIJL":"EJBFAHLI","ABEFHIJK":"EJBFAHIK","ABEFGJKL":"EJBFAGLK","ABEFGIKL":"EGBAIFLK","ABEFGIJL":"EJBFAGLI",
  "ABEFGIJK":"EJBFAGIK","ABEFGHKL":"EGBFAHLK","ABEFGHJL":"HJBFAGLE","ABEFGHJK":"HJBFAGEK","ABEFGHIL":"EGBFAHLI","ABEFGHIK":"EGBFAHIK",
  "ABEFGHIJ":"HJBFAGEI","ABDHIJKL":"IJBDAHLK","ABDGIJKL":"IJBDAGLK","ABDGHJKL":"HJBDAGLK","ABDGHIKL":"IGBDAHLK","ABDGHIJL":"HJBDAGLI",
  "ABDGHIJK":"HJBDAGIK","ABDFIJKL":"IJBDAFLK","ABDFHJKL":"HJBDAFLK","ABDFHIKL":"HIBDAFLK","ABDFHIJL":"HJBDAFLI","ABDFHIJK":"HJBDAFIK",
  "ABDFGJKL":"FJBDAGLK","ABDFGIKL":"IGBDAFLK","ABDFGIJL":"FJBDAGLI","ABDFGIJK":"FJBDAGIK","ABDFGHKL":"HGBDAFLK","ABDFGHJL":"HGBDAFLJ",
  "ABDFGHJK":"HGBDAFJK","ABDFGHIL":"HGBDAFLI","ABDFGHIK":"HGBDAFIK","ABDFGHIJ":"HGBDAFIJ","ABDEIJKL":"EJBAIDLK","ABDEHJKL":"EJBDAHLK",
  "ABDEHIKL":"EIBDAHLK","ABDEHIJL":"EJBDAHLI","ABDEHIJK":"EJBDAHIK","ABDEGJKL":"EJBDAGLK","ABDEGIKL":"EGBAIDLK","ABDEGIJL":"EJBDAGLI",
  "ABDEGIJK":"EJBDAGIK","ABDEGHKL":"EGBDAHLK","ABDEGHJL":"HJBDAGLE","ABDEGHJK":"HJBDAGEK","ABDEGHIL":"EGBDAHLI","ABDEGHIK":"EGBDAHIK",
  "ABDEGHIJ":"HJBDAGEI","ABDEFJKL":"EJBDAFLK","ABDEFIKL":"EIBDAFLK","ABDEFIJL":"EJBDAFLI","ABDEFIJK":"EJBDAFIK","ABDEFHKL":"HEBDAFLK",
  "ABDEFHJL":"HJBDAFLE","ABDEFHJK":"HJBDAFEK","ABDEFHIL":"HEBDAFLI","ABDEFHIK":"HEBDAFIK","ABDEFHIJ":"HJBDAFEI","ABDEFGKL":"EGBDAFLK",
  "ABDEFGJL":"EGBDAFLJ","ABDEFGJK":"EGBDAFJK","ABDEFGIL":"EGBDAFLI","ABDEFGIK":"EGBDAFIK","ABDEFGIJ":"EGBDAFIJ","ABDEFGHL":"HGBDAFLE",
  "ABDEFGHK":"HGBDAFEK","ABDEFGHJ":"HGBDAFEJ","ABDEFGHI":"HGBDAFEI","ABCHIJKL":"IJBCAHLK","ABCGIJKL":"IJBCAGLK","ABCGHJKL":"HJBCAGLK",
  "ABCGHIKL":"IGBCAHLK","ABCGHIJL":"HJBCAGLI","ABCGHIJK":"HJBCAGIK","ABCFIJKL":"IJBCAFLK","ABCFHJKL":"HJBCAFLK","ABCFHIKL":"HIBCAFLK",
  "ABCFHIJL":"HJBCAFLI","ABCFHIJK":"HJBCAFIK","ABCFGJKL":"CJBFAGLK","ABCFGIKL":"IGBCAFLK","ABCFGIJL":"CJBFAGLI","ABCFGIJK":"CJBFAGIK",
  "ABCFGHKL":"HGBCAFLK","ABCFGHJL":"HGBCAFLJ","ABCFGHJK":"HGBCAFJK","ABCFGHIL":"HGBCAFLI","ABCFGHIK":"HGBCAFIK","ABCFGHIJ":"HGBCAFIJ",
  "ABCEIJKL":"EJBAICLK","ABCEHJKL":"EJBCAHLK","ABCEHIKL":"EIBCAHLK","ABCEHIJL":"EJBCAHLI","ABCEHIJK":"EJBCAHIK","ABCEGJKL":"EJBCAGLK",
  "ABCEGIKL":"EGBAICLK","ABCEGIJL":"EJBCAGLI","ABCEGIJK":"EJBCAGIK","ABCEGHKL":"EGBCAHLK","ABCEGHJL":"HJBCAGLE","ABCEGHJK":"HJBCAGEK",
  "ABCEGHIL":"EGBCAHLI","ABCEGHIK":"EGBCAHIK","ABCEGHIJ":"HJBCAGEI","ABCEFJKL":"EJBCAFLK","ABCEFIKL":"EIBCAFLK","ABCEFIJL":"EJBCAFLI",
  "ABCEFIJK":"EJBCAFIK","ABCEFHKL":"HEBCAFLK","ABCEFHJL":"HJBCAFLE","ABCEFHJK":"HJBCAFEK","ABCEFHIL":"HEBCAFLI","ABCEFHIK":"HEBCAFIK",
  "ABCEFHIJ":"HJBCAFEI","ABCEFGKL":"EGBCAFLK","ABCEFGJL":"EGBCAFLJ","ABCEFGJK":"EGBCAFJK","ABCEFGIL":"EGBCAFLI","ABCEFGIK":"EGBCAFIK",
  "ABCEFGIJ":"EGBCAFIJ","ABCEFGHL":"HGBCAFLE","ABCEFGHK":"HGBCAFEK","ABCEFGHJ":"HGBCAFEJ","ABCEFGHI":"HGBCAFEI","ABCDIJKL":"IJBCADLK",
  "ABCDHJKL":"HJBCADLK","ABCDHIKL":"HIBCADLK","ABCDHIJL":"HJBCADLI","ABCDHIJK":"HJBCADIK","ABCDGJKL":"CJBDAGLK","ABCDGIKL":"IGBCADLK",
  "ABCDGIJL":"CJBDAGLI","ABCDGIJK":"CJBDAGIK","ABCDGHKL":"HGBCADLK","ABCDGHJL":"HGBCADLJ","ABCDGHJK":"HGBCADJK","ABCDGHIL":"HGBCADLI",
  "ABCDGHIK":"HGBCADIK","ABCDGHIJ":"HGBCADIJ","ABCDFJKL":"CJBDAFLK","ABCDFIKL":"CIBDAFLK","ABCDFIJL":"CJBDAFLI","ABCDFIJK":"CJBDAFIK",
  "ABCDFHKL":"HFBCADLK","ABCDFHJL":"CJBDAFLH","ABCDFHJK":"HJBCAFDK","ABCDFHIL":"HFBCADLI","ABCDFHIK":"HFBCADIK","ABCDFHIJ":"HJBCAFDI",
  "ABCDFGKL":"CGBDAFLK","ABCDFGJL":"CGBDAFLJ","ABCDFGJK":"CGBDAFJK","ABCDFGIL":"CGBDAFLI","ABCDFGIK":"CGBDAFIK","ABCDFGIJ":"CGBDAFIJ",
  "ABCDFGHL":"CGBDAFLH","ABCDFGHK":"HGBCAFDK","ABCDFGHJ":"HGBCAFDJ","ABCDFGHI":"HGBCAFDI","ABCDEJKL":"EJBCADLK","ABCDEIKL":"EIBCADLK",
  "ABCDEIJL":"EJBCADLI","ABCDEIJK":"EJBCADIK","ABCDEHKL":"HEBCADLK","ABCDEHJL":"HJBCADLE","ABCDEHJK":"HJBCADEK","ABCDEHIL":"HEBCADLI",
  "ABCDEHIK":"HEBCADIK","ABCDEHIJ":"HJBCADEI","ABCDEGKL":"EGBCADLK","ABCDEGJL":"EGBCADLJ","ABCDEGJK":"EGBCADJK","ABCDEGIL":"EGBCADLI",
  "ABCDEGIK":"EGBCADIK","ABCDEGIJ":"EGBCADIJ","ABCDEGHL":"HGBCADLE","ABCDEGHK":"HGBCADEK","ABCDEGHJ":"HGBCADEJ","ABCDEGHI":"HGBCADEI",
  "ABCDEFKL":"CEBDAFLK","ABCDEFJL":"CJBDAFLE","ABCDEFJK":"CJBDAFEK","ABCDEFIL":"CEBDAFLI","ABCDEFIK":"CEBDAFIK","ABCDEFIJ":"CJBDAFEI",
  "ABCDEFHL":"HFBCADLE","ABCDEFHK":"HEBCAFDK","ABCDEFHJ":"HJBCAFDE","ABCDEFHI":"HEBCAFDI","ABCDEFGL":"CGBDAFLE","ABCDEFGK":"CGBDAFEK",
  "ABCDEFGJ":"CGBDAFEJ","ABCDEFGI":"CGBDAFEI","ABCDEFGH":"HGBCAFDE",
};

// Annex C column order → R32 slot index mapping:
// Annex C columns: [1A, 1B, 1D, 1E, 1G, 1I, 1K, 1L]
// R32 slots with "3rd": [2→1E, 3→1I, 6→1A, 7→1L, 10→1D, 11→1G, 14→1B, 15→1K]
const ANNEX_C_COL_TO_R32_SLOT: Record<number, number> = {
  0: 6,   // column 0 (1A) → R32 slot 6
  1: 12,  // column 1 (1B) → R32 slot 12
  2: 9,   // column 2 (1D) → R32 slot 9
  3: 2,   // column 3 (1E) → R32 slot 2
  4: 8,   // column 4 (1G) → R32 slot 8
  5: 5,   // column 5 (1I) → R32 slot 5
  6: 15,  // column 6 (1K) → R32 slot 15
  7: 7,   // column 7 (1L) → R32 slot 7
};

// Rank all 12 third-place finishers by FIFA tiebreakers (pts → GD → GF → alphabetical)
// and return the top 8. Each entry includes the group letter and standing row.
type ThirdPlaceEntry = { group: string; row: StandingRow };

function rankThirdPlaceTeams(
  standingsByGroup: Record<string, GroupStanding>,
): { qualified: ThirdPlaceEntry[]; eliminated: ThirdPlaceEntry[]; allComplete: boolean } {
  const entries: ThirdPlaceEntry[] = [];
  let allComplete = true;
  for (const [group, standing] of Object.entries(standingsByGroup)) {
    if (!standing.complete) { allComplete = false; continue; }
    const thirdPlace = standing.rows[2];
    if (thirdPlace) entries.push({ group, row: thirdPlace });
  }

  // FIFA tiebreakers: points → goal difference → goals for → alphabetical (lots stand-in)
  entries.sort((a, b) =>
    b.row.pts - a.row.pts
    || (b.row.gf - b.row.ga) - (a.row.gf - a.row.ga)
    || b.row.gf - a.row.gf
    || a.group.localeCompare(b.group)
  );

  return {
    qualified: entries.slice(0, 8),
    eliminated: entries.slice(8),
    allComplete,
  };
}

function thirdSeedGroups(seed: string): string[] {
  const m = seed.match(/^3([A-L]+)$/);
  return m ? [...m[1]] : [];
}

function thirdSeedLabel(seed: string): string {
  const groups = thirdSeedGroups(seed);
  return groups.length ? `3rd Place Group ${groups.join("/")}` : "Best 3rd";
}

// Given the 8 qualifying third-place groups, resolve any R32 third-place slot
// that can be determined unambiguously from the slot's eligible groups.
function resolveThirdPlaceSlots(
  standingsByGroup: Record<string, GroupStanding>,
): Map<number, { team: string; group: string }> | null {
  const { qualified, allComplete } = rankThirdPlaceTeams(standingsByGroup);
  // Need all 12 groups complete and exactly 8 qualifiers
  if (!allComplete || qualified.length !== 8) return null;

  // Build a team lookup by group: group letter → team name
  const teamByGroup: Record<string, string> = {};
  for (const entry of qualified) teamByGroup[entry.group] = entry.row.t;

  const slotMap = new Map<number, { team: string; group: string }>();
  R32_SEEDS.forEach(([, seedB], slotIndex) => {
    const candidates = thirdSeedGroups(seedB);
    if (!candidates.length) return;
    const resolvedGroups = candidates.filter(group => teamByGroup[group]);
    if (resolvedGroups.length === 1) {
      const group = resolvedGroups[0];
      slotMap.set(slotIndex, { team: teamByGroup[group], group });
    }
  });

  return slotMap;
}

function ordinalSeedLabel(seed: string): string {
  const m = seed.match(/^([123])([A-L])$/);
  if (!m) return thirdSeedGroups(seed).length ? thirdSeedLabel(seed) : seed || "TBD";
  const place = m[1] === "1" ? "1st" : m[1] === "2" ? "2nd" : "3rd";
  return `${place} Group ${m[2]}`;
}

function completedGroupStanding(
  g: string,
  data: TournamentData,
  fixtures: LiveFixture[],
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null,
  nowMs: number,
): GroupStanding {
  const teams = data.groups[g] || [];
  const T: Record<string, StandingRow> = {};
  teams.forEach(t => T[t] = { t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
  let played = 0;
  for (const m of data.gs) {
    if (m.g !== g) continue;
    const f = findLive(m, fixtures);
    const hasKickedOff = m.ts <= nowMs + 5 * 60000;
    let t1g: number | null = null, t2g: number | null = null;
    if (hasKickedOff && f && DONE_STATUSES.has(f.status)) {
      const gg = goalsFor(m, f);
      t1g = gg.t1; t2g = gg.t2;
    } else if (hasKickedOff && m.dbStatus && DONE_STATUSES.has(m.dbStatus) && m.dbGh != null && m.dbGa != null) {
      t1g = m.dbGh; t2g = m.dbGa;
    }
    if (t1g == null || t2g == null) continue;
    const A = T[m.t1], Bx = T[m.t2];
    if (!A || !Bx) continue;
    A.p++; Bx.p++; A.gf += t1g; A.ga += t2g; Bx.gf += t2g; Bx.ga += t1g; played++;
    if (t1g > t2g) { A.w++; A.pts += 3; Bx.l++; }
    else if (t1g < t2g) { Bx.w++; Bx.pts += 3; A.l++; }
    else { A.d++; Bx.d++; A.pts++; Bx.pts++; }
  }
  const rows = teams.map(t => T[t]).sort((a, b) =>
    b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.t.localeCompare(b.t));
  const expectedMatches = data.gs.filter(m => m.g === g).length;
  return { rows, played, complete: expectedMatches > 0 && played === expectedMatches };
}

function resolveGroupSeed(seed: string, standingsByGroup: Record<string, GroupStanding>): KnockoutParticipant {
  const label = ordinalSeedLabel(seed);
  const m = seed.match(/^([123])([A-L])$/);
  if (!m) return { name: label, placeholder: true };
  const [, place, group] = m;
  const standing = standingsByGroup[group];
  const index = Number(place) - 1;
  const qualified = standing?.complete ? standing.rows[index]?.t : "";
  return qualified ? { name: qualified, seed: label } : { name: label, placeholder: true };
}

function isCompletedKnockoutFixture(fixture: LiveFixture | null): fixture is LiveFixture {
  return !!fixture &&
    DONE_STATUSES.has(fixture.status) &&
    fixture.gh != null &&
    fixture.ga != null &&
    (
      fixture.gh !== fixture.ga ||
      (fixture.penHome != null && fixture.penAway != null && fixture.penHome !== fixture.penAway)
    );
}

function winnerNameFromKnockoutFixture(fixture: LiveFixture | null, teamName: (name: string | undefined | null) => string): string | null {
  if (!isCompletedKnockoutFixture(fixture) || fixture.gh == null || fixture.ga == null) return null;
  if (fixture.gh === fixture.ga) {
    if (fixture.penHome == null || fixture.penAway == null || fixture.penHome === fixture.penAway) return null;
    return fixture.penHome > fixture.penAway ? teamName(fixture.home) : teamName(fixture.away);
  }
  return fixture.gh > fixture.ga ? teamName(fixture.home) : teamName(fixture.away);
}

function loserNameFromKnockoutFixture(fixture: LiveFixture | null, teamName: (name: string | undefined | null) => string): string | null {
  if (!isCompletedKnockoutFixture(fixture) || fixture.gh == null || fixture.ga == null) return null;
  if (fixture.gh === fixture.ga) {
    if (fixture.penHome == null || fixture.penAway == null || fixture.penHome === fixture.penAway) return null;
    return fixture.penHome > fixture.penAway ? teamName(fixture.away) : teamName(fixture.home);
  }
  return fixture.gh > fixture.ga ? teamName(fixture.away) : teamName(fixture.home);
}

function calculateKnockoutProgress(rounds: { cards: KnockoutCardModel[] }[]) {
  const total = rounds.reduce((sum, round) => sum + round.cards.length, 0);
  const completed = rounds.reduce((sum, round) => sum + round.cards.filter(card => card.isDone).length, 0);
  const live = rounds.reduce((sum, round) => sum + round.cards.filter(card => card.isLive).length, 0);
  return { total, completed, live, pct: total ? Math.round((completed / total) * 100) : 0 };
}

function parseISO(iso: string): Date {
  const [y, m, da] = iso.split("-").map(Number);
  return new Date(y, m - 1, da);
}

function todayISO(): string {
  const n = new Date();
  return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
}

function liveBadge(f: LiveFixture): string {
  if (LIVE_STATUSES.has(f.status)) return `<span class="lv">${f.status === "HT" ? "HT" : (f.elapsed ? f.elapsed + "'" : "LIVE")}</span>`;
  if (DONE_STATUSES.has(f.status)) return `<span class="ft">${f.status === "AET" ? "AET" : (f.status === "PEN" ? "PENS" : "FT")}</span>`;
  return "";
}

function goalsFor(m: { t1?: string; t2?: string }, f: LiveFixture) {
  const a = canon(f.home);
  const homeIsT1 = a === m.t1;
  if (!homeIsT1 && canon(f.away) !== m.t1) return { t1: f.gh, t2: f.ga, homeIsT1: true };
  return { t1: homeIsT1 ? f.gh : f.ga, t2: homeIsT1 ? f.ga : f.gh, homeIsT1 };
}

function human(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return totalSec + "s";
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return m + "m " + String(s).padStart(2, "0") + "s";
  const h = Math.floor(m / 60);
  return h + "h " + String(m % 60).padStart(2, "0") + "m " + String(s).padStart(2, "0") + "s";
}

function esc(s: string | number): string {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));
}

type AppIconName = "home" | "bracket" | "groups" | "calendar" | "stats" | "teams" | "map" | "more" | "boot" | "assist" | "venue" | "ball" | "info" | "bell" | "share" | "settings";

function AppIcon({ name, className = "" }: { name: AppIconName; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      {name === "home" && <><path {...common} d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/></>}
      {name === "bracket" && <><path {...common} d="M5 5h5v5H5zM5 14h5v5H5zM14 9h5v6h-5z"/><path {...common} d="M10 7.5h2.5c1 0 1.5.5 1.5 1.5v3c0 1 .5 1.5 1.5 1.5H19"/></>}
      {name === "groups" && <><circle {...common} cx="8" cy="8" r="3"/><circle {...common} cx="16" cy="8" r="3"/><circle {...common} cx="12" cy="16" r="3"/></>}
      {name === "calendar" && <><rect {...common} x="4" y="5" width="16" height="15" rx="2"/><path {...common} d="M8 3v4M16 3v4M4 10h16"/></>}
      {name === "stats" && <><path {...common} d="M6 19V12M12 19V5M18 19v-9"/><path {...common} d="M4 19h16"/></>}
      {name === "teams" && <><path {...common} d="M12 3 4 6v5c0 5.2 3.4 10 8 11 4.6-1 8-5.8 8-11V6z"/></>}
      {name === "map" && <><path {...common} d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z"/><path {...common} d="M9 3v15"/><path {...common} d="M15 6v15"/><circle {...common} cx="15" cy="11" r="1.8"/></>}
      {name === "more" && <><circle {...common} cx="6" cy="12" r="1.4"/><circle {...common} cx="12" cy="12" r="1.4"/><circle {...common} cx="18" cy="12" r="1.4"/></>}
      {name === "boot" && <><path {...common} d="M5 5v7.5c0 2 1.4 3.5 3.4 3.5H19c.7 0 1.2.5 1.2 1.2V19H8.5C5.5 19 3 16.5 3 13.5V5z"/><path {...common} d="M7 8h5M7 11h4M14 16l2.5-3"/></>}
      {name === "assist" && <><path {...common} d="M4 16c4.8-7.8 10.5-9 16-7"/><path {...common} d="M16 5h4v4"/><circle {...common} cx="7" cy="17" r="2.2"/></>}
      {name === "venue" && <><path {...common} d="M4 15c1.8-3.5 4.5-5.2 8-5.2s6.2 1.7 8 5.2"/><path {...common} d="M5 16h14M7 19h10"/><path {...common} d="M8 10V7h8v3"/></>}
      {name === "ball" && <><circle {...common} cx="12" cy="12" r="8"/><path {...common} d="m12 8 3 2-1 3h-4l-1-3zM12 4v4M5.5 10l3.5.5M18.5 10l-3.5.5M8.5 18l1.5-5M15.5 18 14 13"/></>}
      {name === "info" && <><circle {...common} cx="12" cy="12" r="8"/><path {...common} d="M12 11v5M12 8h.01"/></>}
      {name === "bell" && <><path {...common} d="M6 16h12l-1.5-2.2V10a4.5 4.5 0 0 0-9 0v3.8z"/><path {...common} d="M10 19a2 2 0 0 0 4 0"/></>}
      {name === "share" && <><path {...common} d="M12 15V4"/><path {...common} d="m8 8 4-4 4 4"/><path {...common} d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></>}
      {name === "settings" && <><circle {...common} cx="12" cy="12" r="3"/><path {...common} d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.8-1L14.4 3h-4.8L9.2 6a7 7 0 0 0-1.8 1L5 6.1l-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.8 1l.4 3h4.8l.4-3a7 7 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z"/></>}
    </svg>
  );
}

function venueImageUrl(venueId: string): string {
  return HOST_VENUE_DETAILS[venueId]?.imageUrl || "";
}

function venueInitials(name: string, city?: string): string {
  const source = name || city || "Venue";
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || "")
    .join("") || "V";
}

function VenueImage({ venueId, venueName, city = "", className = "", decorative = false }: {
  venueId: string;
  venueName: string;
  city?: string;
  className?: string;
  decorative?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const src = venueImageUrl(venueId);
  const fallback = venueInitials(venueName, city);
  return (
    <span className={`venue-image ${className}${!src || broken ? " venue-image--fallback" : ""}`} aria-hidden={decorative ? "true" : undefined}>
      {src && !broken
        ? <img src={src} alt={decorative ? "" : `${venueName} stadium`} loading="lazy" decoding="async" onError={() => setBroken(true)} />
        : <span>{fallback}</span>}
    </span>
  );
}

function venueImageHtml(venueId: string, venueName: string, city?: string): string {
  const src = venueImageUrl(venueId);
  const fallback = esc(venueInitials(venueName, city));
  const alt = esc(`${venueName} stadium`);
  if (!src) return `<span class="venue-image venue-image--inline venue-image--fallback" aria-hidden="true"><span>${fallback}</span></span>`;
  return `<span class="venue-image venue-image--inline"><img src="${esc(src)}" alt="${alt}" loading="lazy" decoding="async" onerror="this.closest('.venue-image').classList.add('venue-image--fallback');this.remove();" /><span>${fallback}</span></span>`;
}

function isMock(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.search.indexOf("mock") > -1;
}


/* Resolves every knockout card — teams filled from live fixtures when they
 * exist, otherwise from bracket progression (group standings seed the R32
 * slots; winner/loser chains fill later rounds). Shared by the schedule
 * view, the knockout view, and the map, so a tie whose fixture the vendor
 * has not published yet still shows its resolved participants everywhere.
 */
function buildKnockoutCards(
  data: TournamentData,
  fixtures: LiveFixture[],
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null,
  nowMs: number,
): KnockoutCardModel[] {
  const standingsByGroup: Record<string, GroupStanding> = {};
  for (const g of Object.keys(data.groups)) standingsByGroup[g] = completedGroupStanding(g, data, fixtures, findLive, nowMs);
  const thirdSlots = resolveThirdPlaceSlots(standingsByGroup);
    const winners: Partial<Record<KnockoutRoundKey, (string | null)[]>> = {};
    const losers: Partial<Record<KnockoutRoundKey, (string | null)[]>> = {};

    function teamName(name: string | undefined | null): string {
      if (!name) return "TBD";
      return canon(name) || name;
    }
    function winnerFromFixture(fixture: LiveFixture | null): string | null {
      return winnerNameFromKnockoutFixture(fixture, teamName);
    }
    function loserFromFixture(fixture: LiveFixture | null): string | null {
      return loserNameFromKnockoutFixture(fixture, teamName);
    }
    function fixtureFromMatchState(match: KnockoutMatch): LiveFixture | null {
      if (!match.t1 || !match.t2 || !match.dbStatus) return null;
      return {
        ts: match.ts,
        status: match.dbStatus,
        elapsed: match.dbElapsed ?? null,
        venue: match.v,
        round: match.round,
        home: match.t1,
        away: match.t2,
        gh: match.dbGh ?? null,
        ga: match.dbGa ?? null,
        events: match.dbEvents,
        stats: match.dbStats,
        lineups: match.dbLineups,
        players: match.dbPlayers,
        referee: match.dbReferee || undefined,
        fixtureId: match.dbFixtureId || undefined,
      };
    }
    function sourcePair(round: KnockoutRoundKey, index: number): [number, number] {
      return KO_SOURCE_PAIRS[round]?.[index] || [index * 2, index * 2 + 1];
    }
    function previousTeam(round: KnockoutRoundKey, index: number): string | null {
      if (round === "r16") return winners.r32?.[index] || null;
      if (round === "qf") return winners.r16?.[index] || null;
      if (round === "sf") return winners.qf?.[index] || null;
      if (round === "final") return winners.sf?.[index] || null;
      if (round === "third") return losers.sf?.[index] || null;
      return null;
    }
    function sourceLabel(round: KnockoutRoundKey, index: number, side: number): string {
      if (round === "r32") return ordinalSeedLabel(R32_SEEDS[index]?.[side] || "TBD");
      const [a, b] = sourcePair(round, index);
      const sourceIndex = side === 0 ? a : b;
      const sourceRound = round === "r16" ? KO_ROUNDS[0] : round === "qf" ? KO_ROUNDS[1] : round === "sf" ? KO_ROUNDS[2] : KO_ROUNDS[3];
      const prefix = round === "third" ? "Loser" : "Winner";
      return `${prefix} M${sourceRound.matchNumbers[sourceIndex] || "TBD"}`;
    }
    function unresolvedTeams(config: typeof KO_ROUNDS[number], index: number): [KnockoutParticipant, KnockoutParticipant] {
      if (config.key === "r32") {
        const [seedA, seedB] = R32_SEEDS[index] || ["TBD", "TBD"];
        const teamAResolved = resolveGroupSeed(seedA, standingsByGroup);
        let teamBResolved: KnockoutParticipant;
        if (thirdSeedGroups(seedB).length && thirdSlots) {
          const resolved = thirdSlots.get(index);
          teamBResolved = resolved
            ? { name: resolved.team, seed: `3rd Group ${resolved.group}` }
            : { name: thirdSeedLabel(seedB), placeholder: true };
        } else {
          teamBResolved = resolveGroupSeed(seedB, standingsByGroup);
        }
        return [teamAResolved, teamBResolved];
      }

      const [sourceA, sourceB] = sourcePair(config.key, index);
      const first = previousTeam(config.key, sourceA);
      const second = previousTeam(config.key, sourceB);
      return [
        { name: first || sourceLabel(config.key, index, 0), placeholder: !first },
        { name: second || sourceLabel(config.key, index, 1), placeholder: !second },
      ];
    }

    const all: KnockoutCardModel[] = [];
    const claimedFixtureKeys = new Set<string>();
    for (const config of KO_ROUNDS) {
      const scheduled = data.ko.filter(match => match.round === config.dataRound);
      const roundCards = scheduled.map((match, index) => {
        const matchNo = config.matchNumbers[index] || Number(match.mr) || 0;
        let teams = unresolvedTeams(config, index);
        const liveFixture = findLive({ ts: match.ts, v: match.v }, fixtures);
        const fixture = claimKnockoutFixtureForSlot({
          directFixture: liveFixture || fixtureFromMatchState(match),
          fixtures,
          round: config.dataRound,
          slotTeams: teams,
          claimedFixtureKeys,
        });
        const isLive = !!fixture && LIVE_STATUSES.has(fixture.status) && !isStaleStatus(match.ts, fixture.status, nowMs);
        const isDone = isCompletedKnockoutFixture(fixture);
        const winnerName = winnerFromFixture(fixture);
        const loserName = loserFromFixture(fixture);

        const hasMatchTeams = !!match.t1 && !!match.t2 && match.t1 !== "TBD" && match.t2 !== "TBD";
        const trustVendorTeams = fixture?.home && fixture?.away &&
          (config.key === "r32" || isLive || isDone);

        if (trustVendorTeams) {
          const home = teamName(fixture!.home);
          const away = teamName(fixture!.away);
          teams = [
            { name: home, winner: winnerName === home, loser: loserName === home },
            { name: away, winner: winnerName === away, loser: loserName === away },
          ];
        } else if (hasMatchTeams) {
          const home = teamName(match.t1);
          const away = teamName(match.t2);
          teams = [
            { name: home, winner: winnerName === home, loser: loserName === home },
            { name: away, winner: winnerName === away, loser: loserName === away },
          ];
        }

        // Compute bracket path links: which two matches feed this slot,
        // and which match in the next round this slot feeds into.
        const sourceMatchNos: [number, number] | null = config.key !== "r32" && KO_SOURCE_PAIRS[config.key]
          ? (() => {
              const [a, b] = sourcePair(config.key, index);
              const prevRoundKey: KnockoutRoundKey = config.key === "r16" ? "r32" : config.key === "qf" ? "r16" : config.key === "sf" ? "qf" : config.key === "final" ? "sf" : config.key === "third" ? "sf" : "r32";
              const prevRound = KO_ROUNDS.find(r => r.key === prevRoundKey);
              return prevRound ? [prevRound.matchNumbers[a], prevRound.matchNumbers[b]] as [number, number] : null;
            })()
          : null;

        const nextMatchNo: number | null = (() => {
          if (config.key === "final" || config.key === "third") return null;
          const nextRoundKey: KnockoutRoundKey = config.key === "r32" ? "r16" : config.key === "r16" ? "qf" : config.key === "qf" ? "sf" : "final";
          const nextPairs = KO_SOURCE_PAIRS[nextRoundKey];
          if (!nextPairs) return null;
          const nextIndex = nextPairs.findIndex(pair => pair.includes(index));
          const nextRound = KO_ROUNDS.find(r => r.key === nextRoundKey);
          return nextIndex >= 0 && nextRound ? nextRound.matchNumbers[nextIndex] : null;
        })();

        return {
          key: `${config.key}-schedule-${matchNo}-${index}`,
          round: config.key,
          roundIndex: index,
          match,
          matchNo,
          fixture,
          teams,
          source: config.label,
          isDone,
          isLive,
          winnerName,
          loserName,
          sourceMatchNos,
          nextMatchNo,
        };
      });
      winners[config.key] = roundCards.map(card => card.winnerName);
      losers[config.key] = roundCards.map(card => card.loserName);
      all.push(...roundCards);
    }
    return all;
}

type InitialLiveData = {
  fixtures: LiveFixture[];
  leaderboardStats: ExternalLeaderStat[];
  ts: number;
  active: boolean;
} | null;

export default function Tournament({ data, initialView = "home", initialLiveData = null }: { data: TournamentData; initialView?: string; initialLiveData?: InitialLiveData }) {
  const fl = (t: string) => data.flags[t] || "⚽";
  const ven = (k: string) => data.venues[k] || { common: "", fifa: "", city: "", country: "", cap: 0 };
  const vName = (k: string) => (data.venues[k] || { common: "" }).common || "";
  const allTeams = [...new Set(Object.values(data.groups).flat())].sort();

  /* useCallback keeps findLive's identity stable across renders — it is a
     dependency of memos in nearly every child view, so a fresh function per
     render silently defeated all of them. */
  const findLive = useCallback((m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]): LiveFixture | null => {
    if (!fx.length) return null;
    let best: LiveFixture | null = null;
    let bd = Number.POSITIVE_INFINITY;
    const windowMs = 75 * 60000;
    const vn = nrm(vName((m as GroupStageMatch).v || ""));
    const hasScheduleTeams = !!(m.t1 && m.t2 && m.t1 !== "TBD" && m.t2 !== "TBD");
    for (const f of fx) {
      const dt = Math.abs((f.ts || 0) - (m.ts || 0));
      const fv = nrm(f.venue);
      const venOK = vn && fv && (fv === vn || fv.indexOf(vn) > -1 || vn.indexOf(fv) > -1);
      let teamOK = false;
      if (hasScheduleTeams) {
        const a = canon(f.home), b = canon(f.away);
        teamOK = (a === m.t1 && b === m.t2) || (a === m.t2 && b === m.t1);
      }
      const knockoutLike = /round|r32|r16|quarter|semi|final|knockout/i.test(f.round || "");
      // For knockout matches without scheduled teams, accept a near-exact
      // timestamp (< 5 min) as identity when venue fails — vendor APIs
      // sometimes return alternate venue names (e.g. "Estadio Banorte"
      // instead of "Estadio Azteca") and knockout kickoff times are unique.
      const timestampIdentity = !hasScheduleTeams && knockoutLike && f.ts && dt < 5 * 60_000;
      const timeOK = f.ts ? dt <= windowMs : (!hasScheduleTeams && knockoutLike && !!venOK);
      const identityOK = hasScheduleTeams ? (teamOK || !!venOK) : (!!venOK || !!timestampIdentity);
      if (!timeOK || !identityOK) continue;
      const distance = f.ts ? dt : windowMs + 1;
      if (distance < bd) { bd = distance; best = f; }
    }
    return best;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const [view, setView] = useState<ViewType>(() => isViewType(initialView) ? initialView : "home");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("view");
    if (isViewType(p)) {
      queueMicrotask(() => setView(p));
    }
  }, []);
  const [group, setGroup] = useState("ALL");
  const [team, setTeam] = useState("ALL");
  const [stage, setStage] = useState("ALL");
  const [query, setQuery] = useState("");
  const [fixtures, setFixtures] = useState<LiveFixture[]>(() => initialLiveData?.fixtures || []);
  const [leaderboardStats, setLeaderboardStats] = useState<ExternalLeaderStat[]>(() => initialLiveData?.leaderboardStats || []);

  /* Populate the global player-image index during render (useMemo, not
     useEffect) so avatars sourced from the index appear in the same pass —
     the write is idempotent and keyed only on the live payload. */
  useMemo(() => rebuildPlayerImageIndex(fixtures, leaderboardStats), [fixtures, leaderboardStats]);

  /* Development-only data integrity audit: every time live data changes,
     rebuild the canonical match list + team records and log any broken
     invariant (duplicate matches, goal imbalances, knockout progression
     contradictions). Zero cost in production builds. */
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const matches = buildAnalyticsMatches(data, fixtures, findLive, Date.now());
    const teams = Object.values(data.groups).flat().map(canon);
    const { issues } = auditTournament(teams, matches.map(mm => ({
      key: mm.key, stage: mm.stage, ts: mm.ts, home: mm.home, away: mm.away,
      status: mm.status, gh: mm.gh, ga: mm.ga,
      penHome: mm.fixture?.penHome ?? null, penAway: mm.fixture?.penAway ?? null,
    })), {
      rawFixtures: fixtures.map(fixture => ({
        round: fixture.round,
        home: fixture.home,
        away: fixture.away,
        ts: fixture.ts,
        status: fixture.status,
        gh: fixture.gh,
        ga: fixture.ga,
        penHome: fixture.penHome,
        penAway: fixture.penAway,
      })),
    });
    if (issues.length) {
      console.warn(`[integrity] ${issues.length} issue(s) detected:`);
      for (const issue of issues) console.warn(`[integrity] ${issue.level.toUpperCase()} ${issue.code}: ${issue.message}`);
    } else {
      console.info("[integrity] all invariants hold");
    }
    /* Expose for inspection in dev tooling/tests */
    (window as unknown as { __competAudit?: unknown }).__competAudit = { issues, matchCount: matches.length };
  }, [data, fixtures, findLive]);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>(() => initialLiveData ? (initialLiveData.active ? "active" : "idle") : "init");
  const [liveTs, setLiveTs] = useState(() => initialLiveData?.ts || 0);
  const [, setLiveStale] = useState(false);
  const [liveEnrichmentIssue, setLiveEnrichmentIssue] = useState("");
  const [animate, setAnimate] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /* Timestamp of the last network poll — backs the fetch-storm guard */
  const lastPollAtRef = useRef(0);
  const [teamDrawer, setTeamDrawer] = useState<string | null>(null);
  const [hostDrawer, setHostDrawer] = useState<string | null>(null);
  const [matchDetail, setMatchDetail] = useState<{ match: GroupStageMatch; fixture: LiveFixture | null } | null>(null);
  /* One-shot handoff: a stadium card elsewhere (More view) requests the map
     to open centered on this venue. Cleared once the map consumes it. */
  const [mapVenueTarget, setMapVenueTarget] = useState<string | null>(null);
  const clearMapVenueTarget = useCallback(() => setMapVenueTarget(null), []);
  const [playerProfile, setPlayerProfile] = useState<{ name: string; team: string } | null>(null);
  const [goalToast, setGoalToast] = useState<{ team: string; player: string; minute: string; score: string; flag: string } | null>(null);
  const [toastExiting, setToastExiting] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [favs, toggleFav] = useFavorites();
  const prevScoresRef = useRef<Map<string, string>>(new Map());
  const scrolledRef = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  const [showBackTop, setShowBackTop] = useState(false);

  /* PWA install prompt — captured from beforeinstallprompt event */
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  const pollLive = useCallback(async () => {
    /* Focus/visibility/online handlers all funnel here — a window-manager
       focus flap (or automation) must not turn into a fetch storm. Skip
       network refreshes within 5s of the previous one; the regular
       interval and genuine returns-to-tab are unaffected. */
    if (!isMock()) {
      const sinceLast = Date.now() - lastPollAtRef.current;
      if (sinceLast < 5000) return;
      lastPollAtRef.current = Date.now();
    }
    if (isMock()) {
      const mockFixtures = MOCK_FIXTURES as LiveFixture[];
      setFixtures(mockFixtures);
      setLiveStatus("active");
      const ts = Date.now();
      setLiveTs(ts);
      setLiveEnrichmentIssue("");
      persistLiveData(mockFixtures, ts, "mock");
      return;
    }
    try {
      logLiveDataSource("fetch: requesting fresh /api/live from network");
      const r = await fetch(`/api/live?ts=${Date.now()}`, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, max-age=0",
          "Pragma": "no-cache",
        },
      });
      if (!r.ok) throw new Error("fetch failed");
      const j = await r.json();
      const nextFixtures = Array.isArray(j.fixtures) ? j.fixtures : [];
      const nextLeaderboardStats = Array.isArray(j.leaderboardStats) ? j.leaderboardStats : [];
      const nextTs = j.ts || Date.now();
      if (j.configured === false) {
        setLiveStatus("off");
        setFixtures(nextFixtures);
        setLeaderboardStats(nextLeaderboardStats);
        setLiveTs(nextTs);
        persistLiveData(nextFixtures, nextTs, "network", nextLeaderboardStats);
        setLiveEnrichmentIssue(j.active ? "Live enrichment is not configured" : "");
        return;
      }
      setFixtures(nextFixtures);
      setLeaderboardStats(nextLeaderboardStats);
      setLiveTs(nextTs);
      persistLiveData(nextFixtures, nextTs, "network", nextLeaderboardStats);
      setLiveStale(!!j.stale);
      const enrichmentUnhealthy = !!(j.enrichment?.required && !j.enrichment?.healthy);
      setLiveEnrichmentIssue(enrichmentUnhealthy ? "Live enrichment needs attention" : "");
      if (j.stale || enrichmentUnhealthy) setLiveStatus("paused");
      else if (j.active && (!j.fixtures || j.fixtures.length === 0)) setLiveStatus("nofix");
      else if (j.active) setLiveStatus("active");
      else setLiveStatus("idle");
      logLiveDataSource("fetch: fresh network data applied to shared store", {
        fixtureCount: nextFixtures.length,
        ts: nextTs,
        apiSource: j.source,
        status: j.active ? "active" : "idle",
      });
    } catch (error) {
      const fallback = readPersistedLiveData("network failure");
      if (fallback && fixtures.length === 0) {
        setFixtures(fallback.fixtures);
        setLeaderboardStats(fallback.leaderboardStats || []);
        setLiveTs(fallback.ts);
      }
      setLiveEnrichmentIssue("Live enrichment fetch failed");
      setLiveStatus(prev => prev === "init" ? "off" : "paused");
      logLiveDataSource("fetch: network failed; persisted data remains fallback only", {
        error: String(error),
        fallbackCount: fallback?.fixtures.length || 0,
      });
    }
  }, [fixtures.length]);

  const schedule = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (isMock()) return;
    const ms = liveStatus === "active" || view === "stats" ? 30000 : 60000;
    timerRef.current = setInterval(() => { pollLive(); }, ms);
  }, [liveStatus, pollLive, view]);

  useEffect(() => {
    if (view !== "stats") return;
    const refresh = window.setTimeout(() => { void pollLive(); }, 0);
    return () => window.clearTimeout(refresh);
  }, [pollLive, view]);

  useEffect(() => {
    queueMicrotask(() => {
      setNowMs(Date.now());
      pollLive().then(schedule);
    });
    const refreshFromNetwork = () => {
      setNowMs(Date.now());
      pollLive().then(schedule);
    };
    const onVis = () => {
      if (document.hidden) {
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        refreshFromNetwork();
      }
    };
    const onFocus = () => {
      if (!document.hidden) refreshFromNetwork();
    };
    const onOnline = () => refreshFromNetwork();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    const refreshTimer = setInterval(() => {
      if (!document.hidden) setNowMs(Date.now());
    }, 60000);
    const countdownTimer = setInterval(() => {
      if (document.hidden) return;
      document.querySelectorAll<HTMLSpanElement>(".countdown[data-target]").forEach(el => {
        const target = Number(el.dataset.target);
        const diff = target - Date.now();
        el.textContent = diff <= 0 ? "kicking off now" : human(diff);
      });
    }, 1000);
    /* PWA: capture the install prompt so we can trigger it from the UI */
    const onBip = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    /* Hide install banner if the app is already installed */
    if (window.matchMedia("(display-mode: standalone)").matches) {
      queueMicrotask(() => setShowInstall(false));
    }
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeinstallprompt", onBip);
      if (timerRef.current) clearInterval(timerRef.current);
      clearInterval(refreshTimer);
      clearInterval(countdownTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    schedule();
  }, [liveStatus, schedule]);

  useEffect(() => {
    if (scrolledRef.current || view !== "schedule") return;
    requestAnimationFrame(() => {
      const anchor = document.getElementById("next-match-anchor");
      if (anchor) {
        anchor.scrollIntoView({ behavior: "smooth", block: "start" });
        scrolledRef.current = true;
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, fixtures.length, liveStatus, liveTs]);

  // Detect goal changes and show toast notification
  useEffect(() => {
    if (fixtures.length === 0) return;
    const prev = prevScoresRef.current;
    const next = new Map<string, string>();
    for (const f of fixtures) {
      if (!LIVE_STATUSES.has(f.status) && !DONE_STATUSES.has(f.status)) continue;
      if (f.gh == null || f.ga == null) continue;
      const key = canon(f.home) + ":" + canon(f.away);
      next.set(key, `${f.gh}-${f.ga}`);
      const old = prev.get(key);
      if (old && old !== `${f.gh}-${f.ga}` && LIVE_STATUSES.has(f.status)) {
        const [oldH] = old.split("-").map(Number);
        const scoringTeam = f.gh > oldH ? f.home : f.away;
        const lastEvent = (f.events || []).filter((e: MatchEvent) => e.type === "Goal").pop();
        const flag = data.flags[scoringTeam] || "⚽";
        setGoalToast({
          team: scoringTeam,
          player: lastEvent?.player || "GOAL",
          minute: lastEvent ? `${lastEvent.minute}'` : `${f.elapsed || ""}'`,
          score: `${f.home} ${f.gh} – ${f.ga} ${f.away}`,
          flag,
        });
        setToastExiting(false);
        setTimeout(() => setToastExiting(true), 3500);
        setTimeout(() => setGoalToast(null), 3900);
      }
    }
    prevScoresRef.current = next;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtures]);

  /* Show back-to-top button after scrolling past the fold */
  useEffect(() => {
    const onScroll = () => setShowBackTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Cmd+K / Ctrl+K opens search overlay */
  useEffect(() => {
    function handleKeyboard(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyboard);
    return () => document.removeEventListener("keydown", handleKeyboard);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const teamEl = (e.target as HTMLElement).closest("[data-team]") as HTMLElement | null;
      if (teamEl) {
        e.preventDefault();
        setTeamDrawer(teamEl.dataset.team || null);
        return;
      }
      const matchEl = (e.target as HTMLElement).closest("[data-match-id]") as HTMLElement | null;
      if (matchEl && !(e.target as HTMLElement).closest("[data-team]")) {
        const matchNo = parseInt(matchEl.dataset.matchId || "0", 10);
        const m = data.gs.find(g => g.no === matchNo);
        if (m) {
          const f = findLive(m, fixtures);
          setMatchDetail({ match: m, fixture: f });
        }
        return;
      }
      const koMatchEl = (e.target as HTMLElement).closest("[data-ko-match-id]") as HTMLElement | null;
      if (koMatchEl) {
        const matchNo = parseInt(koMatchEl.dataset.koMatchId || "0", 10);
        const card = buildKnockoutScheduleCards().find(item => item.matchNo === matchNo);
        if (card) setMatchDetail({ match: knockoutCardToMatch(card), fixture: card.fixture });
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [fixtures, data.gs, data.ko, data.groups]);

  const today = todayISO();

  function matchHit(m: GroupStageMatch): boolean {
    if (stage !== "ALL" && stage !== "groups") return false;
    if (group !== "ALL" && m.g !== group) return false;
    if (team !== "ALL" && m.t1 !== team && m.t2 !== team) return false;
    if (query) {
      const v = ven(m.v);
      const hay = (m.t1 + " " + m.t2 + " " + v.common + " " + v.fifa + " " + v.city + " " + v.country + " " + m.g).toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    return true;
  }

  function standings(g: string) {
    return completedGroupStanding(g, data, fixtures, findLive, nowMs);
  }

  const buildKnockoutScheduleCards = () => buildKnockoutCards(data, fixtures, findLive, nowMs);

  function knockoutCardToMatch(card: KnockoutCardModel): GroupStageMatch {
    const [teamA, teamB] = card.teams;
    return {
      no: card.matchNo,
      iso: card.match.iso,
      local: card.match.local,
      et: card.match.et,
      g: "KO",
      t1: teamA.placeholder ? "TBD" : teamA.name,
      t2: teamB.placeholder ? "TBD" : teamB.name,
      v: card.match.v,
      ts: card.match.ts,
    };
  }

  function koMatchHit(card: KnockoutCardModel): boolean {
    if (stage === "groups") return false;
    if (stage !== "ALL" && stage !== "knockout" && stage !== card.round) return false;
    if (group !== "ALL") return false;
    const actualTeams = card.teams.filter(t => !t.placeholder && t.name !== "TBD").map(t => t.name);
    if (team !== "ALL" && !actualTeams.includes(team)) return false;
    if (query) {
      const v = ven(card.match.v);
      const hay = [
        card.source,
        card.match.round,
        `Match ${card.matchNo}`,
        ...card.teams.map(t => t.name),
        v.common,
        v.fifa,
        v.city,
        v.country,
        "knockout",
      ].join(" ").toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    return true;
  }

  function formatGD(gd: number, matchesPlayed: number): string {
    if (matchesPlayed === 0 || gd === 0) return "0";
    return gd > 0 ? `+${gd}` : String(gd);
  }

  function liveIndicatorHtml(): string {
    const n = fixtures.filter(f => LIVE_STATUSES.has(f.status)).length;
    if (liveEnrichmentIssue) return `<div class="livebar paused" role="status"><span class="dotlive" style="background:#b58900"></span>${esc(liveEnrichmentIssue)}</div>`;
    if (n > 0) return `<div class="livebar on" role="status" aria-live="polite"><span class="dotlive"></span>${n} match${n > 1 ? "es" : ""} in play</div>`;
    if (liveStatus === "paused") return `<div class="livebar paused" role="status"><span class="dotlive" style="background:#b58900"></span>Showing latest scores</div>`;
    return "";
  }

  function teamRow(t: string, goal: string, lead: boolean): string {
    const host = data.hosts.includes(t) ? '<span class="host">HOST</span>' : "";
    return `<div class="team${lead ? " lead" : ""}"><span class="fl">${fl(t)}</span><a class="nm teamlink" data-team="${esc(t)}" href="#">${esc(t)}</a>${host}${goal}</div>`;
  }

  function koTeamRow(team: KnockoutParticipant, goal: string, lead: boolean): string {
    const isPlaceholder = !!team.placeholder || team.name === "TBD";
    const flag = isPlaceholder ? "TBD" : fl(team.name);
    const name = isPlaceholder
      ? `<span class="nm nm--placeholder">${esc(team.name)}</span>`
      : `<a class="nm teamlink" data-team="${esc(team.name)}" href="#">${esc(team.name)}</a>`;
    const seed = team.seed ? `<span class="host">${esc(team.seed)}</span>` : "";
    return `<div class="team${lead ? " lead" : ""}${isPlaceholder ? " team--placeholder" : ""}"><span class="fl">${flag}</span>${name}${seed}${goal}</div>`;
  }

  function goalScorers(events: MatchEvent[] | undefined, teamName: string): string {
    if (!events) return "";
    // Normal goals belong to the scorer's team; own goals belong to the opposing team
    const goals = events.filter(e => {
      if (e.type !== "Goal") return false;
      const isOG = e.detail === "Own Goal";
      const sameTeam = canon(e.team) === canon(teamName);
      return isOG ? !sameTeam : sameTeam;
    });
    if (!goals.length) return "";
    const names = goals.map(g => {
      const surname = g.player.split(" ").pop() || g.player;
      const min = g.extra ? `${g.minute}+${g.extra}'` : `${g.minute}'`;
      const pen = g.detail === "Penalty" ? " (P)" : g.detail === "Own Goal" ? " (OG)" : "";
      return `${esc(surname)} ${min}${pen}`;
    });
    return `<div class="scorers">${names.join(", ")}</div>`;
  }

  function tixCard(m: GroupStageMatch, anim: boolean, dimmed = false): string {
    const v = ven(m.v), gc = data.gcolor[m.g];
    const f = findLive(m, fixtures);
    const hasKickedOff = m.ts <= nowMs + 5 * 60000;
    const fStale = f && isStaleStatus(m.ts, f.status, nowMs);
    const fLive = f && LIVE_STATUSES.has(f.status) && !fStale;
    const fDone = f && DONE_STATUSES.has(f.status);
    let timeHtml: string, g1 = "", g2 = "", cls = dimmed ? " tix--done" : "", scorers1 = "", scorers2 = "";
    let lead1 = false, lead2 = false;
    if (fStale) {
      timeHtml = `<div class="lo tix__updating">Updating...</div>`;
    } else if (fLive || (hasKickedOff && fDone)) {
      const gg = goalsFor(m, f!);
      const a = gg.t1 == null ? 0 : gg.t1, b = gg.t2 == null ? 0 : gg.t2;
      g1 = `<span class="gl">${a}</span>`;
      g2 = `<span class="gl">${b}</span>`;
      lead1 = a > b; lead2 = b > a;
      if (fLive) cls += " islive";
      timeHtml = `<div class="sc">${a}–${b}</div>${liveBadge(f!)}`;
      const scorerEvents = f!.events?.length ? f!.events : m.dbEvents;
      scorers1 = goalScorers(scorerEvents, m.t1);
      scorers2 = goalScorers(scorerEvents, m.t2);
    } else if (hasKickedOff && m.dbStatus && !isStaleStatus(m.ts, m.dbStatus, nowMs) && (LIVE_STATUSES.has(m.dbStatus) || DONE_STATUSES.has(m.dbStatus)) && m.dbGh != null && m.dbGa != null) {
      const a = m.dbGh, b = m.dbGa;
      g1 = `<span class="gl">${a}</span>`;
      g2 = `<span class="gl">${b}</span>`;
      lead1 = a > b; lead2 = b > a;
      const badge = DONE_STATUSES.has(m.dbStatus) ? `<span class="ft">FT</span>` : `<span class="ft live">${m.dbStatus}</span>`;
      timeHtml = `<div class="sc">${a}–${b}</div>${badge}`;
      scorers1 = goalScorers(m.dbEvents, m.t1);
      scorers2 = goalScorers(m.dbEvents, m.t2);
    } else {
      timeHtml = `<div class="lo">${esc(m.et)}</div>${m.local !== m.et ? `<div class="et">${esc(m.local)}</div>` : ""}`;
    }
    return `<article class="tix${cls}${anim ? " stagger-rise" : ""} tix--clickable" style="--gc:${gc}" data-match-id="${m.no}">
      <span class="tix__tab"></span>
      <div class="tix__main">
        <div class="tix__teams">${teamRow(m.t1, g1, lead1)}${scorers1}<div class="vs">vs</div>${teamRow(m.t2, g2, lead2)}${scorers2}</div>
        <div class="tix__time">${timeHtml}</div>
      </div>
      <div class="tix__foot"><span class="gbadge">${m.g}</span>
        ${venueImageHtml(m.v, v.common, v.city)}<span class="ven">${esc(v.common)}</span><span class="cty">· ${esc(v.city)}, ${esc(v.country)}</span>
        <span class="mno">#${m.no}</span></div>
    </article>`;
  }

  function koTixCard(card: KnockoutCardModel, anim: boolean, dimmed = false): string {
    const v = ven(card.match.v), gc = "#D7AF5A";
    const f = card.fixture;
    const fStale = f && isStaleStatus(card.match.ts, f.status, nowMs);
    const fLive = !!f && LIVE_STATUSES.has(f.status) && !fStale;
    const fDone = !!f && DONE_STATUSES.has(f.status) && !fStale;
    let timeHtml: string, g1 = "", g2 = "", cls = dimmed ? " tix--done" : "", scorers1 = "", scorers2 = "";
    let lead1 = false, lead2 = false;
    if (fStale) {
      timeHtml = `<div class="lo tix__updating">Updating...</div>`;
    } else if (fLive || fDone) {
      const a = f.gh == null ? 0 : f.gh, b = f.ga == null ? 0 : f.ga;
      g1 = `<span class="gl">${a}</span>`;
      g2 = `<span class="gl">${b}</span>`;
      lead1 = a > b; lead2 = b > a;
      if (fLive) cls += " islive";
      timeHtml = `<div class="sc">${a}–${b}</div>${liveBadge(f)}`;
      scorers1 = goalScorers(f.events, card.teams[0].name);
      scorers2 = goalScorers(f.events, card.teams[1].name);
    } else {
      timeHtml = `<div class="lo">${esc(card.match.et)}</div>${card.match.local !== card.match.et ? `<div class="et">${esc(card.match.local)}</div>` : ""}`;
    }
    return `<article class="tix tix--ko${cls}${anim ? " stagger-rise" : ""} tix--clickable" style="--gc:${gc}" data-ko-match-id="${card.matchNo}">
      <span class="tix__tab"></span>
      <div class="tix__main">
        <div class="tix__teams">${koTeamRow(card.teams[0], g1, lead1)}${scorers1}<div class="vs">vs</div>${koTeamRow(card.teams[1], g2, lead2)}${scorers2}</div>
        <div class="tix__time">${timeHtml}</div>
      </div>
      <div class="tix__foot"><span class="gbadge">KO</span>
        ${venueImageHtml(card.match.v, v.common, v.city)}<span class="ven">${esc(card.source)} · ${esc(v.common)}</span><span class="cty">· ${esc(v.city)}, ${esc(v.country)}</span>
        <span class="mno">#${card.matchNo}</span></div>
    </article>`;
  }

  function renderSchedule(anim: boolean): string {
    const now = nowMs;
    const list = data.gs.filter(matchHit);
    const knockoutCards = buildKnockoutScheduleCards().filter(koMatchHit).sort((a, b) => a.match.ts - b.match.ts);
    if (!list.length && !knockoutCards.length) return `<div class="empty">No matches match your filters.<br>Try clearing the search or picking "All".</div>`;

    const isMatchDone = (m: GroupStageMatch): boolean => {
      const f = findLive(m, fixtures);
      const stale = (f && isStaleStatus(m.ts, f.status, now)) || (!f && m.dbStatus && isStaleStatus(m.ts, m.dbStatus, now));
      const hasKickedOff = m.ts <= now + 5 * 60000;
      return !stale && hasKickedOff && !!(
        (f && DONE_STATUSES.has(f.status)) ||
        (m.dbStatus && DONE_STATUSES.has(m.dbStatus) && m.dbGh != null && m.dbGa != null)
      );
    };
    const isPastUnresolved = (m: GroupStageMatch): boolean => {
      if (isMatchDone(m)) return false;
      const f = findLive(m, fixtures);
      const stale = (f && isStaleStatus(m.ts, f.status, now)) || (!f && m.dbStatus && isStaleStatus(m.ts, m.dbStatus, now));
      const live = !!f && LIVE_STATUSES.has(f.status) && !stale;
      return !live && m.iso < today && m.ts < now;
    };
    const isLiveMatch = (m: GroupStageMatch): boolean => {
      const f = findLive(m, fixtures);
      const stale = (f && isStaleStatus(m.ts, f.status, now)) || (!f && m.dbStatus && isStaleStatus(m.ts, m.dbStatus, now));
      return !stale && !!f && LIVE_STATUSES.has(f.status);
    };

    /* Categorize all group-stage matches into buckets */
    const liveMatches = list.filter(isLiveMatch);
    const todayMatches = list.filter(m => m.iso === today && !isLiveMatch(m) && !isMatchDone(m) && !isPastUnresolved(m));
    const completedMatches = list.filter(m => isMatchDone(m) || isPastUnresolved(m)).sort((a, b) => b.ts - a.ts);
    const futureMatches = list.filter(m => m.iso > today && !isMatchDone(m) && !isPastUnresolved(m) && !isLiveMatch(m));

    /* Categorize knockout cards. Unresolved past KO cards stay visible so
       vendor lag cannot make a resolved matchup disappear from the schedule. */
    const koBuckets = bucketScheduleItems(knockoutCards, today, now, card => ({
      iso: card.match.iso,
      ts: card.match.ts,
      isLive: card.isLive,
      isDone: card.isDone,
    }));
    const liveKoCards = koBuckets.live;
    const todayKoCards = koBuckets.today;
    const doneKoCards = koBuckets.previous.sort((a, b) => b.match.ts - a.match.ts);
    const futureKoCards = koBuckets.future;

    /* Group by ISO date for chronological sections */
    function groupByDate<T>(items: T[], isoFn: (item: T) => string): Map<string, T[]> {
      const map = new Map<string, T[]>();
      for (const item of items) {
        const iso = isoFn(item);
        if (!map.has(iso)) map.set(iso, []);
        map.get(iso)!.push(item);
      }
      return map;
    }

    const futureGsByDate = groupByDate(futureMatches, m => m.iso);
    const futureKoByDate = groupByDate(futureKoCards, c => c.match.iso);
    const completedGsByDate = groupByDate(completedMatches, m => m.iso);
    const completedKoByDate = groupByDate(doneKoCards, c => c.match.iso);

    /* Merge all future dates (GS + KO) into sorted order */
    const allFutureDates = [...new Set([...futureGsByDate.keys(), ...futureKoByDate.keys()])].sort();
    const allPastDates = [...new Set([...completedGsByDate.keys(), ...completedKoByDate.keys()])].sort().reverse();

    let html = "";

    /* ── Section 1: Live Now ── */
    if (liveMatches.length || liveKoCards.length) {
      html += `<div id="next-match-anchor" style="scroll-margin-top:240px"></div>`;
      html += `<div class="sched-sec sched-sec--live"><div class="sched-hd sched-hd--live"><span class="sched-pulse"></span><span>Live Now</span><b>${liveMatches.length + liveKoCards.length}</b></div>`;
      for (const m of liveMatches) html += tixCard(m, anim);
      for (const card of liveKoCards) html += koTixCard(card, anim, false);
      html += `</div>`;
    }

    /* ── Section 2: Today's Matches ── */
    if (todayMatches.length || todayKoCards.length) {
      const todayDt = parseISO(today);
      const todayLabel = `${DOW[todayDt.getDay()]} ${todayDt.getDate()} ${MON[todayDt.getMonth()]}`;
      if (!liveMatches.length && !liveKoCards.length) {
        html += `<div id="next-match-anchor" style="scroll-margin-top:240px"></div>`;
      }
      html += `<div class="sched-sec sched-sec--today"><div class="sched-hd sched-hd--today"><span>Today's Matches</span><small>${todayLabel}</small><b>${todayMatches.length + todayKoCards.length}</b></div>`;
      for (const m of todayMatches) html += tixCard(m, anim);
      for (const card of todayKoCards) html += koTixCard(card, anim, false);
      html += `</div>`;
    }

    /* ── Section 3: Future Schedule ── day by day */
    let anchorPlaced = !!(liveMatches.length || liveKoCards.length || todayMatches.length || todayKoCards.length);
    if (allFutureDates.length) {
      html += `<div class="sched-sec sched-sec--future"><div class="sched-hd"><span>Upcoming</span></div>`;
      for (const iso of allFutureDates) {
        const dt = parseISO(iso);
        const dateLabel = `${DOW[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}`;
        const gsDay = futureGsByDate.get(iso) || [];
        const koDay = futureKoByDate.get(iso) || [];
        if (!anchorPlaced) {
          html += `<div id="next-match-anchor" style="scroll-margin-top:240px"></div>`;
          anchorPlaced = true;
        }
        const koTag = koDay.length ? `<small class="sched-ko-tag">Knockout</small>` : "";
        html += `<div class="sched-day"><div class="sched-day__hd">${dateLabel}${koTag}<b>${gsDay.length + koDay.length}</b></div>`;
        for (const m of gsDay) html += tixCard(m, anim);
        for (const card of koDay) html += koTixCard(card, anim, false);
        html += `</div>`;
      }
      html += `</div>`;
    }

    /* ── Section 4: Previous Days ── collapsible, most recent first */
    if (allPastDates.length) {
      const totalPast = completedMatches.length + doneKoCards.length;
      const latestPast = allPastDates[0];
      const latestDt = parseISO(latestPast);
      const latestLabel = `${DOW[latestDt.getDay()]} ${latestDt.getDate()} ${MON[latestDt.getMonth()]}`;
      if (!anchorPlaced) {
        html += `<div id="next-match-anchor" style="scroll-margin-top:240px"></div>`;
      }
      html += `<details class="sched-sec sched-sec--past"><summary class="sched-hd sched-hd--past"><span>Previous Results</span><b>${totalPast}</b><small>Latest: ${latestLabel}</small><span class="sched-chevron"></span></summary>`;
      html += `<div class="sched-past-body">`;
      for (const iso of allPastDates) {
        const dt = parseISO(iso);
        const dateLabel = `${DOW[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}`;
        const gsDay = completedGsByDate.get(iso) || [];
        const koDay = completedKoByDate.get(iso) || [];
        if (!gsDay.length && !koDay.length) continue;
        const koTag = koDay.length ? `<small class="sched-ko-tag">Knockout</small>` : "";
        html += `<div class="sched-day sched-day--past"><div class="sched-day__hd">${dateLabel}${koTag}<b>${gsDay.length + koDay.length}</b></div>`;
        for (const m of gsDay) html += tixCard(m, anim, true);
        for (const card of koDay) html += koTixCard(card, anim, true);
        html += `</div>`;
      }
      html += `</div></details>`;
    }

    return html || `<div class="empty">No matches match your filters.</div>`;
  }

  function renderGroups(anim: boolean): string {
    let html = `<div class="gwrap">${liveIndicatorHtml()}
      <div class="qkey"><span><i style="background:#1F8A6B"></i>Top 2 advance</span>
      <span><i style="background:#E5B53A"></i>3rd — best 8 advance</span></div>`;
    for (const g of Object.keys(data.groups)) {
      const { rows, played } = standings(g);
      const body = rows.map((r, i) => {
        const cls = i < 2 ? "adv" : (i === 2 ? "cont" : "");
        const host = data.hosts.includes(r.t) ? '<span class="host">H</span>' : "";
        const gd = r.gf - r.ga;
        const gdCls = gd > 0 ? "gd-col gd-pos" : gd < 0 ? "gd-col gd-neg" : "gd-col";
        return `<tr class="${cls}"><td class="pos l">${i + 1}</td>
          <td class="l"><span class="tm"><span class="fl">${fl(r.t)}</span><a class="nm teamlink" data-team="${esc(r.t)}" href="#">${esc(r.t)}</a>${host}</span></td>
          <td>${r.p}</td><td class="w-col">${r.w}</td><td>${r.d}</td><td class="l-col">${r.l}</td><td class="gf-col">${r.gf}</td><td class="ga-col">${r.ga}</td><td class="${gdCls}">${formatGD(gd, played)}</td><td class="pts">${r.pts}</td></tr>`;
      }).join("");
      html += `<div class="gcard${anim ? " stagger-rise" : ""}" style="--gc:${data.gcolor[g]}">
        <div class="gcard__h">Group ${g}<span class="pl">${played ? played + " played" : "not started"}</span></div>
        <div class="tbl-wrap"><table class="tbl"><colgroup><col class="tbl__pos" /><col class="tbl__team" /><col class="tbl__stat" /><col class="tbl__stat" /><col class="tbl__stat" /><col class="tbl__stat" /><col class="tbl__gf" /><col class="tbl__ga" /><col class="tbl__gd" /><col class="tbl__pts" /></colgroup><thead><tr><th class="l"></th><th class="l">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
        <tbody>${body}</tbody></table></div></div>`;
    }
    html += `<p class="qnote">Tables update from full-time scores as they come in. Order uses points, then goal difference, then goals scored — FIFA's official tiebreakers (including head-to-head and fair-play) decide the final standings.</p></div>`;
    return html;
  }

  function renderVenues(anim: boolean): string {
    const order = Object.entries(data.venues).sort((a, b) => b[1].cap - a[1].cap);
    return order.map(([, v]) => {
      const flag = v.country === "USA" ? "🇺🇸" : v.country === "Mexico" ? "🇲🇽" : "🇨🇦";
      return `<div class="vcard${anim ? " stagger-rise" : ""}"><div class="vcard__cap"><b>${(v.cap / 1000).toFixed(v.cap % 1000 ? 1 : 0)}k</b><span>Seats</span></div>
        <div class="vcard__b"><h4>${esc(v.common)}</h4><div class="meta">${esc(v.city)}, ${esc(v.country)}</div>
        <div class="fifa">Tournament name: ${esc(v.fifa)}</div></div><span class="flag-c">${flag}</span></div>`;
    }).join("");
  }

  /** Aggregate tournament leaderboards from the shared real-time stats model. */
  const computeLeaders = useCallback((): TournamentStats => {
    return buildTournamentStats(data, fixtures, { players: leaderboardStats });
  }, [data, fixtures, leaderboardStats]);

  function renderAbout(): string {
    return `<div class="about">
      <h3>About this app</h3>
      <p><b>Compet 2026</b> is a mobile companion to the 2026 FIFA World Cup across Canada, Mexico and the United States. Scores, statistics, lineups and group tables update live during matches. Tap any match card for detailed statistics, lineups and a full timeline. Install as an app from your browser for the best experience.</p>
      <h3>Live scores &amp; stats</h3>
      <p>Match data updates automatically during live matches. When no matches are in play, the confirmed schedule is displayed. All data is unofficial; FIFA is the source of record.</p>
      <h3>Knockout bracket</h3>
      <p>Knockout dates, times and venues are confirmed; teams read <span class="legend">Pending FIFA Confirmation</span> and fill in automatically as the bracket is decided.</p>
      <h3>Times</h3>
      <p>All times default to <b>U.S. Eastern (ET)</b>. Local venue time is shown below when different. <b>HOST</b> marks Canada, Mexico and the United States.</p>
      <h3>Schedule accuracy</h3>
      <p>Compiled 11 June 2026 and cross-checked against FIFA, FOX Sports, NBC Sports, ESPN, Al Jazeera, FourFourTwo and Wikipedia.</p>
    </div>`;
  }

  const viewContent = useMemo(() => {
    if (view === "home") return "";
    if (view === "schedule") return renderSchedule(animate);
    if (view === "groups") return renderGroups(animate);
    if (view === "venues") return renderVenues(animate);
    if (view === "analytics") return "";
    if (view === "stats") return ""; // stats rendered as React, not HTML string
    if (view === "bracket") return ""; // bracket rendered as React bracket
    return renderAbout();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, group, team, stage, query, fixtures, liveStatus, liveTs, liveEnrichmentIssue, animate, nowMs]);

  function handleTab(v: ViewType) {
    setAnimate(true);
    setView(v);
    window.scrollTo({ top: 0 });
  }

  /* Stable callbacks for MapView so React.memo can skip re-renders — inline
     arrows would give the memoized component fresh props every render. */
  const openMatchDetail = useCallback((match: GroupStageMatch, fixture: LiveFixture | null) => {
    setMatchDetail({ match, fixture });
  }, []);
  const openVenueSchedule = useCallback((stadiumName: string) => {
    /* Land on the Schedule filtered to this stadium: the schedule's search
       matches venue names, and the query stays visible in the search box so
       the user can clear it. */
    setQuery(stadiumName);
    setStage("ALL");
    setGroup("ALL");
    setTeam("ALL");
    setAnimate(true);
    setView("schedule");
    window.scrollTo({ top: 0 });
  }, []);

  const tabs: { key: ViewType; label: string }[] = [
    { key: "home", label: "Home" },
    { key: "schedule", label: "Schedule" },
    { key: "groups", label: "Groups" },
    { key: "bracket", label: "Knockout" },
    { key: "teams", label: "Teams" },
    { key: "map", label: "Map" },
    { key: "more", label: "More" },
  ];

  const navIcon: Record<ViewType, ReactNode> = {
    home: <AppIcon name="home" />,
    schedule: <AppIcon name="calendar" />,
    groups: <AppIcon name="groups" />,
    bracket: <AppIcon name="bracket" />,
    teams: <AppIcon name="teams" />,
    map: <AppIcon name="map" />,
    analytics: <AppIcon name="stats" />,
    more: <AppIcon name="more" />,
    settings: <AppIcon name="settings" />,
    stats: <AppIcon name="stats" />,
    venues: <AppIcon name="venue" />,
    about: <AppIcon name="info" />,
  };

  return (
    <div className={`wrap${view === "bracket" ? " wrap--knockout" : ""}${view === "home" ? " wrap--home" : ""}`}>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" id="live-announcer" />
      <header className="bar" role="banner">
        <div className="bar__mark">
          <img src="/wc26-logo.png" alt="FIFA World Cup 26" className="bar__logo" draggable={false} />
          <TriondaBall id="hb" className="bar__ball" />
        </div>
        <div className="bar__actions">
          <button type="button" className="bar__search-btn" onClick={() => setSearchOpen(true)} aria-label="Search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="7" /><line x1="15.5" y1="15.5" x2="21" y2="21" /></svg>
          </button>
          <div className="bar__hosts" aria-label="Host countries">
            {data.hosts.map(host => (
              <button key={host} type="button" onClick={() => setHostDrawer(host)} aria-label={`View ${host} host profile`}>
                {data.flags[host] || "⚽"}
              </button>
            ))}
          </div>
        </div>
      </header>

      {view !== "bracket" && view !== "home" && view !== "map" && (
        <section className="hero hero--compact">
          <div className="hero__pitch-lines" aria-hidden="true" />
          <div className="hero__context">
            <h1 className="hero__context-title">
              {view === "schedule" ? "Schedule" : view === "groups" ? "Groups" : view === "teams" ? "Teams" : view === "analytics" ? "Analytics" : view === "settings" ? "Settings" : view === "stats" ? "Statistics" : view === "more" ? "More" : view === "venues" ? "Venues" : view === "about" ? "About" : "COMPET 2026"}
            </h1>
            <p className="hero__context-sub">
              {view === "schedule" ? `${data.gs.length + data.ko.length} matches · Group stage & knockout` : view === "groups" ? `${Object.keys(data.groups).length} groups · 48 teams` : view === "teams" ? "48 nations competing" : view === "analytics" ? "Team strength, confederation power & knockout survival" : view === "settings" ? "Personalize tournament, alerts, map, data, and display" : view === "stats" ? "Goals, assists & cards" : view === "more" ? "Venues, about & more" : ""}
            </p>
          </div>
        </section>
      )}

      <nav className="app-nav" role="tablist" aria-label="Views">
        {tabs.map(t => (
          <button
            key={t.key}
            className="tab"
            role="tab"
            aria-selected={view === t.key}
            onClick={() => handleTab(t.key)}
          >
            <span className="tab__icon" aria-hidden="true">{navIcon[t.key]}</span>
            <span className="tab__label">{t.label}</span>
          </button>
        ))}
      </nav>

      {view !== "bracket" && view !== "home" && view !== "map" && <CountdownHero data={data} fixtures={fixtures} findLive={findLive} />}

      {view === "schedule" && (
        <div className="filters">
          <input
            className="search"
            type="search"
            inputMode="search"
            placeholder="Search team, city or stadium"
            value={query}
            onChange={e => { setAnimate(false); setQuery(e.target.value); }}
            aria-label="Search"
          />
          <div className="row2">
            <select
              className="sel"
              value={team}
              onChange={e => { setAnimate(false); setTeam(e.target.value); }}
              aria-label="Filter by team"
            >
              <option value="ALL">All teams</option>
              {allTeams.map(t => (
                <option key={t} value={t}>{fl(t)} {t}</option>
              ))}
            </select>
          </div>
          <div className="chips" role="group" aria-label="Filter by stage">
            {[
              { key: "ALL", label: "All" },
              { key: "groups", label: "Groups" },
              { key: "knockout", label: "Knockout" },
              { key: "r32", label: "R32" },
              { key: "r16", label: "R16" },
              { key: "qf", label: "QF" },
              { key: "sf", label: "SF" },
              { key: "final", label: "Final" },
            ].map(s => (
              <button
                key={s.key}
                className={`chip${s.key === "ALL" ? " chip--all" : " chip--stage"}`}
                aria-pressed={stage === s.key}
                onClick={() => { setAnimate(true); setStage(s.key); if (s.key !== "ALL" && s.key !== "groups") setGroup("ALL"); }}
              >
                {s.label}
              </button>
            ))}
          </div>
          {(stage === "ALL" || stage === "groups") && (
            <div className="chips" role="group" aria-label="Filter by group">
              <button
                className="chip chip--all"
                aria-pressed={group === "ALL"}
                onClick={() => { setAnimate(true); setGroup("ALL"); }}
              >
                All groups
              </button>
              {Object.keys(data.groups).map(g => (
                <button
                  key={g}
                  className="chip"
                  aria-pressed={group === g}
                  style={group === g ? { background: data.gcolor[g] } : undefined}
                  onClick={() => { setAnimate(true); setGroup(g); setStage(stage === "ALL" ? "ALL" : "groups"); }}
                >
                  {g}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <main id="main-content" key={view} className="view-transition" role="main">
        {view === "home" ? (
          <LandingGate
            data={data}
            fixtures={fixtures}
            findLive={findLive}
            nowMs={nowMs}
            computeLeaders={computeLeaders}
            onNavigate={handleTab}
            onPlayerClick={(name, team) => setPlayerProfile({ name, team })}
            onMatchClick={(match, fixture) => setMatchDetail({ match, fixture })}
          />
        ) : view === "bracket" ? (
          <KnockoutStageView
            data={data}
            fixtures={fixtures}
            findLive={findLive}
            nowMs={nowMs}
            onMatchClick={(match, fixture) => setMatchDetail({ match, fixture })}
          />
        ) : view === "stats" ? (
          <StatsView
            fl={fl}
            computeLeaders={computeLeaders}
            liveTs={liveTs}
            liveStatus={liveStatus}
            liveEnrichmentIssue={liveEnrichmentIssue}
            onRefresh={pollLive}
            onNavigate={handleTab}
          />
        ) : view === "teams" ? (
          <TeamsView data={data} fixtures={fixtures} findLive={findLive} nowMs={nowMs} onTeamClick={setTeamDrawer} favs={favs} toggleFav={toggleFav} />
        ) : view === "map" ? (
          <MapView
            data={data}
            fixtures={fixtures}
            findLive={findLive}
            nowMs={nowMs}
            onMatchClick={openMatchDetail}
            onViewVenueMatches={openVenueSchedule}
            initialVenueId={mapVenueTarget}
            onInitialVenueConsumed={clearMapVenueTarget}
          />
        ) : view === "analytics" ? (
          <AnalyticsView data={data} fixtures={fixtures} findLive={findLive} nowMs={nowMs} liveTs={liveTs} liveStatus={liveStatus} onTeamClick={setTeamDrawer} onMatchClick={openMatchDetail} />
        ) : view === "more" ? (
          <MoreView
            data={data}
            fixtures={fixtures}
            leaderboardStats={leaderboardStats}
            findLive={findLive}
            nowMs={nowMs}
            onNavigate={handleTab}
            onVenueClick={(venueId) => { setMapVenueTarget(venueId); handleTab("map"); }}
            onTeamClick={setTeamDrawer}
            onPlayerClick={(name, team) => setPlayerProfile({ name, team })}
          />
        ) : view === "settings" ? (
          <SettingsView data={data} fixtures={fixtures} leaderboardStats={leaderboardStats} liveTs={liveTs} liveStatus={liveStatus} onNavigate={handleTab} onTeamClick={setTeamDrawer} />
        ) : (
          <main
            ref={mainRef}
            className={view !== "groups" ? "section" : undefined}
            dangerouslySetInnerHTML={{ __html: viewContent }}
          />
        )}
      </main>

      {showInstall && (
        <div className="install-banner">
          <div className="install-banner__icon">
            <img src="/icons/compet-icon-192.png" alt="" width={40} height={40} />
          </div>
          <div className="install-banner__text">
            <strong>Install Compet 2026</strong>
            <span>Add to home screen for live scores &amp; offline access</span>
          </div>
          <button className="install-banner__btn" onClick={async () => {
            const p = deferredPromptRef.current;
            if (!p) return;
            p.prompt();
            const { outcome } = await p.userChoice;
            if (outcome === "accepted") setShowInstall(false);
            deferredPromptRef.current = null;
          }}>Install</button>
          <button className="install-banner__close" onClick={() => setShowInstall(false)} aria-label="Dismiss">&times;</button>
        </div>
      )}

      <div className="foot">
        All data is unofficial &middot; FIFA is the source of record &middot; Knockout teams fill in as results are confirmed
      </div>

      {showBackTop && (
        <button
          type="button"
          className="back-top-fab"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Back to top"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
        </button>
      )}

      {goalToast && (
        <div className={`goal-toast${toastExiting ? " goal-toast--exit" : ""}`} role="status" aria-live="assertive">
          <span className="goal-toast__icon">⚽</span>
          <div>
            <div className="goal-toast__text">{goalToast.flag} GOAL! {goalToast.player} {goalToast.minute}</div>
            <div className="goal-toast__sub">{goalToast.score}</div>
          </div>
        </div>
      )}

      {searchOpen && <SearchOverlay data={data} fixtures={fixtures} findLive={findLive} onClose={() => setSearchOpen(false)} onTeamClick={(t) => { setSearchOpen(false); setTeamDrawer(t); }} onMatchClick={(m, f) => { setSearchOpen(false); setMatchDetail({ match: m, fixture: f }); }} onNavigate={(v) => { setSearchOpen(false); handleTab(v); }} />}

      {hostDrawer && <HostCountryDrawer country={hostDrawer} data={data} onClose={() => setHostDrawer(null)} />}
      {teamDrawer && <TeamDrawer name={teamDrawer} flags={data.flags} groups={data.groups} gcolor={data.gcolor} gs={data.gs} hosts={data.hosts} onClose={() => setTeamDrawer(null)} onPlayerClick={(p, t) => { setTeamDrawer(null); setPlayerProfile({ name: p, team: t }); }} />}
      {matchDetail && <MatchDetailDrawer match={matchDetail.match} initialFixture={matchDetail.fixture} fixtures={fixtures} flags={data.flags} venues={data.venues} gcolor={data.gcolor} allMatches={data.gs} vName={vName} findLive={findLive} onClose={() => setMatchDetail(null)} onTeamClick={(t) => { setMatchDetail(null); setTeamDrawer(t); }} onPlayerClick={(p, t) => { setMatchDetail(null); setPlayerProfile({ name: p, team: t }); }} />}
      {playerProfile && <PlayerProfileDrawer playerName={playerProfile.name} teamName={playerProfile.team} flags={data.flags} data={data} onClose={() => setPlayerProfile(null)} onTeamClick={(t) => { setPlayerProfile(null); setTeamDrawer(t); }} />}
    </div>
  );
}

type KnockoutParticipant = {
  name: string;
  seed?: string;
  winner?: boolean;
  loser?: boolean;
  placeholder?: boolean;
};

type KnockoutCardModel = {
  key: string;
  round: KnockoutRoundKey;
  roundIndex: number;
  match: KnockoutMatch;
  matchNo: number;
  fixture: LiveFixture | null;
  teams: [KnockoutParticipant, KnockoutParticipant];
  source: string;
  isDone: boolean;
  isLive: boolean;
  winnerName: string | null;
  loserName: string | null;
  sourceMatchNos: [number, number] | null;
  nextMatchNo: number | null;
};

/* Decorative soccer-pitch line art behind the hero cards. A real SVG (not
   CSS gradient hacks) so the markings stay symmetric and the center circle
   stays round at every card size — preserveAspectRatio "slice" crops the
   pitch edges on narrow cards instead of distorting the geometry. */
function PitchLines() {
  return (
    <svg className="pitch-lines" viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="rgba(255,255,255,0.11)" strokeWidth="2">
        {/* Touchline */}
        <rect x="10" y="10" width="980" height="540" rx="8" />
        {/* Halfway line + center circle */}
        <line x1="500" y1="10" x2="500" y2="550" />
        <circle cx="500" cy="280" r="80" />
        {/* Penalty areas */}
        <rect x="10" y="140" width="150" height="280" />
        <rect x="840" y="140" width="150" height="280" />
        {/* Six-yard boxes */}
        <rect x="10" y="210" width="55" height="140" />
        <rect x="935" y="210" width="55" height="140" />
        {/* Penalty arcs */}
        <path d="M160 212.5 A84 84 0 0 1 160 347.5" />
        <path d="M840 347.5 A84 84 0 0 1 840 212.5" />
        {/* Corner arcs */}
        <path d="M10 24 A14 14 0 0 0 24 10" />
        <path d="M976 10 A14 14 0 0 0 990 24" />
        <path d="M990 536 A14 14 0 0 0 976 550" />
        <path d="M24 550 A14 14 0 0 0 10 536" />
      </g>
      <g fill="rgba(255,255,255,0.15)">
        {/* Center + penalty spots */}
        <circle cx="500" cy="280" r="3.5" />
        <circle cx="110" cy="280" r="3.5" />
        <circle cx="890" cy="280" r="3.5" />
      </g>
    </svg>
  );
}

/* Every knockout round gets its own checkpoint on the home progress
   tracker — matched against the round labels in lib/data.ts. */
const KO_ROUND_STEPS: { key: string; label: string; matches: (round: string) => boolean }[] = [
  { key: "r32", label: "R32", matches: r => r.startsWith("Round of 32") },
  { key: "r16", label: "R16", matches: r => r.startsWith("Round of 16") },
  { key: "qf", label: "QF", matches: r => r.toLowerCase().startsWith("quarter") },
  { key: "sf", label: "SF", matches: r => r.toLowerCase().startsWith("semi") },
  { key: "third", label: "3rd", matches: r => /third/i.test(r) },
  { key: "final", label: "Final", matches: r => r.trim() === "Final" },
];

function LandingGate({ data, fixtures, findLive, nowMs, computeLeaders, onNavigate, onPlayerClick, onMatchClick }: {
  data: TournamentData;
  fixtures: LiveFixture[];
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null;
  nowMs: number;
  computeLeaders: () => TournamentStats;
  onNavigate: (v: ViewType) => void;
  onPlayerClick: (playerName: string, teamName: string) => void;
  onMatchClick: (match: GroupStageMatch, fixture: LiveFixture | null) => void;
}) {
  const fl = (t: string) => data.flags[t] || "⚽";

  /* -- tournament progress stats ---------------------------------- */
  const groupDone = useMemo(() => data.gs.filter(m => {
    const f = findLive(m, fixtures);
    return !!((f && DONE_STATUSES.has(f.status)) || (m.dbStatus && DONE_STATUSES.has(m.dbStatus) && m.dbGh != null && m.dbGa != null));
  }).length, [data.gs, fixtures, findLive]);

  const knockoutCards = useMemo(
    () => buildKnockoutCards(data, fixtures, findLive, nowMs),
    [data, fixtures, findLive, nowMs],
  );

  const koDone = useMemo(() => knockoutCards.filter(card => card.isDone).length, [knockoutCards]);

  /* Per-round knockout completion — one checkpoint per round so no round
     is lumped into a generic "Knockout" phase. */
  const koRounds = useMemo(() => KO_ROUND_STEPS.map(step => {
    const roundMatches = knockoutCards.filter(card => step.matches(card.match.round));
    const done = roundMatches.filter(card => card.isDone).length;
    return { key: step.key, label: step.label, done, total: roundMatches.length };
  }), [knockoutCards]);

  const totalMatches = data.gs.length + data.ko.length;
  const totalDone = groupDone + koDone;

  const stageLabel = koDone >= 31 ? "Final" : koDone >= 30 ? "Third Place" : koDone >= 28 ? "Semifinals" : koDone >= 24 ? "Quarterfinals" : koDone >= 16 ? "Round of 16" : koDone >= 0 && groupDone >= 72 ? "Round of 32" : "Group Stage";

  /* -- live matches ----------------------------------------------- */
  const liveMatches = useMemo(() => {
    const live: Array<{
      type: "gs" | "ko";
      match: GroupStageMatch | KnockoutMatch;
      fixture: LiveFixture;
      home: string;
      away: string;
      venue: string;
    }> = [];
    for (const m of data.gs) {
      const f = findLive(m, fixtures);
      if (f && LIVE_STATUSES.has(f.status)) {
        live.push({
          type: "gs",
          match: m,
          fixture: f,
          home: m.t1,
          away: m.t2,
          venue: data.venues[m.v]?.common || m.v,
        });
      }
    }
    for (const card of knockoutCards) {
      const f = card.fixture;
      if (f && card.isLive) {
        const [homeTeam, awayTeam] = card.teams;
        live.push({
          type: "ko",
          match: card.match,
          fixture: f,
          home: homeTeam.placeholder ? "TBD" : homeTeam.name,
          away: awayTeam.placeholder ? "TBD" : awayTeam.name,
          venue: data.venues[card.match.v]?.common || card.match.v,
        });
      }
    }
    return live.sort((a, b) => a.match.ts - b.match.ts);
  }, [data.gs, data.venues, fixtures, findLive, knockoutCards]);

  /* -- next match countdown --------------------------------------- */
  const nextMatch = useMemo(() => {
    const scheduled = [
      ...data.gs.map(match => {
        const fixture = findLive(match, fixtures);
        return {
          type: "gs" as const,
          match,
          fixture,
          ts: match.ts,
          home: match.t1,
          away: match.t2,
          venue: data.venues[match.v]?.common || match.v,
          iso: match.iso,
          et: match.et,
          round: `Group ${match.g}`,
          isDone: !!((fixture && DONE_STATUSES.has(fixture.status)) || (match.dbStatus && DONE_STATUSES.has(match.dbStatus) && match.dbGh != null && match.dbGa != null)),
        };
      }),
      ...knockoutCards.map(card => {
        const match = card.match;
        const [homeTeam, awayTeam] = card.teams;
        return {
          type: "ko" as const,
          match,
          fixture: card.fixture,
          ts: match.ts,
          home: homeTeam.placeholder ? (homeTeam.seed || homeTeam.name) : homeTeam.name,
          away: awayTeam.placeholder ? (awayTeam.seed || awayTeam.name) : awayTeam.name,
          venue: data.venues[match.v]?.common || match.v,
          iso: match.iso,
          et: match.et,
          round: match.round,
          isDone: card.isDone,
        };
      }),
    ];
    return scheduled
      .filter(item => item.ts > nowMs && !item.isDone && !DONE_STATUSES.has(item.fixture?.status || ""))
      .sort((a, b) => a.ts - b.ts)[0] || null;
  }, [data.gs, data.venues, fixtures, findLive, knockoutCards, nowMs]);

  /* -- recent results (last 6 completed matches, GS + KO) --------- */
  const recentResults = useMemo(() => {
    const results: { match: GroupStageMatch; fixture: LiveFixture; roundLabel: string }[] = [];

    // Collect finished group stage matches
    const candidates: { ts: number; build: () => { match: GroupStageMatch; fixture: LiveFixture; roundLabel: string } | null }[] = [];
    for (const m of data.gs) {
      candidates.push({ ts: m.ts, build: () => {
        const f = findLive(m, fixtures);
        if (f && DONE_STATUSES.has(f.status) && f.gh != null && f.ga != null) {
          return { match: m, fixture: f, roundLabel: `Group ${m.g}` };
        } else if (m.dbStatus && DONE_STATUSES.has(m.dbStatus) && m.dbGh != null && m.dbGa != null) {
          const synth: LiveFixture = { ts: m.ts, status: m.dbStatus, elapsed: null, venue: m.v, round: `Group ${m.g}`, home: m.t1, away: m.t2, gh: m.dbGh, ga: m.dbGa, events: m.dbEvents };
          return { match: m, fixture: synth, roundLabel: `Group ${m.g}` };
        }
        return null;
      }});
    }

    // Collect finished knockout matches — synthesize a GroupStageMatch shape
    // so the match detail drawer can render them the same way
    for (const card of knockoutCards) {
      candidates.push({ ts: card.match.ts, build: () => {
        const f = card.fixture;
        if (!f || !card.isDone || f.gh == null || f.ga == null) return null;
        const [homeTeam, awayTeam] = card.teams;
        const home = homeTeam.placeholder ? (f.home ? canon(f.home) : "TBD") : homeTeam.name;
        const away = awayTeam.placeholder ? (f.away ? canon(f.away) : "TBD") : awayTeam.name;
        const synthMatch: GroupStageMatch = {
          no: card.matchNo,
          iso: card.match.iso, local: card.match.local, et: card.match.et,
          g: "KO", t1: home, t2: away,
          v: card.match.v, ts: card.match.ts,
        };
        return { match: synthMatch, fixture: f, roundLabel: card.match.round };
      }});
    }

    // Sort by most recent first, take top 6
    candidates.sort((a, b) => b.ts - a.ts);
    for (const c of candidates) {
      const r = c.build();
      if (r) results.push(r);
      if (results.length >= 6) break;
    }
    return results;
  }, [data.gs, fixtures, findLive, knockoutCards]);

  /* -- top scorer & assister -------------------------------------- */
  const leaders = useMemo(() => computeLeaders(), [computeLeaders]);
  const topScorer = leaders.topScorers.find(isRenderableLeader) || null;
  const topAssister = leaders.topAssisters.find(isRenderableLeader) || null;
  const topAssistTieCount = topAssister
    ? leaders.topAssisters.filter(leader => isRenderableLeader(leader) && leader.assists === topAssister.assists).length
    : 0;

  /* -- countdown math --------------------------------------------- */
  const countdown = useMemo(() => {
    if (!nextMatch) return null;
    const diff = Math.max(0, nextMatch.ts - nowMs);
    const totalSec = Math.floor(diff / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return { d, h, m, s };
  }, [nextMatch, nowMs]);

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <main className="home-dash" aria-label="Tournament Dashboard">

      {/* ── Section 1: Live Match or Next-Match Countdown ────── */}
      {liveMatches.length > 0 ? (
        <section className="home-dash__live" aria-label="Live matches">
          {liveMatches.slice(0, 2).map(({ type, match, fixture, home, away, venue }, i) => (
            <button
              key={i}
              type="button"
              className="home-live-card"
              onClick={() => type === "gs" ? onMatchClick(match as GroupStageMatch, fixture) : onNavigate("schedule")}
            >
              <PitchLines />
              <div className="home-live-card__badge">
                <span className="home-live-card__pulse" />
                {fixture.status === "HT" ? "HT" : `${fixture.elapsed || ""}'`}
              </div>
              <div className="home-live-card__teams">
                <div className="home-live-card__side">
                  <span className="home-live-card__flag">{fl(home)}</span>
                  <span className={`home-live-card__name${home.length > 11 ? " home-live-card__name--long" : ""}`}>{home}</span>
                </div>
                <div className="home-live-card__score">{fixture.gh ?? 0} – {fixture.ga ?? 0}</div>
                <div className="home-live-card__side">
                  <span className="home-live-card__flag">{fl(away)}</span>
                  <span className={`home-live-card__name${away.length > 11 ? " home-live-card__name--long" : ""}`}>{away}</span>
                </div>
              </div>
              <div className="home-live-card__venue">{venue}</div>
            </button>
          ))}
        </section>
      ) : nextMatch && countdown ? (
        <section className="home-dash__next" aria-label="Next match countdown">
          <PitchLines />
          <div className="home-next__eyebrow">Next Match</div>
          <div className="home-next__countdown">
            {countdown.d > 0 && <><span className="home-next__digit" suppressHydrationWarning>{countdown.d}</span><span className="home-next__unit">d</span></>}
            <span className="home-next__digit" suppressHydrationWarning>{pad(countdown.h)}</span><span className="home-next__sep">:</span>
            <span className="home-next__digit" suppressHydrationWarning>{pad(countdown.m)}</span><span className="home-next__sep">:</span>
            <span className="home-next__digit" suppressHydrationWarning>{pad(countdown.s)}</span>
          </div>
          <div className="home-next__match">
            <span className="home-next__team"><span>{fl(nextMatch.home)}</span> {nextMatch.home}</span>
            <span className="home-next__vs">vs</span>
            <span className="home-next__team"><span>{fl(nextMatch.away)}</span> {nextMatch.away}</span>
          </div>
          <div className="home-next__round">{nextMatch.round}</div>
          <div className="home-next__meta">
            {(() => {
              const d = parseISO(nextMatch.iso);
              return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} · ${nextMatch.et}${nextMatch.venue ? ` · ${nextMatch.venue}` : ""}`;
            })()}
          </div>
        </section>
      ) : null}

      {/* ── Section 2: Tournament Progress ───────────────────── */}
      <section className="home-dash__progress">
        <div className="home-progress__header">
          <span className="home-progress__stage">{stageLabel}</span>
          <span className="home-progress__count">{totalDone}/{totalMatches}</span>
        </div>

        {/* Checkpoint tracker — every tournament round is its own step:
            Groups → R32 → R16 → QF → SF → 3rd Place → Final */}
        {(() => {
          const phases = [
            { key: "groups", label: "Groups", done: groupDone, total: data.gs.length, nav: "schedule" as ViewType, trophy: false },
            ...koRounds.map(round => ({
              key: round.key,
              label: round.label,
              done: round.done,
              total: round.total,
              nav: "bracket" as ViewType,
              trophy: round.key === "final",
            })),
          ];
          /* The active step is the first incomplete one; everything before
             it is complete, everything after is upcoming. */
          const firstIncomplete = phases.findIndex(phase => phase.total > 0 && phase.done < phase.total);
          return (
            <div className="home-checkpoint">
              {phases.map((phase, index) => {
                const complete = phase.total > 0 && phase.done >= phase.total;
                const active = index === firstIncomplete;
                const pct = phase.total > 0 ? Math.min(100, Math.round((phase.done / phase.total) * 100)) : 0;
                const prevComplete = index > 0 && phases[index - 1].total > 0 && phases[index - 1].done >= phases[index - 1].total;
                return (
                  <Fragment key={phase.key}>
                    {index > 0 && <div className={`home-checkpoint__rail ${prevComplete ? "home-checkpoint__rail--done" : ""}`} />}
                    <button
                      type="button"
                      className="home-checkpoint__phase"
                      aria-label={`${phase.label}: ${phase.done} of ${phase.total} complete`}
                      onClick={() => onNavigate(phase.nav)}
                    >
                      <div className={`home-checkpoint__dot ${phase.trophy ? "home-checkpoint__dot--trophy " : ""}${complete ? "home-checkpoint__dot--done" : active ? "home-checkpoint__dot--active" : ""}`}>
                        {complete
                          ? (phase.trophy ? "🏆" : <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>)
                          : <span className="home-checkpoint__dot-inner" />}
                      </div>
                      <span className={`home-checkpoint__label ${active ? "home-checkpoint__label--active" : ""}`}>{phase.label}</span>
                      <span className="home-checkpoint__sub">{phase.done}/{phase.total}</span>
                      {active && <div className="home-checkpoint__mini-bar"><div className="home-checkpoint__mini-fill" style={{ width: `${pct}%` }} /></div>}
                    </button>
                  </Fragment>
                );
              })}
            </div>
          );
        })()}

        <div className="home-progress__stats">
          <button type="button" className="home-progress__stat" onClick={() => onNavigate("schedule")}>
            <b>{groupDone}<small>/{data.gs.length}</small></b><span>Group matches</span>
          </button>
          <button type="button" className="home-progress__stat" onClick={() => onNavigate("bracket")}>
            <b>{koDone}<small>/{data.ko.length}</small></b><span>Knockout matches</span>
          </button>
          <div className="home-progress__stat">
            <b>{leaders.totalGoals}</b><span>Goals</span>
          </div>
          <div className="home-progress__stat">
            <b>{leaders.avgGoals}</b><span>Per Match</span>
          </div>
        </div>
      </section>

      {/* ── Section 3: Golden Boot / Top Assist ──────────────── */}
      {(topScorer || topAssister) && (
        <section className="home-dash__leaders">
          <h3 className="home-section__title">Tournament Leaders</h3>
          <div className="home-leaders__grid">
            {topScorer && (
              <button type="button" className="home-leader-card home-leader-card--gold" onClick={() => onPlayerClick(topScorer.name, topScorer.team)}>
                <div className="home-leader-card__award"><AppIcon name="boot" /> Golden Boot</div>
                <div className="home-leader-card__player">
                  <PlayerAvatar playerName={topScorer.name} teamName={topScorer.team} player={topScorer} size="lg" />
                  <div>
                    <b>{topScorer.name}</b>
                    <span>{fl(topScorer.team)} {topScorer.team}</span>
                  </div>
                </div>
                <div className="home-leader-card__stat">{topScorer.goals}<small>goals</small></div>
              </button>
            )}
            {topAssister && (
              <button type="button" className="home-leader-card home-leader-card--silver" onClick={() => onPlayerClick(topAssister.name, topAssister.team)}>
                <div className="home-leader-card__award"><AppIcon name="assist" /> Top Assists</div>
                <div className="home-leader-card__player">
                  <PlayerAvatar playerName={topAssister.name} teamName={topAssister.team} player={topAssister} size="lg" />
                  <div>
                    <b>{topAssister.name}</b>
                    <span>{fl(topAssister.team)} {topAssister.team}{topAssistTieCount > 1 ? ` · ${topAssistTieCount} tied` : ""}</span>
                  </div>
                </div>
                <div className="home-leader-card__stat">{topAssister.assists}<small>assists</small></div>
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── Section 4: Latest Results ────────────────────────── */}
      {recentResults.length > 0 && (
        <section className="home-dash__results">
          <div className="home-section__header">
            <h3 className="home-section__title">Latest Results</h3>
            <button type="button" className="home-section__more" onClick={() => onNavigate("schedule")}>See all →</button>
          </div>
          <div className="home-results__scroll">
            {recentResults.map(({ match, fixture, roundLabel }, i) => {
              // Determine winner: in penalty shootouts the pen score decides,
              // otherwise the regular score decides
              const hasPens = fixture.penHome != null && fixture.penAway != null;
              const homeWin = hasPens
                ? fixture.penHome! > fixture.penAway!
                : (fixture.gh != null && fixture.ga != null && fixture.gh > fixture.ga);
              const awayWin = hasPens
                ? fixture.penAway! > fixture.penHome!
                : (fixture.gh != null && fixture.ga != null && fixture.ga > fixture.gh);
              return (
              <button key={i} type="button" className="home-result-card" onClick={() => onMatchClick(match, fixture)}>
                <div className="home-result-card__group">{roundLabel}</div>
                <div className="home-result-card__teams">
                  <span className="home-result-card__side">
                    <span>{fl(match.t1)}</span>
                    <b className={homeWin ? "home-result-card--winner" : ""}>{match.t1}</b>
                  </span>
                  <span className="home-result-card__score">
                    {fixture.gh} – {fixture.ga}
                    {hasPens && <small className="home-result-card__pens">({fixture.penHome}–{fixture.penAway})</small>}
                  </span>
                  <span className="home-result-card__side">
                    <span>{fl(match.t2)}</span>
                    <b className={awayWin ? "home-result-card--winner" : ""}>{match.t2}</b>
                  </span>
                </div>
                <div className="home-result-card__ft">{fixture.status === "AET" ? "AET" : fixture.status === "PEN" ? "PENS" : "FT"}</div>
              </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Section 5: Tournament Snapshot ────────────────────── */}
      <section className="home-dash__snapshot">
        <div className="home-section__header">
          <h3 className="home-section__title">Tournament</h3>
        </div>
        <div className="home-snapshot__grid">
          <button type="button" className="home-snapshot__card home-snapshot__card--ko" onClick={() => onNavigate("bracket")}>
            <span className="home-snapshot__icon"><AppIcon name="bracket" /></span>
            <div>
              <b>Knockout Bracket</b>
              <span>{koDone > 0 ? `${koDone} of ${data.ko.length} decided` : stageLabel === "Round of 32" ? "Round of 32 begins" : "Starts after group stage"}</span>
            </div>
          </button>
          <button type="button" className="home-snapshot__card home-snapshot__card--stats" onClick={() => onNavigate("stats")}>
            <span className="home-snapshot__icon"><AppIcon name="stats" /></span>
            <div>
              <b>Statistics</b>
              <span>{leaders.totalGoals} goals in {leaders.matchesPlayed} matches</span>
            </div>
          </button>
        </div>
      </section>

    </main>
  );
}

/* ---------------------------------------------------------------
 * SearchOverlay — universal instant search across all entities
 * Searches: teams, players, stadiums, cities, groups
 * --------------------------------------------------------------- */
function SearchOverlay({ data, fixtures, findLive, onClose, onTeamClick, onMatchClick, onNavigate }: {
  data: TournamentData;
  fixtures: LiveFixture[];
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null;
  onClose: () => void;
  onTeamClick: (t: string) => void;
  onMatchClick: (m: GroupStageMatch, f: LiveFixture | null) => void;
  onNavigate: (v: ViewType) => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const fl = (t: string) => data.flags[t] || "⚽";

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return null;

    /* -- teams ---------------------------------------------------- */
    const teams: { name: string; group: string; flag: string }[] = [];
    for (const [group, groupTeams] of Object.entries(data.groups)) {
      for (const t of groupTeams) {
        if (t.toLowerCase().includes(query)) teams.push({ name: t, group, flag: fl(t) });
      }
    }

    /* -- players -------------------------------------------------- */
    const players: { name: string; team: string; pos: string }[] = [];
    for (const [teamName, profile] of Object.entries(TEAM_PROFILES)) {
      for (const p of profile.squad) {
        if (p.name.toLowerCase().includes(query)) {
          players.push({ name: p.name, team: teamName, pos: p.pos });
          if (players.length >= 10) break;
        }
      }
      if (players.length >= 10) break;
    }

    /* -- venues --------------------------------------------------- */
    const venues: { code: string; name: string; city: string }[] = [];
    for (const [code, v] of Object.entries(data.venues)) {
      if (v.common.toLowerCase().includes(query) || v.city.toLowerCase().includes(query) || v.fifa.toLowerCase().includes(query)) {
        venues.push({ code, name: v.common, city: v.city });
      }
    }

    /* -- matches -------------------------------------------------- */
    const matches: { match: GroupStageMatch; fixture: LiveFixture | null }[] = [];
    for (const m of data.gs) {
      if (m.t1.toLowerCase().includes(query) || m.t2.toLowerCase().includes(query)) {
        matches.push({ match: m, fixture: findLive(m, fixtures) });
        if (matches.length >= 6) break;
      }
    }

    /* -- groups --------------------------------------------------- */
    const groups: string[] = [];
    for (const g of Object.keys(data.groups)) {
      if (`group ${g}`.toLowerCase().includes(query) || g.toLowerCase() === query) groups.push(g);
    }

    const total = teams.length + players.length + venues.length + matches.length + groups.length;
    return { teams, players, venues, matches, groups, total };
  }, [q, data, fixtures, findLive, fl]);

  return (
    <div className="search-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="search-overlay__panel">
        <div className="search-overlay__header">
          <svg className="search-overlay__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="7" /><line x1="15.5" y1="15.5" x2="21" y2="21" /></svg>
          <input
            ref={inputRef}
            type="search"
            className="search-overlay__input"
            placeholder="Search teams, players, stadiums…"
            value={q}
            onChange={e => setQ(e.target.value)}
            aria-label="Search"
          />
          <kbd className="search-overlay__kbd">⌘K</kbd>
          <button type="button" className="search-overlay__close" onClick={onClose} aria-label="Close search">✕</button>
        </div>

        <div className="search-overlay__results">
          {!results && (
            <div className="search-overlay__hint">
              <p>Try searching for a team, player, or stadium</p>
            </div>
          )}

          {results && results.total === 0 && (
            <div className="search-overlay__empty">No results for &ldquo;{q}&rdquo;</div>
          )}

          {results && results.teams.length > 0 && (
            <div className="search-overlay__section">
              <h4>Teams</h4>
              {results.teams.slice(0, 8).map(t => (
                <button key={t.name} type="button" className="search-overlay__row" onClick={() => onTeamClick(t.name)}>
                  <span className="search-overlay__row-icon">{t.flag}</span>
                  <span className="search-overlay__row-text"><b>{t.name}</b><span>Group {t.group}</span></span>
                </button>
              ))}
            </div>
          )}

          {results && results.players.length > 0 && (
            <div className="search-overlay__section">
              <h4>Players</h4>
              {results.players.map((p, i) => (
                <button key={i} type="button" className="search-overlay__row" onClick={() => onTeamClick(p.team)}>
                  <span className="search-overlay__row-icon"><AppIcon name="teams" /></span>
                  <span className="search-overlay__row-text"><b>{p.name}</b><span>{p.team} · {p.pos}</span></span>
                </button>
              ))}
            </div>
          )}

          {results && results.matches.length > 0 && (
            <div className="search-overlay__section">
              <h4>Matches</h4>
              {results.matches.map((m, i) => (
                <button key={i} type="button" className="search-overlay__row" onClick={() => onMatchClick(m.match, m.fixture)}>
                  <span className="search-overlay__row-icon"><AppIcon name="calendar" /></span>
                  <span className="search-overlay__row-text">
                    <b>{m.match.t1} vs {m.match.t2}</b>
                    <span>Group {m.match.g}{m.fixture && m.fixture.gh != null ? ` · ${m.fixture.gh}–${m.fixture.ga}` : ""}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {results && results.venues.length > 0 && (
            <div className="search-overlay__section">
              <h4>Stadiums</h4>
              {results.venues.map(v => (
                <button key={v.code} type="button" className="search-overlay__row" onClick={() => onNavigate("more")}>
                  <span className="search-overlay__row-icon"><AppIcon name="venue" /></span>
                  <span className="search-overlay__row-text"><b>{v.name}</b><span>{v.city}</span></span>
                </button>
              ))}
            </div>
          )}

          {results && results.groups.length > 0 && (
            <div className="search-overlay__section">
              <h4>Groups</h4>
              {results.groups.map(g => (
                <button key={g} type="button" className="search-overlay__row" onClick={() => onNavigate("groups")}>
                  <span className="search-overlay__row-icon"><AppIcon name="groups" /></span>
                  <span className="search-overlay__row-text"><b>Group {g}</b><span>{data.groups[g]?.join(", ")}</span></span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamsView({ data, fixtures, findLive, nowMs, onTeamClick, favs, toggleFav }: {
  data: TournamentData;
  fixtures: LiveFixture[];
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null;
  nowMs: number;
  onTeamClick: (team: string) => void;
  favs: Set<string>;
  toggleFav: (team: string) => void;
}) {
  const [search, setSearch] = useState("");

  /* -- build team data with records ------------------------------- */
  const teamsData = useMemo(() => {
    const groupEntries = Object.entries(data.groups);
    const teams: { team: string; group: string; flag: string; host: boolean; w: number; d: number; l: number; gf: number; ga: number; pts: number; form: string[] }[] = [];

    for (const [group, groupTeams] of groupEntries) {
      const standing = completedGroupStanding(group, data, fixtures, findLive, nowMs);
      for (const t of groupTeams) {
        const row = standing.rows.find(r => r.t === t);
        const form: string[] = [];
        for (const m of data.gs.filter(m => m.g === group && (m.t1 === t || m.t2 === t))) {
          const f = findLive(m, fixtures);
          const gh = f?.gh ?? m.dbGh;
          const ga = f?.ga ?? m.dbGa;
          const status = f?.status ?? m.dbStatus;
          if (gh == null || ga == null || !status || !DONE_STATUSES.has(status)) continue;
          const isHome = m.t1 === t;
          const tg = isHome ? gh : ga;
          const og = isHome ? ga : gh;
          form.push(tg > og ? "W" : tg < og ? "L" : "D");
        }
        teams.push({
          team: t,
          group,
          flag: data.flags[t] || "⚽",
          host: data.hosts.includes(t),
          w: row?.w ?? 0, d: row?.d ?? 0, l: row?.l ?? 0,
          gf: row?.gf ?? 0, ga: row?.ga ?? 0, pts: row?.pts ?? 0,
          form,
        });
      }
    }
    return teams;
  }, [data, fixtures, findLive, nowMs]);

  const sortedTeams = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teamsData
      .filter(t => !q || t.team.toLowerCase().includes(q))
      .sort((a, b) => a.team.localeCompare(b.team));
  }, [teamsData, search]);

  return (
    <main className="teams-view" aria-label="Teams">
      <section className="teams-view__hero">
        <span>48 Nations</span>
        <h2>Teams</h2>
        <p>Browse squads, group records and tournament paths.</p>
      </section>

      <div className="teams-view__controls">
        <input
          type="search"
          className="teams-view__search"
          placeholder="Search teams..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search teams"
        />
      </div>

      {/* -- team grid --------------------------------------------- */}
      <div className="teams-view__grid">
        {sortedTeams.map(({ team, group, flag, host, w, d, l, gf, ga, pts, form }) => (
          <button key={team} type="button" className={`team-tile${favs.has(team) ? " team-tile--fav" : ""}`} onClick={() => onTeamClick(team)}>
            <div className="team-tile__top">
              <span className="team-tile__flag">{flag}</span>
              {host && <span className="team-tile__host">Host</span>}
              <span
                className={`team-tile__star${favs.has(team) ? " team-tile__star--active" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={favs.has(team) ? `Remove ${team} from favorites` : `Add ${team} to favorites`}
                onClick={e => { e.stopPropagation(); toggleFav(team); }}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleFav(team); } }}
              >
                {favs.has(team) ? "★" : "☆"}
              </span>
            </div>
            <span className="team-tile__name">{team}</span>
            <span className="team-tile__group">Group {group}</span>
            {(w + d + l) > 0 && (
              <div className="team-tile__record">
                <span className="team-tile__pts">{pts}<small>pts</small></span>
                <span className="team-tile__wdl">{w}W {d}D {l}L</span>
                <span className="team-tile__gd">{gf}:{ga}</span>
              </div>
            )}
            {form.length > 0 && (
              <div className="team-tile__form">
                {form.map((r, i) => (
                  <span key={i} className={`team-tile__form-dot team-tile__form-dot--${r.toLowerCase()}`}>{r}</span>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>

      {sortedTeams.length === 0 && (
        <div className="teams-view__empty">
          No teams match your search.
          <button type="button" onClick={() => setSearch("")}>Clear search</button>
        </div>
      )}
    </main>
  );
}

type MapStatusFilter = "all" | "today" | "live" | "upcoming" | "completed" | "knockout";
type MapCountryFilter = "all" | "usa" | "canada" | "mexico";

type MapMatch = {
  key: string;
  no: number;
  venueId: string;
  ts: number;
  iso: string;
  local: string;
  et: string;
  stage: string;
  homeTeam: string;
  awayTeam: string;
  fixture: LiveFixture | null;
  sourceMatch: GroupStageMatch;
};

function stageShortLabel(stage: string): string {
  if (stage === "Group Stage") return "Group";
  if (stage === "Round of 32") return "R32";
  if (stage === "Round of 16") return "R16";
  if (stage.startsWith("Quarter")) return "QF";
  if (stage.startsWith("Semi")) return "SF";
  if (stage.includes("Third")) return "3rd";
  return stage;
}

function countryFilterKey(country: string): MapCountryFilter {
  if (country === "USA") return "usa";
  if (country === "Canada") return "canada";
  return "mexico";
}

/* Equirectangular projection onto the 1000x620 viewBox. The longitude
   domain must reach -70 so Gillette Stadium (Foxborough, -71.26) projects
   inside the frame — a -72 east edge clamped Boston off its true position. */
function mapPoint(venue: VenueDetails): { x: number; y: number } {
  const x = ((venue.longitude + 128) / 58) * 1000;
  const y = ((52 - venue.latitude) / 36) * 620;
  return { x: Math.max(18, Math.min(982, x)), y: Math.max(18, Math.min(602, y)) };
}

/* Northeast venues cluster tightly (Boston / New York / Philadelphia); these
   labels anchor to the LEFT of their marker so they stay on the map and
   don't stack on each other. */
const MAP_LABEL_LEFT_VENUES = new Set(["GILLETTE", "METLIFE"]);

/* Map match status mirrors the Schedule view's source precedence exactly
   (see renderSchedule's isMatchDone/isLiveMatch): fresh live-vendor fixture
   first, then the DB-ingested dbStatus/dbGh/dbGa fallback, with the same
   isStaleStatus guard. Without the DB fallback the map disagreed with the
   Schedule tab whenever the vendor fixture was missing. */
function matchStatus(match: MapMatch, nowMs: number): "live" | "completed" | "upcoming" {
  const f = match.fixture;
  const { ts, sourceMatch } = match;
  const db = sourceMatch.dbStatus;
  // Same staleness rule the schedule applies: a live status that has not
  // updated long past its plausible window is treated as unreliable.
  const stale = (f && isStaleStatus(ts, f.status, nowMs)) || (!f && db && isStaleStatus(ts, db, nowMs));
  if (!stale) {
    if (f && LIVE_STATUSES.has(f.status)) return "live";
    if (!f && db && LIVE_STATUSES.has(db)) return "live";
  }
  if (f && DONE_STATUSES.has(f.status)) return "completed";
  if (db && DONE_STATUSES.has(db) && sourceMatch.dbGh != null && sourceMatch.dbGa != null) return "completed";
  if (ts > nowMs) return "upcoming";
  // Kickoff has passed but no source confirms a result: hold as "upcoming"
  // for the plausible match window (~150 min) instead of fabricating
  // "completed" while play may still be under way.
  return nowMs - ts < 150 * 60000 ? "upcoming" : "completed";
}

function matchScoreLabel(match: MapMatch): string {
  const f = match.fixture;
  if (f && f.gh != null && f.ga != null) {
    const base = `${f.gh}-${f.ga}`;
    if (f.penHome != null && f.penAway != null) return `${base} (${f.penHome}-${f.penAway} pens)`;
    return base;
  }
  // DB-ingested final score when the live vendor fixture is missing —
  // keeps map scores consistent with the Schedule view.
  const sm = match.sourceMatch;
  if (sm.dbGh != null && sm.dbGa != null) return `${sm.dbGh}-${sm.dbGa}`;
  return "";
}

/* Formatter cache — Intl.DateTimeFormat construction is expensive and the
   map re-evaluates filters often; one formatter per venue timezone. */
const VENUE_DAY_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/* Today's YYYY-MM-DD in a venue's own timezone. Match dates (`iso`) are
   stored venue-local, so "Today" must be venue-local too — comparing against
   the browser's calendar date shows the wrong slate for users in other
   timezones (a 9 PM Vancouver kickoff is already "tomorrow" in Europe). */
function venueTodayISO(timezone: string, nowMs: number): string {
  let fmt = VENUE_DAY_FORMATTERS.get(timezone);
  if (!fmt) {
    // en-CA renders as YYYY-MM-DD, matching the schedule's iso format
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    VENUE_DAY_FORMATTERS.set(timezone, fmt);
  }
  return fmt.format(new Date(nowMs));
}

function formatVenueLocalTime(ts: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

function formatVenueTimelineTime(ts: number, timezone: string, canonicalLocal: string): string {
  const venueLocal = formatVenueLocalTime(ts, timezone);
  const localTime = canonicalLocal.replace(/\s+[A-Z]{2,4}$/, "");
  const venueTime = venueLocal.split(", ").pop()?.replace(/\s+[A-Z]{2,4}$/, "") || "";
  return localTime && venueTime === localTime ? canonicalLocal : `${venueLocal} · ${canonicalLocal}`;
}

type MapViewProps = {
  data: TournamentData;
  fixtures: LiveFixture[];
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null;
  nowMs: number;
  onMatchClick: (match: GroupStageMatch, fixture: LiveFixture | null) => void;
  onViewVenueMatches: (stadiumName: string) => void;
  /* One-shot venue handoff from other views (e.g. tapping a stadium card in
     More): the map opens with this venue selected and centered, then
     reports consumption so a later map visit isn't re-forced. */
  initialVenueId?: string | null;
  onInitialVenueConsumed?: () => void;
};

/* Map preferences from the shared settings store (Settings view writes it).
   Read once per MapView mount — the map unmounts on tab switches, so edits
   in Settings apply the next time the map opens. */
const MAP_STATE_KEY = "compet-map-state-v1";
function loadMapPrefs(): Pick<SettingsModel, "mapStyle" | "mapCenter" | "rememberMap" | "defaultTeam"> {
  const fallback = {
    mapStyle: DEFAULT_SETTINGS.mapStyle,
    mapCenter: DEFAULT_SETTINGS.mapCenter,
    rememberMap: DEFAULT_SETTINGS.rememberMap,
    defaultTeam: DEFAULT_SETTINGS.defaultTeam,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const saved = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!saved) return fallback;
    const merged = mergeSettings(JSON.parse(saved));
    return { mapStyle: merged.mapStyle, mapCenter: merged.mapCenter, rememberMap: merged.rememberMap, defaultTeam: merged.defaultTeam };
  } catch {
    return fallback;
  }
}

/* Last viewed venue/zoom, persisted when "Remember last viewed map location"
   is enabled in Settings. */
/* Default Leaflet view: continental North America — all 16 venues from
   Vancouver to Mexico City fit at zoom 4 on typical viewports. */
const MAP_DEFAULT_CENTER: [number, number] = [39.5, -97];
const MAP_DEFAULT_ZOOM = 4;

function loadRememberedMapState(): { venueId: string; center: [number, number]; zoom: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MAP_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { venueId?: unknown; center?: unknown; zoom?: unknown };
    if (typeof parsed.venueId !== "string" || !HOST_VENUE_DETAILS[parsed.venueId]) return null;
    // Leaflet zoom levels (3-12); values saved by the old SVG map (0.85-1.45)
    // fail this range check and fall back to the default view.
    const zoom = typeof parsed.zoom === "number" && parsed.zoom >= 3 && parsed.zoom <= 12 ? parsed.zoom : MAP_DEFAULT_ZOOM;
    const c = parsed.center;
    const center: [number, number] = Array.isArray(c) && c.length === 2 && c.every(v => typeof v === "number")
      ? [c[0] as number, c[1] as number]
      : MAP_DEFAULT_CENTER;
    return { venueId: parsed.venueId, center, zoom };
  } catch {
    return null;
  }
}

/* Bottom-sheet / side-panel display states. Mobile: closed → floating map
   only; collapsed → header pill; half → 46svh sheet; expanded → 80svh.
   Desktop treats half/expanded as the open side panel and collapsed as a
   narrow rail. */
type MapPanelState = "closed" | "collapsed" | "half" | "expanded";

/* Renders the legacy SVG map if the Leaflet chunk throws — the fallback
   keeps every marker clickable, just without real tiles. */
class MapErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/* Leaflet touches `window` at import time, so the real map loads client-side
   only; SSR and the loading gap render a lightweight placeholder. */
const VenueMap = dynamic(() => import("@/app/components/VenueMap"), {
  ssr: false,
  loading: () => <div className="venue-map-loading" role="status"><span className="sr-only">Loading map…</span></div>,
});

/* Memoized with minute-granular time comparison: nothing on the map needs
   sub-minute precision, so parent re-renders (drawer state, search typing,
   nowMs ticks) don't re-run the venue/status computations. */
const MapView = memo(function MapView({ data, fixtures, findLive, nowMs, onMatchClick, onViewVenueMatches, initialVenueId, onInitialVenueConsumed }: MapViewProps) {
  /* Settings-driven map preferences (style, auto-center, remember) */
  const prefs = useMemo(loadMapPrefs, []);
  const remembered = useMemo(() => (prefs.rememberMap ? loadRememberedMapState() : null), [prefs.rememberMap]);

  const [activeVenueId, setActiveVenueId] = useState(initialVenueId || remembered?.venueId || "METLIFE");
  const [statusFilter, setStatusFilter] = useState<MapStatusFilter>("all");
  const [countryFilter, setCountryFilter] = useState<MapCountryFilter>("all");
  const [selectedTeam, setSelectedTeam] = useState("ALL");
  const [showMapLegend, setShowMapLegend] = useState(false);
  /* Zoom for the SVG FALLBACK map only — the Leaflet map manages its own */
  const [svgZoom, setSvgZoom] = useState(1);
  /* Bottom sheet (mobile) / side panel (desktop) display state */
  const [panelState, setPanelState] = useState<MapPanelState>("half");
  /* One-shot auto-pan request consumed by the Leaflet map */
  const [focusRequest, setFocusRequest] = useState<VenueFocusRequest | null>(null);
  /* One-shot "show every venue" request consumed by the Leaflet map */
  const [fitRequest, setFitRequest] = useState<VenueFitRequest | null>(null);
  /* One-shot team-route bounds request consumed by the Leaflet map */
  const [routeFitRequest, setRouteFitRequest] = useState<VenueRouteFitRequest | null>(null);
  /* Live view (center/zoom) mirrored from Leaflet's moveend for persistence */
  const viewRef = useRef<{ center: [number, number]; zoom: number }>({
    center: remembered?.center || MAP_DEFAULT_CENTER,
    zoom: remembered?.zoom || MAP_DEFAULT_ZOOM,
  });
  /* Focus target for the venue panel — when a marker is activated we move
     focus to the panel heading so keyboard/screen-reader users land on the
     content that just changed instead of staying lost among the markers. */
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const canvasScrollRef = useRef<HTMLDivElement>(null);
  const lastRouteFitKeyRef = useRef("");
  const explicitSelectionRef = useRef<string | null>(null);
  const userFilterActionRef = useRef(false);
  const routeFitIssuedRef = useRef(false);
  const mapInteractedRef = useRef(false);

  const mapFocusOffsets = (nextPanel: MapPanelState) => {
    const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
    return {
      offsetY: isMobile ? Math.round(window.innerHeight * (nextPanel === "expanded" ? 0.3 : 0.2)) : 0,
      offsetX: isMobile ? 0 : 180,
    };
  };

  const requestVenueMapFocus = (venueId: string, nextPanel: MapPanelState) => {
    const { offsetX, offsetY } = mapFocusOffsets(nextPanel);
    setFocusRequest(req => ({ venueId, offsetX, offsetY, seq: (req?.seq || 0) + 1 }));
  };

  const selectVenue = (venueId: string) => {
    mapInteractedRef.current = true;
    explicitSelectionRef.current = venueId;
    /* Explicit marker intent beats the active venue filter: if a dimmed
       marker is tapped, clear the status/country filter so the selection and
       panel cannot be immediately snapped back to another venue. Team path
       context stays intact because the user may still be exploring that team. */
    if (!filteredVenueIds.has(venueId)) {
      setStatusFilter("all");
      setCountryFilter("all");
    }
    setActiveVenueId(venueId);
    /* Opening from closed/collapsed lands on the half sheet; an already
       open panel keeps its current size. */
    const nextPanel: MapPanelState = panelState === "closed" || panelState === "collapsed" ? "half" : panelState;
    setPanelState(nextPanel);
    /* Auto-pan so the marker stays visible above the sheet (mobile) or
       left of the side panel (desktop). */
    requestVenueMapFocus(venueId, nextPanel);
    window.requestAnimationFrame(() => panelHeadingRef.current?.focus());
  };

  const showAllVenues = () => {
    mapInteractedRef.current = true;
    /* Leaflet fits geographic bounds; the SVG error fallback resets to its
       full-country scale and scroll origin so all markers are recoverable. */
    setSvgZoom(1);
    canvasScrollRef.current?.scrollTo({ left: 0, top: 0, behavior: "smooth" });
    setFitRequest(req => ({ seq: (req?.seq || 0) + 1 }));
  };

  /* Venue handoff from another view (stadium card in More): center the map
     on it and open its panel once on mount, then report consumption so
     future map visits fall back to remembered/default behavior. */
  const consumedInitialVenueRef = useRef(false);
  useEffect(() => {
    if (!initialVenueId || consumedInitialVenueRef.current) return;
    consumedInitialVenueRef.current = true;
    /* Delay one frame so the Leaflet chunk's mount can accept the focus */
    const id = window.requestAnimationFrame(() => {
      selectVenue(initialVenueId);
      onInitialVenueConsumed?.();
    });
    return () => window.cancelAnimationFrame(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVenueId]);

  const setStatusFilterFromUser = (next: MapStatusFilter) => {
    mapInteractedRef.current = true;
    userFilterActionRef.current = true;
    setStatusFilter(next);
  };

  const setCountryFilterFromUser = (next: MapCountryFilter | ((current: MapCountryFilter) => MapCountryFilter)) => {
    mapInteractedRef.current = true;
    userFilterActionRef.current = true;
    setCountryFilter(next);
  };

  const setSelectedTeamFromUser = (next: string) => {
    mapInteractedRef.current = true;
    userFilterActionRef.current = true;
    setSelectedTeam(next);
  };

  /* Persist the live map view when "remember last location" is on */
  const handleViewChange = useCallback((center: [number, number], zoom: number) => {
    mapInteractedRef.current = true;
    viewRef.current = { center, zoom };
    if (!prefs.rememberMap) return;
    try {
      window.localStorage.setItem(MAP_STATE_KEY, JSON.stringify({ venueId: activeVenueIdRef.current, center, zoom }));
    } catch { /* private mode / quota */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.rememberMap]);
  /* Ref mirror so handleViewChange stays identity-stable for the map */
  const activeVenueIdRef = useRef(activeVenueId);
  activeVenueIdRef.current = activeVenueId;

  /* Escape closes the venue panel from anywhere in the view */
  useEffect(() => {
    if (panelState === "closed") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setPanelState("closed");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelState]);

  const allTeams = useMemo(() => Object.values(data.groups).flat().sort((a, b) => a.localeCompare(b)), [data.groups]);

  const mapMatches = useMemo<MapMatch[]>(() => {
    const groupMatches = data.gs.map((m): MapMatch => {
      const fixture = findLive({ ts: m.ts, v: m.v, t1: m.t1, t2: m.t2 }, fixtures);
      return {
        key: `gs-${m.no}`,
        no: m.no,
        venueId: m.v,
        ts: m.ts,
        iso: m.iso,
        local: m.local,
        et: m.et,
        stage: "Group Stage",
        homeTeam: m.t1,
        awayTeam: m.t2,
        fixture,
        sourceMatch: m,
      };
    });

    /* Knockout matches resolve through the shared bracket builder, not just
       live fixtures — so a tie whose fixture the vendor has not published
       yet (a group winner's first R32 game, an alive team's next round)
       still carries its resolved participants. This is what keeps upcoming
       journey legs and Alive/Eliminated status correct for every team.
       It also replaces the synthetic index+73 numbering with the bracket's
       real match numbers. */
    const knockoutMatches = buildKnockoutCards(data, fixtures, findLive, nowMs).map((card): MapMatch => {
      const [teamA, teamB] = card.teams;
      const t1 = teamA.placeholder ? "TBD" : teamA.name;
      const t2 = teamB.placeholder ? "TBD" : teamB.name;
      return {
        key: `ko-${card.matchNo}`,
        no: card.matchNo,
        venueId: card.match.v,
        ts: card.match.ts,
        iso: card.match.iso,
        local: card.match.local,
        et: card.match.et,
        stage: card.match.round,
        homeTeam: t1,
        awayTeam: t2,
        fixture: card.fixture,
        sourceMatch: {
          no: card.matchNo,
          iso: card.match.iso,
          local: card.match.local,
          et: card.match.et,
          g: "KO",
          t1,
          t2,
          v: card.match.v,
          ts: card.match.ts,
        },
      };
    });

    return [...groupMatches, ...knockoutMatches].sort((a, b) => a.ts - b.ts);
  // nowMs is minute-granular here (MapView's memo comparator) — the bracket
  // builder needs it for staleness checks, so this recomputes at most 1/min.
  }, [data, fixtures, findLive, nowMs]);

  const venueModels = useMemo(() => Object.entries(data.venues).map(([venueId, venue]) => {
    const detail = HOST_VENUE_DETAILS[venueId] || {
      venueId,
      stadiumName: venue.common,
      city: venue.city,
      stateOrProvince: "",
      country: venue.country === "USA" ? "USA" : venue.country === "Canada" ? "Canada" : "Mexico",
      latitude: 0,
      longitude: 0,
      capacity: venue.cap,
      timezone: "America/New_York",
      imageUrl: null,
    } satisfies VenueDetails;
    const matches = mapMatches.filter(match => match.venueId === venueId);
    const liveCount = matches.filter(match => matchStatus(match, nowMs) === "live").length;
    const completedCount = matches.filter(match => matchStatus(match, nowMs) === "completed").length;
    const upcomingCount = matches.filter(match => matchStatus(match, nowMs) === "upcoming").length;
    return { ...detail, stadiumName: venue.common, capacity: venue.cap, matchesHosted: matches.length, matches, liveCount, completedCount, upcomingCount };
  }).sort((a, b) => b.liveCount - a.liveCount || b.matchesHosted - a.matchesHosted || a.city.localeCompare(b.city)), [data.venues, mapMatches, nowMs]);

  const matchPassesActiveFilter = useCallback((match: MapMatch, venue: Pick<VenueDetails, "timezone">) => {
    const status = matchStatus(match, nowMs);
    if (statusFilter === "today") return match.iso === venueTodayISO(venue.timezone, nowMs);
    if (statusFilter === "live") return status === "live";
    if (statusFilter === "upcoming") return status === "upcoming";
    if (statusFilter === "completed") return status === "completed";
    if (statusFilter === "knockout") return match.stage !== "Group Stage";
    return true;
  }, [statusFilter, nowMs]);

  const activeVenue = venueModels.find(venue => venue.venueId === activeVenueId) || venueModels[0];
  const selectedTeamCanon = selectedTeam === "ALL" ? "" : canon(selectedTeam);

  const teamJourney = useMemo(() => {
    if (selectedTeam === "ALL") return [];
    return mapMatches.filter(match => {
      const venue = venueModels.find(item => item.venueId === match.venueId);
      if (!venue) return false;
      const countryMatch = countryFilter === "all" || countryFilterKey(venue.country) === countryFilter;
      if (!countryMatch || !matchPassesActiveFilter(match, venue)) return false;
      const teams = [match.homeTeam, match.awayTeam, match.fixture?.home || "", match.fixture?.away || ""].map(canon);
      return teams.includes(selectedTeamCanon);
    });
  }, [mapMatches, venueModels, selectedTeam, selectedTeamCanon, countryFilter, matchPassesActiveFilter]);

  /* Collapse only consecutive same-venue stops. A team returning to an
     earlier city later in the tournament is a new travel stop and must stay
     in the visible journey and route polyline. */
  const groupedTeamJourney = useMemo(() => groupConsecutiveJourneyStops(teamJourney), [teamJourney]);

  /* Full Team Journey model (lib/journey.ts): grouped stops with distances,
     Alive/Eliminated/Champion status, and the curved route split into a
     completed leg and an upcoming leg for the map. */
  const journeyModel = useMemo(() => {
    if (selectedTeam === "ALL" || teamJourney.length === 0) return null;
    const journeyVenues: Record<string, JourneyVenue> = {};
    for (const venue of venueModels) {
      journeyVenues[venue.venueId] = {
        venueId: venue.venueId,
        city: venue.city,
        stadiumName: venue.stadiumName,
        country: venue.country,
        latitude: venue.latitude,
        longitude: venue.longitude,
        timezone: venue.timezone,
        capacity: venue.capacity,
      };
    }
    const inputs: JourneyMatchInput[] = teamJourney.map(match => {
      const status = matchStatus(match, nowMs);
      const f = match.fixture;
      /* Which side is the selected team? Prefer the live fixture's naming */
      const isHome = canon(f?.home || match.homeTeam) === selectedTeamCanon;
      const opponent = canon(isHome ? (f?.away || match.awayTeam) : (f?.home || match.homeTeam)) || "TBD";
      /* Result AND score from the team's perspective ("3-1" means the
         selected team scored 3) — a raw home-away score reads wrong next
         to a W/L badge when the team played away. Pens break drawn ties. */
      let result: JourneyMatchInput["result"] = null;
      let score = "";
      if (status !== "upcoming" && f && f.gh != null && f.ga != null) {
        const mine = isHome ? f.gh : f.ga;
        const theirs = isHome ? f.ga : f.gh;
        score = `${mine}-${theirs}`;
        if (status === "completed") {
          if (mine !== theirs) result = mine > theirs ? "W" : "L";
          else if (f.penHome != null && f.penAway != null) {
            const myPens = isHome ? f.penHome : f.penAway;
            const theirPens = isHome ? f.penAway : f.penHome;
            score = `${score} (${myPens}-${theirPens} pens)`;
            result = myPens > theirPens ? "W" : "L";
          } else result = "D";
        }
      }
      return {
        key: match.key,
        no: match.no,
        venueId: match.venueId,
        ts: match.ts,
        stage: match.stage,
        opponent,
        status,
        score,
        result,
      };
    });
    /* Knockout counts as underway once any KO fixture has resolved teams —
       this lets the model tell a group exit from "next round not drawn". */
    const knockoutStarted = mapMatches.some(match => match.stage !== "Group Stage" && (match.fixture != null || match.homeTeam !== "TBD"));
    return buildTeamJourney(inputs, journeyVenues, { knockoutStarted });
  }, [teamJourney, mapMatches, venueModels, selectedTeam, selectedTeamCanon, nowMs]);

  /* Hovering a journey-timeline stop highlights its map marker (desktop) */
  const [hoverVenueId, setHoverVenueId] = useState("");

  /* The venue sheet is position:fixed on mobile, which would keep it
     floating over the journey timeline after the user scrolls past the
     map. Track the map card's visibility and hide the sheet while the map
     itself is off-screen — the journey below must never be covered. */
  const canvasCardRef = useRef<HTMLDivElement>(null);
  const [mapOffscreen, setMapOffscreen] = useState(false);
  useEffect(() => {
    const card = canvasCardRef.current;
    if (!card || typeof IntersectionObserver === "undefined") return;
    /* Hide well before the card fully leaves: once less than ~35% of the
       map remains visible, the fixed sheet is already sitting on top of
       journey content rather than the map it belongs to. */
    const observer = new IntersectionObserver(
      entries => setMapOffscreen(entries[0] ? entries[0].intersectionRatio < 0.35 : false),
      { threshold: [0, 0.2, 0.35, 0.5] },
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  const panelEmptyMessage = useMemo(() => {
    if (statusFilter === "today") return "No matches today at this venue.";
    if (statusFilter === "live") return "No live matches at this venue.";
    if (statusFilter === "upcoming") return "No upcoming matches at this venue.";
    if (statusFilter === "completed") return "No completed matches at this venue.";
    if (statusFilter === "knockout") return "No knockout matches at this venue.";
    return "No matches at this venue for the current selection.";
  }, [statusFilter]);

  const filteredVenueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const venue of venueModels) {
      const venueMatches = selectedTeam === "ALL"
        ? venue.matches
        : venue.matches.filter(match => [match.homeTeam, match.awayTeam, match.fixture?.home || "", match.fixture?.away || ""].map(canon).includes(selectedTeamCanon));
      const hasMatch = venueMatches.some(match => matchPassesActiveFilter(match, venue));
      const countryMatch = countryFilter === "all" || countryFilterKey(venue.country) === countryFilter;
      if (countryMatch && hasMatch) ids.add(venue.venueId);
    }
    return ids;
  }, [venueModels, selectedTeam, selectedTeamCanon, countryFilter, matchPassesActiveFilter]);
  const mapStatusMessage = activeVenue
    ? `Showing ${filteredVenueIds.size} of ${venueModels.length} venues. ${activeVenue.stadiumName} selected.`
    : `Showing ${filteredVenueIds.size} of ${venueModels.length} venues.`;

  const panelMatches = useMemo(() => activeVenue.matches
    .filter(match => selectedTeam === "ALL" || [match.homeTeam, match.awayTeam, match.fixture?.home || "", match.fixture?.away || ""].map(canon).includes(selectedTeamCanon))
    .filter(match => matchPassesActiveFilter(match, activeVenue))
    .sort((a, b) => a.ts - b.ts), [activeVenue, selectedTeam, selectedTeamCanon, matchPassesActiveFilter]);
  // Live total derives from the per-venue counts already computed above —
  // no need for another full scan of mapMatches.
  /* Hero stats mirror the ACTIVE filters — with "USA" selected the counts
     describe USA venues only, not the global tournament. With no filters
     active this equals the global totals (16 venues / 104 matches). */
  const filteredHeroStats = useMemo(() => {
    let venues = 0;
    let matchCount = 0;
    let liveCount = 0;
    for (const venue of venueModels) {
      if (!filteredVenueIds.has(venue.venueId)) continue;
      venues++;
      const teamScoped = selectedTeam === "ALL"
        ? venue.matches
        : venue.matches.filter(match => [match.homeTeam, match.awayTeam, match.fixture?.home || "", match.fixture?.away || ""].map(canon).includes(selectedTeamCanon));
      const passing = teamScoped.filter(match => matchPassesActiveFilter(match, venue));
      matchCount += passing.length;
      liveCount += passing.filter(match => matchStatus(match, nowMs) === "live").length;
    }
    return { venues, matches: matchCount, live: liveCount };
  }, [venueModels, filteredVenueIds, selectedTeam, selectedTeamCanon, matchPassesActiveFilter, nowMs]);
  const routePoints = useMemo(() => groupedTeamJourney.map(stop => {
    const venue = venueModels.find(v => v.venueId === stop.venueId);
    return venue ? mapPoint(venue) : null;
  }).filter((point): point is { x: number; y: number } => !!point), [groupedTeamJourney, venueModels]);

  /* Marker models for the Leaflet map (real lat/lng, not SVG projection) */
  const mapMarkers = useMemo<VenueMapMarker[]>(() => venueModels.map(venue => ({
    venueId: venue.venueId,
    stadiumName: venue.stadiumName,
    city: venue.city,
    country: venue.country,
    latitude: venue.latitude,
    longitude: venue.longitude,
    live: venue.liveCount > 0,
    active: venue.venueId === activeVenueId && filteredVenueIds.has(venue.venueId),
    onTeamPath: selectedTeam !== "ALL" && teamJourney.some(match => match.venueId === venue.venueId),
    nextStop: journeyModel?.summary.status === "alive" && journeyModel.stops.some(stop => stop.isNext && stop.venue.venueId === venue.venueId),
    hovered: hoverVenueId === venue.venueId,
    labelLeft: MAP_LABEL_LEFT_VENUES.has(venue.venueId),
    muted: !filteredVenueIds.has(venue.venueId),
    matchesHosted: venue.matchesHosted,
    liveCount: venue.liveCount,
    upcomingCount: venue.upcomingCount,
    completedCount: venue.completedCount,
  })), [venueModels, filteredVenueIds, activeVenueId, selectedTeam, teamJourney, journeyModel, hoverVenueId]);

  /* Team travel path as geographic stops for the Leaflet polyline */
  const routeLatLngs = useMemo<[number, number][]>(() => groupedTeamJourney.map(stop => {
    const venue = venueModels.find(v => v.venueId === stop.venueId);
    return venue ? [venue.latitude, venue.longitude] as [number, number] : null;
  }).filter((p): p is [number, number] => !!p), [groupedTeamJourney, venueModels]);

  const openMatch = (match: MapMatch) => onMatchClick(match.sourceMatch, match.fixture);

  /* When a selected team has enough resolved stops to draw a path, fit the
     map to that path once so the user immediately sees what changed. */
  useEffect(() => {
    if (selectedTeam === "ALL" || routeLatLngs.length < 2) return;
    const routeKey = `${selectedTeam}|${routeLatLngs.map(point => point.join(",")).join(";")}`;
    /* Route fits on team change or route resolution, never on data-identity
       churn from live polls/minute ticks that rebuild equivalent arrays. */
    if (lastRouteFitKeyRef.current === routeKey) return;
    lastRouteFitKeyRef.current = routeKey;
    routeFitIssuedRef.current = true;
    setRouteFitRequest(req => ({ points: routeLatLngs, seq: (req?.seq || 0) + 1 }));
  }, [selectedTeam, routeLatLngs]);

  /* Keep the venue panel in sync with the active filter: if the selected
     venue drops out of the filtered set (e.g. panel shows MetLife, user taps
     "Mexico"), jump to the first venue that matches. A completely empty
     filter closes the panel so stale venue details cannot remain visible. */
  useEffect(() => {
    if (panelState === "closed") return;
    if (explicitSelectionRef.current === activeVenueId) {
      explicitSelectionRef.current = null;
      return;
    }
    const nextSelection = resolveFilteredVenueSelection(activeVenueId, filteredVenueIds, venueModels.map(venue => venue.venueId));
    if (!nextSelection.closePanel && nextSelection.venueId === activeVenueId) {
      userFilterActionRef.current = false;
      routeFitIssuedRef.current = false;
      return;
    }
    if (nextSelection.closePanel || !nextSelection.venueId) {
      setPanelState("closed");
      userFilterActionRef.current = false;
      routeFitIssuedRef.current = false;
      return;
    }
    const first = venueModels.find(venue => venue.venueId === nextSelection.venueId);
    if (first) {
      setActiveVenueId(first.venueId);
      const shouldFocus = userFilterActionRef.current && !routeFitIssuedRef.current;
      userFilterActionRef.current = false;
      routeFitIssuedRef.current = false;
      if (shouldFocus) requestVenueMapFocus(first.venueId, panelState);
    }
  }, [filteredVenueIds, activeVenueId, venueModels, panelState]);

  /* Auto-center per the "Automatically center map" setting — runs once per
     mount, and only when no remembered location took precedence. */
  const autoCenteredRef = useRef(false);
  useEffect(() => {
    if (autoCenteredRef.current || remembered) return;
    autoCenteredRef.current = true;
    if (prefs.mapCenter === "Current live venue") {
      const liveVenue = venueModels.find(venue => venue.liveCount > 0);
      if (liveVenue) {
        setActiveVenueId(liveVenue.venueId);
        requestVenueMapFocus(liveVenue.venueId, panelState);
      }
      return;
    }
    if (prefs.mapCenter === "Favorite team") {
      const teamCanon = canon(prefs.defaultTeam);
      const teamMatches = mapMatches.filter(match =>
        [match.homeTeam, match.awayTeam, match.fixture?.home || "", match.fixture?.away || ""].map(canon).includes(teamCanon));
      // Center on the team's next match, falling back to their latest one
      const target = teamMatches.find(match => match.ts > nowMs) || teamMatches[teamMatches.length - 1];
      if (target) {
        setActiveVenueId(target.venueId);
        requestVenueMapFocus(target.venueId, panelState);
      }
      return;
    }
    if (prefs.mapCenter === "User location" && typeof navigator !== "undefined" && navigator.permissions && navigator.geolocation) {
      // Never prompt from the map — only use geolocation when the user has
      // already granted permission elsewhere; otherwise keep the default.
      navigator.permissions.query({ name: "geolocation" }).then(status => {
        if (status.state !== "granted") return;
        navigator.geolocation.getCurrentPosition(position => {
          if (mapInteractedRef.current) return;
          const { latitude, longitude } = position.coords;
          let nearest: { venueId: string; d: number } | null = null;
          for (const venue of Object.values(HOST_VENUE_DETAILS)) {
            const d = (venue.latitude - latitude) ** 2 + (venue.longitude - longitude) ** 2;
            if (!nearest || d < nearest.d) nearest = { venueId: venue.venueId, d };
          }
          if (nearest) {
            setActiveVenueId(nearest.venueId);
            requestVenueMapFocus(nearest.venueId, panelState);
          }
        }, () => { /* keep default on error */ });
      }).catch(() => { /* permissions API unavailable — keep default */ });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueModels, mapMatches]);

  /* Persist the selected venue when it changes (map center/zoom persist on
     moveend via handleViewChange) */
  useEffect(() => {
    if (!prefs.rememberMap) return;
    try {
      window.localStorage.setItem(MAP_STATE_KEY, JSON.stringify({ venueId: activeVenueId, ...viewRef.current }));
    } catch { /* private mode / quota */ }
  }, [activeVenueId, prefs.rememberMap]);

  return (
    // <section>, not <main> — the app shell already renders the single
    // <main id="main-content"> landmark; nesting mains breaks AT navigation.
    <section className="map-view" aria-label="World Cup 2026 host map">
      <section className="map-hero">
        <div>
          <span className="map-hero__eyebrow">Tournament Geography</span>
          <h2>Host City Map</h2>
          <p>Explore every World Cup 2026 venue, live stadium state, local kickoff time, and team travel path across the United States, Canada, and Mexico.</p>
        </div>
        <div className="map-hero__stats">
          <span><b>{filteredHeroStats.venues}</b>{filteredHeroStats.venues !== venueModels.length ? ` of ${venueModels.length} ` : " "}venues</span>
          <span><b>{filteredHeroStats.matches}</b>{filteredHeroStats.matches !== mapMatches.length ? ` of ${mapMatches.length} ` : " "}matches</span>
          <span><b>{filteredHeroStats.live}</b> live</span>
        </div>
      </section>
      <p className="sr-only" aria-live="polite">{mapStatusMessage}</p>

      <div className="map-toolbar">
        <div className="map-filter-row map-filter-row--status" role="group" aria-label="Map status filters">
          {[
            ["all", "All venues"],
            ["today", "Today"],
            ["live", "Live"],
            ["upcoming", "Upcoming"],
            ["completed", "Completed"],
            ["knockout", "Knockout"],
          ].map(([key, label]) => (
            <button key={key} type="button" className="map-chip" aria-pressed={statusFilter === key} onClick={() => setStatusFilterFromUser(key as MapStatusFilter)}>
              {label}
            </button>
          ))}
          <button
            type="button"
            className="map-chip map-chip--legend"
            aria-expanded={showMapLegend}
            aria-label={showMapLegend ? "Hide map legend" : "Show map legend"}
            onClick={() => setShowMapLegend(open => !open)}
          >
            ?
          </button>
        </div>
        <div className="map-filter-row map-filter-row--country" role="group" aria-label="Map country filters">
          {[
            ["usa", "USA"],
            ["canada", "Canada"],
            ["mexico", "Mexico"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="map-chip map-chip--country"
              aria-pressed={countryFilter === key}
              onClick={() => setCountryFilterFromUser(current => current === key ? "all" : key as MapCountryFilter)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="map-team-select">
          <span>Team path</span>
          <select value={selectedTeam} onChange={event => setSelectedTeamFromUser(event.target.value)}>
            <option value="ALL">All teams</option>
            {allTeams.map(team => <option key={team} value={team}>{team}</option>)}
          </select>
        </label>
      </div>

      <div className={`map-legend${showMapLegend ? " map-legend--open" : ""}`} aria-label="Map marker legend">
        <span><i className="map-legend__marker" aria-hidden="true"><i className="vm-marker"><i className="vm-marker__dot" /></i></i>Venue</span>
        <span><i className="map-legend__marker" aria-hidden="true"><i className="vm-marker vm-marker--live"><i className="vm-marker__dot" /></i></i>Live</span>
        <span><i className="map-legend__marker" aria-hidden="true"><i className="vm-marker vm-marker--active"><i className="vm-marker__dot" /></i></i>Selected</span>
        <span><i className="map-legend__marker" aria-hidden="true"><i className="vm-marker vm-marker--muted"><i className="vm-marker__dot" /></i></i>Filtered out</span>
        {selectedTeam !== "ALL" && (
          <span><i className="map-legend__route" aria-hidden="true" />Team route</span>
        )}
      </div>

      <section className={`map-shell map-shell--panel-${panelState}`}>
        <div className="map-canvas-card" ref={canvasCardRef}>
          <button
            type="button"
            className="map-fit-control"
            aria-label="Show all venues"
            title="Show all venues"
            onClick={showAllVenues}
          >
            ⤢
          </button>
          {/* Real interactive map (tiles, pan, pinch-zoom). The legacy SVG
              map below is ONLY the error fallback if the Leaflet chunk
              fails to load. */}
          <MapErrorBoundary fallback={(
            <>
          <div className="map-controls" aria-label="Map zoom controls">
            <button type="button" onClick={() => setSvgZoom(z => Math.min(1.45, +(z + 0.15).toFixed(2)))} aria-label="Zoom in">+</button>
            <button type="button" onClick={() => setSvgZoom(z => Math.max(0.85, +(z - 0.15).toFixed(2)))} aria-label="Zoom out">−</button>
          </div>
          <div className="map-canvas-scroll" ref={canvasScrollRef}>
            {/* role="group" (not "img") — an img role would flatten the whole
                subtree in the accessibility tree and hide the interactive
                venue markers from screen readers.
                Zoom drives the SVG's laid-out width via --map-zoom rather
                than transform: scale() — transforms don't grow the scroll
                extent, which made zoomed-in coasts unreachable. */}
            <svg className={`host-map host-map--${prefs.mapStyle.toLowerCase()}`} viewBox="0 0 1000 620" style={{ "--map-zoom": svgZoom } as CSSProperties} role="group" aria-label="Map of World Cup 2026 host venues">
              <defs>
                <linearGradient id="mapLand" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0%" stopColor="#173926" />
                  <stop offset="100%" stopColor="#0d1726" />
                </linearGradient>
                <filter id="routeGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <rect x="0" y="0" width="1000" height="620" rx="34" fill="#07111d" />
              <path d="M75 115 C165 60 245 62 330 92 C430 126 520 88 625 116 C742 147 855 120 932 175 L930 520 C792 560 672 520 546 546 C420 573 308 545 188 565 C120 576 72 540 50 486 Z" fill="url(#mapLand)" stroke="rgba(255,255,255,.1)" strokeWidth="2" />
              <path d="M152 142 C218 183 254 238 260 310 C266 382 235 446 204 526" className="map-line" />
              <path d="M335 126 C376 215 391 320 374 448" className="map-line" />
              <path d="M515 138 C535 236 522 352 556 512" className="map-line" />
              <path d="M712 142 C750 230 764 350 748 512" className="map-line" />
              <path d="M145 482 C300 440 466 431 610 454 C724 472 808 438 900 390" className="map-line" />
              {routePoints.length > 1 && (
                <polyline
                  points={routePoints.map(point => `${point.x},${point.y}`).join(" ")}
                  className="team-route"
                  filter="url(#routeGlow)"
                />
              )}
              {venueModels.map(venue => {
                const point = mapPoint(venue);
                const visible = filteredVenueIds.has(venue.venueId);
                const active = activeVenue?.venueId === venue.venueId;
                const live = venue.liveCount > 0;
                const onTeamPath = selectedTeam !== "ALL" && teamJourney.some(match => match.venueId === venue.venueId);
                /* Full announcement for assistive tech: venue, location, match
                   counts, and live state — the SVG <title> tooltip is
                   mouse-only so everything must live in the aria-label. */
                const markerLabel =
                  `${venue.stadiumName}, ${venue.city}, ${venue.country}. ` +
                  `${venue.matchesHosted} matches: ${venue.liveCount} live, ${venue.upcomingCount} upcoming, ${venue.completedCount} completed.` +
                  (live ? " Live now." : "") +
                  (!visible ? " Not in current filter." : "");
                return (
                  <g key={venue.venueId} className={`map-marker-group${visible ? "" : " map-marker-group--muted"}${active ? " map-marker-group--active" : ""}${live ? " map-marker-group--live" : ""}${onTeamPath ? " map-marker-group--route" : ""}`}>
                    {live && <circle cx={point.x} cy={point.y} r="24" className="map-marker-pulse" />}
                    <g
                      role="button"
                      tabIndex={0}
                      className="map-marker-button"
                      aria-label={markerLabel}
                      aria-pressed={active}
                      onClick={() => selectVenue(venue.venueId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectVenue(venue.venueId);
                        }
                      }}
                    >
                      <circle cx={point.x} cy={point.y} r={active ? 13 : 10} className="map-marker" />
                    </g>
                    <text
                      x={MAP_LABEL_LEFT_VENUES.has(venue.venueId) ? point.x - 14 : point.x + 14}
                      y={point.y - 12}
                      textAnchor={MAP_LABEL_LEFT_VENUES.has(venue.venueId) ? "end" : "start"}
                      className="map-marker-label"
                    >{venue.city}</text>
                    <title>{venue.stadiumName} · {venue.matchesHosted} matches</title>
                  </g>
                );
              })}
            </svg>
          </div>
            </>
          )}>
            <VenueMap
              markers={mapMarkers}
              completedRoute={journeyModel?.completedPath || []}
              upcomingRoute={journeyModel?.upcomingPath || []}
              mapStyle={prefs.mapStyle}
              initialCenter={viewRef.current.center}
              initialZoom={viewRef.current.zoom}
              focusRequest={focusRequest}
              fitRequest={fitRequest}
              routeFitRequest={routeFitRequest}
              autoFitIfEmpty={!!remembered}
              layoutKey={panelState}
              onSelect={selectVenue}
              onBackgroundClick={() => {
                if (panelState !== "closed") setPanelState("collapsed");
              }}
              onViewChange={handleViewChange}
            />
          </MapErrorBoundary>
          {filteredVenueIds.size === 0 && (
            <p className="map-empty" role="status">No venues match this filter. Try a different filter or team.</p>
          )}
          {selectedTeam !== "ALL" && routeLatLngs.length < 2 && (
            <p className="map-route-notice" role="status">No confirmed route yet for {selectedTeam} — knockout venues appear as the bracket resolves.</p>
          )}
          {activeVenue && panelState === "closed" && (
            <button
              type="button"
              className="map-reopen-pill"
              aria-label="Reopen venue details"
              onClick={() => setPanelState("half")}
            >
              <span>{activeVenue.stadiumName}</span>
              <b aria-hidden="true">▸</b>
            </button>
          )}
        </div>

        {/* The separate sr-only status line announces selection/filter
            changes; the panel itself stays quiet so screen readers don't get
            the entire venue card re-read on every marker change. States:
            collapsed (header pill), half, expanded — closed unmounts the
            panel so the map is fully usable. Escape closes. */}
        {activeVenue && panelState !== "closed" && (
          <aside className={`map-panel map-panel--${panelState}${mapOffscreen ? " map-panel--offscreen" : ""}`} aria-label={`${activeVenue.stadiumName} details`}>
            {/* Drag-handle bar (mobile): toggles between half and expanded */}
            <button
              type="button"
              className="map-panel__handle"
              aria-label={panelState === "expanded" ? "Shrink venue details to half height" : "Expand venue details"}
              onClick={() => setPanelState(state => state === "expanded" ? "half" : "expanded")}
            >
              <span aria-hidden="true">{panelState === "expanded" ? "▾" : "▴"}</span>
            </button>
            <div className="map-panel__bar">
              <span className="map-panel__bar-title">{activeVenue.stadiumName}</span>
              <button
                type="button"
                className="map-panel__bar-btn"
                aria-label={panelState === "collapsed" ? "Restore venue details" : "Minimize venue details"}
                onClick={() => setPanelState(state => state === "collapsed" ? "half" : "collapsed")}
              >
                {panelState === "collapsed" ? "▴" : "▾"}
              </button>
              <button
                type="button"
                className="map-panel__bar-btn"
                aria-label="Close venue details"
                onClick={() => setPanelState("closed")}
              >
                ×
              </button>
            </div>
            <div className="map-panel__hero">
              <div className="map-panel__image" style={activeVenue.imageUrl ? { backgroundImage: `url(${activeVenue.imageUrl})` } : undefined}>
                {!activeVenue.imageUrl && <span>{activeVenue.city.slice(0, 3).toUpperCase()}</span>}
              </div>
              <div>
                <span className="map-panel__eyebrow">{activeVenue.country} · {activeVenue.stateOrProvince}</span>
                <h3 ref={panelHeadingRef} tabIndex={-1}>{activeVenue.stadiumName}</h3>
                <p>{activeVenue.city} · {activeVenue.capacity.toLocaleString("en-US")} seats</p>
              </div>
            </div>

            <div className="map-panel__metrics">
              <span><b>{activeVenue.matchesHosted}</b> hosted</span>
              <span><b>{activeVenue.upcomingCount}</b> upcoming</span>
              <span><b>{activeVenue.completedCount}</b> complete</span>
              <span><b>{activeVenue.liveCount}</b> live</span>
            </div>

            <button type="button" className="map-panel__cta" onClick={() => onViewVenueMatches(activeVenue.stadiumName)}>
              View matches at this stadium
            </button>

            <div className="venue-timeline" aria-label="Venue match timeline">
              {panelMatches.length === 0 && (
                <p className="map-panel__empty" role="status">{panelEmptyMessage}</p>
              )}
              {panelMatches.map(match => {
                const status = matchStatus(match, nowMs);
                const score = matchScoreLabel(match);
                return (
                  <button key={match.key} type="button" className={`venue-timeline__item venue-timeline__item--${status}`} onClick={() => openMatch(match)}>
                    <span className="venue-timeline__dot" />
                    <span className="venue-timeline__stage">{stageShortLabel(match.stage)}</span>
                    <b>{match.homeTeam} vs {match.awayTeam}</b>
                    <small>{formatVenueTimelineTime(match.ts, activeVenue.timezone, match.local)}</small>
                    <span className="venue-timeline__status">
                      {status === "live" && <span className="lv">LIVE {match.fixture?.elapsed ? `${match.fixture.elapsed}'` : ""}</span>}
                      {status === "completed" && <span className="ft">FT</span>}
                      {score && status !== "upcoming" && <strong>{score}</strong>}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        )}
      </section>

      {selectedTeam !== "ALL" && journeyModel && (() => {
        const { stops, summary } = journeyModel;
        const accent = TEAM_PROFILES[selectedTeam]?.kitColors;
        const statusLabel = summary.status === "champion" ? "Champion"
          : summary.status === "eliminated" ? "Eliminated"
          : summary.status === "not-started" ? "Not started" : "Alive";
        return (
        <section
          className="tj"
          aria-label={`${selectedTeam} tournament travel path`}
          style={{ "--tj-accent": accent?.primary || "#f59e0b", "--tj-accent-2": accent?.secondary || "#fde68a" } as CSSProperties}
        >
          <header className="tj__head">
            <div>
              <span className="tj__eyebrow">Team Journey</span>
              <h3 className="tj__title">{data.flags[selectedTeam] || "⚽"} {selectedTeam}</h3>
            </div>
            <span className={`tj__status tj__status--${summary.status}`}>
              {summary.status === "champion" ? "🏆 " : ""}{statusLabel}
            </span>
          </header>

          {/* Journey summary strip — the story in five numbers */}
          <div className="tj__summary" role="group" aria-label="Journey summary">
            <div><b>{summary.citiesVisited}</b><span>{summary.citiesVisited === 1 ? "City" : "Cities"} visited</span></div>
            <div><b>{summary.totalDistanceKm.toLocaleString("en-US")}</b><span>km travelled</span></div>
            <div><b>{summary.matchesPlayed}</b><span>Played</span></div>
            <div><b>{stageShortLabel(summary.currentRound)}</b><span>Round</span></div>
            <div><b>{summary.nextVenue ? summary.nextVenue.city.split(" / ")[0] : summary.status === "alive" ? "TBD" : "—"}</b><span>Next stop</span></div>
          </div>

          {/* Route timeline: vertical on mobile, horizontal on desktop.
              Hovering a stop highlights its marker on the map above. */}
          <ol className="tj__line">
            {stops.map(stop => (
              <li
                key={stop.key}
                className={`tj-stop tj-stop--${stop.state}${stop.isNext ? " tj-stop--next" : ""}`}
                onMouseEnter={() => setHoverVenueId(stop.venue.venueId)}
                onMouseLeave={() => setHoverVenueId("")}
              >
                <span className="tj-stop__marker" aria-hidden="true">{stop.stopNumber}</span>
                <div className="tj-stop__card">
                  {stop.distanceFromPrevKm != null && (
                    <span className="tj-stop__distance">✈ {stop.distanceFromPrevKm.toLocaleString("en-US")} km</span>
                  )}
                  <div className="tj-stop__city">{stop.venue.city}</div>
                  {stop.isNext && <span className="tj-stop__next-tag">Next destination</span>}
                  {stop.matches.map(mm => {
                    const source = teamJourney.find(entry => entry.key === mm.key);
                    return (
                      <button
                        key={mm.key}
                        type="button"
                        className="tj-stop__match"
                        onClick={() => source && openMatch(source)}
                        aria-label={`Open match details: ${selectedTeam} vs ${mm.opponent}`}
                      >
                        <span className="tj-stop__stage">{stageShortLabel(mm.stage)}</span>
                        <b>vs {data.flags[mm.opponent] || ""} {mm.opponent}</b>
                        <small>{formatVenueLocalTime(mm.ts, stop.venue.timezone)}</small>
                        <em className={`tj-stop__badge tj-stop__badge--${mm.status}${mm.result ? ` tj-stop__badge--${mm.result}` : ""}`}>
                          {mm.status === "live" ? "LIVE" : mm.status === "completed" ? `${mm.result} ${mm.score}` : "Upcoming"}
                        </em>
                      </button>
                    );
                  })}
                  <details className="tj-stop__more">
                    <summary>Stadium details</summary>
                    <div className="tj-stop__venue-detail">
                      <VenueImage venueId={stop.venue.venueId} venueName={stop.venue.stadiumName} city={stop.venue.city} className="tj-stop__venue-image" />
                      <p>{stop.venue.stadiumName} · {stop.venue.country}{stop.venue.capacity ? ` · ${stop.venue.capacity.toLocaleString("en-US")} seats` : ""}</p>
                    </div>
                  </details>
                </div>
              </li>
            ))}
          </ol>

          {/* Story-driven footnotes per journey state */}
          {stops.length === 1 && summary.status !== "eliminated" && (
            <p className="tj__note">Journey just started — more stops will appear as the tournament progresses.</p>
          )}
          {summary.status === "eliminated" && summary.endedIn && (
            <p className="tj__note">Journey ended in {summary.endedIn.city} against {data.flags[summary.endedIn.opponent] || ""} {summary.endedIn.opponent}.</p>
          )}
          {summary.status === "champion" && (
            <p className="tj__note">The road ended with the trophy — champions of the 2026 World Cup.</p>
          )}
        </section>
        );
      })()}
      {selectedTeam !== "ALL" && !journeyModel && (
        <section className="tj tj--empty" aria-label={`${selectedTeam} tournament travel path`}>
          <header className="tj__head">
            <div>
              <span className="tj__eyebrow">Team Journey</span>
              <h3 className="tj__title">{data.flags[selectedTeam] || ""} {selectedTeam}</h3>
            </div>
          </header>
          <p className="tj__note">No travel path available for this filter.</p>
        </section>
      )}
    </section>
  );
}, (prev, next) =>
  prev.data === next.data &&
  prev.fixtures === next.fixtures &&
  prev.findLive === next.findLive &&
  prev.onMatchClick === next.onMatchClick &&
  prev.onViewVenueMatches === next.onViewVenueMatches &&
  prev.initialVenueId === next.initialVenueId &&
  // Minute granularity: map statuses don't need sub-minute time precision,
  // so nowMs ticks within the same minute skip the render entirely.
  Math.floor(prev.nowMs / 60000) === Math.floor(next.nowMs / 60000)
);

type SettingsModel = {
  defaultTeam: string;
  favoritePlayers: string[];
  favoriteStadiums: string[];
  defaultTournamentView: ViewType;
  defaultLandingPage: ViewType;
  matchCard: "Compact" | "Comfortable" | "Expanded";
  liveRefresh: "Auto" | "15 sec" | "30 sec" | "60 sec" | "Manual";
  scoreDisplay: "Goals only" | "Goals + Assists" | "Detailed stats";
  timeline: "Expanded" | "Collapsed";
  mapStyle: "Light" | "Dark" | "Terrain";
  mapCenter: "Favorite team" | "Current live venue" | "User location";
  rememberMap: boolean;
  theme: "Light" | "Dark" | "System";
  accent: "Official FIFA Blue" | "Green" | "Gold" | "Red" | "Minimal Gray";
  bracketTheme: "Classic" | "Broadcast" | "Modern" | "Minimal";
  animations: "Reduced" | "Normal" | "Enhanced";
  corners: "Compact" | "Medium" | "Large";
  fontSize: "Small" | "Default" | "Large" | "Extra Large";
  highContrast: boolean;
  dynamicType: boolean;
  flags: "Always" | "Minimal" | "Off";
  crests: boolean;
  language: string;
  timezone: string;
  dateFormat: string;
  temperature: "Fahrenheit" | "Celsius";
  distance: "Miles" | "Kilometers";
  currency: "USD" | "CAD" | "MXN";
  clock: "12-hour" | "24-hour";
  offlineMode: boolean;
  calendarScope: "Favorite Team" | "Knockout Stage" | "All Matches";
  reminder: "15 minutes" | "30 minutes" | "1 hour" | "2 hours";
  developerUnlocked: boolean;
  notifications: Record<string, boolean>;
  stadium: Record<string, boolean>;
  stats: Record<string, boolean>;
  downloads: Record<string, boolean>;
  pinnedStats: string[];
};

const SETTINGS_STORAGE_KEY = "compet-settings-v1";
const DEFAULT_SETTINGS: SettingsModel = {
  defaultTeam: "United States",
  favoritePlayers: [],
  favoriteStadiums: ["METLIFE"],
  defaultTournamentView: "schedule",
  defaultLandingPage: "home",
  matchCard: "Comfortable",
  liveRefresh: "Auto",
  scoreDisplay: "Goals + Assists",
  timeline: "Expanded",
  mapStyle: "Dark",
  mapCenter: "Favorite team",
  rememberMap: true,
  theme: "System",
  accent: "Gold",
  bracketTheme: "Broadcast",
  animations: "Normal",
  corners: "Medium",
  fontSize: "Default",
  highContrast: false,
  dynamicType: true,
  flags: "Always",
  crests: true,
  language: "English",
  timezone: "Device",
  dateFormat: "Jun 11, 2026",
  temperature: "Fahrenheit",
  distance: "Miles",
  currency: "USD",
  clock: "12-hour",
  offlineMode: false,
  calendarScope: "Favorite Team",
  reminder: "30 minutes",
  developerUnlocked: false,
  notifications: {
    "Match starting soon": true,
    Kickoff: true,
    Halftime: false,
    "Full Time": true,
    Goals: true,
    "Red Cards": true,
    Penalties: true,
    "Extra Time": true,
    "Penalty Shootouts": true,
    "VAR decisions": true,
    "Team advances": true,
    "Favorite team only": false,
    "Favorite player milestones": true,
    "Daily tournament recap": true,
    "Breaking FIFA news": false,
    "Injury updates": false,
    "Transfer-related news": false,
  },
  stadium: {
    "Show stadium capacity": true,
    "Show altitude": false,
    "Show weather": true,
    "Show city facts": true,
    "Show transportation": false,
    "Show travel distances": true,
    "Show local kickoff time": true,
  },
  stats: {
    Goals: true,
    Assists: true,
    xG: true,
    xA: false,
    Possession: true,
    Passing: true,
    Defensive: false,
    Goalkeeping: false,
    "Advanced Metrics": true,
    "Radar Charts": true,
    "Advanced Analytics": true,
    "Expected Goals": true,
    "Pressing Statistics": false,
    "Progressive Carries": false,
    "Shot Maps": true,
    "Passing Networks": false,
    "Heat Maps": true,
    "Player Comparison": true,
  },
  downloads: {
    "Entire Schedule": false,
    Bracket: false,
    "Team Data": false,
    "Player Photos": false,
    "Venue Images": false,
    "Offline Package": false,
  },
  pinnedStats: ["Goals", "Assists", "xG"],
};

function mergeSettings(raw: Partial<SettingsModel>): SettingsModel {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...raw,
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(raw.notifications || {}) },
    stadium: { ...DEFAULT_SETTINGS.stadium, ...(raw.stadium || {}) },
    stats: { ...DEFAULT_SETTINGS.stats, ...(raw.stats || {}) },
    downloads: { ...DEFAULT_SETTINGS.downloads, ...(raw.downloads || {}) },
  };
  // Retired options saved by older builds (e.g. the removed "Satellite"
  // map style) fall back to the default rather than leaking through.
  if (!["Light", "Dark", "Terrain"].includes(merged.mapStyle)) merged.mapStyle = DEFAULT_SETTINGS.mapStyle;
  return merged;
}

function SettingsView({ data, fixtures, leaderboardStats, liveTs, liveStatus, onNavigate, onTeamClick }: {
  data: TournamentData;
  fixtures: LiveFixture[];
  leaderboardStats: ExternalLeaderStat[];
  liveTs: number;
  liveStatus: LiveStatus;
  onNavigate: (view: ViewType) => void;
  onTeamClick: (team: string) => void;
}) {
  const [settings, setSettings] = useState<SettingsModel>(() => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;
    try {
      const saved = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      return saved ? mergeSettings(JSON.parse(saved)) : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [query, setQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>(["notifications", "map", "favorite team"]);
  const [quietHours, setQuietHours] = useState({ start: "22:00", end: "07:00" });

  useEffect(() => {
    try { window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore private mode */ }
  }, [settings]);

  const update = <K extends keyof SettingsModel>(key: K, value: SettingsModel[K]) => {
    if (key === "rememberMap" && value === false && typeof window !== "undefined") {
      try { window.localStorage.removeItem(MAP_STATE_KEY); } catch { /* ignore private mode */ }
    }
    setSettings(prev => ({ ...prev, [key]: value }));
  };
  const toggleGroup = (group: "notifications" | "stadium" | "stats" | "downloads", key: string) => {
    setSettings(prev => ({ ...prev, [group]: { ...prev[group], [key]: !prev[group][key] } }));
  };
  const toggleList = (key: "favoritePlayers" | "favoriteStadiums" | "pinnedStats", value: string) => {
    setSettings(prev => {
      const exists = prev[key].includes(value);
      return { ...prev, [key]: exists ? prev[key].filter(item => item !== value) : [...prev[key], value] };
    });
  };

  const allTeams = useMemo(() => Object.values(data.groups).flat().sort((a, b) => a.localeCompare(b)), [data.groups]);
  const tournamentStats = useMemo(() => buildTournamentStats(data, fixtures, { players: leaderboardStats }), [data, fixtures, leaderboardStats]);
  const playerOptions = useMemo(() => {
    const names = [...tournamentStats.topScorers, ...tournamentStats.topAssisters]
      .map(player => `${player.name} · ${player.team}`);
    return [...new Set(names)].slice(0, 12);
  }, [tournamentStats]);
  const venueOptions = useMemo(() => Object.entries(data.venues).map(([id, venue]) => ({ id, label: venue.common, meta: `${venue.city}, ${venue.country}` })), [data.venues]);
  const nextMatch = useMemo(() => [...data.gs, ...data.ko].filter(match => match.ts > Date.now()).sort((a, b) => a.ts - b.ts)[0] || null, [data.gs, data.ko]);
  const lastSync = liveTs ? new Date(liveTs).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Static schedule";
  const searchText = query.trim().toLowerCase();

  const rememberSearch = (value: string) => {
    const clean = value.trim();
    if (!clean) return;
    setRecentSearches(prev => [clean, ...prev.filter(item => item.toLowerCase() !== clean.toLowerCase())].slice(0, 4));
  };
  const handleShare = async (label = "Compet 2026") => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: label, text: "Track World Cup 2026 with Compet.", url: window.location.href });
      } catch { /* user cancelled */ }
    }
  };

  const SelectControl = <T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (value: T) => void; label: string }) => (
    <select className="settings-select" value={value} onChange={event => onChange(event.target.value as T)} aria-label={label}>
      {options.map(option => <option key={option} value={option}>{option}</option>)}
    </select>
  );
  const SegmentControl = <T extends string>({ value, options, onChange, label }: { value: T; options: readonly T[]; onChange: (value: T) => void; label: string }) => (
    <div className="settings-segment" role="group" aria-label={label}>
      {options.map(option => (
        <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>{option}</button>
      ))}
    </div>
  );
  const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) => (
    <button type="button" className="settings-switch" aria-pressed={checked} aria-label={label} onClick={onChange}><span /></button>
  );
  const StatusPill = ({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" }) => (
    <span className={`settings-pill settings-pill--${tone}`}>{children}</span>
  );
  const Row = ({ icon, title, subtitle, tags = [], children, action }: { icon: AppIconName; title: string; subtitle: string; tags?: string[]; children?: ReactNode; action?: () => void }) => {
    const haystack = [title, subtitle, ...tags].join(" ").toLowerCase();
    if (searchText && !haystack.includes(searchText)) return null;
    const body = (
      <>
        <span className="settings-row__icon"><AppIcon name={icon} /></span>
        <span className="settings-row__copy"><b>{title}</b><small>{subtitle}</small></span>
        <span className="settings-row__control">{children || <span className="settings-row__chevron">›</span>}</span>
      </>
    );
    return action ? <button type="button" className="settings-row" onClick={action}>{body}</button> : <div className="settings-row">{body}</div>;
  };
  const ChipChooser = ({ values, selected, onToggle }: { values: { key: string; label: string; meta?: string }[]; selected: string[]; onToggle: (key: string) => void }) => (
    <div className="settings-chip-grid">
      {values.map(item => (
        <button key={item.key} type="button" className="settings-choice-chip" aria-pressed={selected.includes(item.key)} onClick={() => onToggle(item.key)}>
          <b>{item.label}</b>{item.meta && <small>{item.meta}</small>}
        </button>
      ))}
    </div>
  );

  const sections: { title: string; icon: AppIconName; rows: ReactNode[] }[] = [
    { title: "Tournament", icon: "ball", rows: [
      <Row key="default-team" icon="teams" title="Default Team" subtitle="Personalizes Home, bracket highlights, schedule priority, and map journey." tags={["favorite national team"]}>
        <select className="settings-select" value={settings.defaultTeam} onChange={event => update("defaultTeam", event.target.value)} aria-label="Default team">
          {allTeams.map(team => <option key={team} value={team}>{data.flags[team] || ""} {team}</option>)}
        </select>
      </Row>,
      <Row key="fav-players" icon="boot" title="Favorite Players" subtitle="Follow milestones and highlight players across stats, cards, and match details." tags={["players milestones"]}>
        <ChipChooser values={playerOptions.map(player => ({ key: player, label: player }))} selected={settings.favoritePlayers} onToggle={key => toggleList("favoritePlayers", key)} />
      </Row>,
      <Row key="default-view" icon="calendar" title="Default Tournament View" subtitle="Choose the tournament workspace you prefer when browsing." tags={["schedule bracket home stats"]}>
        <SegmentControl value={settings.defaultTournamentView} options={["schedule", "bracket", "home", "stats"] as const} label="Default tournament view" onChange={value => update("defaultTournamentView", value)} />
      </Row>,
      <Row key="landing" icon="home" title="Default Landing Page" subtitle="Controls which main tab opens first on launch." tags={["landing page tab"]}>
        <select className="settings-select" value={settings.defaultLandingPage} onChange={event => update("defaultLandingPage", event.target.value as ViewType)} aria-label="Default landing page">
          {(["home", "schedule", "groups", "bracket", "teams", "map", "stats", "more"] as ViewType[]).map(view => <option key={view} value={view}>{view[0].toUpperCase() + view.slice(1)}</option>)}
        </select>
      </Row>,
    ] },
    { title: "Notifications", icon: "bell", rows: [
      ...Object.keys(settings.notifications).map(label => (
        <Row key={label} icon="bell" title={label} subtitle={label === "Favorite team only" ? `Limit alerts to ${settings.defaultTeam}.` : "Granular match and tournament alert control."} tags={["alerts push notifications live"]}>
          <Toggle checked={settings.notifications[label]} label={label} onChange={() => toggleGroup("notifications", label)} />
        </Row>
      )),
      <Row key="quiet" icon="settings" title="Quiet Hours" subtitle="Silence non-critical alerts while preserving live match status." tags={["do not disturb quiet hours"]}>
        <span className="settings-time-pair"><input value={quietHours.start} onChange={event => setQuietHours(prev => ({ ...prev, start: event.target.value }))} aria-label="Quiet hours start" /><input value={quietHours.end} onChange={event => setQuietHours(prev => ({ ...prev, end: event.target.value }))} aria-label="Quiet hours end" /></span>
      </Row>,
    ] },
    { title: "Match Experience", icon: "calendar", rows: [
      <Row key="card" icon="calendar" title="Preferred Match Card" subtitle="Controls schedule density and how much live context appears at a glance." tags={["compact comfortable expanded"]}>
        <SegmentControl value={settings.matchCard} options={["Compact", "Comfortable", "Expanded"] as const} label="Preferred match card" onChange={value => update("matchCard", value)} />
      </Row>,
      <Row key="refresh" icon="settings" title="Live Match Refresh" subtitle="Balances live score freshness with battery and data usage." tags={["auto 15 30 60 manual"]}>
        <SelectControl value={settings.liveRefresh} options={["Auto", "15 sec", "30 sec", "60 sec", "Manual"] as const} label="Live match refresh" onChange={value => update("liveRefresh", value)} />
      </Row>,
      <Row key="score" icon="stats" title="Default Score Display" subtitle="Choose whether player contributions and detailed stats appear by default." tags={["goals assists detailed stats"]}>
        <SelectControl value={settings.scoreDisplay} options={["Goals only", "Goals + Assists", "Detailed stats"] as const} label="Default score display" onChange={value => update("scoreDisplay", value)} />
      </Row>,
      <Row key="timeline" icon="more" title="Match Timeline" subtitle="Sets event timelines to open expanded or condensed in match details." tags={["expanded collapsed"]}>
        <SegmentControl value={settings.timeline} options={["Expanded", "Collapsed"] as const} label="Match timeline" onChange={value => update("timeline", value)} />
      </Row>,
    ] },
    { title: "Map", icon: "map", rows: [
      <Row key="map-style" icon="map" title="Default Map Style" subtitle="Sets the visual style for the host city map." tags={["light dark terrain"]}>
        <SegmentControl value={settings.mapStyle} options={["Light", "Dark", "Terrain"] as const} label="Map style" onChange={value => update("mapStyle", value)} />
      </Row>,
      <Row key="map-center" icon="venue" title="Automatically Center On" subtitle={settings.mapCenter === "User location" ? "Uses your location only if permission is already granted." : "Choose the map context that should take priority when opening Map."} tags={["favorite team live venue user location"]}>
        <SelectControl value={settings.mapCenter} options={["Favorite team", "Current live venue", "User location"] as const} label="Automatically center map" onChange={value => update("mapCenter", value)} />
      </Row>,
      <Row key="remember-map" icon="settings" title="Remember Last Viewed Location" subtitle="Restores your previous map position, zoom, and selected venue." tags={["remember location map"]}>
        <Toggle checked={settings.rememberMap} label="Remember last viewed map location" onChange={() => update("rememberMap", !settings.rememberMap)} />
      </Row>,
    ] },
    { title: "Stadium Experience", icon: "venue", rows: Object.keys(settings.stadium).map(label => (
      <Row key={label} icon="venue" title={label} subtitle="Controls venue cards, match detail panels, and map stadium sheets." tags={["stadium venue city travel local kickoff"]}>
        <Toggle checked={settings.stadium[label]} label={label} onChange={() => toggleGroup("stadium", label)} />
      </Row>
    )) },
    { title: "Statistics", icon: "stats", rows: [
      <Row key="pinned" icon="stats" title="Pinned Statistics" subtitle="Choose the stats that appear first in leaders and team dashboards." tags={["goals assists xg possession passing"]}>
        <ChipChooser values={["Goals", "Assists", "xG", "xA", "Possession", "Passing", "Defensive", "Goalkeeping"].map(key => ({ key, label: key }))} selected={settings.pinnedStats} onToggle={key => toggleList("pinnedStats", key)} />
      </Row>,
      ...Object.keys(settings.stats).map(label => (
        <Row key={label} icon="stats" title={label} subtitle="Enable this metric family across team pages, stats, and match analysis." tags={["analytics xg shot maps radar heat maps comparison"]}>
          <Toggle checked={settings.stats[label]} label={label} onChange={() => toggleGroup("stats", label)} />
        </Row>
      )),
    ] },
    { title: "Appearance", icon: "settings", rows: [
      <Row key="theme" icon="settings" title="Theme" subtitle="Choose light, dark, or system appearance." tags={["light dark system"]}><SegmentControl value={settings.theme} options={["Light", "Dark", "System"] as const} label="Theme" onChange={value => update("theme", value)} /></Row>,
      <Row key="accent" icon="ball" title="Accent Color" subtitle="Tune the app’s highlight color while keeping the World Cup look." tags={["blue green gold red gray"]}><SelectControl value={settings.accent} options={["Official FIFA Blue", "Green", "Gold", "Red", "Minimal Gray"] as const} label="Accent color" onChange={value => update("accent", value)} /></Row>,
      <Row key="bracket-theme" icon="bracket" title="Bracket Theme" subtitle="Controls knockout bracket density, contrast, and broadcast polish." tags={["classic broadcast modern minimal"]}><SegmentControl value={settings.bracketTheme} options={["Classic", "Broadcast", "Modern", "Minimal"] as const} label="Bracket theme" onChange={value => update("bracketTheme", value)} /></Row>,
      <Row key="animations" icon="settings" title="Animations" subtitle="Adjust motion for comfort, performance, or a richer matchday feel." tags={["reduced normal enhanced"]}><SegmentControl value={settings.animations} options={["Reduced", "Normal", "Enhanced"] as const} label="Animations" onChange={value => update("animations", value)} /></Row>,
      <Row key="corners" icon="settings" title="Rounded Corners" subtitle="Changes the softness of cards, sheets, and controls." tags={["compact medium large"]}><SegmentControl value={settings.corners} options={["Compact", "Medium", "Large"] as const} label="Rounded corners" onChange={value => update("corners", value)} /></Row>,
    ] },
    { title: "Display", icon: "info", rows: [
      <Row key="font" icon="info" title="Font Size" subtitle="Sets the default reading size for cards, tables, and timelines." tags={["small default large extra"]}><SelectControl value={settings.fontSize} options={["Small", "Default", "Large", "Extra Large"] as const} label="Font size" onChange={value => update("fontSize", value)} /></Row>,
      <Row key="contrast" icon="info" title="High Contrast" subtitle="Boosts borders and text contrast for better readability." tags={["accessibility contrast"]}><Toggle checked={settings.highContrast} label="High contrast" onChange={() => update("highContrast", !settings.highContrast)} /></Row>,
      <Row key="dynamic" icon="info" title="Dynamic Type" subtitle="Allows the interface to respect larger system text preferences." tags={["accessibility dynamic type"]}><Toggle checked={settings.dynamicType} label="Dynamic type" onChange={() => update("dynamicType", !settings.dynamicType)} /></Row>,
      <Row key="flags" icon="teams" title="Country Flags" subtitle="Controls how often flags appear beside teams and players." tags={["flags minimal off"]}><SegmentControl value={settings.flags} options={["Always", "Minimal", "Off"] as const} label="Country flags" onChange={value => update("flags", value)} /></Row>,
      <Row key="crests" icon="teams" title="Show National Crests" subtitle="Displays federation marks where official assets are available." tags={["crests teams"]}><Toggle checked={settings.crests} label="Show national crests" onChange={() => update("crests", !settings.crests)} /></Row>,
    ] },
    { title: "Regional", icon: "more", rows: [
      <Row key="language" icon="more" title="Language" subtitle="Sets app copy, match labels, and tournament glossary language." tags={["language"]}><SelectControl value={settings.language} options={["English", "Spanish", "French"] as const} label="Language" onChange={value => update("language", value)} /></Row>,
      <Row key="timezone" icon="calendar" title="Time Zone" subtitle="Controls kickoff times across schedules, map, and calendar exports." tags={["timezone time zone"]}><SelectControl value={settings.timezone} options={["Device", "Eastern", "Central", "Mountain", "Pacific", "Venue local"] as const} label="Time zone" onChange={value => update("timezone", value)} /></Row>,
      <Row key="date" icon="calendar" title="Date Format" subtitle="Applies to match cards, tournament timeline, and exports." tags={["date format"]}><SelectControl value={settings.dateFormat} options={["Jun 11, 2026", "11 Jun 2026", "2026-06-11"] as const} label="Date format" onChange={value => update("dateFormat", value)} /></Row>,
      <Row key="units" icon="settings" title="Units" subtitle="Temperature, distance, currency, and clock display." tags={["temperature distance currency clock"]}>
        <span className="settings-inline-selects">
          <SelectControl value={settings.temperature} options={["Fahrenheit", "Celsius"] as const} label="Temperature" onChange={value => update("temperature", value)} />
          <SelectControl value={settings.distance} options={["Miles", "Kilometers"] as const} label="Distance" onChange={value => update("distance", value)} />
          <SelectControl value={settings.currency} options={["USD", "CAD", "MXN"] as const} label="Currency" onChange={value => update("currency", value)} />
          <SelectControl value={settings.clock} options={["12-hour", "24-hour"] as const} label="Clock" onChange={value => update("clock", value)} />
        </span>
      </Row>,
    ] },
    { title: "Data & Sync", icon: "settings", rows: [
      <Row key="source" icon="settings" title="Current Data Source" subtitle="Live API when available, bundled static tournament schedule as fallback." tags={["api data source"]}><StatusPill tone={liveStatus === "active" ? "good" : "warn"}>{liveStatus === "active" ? "Live API" : "Static fallback"}</StatusPill></Row>,
      <Row key="sync" icon="calendar" title="Last Successful Sync" subtitle={`Last live timestamp: ${lastSync}. Cache refreshes automatically during active tournament use.`} tags={["sync update cache"]}><StatusPill>{fixtures.length} fixtures</StatusPill></Row>,
      <Row key="cache" icon="settings" title="Cache & Offline Mode" subtitle={`Local cache stores live scores briefly; offline mode is ${settings.offlineMode ? "enabled" : "disabled"}.`} tags={["cache offline storage"]}><Toggle checked={settings.offlineMode} label="Offline mode" onChange={() => update("offlineMode", !settings.offlineMode)} /></Row>,
      <Row key="refresh" icon="settings" title="Force Refresh" subtitle="Requests fresh match, standings, stats, and live-feed state." tags={["force refresh rebuild cache api"]}><button type="button" className="settings-action">Refresh</button></Row>,
      <Row key="health" icon="info" title="API Status & Connection Health" subtitle="Connection health is monitored from live feed success, stale status, and fixture count." tags={["api status health"]}><StatusPill tone={liveStatus === "active" ? "good" : "warn"}>{liveStatus === "active" ? "Healthy" : "Monitoring"}</StatusPill></Row>,
    ] },
    { title: "Downloads", icon: "share", rows: [
      <Row key="download-summary" icon="share" title="Storage Used" subtitle="Downloaded assets remain removable, and missing files fall back to live data." tags={["downloads clear storage"]}><StatusPill>{Object.values(settings.downloads).filter(Boolean).length} packs</StatusPill></Row>,
      ...Object.keys(settings.downloads).map(label => (
        <Row key={label} icon="share" title={`Download ${label}`} subtitle="Prepare this tournament package for offline access." tags={["download offline package schedule bracket team photos venue images"]}>
          <button type="button" className="settings-action" onClick={() => toggleGroup("downloads", label)}>{settings.downloads[label] ? "Clear" : "Download"}</button>
        </Row>
      )),
    ] },
    { title: "Favorites", icon: "teams", rows: [
      <Row key="fav-teams" icon="teams" title="Favorite Teams" subtitle={`${settings.defaultTeam} is your default team; tap to open its profile.`} tags={["favorite teams"]} action={() => onTeamClick(settings.defaultTeam)}><span className="settings-row__chevron">›</span></Row>,
      <Row key="fav-stadiums" icon="venue" title="Favorite Stadiums" subtitle="Prioritize venue timelines, maps, and city travel cards." tags={["favorite stadiums cities"]}>
        <ChipChooser values={venueOptions.map(v => ({ key: v.id, label: v.label, meta: v.meta }))} selected={settings.favoriteStadiums} onToggle={key => toggleList("favoriteStadiums", key)} />
      </Row>,
      <Row key="fav-matches" icon="calendar" title="Favorite Matches" subtitle={nextMatch ? `Next suggested pin: ${"t1" in nextMatch ? `${nextMatch.t1} vs ${nextMatch.t2}` : nextMatch.round}.` : "Favorite matches appear first in calendar and alerts."} tags={["favorite matches cities pinned statistics"]}><StatusPill>{settings.pinnedStats.length} pinned stats</StatusPill></Row>,
    ] },
    { title: "Calendar", icon: "calendar", rows: [
      <Row key="calendar-scope" icon="calendar" title="Automatically Add Matches" subtitle="Creates calendar-ready match entries using your tournament preference." tags={["calendar add matches favorite knockout all"]}><SegmentControl value={settings.calendarScope} options={["Favorite Team", "Knockout Stage", "All Matches"] as const} label="Calendar scope" onChange={value => update("calendarScope", value)} /></Row>,
      <Row key="reminder" icon="bell" title="Reminders" subtitle="Default pre-match reminder for calendar exports and match alerts." tags={["15 30 1 hour 2 hours reminder"]}><SelectControl value={settings.reminder} options={["15 minutes", "30 minutes", "1 hour", "2 hours"] as const} label="Reminder" onChange={value => update("reminder", value)} /></Row>,
    ] },
    { title: "Sharing", icon: "share", rows: ["Bracket", "Player Card", "Match Card", "Team Stats", "Tournament Stats", "Custom Graphics"].map(label => (
      <Row key={label} icon="share" title={`Share ${label}`} subtitle="Generate a polished share card for social, messages, or notes." tags={["share graphics bracket player match team stats"]}>
        <button type="button" className="settings-action" onClick={() => handleShare(label)}>Share</button>
      </Row>
    )) },
    { title: "Achievements", icon: "ball", rows: [
      ["Watched 25 matches", `${Math.min(fixtures.filter(f => DONE_STATUSES.has(f.status)).length, 25)}/25 complete`],
      ["Predicted 20 winners", "Prediction center ready for bracket mode"],
      ["Visited every host city", `${settings.favoriteStadiums.length}/16 favorite venues saved`],
      ["Completed every bracket", "Knockout path tools enabled"],
      ["Followed entire tournament", `${Object.values(settings.notifications).filter(Boolean).length} alert types active`],
    ].map(([title, subtitle]) => <Row key={title} icon="ball" title={title} subtitle={subtitle} tags={["achievement milestone"]}><StatusPill>{subtitle.includes("/") ? subtitle.split(" ")[0] : "Ready"}</StatusPill></Row>) },
    { title: "About the Tournament", icon: "info", rows: ["History", "Format", "Qualification", "Host Cities", "Stadiums", "Official Match Ball", "Mascot", "Official Song", "Records", "Golden Ball History", "Golden Boot History", "Past Champions"].map(label => (
      <Row key={label} icon="info" title={label} subtitle="Open tournament reference material curated for World Cup 2026." tags={["about tournament history format records champions"]} action={() => onNavigate(label === "Host Cities" || label === "Stadiums" ? "more" : "about")}><span className="settings-row__chevron">›</span></Row>
    )) },
    { title: "App Information", icon: "settings", rows: [
      <Row key="version" icon="settings" title="Version" subtitle="Compet 2026 app build." tags={["version build"]}><StatusPill>v1.0.0</StatusPill></Row>,
      <Row key="data-version" icon="settings" title="Data Version" subtitle={`${data.gs.length + data.ko.length} canonical matches, ${Object.keys(data.venues).length} venues, ${allTeams.length} teams.`} tags={["data api repository license credits"]}><StatusPill>2026.1</StatusPill></Row>,
      <Row key="repo" icon="share" title="Repository" subtitle="Open the project source and implementation history." tags={["repository open source"]}><button type="button" className="settings-action" onClick={() => window.open("https://github.com/jsaintfleur/wc2026", "_blank", "noopener,noreferrer")}>Open</button></Row>,
      <Row key="legal" icon="info" title="License, Privacy, Terms, Credits" subtitle="App information, open-source licenses, privacy policy, and usage terms." tags={["license privacy terms credits"]} action={() => onNavigate("about")}><span className="settings-row__chevron">›</span></Row>,
    ] },
    { title: "Developer", icon: "settings", rows: [
      <Row key="unlock" icon="settings" title="Developer Console" subtitle="Hidden tools for feed inspection, performance, logs, and demo data." tags={["developer debug api inspector cache performance fps logs"]}>
        <button type="button" className="settings-action" onClick={() => update("developerUnlocked", !settings.developerUnlocked)}>{settings.developerUnlocked ? "Hide" : "Unlock"}</button>
      </Row>,
      ...(settings.developerUnlocked ? ["Debug Mode", "API Inspector", "Cache Inspector", "Live Feed Inspector", "Performance Monitor", "FPS Counter", "Network Requests", "Reset Demo Data", "Export Logs"].map(label => (
        <Row key={label} icon="settings" title={label} subtitle="Developer-only diagnostic control for tournament data and UI performance." tags={["developer debug inspector performance logs"]}><StatusPill>Ready</StatusPill></Row>
      )) : []),
    ] },
    { title: "Support", icon: "info", rows: ["FAQ", "Contact Support", "Report Bug", "Suggest Feature", "Rate App", "Join Beta"].map(label => (
      <Row key={label} icon="info" title={label} subtitle="Get help, send feedback, or join future Compet test flights." tags={["support faq bug feature beta rate"]}><button type="button" className="settings-action" onClick={() => handleShare(label)}>{label === "Report Bug" ? "Report" : label === "Suggest Feature" ? "Suggest" : "Open"}</button></Row>
    )) },
  ];

  const visibleSections = sections.map(section => ({ ...section, rows: section.rows.filter(Boolean) })).filter(section => section.rows.length > 0);

  return (
    <main className="settings-view" aria-label="Settings">
      <section className="settings-hero">
        <div>
          <span className="settings-eyebrow">Control Center</span>
          <h2>Settings</h2>
          <p>Personalize the tournament around your team, alerts, match cards, map, stats, regional preferences, downloads, and data health.</p>
        </div>
        <div className="settings-hero__stats" aria-label="Settings summary">
          <span><b>{data.flags[settings.defaultTeam] || "•"}</b><small>{settings.defaultTeam}</small></span>
          <span><b>{Object.values(settings.notifications).filter(Boolean).length}</b><small>alerts on</small></span>
          <span><b>{Object.values(settings.downloads).filter(Boolean).length}</b><small>offline packs</small></span>
        </div>
      </section>

      <section className="settings-search-card" aria-label="Search settings">
        <label className="settings-search">
          <AppIcon name="settings" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            onBlur={event => rememberSearch(event.target.value)}
            placeholder="Search Settings"
            aria-label="Search Settings"
          />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear settings search">×</button>}
        </label>
        <div className="settings-recent" aria-label="Recent settings searches">
          <span>Recent</span>
          {recentSearches.map(item => <button key={item} type="button" onClick={() => setQuery(item)}>{item}</button>)}
        </div>
      </section>

      <section className="settings-favorites" aria-label="Favorite settings">
        <button type="button" onClick={() => onNavigate(settings.defaultTournamentView)}><AppIcon name="home" /><b>Open default view</b><small>{settings.defaultTournamentView}</small></button>
        <button type="button" onClick={() => onTeamClick(settings.defaultTeam)}><AppIcon name="teams" /><b>Favorite team</b><small>{settings.defaultTeam}</small></button>
        <button type="button" onClick={() => onNavigate("map")}><AppIcon name="map" /><b>Map focus</b><small>{settings.mapCenter}</small></button>
        <button type="button" onClick={() => setQuery("notifications")}><AppIcon name="bell" /><b>Alerts</b><small>{Object.values(settings.notifications).filter(Boolean)} enabled</small></button>
      </section>

      {visibleSections.map(section => (
        <section key={section.title} className="settings-section">
          <div className="settings-section__heading">
            <span><AppIcon name={section.icon} /></span>
            <h3>{section.title}</h3>
            <small>{section.rows.length}</small>
          </div>
          <div className="settings-card">{section.rows}</div>
        </section>
      ))}
    </main>
  );
}

type Confederation = "UEFA" | "CONMEBOL" | "CONCACAF" | "CAF" | "AFC" | "OFC";
type AnalyticsTab = "teams" | "confederations" | "remaining" | "matchups";
type AnalyticsSort = "overall" | "attack" | "defense" | "form" | "goals" | "confederation";

const CONFEDERATIONS: Confederation[] = ["UEFA", "CONMEBOL", "CONCACAF", "CAF", "AFC", "OFC"];

/* Confederation assignment is the one static team metadata layer the
   analytics model needs. The actual results, survival, next matches, and
   strength scores are derived from the canonical schedule + live overlay. */
const TEAM_CONFEDERATION: Record<string, Confederation> = {
  Mexico: "CONCACAF",
  "South Africa": "CAF",
  "South Korea": "AFC",
  Czechia: "UEFA",
  Canada: "CONCACAF",
  "Bosnia & Herzegovina": "UEFA",
  Qatar: "AFC",
  Switzerland: "UEFA",
  Brazil: "CONMEBOL",
  Morocco: "CAF",
  Haiti: "CONCACAF",
  Scotland: "UEFA",
  "United States": "CONCACAF",
  Paraguay: "CONMEBOL",
  Australia: "AFC",
  Türkiye: "UEFA",
  Germany: "UEFA",
  Curaçao: "CONCACAF",
  "Ivory Coast": "CAF",
  Ecuador: "CONMEBOL",
  Netherlands: "UEFA",
  Japan: "AFC",
  Sweden: "UEFA",
  Tunisia: "CAF",
  Belgium: "UEFA",
  Egypt: "CAF",
  Iran: "AFC",
  "New Zealand": "OFC",
  Spain: "UEFA",
  "Cape Verde": "CAF",
  "Saudi Arabia": "AFC",
  Uruguay: "CONMEBOL",
  France: "UEFA",
  Senegal: "CAF",
  Iraq: "AFC",
  Norway: "UEFA",
  Argentina: "CONMEBOL",
  Algeria: "CAF",
  Austria: "UEFA",
  Jordan: "AFC",
  Portugal: "UEFA",
  "DR Congo": "CAF",
  Uzbekistan: "AFC",
  Colombia: "CONMEBOL",
  England: "UEFA",
  Croatia: "UEFA",
  Ghana: "CAF",
  Panama: "CONCACAF",
};

type AnalyticsMatch = {
  key: string;
  stage: string;
  ts: number;
  home: string;
  away: string;
  sourceMatch: GroupStageMatch;
  status: "completed" | "live" | "upcoming";
  gh: number | null;
  ga: number | null;
  fixture: LiveFixture | null;
  sourceStats?: MatchStats;
};

type TeamAnalytics = {
  team: string;
  confederation: Confederation;
  score: number;
  scoreComponents: {
    results: number;
    goalDifference: number;
    attack: number;
    defense: number;
    path: number;
  };
  modelSummary: string;
  attack: number;
  defense: number;
  form: number;
  pathDifficulty: number;
  tier: "Elite" | "Contender" | "Dark Horse" | "Vulnerable" | "Eliminated";
  trend: "up" | "flat" | "down";
  formString: string;
  scoreDelta: number | null;
  alive: boolean;
  eliminated: boolean;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  cleanSheets: number;
  shots: number | null;
  shotsOn: number | null;
  possession: number | null;
  xg: number | null;
  xga: number | null;
  nextOpponent: string;
  nextMatchDate: string;
  currentRound: string;
  pathStatus: string;
  matches: { label: string; opponent: string; gf: number; ga: number; result: "W" | "D" | "L"; ts: number }[];
};

type ConfederationAnalytics = {
  confederation: Confederation;
  qualified: number;
  remaining: number;
  eliminated: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  knockoutTeams: number;
  quarterfinalists: number;
  semifinalists: number;
  finalists: number;
  winPct: number;
  pointsPerMatch: number;
  avgStrength: number;
  bestTeam: TeamAnalytics | null;
  disappointment: TeamAnalytics | null;
  survivalRate: number;
};

type AnalyticsModel = {
  modelQuality: "Advanced" | "Standard" | "Basic";
  teams: TeamAnalytics[];
  confederations: ConfederationAnalytics[];
  remainingByConfed: Record<Confederation, TeamAnalytics[]>;
  comparisonCards: { label: string; value: string; detail: string }[];
  matchups: { key: string; stage: string; date: string; kickoff: string; venue: string; match: GroupStageMatch; fixture: LiveFixture | null; home: TeamAnalytics; away: TeamAnalytics; leanHome: number; leanAway: number; upsetPotential: number; difficulty: string }[];
  strongestTeam: TeamAnalytics;
  bestAttack: TeamAnalytics;
  bestDefense: TeamAnalytics;
  strongestConfed: ConfederationAnalytics;
};

function analyticsConfederation(team: string): Confederation {
  return TEAM_CONFEDERATION[canon(team)] || "UEFA";
}

function numericStat(stats: MatchStats | undefined, side: "home" | "away", key: string): number | null {
  const raw = stats?.[side]?.[key];
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const parsed = parseFloat(raw.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function analyticsScorePct(value: number, max: number): number {
  if (!max) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

function analyticsTier(score: number, alive: boolean): TeamAnalytics["tier"] {
  if (!alive) return "Eliminated";
  if (score >= 82) return "Elite";
  if (score >= 68) return "Contender";
  if (score >= 54) return "Dark Horse";
  return "Vulnerable";
}

function shortDate(ts: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(ts));
}

function analyticsBand(value: number, label: string): string {
  if (value >= 82) return `elite ${label} (${value})`;
  if (value >= 65) return `strong ${label} (${value})`;
  if (value >= 45) return `average ${label} (${value})`;
  return `limited ${label} (${value})`;
}

function analyticsPathText(value: number): string {
  if (value >= 72) return "manageable projected path";
  if (value >= 48) return "balanced projected path";
  return "difficult projected path";
}

function analyticsScoreFromMatches(
  matches: TeamAnalytics["matches"],
  maxGF: number,
  maxGD: number,
  maxPPG: number,
  pathDifficulty: number,
): number {
  const played = matches.length;
  if (!played) return Math.round(pathDifficulty * 0.1);
  const wins = matches.filter(match => match.result === "W").length;
  const draws = matches.filter(match => match.result === "D").length;
  const gf = matches.reduce((sum, match) => sum + match.gf, 0);
  const ga = matches.reduce((sum, match) => sum + match.ga, 0);
  const cleanSheets = matches.filter(match => match.ga === 0).length;
  const ppg = (wins * 3 + draws) / played;
  const resultScore = analyticsScorePct(ppg, maxPPG);
  const gdScore = analyticsScorePct(gf - ga + 8, maxGD);
  const attack = analyticsScorePct(gf, maxGF);
  const defense = Math.max(0, 100 - analyticsScorePct(ga, Math.max(1, played * 3))) * 0.75 + analyticsScorePct(cleanSheets, played) * 0.25;
  return Math.round(resultScore * 0.3 + gdScore * 0.2 + attack * 0.2 + defense * 0.2 + pathDifficulty * 0.1);
}

/* Assembles the full tournament match list with resolved participants —
 * group matches from the schedule (live fixture or persisted DB result),
 * knockout matches through the shared bracket builder so ties whose
 * fixtures the vendor has not published still carry their known teams.
 * This is the canonical input for team records, analytics, and the
 * dev-mode integrity audit — one gathering path, no per-view drift. */
function buildAnalyticsMatches(
  data: TournamentData,
  fixtures: LiveFixture[],
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null,
  nowMs: number,
): AnalyticsMatch[] {
  const matches: AnalyticsMatch[] = [];
  for (const m of data.gs) {
    const fixture = findLive({ ts: m.ts, v: m.v, t1: m.t1, t2: m.t2 }, fixtures);
    const stale = (fixture && isStaleStatus(m.ts, fixture.status, nowMs)) || (!fixture && m.dbStatus && isStaleStatus(m.ts, m.dbStatus, nowMs));
    const done = !stale && ((fixture && DONE_STATUSES.has(fixture.status)) || (m.dbStatus && DONE_STATUSES.has(m.dbStatus) && m.dbGh != null && m.dbGa != null));
    const live = !stale && !!fixture && LIVE_STATUSES.has(fixture.status);
    matches.push({
      key: `gs-${m.no}`,
      stage: "Group Stage",
      ts: m.ts,
      home: canon(m.t1),
      away: canon(m.t2),
      sourceMatch: m,
      status: done ? "completed" : live ? "live" : "upcoming",
      gh: done ? (fixture?.gh ?? m.dbGh ?? null) : null,
      ga: done ? (fixture?.ga ?? m.dbGa ?? null) : null,
      fixture,
      sourceStats: fixture?.stats || m.dbStats,
    });
  }
  for (const card of buildKnockoutCards(data, fixtures, findLive, nowMs)) {
    const [teamA, teamB] = card.teams;
    const home = teamA.placeholder ? "TBD" : teamA.name;
    const away = teamB.placeholder ? "TBD" : teamB.name;
    const done = card.isDone && card.fixture?.gh != null && card.fixture?.ga != null;
    matches.push({
      key: `ko-${card.matchNo}`,
      stage: card.match.round,
      ts: card.match.ts,
      home,
      away,
      sourceMatch: {
        no: card.matchNo,
        iso: card.match.iso,
        local: card.match.local,
        et: card.match.et,
        g: "KO",
        t1: home,
        t2: away,
        v: card.match.v,
        ts: card.match.ts,
      },
      status: done ? "completed" : card.isLive ? "live" : "upcoming",
      gh: done ? card.fixture!.gh : null,
      ga: done ? card.fixture!.ga : null,
      fixture: card.fixture,
      sourceStats: card.fixture?.stats,
    });
  }
  return matches.sort((a, b) => a.ts - b.ts);
}

function buildAnalyticsModel(
  data: TournamentData,
  fixtures: LiveFixture[],
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null,
  nowMs: number,
): AnalyticsModel {
  const allTeams = Object.values(data.groups).flat().map(canon);
  const byTeam = new Map<string, TeamAnalytics>();
  for (const team of allTeams) {
    byTeam.set(team, {
      team,
      confederation: analyticsConfederation(team),
      score: 0,
      scoreComponents: { results: 0, goalDifference: 0, attack: 0, defense: 0, path: 0 },
      modelSummary: "No completed matches yet. Baseline scores will move as verified results arrive.",
      attack: 0,
      defense: 0,
      form: 0,
      pathDifficulty: 0,
      tier: "Vulnerable",
      trend: "flat",
      formString: "No results",
      scoreDelta: null,
      alive: true,
      eliminated: false,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      cleanSheets: 0,
      shots: null,
      shotsOn: null,
      possession: null,
      xg: null,
      xga: null,
      nextOpponent: "TBD",
      nextMatchDate: "TBD",
      currentRound: "Group Stage",
      pathStatus: "Awaiting next confirmed match",
      matches: [],
    });
  }

  const matches = buildAnalyticsMatches(data, fixtures, findLive, nowMs);

  /* Group qualification signals for elimination — computed before records
     so the canonical engine can distinguish group exits from pending draws */
  const standingsByGroup = Object.fromEntries(Object.keys(data.groups).map(g => [g, completedGroupStanding(g, data, fixtures, findLive, nowMs)]));
  const allGroupsComplete = Object.values(standingsByGroup).every(standing => standing.complete);
  const groupQualifiers = new Set<string>();
  for (const standing of Object.values(standingsByGroup)) {
    if (!standing.complete) continue;
    standing.rows.slice(0, 2).forEach(row => groupQualifiers.add(row.t));
  }
  const third = rankThirdPlaceTeams(standingsByGroup);
  if (third.allComplete) third.qualified.forEach(entry => groupQualifiers.add(entry.row.t));

  /* Canonical per-team records (lib/team-records) carry every counting
     stat and the alive/eliminated status — including penalty-shootout
     eliminations, which a raw score comparison misses. Analytics only
     layers its model scores on top; it never re-counts. */
  const teamRecords = buildTeamRecords(
    allTeams,
    matches.map(mm => ({
      key: mm.key, stage: mm.stage, ts: mm.ts, home: mm.home, away: mm.away,
      status: mm.status, gh: mm.gh, ga: mm.ga,
      penHome: mm.fixture?.penHome ?? null, penAway: mm.fixture?.penAway ?? null,
    })),
    { allGroupsComplete, groupQualifiers },
  );

  /* Per-match extras the record engine doesn't track: shot/possession
     aggregates and the per-team match history used by form and trends. */
  const playedSoFar = new Map<string, number>();
  for (const match of matches) {
    if (match.status !== "completed" || match.gh == null || match.ga == null) continue;
    const home = byTeam.get(match.home);
    const away = byTeam.get(match.away);
    if (!home || !away) continue;
    const applyExtras = (team: TeamAnalytics, opponent: TeamAnalytics, gf: number, ga: number, side: "home" | "away") => {
      const counted = (playedSoFar.get(team.team) || 0) + 1;
      playedSoFar.set(team.team, counted);
      const shots = numericStat(match.sourceStats, side, "Total Shots");
      const shotsOn = numericStat(match.sourceStats, side, "Shots on Goal");
      const possession = numericStat(match.sourceStats, side, "Ball Possession");
      if (shots != null) team.shots = (team.shots || 0) + shots;
      if (shotsOn != null) team.shotsOn = (team.shotsOn || 0) + shotsOn;
      if (possession != null) team.possession = ((team.possession || 0) * (counted - 1) + possession) / counted;
      team.matches.push({ label: match.stage, opponent: opponent.team, gf, ga, result: gf > ga ? "W" : gf < ga ? "L" : "D", ts: match.ts });
    };
    applyExtras(home, away, match.gh, match.ga, "home");
    applyExtras(away, home, match.ga, match.gh, "away");
  }

  for (const team of byTeam.values()) {
    const record = teamRecords.get(team.team);
    if (!record) continue;
    team.played = record.played;
    team.wins = record.wins;
    team.draws = record.draws;
    team.losses = record.losses;
    team.goalsFor = record.goalsFor;
    team.goalsAgainst = record.goalsAgainst;
    team.goalDiff = record.goalDiff;
    team.cleanSheets = record.cleanSheets;
    team.eliminated = record.eliminated;
    team.alive = record.alive;
    if (record.nextOpponent != null && record.nextTs != null) {
      team.nextOpponent = record.nextOpponent;
      team.nextMatchDate = shortDate(record.nextTs);
      team.currentRound = record.nextStage || "Group Stage";
      team.pathStatus = record.nextStage === "Group Stage" ? "Group path active" : "Knockout path active";
    } else if (team.eliminated) {
      team.pathStatus = "Eliminated";
      team.currentRound = "Eliminated";
    } else {
      team.pathStatus = "Alive, awaiting bracket slot";
      team.currentRound = record.roundReached > 0 ? "Knockout" : "Group Stage";
    }
  }

  const maxGF = Math.max(1, ...[...byTeam.values()].map(t => t.goalsFor));
  const maxGD = Math.max(1, ...[...byTeam.values()].map(t => t.goalDiff + 8));
  const maxPPG = Math.max(1, ...[...byTeam.values()].map(t => t.played ? (t.wins * 3 + t.draws) / t.played : 0));
  for (const team of byTeam.values()) {
    const ppg = team.played ? (team.wins * 3 + team.draws) / team.played : 0;
    const lastFive = team.matches.slice(-5);
    const formPts = lastFive.reduce((sum, m) => sum + (m.result === "W" ? 3 : m.result === "D" ? 1 : 0), 0);
    team.form = Math.round(analyticsScorePct(formPts, Math.max(1, lastFive.length * 3)));
    team.attack = Math.round((analyticsScorePct(team.goalsFor, maxGF) * 0.72) + (team.shotsOn != null ? analyticsScorePct(team.shotsOn, Math.max(1, team.played * 7)) * 0.28 : analyticsScorePct(team.goalsFor, maxGF) * 0.28));
    team.defense = Math.round(Math.max(0, 100 - analyticsScorePct(team.goalsAgainst, Math.max(1, team.played * 3))) * 0.75 + analyticsScorePct(team.cleanSheets, Math.max(1, team.played)) * 0.25);
    team.pathDifficulty = team.alive ? 58 : 0;
    const gdScore = analyticsScorePct(team.goalDiff + 8, maxGD);
    const resultScore = analyticsScorePct(ppg, maxPPG);
    team.scoreComponents = {
      results: Math.round(resultScore),
      goalDifference: Math.round(gdScore),
      attack: team.attack,
      defense: team.defense,
      path: team.pathDifficulty,
    };
    team.score = Math.round(resultScore * 0.3 + gdScore * 0.2 + team.attack * 0.2 + team.defense * 0.2 + team.pathDifficulty * 0.1);
    team.tier = analyticsTier(team.score, team.alive);
    const recent = team.matches.slice(-3);
    team.trend = recent.filter(m => m.result === "W").length >= 2 ? "up" : recent.filter(m => m.result === "L").length >= 2 ? "down" : "flat";
    team.matches.sort((a, b) => a.ts - b.ts);
  }
  for (const team of byTeam.values()) {
    const opponentName = teamRecords.get(team.team)?.nextOpponent || "";
    const opponentStrength = byTeam.get(opponentName)?.score ?? 48;
    team.pathDifficulty = team.alive ? Math.round(Math.max(18, Math.min(92, 96 - opponentStrength))) : 0;
    const ppg = team.played ? (team.wins * 3 + team.draws) / team.played : 0;
    const gdScore = analyticsScorePct(team.goalDiff + 8, maxGD);
    const resultScore = analyticsScorePct(ppg, maxPPG);
    team.scoreComponents = {
      results: Math.round(resultScore),
      goalDifference: Math.round(gdScore),
      attack: team.attack,
      defense: team.defense,
      path: team.pathDifficulty,
    };
    team.score = Math.round(resultScore * 0.3 + gdScore * 0.2 + team.attack * 0.2 + team.defense * 0.2 + team.pathDifficulty * 0.1);
    team.tier = analyticsTier(team.score, team.alive);
    const lastThree = team.matches.slice(-3);
    team.formString = lastThree.length ? lastThree.map(match => match.result).join("-") : "No results";
    team.scoreDelta = team.matches.length > 1 ? team.score - analyticsScoreFromMatches(team.matches.slice(0, -1), maxGF, maxGD, maxPPG, team.pathDifficulty) : null;
  }

  const teams = [...byTeam.values()].sort((a, b) => b.score - a.score || a.team.localeCompare(b.team));
  const remainingCount = Math.max(1, teams.filter(team => team.alive).length);
  const aliveRank = new Map(teams.filter(team => team.alive).map((team, index) => [team.team, index + 1]));
  teams.forEach((team, index) => {
    const rankLabel = team.alive ? `#${aliveRank.get(team.team) || index + 1} of ${remainingCount} remaining` : `#${index + 1} overall`;
    if (!team.played) {
      team.modelSummary = `Ranked ${rankLabel}. No completed matches yet, so the model is holding a baseline until verified results arrive.`;
    } else {
      team.modelSummary = `Ranked ${rankLabel}. ${analyticsBand(team.attack, "attack")}, ${analyticsBand(team.defense, "defense")}, ${analyticsPathText(team.pathDifficulty)}.`;
    }
  });
  const confederations = CONFEDERATIONS.map(confederation => {
    const members = teams.filter(team => team.confederation === confederation);
    const played = members.reduce((sum, team) => sum + team.played, 0);
    const wins = members.reduce((sum, team) => sum + team.wins, 0);
    const draws = members.reduce((sum, team) => sum + team.draws, 0);
    const losses = members.reduce((sum, team) => sum + team.losses, 0);
    const goalsFor = members.reduce((sum, team) => sum + team.goalsFor, 0);
    const goalsAgainst = members.reduce((sum, team) => sum + team.goalsAgainst, 0);
    const remaining = members.filter(team => team.alive).length;
    const knockoutTeams = members.filter(team => (teamRecords.get(team.team)?.roundReached || 0) > 0).length;
    const bestTeam = members[0] || null;
    const disappointment = [...members].sort((a, b) => a.score - b.score)[0] || null;
    return {
      confederation,
      qualified: members.length,
      remaining,
      eliminated: members.length - remaining,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      goalDiff: goalsFor - goalsAgainst,
      knockoutTeams,
      quarterfinalists: members.filter(team => (teamRecords.get(team.team)?.roundReached || 0) >= 3).length,
      semifinalists: members.filter(team => (teamRecords.get(team.team)?.roundReached || 0) >= 4).length,
      finalists: members.filter(team => (teamRecords.get(team.team)?.roundReached || 0) >= 6).length,
      winPct: played ? Math.round((wins / played) * 100) : 0,
      pointsPerMatch: played ? Number((((wins * 3 + draws) / played)).toFixed(2)) : 0,
      avgStrength: members.length ? Math.round(members.reduce((sum, team) => sum + team.score, 0) / members.length) : 0,
      bestTeam,
      disappointment,
      survivalRate: members.length ? Math.round((remaining / members.length) * 100) : 0,
    } satisfies ConfederationAnalytics;
  // Deterministic ordering: name breaks any remaining tie so equal-strength
  // confederations never swap positions between renders.
  }).sort((a, b) => b.avgStrength - a.avgStrength || b.remaining - a.remaining || a.confederation.localeCompare(b.confederation));

  const remainingByConfed = Object.fromEntries(CONFEDERATIONS.map(confed => [confed, teams.filter(team => team.confederation === confed && team.alive)])) as Record<Confederation, TeamAnalytics[]>;
  const strongestTeam = teams[0];
  const bestAttack = [...teams].sort((a, b) => b.attack - a.attack)[0];
  const bestDefense = [...teams].sort((a, b) => b.defense - a.defense)[0];
  const strongestConfed = confederations[0];
  const comparisonCards = [
    { label: "Best attack", value: bestAttack.team, detail: `${bestAttack.attack}/100 attack score` },
    { label: "Best defense", value: bestDefense.team, detail: `${bestDefense.defense}/100 defense score` },
    { label: "Most efficient", value: [...confederations].sort((a, b) => b.pointsPerMatch - a.pointsPerMatch)[0].confederation, detail: `${[...confederations].sort((a, b) => b.pointsPerMatch - a.pointsPerMatch)[0].pointsPerMatch} pts/match` },
    { label: "Most surviving teams", value: [...confederations].sort((a, b) => b.remaining - a.remaining)[0].confederation, detail: `${[...confederations].sort((a, b) => b.remaining - a.remaining)[0].remaining} still alive` },
    { label: "Highest win rate", value: [...confederations].sort((a, b) => b.winPct - a.winPct)[0].confederation, detail: `${[...confederations].sort((a, b) => b.winPct - a.winPct)[0].winPct}% wins` },
    { label: "Highest goal difference", value: [...confederations].sort((a, b) => b.goalDiff - a.goalDiff)[0].confederation, detail: `${[...confederations].sort((a, b) => b.goalDiff - a.goalDiff)[0].goalDiff > 0 ? "+" : ""}${[...confederations].sort((a, b) => b.goalDiff - a.goalDiff)[0].goalDiff}` },
  ];

  const matchups = matches
    .filter(match => match.stage !== "Group Stage" && match.status !== "completed" && byTeam.has(match.home) && byTeam.has(match.away))
    .slice(0, 8)
    .map(match => {
      const home = byTeam.get(match.home)!;
      const away = byTeam.get(match.away)!;
      const diff = Math.abs(home.score - away.score);
      const totalStrength = Math.max(1, home.score + away.score);
      const leanHome = Math.round((home.score / totalStrength) * 100);
      return {
        key: match.key,
        stage: match.stage,
        date: shortDate(match.ts),
        kickoff: new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(match.ts)),
        venue: data.venues[match.sourceMatch.v]?.common || "Venue TBD",
        match: match.sourceMatch,
        fixture: match.fixture,
        home,
        away,
        leanHome,
        leanAway: 100 - leanHome,
        upsetPotential: Math.max(8, Math.round(100 - diff * 1.6)),
        difficulty: diff < 8 ? "Toss-up" : diff < 18 ? "Pressure match" : "Favorite-heavy",
      };
    });

  const completedMatches = matches.filter(match => match.status === "completed").length;
  const statRichMatches = matches.filter(match => match.status === "completed" && !!match.sourceStats).length;
  const statCoverage = completedMatches ? statRichMatches / completedMatches : 0;
  const modelQuality: AnalyticsModel["modelQuality"] = statCoverage >= 0.75
    ? "Advanced"
    : statCoverage >= 0.25
      ? "Standard"
      : "Basic";

  return { modelQuality, teams, confederations, remainingByConfed, comparisonCards, matchups, strongestTeam, bestAttack, bestDefense, strongestConfed };
}

function normalizeAnalyticsTab(value: string | null): AnalyticsTab | null {
  if (value === "confeds") return "confederations";
  if (value === "teams" || value === "confederations" || value === "remaining" || value === "matchups") return value;
  return null;
}

function AnalyticsView({ data, fixtures, findLive, nowMs, liveTs, liveStatus, onTeamClick, onMatchClick }: {
  data: TournamentData;
  fixtures: LiveFixture[];
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null;
  nowMs: number;
  liveTs: number;
  liveStatus: LiveStatus;
  onTeamClick: (team: string) => void;
  onMatchClick: (match: GroupStageMatch, fixture: LiveFixture | null) => void;
}) {
  const initialTab = useMemo<AnalyticsTab>(() => {
    if (typeof window === "undefined") return "teams";
    const tab = new URLSearchParams(window.location.search).get("tab");
    return normalizeAnalyticsTab(tab) || "teams";
  }, []);
  const [analyticsTab, setAnalyticsTab] = useState<AnalyticsTab>(initialTab);
  const [analyticsSort, setAnalyticsSort] = useState<AnalyticsSort>("overall");
  const [aliveOnly, setAliveOnly] = useState(true);
  const [analyticsTeam, setAnalyticsTeam] = useState<string | null>(null);
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const [shareToast, setShareToast] = useState("");
  const drawerRef = useRef<HTMLElement | null>(null);
  const modelSheetRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  /* The analytics model only needs wall-clock time to guard against stale
     live statuses, so a five-minute bucket avoids rebuilding on every
     countdown tick while keeping stale-live decisions fresh enough. */
  const analyticsNowBucket = Math.floor(nowMs / (5 * 60_000)) * 5 * 60_000;
  const analytics = useMemo(() => buildAnalyticsModel(data, fixtures, findLive, analyticsNowBucket), [data, fixtures, findLive, analyticsNowBucket]);
  const rankedAnalyticsTeams = useMemo(() => {
    const visible = aliveOnly ? analytics.teams.filter(team => team.alive) : analytics.teams;
    const sorters: Record<AnalyticsSort, (a: TeamAnalytics, b: TeamAnalytics) => number> = {
      overall: (a, b) => b.score - a.score,
      attack: (a, b) => b.attack - a.attack,
      defense: (a, b) => b.defense - a.defense,
      form: (a, b) => b.form - a.form,
      goals: (a, b) => b.goalsFor - a.goalsFor,
      confederation: (a, b) => a.confederation.localeCompare(b.confederation) || b.score - a.score,
    };
    return [...visible].sort((a, b) => sorters[analyticsSort](a, b) || a.team.localeCompare(b.team));
  }, [analytics.teams, analyticsSort, aliveOnly]);
  const selectedAnalyticsTeam = analyticsTeam ? analytics.teams.find(team => team.team === analyticsTeam) || null : null;
  const mostRemaining = [...analytics.confederations].sort((a, b) => b.remaining - a.remaining)[0];
  const analyticsSyncLabel = liveTs ? new Date(liveTs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "pending";
  const analyticsDataNote = liveStatus === "paused" || liveStatus === "off" || liveStatus === "nofix"
    ? `Live feed unavailable; using verified results. Last updated ${analyticsSyncLabel}.`
    : `Last updated ${analyticsSyncLabel}.`;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", "analytics");
    url.searchParams.set("tab", analyticsTab);
    window.history.replaceState(window.history.state, "", url);
  }, [analyticsTab]);

  useEffect(() => {
    if (!selectedAnalyticsTeam || typeof window === "undefined") return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => drawerRef.current?.focus());
    window.history.pushState({ competAnalyticsDrawer: true }, "");
    let closedByPop = false;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setAnalyticsTeam(null);
    };
    const onPop = () => {
      closedByPop = true;
      setAnalyticsTeam(null);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      previousFocusRef.current?.focus?.();
      if (!closedByPop && window.history.state?.competAnalyticsDrawer) window.history.back();
    };
  }, [selectedAnalyticsTeam?.team]);

  useEffect(() => {
    if (!modelSheetOpen || typeof window === "undefined") return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAnimationFrame(() => modelSheetRef.current?.focus());
    window.history.pushState({ competAnalyticsMethodology: true }, "");
    let closedByPop = false;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setModelSheetOpen(false);
    };
    const onPop = () => {
      closedByPop = true;
      setModelSheetOpen(false);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      previousFocusRef.current?.focus?.();
      if (!closedByPop && window.history.state?.competAnalyticsMethodology) window.history.back();
    };
  }, [modelSheetOpen]);

  const shareAnalyticsText = useCallback(async (text: string, tab: AnalyticsTab = analyticsTab) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", "analytics");
    url.searchParams.set("tab", tab);
    const payload = `${text} ${url.toString()}`;
    try {
      const canShare = typeof navigator.share === "function";
      if (canShare) await navigator.share({ text: payload, url: url.toString() });
      else await navigator.clipboard.writeText(payload);
      setShareToast(canShare ? "Share sheet opened" : "Copied");
      window.setTimeout(() => setShareToast(""), 1800);
    } catch {
      // Share cancellation is expected; keep the UI quiet.
    }
  }, [analyticsTab]);

  const shareTeam = useCallback((team: TeamAnalytics) => {
    const rank = analytics.teams.filter(item => item.alive).findIndex(item => item.team === team.team) + 1;
    const remaining = analytics.teams.filter(item => item.alive).length;
    shareAnalyticsText(`${data.flags[team.team] || ""} ${team.team} — ${team.score}/100 in the Compet 2026 strength model. #${rank || "—"} of ${remaining} remaining. ${analyticsBand(team.attack, "attack")}.`, "teams");
  }, [analytics.teams, data.flags, shareAnalyticsText]);

  return (
    <section className="analytics-hub analytics-hub--view" aria-label="Analytics Hub">
      <div className="analytics-hero">
        <div>
          <span className="analytics-kicker">Analytics Hub</span>
          <h3>Team strength, confederation power, and knockout survival.</h3>
          <p>{analytics.modelQuality} model: results/form 30%, goal difference 20%, attack 20%, defense 20%, knockout path difficulty 10%. Advanced metrics appear automatically when the live feed supplies them.</p>
          <p className="analytics-data-note">{analyticsDataNote}</p>
          <button type="button" className="analytics-method-button" onClick={() => setModelSheetOpen(true)}>ⓘ How scores work</button>
        </div>
        <div className="analytics-hero__cards">
          <button type="button" onClick={() => setAnalyticsTeam(analytics.strongestTeam.team)}>
            <small>Strongest Team</small><b>{data.flags[analytics.strongestTeam.team]} {analytics.strongestTeam.team}</b><span>{analytics.strongestTeam.score}/100</span>
          </button>
          <button type="button" onClick={() => setAnalyticsTeam(analytics.bestAttack.team)}>
            <small>Best Attack</small><b>{data.flags[analytics.bestAttack.team]} {analytics.bestAttack.team}</b><span>{analytics.bestAttack.attack}/100</span>
          </button>
          <button type="button" onClick={() => setAnalyticsTeam(analytics.bestDefense.team)}>
            <small>Best Defense</small><b>{data.flags[analytics.bestDefense.team]} {analytics.bestDefense.team}</b><span>{analytics.bestDefense.defense}/100</span>
          </button>
          <button type="button" onClick={() => setAnalyticsTab("confederations")}>
            <small>Strongest Confederation</small><b>{analytics.strongestConfed.confederation}</b><span>{analytics.strongestConfed.avgStrength}/100 avg</span>
          </button>
          <button type="button" onClick={() => setAnalyticsTab("remaining")}>
            <small>Most Teams Remaining</small><b>{mostRemaining.confederation}</b><span>{mostRemaining.remaining} alive</span>
          </button>
        </div>
      </div>

      <div className="analytics-tabs" role="tablist" aria-label="Analytics Hub sections">
        {[
          ["teams", "Teams"],
          ["confederations", "Confederations"],
          ["remaining", "Remaining"],
          ["matchups", "Matchups"],
        ].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={analyticsTab === key} onClick={() => setAnalyticsTab(key as AnalyticsTab)}>{label}</button>
        ))}
      </div>

      {analyticsTab === "teams" && (
        <div className="analytics-panel">
          <div className="analytics-controls">
            <button type="button" className="analytics-toggle" aria-pressed={aliveOnly} onClick={() => setAliveOnly(v => !v)}>Alive teams only</button>
            <label>
              <span>Sort</span>
              <select value={analyticsSort} onChange={event => setAnalyticsSort(event.target.value as AnalyticsSort)}>
                <option value="overall">Overall</option>
                <option value="attack">Attack</option>
                <option value="defense">Defense</option>
                <option value="form">Form</option>
                <option value="goals">Goals</option>
                <option value="confederation">Confederation</option>
              </select>
            </label>
          </div>
          <div className="analytics-ranking">
            {rankedAnalyticsTeams.map((team, index) => (
              <button key={team.team} type="button" className="analytics-team-row" onClick={() => setAnalyticsTeam(team.team)}>
                <span className="analytics-rank">{index + 1}</span>
                <span className="analytics-team-row__name">
                  <b>{data.flags[team.team]} {team.team}</b>
                  <small>{team.confederation} · {team.wins}-{team.draws}-{team.losses} · GD {team.goalDiff > 0 ? "+" : ""}{team.goalDiff}</small>
                </span>
                <span className={`analytics-tier analytics-tier--${team.tier.toLowerCase().replace(/\s/g, "-")}`}>{team.tier}</span>
                <span className="analytics-score" role="img" aria-label={`Strength ${team.score} of 100`}>
                  <b>{team.score}</b>
                  <i><span style={{ width: `${team.score}%` }} /></i>
                </span>
                <span className="analytics-form-dots" role="img" aria-label={`Form: ${team.formString}, last 3`}>
                  {team.matches.slice(-5).map((match, formIndex) => (
                    <i key={`${team.team}-${match.ts}-${formIndex}`} className={`analytics-dot analytics-dot--${match.result.toLowerCase()}`}>{match.result}</i>
                  ))}
                  {team.matches.length === 0 && <em>No results</em>}
                  <small>{team.trend === "up" ? "↑" : team.trend === "down" ? "↓" : "→"}{team.scoreDelta != null ? ` ${team.scoreDelta >= 0 ? "+" : ""}${team.scoreDelta}` : ""}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {analyticsTab === "confederations" && (
        <div className="analytics-panel">
          <div className="analytics-confed-bars" aria-label="Confederation survival overview">
            {analytics.confederations.map(confed => (
              <div key={confed.confederation} className="analytics-confed-bar-row">
                <b>{confed.avgStrength}</b>
                <span>{confed.confederation}</span>
                <i role="img" aria-label={`${confed.confederation}: ${confed.remaining} alive, ${confed.eliminated} eliminated`}>
                  <em style={{ width: `${confed.survivalRate}%` }} />
                  <strong style={{ width: `${100 - confed.survivalRate}%` }} />
                </i>
                <small>{confed.remaining} alive · {confed.eliminated} out</small>
              </div>
            ))}
          </div>
          <div className="analytics-confed-grid">
            {analytics.confederations.map(confed => (
              <article key={confed.confederation} className="analytics-confed-card">
                <header><span>{confed.confederation}</span><b>{confed.avgStrength}</b></header>
                <div className="analytics-confed-card__stats">
                  <span><b>{confed.qualified}</b><small>qualified</small></span>
                  <span><b>{confed.remaining}</b><small>remaining</small></span>
                  <span><b>{confed.eliminated}</b><small>eliminated</small></span>
                  <span><b>{confed.winPct}%</b><small>win rate</small></span>
                  <span><b>{confed.pointsPerMatch}</b><small>pts/match</small></span>
                  <span><b>{confed.goalDiff > 0 ? "+" : ""}{confed.goalDiff}</b><small>goal diff</small></span>
                </div>
                <p>KO {confed.knockoutTeams} · QF {confed.quarterfinalists} · SF {confed.semifinalists} · Finalists {confed.finalists}</p>
                <small>Best: {confed.bestTeam?.team || "Pending"} · Biggest disappointment: {confed.disappointment?.team || "Pending"} · Survival {confed.survivalRate}%</small>
              </article>
            ))}
          </div>
          <div className="analytics-comparison-grid">
            {analytics.comparisonCards.map(card => (
              <article key={card.label} className="analytics-compare-card">
                <span>{card.label}</span><b>{card.value}</b><small>{card.detail}</small>
              </article>
            ))}
          </div>
        </div>
      )}

      {analyticsTab === "remaining" && (
        <div className="analytics-panel">
          <div className="analytics-survival-board">
            {CONFEDERATIONS.map(confed => {
              const teams = analytics.remainingByConfed[confed];
              return (
                <article key={confed} className="analytics-survival-card">
                  <header><b>{confed}</b><span>{teams.length} alive</span></header>
                  {teams.length === 0 ? (
                    <p>No teams remaining. Tournament performance summary is still shown in Confederations.</p>
                  ) : (
                    <div className="analytics-team-chips">
                      {teams.map(team => (
                        <button key={team.team} type="button" onClick={() => setAnalyticsTeam(team.team)}>
                          <b>{data.flags[team.team]} {team.team}</b>
                          <small>{team.currentRound} · vs {team.nextOpponent} · {team.nextMatchDate}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}

      {analyticsTab === "matchups" && (
        <div className="analytics-panel">
          {analytics.matchups.length === 0 ? (
            <p className="analytics-empty">No confirmed upcoming knockout matchups yet. The model will populate this board as the bracket resolves.</p>
          ) : (
            <div className="analytics-matchups">
              {analytics.matchups.map(matchup => (
                <article key={matchup.key} className="analytics-matchup-card">
                  <header><span>{matchup.stage} · {matchup.kickoff}</span><b>{matchup.difficulty}</b></header>
                  <div className="analytics-matchup-card__teams">
                    <button type="button" onClick={() => setAnalyticsTeam(matchup.home.team)}>{data.flags[matchup.home.team]} {matchup.home.team}<small>{matchup.home.score} strength · {matchup.home.confederation}</small></button>
                    <strong>vs</strong>
                    <button type="button" onClick={() => setAnalyticsTeam(matchup.away.team)}>{data.flags[matchup.away.team]} {matchup.away.team}<small>{matchup.away.score} strength · {matchup.away.confederation}</small></button>
                  </div>
                  <div className="analytics-lean" role="img" aria-label={`Model lean ${matchup.home.team} ${matchup.leanHome}, ${matchup.away.team} ${matchup.leanAway}`}>
                    <span style={{ width: `${matchup.leanHome}%` }}>{matchup.leanHome}</span>
                    <span style={{ width: `${matchup.leanAway}%` }}>{matchup.leanAway}</span>
                  </div>
                  <div className="analytics-matchup-bars">
                    <span>Model lean <b>{matchup.leanHome} / {matchup.leanAway}</b></span>
                    <span>Attack vs defense <b>{matchup.home.attack} / {matchup.away.defense}</b></span>
                    <span>Return pressure <b>{matchup.away.attack} / {matchup.home.defense}</b></span>
                    <span>Venue <b>{matchup.venue}</b></span>
                  </div>
                  <button type="button" className="analytics-matchup-card__match" onClick={() => onMatchClick(matchup.match, matchup.fixture)}>View match details</button>
                  <button type="button" className="analytics-matchup-card__match analytics-matchup-card__match--ghost" onClick={() => shareAnalyticsText(`${matchup.home.team} ${matchup.leanHome} — ${matchup.leanAway} ${matchup.away.team} · model lean · ${matchup.stage}, ${matchup.kickoff}`, "matchups")}>Share matchup</button>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedAnalyticsTeam && (
        <aside ref={drawerRef} className="analytics-drawer" role="dialog" aria-modal="true" aria-label={`${selectedAnalyticsTeam.team} analytics`} tabIndex={-1}>
          <button type="button" className="analytics-drawer__back" onClick={() => setAnalyticsTeam(null)}>‹ Back</button>
          <div>
            <span>{selectedAnalyticsTeam.confederation} · rank #{analytics.teams.findIndex(team => team.team === selectedAnalyticsTeam.team) + 1}</span>
            <h4>{data.flags[selectedAnalyticsTeam.team]} {selectedAnalyticsTeam.team}</h4>
            <p>{selectedAnalyticsTeam.score}/100 strength · {selectedAnalyticsTeam.pathStatus}</p>
          </div>
          <button type="button" className="analytics-drawer__close" aria-label="Close team analytics" onClick={() => setAnalyticsTeam(null)}>×</button>
            <div className="analytics-breakdown">
              {[
                ["Results & form", 30, selectedAnalyticsTeam.scoreComponents.results],
                ["Goal difference", 20, selectedAnalyticsTeam.scoreComponents.goalDifference],
                ["Attack", 20, selectedAnalyticsTeam.scoreComponents.attack],
                ["Defense", 20, selectedAnalyticsTeam.scoreComponents.defense],
                ["Path", 10, selectedAnalyticsTeam.scoreComponents.path],
              ].map(([label, weight, score]) => (
                <span key={label as string} role="img" aria-label={`${label} contributes ${weight} percent at ${score} of 100`}>
                  <b>{label}<small>{weight}%</small></b><i><span style={{ width: `${score}%` }} /></i><em>{score}</em>
                </span>
              ))}
            </div>
          <p className="analytics-drawer__summary">{selectedAnalyticsTeam.modelSummary}</p>
          <p className="analytics-drawer__note">Trend: {selectedAnalyticsTeam.trend} · Form: {selectedAnalyticsTeam.formString}, last 3{selectedAnalyticsTeam.scoreDelta != null ? ` · ${selectedAnalyticsTeam.scoreDelta >= 0 ? "+" : ""}${selectedAnalyticsTeam.scoreDelta} since last completed match` : ""}</p>
          <div className="analytics-drawer__grid">
            <span><b>{selectedAnalyticsTeam.goalsFor}</b><small>goals for</small></span>
            <span><b>{selectedAnalyticsTeam.goalsAgainst}</b><small>against</small></span>
            <span><b>{selectedAnalyticsTeam.cleanSheets}</b><small>clean sheets</small></span>
            <span><b>{selectedAnalyticsTeam.nextOpponent}</b><small>next opponent</small></span>
          </div>
          <button type="button" className="analytics-drawer__team-link" onClick={() => onTeamClick(selectedAnalyticsTeam.team)}>Open team profile</button>
          <button type="button" className="analytics-drawer__team-link analytics-drawer__team-link--ghost" onClick={() => shareTeam(selectedAnalyticsTeam)}>Share</button>
          <div className="analytics-form-strip">
            {selectedAnalyticsTeam.matches.length === 0 ? <span>No completed matches yet.</span> : selectedAnalyticsTeam.matches.slice(-5).map(match => (
              <span key={`${match.label}-${match.opponent}-${match.ts}`} className={`analytics-form analytics-form--${match.result.toLowerCase()}`}>
                <b>{match.result}</b><small>{match.gf}-{match.ga} vs {match.opponent}</small>
              </span>
            ))}
          </div>
          <p className="analytics-drawer__note">Ranking among {selectedAnalyticsTeam.confederation}: #{analytics.teams.filter(team => team.confederation === selectedAnalyticsTeam.confederation).findIndex(team => team.team === selectedAnalyticsTeam.team) + 1}. Current model quality: {analytics.modelQuality}; richer shot, possession, xG, and xGA coverage improves confidence automatically.</p>
        </aside>
      )}

      {modelSheetOpen && (
        <aside ref={modelSheetRef} className="analytics-method-sheet" role="dialog" aria-modal="true" aria-label="How Analytics Hub scores work" tabIndex={-1}>
          <button type="button" className="analytics-drawer__close" aria-label="Close methodology" onClick={() => setModelSheetOpen(false)}>×</button>
          <span className="analytics-kicker">About this model</span>
          <h4>Transparent tournament-only strength scoring.</h4>
          <p>Scores recompute on every live refresh from this app's canonical schedule, verified results, and live match payload.</p>
          <div className="analytics-method-list">
            <span><b>Results & form</b><em>30%</em><small>Points per match and recent W/D/L form from completed matches.</small></span>
            <span><b>Goal difference</b><em>20%</em><small>Verified goals for and against, normalized across the field.</small></span>
            <span><b>Attack</b><em>20%</em><small>Goals plus shots on target when the live feed supplies them.</small></span>
            <span><b>Defense</b><em>20%</em><small>Goals allowed and clean sheets from completed matches.</small></span>
            <span><b>Path difficulty</b><em>10%</em><small>Projected next-opponent strength; eliminated teams drop to zero.</small></span>
          </div>
          <p className="analytics-drawer__note">Current model quality: {analytics.modelQuality}. Derived entirely from this tournament's results. No preseason ratings, no external rankings, no betting odds.</p>
        </aside>
      )}

      {shareToast && <div className="analytics-share-toast" role="status">{shareToast}</div>}
      <p className="analytics-disclaimer">Strength scores are unofficial model estimates derived from tournament results. FIFA is the source of record for standings and results.</p>
    </section>
  );
}

/* ---------------------------------------------------------------
 * MoreView — comprehensive tournament dashboard
 * Sections: Hero, Progress, Quick Access, Stadiums, Host Cities,
 *           Calendar Timeline, History, App Settings
 * --------------------------------------------------------------- */
function MoreView({ data, fixtures, leaderboardStats, findLive, nowMs, onNavigate, onVenueClick, onTeamClick, onPlayerClick }: {
  data: TournamentData;
  fixtures: LiveFixture[];
  leaderboardStats: ExternalLeaderStat[];
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null;
  nowMs: number;
  onNavigate: (view: ViewType) => void;
  /* Opens the Map view centered on the given venue (stadium card tap) */
  onVenueClick: (venueId: string) => void;
  onTeamClick: (team: string) => void;
  onPlayerClick: (playerName: string, teamName: string) => void;
}) {
  type MoreHostFilter = "all" | "live" | "upcoming" | "completed" | "knockout";
  type MoreHostFixture = MapMatch & { status: ReturnType<typeof matchStatus>; statusLabel: string; scoreLabel: string };
  type MoreHostCity = {
    venueId: string;
    city: string;
    country: string;
    stadiumName: string;
    capacity: number;
    imageUrl?: string;
    timezone: string;
    fixtures: MoreHostFixture[];
    matchingFixtures: MoreHostFixture[];
    counts: { total: number; live: number; upcoming: number; completed: number };
    nextMatch: MoreHostFixture | null;
  };
  type MoreHostCountry = {
    key: string;
    label: string;
    cities: MoreHostCity[];
    matchingCities: MoreHostCity[];
    counts: { cities: number; stadiums: number; total: number; live: number; upcoming: number; completed: number };
  };

  const [hostQuery, setHostQuery] = useState("");
  const [hostFilter, setHostFilter] = useState<MoreHostFilter>("all");
  const [openCountry, setOpenCountry] = useState("USA");
  const [openCity, setOpenCity] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [hostMatchDetail, setHostMatchDetail] = useState<{ match: GroupStageMatch; fixture: LiveFixture | null } | null>(null);

  const countryFlag = (country: string) => {
    const key = country === "USA" ? "United States" : country;
    return data.flags[key] || (country === "USA" ? "🇺🇸" : country === "Mexico" ? "🇲🇽" : country === "Canada" ? "🇨🇦" : "🏳️");
  };

  /* -- helper: format large numbers with commas ---------------- */
  const fmtNum = (n: number) => n.toLocaleString("en-US");

  const statusLabel = (match: MapMatch, status: ReturnType<typeof matchStatus>) => {
    const raw = match.fixture?.status || match.sourceMatch.dbStatus || "";
    if (raw === "HT") return "HT";
    if (raw === "AET" || raw === "ET") return "ET";
    if (raw === "PEN") return "Pens";
    if (status === "live") return raw && raw !== "LIVE" ? raw : "Live";
    if (status === "completed") return raw === "PEN" ? "Pens" : raw === "AET" ? "ET" : "FT";
    return "Scheduled";
  };

  /* =============================================================
   * 1. Tournament progress calculations
   * ============================================================= */

  /* Count completed group-stage matches */
  const completedGS = useMemo(() => {
    let count = 0;
    for (const m of data.gs) {
      const f = findLive({ ts: m.ts, v: m.v, t1: m.t1, t2: m.t2 }, fixtures);
      if (f && DONE_STATUSES.has(f.status)) count++;
      else if (m.dbStatus && DONE_STATUSES.has(m.dbStatus)) count++;
    }
    return count;
  }, [data.gs, fixtures, findLive]);

  /* Count completed knockout matches (KnockoutMatch has no dbStatus,
     so we only check live fixtures for done status) */
  const completedKO = useMemo(() => {
    let count = 0;
    for (const m of data.ko) {
      const f = findLive({ ts: m.ts, v: m.v }, fixtures);
      if (f && DONE_STATUSES.has(f.status)) count++;
    }
    return count;
  }, [data.ko, fixtures, findLive]);

  const totalMatches = 104;
  const completedTotal = completedGS + completedKO;
  const progressPct = Math.round((completedTotal / totalMatches) * 100);

  /* Determine current tournament stage label */
  const stageLabel = useMemo(() => {
    if (completedTotal === 0) return "Pre-Tournament";
    if (completedGS < 72) return "Group Stage";
    if (completedKO === 0) return "Group Stage Complete";
    /* Check KO rounds in order */
    const koRoundCounts = [
      { label: "Round of 32", count: 16, start: 0 },
      { label: "Round of 16", count: 8, start: 16 },
      { label: "Quarterfinals", count: 4, start: 24 },
      { label: "Semifinals", count: 2, start: 26 },
      { label: "Third Place / Final", count: 2, start: 28 },
    ];
    let running = completedKO;
    for (const r of koRoundCounts) {
      if (running < r.count) return r.label;
      running -= r.count;
    }
    return "Tournament Complete";
  }, [completedGS, completedKO, completedTotal]);

  /* Find next upcoming match for countdown */
  const nextMatch = useMemo(() => {
    const allMatches = [...data.gs, ...data.ko]
      .filter(m => m.ts > nowMs)
      .sort((a, b) => a.ts - b.ts);
    return allMatches[0] || null;
  }, [data.gs, data.ko, nowMs]);

  /* Format countdown string */
  const countdown = useMemo(() => {
    if (!nextMatch) return null;
    const diff = nextMatch.ts - nowMs;
    if (diff <= 0) return null;
    const days = Math.floor(diff / 86400000);
    const hrs = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (days > 0) return `${days}d ${hrs}h`;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  }, [nextMatch, nowMs]);

  /* =============================================================
   * 2. Venue statistics — match counts per venue
   * ============================================================= */
  const venueMatchCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of data.gs) counts[m.v] = (counts[m.v] || 0) + 1;
    for (const m of data.ko) {
      if (m.v) counts[m.v] = (counts[m.v] || 0) + 1;
    }
    return counts;
  }, [data.gs, data.ko]);

  /* Sorted venue list */
  const venueList = useMemo(() =>
    Object.entries(data.venues)
      .map(([key, v]) => ({ key, ...v, matches: venueMatchCounts[key] || 0 }))
      .sort((a, b) => b.cap - a.cap),
    [data.venues, venueMatchCounts]
  );

  /* =============================================================
   * 3. Host cities — country/city/fixture accordion model
   * ============================================================= */
  const hostFixtures = useMemo<MoreHostFixture[]>(() => {
    const groupMatches = data.gs.map((m): MapMatch => {
      const fixture = findLive({ ts: m.ts, v: m.v, t1: m.t1, t2: m.t2 }, fixtures);
      return {
        key: `gs-${m.no}`,
        no: m.no,
        venueId: m.v,
        ts: m.ts,
        iso: m.iso,
        local: m.local,
        et: m.et,
        stage: "Group Stage",
        homeTeam: m.t1,
        awayTeam: m.t2,
        fixture,
        sourceMatch: m,
      };
    });
    const knockoutMatches = buildKnockoutCards(data, fixtures, findLive, nowMs).map((card): MapMatch => {
      const [teamA, teamB] = card.teams;
      const t1 = teamA.placeholder ? "TBD" : teamA.name;
      const t2 = teamB.placeholder ? "TBD" : teamB.name;
      return {
        key: `ko-${card.matchNo}`,
        no: card.matchNo,
        venueId: card.match.v,
        ts: card.match.ts,
        iso: card.match.iso,
        local: card.match.local,
        et: card.match.et,
        stage: card.match.round,
        homeTeam: t1,
        awayTeam: t2,
        fixture: card.fixture,
        sourceMatch: {
          no: card.matchNo,
          iso: card.match.iso,
          local: card.match.local,
          et: card.match.et,
          g: "KO",
          t1,
          t2,
          v: card.match.v,
          ts: card.match.ts,
        },
      };
    });
    return [...groupMatches, ...knockoutMatches]
      .map(match => {
        const status = matchStatus(match, nowMs);
        return {
          ...match,
          status,
          statusLabel: statusLabel(match, status),
          scoreLabel: matchScoreLabel(match),
        };
      })
      .sort((a, b) => a.ts - b.ts);
  }, [data, fixtures, findLive, nowMs]);

  const hostCountries = useMemo<MoreHostCountry[]>(() => {
    const query = hostQuery.trim().toLowerCase();
    const countryOrder = [
      { key: "USA", label: "United States" },
      { key: "Canada", label: "Canada" },
      { key: "Mexico", label: "Mexico" },
    ];
    const matchesFilter = (match: MoreHostFixture) => {
      if (hostFilter === "all") return true;
      if (hostFilter === "knockout") return match.stage !== "Group Stage";
      return match.status === hostFilter;
    };
    const matchesQuery = (city: MoreHostCity, match: MoreHostFixture) => {
      if (!query) return true;
      return [
        city.city,
        city.country,
        city.stadiumName,
        match.homeTeam,
        match.awayTeam,
        match.stage,
      ].some(value => value.toLowerCase().includes(query));
    };
    return countryOrder.map(country => {
      const cities = Object.entries(data.venues)
        .filter(([, venue]) => venue.country === country.key)
        .map(([venueId, venue]) => {
          const detail = HOST_VENUE_DETAILS[venueId];
          const allFixtures = hostFixtures.filter(match => match.venueId === venueId);
          const cityBase: MoreHostCity = {
            venueId,
            city: venue.city,
            country: venue.country,
            stadiumName: venue.common,
            capacity: venue.cap,
            imageUrl: detail?.imageUrl || undefined,
            timezone: detail?.timezone || "America/New_York",
            fixtures: allFixtures,
            matchingFixtures: [],
            counts: {
              total: allFixtures.length,
              live: allFixtures.filter(match => match.status === "live").length,
              upcoming: allFixtures.filter(match => match.status === "upcoming").length,
              completed: allFixtures.filter(match => match.status === "completed").length,
            },
            nextMatch: allFixtures.find(match => match.status === "live" || match.status === "upcoming") || null,
          };
          const matchingFixtures = allFixtures.filter(match => matchesFilter(match) && matchesQuery(cityBase, match));
          return { ...cityBase, matchingFixtures };
        })
        .sort((a, b) => a.city.localeCompare(b.city));
      const matchingCities = cities.filter(city => city.matchingFixtures.length > 0 || (query && [city.city, city.country, city.stadiumName].some(value => value.toLowerCase().includes(query))));
      const countSource = hostFilter === "all" && !query ? cities : matchingCities.map(city => ({ ...city, fixtures: city.matchingFixtures }));
      return {
        ...country,
        cities,
        matchingCities,
        counts: {
          cities: matchingCities.length,
          stadiums: matchingCities.length,
          total: countSource.reduce((sum, city) => sum + city.fixtures.length, 0),
          live: countSource.reduce((sum, city) => sum + city.fixtures.filter(match => match.status === "live").length, 0),
          upcoming: countSource.reduce((sum, city) => sum + city.fixtures.filter(match => match.status === "upcoming").length, 0),
          completed: countSource.reduce((sum, city) => sum + city.fixtures.filter(match => match.status === "completed").length, 0),
        },
      };
    });
  }, [data.venues, hostFixtures, hostFilter, hostQuery]);

  const selectedHostCity = useMemo(() => {
    const fallback = hostCountries.flatMap(country => country.matchingCities)[0] || hostCountries[0]?.cities[0] || null;
    return hostCountries.flatMap(country => country.cities).find(city => city.venueId === selectedCity) || fallback;
  }, [hostCountries, selectedCity]);

  /* =============================================================
   * 4. Calendar milestones with date ranges
   * ============================================================= */
  const milestones = useMemo(() => {
    const items = [
      { label: "Opening Match", date: "Jun 11", ts: Date.UTC(2026, 5, 11, 20, 0) },
      { label: "Final Group Matches", date: "Jun 27", ts: Date.UTC(2026, 5, 27, 22, 0) },
      { label: "Round of 32", date: "Jun 28 – Jul 3", ts: Date.UTC(2026, 6, 3, 22, 0) },
      { label: "Round of 16", date: "Jul 4 – Jul 7", ts: Date.UTC(2026, 6, 7, 22, 0) },
      { label: "Quarterfinals", date: "Jul 9 – Jul 11", ts: Date.UTC(2026, 6, 11, 22, 0) },
      { label: "Semifinals", date: "Jul 14 – Jul 15", ts: Date.UTC(2026, 6, 15, 22, 0) },
      { label: "Third Place", date: "Jul 18", ts: Date.UTC(2026, 6, 18, 22, 0) },
      { label: "Final", date: "Jul 19", ts: Date.UTC(2026, 6, 19, 22, 0) },
    ];
    return items.map(m => ({
      ...m,
      status: nowMs >= m.ts ? "past" as const
        : (items.find(x => x.ts > nowMs) === m ? "current" as const : "upcoming" as const),
    }));
  }, [nowMs]);

  /* =============================================================
   * 5. History and records
   * ============================================================= */
  const tournamentStats = useMemo(() => buildTournamentStats(data, fixtures, { players: leaderboardStats }), [data, fixtures, leaderboardStats]);
  const formatLeaderTie = (leaders: PlayerLeader[], value: (leader: PlayerLeader) => number, label: string) => {
    const topValue = leaders[0] ? value(leaders[0]) : 0;
    if (!topValue) return "Pending live data";
    const names = leaders
      .filter(leader => value(leader) === topValue)
      .slice(0, 3)
      .map(leader => `${leader.name} (${leader.team})`);
    const suffix = names.length > 1 ? `${topValue} ${label} each` : `${topValue} ${label}`;
    return `${names.join(", ")} — ${suffix}`;
  };

  const pastWinners = [
    { year: 2022, host: "Qatar", winner: "Argentina", flag: "🇦🇷", runner: "France" },
    { year: 2018, host: "Russia", winner: "France", flag: "🇫🇷", runner: "Croatia" },
    { year: 2014, host: "Brazil", winner: "Germany", flag: "🇩🇪", runner: "Argentina" },
    { year: 2010, host: "South Africa", winner: "Spain", flag: "🇪🇸", runner: "Netherlands" },
    { year: 2006, host: "Germany", winner: "Italy", flag: "🇮🇹", runner: "France" },
    { year: 2002, host: "Korea/Japan", winner: "Brazil", flag: "🇧🇷", runner: "Germany" },
  ];

  const records = [
    { label: "2026 Top Scorer", value: formatLeaderTie(tournamentStats.topScorers, leader => leader.goals, "goals") },
    { label: "2026 Top Assists", value: formatLeaderTie(tournamentStats.topAssisters, leader => leader.assists, "assists") },
    { label: "2026 Most Cards", value: formatLeaderTie(tournamentStats.mostCarded, leader => leader.yellows + leader.reds * 3, "card pts") },
    { label: "Most World Cup Titles", value: "Brazil — 5" },
    { label: "Most Goals, Career", value: "Lionel Messi — 19" },
    { label: "Most Goals, Single Tournament", value: "Just Fontaine — 13 (1958)" },
    { label: "Most Appearances", value: "Lionel Messi — 29" },
    { label: "Fastest Goal", value: "Hakan Şükür — 11 sec (2002)" },
    { label: "Highest-Scoring Final", value: "Brazil 5–2 Sweden (1958)" },
  ];

  /* =============================================================
   * 6. Share handler for app settings section
   * ============================================================= */
  const handleShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Compet 2026",
          text: "Track the FIFA World Cup 2026 — live scores, brackets, stats and more.",
          url: window.location.href,
        });
      } catch { /* user cancelled */ }
    }
  };

  /* =============================================================
   * RENDER
   * ============================================================= */
  return (
    <>
    <main className="more-view" aria-label="More">

      {/* ── Hero: Tournament Pulse ──────────────────────────── */}
      <section className="more-view__hero">
        <div className="more-view__hero-copy">
          <span>Compet 2026</span>
          <h2>Control Center</h2>
        </div>
        <div className="more-pulse" aria-label={`${progressPct}% tournament complete`}>
          <div className="more-pulse__row">
            <span className="more-pulse__stage">{stageLabel}</span>
            {countdown && <span className="more-pulse__next" suppressHydrationWarning>Next match in {countdown}</span>}
          </div>
          <div className="more-pulse__bar">
            <div className="more-pulse__fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="more-pulse__row more-pulse__row--stats">
            <span>{completedTotal}/{totalMatches} matches · {progressPct}%</span>
            <span>GS {completedGS}/72 · KO {completedKO}/32</span>
          </div>
        </div>
        <div className="more-view__hosts" aria-label="Host countries">
          {data.hosts.map(host => (
            <span key={host}>{countryFlag(host)} {host}</span>
          ))}
        </div>
      </section>

      <section className="analytics-entry-card" aria-label="Analytics Hub">
        <div>
          <span className="analytics-kicker">Analytics Hub</span>
          <h3>Team strength, confederation power, and knockout survival.</h3>
          <p>Open the full model for rankings, remaining-team survival, and matchup comparisons.</p>
        </div>
        <button type="button" onClick={() => onNavigate("analytics")}>Open Analytics</button>
      </section>

      {/* ── Section 4: Stadiums ─────────────────────────────── */}
      <section className="more-section">
        <h3 className="more-section__heading">Stadiums</h3>
        <div className="more-venue-grid">
          {venueList.map((v, i) => (
            <button
              key={v.key}
              type="button"
              className="more-venue-card"
              style={{ animationDelay: `${i * 40}ms` }}
              onClick={() => onVenueClick(v.key)}
              aria-label={`View ${v.common} on the map`}
            >
              <VenueImage venueId={v.key} venueName={v.common} city={v.city} className="more-venue-card__image" />
              <div className="more-venue-card__top">
                <span className="more-venue-card__flag" role="img" aria-label={v.country}>{countryFlag(v.country)}</span>
                <b className="more-venue-card__name">{v.common}</b>
              </div>
              <span className="more-venue-card__city">{v.city}, {v.country}</span>
              <div className="more-venue-card__stats">
                <span>{fmtNum(v.cap)} seats</span>
                <span>{v.matches} match{v.matches !== 1 ? "es" : ""}</span>
              </div>
              <span className="more-venue-card__cta" aria-hidden="true">View on map ↗</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Section 5: Host Cities ──────────────────────────── */}
      <section className="more-section">
        <h3 className="more-section__heading">Host Cities</h3>
        <div className="host-cities">
          <div className="host-cities__toolbar">
            <input
              type="search"
              className="host-cities__search"
              placeholder="Search city, stadium, country, or team..."
              value={hostQuery}
              onChange={e => setHostQuery(e.target.value)}
              aria-label="Search host cities"
            />
            <div className="host-cities__chips" role="group" aria-label="Filter host city fixtures">
              {[
                ["all", "All"],
                ["live", "Live"],
                ["upcoming", "Upcoming"],
                ["completed", "Completed"],
                ["knockout", "Knockout"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`host-cities__chip${hostFilter === key ? " host-cities__chip--active" : ""}`}
                  aria-pressed={hostFilter === key}
                  onClick={() => setHostFilter(key as MoreHostFilter)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="host-cities__layout">
            <div className="host-cities__accordions">
              {hostCountries.map(country => {
                const expanded = openCountry === country.key;
                return (
                  <article key={country.key} className={`host-country${expanded ? " host-country--open" : ""}`}>
                    <button
                      type="button"
                      className="host-country__header"
                      aria-expanded={expanded}
                      onClick={() => setOpenCountry(expanded ? "" : country.key)}
                    >
                      <span className="host-country__flag">{countryFlag(country.key)}</span>
                      <span className="host-country__title">
                        <b>{country.label}</b>
                        <small>{country.counts.cities} host cit{country.counts.cities === 1 ? "y" : "ies"} · {country.counts.stadiums} stadium{country.counts.stadiums === 1 ? "" : "s"} · {country.counts.total} matches</small>
                      </span>
                      <span className="host-country__counts">
                        <span>{country.counts.live} live</span>
                        <span>{country.counts.upcoming} upcoming</span>
                        <span>{country.counts.completed} done</span>
                      </span>
                      <span className="host-country__chevron" aria-hidden="true">⌄</span>
                    </button>

                    {expanded && (
                      <div className="host-country__body">
                        {country.matchingCities.length > 0 ? country.matchingCities.map(city => {
                          const cityOpen = openCity === city.venueId;
                          const live = city.counts.live > 0;
                          return (
                            <article key={city.venueId} className={`host-city-card${cityOpen ? " host-city-card--open" : ""}${selectedHostCity?.venueId === city.venueId ? " host-city-card--selected" : ""}`}>
                              <div className="host-city-card__summary">
                                <button
                                  type="button"
                                  className="host-city-card__main"
                                  aria-expanded={cityOpen}
                                  onClick={() => {
                                    setOpenCity(cityOpen ? null : city.venueId);
                                    setSelectedCity(city.venueId);
                                  }}
                                >
                                  <span className="host-city-card__thumb" aria-hidden="true">
                                    {city.imageUrl ? <img src={city.imageUrl} alt="" loading="lazy" /> : <span>{city.city.slice(0, 2).toUpperCase()}</span>}
                                  </span>
                                  <span className="host-city-card__copy">
                                    <b>{city.city}</b>
                                    <small>{city.stadiumName}</small>
                                  </span>
                                  {live && <span className="host-city-card__live">Live</span>}
                                  <span className="host-city-card__chevron" aria-hidden="true">⌄</span>
                                </button>
                                <button type="button" className="host-city-card__map" onClick={() => onVenueClick(city.venueId)}>
                                  View map
                                </button>
                              </div>
                              <div className="host-city-card__meta">
                                <span>{fmtNum(city.capacity)} seats</span>
                                <span>{city.counts.total} fixtures</span>
                                <span>Next: {city.nextMatch ? `${city.nextMatch.homeTeam} vs ${city.nextMatch.awayTeam}` : "Complete"}</span>
                              </div>

                              {cityOpen && (
                                <div className="host-fixture-list">
                                  {city.matchingFixtures.length > 0 ? city.matchingFixtures.map(match => (
                                    <button
                                      key={match.key}
                                      type="button"
                                      className={`host-fixture host-fixture--${match.status}`}
                                      onPointerUp={event => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        window.setTimeout(() => setHostMatchDetail({ match: match.sourceMatch, fixture: match.fixture }), 0);
                                      }}
                                      onKeyDown={event => {
                                        if (event.key !== "Enter" && event.key !== " ") return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        window.setTimeout(() => setHostMatchDetail({ match: match.sourceMatch, fixture: match.fixture }), 0);
                                      }}
                                    >
                                      <span className="host-fixture__date">{formatVenueLocalTime(match.ts, city.timezone)}</span>
                                      <span className="host-fixture__stage">{stageShortLabel(match.stage)}</span>
                                      <span className="host-fixture__teams">
                                        <b>{data.flags[match.homeTeam] || "⚽"} {match.homeTeam}</b>
                                        <small>vs</small>
                                        <b>{data.flags[match.awayTeam] || "⚽"} {match.awayTeam}</b>
                                      </span>
                                      <span className="host-fixture__venue">{city.stadiumName}</span>
                                      <span className="host-fixture__status">
                                        {match.scoreLabel && <b>{match.scoreLabel}</b>}
                                        <small>{match.statusLabel}</small>
                                      </span>
                                    </button>
                                  )) : (
                                    <div className="host-city-empty">
                                      <b>No fixtures match this filter.</b>
                                      <span>Try another status chip or search term for {city.city}.</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </article>
                          );
                        }) : (
                          <div className="host-country-empty">
                            <b>No host cities match this view.</b>
                            <span>Try All fixtures or search for a different city, stadium, country, or team.</span>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            {selectedHostCity && (
              <aside className="host-city-preview" aria-label={`${selectedHostCity.city} preview`}>
                <div className="host-city-preview__image">
                  {selectedHostCity.imageUrl ? <img src={selectedHostCity.imageUrl} alt={`${selectedHostCity.stadiumName} stadium`} loading="lazy" /> : <span>{selectedHostCity.city.slice(0, 2).toUpperCase()}</span>}
                </div>
                <div className="host-city-preview__copy">
                  <span>{countryFlag(selectedHostCity.country)} {selectedHostCity.country}</span>
                  <h4>{selectedHostCity.city}</h4>
                  <p>{selectedHostCity.stadiumName}</p>
                </div>
                <div className="host-city-preview__stats">
                  <span><b>{fmtNum(selectedHostCity.capacity)}</b> seats</span>
                  <span><b>{selectedHostCity.counts.total}</b> fixtures</span>
                  <span><b>{selectedHostCity.counts.upcoming}</b> upcoming</span>
                </div>
                <button type="button" onClick={() => onVenueClick(selectedHostCity.venueId)}>Open on Map</button>
              </aside>
            )}
          </div>
        </div>
      </section>

      {/* ── Section 6: Tournament Calendar ──────────────────── */}
      <section className="more-section">
        <h3 className="more-section__heading">Tournament Calendar</h3>
        <div className="more-timeline">
          {milestones.map((m, i) => (
            <div
              key={m.label}
              className={`more-timeline__item more-timeline__item--${m.status}`}
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="more-timeline__dot" />
              <div className="more-timeline__content">
                <b>{m.label}</b>
                <small>{m.date}</small>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 7: History ──────────────────────────────── */}
      <section className="more-section">
        <h3 className="more-section__heading">World Cup History</h3>

        {/* Past winners */}
        <div className="more-history-grid">
          {pastWinners.map((w, i) => (
            <div
              key={w.year}
              className="more-history-card"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <span className="more-history-card__year">{w.year}</span>
              <span className="more-history-card__flag">{w.flag}</span>
              <b className="more-history-card__winner">{w.winner}</b>
              <small className="more-history-card__detail">
                vs {w.runner} · {w.host}
              </small>
            </div>
          ))}
        </div>

        {/* Records */}
        <h4 className="more-section__subheading">Records</h4>
        <div className="more-records-list">
          {records.map((r, i) => (
            <div
              key={r.label}
              className="more-record-row"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <span className="more-record-row__label">{r.label}</span>
              <span className="more-record-row__value">{r.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 8: App Settings ─────────────────────────── */}
      <section className="more-section more-section--settings">
        <h3 className="more-section__heading">Settings</h3>
        <div className="more-settings-list">
          <button type="button" className="more-settings-row" onClick={() => onNavigate("about")}>
            <span className="more-settings-row__icon"><AppIcon name="info" /></span>
            <span>About Compet 2026</span>
            <span className="more-settings-row__chevron">›</span>
          </button>
          <button type="button" className="more-settings-row" onClick={() => onNavigate("settings")}>
            <span className="more-settings-row__icon"><AppIcon name="settings" /></span>
            <span>Settings Control Center</span>
            <span className="more-settings-row__chevron">›</span>
          </button>
          <button type="button" className="more-settings-row" onClick={handleShare}>
            <span className="more-settings-row__icon"><AppIcon name="share" /></span>
            <span>Share the App</span>
            <span className="more-settings-row__chevron">›</span>
          </button>
          <div className="more-settings-row more-settings-row--version">
            <span className="more-settings-row__icon"><AppIcon name="settings" /></span>
            <span>Version</span>
            <span className="more-settings-row__version">v1.0.0</span>
          </div>
        </div>
      </section>

    </main>
    {hostMatchDetail && (
      <MatchDetailDrawer
        match={hostMatchDetail.match}
        initialFixture={hostMatchDetail.fixture}
        fixtures={fixtures}
        flags={data.flags}
        venues={data.venues}
        gcolor={data.gcolor}
        allMatches={data.gs}
        vName={(k) => data.venues[k]?.common || ""}
        findLive={findLive}
        onClose={() => setHostMatchDetail(null)}
        onTeamClick={(team) => {
          setHostMatchDetail(null);
          onTeamClick(team);
        }}
        onPlayerClick={(player, team) => {
          setHostMatchDetail(null);
          onPlayerClick(player, team);
        }}
      />
    )}
    </>
  );
}

function KnockoutStageView({ data, fixtures, findLive, nowMs, onMatchClick }: {
  data: TournamentData;
  fixtures: LiveFixture[];
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null;
  nowMs: number;
  onMatchClick: (match: GroupStageMatch, fixture: LiveFixture | null) => void;
}) {
  const [activeRound, setActiveRound] = useState<KnockoutRoundKey>("r32");
  const [selectedPathKey, setSelectedPathKey] = useState<string>("");
  const [selectedTeamName, setSelectedTeamName] = useState<string>("");
  const roadScrollRef = useRef<HTMLDivElement | null>(null);
  const roadCanvasRef = useRef<HTMLDivElement | null>(null);
  const roadCenterRef = useRef<HTMLDivElement | null>(null);
  const roadScrollFrameRef = useRef<number | null>(null);
  const restoredRoadScrollRef = useRef(false);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const zoomFrameRef = useRef<number | null>(null);
  const [roadZoom, setRoadZoom] = useState(1);
  const [roadCanvasSize, setRoadCanvasSize] = useState({ width: 1260, height: 760 });
  const [roadViewportSize, setRoadViewportSize] = useState({ width: 390, height: 720 });
  const minRoadZoom = 0.35;
  const maxRoadZoom = 2.35;
  const clampRoadZoom = useCallback((value: number) => Math.min(maxRoadZoom, Math.max(minRoadZoom, value)), []);

  function venueName(code: string) {
    return data.venues[code] || { common: "", city: "", country: "" };
  }

  function fmtDate(match: KnockoutMatch) {
    const dt = parseISO(match.iso);
    return `${DOW[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}`;
  }

  const rounds = useMemo(() => {
    function sourcePair(round: KnockoutRoundKey, index: number): [number, number] {
      return KO_SOURCE_PAIRS[round]?.[index] || [index * 2, index * 2 + 1];
    }

    function sourceFor(round: KnockoutRoundKey, index: number): string {
      if (round === "r32") return R32_SEEDS[index]?.join(" vs ") || "Qualified teams";
      const [a, b] = sourcePair(round, index);
      if (round === "r16") return `W${KO_ROUNDS[0].matchNumbers[a]} / W${KO_ROUNDS[0].matchNumbers[b]}`;
      if (round === "qf") return `W${KO_ROUNDS[1].matchNumbers[a]} / W${KO_ROUNDS[1].matchNumbers[b]}`;
      if (round === "sf") return `W${KO_ROUNDS[2].matchNumbers[a]} / W${KO_ROUNDS[2].matchNumbers[b]}`;
      if (round === "final") return "W101 / W102";
      return "L101 / L102";
    }

    const cards = buildKnockoutCards(data, fixtures, findLive, nowMs);
    return KO_ROUNDS.map(config => ({
      ...config,
      cards: cards
        .filter(card => card.round === config.key)
        .map(card => ({ ...card, source: sourceFor(card.round, card.roundIndex) })),
    }));
  }, [data, findLive, fixtures, nowMs]);

  const validationWarnings = useMemo(() => {
    const warnings: string[] = [];
    const expectedCounts: Record<KnockoutRoundKey, number> = { r32: 16, r16: 8, qf: 4, sf: 2, third: 1, final: 1 };
    const actualR32Teams = new Set<string>();

    for (const round of rounds) {
      const expected = expectedCounts[round.key];
      if (round.cards.length !== expected) warnings.push(`${round.label} has ${round.cards.length} slots, expected ${expected}`);
      round.cards.forEach(card => {
        if (!card.match.ts || !card.match.v) warnings.push(`${round.label} match ${card.matchNo} is missing date/time or venue data`);
        card.teams.forEach((team, index) => {
          if (!team.name.trim()) warnings.push(`${round.label} match ${card.matchNo} side ${index + 1} has an empty team slot`);
          const isPlaceholder = team.placeholder || team.name === "TBD" || /Group|Winner|Best/i.test(team.name);
          if (round.key === "r32" && !isPlaceholder) {
            const normalized = canon(team.name);
            if (actualR32Teams.has(normalized)) warnings.push(`Duplicate R32 team "${team.name}"`);
            actualR32Teams.add(normalized);
          }
        });
      });
    }

    const r32 = rounds.find(round => round.key === "r32");
    if (!r32 || r32.cards.length !== 16) warnings.push(`Round of 32 slot count is ${r32?.cards.length ?? 0}, expected 16`);
    const winnerSeeds = new Set<string>();
    let thirdSeedCount = 0;
    R32_SEEDS.forEach((pair, index) => {
      pair.forEach(seed => {
        if (thirdSeedGroups(seed).length) {
          thirdSeedCount++;
          return;
        }
        if (!/^([12][A-L])$/.test(seed)) warnings.push(`Invalid R32 seed "${seed}" at slot ${index + 1}`);
        if (/^1[A-L]$/.test(seed)) {
          if (winnerSeeds.has(seed)) warnings.push(`Duplicate group-winner seed "${ordinalSeedLabel(seed)}" in R32 matrix`);
          winnerSeeds.add(seed);
        }
      });
    });
    const legacyAnnexWildcardSlots = Object.keys(ANNEX_C_COL_TO_R32_SLOT).length;
    const legacyAnnexCombinations = Object.keys(ANNEX_C).length;
    if (thirdSeedCount !== legacyAnnexWildcardSlots) {
      warnings.push(`R32 matrix has ${thirdSeedCount} third-place wildcard slots, expected ${legacyAnnexWildcardSlots} from the 2026 wildcard model`);
    }
    if (!legacyAnnexCombinations) warnings.push("Third-place assignment table is unavailable");
    return warnings;
  }, [rounds]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (validationWarnings.length) console.warn("[Knockout validation]", validationWarnings);
    else console.info("[Knockout validation] Bracket slots passed integrity checks");
  }, [validationWarnings]);

  const progress = calculateKnockoutProgress(rounds);
  const completed = progress.completed;
  const total = progress.total;
  const liveCount = progress.live;
  const progressPct = progress.pct;
  const currentRound = rounds.find(round => round.cards.some(card => card.isLive)) ||
    rounds.find(round => round.cards.some(card => !card.isDone)) ||
    rounds[rounds.length - 1];
  const allCards = rounds.flatMap(round => round.cards);
  const activeRoundModel = rounds.find(round => round.key === activeRound) || rounds[0];
  const nextMatch = allCards
    .filter(card => !card.isDone && card.match.ts >= nowMs)
    .sort((a, b) => a.match.ts - b.match.ts)[0] || allCards.find(card => !card.isDone);
  const lastMatch = allCards
    .filter(card => card.isDone)
    .sort((a, b) => b.match.ts - a.match.ts)[0];
  const selectedCard = allCards.find(card => card.key === selectedPathKey) || activeRoundModel?.cards[0];

  function nextDestination(card: KnockoutCardModel): string {
    if (card.round === "r32") {
      const r16Index = KO_SOURCE_PAIRS.r16?.findIndex(pair => pair.includes(card.roundIndex)) ?? -1;
      return `Winner advances to R16 Match ${r16Index >= 0 ? KO_ROUNDS[1].matchNumbers[r16Index] : "TBD"}`;
    }
    if (card.round === "r16") {
      const qfIndex = KO_SOURCE_PAIRS.qf?.findIndex(pair => pair.includes(card.roundIndex)) ?? -1;
      return `Winner advances to QF Match ${qfIndex >= 0 ? KO_ROUNDS[2].matchNumbers[qfIndex] : "TBD"}`;
    }
    if (card.round === "qf") {
      const sfIndex = KO_SOURCE_PAIRS.sf?.findIndex(pair => pair.includes(card.roundIndex)) ?? -1;
      return `Winner advances to SF Match ${sfIndex >= 0 ? KO_ROUNDS[3].matchNumbers[sfIndex] : "TBD"}`;
    }
    if (card.round === "sf") return "Winner advances to the Final";
    if (card.round === "third") return "Winner claims third place";
    return "Winner becomes champion";
  }

  // Trace forward from a card to the final (downstream = potential future path)
  function downstreamPath(card: KnockoutCardModel): KnockoutCardModel[] {
    const path: KnockoutCardModel[] = [];
    let cursor = card;
    const order: KnockoutRoundKey[] = ["r16", "qf", "sf", "final"];
    while (cursor.round !== "final" && cursor.round !== "third") {
      const nextKey = order.find(key => KO_SOURCE_PAIRS[key]?.some(pair => {
        const sourceRound = cursor.round === "r32" ? "r16" : cursor.round === "r16" ? "qf" : cursor.round === "qf" ? "sf" : cursor.round === "sf" ? "final" : "";
        return key === sourceRound && pair.includes(cursor.roundIndex);
      }));
      if (!nextKey) break;
      const nextIndex = KO_SOURCE_PAIRS[nextKey]?.findIndex(pair => pair.includes(cursor.roundIndex)) ?? -1;
      const nextCard = rounds.find(round => round.key === nextKey)?.cards[nextIndex];
      if (!nextCard) break;
      path.push(nextCard);
      cursor = nextCard;
    }
    return path;
  }

  // Trace backward from a card to R32 (upstream = how the team got here)
  function upstreamPath(card: KnockoutCardModel, teamName: string): KnockoutCardModel[] {
    const path: KnockoutCardModel[] = [];
    const roundOrder: KnockoutRoundKey[] = ["r32", "r16", "qf", "sf", "final"];
    let curRound = card.round;
    let curIndex = card.roundIndex;
    while (curRound !== "r32") {
      const pairs = KO_SOURCE_PAIRS[curRound];
      if (!pairs || !pairs[curIndex]) break;
      const [srcA, srcB] = pairs[curIndex];
      const prevRoundKey = roundOrder[roundOrder.indexOf(curRound) - 1];
      if (!prevRoundKey) break;
      const prevCards = rounds.find(round => round.key === prevRoundKey)?.cards;
      if (!prevCards) break;
      // Pick the source card whose winner matches the team we're tracing
      const cardA = prevCards[srcA];
      const cardB = prevCards[srcB];
      const normalizedTeam = canon(teamName);
      const sourceCard = (cardA?.winnerName && canon(cardA.winnerName) === normalizedTeam) ? cardA
        : (cardB?.winnerName && canon(cardB.winnerName) === normalizedTeam) ? cardB
        : null;
      if (!sourceCard) break;
      path.unshift(sourceCard);
      curRound = sourceCard.round;
      curIndex = sourceCard.roundIndex;
    }
    return path;
  }

  // Build full road: upstream (how they got here) + selected card + downstream (path ahead)
  const selectedPath = selectedCard
    ? [
        ...(selectedTeamName ? upstreamPath(selectedCard, selectedTeamName) : []),
        selectedCard,
        ...downstreamPath(selectedCard),
      ]
    : [];
  const selectedPathKeys = new Set(selectedPath.map(card => card.key));
  const shouldDim = !!selectedPathKey;
  const roundMap = new Map(rounds.map(round => [round.key, round.cards]));
  const pick = (cards: KnockoutCardModel[], indices: number[]) => indices.map(i => cards[i]).filter(Boolean);
  const roundDetail = (key: KnockoutRoundKey, cards: KnockoutCardModel[]) =>
    `${knockoutMatchRange(KO_ROUNDS.find(round => round.key === key)?.matchNumbers || [])} · ${cards.filter(card => card.isDone).length}/${cards.length} played`;
  const r32Cards = roundMap.get("r32") || [];
  const r16Cards = roundMap.get("r16") || [];
  const qfCards = roundMap.get("qf") || [];
  const sfCards = roundMap.get("sf") || [];
  const leftRoad = [
    { key: "r32" as KnockoutRoundKey, label: "RD of 32", detail: roundDetail("r32", r32Cards), cards: pick(r32Cards, [2, 5, 0, 3, 11, 10, 9, 8]) },
    { key: "r16" as KnockoutRoundKey, label: "RD 16", detail: roundDetail("r16", r16Cards), cards: pick(r16Cards, [0, 1, 4, 5]) },
    { key: "qf" as KnockoutRoundKey, label: "Quarters", detail: roundDetail("qf", qfCards), cards: pick(qfCards, [0, 1]) },
    { key: "sf" as KnockoutRoundKey, label: "Semis", detail: roundDetail("sf", sfCards), cards: pick(sfCards, [0]) },
  ];
  const rightRoad = [
    { key: "sf" as KnockoutRoundKey, label: "Semis", detail: roundDetail("sf", sfCards), cards: pick(sfCards, [1]) },
    { key: "qf" as KnockoutRoundKey, label: "Quarters", detail: roundDetail("qf", qfCards), cards: pick(qfCards, [2, 3]) },
    { key: "r16" as KnockoutRoundKey, label: "RD 16", detail: roundDetail("r16", r16Cards), cards: pick(r16Cards, [2, 3, 6, 7]) },
    { key: "r32" as KnockoutRoundKey, label: "RD of 32", detail: roundDetail("r32", r32Cards), cards: pick(r32Cards, [1, 4, 6, 7, 14, 13, 12, 15]) },
  ];
  const finalCard = (roundMap.get("final") || [])[0];
  const thirdCard = (roundMap.get("third") || [])[0];

  function selectRoad(card: KnockoutCardModel, team?: KnockoutParticipant) {
    setSelectedPathKey(card.key);
    setSelectedTeamName(team && !team.placeholder && team.name !== "TBD" ? team.name : "");
    window.requestAnimationFrame(() => centerRoadElement(roadScrollRef.current?.querySelector<HTMLElement>(`[data-card-key="${card.key}"]`)));
  }

  function centerRoadElement(element: HTMLElement | null | undefined) {
    const scroller = roadScrollRef.current;
    if (!scroller || !element) return;
    const scrollRect = scroller.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const left = scroller.scrollLeft + (elementRect.left - scrollRect.left) - ((scroller.clientWidth - elementRect.width) / 2);
    scroller.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }

  function zoomRoadTo(nextZoom: number, originX?: number, originY?: number) {
    const scroller = roadScrollRef.current;
    if (!scroller) {
      setRoadZoom(clampRoadZoom(nextZoom));
      return;
    }
    const currentZoom = roadZoom;
    const targetZoom = clampRoadZoom(nextZoom);
    if (Math.abs(currentZoom - targetZoom) < 0.001) return;
    const rect = scroller.getBoundingClientRect();
    const localX = originX == null ? scroller.clientWidth / 2 : originX - rect.left;
    const localY = originY == null ? scroller.clientHeight / 2 : originY - rect.top;
    const contentX = (scroller.scrollLeft + localX) / currentZoom;
    const contentY = (scroller.scrollTop + localY) / currentZoom;
    setRoadZoom(targetZoom);
    window.requestAnimationFrame(() => {
      const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollLeft = Math.min(maxLeft, Math.max(0, contentX * targetZoom - localX));
      scroller.scrollTop = Math.min(maxTop, Math.max(0, contentY * targetZoom - localY));
    });
  }

  function fitRoadZoom(): number {
    const scroller = roadScrollRef.current;
    if (!scroller || !roadCanvasSize.width) return 1;
    return clampRoadZoom((scroller.clientWidth - 4) / roadCanvasSize.width);
  }

  function resetRoadView() {
    const scroller = roadScrollRef.current;
    const nextZoom = fitRoadZoom();
    if (zoomFrameRef.current != null) {
      window.cancelAnimationFrame(zoomFrameRef.current);
      zoomFrameRef.current = null;
    }
    setSelectedPathKey("");
    setSelectedTeamName("");
    setActiveRound("r32");
    setRoadZoom(nextZoom);
    window.sessionStorage.setItem("compet-ko-road-zoom", String(nextZoom));
    window.sessionStorage.setItem("compet-ko-road-left", "0");
    window.sessionStorage.setItem("compet-ko-road-top", "0");
    if (!scroller) return;
    scroller.scrollTo({ left: 0, top: 0, behavior: "auto" });
    window.requestAnimationFrame(() => scroller.scrollTo({ left: 0, top: 0, behavior: "auto" }));
  }

  function scheduleZoom(nextZoom: number, originX?: number, originY?: number) {
    if (zoomFrameRef.current != null) window.cancelAnimationFrame(zoomFrameRef.current);
    zoomFrameRef.current = window.requestAnimationFrame(() => {
      zoomFrameRef.current = null;
      zoomRoadTo(nextZoom, originX, originY);
    });
  }

  function touchDistance(touches: React.TouchList) {
    const first = touches[0];
    const second = touches[1];
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
  }

  function touchCenter(touches: React.TouchList) {
    const first = touches[0];
    const second = touches[1];
    return {
      x: (first.clientX + second.clientX) / 2,
      y: (first.clientY + second.clientY) / 2,
    };
  }

  function handleRoadWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const intensity = event.deltaMode === 1 ? 0.08 : 0.0025;
    const factor = Math.exp(-event.deltaY * intensity);
    scheduleZoom(roadZoom * factor, event.clientX, event.clientY);
  }

  function handleRoadTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    pinchRef.current = {
      distance: touchDistance(event.touches),
      zoom: roadZoom,
    };
  }

  function handleRoadTouchMove(event: React.TouchEvent<HTMLDivElement>) {
    const pinch = pinchRef.current;
    if (!pinch || event.touches.length !== 2) return;
    event.preventDefault();
    const center = touchCenter(event.touches);
    const scale = touchDistance(event.touches) / pinch.distance;
    scheduleZoom(pinch.zoom * scale, center.x, center.y);
  }

  function handleRoadTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length < 2) pinchRef.current = null;
  }

  function nearestVisibleRound(): KnockoutRoundKey | null {
    const scroller = roadScrollRef.current;
    if (!scroller) return null;
    const scrollerCenter = scroller.getBoundingClientRect().left + scroller.clientWidth / 2;
    const columns = Array.from(scroller.querySelectorAll<HTMLElement>(".ko-road__column[data-round]"));
    const nearest = columns
      .map(column => {
        const rect = column.getBoundingClientRect();
        return {
          key: column.dataset.round as KnockoutRoundKey,
          distance: Math.abs((rect.left + rect.width / 2) - scrollerCenter),
        };
      })
      .sort((a, b) => a.distance - b.distance)[0];
    return nearest?.key || null;
  }

  function handleRoadScroll() {
    const scroller = roadScrollRef.current;
    if (!scroller) return;
    window.sessionStorage.setItem("compet-ko-road-left", String(scroller.scrollLeft));
    window.sessionStorage.setItem("compet-ko-road-top", String(scroller.scrollTop));
    if (roadScrollFrameRef.current != null) window.cancelAnimationFrame(roadScrollFrameRef.current);
    roadScrollFrameRef.current = window.requestAnimationFrame(() => {
      const nearest = nearestVisibleRound();
      if (nearest && nearest !== activeRound) setActiveRound(nearest);
    });
  }

  function focusRound(key: KnockoutRoundKey) {
    setActiveRound(key);
    setSelectedPathKey("");
    setSelectedTeamName("");
    window.requestAnimationFrame(() => {
      if (key === "final" || key === "third") {
        centerRoadElement(roadCenterRef.current);
        return;
      }
      const scroller = roadScrollRef.current;
      const columns = Array.from(scroller?.querySelectorAll<HTMLElement>(`.ko-road__column[data-round="${key}"]`) || []);
      const scrollerCenter = scroller ? scroller.getBoundingClientRect().left + scroller.clientWidth / 2 : 0;
      const column = columns
        .sort((a, b) => {
          const aRect = a.getBoundingClientRect();
          const bRect = b.getBoundingClientRect();
          const aCenter = aRect.left + aRect.width / 2;
          const bCenter = bRect.left + bRect.width / 2;
          return Math.abs(aCenter - scrollerCenter) - Math.abs(bCenter - scrollerCenter);
        })[0];
      centerRoadElement(column);
    });
  }

  useEffect(() => {
    const canvas = roadCanvasRef.current;
    const scroller = roadScrollRef.current;
    if (!canvas || !scroller) return;
    const update = () => {
      setRoadCanvasSize({
        width: canvas.offsetWidth || 1260,
        height: canvas.offsetHeight || 760,
      });
      setRoadViewportSize({
        width: scroller.clientWidth || 390,
        height: scroller.clientHeight || 720,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const scroller = roadScrollRef.current;
    if (!scroller) return;
    const preventBrowserZoom = (event: Event) => event.preventDefault();
    const preventMultiTouchPageZoom = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };
    scroller.addEventListener("gesturestart", preventBrowserZoom, { passive: false });
    scroller.addEventListener("gesturechange", preventBrowserZoom, { passive: false });
    scroller.addEventListener("gestureend", preventBrowserZoom, { passive: false });
    scroller.addEventListener("touchmove", preventMultiTouchPageZoom, { passive: false });
    return () => {
      scroller.removeEventListener("gesturestart", preventBrowserZoom);
      scroller.removeEventListener("gesturechange", preventBrowserZoom);
      scroller.removeEventListener("gestureend", preventBrowserZoom);
      scroller.removeEventListener("touchmove", preventMultiTouchPageZoom);
    };
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem("compet-ko-road-zoom", String(roadZoom));
  }, [roadZoom]);

  useEffect(() => {
    const scroller = roadScrollRef.current;
    if (!scroller || restoredRoadScrollRef.current) return;
    restoredRoadScrollRef.current = true;
    const savedZoom = Number(window.sessionStorage.getItem("compet-ko-road-zoom"));
    const initialZoom = Number.isFinite(savedZoom) && savedZoom > 0 ? clampRoadZoom(savedZoom) : fitRoadZoom();
    setRoadZoom(initialZoom);
    const saved = Number(window.sessionStorage.getItem("compet-ko-road-left"));
    const savedTop = Number(window.sessionStorage.getItem("compet-ko-road-top"));
    if (Number.isFinite(saved) && saved > 0) {
      window.requestAnimationFrame(() => {
        scroller.scrollLeft = saved;
        if (Number.isFinite(savedTop) && savedTop > 0) scroller.scrollTop = savedTop;
      });
      window.requestAnimationFrame(() => {
        const nearest = nearestVisibleRound();
        if (nearest) setActiveRound(nearest);
      });
      return;
    }
    window.requestAnimationFrame(() => focusRound(currentRound?.key || "r32"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRound?.key, rounds.length]);

  useEffect(() => {
    return () => {
      if (roadScrollFrameRef.current != null) window.cancelAnimationFrame(roadScrollFrameRef.current);
      if (zoomFrameRef.current != null) window.cancelAnimationFrame(zoomFrameRef.current);
    };
  }, []);

  function openMatch(card: KnockoutCardModel) {
    const [teamA, teamB] = card.teams;
    onMatchClick({
      no: card.matchNo,
      iso: card.match.iso,
      local: card.match.local,
      et: card.match.et,
      g: "KO",
      t1: teamA.name === "TBD" || teamA.placeholder ? "TBD" : teamA.name,
      t2: teamB.name === "TBD" || teamB.placeholder ? "TBD" : teamB.name,
      v: card.match.v,
      ts: card.match.ts,
    }, card.fixture);
  }

  function bracketGridRow(round: KnockoutRoundKey, index: number): string {
    if (round === "r32") return `${index * 2 + 1} / span 2`;
    if (round === "r16") return `${index * 4 + 2} / span 2`;
    if (round === "qf") return `${index * 8 + 4} / span 2`;
    if (round === "sf") return "8 / span 2";
    return "auto";
  }

  function renderRoadTeam(card: KnockoutCardModel, team: KnockoutParticipant, teamIndex: number) {
    const score = teamIndex === 0 ? card.fixture?.gh : card.fixture?.ga;
    const selected = selectedTeamName && canon(selectedTeamName) === canon(team.name);
    const teamLabel = team.placeholder || team.name === "TBD" ? `${team.seed || "TBD"} path placeholder` : `Trace ${team.name}'s path`;
    return (
      <button
        key={`${card.key}-road-team-${teamIndex}`}
        type="button"
        aria-label={teamLabel}
        className={`ko-road-team${team.winner ? " ko-road-team--winner" : ""}${team.placeholder || team.name === "TBD" ? " ko-road-team--tbd" : ""}${selected ? " ko-road-team--selected" : ""}`}
        onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          selectRoad(card, team);
        }}
      >
        <span>{team.placeholder || team.name === "TBD" ? "TBD" : (data.flags[team.name] || "⚽")}</span>
        <b>{team.name}</b>
        {team.seed && <small>{team.seed}</small>}
        {score != null && <strong>{score}</strong>}
      </button>
    );
  }

  // Build potential opponent chips for a path card that hasn't been decided yet.
  // Shows which teams from the "other branch" could be the opponent.
  function potentialOpponents(card: KnockoutCardModel): string[] {
    if (!selectedTeamName || card.isDone || card.isLive) return [];
    if (!isSelected(card)) return [];
    const normalizedTeam = canon(selectedTeamName);
    // Find which team slot the selected team occupies (or will occupy)
    const teamSide = card.teams.findIndex(t => !t.placeholder && t.name !== "TBD" && canon(t.name) === normalizedTeam);
    const otherSide = teamSide >= 0 ? 1 - teamSide : -1;
    if (otherSide < 0 || otherSide > 1) return [];
    const otherTeam = card.teams[otherSide];
    // If the other side already has a resolved team, show that
    if (otherTeam && !otherTeam.placeholder && otherTeam.name !== "TBD") return [otherTeam.name];
    // Otherwise look at the source match to find who might advance
    if (!card.sourceMatchNos) return [];
    const sourceRoundKey: KnockoutRoundKey = card.round === "r16" ? "r32" : card.round === "qf" ? "r16" : card.round === "sf" ? "qf" : card.round === "final" ? "sf" : "r32";
    const sourceCards = rounds.find(r => r.key === sourceRoundKey)?.cards || [];
    const pairs = KO_SOURCE_PAIRS[card.round];
    if (!pairs?.[card.roundIndex]) return [];
    const otherSourceIndex = pairs[card.roundIndex][otherSide];
    const sourceCard = sourceCards[otherSourceIndex];
    if (!sourceCard) return [];
    return sourceCard.teams
      .filter(t => !t.placeholder && t.name !== "TBD")
      .map(t => t.name);
  }

  function isSelected(card: KnockoutCardModel): boolean {
    return selectedPathKeys.has(card.key);
  }

  function renderRoadCard(card: KnockoutCardModel, tone: "left" | "right" | "center" = "left", style?: CSSProperties) {
    const cardIsSelected = selectedPathKeys.has(card.key);
    /* Compact status/kickoff label from canonical match data:
       live → "LIVE · 67'", finished → FT / AET / Pens, scheduled → the
       kickoff in the viewer's timezone ("Jul 5 · 8:00 PM"). Scheduled
       labels render only after mount (nowMs > 0) so the server-rendered
       HTML never bakes in the server's timezone. */
    const fx = card.fixture;
    const status = card.isLive
      ? (fx?.elapsed ? `LIVE · ${fx.elapsed}'` : "LIVE")
      : card.isDone
        ? (fx?.penHome != null && fx?.penAway != null ? "Pens" : fx?.status === "AET" ? "AET" : "FT")
        : nowMs > 0
          ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(card.match.ts)).replace(", ", " · ")
          : "";
    const v = venueName(card.match.v);
    const opponents = potentialOpponents(card);
    return (
      <article
        key={`road-${card.key}`}
        data-card-key={card.key}
        className={`ko-road-card ko-road-card--${tone}${card.isLive ? " ko-road-card--live" : ""}${card.isDone ? " ko-road-card--done" : ""}${cardIsSelected ? " ko-road-card--path" : ""}${shouldDim && !cardIsSelected ? " ko-road-card--dim" : ""}`}
        style={style}
        onClick={() => openMatch(card)}
        onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openMatch(card);
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Open match ${card.matchNo}: ${card.teams.map(team => team.name).join(" vs ")}`}
      >
        <div className="ko-road-card__top">
          <span>M{card.matchNo}</span>
          {status && <b className={card.isLive ? "ko-road-card__live-badge" : !card.isDone ? "ko-road-card__kickoff" : ""}>{status}</b>}
        </div>
        <div className="ko-road-card__teams">
          {card.teams.map((team, index) => renderRoadTeam(card, team, index))}
        </div>
        {v.common && (
          <div className="ko-road-card__venue">
            <VenueImage venueId={card.match.v} venueName={v.common} city={v.city} className="ko-road-card__venue-image" decorative />
            <span>{v.city || v.common}</span>
          </div>
        )}
        {opponents.length > 0 && (
          <div className="ko-road-card__opponents">
            <span>vs</span>
            {opponents.map(name => (
              <span key={name} className="ko-road-card__opp-chip">{data.flags[name] || "⚽"} {name}</span>
            ))}
          </div>
        )}
      </article>
    );
  }

  return (
    <section className="knockout-page ko-stage" aria-label="Knockout Stage">
      <div className="ko-control">
        <div className="ko-control__top">
          <div className="ko-control__title">
            <div className="ko-stage__eyebrow">FIFA World Cup 2026</div>
            <h2>Knockout Stage</h2>
          </div>
          <div className="ko-stage__trophy-mark" aria-hidden="true">
            <WorldCupTrophy className="ko-stage__trophy-img" />
            <span>Final Path</span>
          </div>
          <div className="ko-control__stage">{currentRound ? currentRound.short : "KO"}</div>
        </div>
        <div className="ko-control__progress" aria-label={`${completed} of ${total} knockout matches complete`}>
          <div>
            <span>{completed} of {total}</span>
            <b>{progressPct}% complete</b>
          </div>
          <i><em style={{ width: `${progressPct}%` }} /></i>
        </div>
        <div className="ko-control__grid">
          <div>
            <span>Next Match</span>
            <b>{nextMatch ? `Match ${nextMatch.matchNo}` : "TBD"}</b>
            <small>{nextMatch ? `${fmtDate(nextMatch.match)} · ${nextMatch.match.et}` : "Awaiting schedule"}</small>
          </div>
          <div>
            <span>Last Winner</span>
            <b>{lastMatch?.winnerName || "Pending"}</b>
            <small>{lastMatch ? `Match ${lastMatch.matchNo}` : "No KO results yet"}</small>
          </div>
          <div>
            <span>Current Stage</span>
            <b>{currentRound ? currentRound.label : "Pending"}</b>
            <small>{liveCount > 0 ? `${liveCount} live now` : "Live data ready"}</small>
          </div>
        </div>
      </div>

      <div className="ko-stage__tabs" role="tablist" aria-label="Knockout rounds">
        {rounds.map(round => (
          <button
            key={round.key}
            type="button"
            role="tab"
            aria-selected={activeRound === round.key}
            className={`ko-stage__tab${activeRound === round.key ? " ko-stage__tab--active" : ""}`}
            onClick={() => focusRound(round.key)}
          >
            <span>{round.label}</span>
            <small>{knockoutMatchRange(round.matchNumbers)}</small>
            <b>{round.cards.filter(card => card.isDone).length}/{round.cards.length} played</b>
          </button>
        ))}
      </div>

      <div className="ko-road" aria-label="Road to the World Cup">
        <div className="ko-road__intro">
          <span>Road to the Final</span>
          <b>{selectedTeamName ? `${selectedTeamName}'s path` : "Tap a team to trace their road to the trophy"}</b>
          <button type="button" className="ko-road__reset" onClick={resetRoadView} aria-label="Reset bracket zoom and position">Reset View</button>
        </div>
        <div
          className="bracket-scroll-shell ko-road__scroll"
          ref={roadScrollRef}
          onScroll={handleRoadScroll}
          onWheel={handleRoadWheel}
          onTouchStart={handleRoadTouchStart}
          onTouchMove={handleRoadTouchMove}
          onTouchEnd={handleRoadTouchEnd}
          onTouchCancel={handleRoadTouchEnd}
        >
          <div
            className="bracket-zoom-stage"
            style={{
              width: `${roadCanvasSize.width * roadZoom + Math.max(160, roadViewportSize.width * 0.85)}px`,
              height: `${roadCanvasSize.height * roadZoom + Math.max(120, roadViewportSize.height * 0.45)}px`,
            }}
          >
          <div
            className="bracket-canvas"
            ref={roadCanvasRef}
            style={{ transform: `scale(${roadZoom})` }}
          >
            {leftRoad.map(column => (
              <div key={`left-${column.key}`} data-round={column.key} data-side="left" aria-label={`Left side ${column.label}`} className={`ko-road__column ko-road__column--${column.key}${activeRound === column.key ? " ko-road__column--active" : ""}`}>
                <div className="ko-road__round"><span>{column.label}</span><small>{column.detail}</small></div>
                <div className="ko-road__stack">
                  {column.cards.map((card, index) => renderRoadCard(card, "left", { gridRow: bracketGridRow(column.key, index) }))}
                </div>
              </div>
            ))}

          <div className="ko-road__center" ref={roadCenterRef} aria-label="World Cup final path">
            <div className="ko-road__trophy" style={{ gridRow: "3 / span 4" }}>
              <WorldCupTrophy className="ko-road__cup-img" />
              <span>FIFA World Cup</span>
              <small>MetLife Stadium · New Jersey</small>
            </div>
            {finalCard && renderRoadCard(finalCard, "center", { gridRow: "8 / span 3" })}
            {thirdCard && (
              <div className="ko-road__third" style={{ gridRow: "12 / span 3" }}>
                <span>Third Place</span>
                {renderRoadCard(thirdCard, "center")}
              </div>
            )}
          </div>

            {rightRoad.map(column => (
              <div key={`right-${column.key}`} data-round={column.key} data-side="right" aria-label={`Right side ${column.label}`} className={`ko-road__column ko-road__column--${column.key}${activeRound === column.key ? " ko-road__column--active" : ""}`}>
                <div className="ko-road__round"><span>{column.label}</span><small>{column.detail}</small></div>
                <div className="ko-road__stack">
                  {column.cards.map((card, index) => renderRoadCard(card, "right", { gridRow: bracketGridRow(column.key, index) }))}
                </div>
              </div>
            ))}
          </div>{/* bracket-canvas */}
          </div>{/* bracket-zoom-stage */}
        </div>{/* bracket-scroll-shell */}
        <div className="ko-road__hint" aria-hidden="true">
          <span>←</span>
          <b>Pinch or Ctrl-scroll to zoom · drag to pan</b>
          <span>→</span>
        </div>
      </div>

      {selectedTeamName && selectedPath.length > 0 && (
        <div className="ko-journey" aria-label={`${selectedTeamName}'s road to the final`}>
          <div className="ko-journey__header">
            <span className="ko-journey__flag">{data.flags[selectedTeamName] || "⚽"}</span>
            <div>
              <div className="ko-journey__title">{selectedTeamName}</div>
              <div className="ko-journey__sub">Road to the Final</div>
            </div>
            <button type="button" className="ko-journey__clear" onClick={() => { setSelectedPathKey(""); setSelectedTeamName(""); }} aria-label="Clear selection">&times;</button>
          </div>
          <div className="ko-journey__rail">
            {selectedPath.map((card, index) => {
              const v = venueName(card.match.v);
              return (
                <button key={card.key} type="button" className={`ko-journey__step${card.isDone ? " ko-journey__step--done" : ""}${card.isLive ? " ko-journey__step--live" : ""}`} onClick={() => openMatch(card)}>
                  <span className="ko-journey__round">{card.round === "final" ? "Final" : card.round === "third" ? "3rd" : card.round.toUpperCase()}</span>
                  <span className="ko-journey__vs">{card.teams.map(t => t.placeholder || t.name === "TBD" ? "TBD" : t.name).join(" vs ")}</span>
                  {card.isDone && card.fixture && <span className="ko-journey__score">{card.fixture.gh} – {card.fixture.ga}</span>}
                  <span className="ko-journey__venue">{fmtDate(card.match)} · {v.common || card.match.et}</span>
                  {index < selectedPath.length - 1 && <span className="ko-journey__arrow" aria-hidden="true">→</span>}
                </button>
              );
            })}
            <div className="ko-journey__step ko-journey__step--trophy">
              <WorldCupTrophy className="ko-journey__cup" />
              <span className="ko-journey__round">Champion</span>
            </div>
          </div>
        </div>
      )}

      <p className="ko-stage__note">
        Tap a team to trace their road to the trophy. Tap any match for full details.
        {process.env.NODE_ENV === "development" && validationWarnings.length > 0 ? ` Dev: ${validationWarnings.length} bracket warning${validationWarnings.length === 1 ? "" : "s"}.` : ""}
      </p>
    </section>
  );
}

function CountdownHero({ data, fixtures, findLive }: {
  data: TournamentData;
  fixtures: LiveFixture[];
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null;
}) {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    queueMicrotask(() => {
      setMounted(true);
      setNow(Date.now());
    });
    const id = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => clearInterval(id);
  }, []);

  const fl = (t: string) => data.flags[t] || "⚽";
  const jumpToNext = () => {
    document.getElementById("next-match-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const handleKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      jumpToNext();
    }
  };

  const liveMatches: { match: GroupStageMatch; fixture: LiveFixture }[] = [];
  for (const m of data.gs) {
    const f = findLive(m, fixtures);
    if (f && LIVE_STATUSES.has(f.status)) liveMatches.push({ match: m, fixture: f });
  }
  const liveKoCards = buildKnockoutCards(data, fixtures, findLive, now)
    .filter(card => card.isLive && card.fixture);

  if (liveMatches.length > 0 || liveKoCards.length > 0) {
    if (!liveMatches.length && liveKoCards.length > 0) {
      const card = liveKoCards[0];
      const fixture = card.fixture!;
      const v = data.venues[card.match.v];
      const elapsed = fixture.status === "HT" ? "Half Time" : (fixture.elapsed ? `${fixture.elapsed}'` : "LIVE");
      const home = card.teams[0]?.name || fixture.home;
      const away = card.teams[1]?.name || fixture.away;
      const liveCount = liveMatches.length + liveKoCards.length;
      return (
        <div className="cd-hero cd-hero--live">
          <PitchLines />
          <div className="cd-hero__label"><span className="cd-hero__pulse" />{liveCount > 1 ? `${liveCount} MATCHES LIVE` : "LIVE NOW"}</div>
          <div className="cd-hero__teams">
            <div className="cd-hero__side"><span className="cd-hero__flag">{fl(home)}</span><span className="cd-hero__name">{home}</span></div>
            <div className="cd-hero__score-live">{fixture.gh ?? 0} – {fixture.ga ?? 0}</div>
            <div className="cd-hero__side"><span className="cd-hero__flag">{fl(away)}</span><span className="cd-hero__name">{away}</span></div>
          </div>
          <div className="cd-hero__info">{elapsed}{v ? ` · ${v.common}, ${v.city}` : ""}</div>
        </div>
      );
    }
    const { match, fixture } = liveMatches[0];
    const v = data.venues[match.v];
    const elapsed = fixture.status === "HT" ? "Half Time" : (fixture.elapsed ? `${fixture.elapsed}'` : "LIVE");
    const liveCount = liveMatches.length + liveKoCards.length;
    return (
      <div className="cd-hero cd-hero--live">
        <PitchLines />
        <div className="cd-hero__label"><span className="cd-hero__pulse" />{liveCount > 1 ? `${liveCount} MATCHES LIVE` : "LIVE NOW"}</div>
        <div className="cd-hero__teams">
          <div className="cd-hero__side"><span className="cd-hero__flag">{fl(match.t1)}</span><span className="cd-hero__name">{match.t1}</span></div>
          <div className="cd-hero__score-live">{fixture.gh ?? 0} – {fixture.ga ?? 0}</div>
          <div className="cd-hero__side"><span className="cd-hero__flag">{fl(match.t2)}</span><span className="cd-hero__name">{match.t2}</span></div>
        </div>
        <div className="cd-hero__info">{elapsed}{v ? ` · ${v.common}, ${v.city}` : ""}</div>
      </div>
    );
  }

  let nextGs: GroupStageMatch | null = null;
  for (const m of data.gs) {
    if (m.ts > now && (!nextGs || m.ts < nextGs.ts)) nextGs = m;
  }
  const nextKo = buildKnockoutCards(data, fixtures, findLive, now)
    .filter(card => card.match.ts > now && !card.isDone)
    .sort((a, b) => a.match.ts - b.match.ts)[0] || null;

  const useGs = nextGs && (!nextKo || nextGs.ts <= nextKo.match.ts);
  const ts = useGs ? nextGs!.ts : nextKo?.match.ts;
  if (!ts) return null;

  const diff = Math.max(0, ts - now);
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const mn = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  const isoDate = useGs ? nextGs!.iso : nextKo!.match.iso;
  const d = parseISO(isoDate);
  const etTime = useGs ? nextGs!.et : nextKo!.match.et;
  const venCode = useGs ? nextGs!.v : nextKo!.match.v;
  const v = data.venues[venCode];
  const koTeams = nextKo?.teams || null;

  return (
    <div className="cd-hero" role="button" tabIndex={0} onClick={jumpToNext} onKeyDown={handleKey} aria-label="Jump to next match">
      <PitchLines />
      <div className="cd-hero__label">NEXT MATCH <span className="cd-hero__tap" aria-hidden="true">↘</span></div>
      <div className="cd-hero__countdown" suppressHydrationWarning>
        <span className="cd-hero__digit" suppressHydrationWarning>{mounted ? pad(h) : "--"}</span>
        <span className="cd-hero__colon">:</span>
        <span className="cd-hero__digit" suppressHydrationWarning>{mounted ? pad(mn) : "--"}</span>
        <span className="cd-hero__colon">:</span>
        <span className="cd-hero__digit" suppressHydrationWarning>{mounted ? pad(s) : "--"}</span>
      </div>
      {useGs && nextGs ? (
        <div className="cd-hero__teams">
          <div className="cd-hero__side"><span className="cd-hero__flag">{fl(nextGs.t1)}</span><span className="cd-hero__name">{nextGs.t1}</span></div>
          <span className="cd-hero__vs">vs</span>
          <div className="cd-hero__side"><span className="cd-hero__flag">{fl(nextGs.t2)}</span><span className="cd-hero__name">{nextGs.t2}</span></div>
        </div>
      ) : nextKo && koTeams ? (
        <>
          <div className="cd-hero__teams">
            <div className="cd-hero__side"><span className="cd-hero__flag">{koTeams[0].placeholder ? "TBD" : fl(koTeams[0].name)}</span><span className="cd-hero__name">{koTeams[0].name}</span></div>
            <span className="cd-hero__vs">vs</span>
            <div className="cd-hero__side"><span className="cd-hero__flag">{koTeams[1].placeholder ? "TBD" : fl(koTeams[1].name)}</span><span className="cd-hero__name">{koTeams[1].name}</span></div>
          </div>
          <div className="cd-hero__round">{nextKo.match.round}</div>
        </>
      ) : null}
      <div className="cd-hero__info">{DOW[d.getDay()]} {d.getDate()} {MON[d.getMonth()]} · {etTime}{v ? ` · ${v.common}` : ""}</div>
    </div>
  );
}

function posLabel(p: string): string {
  return ({ GK: "Goalkeeper", DF: "Defender", MF: "Midfielder", FW: "Forward" }[p]) || p;
}

function posColor(p: string): string {
  return ({ GK: "#b58900", DF: "#2563eb", MF: "#0A5C3E", FW: "#D23B2E" }[p]) || "#5C6B62";
}

type PlayerImageSource = {
  name?: string;
  team?: string;
  imageUrl?: string | null;
  headshotUrl?: string | null;
  avatarUrl?: string | null;
};

type PlayerAvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = (parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
  return initials.toUpperCase();
}

/* ── Global player-image index ─────────────────────────────────
   Aggregates every headshot URL seen in live data (fixture player stats,
   lineups, ESPN leader stats) keyed by canonical player name. PlayerAvatar
   consults it when its direct source carries no image, so static-roster
   surfaces (team squads, player profiles) still show real headshots once a
   player has appeared in any data source. */
const PLAYER_IMAGE_INDEX = new Map<string, string>();

function playerImageKey(name: string, team?: string): string {
  return `${nrm(canonPlayer(name))}|${team ? nrm(canon(team)) : ""}`;
}

function indexPlayerImage(name: string | undefined, team: string | undefined, source: PlayerImageSource): void {
  const url = source.headshotUrl || source.imageUrl || source.avatarUrl;
  if (!name || !url) return;
  // First-seen wins: sources are processed most-reliable-first and headshot
  // URLs for a player rarely change mid-tournament.
  const teamKey = playerImageKey(name, team);
  if (!PLAYER_IMAGE_INDEX.has(teamKey)) PLAYER_IMAGE_INDEX.set(teamKey, url);
  const nameKey = playerImageKey(name);
  if (!PLAYER_IMAGE_INDEX.has(nameKey)) PLAYER_IMAGE_INDEX.set(nameKey, url);
}

/* Rebuilds the index from the current live payload. Called from the top-level
   Tournament component whenever fixtures or leader stats change. */
function rebuildPlayerImageIndex(fixtures: LiveFixture[], leaderStats: ExternalLeaderStat[]): void {
  // ESPN leader stats first — their headshots are the highest quality
  for (const leader of leaderStats) indexPlayerImage(leader.name, leader.team, leader);
  for (const f of fixtures) {
    for (const p of f.players || []) indexPlayerImage(p.name, p.team, p);
    for (const lineup of f.lineups || []) {
      for (const p of [...lineup.startXI, ...lineup.substitutes]) indexPlayerImage(p.name, lineup.team, p);
    }
  }
}

function playerImageUrl(player?: PlayerImageSource | null): string | null {
  return player?.headshotUrl || player?.imageUrl || player?.avatarUrl || null;
}

function playerTeamColors(teamName: string): { primary: string; secondary: string } {
  const colors = TEAM_PROFILES[teamName]?.kitColors;
  return {
    primary: colors?.primary || "#0A5C3E",
    secondary: colors?.secondary || "#D4AF37",
  };
}

function PlayerAvatar({ playerName, teamName, player, size = "md", className = "" }: {
  playerName: string;
  teamName: string;
  player?: PlayerImageSource | null;
  size?: PlayerAvatarSize;
  className?: string;
}) {
  /* Resolution order: direct source (fixture data) → live-data index (ESPN
     leaders + match payloads) → baked-in squad photos from the one-time
     fetch script (covers bench players who never appear in live data). */
  const src = playerImageUrl(player)
    || PLAYER_IMAGE_INDEX.get(playerImageKey(playerName, teamName))
    || PLAYER_IMAGE_INDEX.get(playerImageKey(playerName))
    || playerPhotoUrl(PLAYER_PHOTO_IDS[playerImageKey(playerName, teamName)] ?? PLAYER_PHOTO_IDS[playerImageKey(playerName)])
    || null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && src !== failedSrc;
  const colors = playerTeamColors(teamName);
  const style = {
    "--player-avatar-primary": colors.primary,
    "--player-avatar-secondary": colors.secondary,
  } as CSSProperties;

  useEffect(() => {
    setFailedSrc(null);
  }, [src]);

  return (
    <span
      className={`player-avatar player-avatar--${size} ${className}`}
      style={style}
      role={showImage ? undefined : "img"}
      aria-label={showImage ? undefined : `${playerName} headshot`}
    >
      {showImage ? (
        <img
          src={src}
          alt={`${playerName} headshot`}
          width={64}
          height={64}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span className="player-avatar__initials" aria-hidden="true">{playerInitials(playerName)}</span>
      )}
    </span>
  );
}

function findFixturePlayer(fixture: LiveFixture | null | undefined, playerName: string, teamName: string): PlayerMatchStat | undefined {
  return fixture?.players?.find(player => canon(player.team) === canon(teamName) && nrm(player.name) === nrm(playerName));
}

function PlayerProfileDrawer({ playerName, teamName, flags, data, onClose, onTeamClick }: {
  playerName: string;
  teamName: string;
  flags: Record<string, string>;
  data: TournamentData;
  onClose: () => void;
  onTeamClick: (team: string) => void;
}) {
  const profile = TEAM_PROFILES[teamName];
  const player = profile?.squad.find(p => p.name === playerName);
  const flag = flags[teamName] || "⚽";

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const groupLetter = Object.entries(data.groups).find(([, teams]) => teams.includes(teamName))?.[0] || null;
  const groupMatches = data.gs.filter(m => m.t1 === teamName || m.t2 === teamName);
  const headerBg = profile?.kitColors.primary || "#0A5C3E";
  const lightColors = ["#FFFFFF","#FFDF00","#FCD116","#FECC02","#FFB81C","#FFCD00","#FF8200","#FFD100"];
  const headerText = lightColors.includes(headerBg) ? "#122019" : "#fff";

  if (!player) {
    return (
      <div className="drawer-overlay" onClick={onClose}>
        <div className="drawer pp-drawer" onClick={e => e.stopPropagation()}>
          <div className="pp-drawer__header" style={{ background: headerBg, color: headerText }}>
            <button className="drawer__close" onClick={onClose} aria-label="Close">&times;</button>
            <PlayerAvatar playerName={playerName} teamName={teamName} size="xl" />
            <div className="pp-drawer__name">{playerName}</div>
            <button className="pp-drawer__team-link" onClick={() => { onClose(); onTeamClick(teamName); }}>
              {flag} {teamName} →
            </button>
          </div>
          <div className="drawer__body">
            <p style={{ textAlign: "center", color: "#5C6B62", padding: "40px 20px" }}>Detailed profile not available yet.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer pp-drawer" onClick={e => e.stopPropagation()}>
        <div className="pp-drawer__header" style={{ background: headerBg, color: headerText }}>
          <button className="drawer__close" onClick={onClose} aria-label="Close">&times;</button>
          <PlayerAvatar playerName={player.name} teamName={teamName} player={player} size="xl" />
          {player.number != null && <div className="pp-drawer__number">{player.number}</div>}
          <div className="pp-drawer__name">{player.name}</div>
          <div className="pp-drawer__pos" style={{ background: posColor(player.pos) }}>{posLabel(player.pos)}</div>
        </div>

        <div className="drawer__body">
          <button className="pp-drawer__team-row" onClick={() => { onClose(); onTeamClick(teamName); }}>
            <span>{flag}</span>
            <span className="pp-drawer__team-name">{teamName}</span>
            {groupLetter && <span className="pp-drawer__group" style={{ color: data.gcolor[groupLetter] }}>Group {groupLetter}</span>}
            <span className="pp-drawer__arrow">→</span>
          </button>

          <div className="drawer__stats-grid">
            <div className="drawer__stat"><span className="drawer__stat-val">{player.age}</span><span className="drawer__stat-lbl">Age</span></div>
            <div className="drawer__stat"><span className="drawer__stat-val">{player.caps}</span><span className="drawer__stat-lbl">Caps</span></div>
            <div className="drawer__stat"><span className="drawer__stat-val">{player.goals}</span><span className="drawer__stat-lbl">Int&apos;l Goals</span></div>
            {player.number != null && <div className="drawer__stat"><span className="drawer__stat-val">#{player.number}</span><span className="drawer__stat-lbl">Jersey</span></div>}
          </div>

          <div className="drawer__section">
            <h3 className="drawer__h3">Club</h3>
            <p className="drawer__text">{player.club}</p>
          </div>

          <div className="drawer__section">
            <h3 className="drawer__h3">Position</h3>
            <p className="drawer__text" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="drawer__player-pos" style={{ background: posColor(player.pos) }}>{player.pos}</span>
              {posLabel(player.pos)}
            </p>
          </div>

          {groupMatches.length > 0 && (
            <div className="drawer__section">
              <h3 className="drawer__h3">Group Stage Schedule</h3>
              {groupMatches.map(m => {
                const d = parseISO(m.iso);
                const opponent = m.t1 === teamName ? m.t2 : m.t1;
                const isHome = m.t1 === teamName;
                return (
                  <div key={m.no} className="drawer__match">
                    <div className="drawer__match-date">{d.getDate()} {MON[d.getMonth()]}</div>
                    <div className="drawer__match-vs">
                      <span>{flag}</span>
                      <span className="drawer__match-ha">{isHome ? "vs" : "@"}</span>
                      <span>{flags[opponent] || "⚽"} {opponent}</span>
                    </div>
                    <div className="drawer__match-time">{m.et}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HostCountryDrawer({ country, data, onClose }: {
  country: string;
  data: TournamentData;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while drawer is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const venueCountry = country === "United States" ? "USA" : country;
  const venues = useMemo(() => Object.entries(data.venues)
    .filter(([, venue]) => venue.country === venueCountry)
    .map(([key, venue]) => ({ key, ...venue }))
    .sort((a, b) => b.cap - a.cap), [data.venues, venueCountry]);
  const allMatches = useMemo(() => [...data.gs, ...data.ko], [data.gs, data.ko]);
  const venueKeys = new Set(venues.map(v => v.key));
  const hostMatches = allMatches.filter(match => venueKeys.has(match.v));
  const matchCount = hostMatches.length;
  const capacity = venues.reduce((sum, venue) => sum + venue.cap, 0);
  const keyMatch = useMemo(() => {
    const final = hostMatches.find(match => "round" in match && match.round === "Final");
    if (final) return final;
    const opener = hostMatches.find(match => "no" in match && match.no === 1);
    if (opener) return opener;
    return hostMatches.sort((a, b) => a.ts - b.ts)[0] || null;
  }, [hostMatches]);
  const profile = HOST_COUNTRY_PROFILES[country] || HOST_COUNTRY_PROFILES["United States"];

  const keyVenue = keyMatch ? data.venues[keyMatch.v] : null;
  const keyDate = keyMatch ? parseISO(keyMatch.iso) : null;
  const heroVenue = venues[0] || null;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer host-drawer" onClick={e => e.stopPropagation()} aria-label={`${country} host profile`}>
        <button className="drawer__close" onClick={onClose} aria-label="Close">&times;</button>
        <div className="host-drawer__hero">
          {heroVenue
            ? <VenueImage venueId={heroVenue.key} venueName={heroVenue.common} city={heroVenue.city} className="host-drawer__hero-image" />
            : <span className="host-drawer__flag">{data.flags[country] || "⚽"}</span>}
          <div>
            <small>Host Country</small>
            <h2>{country}</h2>
            <p>{profile.profile}</p>
          </div>
        </div>
        <div className="host-drawer__stats">
          <div><b>{venues.length}</b><span>Venues</span></div>
          <div><b>{matchCount}</b><span>Matches</span></div>
          <div><b>{capacity.toLocaleString("en-US")}</b><span>Total seats</span></div>
        </div>
        {keyMatch && keyVenue && keyDate && (
          <section className="host-drawer__key">
            <VenueImage venueId={keyMatch.v} venueName={keyVenue.common} city={keyVenue.city} className="host-drawer__key-image" />
            <div>
              <span>Key Match</span>
              <b>{"round" in keyMatch ? keyMatch.round : `Match ${keyMatch.no}`}</b>
              <small>{MON[keyDate.getMonth()]} {keyDate.getDate()} · {keyMatch.et} · {keyVenue.common}</small>
            </div>
          </section>
        )}
        <section className="host-drawer__section">
          <h3>Venues</h3>
          <div className="host-drawer__venues">
            {venues.map(venue => {
              const count = hostMatches.filter(match => match.v === venue.key).length;
              return (
                <div key={venue.key} className="host-drawer__venue">
                  <VenueImage venueId={venue.key} venueName={venue.common} city={venue.city} className="host-drawer__venue-image" />
                  <div>
                    <b>{venue.common}</b>
                    <small>{venue.city} · {venue.fifa}</small>
                  </div>
                  <span>{venue.cap.toLocaleString("en-US")} · {count} match{count !== 1 ? "es" : ""}</span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="host-drawer__section">
          <h3>Fun Facts</h3>
          <div className="host-drawer__facts">
            {profile.facts.map(fact => <span key={fact}>{fact}</span>)}
          </div>
        </section>
      </aside>
    </div>
  );
}

const HOST_COUNTRY_PROFILES: Record<string, { profile: string; facts: string[] }> = {
  Canada: {
    profile: "Toronto and Vancouver bring Canada into the men’s World Cup hosting era with compact, high-energy city venues.",
    facts: ["2 host cities", "BMO Field opens Canada’s home schedule", "BC Place adds a West Coast indoor venue"],
  },
  Mexico: {
    profile: "Mexico anchors the tournament with three football cities and the opening match at Estadio Azteca.",
    facts: ["First country to host matches in three men’s World Cups", "Opening match in Mexico City", "Three venues across Mexico City, Guadalajara and Monterrey"],
  },
  "United States": {
    profile: "The United States carries the largest venue footprint, including the Final at MetLife Stadium.",
    facts: ["11 host venues", "Final in New York / New Jersey", "Cross-country schedule from Los Angeles to Miami"],
  },
};

function TeamDrawer({ name, flags, groups, gcolor, gs, hosts, onClose, onPlayerClick }: {
  name: string;
  flags: Record<string, string>;
  groups: Record<string, string[]>;
  gcolor: Record<string, string>;
  gs: GroupStageMatch[];
  hosts: string[];
  onClose: () => void;
  onPlayerClick: (playerName: string, teamName: string) => void;
}) {
  const profile = TEAM_PROFILES[name];
  const flag = flags[name] || "⚽";
  const isHost = hosts.includes(name);

  const groupLetter = Object.entries(groups).find(([, teams]) => teams.includes(name))?.[0] || null;
  const groupMatches = gs.filter(m => m.t1 === name || m.t2 === name);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!profile) {
    return (
      <div className="drawer-overlay" onClick={onClose}>
        <div className="drawer" onClick={e => e.stopPropagation()}>
          <div className="drawer__header">
            <button className="drawer__close" onClick={onClose} aria-label="Close">&times;</button>
            <div className="drawer__flag">{flag}</div>
            <h2 className="drawer__name">{name}</h2>
          </div>
          <div className="drawer__body">
            <p style={{ textAlign: "center", color: "#5C6B62", padding: "40px 20px" }}>Profile data not available yet.</p>
          </div>
        </div>
      </div>
    );
  }

  const byPos: Record<string, PlayerInfo[]> = {};
  for (const p of profile.squad) {
    if (!byPos[p.pos]) byPos[p.pos] = [];
    byPos[p.pos].push(p);
  }
  const posOrder = ["GK", "DF", "MF", "FW"];

  const headerTextColor = (() => {
    const light = ["#FFFFFF","#FFDF00","#FCD116","#FECC02","#FFB81C","#FFCD00","#FF8200","#FFD100"];
    return light.includes(profile.kitColors.primary) ? "#122019" : "#fff";
  })();

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer__header" style={{ background: profile.kitColors.primary, color: headerTextColor }}>
          <button className="drawer__close" onClick={onClose} aria-label="Close">&times;</button>
          <div className="drawer__flag">{flag}</div>
          <h2 className="drawer__name">{name}</h2>
          {profile.nickname && <div className="drawer__nick">{profile.nickname}</div>}
          {isHost && <span className="drawer__host">HOST NATION</span>}
        </div>

        <div className="drawer__body">
          <div className="drawer__stats-grid">
            <div className="drawer__stat">
              <span className="drawer__stat-val">{profile.fifaRanking}</span>
              <span className="drawer__stat-lbl">FIFA Rank</span>
            </div>
            <div className="drawer__stat">
              <span className="drawer__stat-val">{profile.wcAppearances}</span>
              <span className="drawer__stat-lbl">WC Apps</span>
            </div>
            <div className="drawer__stat">
              <span className="drawer__stat-val">{profile.confederation}</span>
              <span className="drawer__stat-lbl">Conf.</span>
            </div>
            {groupLetter && (
              <div className="drawer__stat">
                <span className="drawer__stat-val" style={{ color: gcolor[groupLetter] }}>{groupLetter}</span>
                <span className="drawer__stat-lbl">Group</span>
              </div>
            )}
          </div>

          <div className="drawer__section">
            <div className="drawer__badge">Best Finish</div>
            <p className="drawer__best">{profile.bestFinish}</p>
          </div>

          <div className="drawer__section">
            <h3 className="drawer__h3">History</h3>
            <p className="drawer__text">{profile.history}</p>
          </div>

          <div className="drawer__section">
            <h3 className="drawer__h3">Coach</h3>
            <p className="drawer__text">{profile.coach}</p>
          </div>

          {groupMatches.length > 0 && (
            <div className="drawer__section">
              <h3 className="drawer__h3">Group Matches</h3>
              {groupMatches.map(m => {
                const d = parseISO(m.iso);
                const opponent = m.t1 === name ? m.t2 : m.t1;
                const isHome = m.t1 === name;
                return (
                  <div key={m.no} className="drawer__match">
                    <div className="drawer__match-date">{d.getDate()} {MON[d.getMonth()]}</div>
                    <div className="drawer__match-vs">
                      <span>{flag}</span>
                      <span className="drawer__match-ha">{isHome ? "vs" : "@"}</span>
                      <span>{flags[opponent] || "⚽"} {opponent}</span>
                    </div>
                    <div className="drawer__match-time">{m.et}</div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="drawer__section">
            <h3 className="drawer__h3">Official Squad</h3>
            {posOrder.filter(pos => byPos[pos]).map(pos => (
              <div key={pos}>
                <div className="drawer__pos-head" style={{ color: posColor(pos) }}>{posLabel(pos)}s</div>
                {byPos[pos].map(p => (
                  <div key={p.name} className="drawer__player drawer__player--clickable" onClick={() => onPlayerClick(p.name, name)} role="button" tabIndex={0}>
                    <div className="drawer__player-main">
                      <PlayerAvatar playerName={p.name} teamName={name} player={p} size="sm" />
                      {p.number && <span className="drawer__player-num">{p.number}</span>}
                      <span className="drawer__player-name">{p.name}</span>
                      <span className="drawer__player-pos" style={{ background: posColor(p.pos) }}>{p.pos}</span>
                      <span className="drawer__player-arrow">›</span>
                    </div>
                    <div className="drawer__player-meta">
                      <span>{p.club}</span>
                      <span className="drawer__player-sep">&middot;</span>
                      <span>Age {p.age}</span>
                      <span className="drawer__player-sep">&middot;</span>
                      <span>{p.caps} caps</span>
                      {p.goals > 0 && <><span className="drawer__player-sep">&middot;</span><span>{p.goals} goals</span></>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function eventIcon(type: string, detail: string): string {
  if (type === "Goal" && detail === "Own Goal") return "🔴";
  if (type === "Goal" && detail === "Penalty") return "⚽️";
  if (type === "Goal") return "⚽";
  if (type === "Card" && detail.includes("Red")) return "🟥";
  if (type === "Card") return "🟨";
  if (type === "subst") return "🔄";
  if (type === "Var") return "📺";
  return "•";
}

type MdTab = "summary" | "stats" | "lineups" | "report";

const MATCH_DETAIL_CACHE = new Map<number, LiveFixture>();

function playerPayloadScore(players?: PlayerMatchStat[]): number {
  if (!players?.length) return 0;
  return players.reduce((score, player) => {
    const detailedFields = [
      player.rating, player.shots, player.shotsOn, player.passes, player.passAccuracy,
      player.tackles, player.duels, player.duelsWon, player.dribbles, player.dribblesSuccess,
      player.foulsDrawn, player.foulsCommitted, player.saves,
    ];
    return score + 1 + detailedFields.filter(value => value !== undefined && value !== null && value !== 0 && value !== "").length;
  }, 0);
}

function richerPlayerPayload(primary?: PlayerMatchStat[], fallback?: PlayerMatchStat[]): PlayerMatchStat[] | undefined {
  if (!primary?.length) return fallback;
  if (!fallback?.length) return primary;
  return playerPayloadScore(fallback) > playerPayloadScore(primary) ? fallback : primary;
}

function mergeRichFixture(primary: LiveFixture | null, fallback: LiveFixture | null): LiveFixture | null {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    ...primary,
    events: primary.events?.length ? primary.events : fallback.events,
    stats: primary.stats && (Object.keys(primary.stats.home).length || Object.keys(primary.stats.away).length) ? primary.stats : fallback.stats,
    lineups: (primary.lineups?.length || 0) >= 2 ? primary.lineups : (fallback.lineups || primary.lineups),
    players: richerPlayerPayload(primary.players, fallback.players),
    referee: primary.referee || fallback.referee,
    fixtureId: primary.fixtureId || fallback.fixtureId,
  };
}

function MatchDetailDrawer({ match, initialFixture, fixtures, flags, venues, gcolor, allMatches, vName: _vName, findLive, onClose, onTeamClick, onPlayerClick }: {
  match: GroupStageMatch;
  initialFixture: LiveFixture | null;
  fixtures: LiveFixture[];
  flags: Record<string, string>;
  venues: Record<string, { common: string; fifa: string; city: string; country: string; cap: number }>;
  gcolor: Record<string, string>;
  allMatches: GroupStageMatch[];
  vName: (k: string) => string;
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null;
  onClose: () => void;
  onTeamClick: (team: string) => void;
  onPlayerClick: (playerName: string, teamName: string) => void;
}) {
  const [tab, setTab] = useState<MdTab>("summary");
  const [nowMs, setNowMs] = useState(0);
  const [detailFixture, setDetailFixture] = useState<LiveFixture | null>(() => MATCH_DETAIL_CACHE.get(match.no) || null);
  useEffect(() => {
    queueMicrotask(() => setNowMs(Date.now()));
    const id = setInterval(() => { if (!document.hidden) setNowMs(Date.now()); }, 60000);
    return () => clearInterval(id);
  }, []);
  const liveFixture = findLive(match, fixtures) || initialFixture;
  const fetchMatchDetail = useCallback(async () => {
    if (!match.no) return;
    try {
      const res = await fetch(`/api/match/${match.no}`, { cache: "no-store" });
      if (!res.ok) return;
      const payload = await res.json().catch(() => null) as { fixture?: LiveFixture } | null;
      if (!payload?.fixture) return;
      MATCH_DETAIL_CACHE.set(match.no, payload.fixture);
      setDetailFixture(payload.fixture);
    } catch {
      // Detail is an enhancement; the drawer can still render the live list payload.
    }
  }, [match.no]);
  useEffect(() => {
    const cached = MATCH_DETAIL_CACHE.get(match.no);
    if (cached) setDetailFixture(cached);
    fetchMatchDetail();
  }, [fetchMatchDetail, match.no]);
  useEffect(() => {
    const status = liveFixture?.status || match.dbStatus || "";
    if (!LIVE_STATUSES.has(status)) return;
    const id = window.setInterval(fetchMatchDetail, 30000);
    return () => window.clearInterval(id);
  }, [fetchMatchDetail, liveFixture?.status, match.dbStatus]);
  const persistedFixture: LiveFixture | null = match.dbStatus ? {
    ts: match.ts,
    status: match.dbStatus,
    elapsed: match.dbElapsed ?? null,
    venue: venues[match.v]?.common || "",
    round: `Group Stage - ${match.g}`,
    home: match.t1,
    away: match.t2,
    gh: match.dbGh ?? null,
    ga: match.dbGa ?? null,
    events: match.dbEvents,
    stats: match.dbStats,
    lineups: match.dbLineups,
    players: match.dbPlayers,
    referee: match.dbReferee || undefined,
    fixtureId: match.dbFixtureId || undefined,
  } : null;
  const storedFixture = mergeRichFixture(detailFixture, persistedFixture);
  const fixture = mergeRichFixture(liveFixture, storedFixture);

  const hasKickedOff = match.ts <= nowMs + 5 * 60000;
  const hasDbScore = match.dbStatus && match.dbGh != null && match.dbGa != null;
  const fixtureStale = fixture ? isStaleStatus(match.ts, fixture.status, nowMs) : false;
  const dbStale = match.dbStatus ? isStaleStatus(match.ts, match.dbStatus, nowMs) : false;
  const isLive = !fixtureStale && (fixture ? LIVE_STATUSES.has(fixture.status) : (hasKickedOff && hasDbScore && !dbStale ? LIVE_STATUSES.has(match.dbStatus!) : false));
  const isDone = hasKickedOff && !fixtureStale && !dbStale && (fixture ? DONE_STATUSES.has(fixture.status) : (hasDbScore ? DONE_STATUSES.has(match.dbStatus!) : false));
  const isStale = fixtureStale || (hasKickedOff && dbStale && !fixture);
  const isUpcoming = !isLive && !isDone && !isStale;

  const scoreGh = fixture ? (fixture.gh ?? 0) : (match.dbGh ?? 0);
  const scoreGa = fixture ? (fixture.ga ?? 0) : (match.dbGa ?? 0);
  const statusLabel = fixture ? fixture.status : (match.dbStatus || "");
  const v = venues[match.v] || { common: "", city: "", country: "" };

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  /* Browser-back closes the drawer instead of leaving the app. A history
     entry is pushed on open; popstate closes the drawer, and closing via
     the Back/× buttons or Escape consumes that entry so the history stack
     stays balanced. onClose lives in a ref so this runs once per open. */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closedByPopRef = useRef(false);
  const historyReadyRef = useRef(false);
  useEffect(() => {
    historyReadyRef.current = false;
    window.history.pushState({ competMatchDrawer: true }, "");
    queueMicrotask(() => {
      historyReadyRef.current = true;
    });
    const onPop = () => {
      closedByPopRef.current = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (historyReadyRef.current && !closedByPopRef.current && window.history.state?.competMatchDrawer) window.history.back();
    };
  }, []);

  /* Kickoff moment for the header meta lines — full ET date (the app's
     reference clock) plus the viewer's local time when it differs. All
     derived from the canonical match timestamp, never hardcoded. */
  const kickoffDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric",
  }).format(new Date(match.ts));
  const viewerTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(match.ts));
  const viewerDiffers = !match.et.startsWith(viewerTime);
  const roundLabel = match.g === "KO"
    ? (fixture?.round && !/group/i.test(fixture.round) ? fixture.round : "Knockout")
    : `Group ${match.g}`;

  const homeGoals = fixture ? (fixture.events || []).filter(e => {
    if (e.type !== "Goal") return false;
    const isOG = e.detail === "Own Goal";
    const sameTeam = canon(e.team) === canon(fixture.home);
    return isOG ? !sameTeam : sameTeam;
  }) : [];
  const awayGoals = fixture ? (fixture.events || []).filter(e => {
    if (e.type !== "Goal") return false;
    const isOG = e.detail === "Own Goal";
    const sameTeam = canon(e.team) === canon(fixture.away);
    return isOG ? !sameTeam : sameTeam;
  }) : [];

  const statKeys = ["Ball Possession", "Total Shots", "Shots on Goal", "Corner Kicks", "Fouls", "Offsides", "Yellow Cards", "Red Cards", "Goalkeeper Saves", "Total passes", "Passes accurate"];
  const statLabels: Record<string, string> = {
    "Ball Possession": "Possession", "Total Shots": "Shots", "Shots on Goal": "On Target",
    "Corner Kicks": "Corners", "Fouls": "Fouls", "Offsides": "Offsides",
    "Yellow Cards": "Yellows", "Red Cards": "Reds", "Goalkeeper Saves": "Saves",
    "Total passes": "Passes", "Passes accurate": "Accurate Passes",
  };

  const hasStats = fixture?.stats && (Object.keys(fixture.stats.home).length > 0);
  function renderScoreHeader() {
    return (
      <div className="md-drawer__header" style={{ borderTopColor: gcolor[match.g] || "#0A5C3E" }}>
        <button className="md-drawer__back" onClick={onClose} aria-label="Back to previous view">
          <span aria-hidden="true">‹</span> Back
        </button>
        <button className="drawer__close" onClick={onClose} aria-label="Close">&times;</button>
        <div className="md-drawer__badge">{roundLabel} · Match #{match.no}</div>

        {/* Kickoff moment + venue — always visible, upcoming or finished.
            match.et already carries its "ET" suffix. */}
        <div className="md-drawer__when">
          {kickoffDate} · {match.et}{viewerDiffers ? ` · ${viewerTime} local` : ""}
        </div>
        {v.common && <div className="md-drawer__where">{v.common} · {v.city}, {v.country}</div>}

        <div className="md-drawer__score-row">
          <button className="md-drawer__team md-drawer__team--link" onClick={() => onTeamClick(match.t1)} aria-label={`View ${match.t1} profile`}>
            <span className="md-drawer__flag">{flags[match.t1] || "⚽"}</span>
            <span className="md-drawer__team-name">{match.t1}</span>
          </button>
          <div className="md-drawer__score">
            {isUpcoming ? (
              <span className="md-drawer__time-display">{match.et}</span>
            ) : (
              <>
                <span className="md-drawer__goals">{scoreGh}</span>
                <span className="md-drawer__sep">–</span>
                <span className="md-drawer__goals">{scoreGa}</span>
              </>
            )}
          </div>
          <button className="md-drawer__team md-drawer__team--link" onClick={() => onTeamClick(match.t2)} aria-label={`View ${match.t2} profile`}>
            <span className="md-drawer__flag">{flags[match.t2] || "⚽"}</span>
            <span className="md-drawer__team-name">{match.t2}</span>
          </button>
        </div>

        <div className="md-drawer__status">
          {isLive && <span className="md-drawer__live">{statusLabel === "HT" ? "HALF TIME" : `${fixture?.elapsed || ""}'`}</span>}
          {isDone && <span className="md-drawer__ft">{statusLabel === "AET" ? "AFTER EXTRA TIME" : statusLabel === "PEN" ? "PENALTIES" : "FULL TIME"}</span>}
          {isStale && <span className="md-drawer__updating">Updating...</span>}
          {isUpcoming && <span className="md-drawer__upcoming">UPCOMING</span>}
        </div>

        {!isUpcoming && (homeGoals.length > 0 || awayGoals.length > 0) && (
          <div className="md-drawer__scorers-row">
            <div className="md-drawer__scorers-col">
              {homeGoals.map((g, i) => {
                const min = g.extra ? `${g.minute}+${g.extra}'` : `${g.minute}'`;
                const pen = g.detail === "Penalty" ? " (P)" : g.detail === "Own Goal" ? " (OG)" : "";
                const scorerTeam = g.team || match.t1;
                return (
                  <div key={i} className="md-drawer__scorer">
                    <PlayerAvatar playerName={g.player} teamName={scorerTeam} player={findFixturePlayer(fixture, g.player, scorerTeam)} size="xs" />
                    <span>⚽ {g.player} {min}{pen}</span>
                  </div>
                );
              })}
            </div>
            <div className="md-drawer__scorers-col md-drawer__scorers-col--away">
              {awayGoals.map((g, i) => {
                const min = g.extra ? `${g.minute}+${g.extra}'` : `${g.minute}'`;
                const pen = g.detail === "Penalty" ? " (P)" : g.detail === "Own Goal" ? " (OG)" : "";
                const scorerTeam = g.team || match.t2;
                return (
                  <div key={i} className="md-drawer__scorer md-drawer__scorer--away">
                    <span>{g.player} {min}{pen} ⚽</span>
                    <PlayerAvatar playerName={g.player} teamName={scorerTeam} player={findFixturePlayer(fixture, g.player, scorerTeam)} size="xs" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(isDone || isLive) && typeof navigator !== "undefined" && navigator.share && (
          <button
            className="share-btn"
            style={{ margin: "8px auto 4px", display: "flex" }}
            onClick={() => {
              const text = `${flags[match.t1] || ""} ${match.t1} ${scoreGh} – ${scoreGa} ${match.t2} ${flags[match.t2] || ""}\n${isDone ? "Full Time" : `${fixture?.elapsed || ""}'`} · FIFA World Cup 2026`;
              navigator.share({ text }).catch(() => {});
            }}
          >
            ↗ Share Result
          </button>
        )}

        {!isUpcoming && (
          <div className="md-tabs" role="tablist">
            {(["summary", "stats", "lineups", "report"] as MdTab[]).map(t => {
              const label: Record<MdTab, string> = { summary: "Summary", stats: "Stats", lineups: "Lineups", report: "Report" };
              return (
                <button key={t} role="tab" aria-selected={tab === t} className={`md-tab${tab === t ? " md-tab--active" : ""}`}
                  onClick={() => setTab(t)}>
                  {label[t]}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderSummaryTab() {
    return (
      <>
        <div className="md-drawer__venue">
          <VenueImage venueId={match.v} venueName={v.common} city={v.city} className="md-drawer__venue-image" />
          <div>
            {v.common} · {v.city}, {v.country}
            <br />{match.et}{match.local !== match.et ? ` (${match.local})` : ""}
            {fixture?.referee && <><br />Referee: {fixture.referee}</>}
          </div>
        </div>

        {fixture?.events && fixture.events.length > 0 && (
          <div className="drawer__section">
            <h3 className="drawer__h3">Match Timeline</h3>
            <div className="md-drawer__timeline">
              {fixture.events.map((ev, i) => {
                const isHome = canon(ev.team) === canon(match.t1);
                const min = ev.extra ? `${ev.minute}+${ev.extra}'` : `${ev.minute}'`;
                return (
                  <div key={i} className={`md-drawer__event ${isHome ? "md-drawer__event--home" : "md-drawer__event--away"}`}>
                    <span className="md-drawer__event-min">{min}</span>
                    <span className="md-drawer__event-icon">{eventIcon(ev.type, ev.detail)}</span>
                    <span className="md-drawer__event-text">
                      {ev.player}
                      {ev.type === "Goal" && ev.assist && <span className="md-drawer__event-assist"> (assist: {ev.assist})</span>}
                      {ev.type === "Goal" && ev.detail === "Penalty" && <span className="md-drawer__event-detail"> PEN</span>}
                      {ev.type === "Goal" && ev.detail === "Own Goal" && <span className="md-drawer__event-detail"> OG</span>}
                      {ev.type === "subst" && ev.assist && <span className="md-drawer__event-assist"> ↩ {ev.assist}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {hasStats && (
          <div className="drawer__section">
            <h3 className="drawer__h3">Key Stats</h3>
            <div className="md-drawer__stats">
              {["Ball Possession", "Total Shots", "Shots on Goal", "Corner Kicks", "Fouls"].filter(k => fixture!.stats!.home[k] != null).map(k => {
                const hv = fixture!.stats!.home[k];
                const av = fixture!.stats!.away[k];
                const hNum = typeof hv === "string" ? parseInt(hv) : (hv ?? 0);
                const aNum = typeof av === "string" ? parseInt(av) : (av ?? 0);
                const total = (typeof hNum === "number" ? hNum : 0) + (typeof aNum === "number" ? aNum : 0);
                const hPct = total > 0 ? (typeof hNum === "number" ? hNum : 0) / total * 100 : 50;
                return (
                  <div key={k} className="md-drawer__stat-row">
                    <span className="md-drawer__stat-val">{hv ?? 0}</span>
                    <div className="md-drawer__stat-bar-wrap">
                      <div className="md-drawer__stat-label">{statLabels[k] || k}</div>
                      <div className="md-drawer__stat-bar">
                        <div className="md-drawer__stat-bar-h" style={{ width: `${hPct}%` }} />
                        <div className="md-drawer__stat-bar-a" style={{ width: `${100 - hPct}%` }} />
                      </div>
                    </div>
                    <span className="md-drawer__stat-val">{av ?? 0}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>
    );
  }

  function renderStatsTab() {
    if (!fixture?.stats) return (
      <div className="md-drawer__empty-section">
        <div className="md-drawer__empty-icon"><AppIcon name="stats" /></div>
        <div className="md-drawer__empty-title">Match Statistics</div>
        <div className="md-drawer__empty-desc">Possession, shots, passes, fouls, and more will appear here {isDone ? "once data is synced" : "once the match kicks off"}.</div>
      </div>
    );
    const visibleStatKeys = [
      ...statKeys,
      ...Object.keys(fixture.stats.home),
      ...Object.keys(fixture.stats.away),
    ].filter((key, index, arr) => arr.indexOf(key) === index);
    return (
      <div className="drawer__section" style={{ marginTop: 0 }}>
        <div className="md-drawer__stats-header">
          <span>{flags[match.t1] || "⚽"} {match.t1}</span>
          <span>{match.t2} {flags[match.t2] || "⚽"}</span>
        </div>
        <div className="md-drawer__stats">
          {visibleStatKeys.filter(k => fixture.stats!.home[k] != null || fixture.stats!.away[k] != null).map(k => {
            const hv = fixture.stats!.home[k];
            const av = fixture.stats!.away[k];
            const hNum = typeof hv === "string" ? parseInt(hv) : (hv ?? 0);
            const aNum = typeof av === "string" ? parseInt(av) : (av ?? 0);
            const total = (typeof hNum === "number" ? hNum : 0) + (typeof aNum === "number" ? aNum : 0);
            const hPct = total > 0 ? (typeof hNum === "number" ? hNum : 0) / total * 100 : 50;
            return (
              <div key={k} className="md-drawer__stat-row">
                <span className="md-drawer__stat-val">{hv ?? 0}</span>
                <div className="md-drawer__stat-bar-wrap">
                  <div className="md-drawer__stat-label">{statLabels[k] || k}</div>
                  <div className="md-drawer__stat-bar">
                    <div className="md-drawer__stat-bar-h" style={{ width: `${hPct}%` }} />
                    <div className="md-drawer__stat-bar-a" style={{ width: `${100 - hPct}%` }} />
                  </div>
                </div>
                <span className="md-drawer__stat-val">{av ?? 0}</span>
              </div>
            );
          })}
        </div>

        {fixture.players && fixture.players.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h3 className="drawer__h3">Top Performers</h3>
            <div className="md-drawer__performers">
              {[...fixture.players].filter(p => p.rating).sort((a, b) => parseFloat(b.rating || "0") - parseFloat(a.rating || "0")).slice(0, 6).map((p, i) => (
                <div key={i} className="md-drawer__performer">
                  <PlayerAvatar playerName={p.name} teamName={p.team} player={p} size="sm" />
                  <div className="md-drawer__performer-rating">{parseFloat(p.rating || "0").toFixed(1)}</div>
                  <div className="md-drawer__performer-info">
                    <span className="md-drawer__performer-name">{p.name}</span>
                    <span className="md-drawer__performer-team">{flags[p.team] || "⚽"} {p.team}</span>
                  </div>
                  <div className="md-drawer__performer-stats">
                    {p.goals > 0 && <span>{p.goals}G</span>}
                    {p.assists > 0 && <span>{p.assists}A</span>}
                    {p.shotsOn > 0 && <span>{p.shotsOn} SoT</span>}
                    {p.tackles > 0 && <span>{p.tackles} Tkl</span>}
                    {p.passAccuracy && <span>{p.passAccuracy} Pass</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderLineupTeam(lineup: TeamLineup, teamName: string) {
    const resolvedTeam = canon(teamName);
    const matchTeam = canon(match.t1) === resolvedTeam ? match.t1 : match.t2;
    return (
      <div className="md-lineup">
        <div className="md-lineup__header">
          <span className="md-lineup__flag">{flags[matchTeam] || "⚽"}</span>
          <span className="md-lineup__team">{matchTeam}</span>
          <span className="md-lineup__formation">{lineup.formation}</span>
        </div>
        <div className="md-lineup__section-label">Starting XI</div>
        {lineup.startXI.map((p, i) => {
          const playerStats = fixture?.players?.find(ps => ps.number === p.number && canon(ps.team) === canon(teamName));
          return (
            <div key={i} className="md-lineup__player md-lineup__player--clickable" onClick={() => onPlayerClick(p.name, matchTeam)} role="button" tabIndex={0}>
              <PlayerAvatar playerName={p.name} teamName={matchTeam} player={playerStats || p} size="xs" />
              <span className="md-lineup__num">{p.number}</span>
              <span className="md-lineup__name">{p.name}</span>
              <span className="md-lineup__pos" data-pos={p.pos}>{p.pos}</span>
              {playerStats?.rating && <span className="md-lineup__rating">{parseFloat(playerStats.rating).toFixed(1)}</span>}
              {playerStats && (playerStats.goals > 0 || playerStats.yellowCards > 0 || playerStats.redCards > 0) && (
                <span className="md-lineup__icons">
                  {playerStats.goals > 0 && "⚽"}
                  {playerStats.yellowCards > 0 && "🟨"}
                  {playerStats.redCards > 0 && "🟥"}
                </span>
              )}
            </div>
          );
        })}
        {lineup.substitutes.length > 0 && (
          <>
            <div className="md-lineup__section-label">Substitutes</div>
            {lineup.substitutes.map((p, i) => (
              <div key={i} className="md-lineup__player md-lineup__player--sub md-lineup__player--clickable" onClick={() => onPlayerClick(p.name, matchTeam)} role="button" tabIndex={0}>
                <PlayerAvatar playerName={p.name} teamName={matchTeam} player={findFixturePlayer(fixture, p.name, matchTeam) || p} size="xs" />
                <span className="md-lineup__num">{p.number}</span>
                <span className="md-lineup__name">{p.name}</span>
                <span className="md-lineup__pos" data-pos={p.pos}>{p.pos}</span>
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  function renderFormation(lineup: TeamLineup, teamName: string, flip: boolean) {
    const resolvedTeam = canon(teamName) === canon(match.t1) ? match.t1 : match.t2;
    const rows: Record<number, { name: string; number: number; pos: string; col: number }[]> = {};
    for (const p of lineup.startXI) {
      if (!p.grid) continue;
      const [r, c] = p.grid.split(":").map(Number);
      if (!rows[r]) rows[r] = [];
      rows[r].push({ name: p.name, number: p.number, pos: p.pos, col: c });
    }
    const sortedRows = Object.keys(rows).map(Number).sort((a, b) => flip ? b - a : a - b);
    const maxRow = Math.max(...sortedRows, 5);
    return (
      <div className="fm-pitch">
        <div className="fm-pitch__label">
          <span className="fm-pitch__flag">{flags[resolvedTeam] || "⚽"}</span>
          <span>{resolvedTeam}</span>
          <span className="fm-pitch__formation">{lineup.formation}</span>
        </div>
        <div className="fm-pitch__field">
          {sortedRows.map(row => {
            const players = rows[row].sort((a, b) => a.col - b.col);
            const maxCol = Math.max(...players.map(p => p.col), 1);
            return (
              <div key={row} className="fm-pitch__row" style={{ top: `${((flip ? maxRow - row : row - 1) / (maxRow - 1)) * 85 + 5}%` }}>
                {players.map((p, i) => {
                  const left = maxCol === 1 ? 50 : (p.col - 1) / (maxCol - 1) * 70 + 15;
                  const ps = fixture?.players?.find(ps => ps.number === p.number && canon(ps.team) === canon(teamName));
                  return (
                    <button key={i} className="fm-pitch__player" style={{ left: `${left}%` }}
                      onClick={() => onPlayerClick(p.name, resolvedTeam)}>
                      <PlayerAvatar playerName={p.name} teamName={resolvedTeam} player={ps || p} size="xs" />
                      <span className="fm-pitch__num">{p.number}</span>
                      <span className="fm-pitch__name">{p.name.split(" ").pop()}</span>
                      {ps?.rating && <span className="fm-pitch__rating">{parseFloat(ps.rating).toFixed(1)}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderLineupsTab() {
    if (!fixture?.lineups || fixture.lineups.length === 0) return (
      <div className="drawer__section" style={{ marginTop: 0 }}>
        <div className="md-drawer__empty-section">
          <div className="md-drawer__empty-icon">👥</div>
          <div className="md-drawer__empty-title">Confirmed Lineups Pending</div>
          <div className="md-drawer__empty-desc">Starting XIs and substitutions will sync from live enrichment. Until then, the available squad lists are shown below.</div>
        </div>
        {renderSquadColumn(match.t1)}
        {renderSquadColumn(match.t2)}
      </div>
    );
    const hasGrid = fixture.lineups.length >= 2 && fixture.lineups[0].startXI.some(p => p.grid) && fixture.lineups[1].startXI.some(p => p.grid);
    return (
      <div className="drawer__section" style={{ marginTop: 0 }}>
        {hasGrid && (
          <div className="fm-wrap">
            {renderFormation(fixture.lineups[0], fixture.lineups[0].team, false)}
            <div className="fm-divider" />
            {renderFormation(fixture.lineups[1], fixture.lineups[1].team, true)}
          </div>
        )}
        {fixture.lineups.map((lineup, index) => (
          <div key={`${lineup.team}-${index}`}>
            {index > 0 && <div style={{ height: 16 }} />}
            {renderLineupTeam(lineup, lineup.team)}
          </div>
        ))}
      </div>
    );
  }

  function renderReportTab() {
    if (!fixture || !isDone) return (
      <div className="md-drawer__empty-section">
        <div className="md-drawer__empty-icon">📝</div>
        <div className="md-drawer__empty-title">Match Report</div>
        <div className="md-drawer__empty-desc">A full match summary with goals, cards, and key moments will be generated after the final whistle.</div>
      </div>
    );

    const events = fixture.events || [];
    const goals = events.filter(e => e.type === "Goal");
    const cards = events.filter(e => e.type === "Card");
    const subs = events.filter(e => e.type === "subst");
    const gh = fixture.gh ?? 0;
    const ga = fixture.ga ?? 0;

    const homeGoals = goals.filter(e => {
      const isOG = e.detail === "Own Goal";
      const sameTeam = canon(e.team) === canon(fixture.home);
      return isOG ? !sameTeam : sameTeam;
    });
    const awayGoals = goals.filter(e => {
      const isOG = e.detail === "Own Goal";
      const sameTeam = canon(e.team) === canon(fixture.away);
      return isOG ? !sameTeam : sameTeam;
    });
    const possession = fixture.stats?.home?.["Ball Possession"];

    let narrative = "";

    if (gh === ga) {
      narrative += `${match.t1} and ${match.t2} played out a ${gh}–${ga} draw at ${v.common} in ${v.city}. `;
    } else {
      const winner = gh > ga ? match.t1 : match.t2;
      const loser = gh > ga ? match.t2 : match.t1;
      const winScore = Math.max(gh, ga);
      const loseScore = Math.min(gh, ga);
      narrative += `${winner} ${winScore === 1 && loseScore === 0 ? "edged past" : "defeated"} ${loser} ${winScore}–${loseScore} at ${v.common} in ${v.city}. `;
    }

    if (goals.length > 0) {
      const opener = goals[0];
      narrative += `${opener.player} opened the scoring in the ${opener.minute}${opener.extra ? `+${opener.extra}` : ""}’ minute`;
      if (opener.assist) narrative += ` with an assist from ${opener.assist}`;
      narrative += `. `;
    }

    if (homeGoals.length > 1) {
      narrative += `${match.t1} added ${homeGoals.length - 1} more goal${homeGoals.length > 2 ? "s" : ""} through ${homeGoals.slice(1).map(g => g.player).join(" and ")}. `;
    }
    if (awayGoals.length > 1) {
      narrative += `${match.t2} responded with goal${awayGoals.length > 1 ? "s" : ""} from ${awayGoals.map(g => g.player).join(" and ")}. `;
    }

    if (possession) {
      narrative += `${match.t1} controlled ${possession} of possession. `;
    }

    const totalShots = (fixture.stats?.home?.["Total Shots"] || 0) as number;
    const totalShotsAway = (fixture.stats?.away?.["Total Shots"] || 0) as number;
    if (totalShots || totalShotsAway) {
      narrative += `The shot count finished ${totalShots}–${totalShotsAway}. `;
    }

    if (cards.length > 0) {
      const yellows = cards.filter(c => c.detail.includes("Yellow")).length;
      const reds = cards.filter(c => c.detail.includes("Red")).length;
      if (yellows > 0) narrative += `The referee showed ${yellows} yellow card${yellows !== 1 ? "s" : ""}`;
      if (reds > 0) narrative += `${yellows > 0 ? " and " : ""}${reds} red card${reds !== 1 ? "s" : ""}`;
      narrative += `. `;
    }

    if (subs.length > 0) {
      narrative += `There were ${subs.length} substitution${subs.length !== 1 ? "s" : ""} across both sides. `;
    }

    const topPerformers = (fixture.players || [])
      .filter(p => p.rating)
      .sort((a, b) => parseFloat(b.rating || "0") - parseFloat(a.rating || "0"))
      .slice(0, 3);

    return (
      <div className="drawer__section" style={{ marginTop: 0 }}>
        <div className="report">
          <div className="report__header">
            <span className="report__badge">Match Report</span>
            <span className="report__match">Group {match.g} · Match #{match.no}</span>
          </div>

          <h3 className="report__title">
            {match.t1} {gh} – {ga} {match.t2}
          </h3>

          <p className="report__narrative">{narrative}</p>

          {topPerformers.length > 0 && (
            <div className="report__section">
              <h4 className="report__h4">Player of the Match</h4>
              {topPerformers.map((p, i) => (
                <div key={i} className="report__potm">
                  <PlayerAvatar playerName={p.name} teamName={p.team} player={p} size="sm" />
                  <span className="report__potm-rating">{parseFloat(p.rating || "0").toFixed(1)}</span>
                  <span className="report__potm-name">{p.name}</span>
                  <span className="report__potm-team">{flags[p.team] || "⚽"} {p.team}</span>
                  <span className="report__potm-stats">
                    {p.goals > 0 && `${p.goals}G `}
                    {p.assists > 0 && `${p.assists}A `}
                    {p.passAccuracy && `${p.passAccuracy} pass`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {goals.length > 0 && (
            <div className="report__section">
              <h4 className="report__h4">Goals</h4>
              {goals.map((g, i) => {
                const min = g.extra ? `${g.minute}+${g.extra}'` : `${g.minute}'`;
                return (
                  <div key={i} className="report__goal">
                    <span className="report__goal-min">{min}</span>
                    <span className="report__goal-player">
                      <PlayerAvatar playerName={g.player} teamName={g.team} player={findFixturePlayer(fixture, g.player, g.team)} size="xs" />
                      <span>{eventIcon(g.type, g.detail)} {g.player}</span>
                    </span>
                    <span className="report__goal-team">{flags[g.team] || "⚽"}</span>
                    {g.detail !== "Normal Goal" && <span className="report__goal-detail">({g.detail})</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderSquadColumn(teamName: string) {
    const profile = TEAM_PROFILES[teamName];
    if (!profile) return null;
    const posOrder = ["GK", "DF", "MF", "FW"];
    const byPos: Record<string, PlayerInfo[]> = {};
    for (const p of profile.squad) {
      if (!byPos[p.pos]) byPos[p.pos] = [];
      byPos[p.pos].push(p);
    }
    return (
      <div className="md-squad">
        <div className="md-squad__header">
          <span>{flags[teamName] || "⚽"}</span>
          <span className="md-squad__team">{teamName}</span>
        </div>
        {posOrder.filter(pos => byPos[pos]).map(pos => (
          <div key={pos}>
            <div className="md-squad__pos" style={{ color: posColor(pos) }}>{posLabel(pos)}s</div>
            {byPos[pos].map(p => (
              <div key={p.name} className="md-squad__player" onClick={() => onPlayerClick(p.name, teamName)} role="button" tabIndex={0}>
                <PlayerAvatar playerName={p.name} teamName={teamName} player={p} size="xs" />
                {p.number != null && <span className="md-squad__num">{p.number}</span>}
                <span className="md-squad__name">{p.name}</span>
                <span className="md-squad__club">{p.club}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  function renderUpcomingBody() {
    const profile1 = TEAM_PROFILES[match.t1];
    const profile2 = TEAM_PROFILES[match.t2];
    return (
      <>
        <div className="md-drawer__venue">
          <VenueImage venueId={match.v} venueName={v.common} city={v.city} className="md-drawer__venue-image" />
          <div>
            {v.common} · {v.city}, {v.country}
            <br />{match.et}{match.local !== match.et ? ` (${match.local})` : ""}
          </div>
        </div>
        <div className="md-drawer__prematch">
          <div className="md-drawer__prematch-row">
            <button className="md-drawer__prematch-team" onClick={() => onTeamClick(match.t1)}>
              <span className="md-drawer__prematch-flag">{flags[match.t1] || "⚽"}</span>
              <span>{match.t1}</span>
              <span className="md-drawer__prematch-arrow">→</span>
            </button>
          </div>
          <div className="md-drawer__prematch-row">
            <button className="md-drawer__prematch-team" onClick={() => onTeamClick(match.t2)}>
              <span className="md-drawer__prematch-flag">{flags[match.t2] || "⚽"}</span>
              <span>{match.t2}</span>
              <span className="md-drawer__prematch-arrow">→</span>
            </button>
          </div>
        </div>

        {(profile1 || profile2) && (
          <div className="drawer__section">
            <h3 className="drawer__h3">Official Squads</h3>
            {renderSquadColumn(match.t1)}
            {renderSquadColumn(match.t2)}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer md-drawer" onClick={e => e.stopPropagation()}>
        {renderScoreHeader()}
        <div className="drawer__body">
          {isUpcoming && renderUpcomingBody()}
          {!isUpcoming && tab === "summary" && renderSummaryTab()}
          {!isUpcoming && tab === "stats" && renderStatsTab()}
          {!isUpcoming && tab === "lineups" && renderLineupsTab()}
          {!isUpcoming && tab === "report" && renderReportTab()}
        </div>
      </div>
    </div>
  );
}

type StatTabKey = "goals" | "assists" | "yellows" | "reds";

type LeaderboardCategory = {
  key: StatTabKey;
  label: string;
  statLabel: string;
  total: number;
  totalLabel: string;
  empty: string;
  leaders: PlayerLeader[];
  value: (leader: PlayerLeader) => number;
  detail: (leader: PlayerLeader) => string;
};

const KNOWN_TEAM_NAMES = new Set(Object.keys(TEAM_PROFILES).map(team => canon(team)));

function isRenderableLeader(leader: PlayerLeader): boolean {
  const name = leader.name?.trim();
  if (!name || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(name)) return false;
  if (canon(name) === canon(leader.team)) return false;
  return !KNOWN_TEAM_NAMES.has(canon(name));
}

function rankFor(leaders: PlayerLeader[], index: number, value: (leader: PlayerLeader) => number): number {
  if (index === 0) return 1;
  const current = value(leaders[index]);
  const previous = value(leaders[index - 1]);
  return current === previous ? rankFor(leaders, index - 1, value) : index + 1;
}

function playerMeta(leader: PlayerLeader): { number?: number; pos?: string; club?: string; player?: PlayerInfo } {
  const squad = TEAM_PROFILES[leader.team]?.squad || [];
  const found = squad.find(p => nrm(p.name) === nrm(leader.name));
  return found ? { number: found.number, pos: found.pos, club: found.club, player: found } : {};
}

function StatsLeaderboard({ categories, active, onActive, fl, matchesWithAssistData, matchesPlayed }: {
  categories: LeaderboardCategory[];
  active: StatTabKey;
  onActive: (key: StatTabKey) => void;
  fl: (team: string) => string;
  matchesWithAssistData: number;
  matchesPlayed: number;
}) {
  const category = categories.find(c => c.key === active) || categories[0];
  const leaders = category.leaders.filter(isRenderableLeader);
  const max = Math.max(...leaders.map(category.value), 1);
  const showCoverage = (category.key === "assists" || category.key === "goals") && matchesPlayed > 0;

  return (
    <section className="stats-leaders" aria-label="Stat leaders">
      <div className="stats-leaders__head">
        <div>
          <span className="stats-leaders__eyebrow">Live Leaderboard</span>
          <h3>Stat Leaders</h3>
        </div>
        <span className="stats-leaders__live"><i />Real-time</span>
      </div>

      <div className="stats-tabs" role="tablist" aria-label="Stat leader categories">
        {categories.map(c => (
          <button key={c.key} type="button" role="tab" aria-selected={active === c.key} className="stats-tab" onClick={() => onActive(c.key)}>
            <span>{c.label}</span>
            <b>{c.total}</b>
            <small>{c.totalLabel}</small>
          </button>
        ))}
      </div>

      {showCoverage && (
        <div className="stats-leaders__coverage">
          {category.key === "goals"
            ? `${category.total} total goals are counted from match scores. Player scorer rows show the credited goal events available from the live data feed.`
            : matchesWithAssistData < matchesPlayed
              ? `Assist data available for ${matchesWithAssistData} of ${matchesPlayed} matches. ${matchesPlayed - matchesWithAssistData} matches lack detailed assist data from the source API.`
              : `Assist data synced across all ${matchesPlayed} completed matches.`}
        </div>
      )}

      {leaders.length === 0 ? (
        <div className="stats-leaders__empty">
          <span>{category.key === "assists" ? "A" : category.key === "goals" ? "G" : category.key === "yellows" ? "Y" : "R"}</span>
          <b>{category.empty}</b>
          <small>Real match events and player stats power this board. No placeholder leaders are shown.</small>
        </div>
      ) : (
        <div className="stats-leaderboard-list">
          {leaders.slice(0, 12).map((leader, index) => {
            const value = category.value(leader);
            const pct = (value / max) * 100;
            const rank = rankFor(leaders, index, category.value);
            const meta = playerMeta(leader);
            const avatarSource = playerImageUrl(leader) ? leader : meta.player;
            return (
              <article key={`${category.key}-${leader.name}-${leader.team}`} className={`stats-leader-card${index < 3 ? " stats-leader-card--podium" : ""}`}>
                <div className="stats-leader-card__rank">#{rank}</div>
                <PlayerAvatar playerName={leader.name} teamName={leader.team} player={avatarSource} size="lg" className="stats-leader-card__photo" />
                <div className="stats-leader-card__main">
                  <div className="stats-leader-card__name-row">
                    <b>{leader.name}</b>
                    {meta.number != null && <small>#{meta.number}</small>}
                    {meta.pos && <small>{meta.pos}</small>}
                  </div>
                  <div className="stats-leader-card__team"><span>{fl(leader.team)}</span>{leader.team}{meta.club ? ` · ${meta.club}` : ""}</div>
                  <div className="stats-leader-card__bar"><i style={{ width: `${pct}%` }} /></div>
                </div>
                <div className="stats-leader-card__value">
                  <strong>{value}</strong>
                  <span>{category.statLabel}</span>
                  <em>{category.detail(leader)}</em>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Stats view — tournament dashboard with visualizations */
function StatsView({ fl, computeLeaders, liveTs, liveStatus, liveEnrichmentIssue, onRefresh, onNavigate }: {
  fl: (t: string) => string;
  computeLeaders: () => TournamentStats;
  liveTs: number;
  liveStatus: LiveStatus;
  liveEnrichmentIssue: string;
  onRefresh: () => void;
  onNavigate: (view: ViewType) => void;
}) {
  const [activeTab, setActiveTab] = useState<StatTabKey>("goals");
  const stats = useMemo(() => { try { return computeLeaders(); } catch { return null; } }, [computeLeaders]);
  if (!stats) {
    return <main className="section stats-view"><div className="stats-leaders__empty"><span>!</span><b>Stats failed to load</b><small>Live data will retry on the next refresh.</small></div></main>;
  }

  const {
    topScorers, topAssisters, topYellowCards, topRedCards,
    totalGoals, totalAssists, totalYellows, totalReds, matchesPlayed, matchesWithAssistData, avgGoals, cleanSheets,
  } = stats;

  const categories: LeaderboardCategory[] = [
    {
      key: "goals",
      label: "Goals",
      statLabel: "Goals",
      total: totalGoals,
      totalLabel: "Total",
      empty: "No goal scorers yet",
      leaders: topScorers,
      value: leader => leader.goals,
      detail: leader => `${leader.assists}A · ${leader.matches}MP${leader.penalties ? ` · ${leader.penalties}P` : ""}`,
    },
    {
      key: "assists",
      label: "Assists",
      statLabel: "Assists",
      total: totalAssists,
      totalLabel: "Credited",
      empty: "No assists recorded yet",
      leaders: topAssisters,
      value: leader => leader.assists,
      detail: leader => `${leader.goals}G · ${leader.matches}MP`,
    },
    {
      key: "yellows",
      label: "Yellow Cards",
      statLabel: "Yellows",
      total: totalYellows,
      totalLabel: "Total",
      empty: "No yellow cards yet",
      leaders: topYellowCards,
      value: leader => leader.yellows,
      detail: leader => `${leader.reds}R · ${leader.matches}MP`,
    },
    {
      key: "reds",
      label: "Red Cards",
      statLabel: "Reds",
      total: totalReds,
      totalLabel: "Total",
      empty: "No red cards yet",
      leaders: topRedCards,
      value: leader => leader.reds,
      detail: leader => `${leader.yellows}Y · ${leader.matches}MP`,
    },
  ];

  const hasAnyData = categories.some(c => c.leaders.length > 0) || matchesPlayed > 0;
  const syncedAt = liveTs ? new Date(liveTs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "pending";
  const syncLabel = liveEnrichmentIssue || (liveStatus === "active" ? "Live sync active" : liveStatus === "paused" ? "Retrying live sync" : "Fresh stats sync");

  return (
    <main className="section stats-view stats-view--premium">
      <section className="stats-hero-panel">
        <div className="stats-hero-panel__copy">
          <span>Compet 2026</span>
          <h2>Stat Leaders</h2>
          <p>Goals, assists and discipline update from the same live match-event pipeline.</p>
          <div className="stats-sync">
            <span>{syncLabel} · {syncedAt}</span>
            <button type="button" onClick={onRefresh}>Refresh</button>
            <button type="button" onClick={() => onNavigate("analytics")}>Analytics</button>
          </div>
        </div>
        <WorldCupTrophy id="st" className="stats-hero-panel__trophy" />
      </section>

      <div className="stats-summary stats-summary--premium" aria-label="Tournament stat summary">
        <div className="stats-card"><span className="stats-card__value">{totalGoals}</span><span className="stats-card__label">Total Goals</span></div>
        <div className="stats-card"><span className="stats-card__value">{totalAssists}</span><span className="stats-card__label">Credited Assists</span></div>
        <div className="stats-card"><span className="stats-card__value">{matchesPlayed}</span><span className="stats-card__label">Matches</span></div>
        <div className="stats-card"><span className="stats-card__value">{avgGoals}</span><span className="stats-card__label">Avg / Match</span></div>
        <div className="stats-card"><span className="stats-card__value">{cleanSheets}</span><span className="stats-card__label">Clean Sheets</span></div>
        <div className="stats-card stats-card--yellow"><span className="stats-card__value">{totalYellows}</span><span className="stats-card__label">Yellows</span></div>
        <div className="stats-card stats-card--red"><span className="stats-card__value">{totalReds}</span><span className="stats-card__label">Reds</span></div>
      </div>

      {!hasAnyData ? (
        <div className="stats-leaders__empty stats-leaders__empty--page">
          <span>↗</span>
          <b>Leaderboards are warming up</b>
          <small>Completed and live match events will populate this screen automatically. No mock leaders are shown.</small>
        </div>
      ) : (
        <StatsLeaderboard
          categories={categories}
          active={activeTab}
          onActive={setActiveTab}
          fl={fl}
          matchesWithAssistData={matchesWithAssistData}
          matchesPlayed={matchesPlayed}
        />
      )}
    </main>
  );
}

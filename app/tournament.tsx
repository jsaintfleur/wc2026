"use client";

import { useEffect, useRef, useState, useCallback, useMemo, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { MOCK_FIXTURES, type TournamentData, type LiveFixture, type GroupStageMatch, type KnockoutMatch, type MatchEvent, type TeamLineup } from "@/lib/data";
import { nrm, canon } from "@/lib/merge";
import { TEAM_PROFILES, type PlayerInfo } from "@/lib/teams";
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

type ViewType = "home" | "schedule" | "groups" | "bracket" | "teams" | "more" | "stats" | "venues" | "about";
type LiveStatus = "init" | "off" | "idle" | "active" | "paused" | "nofix";
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type KnockoutRoundKey = "r32" | "r16" | "qf" | "sf" | "third" | "final";
type StandingRow = { t: string; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number };
type GroupStanding = { rows: StandingRow[]; played: number; complete: boolean };

const KO_ROUNDS: {
  key: KnockoutRoundKey;
  dataRound: string;
  label: string;
  short: string;
  matchNumbers: number[];
}[] = [
  { key: "r32", dataRound: "Round of 32", label: "Round of 32", short: "R32", matchNumbers: [73, 75, 74, 77, 76, 78, 79, 80, 83, 84, 81, 82, 86, 88, 85, 87] },
  { key: "r16", dataRound: "Round of 16", label: "Round of 16", short: "R16", matchNumbers: [89, 90, 91, 92, 93, 94, 95, 96] },
  { key: "qf", dataRound: "Quarter-final", label: "Quarterfinals", short: "QF", matchNumbers: [97, 98, 99, 100] },
  { key: "sf", dataRound: "Semi-final", label: "Semifinals", short: "SF", matchNumbers: [101, 102] },
  { key: "third", dataRound: "Third-place play-off", label: "Third Place", short: "3rd", matchNumbers: [103] },
  { key: "final", dataRound: "Final", label: "Final", short: "Final", matchNumbers: [104] },
];

const R32_SEEDS = [
  ["2A", "2B"], ["1F", "2C"], ["1E", "3rd"], ["1I", "3rd"],
  ["1C", "2F"], ["2E", "2I"], ["1A", "3rd"], ["1L", "3rd"],
  ["2K", "2L"], ["1H", "2J"], ["1D", "3rd"], ["1G", "3rd"],
  ["1J", "2H"], ["2D", "2G"], ["1B", "3rd"], ["1K", "3rd"],
] as const;

const KO_SOURCE_PAIRS: Partial<Record<KnockoutRoundKey, [number, number][]>> = {
  r16: [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15]],
  qf: [[0, 1], [4, 5], [2, 3], [6, 7]],
  sf: [[0, 1], [2, 3]],
  final: [[0, 1]],
  third: [[0, 1]],
};

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
  1: 14,  // column 1 (1B) → R32 slot 14
  2: 10,  // column 2 (1D) → R32 slot 10
  3: 2,   // column 3 (1E) → R32 slot 2
  4: 11,  // column 4 (1G) → R32 slot 11
  5: 3,   // column 5 (1I) → R32 slot 3
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

// Given the 8 qualifying third-place groups, look up Annex C and return
// a map from R32 slot index → { team name, source group }
function resolveThirdPlaceSlots(
  standingsByGroup: Record<string, GroupStanding>,
): Map<number, { team: string; group: string }> | null {
  const { qualified, allComplete } = rankThirdPlaceTeams(standingsByGroup);
  // Need all 12 groups complete and exactly 8 qualifiers
  if (!allComplete || qualified.length !== 8) return null;

  const qualifyingKey = qualified.map(e => e.group).sort().join("");
  const assignment = ANNEX_C[qualifyingKey];
  if (!assignment) return null;

  // Build a team lookup by group: group letter → team name
  const teamByGroup: Record<string, string> = {};
  for (const entry of qualified) teamByGroup[entry.group] = entry.row.t;

  // Map each Annex C column to the corresponding R32 slot
  const slotMap = new Map<number, { team: string; group: string }>();
  for (let col = 0; col < 8; col++) {
    const sourceGroup = assignment[col];
    const r32Slot = ANNEX_C_COL_TO_R32_SLOT[col];
    const team = teamByGroup[sourceGroup];
    if (team && r32Slot !== undefined) {
      slotMap.set(r32Slot, { team, group: sourceGroup });
    }
  }

  return slotMap.size === 8 ? slotMap : null;
}

function ordinalSeedLabel(seed: string): string {
  const m = seed.match(/^([123])([A-L])$/);
  if (!m) return seed === "3rd" ? "Best 3rd" : seed || "TBD";
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
    (fixture.gh !== fixture.ga || fixture.status === "PEN" || fixture.status === "AET");
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

function isMock(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.search.indexOf("mock") > -1;
}

export default function Tournament({ data }: { data: TournamentData }) {
  const fl = (t: string) => data.flags[t] || "⚽";
  const ven = (k: string) => data.venues[k] || { common: "", fifa: "", city: "", country: "", cap: 0 };
  const vName = (k: string) => (data.venues[k] || { common: "" }).common || "";
  const allTeams = [...new Set(Object.values(data.groups).flat())].sort();

  function findLive(m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]): LiveFixture | null {
    if (!fx.length) return null;
    let best: LiveFixture | null = null;
    let bd = 75 * 60000;
    const vn = nrm(vName((m as GroupStageMatch).v || ""));
    for (const f of fx) {
      const dt = Math.abs((f.ts || 0) - (m.ts || 0));
      if (dt > 75 * 60000) continue;
      const fv = nrm(f.venue);
      const venOK = vn && fv && (fv === vn || fv.indexOf(vn) > -1 || vn.indexOf(fv) > -1);
      let teamOK = false;
      if (m.t1 && m.t2) {
        const a = canon(f.home), b = canon(f.away);
        teamOK = (a === m.t1 && b === m.t2) || (a === m.t2 && b === m.t1);
      }
      if ((venOK || teamOK) && dt < bd) { bd = dt; best = f; }
    }
    return best;
  }

  const [view, setView] = useState<ViewType>("home");
  const [group, setGroup] = useState("ALL");
  const [team, setTeam] = useState("ALL");
  const [query, setQuery] = useState("");
  const [fixtures, setFixtures] = useState<LiveFixture[]>([]);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("init");
  const [liveTs, setLiveTs] = useState(0);
  const [, setLiveStale] = useState(false);
  const [liveEnrichmentIssue, setLiveEnrichmentIssue] = useState("");
  const [animate, setAnimate] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [teamDrawer, setTeamDrawer] = useState<string | null>(null);
  const [matchDetail, setMatchDetail] = useState<{ match: GroupStageMatch; fixture: LiveFixture | null } | null>(null);
  const [playerProfile, setPlayerProfile] = useState<{ name: string; team: string } | null>(null);
  const [goalToast, setGoalToast] = useState<{ team: string; player: string; minute: string; score: string; flag: string } | null>(null);
  const [toastExiting, setToastExiting] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [favs, toggleFav] = useFavorites();
  const prevScoresRef = useRef<Map<string, string>>(new Map());
  const scrolledRef = useRef(false);
  const mainRef = useRef<HTMLElement>(null);

  /* PWA install prompt — captured from beforeinstallprompt event */
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  const pollLive = useCallback(async () => {
    if (isMock()) {
      setFixtures(MOCK_FIXTURES as LiveFixture[]);
      setLiveStatus("active");
      setLiveTs(Date.now());
      setLiveEnrichmentIssue("");
      return;
    }
    try {
      const r = await fetch("/api/live", { cache: "no-store" });
      if (!r.ok) throw new Error("fetch failed");
      const j = await r.json();
      if (j.configured === false) {
        setLiveStatus("off");
        setFixtures(Array.isArray(j.fixtures) ? j.fixtures : []);
        setLiveEnrichmentIssue(j.active ? "Live enrichment is not configured" : "");
        return;
      }
      setFixtures(Array.isArray(j.fixtures) ? j.fixtures : []);
      setLiveTs(j.ts || Date.now());
      setLiveStale(!!j.stale);
      const enrichmentUnhealthy = !!(j.enrichment?.required && !j.enrichment?.healthy);
      setLiveEnrichmentIssue(enrichmentUnhealthy ? "Live enrichment needs attention" : "");
      if (j.stale || enrichmentUnhealthy) setLiveStatus("paused");
      else if (j.active && (!j.fixtures || j.fixtures.length === 0)) setLiveStatus("nofix");
      else if (j.active) setLiveStatus("active");
      else setLiveStatus("idle");
    } catch {
      setLiveEnrichmentIssue("Live enrichment fetch failed");
      setLiveStatus(prev => prev === "init" ? "off" : "paused");
    }
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (isMock()) return;
    const ms = liveStatus === "active" ? 30000 : 180000;
    timerRef.current = setInterval(() => { pollLive(); }, ms);
  }, [liveStatus, pollLive]);

  useEffect(() => {
    queueMicrotask(() => {
      setNowMs(Date.now());
      pollLive().then(schedule);
    });
    const onVis = () => {
      if (document.hidden) {
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setNowMs(Date.now());
        pollLive().then(schedule);
      }
    };
    document.addEventListener("visibilitychange", onVis);
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

  function buildKnockoutScheduleCards(): KnockoutCardModel[] {
    const standingsByGroup: Record<string, GroupStanding> = {};
    for (const g of Object.keys(data.groups)) standingsByGroup[g] = standings(g);
    const thirdSlots = resolveThirdPlaceSlots(standingsByGroup);
    const winners: Partial<Record<KnockoutRoundKey, (string | null)[]>> = {};
    const losers: Partial<Record<KnockoutRoundKey, (string | null)[]>> = {};

    function teamName(name: string | undefined | null): string {
      if (!name) return "TBD";
      return canon(name) || name;
    }
    function winnerFromFixture(fixture: LiveFixture | null): string | null {
      if (!isCompletedKnockoutFixture(fixture) || fixture.gh == null || fixture.ga == null || fixture.gh === fixture.ga) return null;
      return fixture.gh > fixture.ga ? teamName(fixture.home) : teamName(fixture.away);
    }
    function loserFromFixture(fixture: LiveFixture | null): string | null {
      if (!isCompletedKnockoutFixture(fixture) || fixture.gh == null || fixture.ga == null || fixture.gh === fixture.ga) return null;
      return fixture.gh > fixture.ga ? teamName(fixture.away) : teamName(fixture.home);
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

    const all: KnockoutCardModel[] = [];
    for (const config of KO_ROUNDS) {
      const scheduled = data.ko.filter(match => match.round === config.dataRound);
      const roundCards = scheduled.map((match, index) => {
        const matchNo = config.matchNumbers[index] || Number(match.mr) || 0;
        const fixture = findLive({ ts: match.ts, v: match.v }, fixtures);
        const isLive = !!fixture && LIVE_STATUSES.has(fixture.status) && !isStaleStatus(match.ts, fixture.status, nowMs);
        const isDone = isCompletedKnockoutFixture(fixture);
        const winnerName = winnerFromFixture(fixture);
        const loserName = loserFromFixture(fixture);
        let teams: [KnockoutParticipant, KnockoutParticipant];

        if (fixture?.home && fixture?.away) {
          const home = teamName(fixture.home);
          const away = teamName(fixture.away);
          teams = [
            { name: home, winner: winnerName === home, loser: loserName === home },
            { name: away, winner: winnerName === away, loser: loserName === away },
          ];
        } else if (config.key === "r32") {
          const [seedA, seedB] = R32_SEEDS[index] || ["TBD", "TBD"];
          const teamAResolved = resolveGroupSeed(seedA, standingsByGroup);
          let teamBResolved: KnockoutParticipant;
          if (seedB === "3rd" && thirdSlots) {
            const resolved = thirdSlots.get(index);
            teamBResolved = resolved
              ? { name: resolved.team, seed: `3rd Group ${resolved.group}` }
              : { name: "Best 3rd", placeholder: true };
          } else {
            teamBResolved = resolveGroupSeed(seedB, standingsByGroup);
          }
          teams = [teamAResolved, teamBResolved];
        } else {
          const [sourceA, sourceB] = sourcePair(config.key, index);
          const first = previousTeam(config.key, sourceA);
          const second = previousTeam(config.key, sourceB);
          teams = [
            { name: first || sourceLabel(config.key, index, 0), placeholder: !first },
            { name: second || sourceLabel(config.key, index, 1), placeholder: !second },
          ];
        }

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
        };
      });
      winners[config.key] = roundCards.map(card => card.winnerName);
      losers[config.key] = roundCards.map(card => card.loserName);
      all.push(...roundCards);
    }
    return all;
  }

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
        <span class="ven">${esc(v.common)}</span><span class="cty">· ${esc(v.city)}, ${esc(v.country)}</span>
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
        <span class="ven">${esc(card.source)} · ${esc(v.common)}</span><span class="cty">· ${esc(v.city)}, ${esc(v.country)}</span>
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

    /* Group matches by ISO date, preserving chronological order */
    const byDate = new Map<string, GroupStageMatch[]>();
    const completedMatches = list.filter(m => isMatchDone(m) || isPastUnresolved(m)).sort((a, b) => b.ts - a.ts);
    const activeList = list.filter(m => !isMatchDone(m) && !isPastUnresolved(m));
    for (const m of activeList) {
      if (!byDate.has(m.iso)) byDate.set(m.iso, []);
      byDate.get(m.iso)!.push(m);
    }
    const sortedDates = [...byDate.keys()].sort();
    const koByDate = new Map<string, KnockoutCardModel[]>();
    const activeKoCards = knockoutCards.filter(card => !card.isDone);
    for (const card of activeKoCards) {
      if (!koByDate.has(card.match.iso)) koByDate.set(card.match.iso, []);
      koByDate.get(card.match.iso)!.push(card);
    }
    const sortedKoDates = [...koByDate.keys()].sort();

    /* Find live matches for the pinned banner */
    const liveMatches: GroupStageMatch[] = [];
    for (const m of list) {
      const f = findLive(m, fixtures);
      const stale = (f && isStaleStatus(m.ts, f.status, now)) || (!f && m.dbStatus && isStaleStatus(m.ts, m.dbStatus, now));
      if (!stale && f && LIVE_STATUSES.has(f.status)) liveMatches.push(m);
    }

    let html = "";

    if (completedMatches.length) {
      const latest = completedMatches[0];
      const latestDate = parseISO(latest.iso);
      html += `<details class="finished-drawer">
        <summary>
          <span>Finished Games</span>
          <b>${completedMatches.length}</b>
          <small>Latest: ${DOW[latestDate.getDay()]} ${latestDate.getDate()} ${MON[latestDate.getMonth()]}</small>
        </summary>
        <div class="finished-drawer__body">`;
      for (const m of completedMatches) html += tixCard(m, anim, true);
      html += `</div></details>`;
    }

    /* Live banner pinned at top when matches are in progress */
    if (liveMatches.length) {
      html += `<div id="next-match-anchor" style="scroll-margin-top:240px"></div><div class="mc-sec" id="mc-live"><div class="mc-hd mc-hd--live"><span class="mc-dot"></span>Live Now</div>`;
      for (const m of liveMatches) html += tixCard(m, anim);
      html += `</div>`;
    }

    /* Chronological timeline — every date gets a section, auto-scroll anchor on the first upcoming date */
    let anchorPlaced = false;
    for (const iso of sortedDates) {
      const matches = byDate.get(iso)!;
      const dt = parseISO(iso);
      const dateLabel = `${DOW[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}`;

      /* Determine if this day is fully in the past, current, or future */
      const isToday = iso === today;
      const isPast = iso < today;

      /* Place the scroll anchor before the first non-past section */
      if (!liveMatches.length && !anchorPlaced && !isPast) {
        html += `<div id="next-match-anchor" style="scroll-margin-top:240px"></div>`;
        anchorPlaced = true;
      }

      const sectionCls = isPast ? "mc-sec mc-sec--past" : "mc-sec";
      const headExtra = isToday ? " — Gameday" : "";
      html += `<div class="${sectionCls}"><div class="mc-hd">${dateLabel}${headExtra}</div>`;

      for (const m of matches) {
        const f = findLive(m, fixtures);
        const stale = (f && isStaleStatus(m.ts, f.status, now)) || (!f && m.dbStatus && isStaleStatus(m.ts, m.dbStatus, now));
        const hasKickedOff = m.ts <= now + 5 * 60000;
        const isDone = !stale && hasKickedOff && isMatchDone(m);
        html += tixCard(m, anim, isDone);
      }
      html += `</div>`;
    }

    if (!activeList.length && completedMatches.length) {
      const latest = completedMatches.slice(0, 4);
      if (!activeKoCards.length) {
        html += `<div id="next-match-anchor" style="scroll-margin-top:240px"></div>`;
        anchorPlaced = true;
      }
      html += `<div class="mc-sec mc-sec--latest"><div class="mc-hd">Latest Results</div>`;
      for (const m of latest) html += tixCard(m, anim, true);
      html += `</div>`;
    }

    for (const iso of sortedKoDates) {
      const cards = koByDate.get(iso)!;
      const dt = parseISO(iso);
      const dateLabel = `${DOW[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}`;
      const isToday = iso === today;
      const isPast = iso < today;
      if (!liveMatches.length && !anchorPlaced && !isPast) {
        html += `<div id="next-match-anchor" style="scroll-margin-top:240px"></div>`;
        anchorPlaced = true;
      }
      const sectionCls = isPast ? "mc-sec mc-sec--past mc-sec--ko" : "mc-sec mc-sec--ko";
      const headExtra = isToday ? " — Knockout Gameday" : "";
      html += `<div class="${sectionCls}"><div class="mc-hd">${dateLabel}${headExtra}<small>Knockout Stage</small></div>`;
      for (const card of cards) html += koTixCard(card, anim, card.isDone);
      html += `</div>`;
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

  /** Aggregate goal/assist tallies and tournament-wide stats from all finished match events */
  function computeLeaders() {
    const scorers: Record<string, { name: string; team: string; goals: number; penalties: number }> = {};
    const assisters: Record<string, { name: string; team: string; assists: number }> = {};
    const teamGoals: Record<string, { team: string; goals: number }> = {};
    const cardPlayers: Record<string, { name: string; team: string; yellows: number; reds: number }> = {};

    // Goals-by-minute buckets: 0-15, 16-30, 31-45, 46-60, 61-75, 76-90, 90+
    const minuteBuckets = [0, 0, 0, 0, 0, 0, 0];
    let totalGoals = 0;
    let normalGoals = 0;
    let penGoals = 0;
    let ownGoals = 0;
    let totalYellows = 0;
    let totalReds = 0;
    let totalSubs = 0;

    const allEvents: { events: MatchEvent[]; team?: string }[] = [];

    // From live fixtures (primary source — includes DB-enriched data)
    for (const f of fixtures) {
      if (f.events) allEvents.push({ events: f.events });
    }

    // From DB-stored events on group stage matches (fallback for matches not in current live feed)
    for (const m of data.gs) {
      if (m.dbEvents && m.dbEvents.length > 0) {
        const already = fixtures.some(f => Math.abs(f.ts - m.ts) < 60000 && f.events && f.events.length > 0);
        if (!already) allEvents.push({ events: m.dbEvents });
      }
    }

    for (const { events } of allEvents) {
      for (const ev of events) {
        // ── Cards ──
        if (ev.type === "Card") {
          const isRed = ev.detail.includes("Red");
          if (isRed) totalReds++;
          else totalYellows++;

          const cKey = `${ev.player}|${ev.team}`;
          if (!cardPlayers[cKey]) cardPlayers[cKey] = { name: ev.player, team: ev.team, yellows: 0, reds: 0 };
          if (isRed) cardPlayers[cKey].reds++;
          else cardPlayers[cKey].yellows++;
          continue;
        }

        // ── Substitutions ──
        if (ev.type === "subst") {
          totalSubs++;
          continue;
        }

        // ── Goals ──
        if (ev.type !== "Goal") continue;
        if (/shootout/i.test(ev.detail || "")) continue;
        totalGoals++;

        const isPen = ev.detail === "Penalty";
        const isOG = ev.detail === "Own Goal";
        if (isOG) { ownGoals++; }
        else if (isPen) { penGoals++; }
        else { normalGoals++; }

        const m = ev.minute;
        if (m <= 15) minuteBuckets[0]++;
        else if (m <= 30) minuteBuckets[1]++;
        else if (m <= 45) minuteBuckets[2]++;
        else if (m <= 60) minuteBuckets[3]++;
        else if (m <= 75) minuteBuckets[4]++;
        else if (m <= 90 && !ev.extra) minuteBuckets[5]++;
        else minuteBuckets[6]++;

        const tKey = ev.team;
        if (!teamGoals[tKey]) teamGoals[tKey] = { team: tKey, goals: 0 };
        teamGoals[tKey].goals++;

        if (isOG) continue;

        const pKey = `${ev.player}|${ev.team}`;
        if (!scorers[pKey]) scorers[pKey] = { name: ev.player, team: ev.team, goals: 0, penalties: 0 };
        scorers[pKey].goals += 1;
        if (isPen) scorers[pKey].penalties += 1;

        if (ev.assist) {
          const aKey = `${ev.assist}|${ev.team}`;
          if (!assisters[aKey]) assisters[aKey] = { name: ev.assist, team: ev.team, assists: 0 };
          assisters[aKey].assists += 1;
        }
      }
    }

    // Count finished matches and clean sheets
    const finishedKeys = new Set<string>();
    let cleanSheets = 0;
    for (const f of fixtures) {
      if (!DONE_STATUSES.has(f.status) || f.gh == null || f.ga == null) continue;
      const key = canon(f.home) + ":" + canon(f.away);
      if (finishedKeys.has(key)) continue;
      finishedKeys.add(key);
      if (f.gh === 0) cleanSheets++;
      if (f.ga === 0) cleanSheets++;
    }
    for (const m of data.gs) {
      if (!m.dbStatus || !DONE_STATUSES.has(m.dbStatus) || m.dbGh == null || m.dbGa == null) continue;
      const key = canon(m.t1) + ":" + canon(m.t2);
      if (finishedKeys.has(key)) continue;
      finishedKeys.add(key);
      if (m.dbGh === 0) cleanSheets++;
      if (m.dbGa === 0) cleanSheets++;
    }

    const matchesPlayed = finishedKeys.size;
    const avgGoals = matchesPlayed > 0 ? +(totalGoals / matchesPlayed).toFixed(1) : 0;

    const topScorers = Object.values(scorers).sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, 20);
    const topAssisters = Object.values(assisters).sort((a, b) => b.assists - a.assists || a.name.localeCompare(b.name)).slice(0, 20);
    const combined: Record<string, { name: string; team: string; goals: number; assists: number; total: number }> = {};
    Object.values(scorers).forEach(s => {
      const key = `${s.name}|${s.team}`;
      combined[key] = combined[key] || { name: s.name, team: s.team, goals: 0, assists: 0, total: 0 };
      combined[key].goals = s.goals;
      combined[key].total = combined[key].goals + combined[key].assists;
    });
    Object.values(assisters).forEach(a => {
      const key = `${a.name}|${a.team}`;
      combined[key] = combined[key] || { name: a.name, team: a.team, goals: 0, assists: 0, total: 0 };
      combined[key].assists = a.assists;
      combined[key].total = combined[key].goals + combined[key].assists;
    });
    const topCombined = Object.values(combined)
      .filter(p => p.total > 0)
      .sort((a, b) => b.total - a.total || b.goals - a.goals || a.name.localeCompare(b.name))
      .slice(0, 20);
    const topTeams = Object.values(teamGoals).sort((a, b) => b.goals - a.goals || a.team.localeCompare(b.team)).slice(0, 12);
    const mostCarded = Object.values(cardPlayers).sort((a, b) => (b.yellows + b.reds * 3) - (a.yellows + a.reds * 3) || a.name.localeCompare(b.name)).slice(0, 15);
    const bucketLabels = ["1-15", "16-30", "31-45", "46-60", "61-75", "76-90", "90+"];

    return {
      topScorers, topAssisters, topCombined, topTeams, mostCarded,
      minuteBuckets, bucketLabels,
      totalGoals, normalGoals, penGoals, ownGoals,
      totalYellows, totalReds, totalSubs,
      matchesPlayed, avgGoals, cleanSheets,
    };
  }

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
    if (view === "stats") return ""; // stats rendered as React, not HTML string
    if (view === "bracket") return ""; // bracket rendered as React bracket
    return renderAbout();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, group, team, query, fixtures, liveStatus, liveTs, liveEnrichmentIssue, animate, nowMs]);

  function handleTab(v: ViewType) {
    setAnimate(true);
    setView(v);
    window.scrollTo({ top: 0 });
  }

  const tabs: { key: ViewType; label: string }[] = [
    { key: "home", label: "Home" },
    { key: "schedule", label: "Matches" },
    { key: "groups", label: "Groups" },
    { key: "bracket", label: "Knockout" },
    { key: "teams", label: "Teams" },
    { key: "more", label: "More" },
  ];

  const navIcon: Record<ViewType, string> = {
    home: "⌂",
    schedule: "▦",
    groups: "◌",
    bracket: "♕",
    teams: "◍",
    more: "•••",
    stats: "↗",
    venues: "⌖",
    about: "i",
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
          <div className="bar__hosts" aria-label="Hosts: Canada, Mexico, United States"><span>🇨🇦</span><span>🇲🇽</span><span>🇺🇸</span></div>
        </div>
      </header>

      {view !== "bracket" && view !== "home" && (
        <section className="hero hero--compact">
          <div className="hero__pitch-lines" aria-hidden="true" />
          <div className="hero__context">
            <h1 className="hero__context-title">
              {view === "schedule" ? "Matches" : view === "groups" ? "Groups" : view === "teams" ? "Teams" : view === "stats" ? "Statistics" : view === "more" ? "More" : view === "venues" ? "Venues" : view === "about" ? "About" : "COMPET 2026"}
            </h1>
            <p className="hero__context-sub">
              {view === "schedule" ? `${data.gs.length} group stage · ${data.ko.length} knockout` : view === "groups" ? `${Object.keys(data.groups).length} groups · 48 teams` : view === "teams" ? "48 nations competing" : view === "stats" ? "Goals, assists & cards" : view === "more" ? "Venues, about & more" : ""}
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

      {view !== "bracket" && view !== "home" && <CountdownHero data={data} fixtures={fixtures} findLive={findLive} />}

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
          <div className="chips" role="group" aria-label="Filter by group">
            <button
              className="chip chip--all"
              aria-pressed={group === "ALL"}
              onClick={() => { setAnimate(true); setGroup("ALL"); }}
            >
              All
            </button>
            {Object.keys(data.groups).map(g => (
              <button
                key={g}
                className="chip"
                aria-pressed={group === g}
                style={group === g ? { background: data.gcolor[g] } : undefined}
                onClick={() => { setAnimate(true); setGroup(g); }}
              >
                {g}
              </button>
            ))}
          </div>
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
            onTeamClick={setTeamDrawer}
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
          <StatsView data={data} fixtures={fixtures} fl={fl} computeLeaders={computeLeaders} />
        ) : view === "teams" ? (
          <TeamsView data={data} fixtures={fixtures} findLive={findLive} nowMs={nowMs} onTeamClick={setTeamDrawer} favs={favs} toggleFav={toggleFav} />
        ) : view === "more" ? (
          <MoreView data={data} fixtures={fixtures} findLive={findLive} nowMs={nowMs} onNavigate={handleTab} onTeamClick={setTeamDrawer} />
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
};

function LandingGate({ data, fixtures, findLive, nowMs, computeLeaders, onNavigate, onTeamClick, onMatchClick }: {
  data: TournamentData;
  fixtures: LiveFixture[];
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null;
  nowMs: number;
  computeLeaders: () => { topScorers: { name: string; team: string; goals: number; penalties: number }[]; topAssisters: { name: string; team: string; assists: number }[]; totalGoals: number; matchesPlayed: number; avgGoals: number; cleanSheets: number; [key: string]: unknown };
  onNavigate: (v: ViewType) => void;
  onTeamClick: (t: string) => void;
  onMatchClick: (match: GroupStageMatch, fixture: LiveFixture | null) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => clearInterval(id);
  }, []);

  const fl = (t: string) => data.flags[t] || "⚽";

  /* -- tournament progress stats ---------------------------------- */
  const groupDone = useMemo(() => data.gs.filter(m => {
    const f = findLive(m, fixtures);
    return !!((f && DONE_STATUSES.has(f.status)) || (m.dbStatus && DONE_STATUSES.has(m.dbStatus) && m.dbGh != null && m.dbGa != null));
  }).length, [data.gs, fixtures, findLive]);

  const koDone = useMemo(() => data.ko.filter(m => {
    const f = findLive({ ts: m.ts, v: m.v }, fixtures);
    return isCompletedKnockoutFixture(f);
  }).length, [data.ko, fixtures, findLive]);

  const totalMatches = data.gs.length + data.ko.length;
  const totalDone = groupDone + koDone;
  const progressPct = totalMatches > 0 ? Math.round((totalDone / totalMatches) * 100) : 0;

  const stageLabel = koDone >= 31 ? "Final" : koDone >= 30 ? "Third Place" : koDone >= 28 ? "Semifinals" : koDone >= 24 ? "Quarterfinals" : koDone >= 16 ? "Round of 16" : koDone >= 0 && groupDone >= 72 ? "Round of 32" : "Group Stage";

  /* -- live matches ----------------------------------------------- */
  const liveMatches = useMemo(() => {
    const live: { match: GroupStageMatch; fixture: LiveFixture }[] = [];
    for (const m of data.gs) {
      const f = findLive(m, fixtures);
      if (f && LIVE_STATUSES.has(f.status)) live.push({ match: m, fixture: f });
    }
    return live;
  }, [data.gs, fixtures, findLive]);

  /* -- next match countdown --------------------------------------- */
  const nextMatch = useMemo(() => {
    let nextGs: GroupStageMatch | null = null;
    for (const m of data.gs) { if (m.ts > now && (!nextGs || m.ts < nextGs.ts)) nextGs = m; }
    let nextKo: KnockoutMatch | null = null;
    for (const k of data.ko) { if (k.ts > now && (!nextKo || k.ts < nextKo.ts)) nextKo = k; }
    if (nextGs && (!nextKo || nextGs.ts <= nextKo.ts)) return { type: "gs" as const, match: nextGs, ts: nextGs.ts };
    if (nextKo) return { type: "ko" as const, match: nextKo, ts: nextKo.ts };
    return null;
  }, [data.gs, data.ko, now]);

  /* -- recent results (last 6 completed matches) ------------------ */
  const recentResults = useMemo(() => {
    const results: { match: GroupStageMatch; fixture: LiveFixture }[] = [];
    const sorted = [...data.gs].sort((a, b) => b.ts - a.ts);
    for (const m of sorted) {
      const f = findLive(m, fixtures);
      if (f && DONE_STATUSES.has(f.status) && f.gh != null && f.ga != null) {
        results.push({ match: m, fixture: f });
      } else if (m.dbStatus && DONE_STATUSES.has(m.dbStatus) && m.dbGh != null && m.dbGa != null) {
        const synth: LiveFixture = { ts: m.ts, status: m.dbStatus, elapsed: null, venue: m.v, round: `Group ${m.g}`, home: m.t1, away: m.t2, gh: m.dbGh, ga: m.dbGa, events: m.dbEvents };
        results.push({ match: m, fixture: synth });
      }
      if (results.length >= 6) break;
    }
    return results;
  }, [data.gs, fixtures, findLive]);

  /* -- top scorer & assister -------------------------------------- */
  const leaders = useMemo(() => computeLeaders(), [computeLeaders]);
  const topScorer = leaders.topScorers[0] || null;
  const topAssister = leaders.topAssisters[0] || null;

  /* -- countdown math --------------------------------------------- */
  const countdown = useMemo(() => {
    if (!nextMatch) return null;
    const diff = Math.max(0, nextMatch.ts - now);
    const totalSec = Math.floor(diff / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return { d, h, m, s };
  }, [nextMatch, now]);

  /* -- quick access items ----------------------------------------- */
  const quickItems: { icon: string; label: string; key: ViewType }[] = [
    { icon: "⚔️", label: "Knockout", key: "bracket" },
    { icon: "📊", label: "Groups", key: "groups" },
    { icon: "📅", label: "Matches", key: "schedule" },
    { icon: "🏆", label: "Stats", key: "stats" },
    { icon: "🌍", label: "Teams", key: "teams" },
    { icon: "•••", label: "More", key: "more" },
  ];

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <main className="home-dash" aria-label="Tournament Dashboard">

      {/* ── Section 1: Live Match or Next-Match Countdown ────── */}
      {liveMatches.length > 0 ? (
        <section className="home-dash__live" aria-label="Live matches">
          {liveMatches.slice(0, 2).map(({ match, fixture }, i) => (
            <button key={i} type="button" className="home-live-card" onClick={() => onMatchClick(match, fixture)}>
              <div className="home-live-card__badge">
                <span className="home-live-card__pulse" />
                {fixture.status === "HT" ? "HT" : `${fixture.elapsed || ""}'`}
              </div>
              <div className="home-live-card__teams">
                <div className="home-live-card__side">
                  <span className="home-live-card__flag">{fl(match.t1)}</span>
                  <span className="home-live-card__name">{match.t1}</span>
                </div>
                <div className="home-live-card__score">{fixture.gh ?? 0} – {fixture.ga ?? 0}</div>
                <div className="home-live-card__side">
                  <span className="home-live-card__flag">{fl(match.t2)}</span>
                  <span className="home-live-card__name">{match.t2}</span>
                </div>
              </div>
              <div className="home-live-card__venue">{data.venues[match.v]?.common || match.v}</div>
            </button>
          ))}
        </section>
      ) : nextMatch && countdown ? (
        <section className="home-dash__next" aria-label="Next match countdown">
          <div className="home-next__eyebrow">Next Match</div>
          <div className="home-next__countdown" suppressHydrationWarning>
            {countdown.d > 0 && <><span className="home-next__digit">{countdown.d}</span><span className="home-next__unit">d</span></>}
            <span className="home-next__digit">{pad(countdown.h)}</span><span className="home-next__sep">:</span>
            <span className="home-next__digit">{pad(countdown.m)}</span><span className="home-next__sep">:</span>
            <span className="home-next__digit">{pad(countdown.s)}</span>
          </div>
          {nextMatch.type === "gs" ? (
            <div className="home-next__match">
              <span className="home-next__team"><span>{fl(nextMatch.match.t1)}</span> {nextMatch.match.t1}</span>
              <span className="home-next__vs">vs</span>
              <span className="home-next__team"><span>{fl(nextMatch.match.t2)}</span> {nextMatch.match.t2}</span>
            </div>
          ) : (
            <div className="home-next__match"><span className="home-next__round">{nextMatch.match.round}</span></div>
          )}
          <div className="home-next__meta">
            {(() => {
              const iso = nextMatch.type === "gs" ? nextMatch.match.iso : nextMatch.match.iso;
              const d = parseISO(iso);
              const et = nextMatch.type === "gs" ? nextMatch.match.et : nextMatch.match.et;
              const v = data.venues[nextMatch.type === "gs" ? nextMatch.match.v : nextMatch.match.v];
              return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} · ${et}${v ? ` · ${v.common}` : ""}`;
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
        <div className="home-progress__bar">
          <div className="home-progress__fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="home-progress__stats">
          <button type="button" className="home-progress__stat" onClick={() => onNavigate("schedule")}>
            <b>{groupDone}</b><span>/{data.gs.length} Group</span>
          </button>
          <button type="button" className="home-progress__stat" onClick={() => onNavigate("bracket")}>
            <b>{koDone}</b><span>/{data.ko.length} Knockout</span>
          </button>
          <div className="home-progress__stat">
            <b>{leaders.totalGoals}</b><span>Goals</span>
          </div>
          <div className="home-progress__stat">
            <b>{leaders.avgGoals}</b><span>Per Match</span>
          </div>
        </div>
      </section>

      {/* ── Section 3: Quick Access Grid ─────────────────────── */}
      <section className="home-dash__quick" aria-label="Quick access">
        {quickItems.map(item => (
          <button key={item.key} type="button" className="home-quick__btn" onClick={() => onNavigate(item.key)}>
            <span className="home-quick__icon">{item.icon}</span>
            <span className="home-quick__label">{item.label}</span>
          </button>
        ))}
      </section>

      {/* ── Section 4: Golden Boot / Top Assist ──────────────── */}
      {(topScorer || topAssister) && (
        <section className="home-dash__leaders">
          <h3 className="home-section__title">Tournament Leaders</h3>
          <div className="home-leaders__grid">
            {topScorer && (
              <button type="button" className="home-leader-card home-leader-card--gold" onClick={() => onTeamClick(topScorer.team)}>
                <div className="home-leader-card__award">🥇 Golden Boot</div>
                <div className="home-leader-card__player">
                  <span className="home-leader-card__flag">{fl(topScorer.team)}</span>
                  <div>
                    <b>{topScorer.name}</b>
                    <span>{topScorer.team}</span>
                  </div>
                </div>
                <div className="home-leader-card__stat">{topScorer.goals}<small>goals</small></div>
              </button>
            )}
            {topAssister && (
              <button type="button" className="home-leader-card home-leader-card--silver" onClick={() => onTeamClick(topAssister.team)}>
                <div className="home-leader-card__award">🎯 Top Assists</div>
                <div className="home-leader-card__player">
                  <span className="home-leader-card__flag">{fl(topAssister.team)}</span>
                  <div>
                    <b>{topAssister.name}</b>
                    <span>{topAssister.team}</span>
                  </div>
                </div>
                <div className="home-leader-card__stat">{topAssister.assists}<small>assists</small></div>
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── Section 5: Latest Results ────────────────────────── */}
      {recentResults.length > 0 && (
        <section className="home-dash__results">
          <div className="home-section__header">
            <h3 className="home-section__title">Latest Results</h3>
            <button type="button" className="home-section__more" onClick={() => onNavigate("schedule")}>See all →</button>
          </div>
          <div className="home-results__scroll">
            {recentResults.map(({ match, fixture }, i) => (
              <button key={i} type="button" className="home-result-card" onClick={() => onMatchClick(match, fixture)}>
                <div className="home-result-card__group">Group {match.g}</div>
                <div className="home-result-card__teams">
                  <span className="home-result-card__side">
                    <span>{fl(match.t1)}</span>
                    <b className={fixture.gh != null && fixture.ga != null && fixture.gh > fixture.ga ? "home-result-card--winner" : ""}>{match.t1}</b>
                  </span>
                  <span className="home-result-card__score">{fixture.gh} – {fixture.ga}</span>
                  <span className="home-result-card__side">
                    <span>{fl(match.t2)}</span>
                    <b className={fixture.gh != null && fixture.ga != null && fixture.ga > fixture.gh ? "home-result-card--winner" : ""}>{match.t2}</b>
                  </span>
                </div>
                <div className="home-result-card__ft">{fixture.status === "AET" ? "AET" : fixture.status === "PEN" ? "PENS" : "FT"}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Section 6: Tournament Snapshot ────────────────────── */}
      <section className="home-dash__snapshot">
        <div className="home-section__header">
          <h3 className="home-section__title">Tournament</h3>
        </div>
        <div className="home-snapshot__grid">
          <button type="button" className="home-snapshot__card home-snapshot__card--ko" onClick={() => onNavigate("bracket")}>
            <span className="home-snapshot__icon">⚔️</span>
            <div>
              <b>Knockout Bracket</b>
              <span>{koDone > 0 ? `${koDone} of ${data.ko.length} decided` : stageLabel === "Round of 32" ? "Round of 32 begins" : "Starts after group stage"}</span>
            </div>
          </button>
          <button type="button" className="home-snapshot__card home-snapshot__card--stats" onClick={() => onNavigate("stats")}>
            <span className="home-snapshot__icon">📊</span>
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
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
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
                  <span className="search-overlay__row-icon">⚽</span>
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
                  <span className="search-overlay__row-icon">📅</span>
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
                  <span className="search-overlay__row-icon">🏟️</span>
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
                  <span className="search-overlay__row-icon">📊</span>
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
  const [filter, setFilter] = useState<string>("ALL");
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

  const groups = useMemo(() => ["ALL", ...Object.keys(data.groups).sort()], [data.groups]);

  const filtered = useMemo(() => {
    let result = teamsData;
    if (filter !== "ALL") result = result.filter(t => t.group === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(t => t.team.toLowerCase().includes(q));
    }
    /* Sort favorites to top */
    return [...result].sort((a, b) => {
      const aFav = favs.has(a.team) ? 0 : 1;
      const bFav = favs.has(b.team) ? 0 : 1;
      return aFav - bFav;
    });
  }, [teamsData, filter, search, favs]);

  return (
    <main className="teams-view" aria-label="Teams">
      <section className="teams-view__hero">
        <span>48 Nations</span>
        <h2>Teams</h2>
        <p>Browse squads, group records and tournament paths.</p>
      </section>

      {/* -- search + group filter --------------------------------- */}
      <div className="teams-view__controls">
        <input
          type="search"
          className="teams-view__search"
          placeholder="Search teams…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search teams"
        />
        <div className="teams-view__chips" role="group" aria-label="Filter by group">
          {groups.map(g => (
            <button
              key={g}
              type="button"
              className={`teams-view__chip${filter === g ? " teams-view__chip--active" : ""}`}
              aria-pressed={filter === g}
              onClick={() => setFilter(g)}
            >
              {g === "ALL" ? "All" : g}
            </button>
          ))}
        </div>
      </div>

      {/* -- team grid --------------------------------------------- */}
      <div className="teams-view__grid">
        {filtered.map(({ team, group, flag, host, w, d, l, gf, ga, pts, form }) => (
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

      {filtered.length === 0 && (
        <div className="teams-view__empty">
          No teams match your search.
          <button type="button" onClick={() => { setSearch(""); setFilter("ALL"); }}>Clear filters</button>
        </div>
      )}
    </main>
  );
}

/* ---------------------------------------------------------------
 * MoreView — comprehensive tournament dashboard
 * Sections: Hero, Progress, Quick Access, Stadiums, Host Cities,
 *           Calendar Timeline, History, App Settings
 * --------------------------------------------------------------- */
function MoreView({ data, fixtures, findLive, nowMs, onNavigate, onTeamClick }: {
  data: TournamentData;
  fixtures: LiveFixture[];
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null;
  nowMs: number;
  onNavigate: (view: ViewType) => void;
  onTeamClick: (team: string) => void;
}) {

  /* -- helper: host country → tri-color stripe badge ----------- */
  /* Renders a small rounded SVG with horizontal stripes in each
     nation's flag colors. Consistent across platforms, unlike emoji. */
  const countryBadge = (c: string) => {
    const colors =
      c === "USA"    ? ["#B22234", "#FFFFFF", "#3C3B6E"] :
      c === "Mexico" ? ["#006847", "#FFFFFF", "#CE1126"] :
                       ["#FF0000", "#FFFFFF", "#FF0000"]; // Canada
    return (
      <svg className="more-country-badge" viewBox="0 0 24 16" aria-label={c}>
        <defs>
          <clipPath id={`cb-${c.replace(/\s/g, "")}`}>
            <rect width="24" height="16" rx="3" />
          </clipPath>
        </defs>
        <g clipPath={`url(#cb-${c.replace(/\s/g, "")})`}>
          <rect x="0"  y="0" width="8"  height="16" fill={colors[0]} />
          <rect x="8"  y="0" width="8"  height="16" fill={colors[1]} />
          <rect x="16" y="0" width="8"  height="16" fill={colors[2]} />
        </g>
        <rect width="24" height="16" rx="3" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth=".75" />
      </svg>
    );
  };

  /* -- helper: format large numbers with commas ---------------- */
  const fmtNum = (n: number) => n.toLocaleString("en-US");

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
    let koIdx = 0;
    let running = completedKO;
    for (const r of koRoundCounts) {
      if (running < r.count) return r.label;
      running -= r.count;
      koIdx++;
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
   * 3. Host cities — unique cities with stats
   * ============================================================= */
  const hostCities = useMemo(() => {
    const cityMap: Record<string, { city: string; country: string; venues: string[]; matches: number }> = {};
    for (const v of venueList) {
      if (!cityMap[v.city]) {
        cityMap[v.city] = { city: v.city, country: v.country, venues: [], matches: 0 };
      }
      cityMap[v.city].venues.push(v.common);
      cityMap[v.city].matches += v.matches;
    }
    return Object.values(cityMap).sort((a, b) => b.matches - a.matches);
  }, [venueList]);

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
   * 5. History — hardcoded past World Cup data
   * ============================================================= */
  const pastWinners = [
    { year: 2022, host: "Qatar", winner: "Argentina", flag: "🇦🇷", runner: "France" },
    { year: 2018, host: "Russia", winner: "France", flag: "🇫🇷", runner: "Croatia" },
    { year: 2014, host: "Brazil", winner: "Germany", flag: "🇩🇪", runner: "Argentina" },
    { year: 2010, host: "South Africa", winner: "Spain", flag: "🇪🇸", runner: "Netherlands" },
    { year: 2006, host: "Germany", winner: "Italy", flag: "🇮🇹", runner: "France" },
    { year: 2002, host: "Korea/Japan", winner: "Brazil", flag: "🇧🇷", runner: "Germany" },
  ];

  const records = [
    { label: "Most Titles", value: "Brazil (5)" },
    { label: "Most Goals (Career)", value: "Miroslav Klose (16)" },
    { label: "Most Goals (Single)", value: "Just Fontaine (13, 1958)" },
    { label: "Most Appearances", value: "Lothar Matthäus (25)" },
    { label: "Fastest Goal", value: "Hakan Şükür (11 sec, 2002)" },
    { label: "Highest Scoring Final", value: "Argentina 3–3 France (2022)" },
  ];

  /* =============================================================
   * 6. Quick access navigation items
   * ============================================================= */
  const quickAccess: { view: ViewType; icon: string; title: string; desc: string }[] = [
    { view: "bracket", icon: "🏆", title: "Knockout Bracket", desc: "Full elimination bracket from R32 to the Final" },
    { view: "stats", icon: "📊", title: "Statistics", desc: "Top scorers, assists, cards and team leaderboards" },
    { view: "groups", icon: "⚽", title: "Groups", desc: "All 12 groups with live standings and results" },
    { view: "schedule", icon: "📅", title: "Full Schedule", desc: "Complete match schedule with live scores" },
    { view: "teams", icon: "🌍", title: "Teams", desc: "All 48 national teams and squad profiles" },
  ];

  /* =============================================================
   * 7. Share handler for app settings section
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
    <main className="more-view" aria-label="More">

      {/* ── Section 1: Hero ─────────────────────────────────── */}
      <section className="more-view__hero">
        <span>Compet 2026</span>
        <h2>More</h2>
        <p className="more-view__subtitle">Official FIFA World Cup Companion</p>
      </section>

      {/* ── Section 2: Tournament Progress ──────────────────── */}
      <section className="more-section">
        <h3 className="more-section__heading">Tournament Progress</h3>
        <div className="more-progress-card">
          <div className="more-progress-card__header">
            <span className="more-progress-card__stage">{stageLabel}</span>
            <span className="more-progress-card__count">{completedTotal} / {totalMatches}</span>
          </div>
          <div className="more-progress-bar">
            <div className="more-progress-bar__fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="more-progress-card__footer">
            <span>{progressPct}% complete</span>
            {countdown && <span className="more-progress-card__next">Next match in {countdown}</span>}
          </div>
          {/* Breakdown row: GS + KO counts */}
          <div className="more-progress-card__breakdown">
            <span>Group Stage: {completedGS}/72</span>
            <span>Knockout: {completedKO}/32</span>
          </div>
        </div>
      </section>

      {/* ── Section 3: Quick Access ─────────────────────────── */}
      <section className="more-section">
        <h3 className="more-section__heading">Quick Access</h3>
        <div className="more-quick-grid">
          {quickAccess.map((item, i) => (
            <button
              key={item.view}
              type="button"
              className="more-quick-card"
              style={{ animationDelay: `${i * 60}ms` }}
              onClick={() => onNavigate(item.view)}
            >
              <span className="more-quick-card__icon">{item.icon}</span>
              <b className="more-quick-card__title">{item.title}</b>
              <small className="more-quick-card__desc">{item.desc}</small>
            </button>
          ))}
        </div>
      </section>

      {/* ── Section 4: Stadiums ─────────────────────────────── */}
      <section className="more-section">
        <h3 className="more-section__heading">Stadiums</h3>
        <div className="more-venue-grid">
          {venueList.map((v, i) => (
            <div
              key={v.key}
              className="more-venue-card"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="more-venue-card__top">
                <span className="more-venue-card__flag">{countryBadge(v.country)}</span>
                <b className="more-venue-card__name">{v.common}</b>
              </div>
              <span className="more-venue-card__city">{v.city}, {v.country}</span>
              <div className="more-venue-card__stats">
                <span>🏟 {fmtNum(v.cap)}</span>
                <span>⚽ {v.matches} match{v.matches !== 1 ? "es" : ""}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 5: Host Cities ──────────────────────────── */}
      <section className="more-section">
        <h3 className="more-section__heading">Host Cities</h3>
        <div className="more-cities-list">
          {hostCities.map((c, i) => (
            <div
              key={c.city}
              className="more-city-row"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <span className="more-city-row__flag">{countryBadge(c.country)}</span>
              <div className="more-city-row__info">
                <b>{c.city}</b>
                <small>{c.country} · {c.venues.join(", ")}</small>
              </div>
              <span className="more-city-row__badge">{c.matches} match{c.matches !== 1 ? "es" : ""}</span>
            </div>
          ))}
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
            <span className="more-settings-row__icon">ℹ️</span>
            <span>About Compet 2026</span>
            <span className="more-settings-row__chevron">›</span>
          </button>
          <button type="button" className="more-settings-row" onClick={() => {}}>
            <span className="more-settings-row__icon">🔔</span>
            <span>Notifications</span>
            <span className="more-settings-row__chevron">›</span>
          </button>
          <button type="button" className="more-settings-row" onClick={handleShare}>
            <span className="more-settings-row__icon">📤</span>
            <span>Share the App</span>
            <span className="more-settings-row__chevron">›</span>
          </button>
          <div className="more-settings-row more-settings-row--version">
            <span className="more-settings-row__icon">⚙️</span>
            <span>Version</span>
            <span className="more-settings-row__version">v1.0.0</span>
          </div>
        </div>
      </section>

    </main>
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
  const roadCenterRef = useRef<HTMLDivElement | null>(null);

  const byRound = useMemo(() => {
    const grouped = new Map<string, KnockoutMatch[]>();
    for (const match of data.ko) {
      const list = grouped.get(match.round) || [];
      list.push(match);
      grouped.set(match.round, list);
    }
    return grouped;
  }, [data.ko]);

  function venueName(code: string) {
    return data.venues[code] || { common: "", city: "", country: "" };
  }

  function fmtDate(match: KnockoutMatch) {
    const dt = parseISO(match.iso);
    return `${DOW[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}`;
  }

  const teamName = useCallback((name: string | undefined | null): string => {
    if (!name) return "TBD";
    const normalized = canon(name);
    return normalized || name;
  }, []);

  const winnerFromFixture = useCallback((fixture: LiveFixture | null): string | null => {
    if (!isCompletedKnockoutFixture(fixture) || fixture.gh == null || fixture.ga == null || fixture.gh === fixture.ga) return null;
    return fixture.gh > fixture.ga ? teamName(fixture.home) : teamName(fixture.away);
  }, [teamName]);

  const loserFromFixture = useCallback((fixture: LiveFixture | null): string | null => {
    if (!isCompletedKnockoutFixture(fixture) || fixture.gh == null || fixture.ga == null || fixture.gh === fixture.ga) return null;
    return fixture.gh > fixture.ga ? teamName(fixture.away) : teamName(fixture.home);
  }, [teamName]);

  const standingsByGroup = useMemo(() => {
    const groupMap: Record<string, GroupStanding> = {};
    for (const g of Object.keys(data.groups)) {
      groupMap[g] = completedGroupStanding(g, data, fixtures, findLive, nowMs);
    }
    return groupMap;
  }, [data, findLive, fixtures, nowMs]);

  // Resolve third-place qualifiers into specific R32 slots using FIFA Annex C
  const thirdPlaceSlots = useMemo(
    () => resolveThirdPlaceSlots(standingsByGroup),
    [standingsByGroup],
  );

  const rounds = useMemo(() => {
    const winners: Partial<Record<KnockoutRoundKey, (string | null)[]>> = {};
    const losers: Partial<Record<KnockoutRoundKey, (string | null)[]>> = {};

    function sourcePair(round: KnockoutRoundKey, index: number): [number, number] {
      return KO_SOURCE_PAIRS[round]?.[index] || [index * 2, index * 2 + 1];
    }

    function previousWinner(round: KnockoutRoundKey, index: number): string | null {
      if (round === "r16") return winners.r32?.[index] || null;
      if (round === "qf") return winners.r16?.[index] || null;
      if (round === "sf") return winners.qf?.[index] || null;
      if (round === "final") return winners.sf?.[index] || null;
      if (round === "third") return losers.sf?.[index] || null;
      return null;
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

    return KO_ROUNDS.map(config => {
      const scheduled = byRound.get(config.dataRound) || [];
      const cards: KnockoutCardModel[] = scheduled.map((match, index) => {
        const matchNo = config.matchNumbers[index] || Number(match.mr) || 0;
        const fixture = findLive({ ts: match.ts, v: match.v }, fixtures);
        const isLive = !!fixture && LIVE_STATUSES.has(fixture.status) && !isStaleStatus(match.ts, fixture.status);
        const isDone = isCompletedKnockoutFixture(fixture);
        const winnerName = winnerFromFixture(fixture);
        const loserName = loserFromFixture(fixture);
        let teamA: KnockoutParticipant;
        let teamB: KnockoutParticipant;

        if (fixture?.home && fixture?.away) {
          const home = teamName(fixture.home);
          const away = teamName(fixture.away);
          teamA = { name: home, winner: winnerName === home, loser: loserName === home };
          teamB = { name: away, winner: winnerName === away, loser: loserName === away };
        } else if (config.key === "r32") {
          const [seedA, seedB] = R32_SEEDS[index] || ["TBD", "TBD"];
          teamA = resolveGroupSeed(seedA, standingsByGroup);
          // For "3rd" seeds, use the Annex C resolution if available
          if (seedB === "3rd" && thirdPlaceSlots) {
            const resolved = thirdPlaceSlots.get(index);
            if (resolved) {
              teamB = { name: resolved.team, seed: `3rd Group ${resolved.group}` };
            } else {
              teamB = { name: "Best 3rd", placeholder: true };
            }
          } else {
            teamB = resolveGroupSeed(seedB, standingsByGroup);
          }
        } else {
          const [sourceA, sourceB] = sourcePair(config.key, index);
          const sourceLabel = sourceFor(config.key, index).split(" / ");
          const first = previousWinner(config.key, sourceA);
          const second = previousWinner(config.key, sourceB);
          teamA = { name: first || "TBD", seed: first ? undefined : sourceLabel[0] };
          teamB = { name: second || "TBD", seed: second ? undefined : sourceLabel[1] };
        }

        return {
          key: `${config.key}-${matchNo}-${index}`,
          round: config.key,
          roundIndex: index,
          match,
          matchNo,
          fixture,
          teams: [teamA, teamB],
          source: sourceFor(config.key, index),
          isDone,
          isLive,
          winnerName,
          loserName,
        };
      });
      winners[config.key] = cards.map(card => card.winnerName);
      losers[config.key] = cards.map(card => card.loserName);
      return { ...config, cards };
    });
  }, [byRound, findLive, fixtures, loserFromFixture, standingsByGroup, thirdPlaceSlots, teamName, winnerFromFixture]);

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
    R32_SEEDS.forEach((pair, index) => {
      pair.forEach(seed => {
        if (seed !== "3rd" && !/^([12][A-L])$/.test(seed)) warnings.push(`Invalid R32 seed "${seed}" at slot ${index + 1}`);
      });
    });
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
    if (card.round === "r32") return `Winner advances to R16 Match ${89 + Math.floor(card.roundIndex / 2)}`;
    if (card.round === "r16") {
      const qfIndex = KO_SOURCE_PAIRS.qf?.findIndex(pair => pair.includes(card.roundIndex)) ?? -1;
      return `Winner advances to QF Match ${qfIndex >= 0 ? KO_ROUNDS[2].matchNumbers[qfIndex] : "TBD"}`;
    }
    if (card.round === "qf") return `Winner advances to SF Match ${101 + Math.floor(card.roundIndex / 2)}`;
    if (card.round === "sf") return card.roundIndex === 0 ? "Winner advances to the Final" : "Winner advances to the Final";
    if (card.round === "third") return "Winner claims third place";
    return "Winner becomes champion";
  }

  function downstreamPath(card: KnockoutCardModel): KnockoutCardModel[] {
    const path = [card];
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

  const selectedPath = selectedCard ? downstreamPath(selectedCard) : [];
  const selectedPathKeys = new Set(selectedPath.map(card => card.key));
  const shouldDim = !!selectedPathKey;
  const roundMap = new Map(rounds.map(round => [round.key, round.cards]));
  const leftRoad = [
    { key: "r32" as KnockoutRoundKey, label: "RD of 32", detail: "16 teams", cards: (roundMap.get("r32") || []).slice(0, 8) },
    { key: "r16" as KnockoutRoundKey, label: "RD 16", detail: "8 teams", cards: (roundMap.get("r16") || []).slice(0, 4) },
    { key: "qf" as KnockoutRoundKey, label: "Quarters", detail: "4 teams", cards: (roundMap.get("qf") || []).slice(0, 2) },
    { key: "sf" as KnockoutRoundKey, label: "Semis", detail: "2 teams", cards: (roundMap.get("sf") || []).slice(0, 1) },
  ];
  const rightRoad = [
    { key: "sf" as KnockoutRoundKey, label: "Semis", detail: "2 teams", cards: (roundMap.get("sf") || []).slice(1, 2) },
    { key: "qf" as KnockoutRoundKey, label: "Quarters", detail: "4 teams", cards: (roundMap.get("qf") || []).slice(2, 4) },
    { key: "r16" as KnockoutRoundKey, label: "RD 16", detail: "8 teams", cards: (roundMap.get("r16") || []).slice(4, 8) },
    { key: "r32" as KnockoutRoundKey, label: "RD of 32", detail: "16 teams", cards: (roundMap.get("r32") || []).slice(8, 16) },
  ];
  const finalCard = (roundMap.get("final") || [])[0];
  const thirdCard = (roundMap.get("third") || [])[0];

  function selectRoad(card: KnockoutCardModel, team?: KnockoutParticipant) {
    setSelectedPathKey(card.key);
    setSelectedTeamName(team && !team.placeholder && team.name !== "TBD" ? team.name : "");
  }

  function focusRound(key: KnockoutRoundKey) {
    setActiveRound(key);
    setSelectedPathKey("");
    setSelectedTeamName("");
    window.setTimeout(() => {
      const scroller = roadScrollRef.current;
      const centerChild = (element: HTMLElement | null | undefined) => {
        if (!scroller || !element) return;
        const left = element.offsetLeft - (scroller.clientWidth - element.clientWidth) / 2;
        scroller.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
      };
      if (key === "final" || key === "third") {
        centerChild(roadCenterRef.current);
        return;
      }
      const column = roadScrollRef.current?.querySelector<HTMLElement>(`.ko-road__column[data-round="${key}"][data-side="left"], .ko-road__column[data-round="${key}"]`);
      centerChild(column);
    }, 40);
  }

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
    return (
      <button
        key={`${card.key}-road-team-${teamIndex}`}
        type="button"
        className={`ko-road-team${team.winner ? " ko-road-team--winner" : ""}${team.placeholder || team.name === "TBD" ? " ko-road-team--tbd" : ""}${selected ? " ko-road-team--selected" : ""}`}
        onClick={() => selectRoad(card, team)}
      >
        <span>{team.placeholder || team.name === "TBD" ? "TBD" : (data.flags[team.name] || "⚽")}</span>
        <b>{team.name}</b>
        {team.seed && <small>{team.seed}</small>}
        {score != null && <strong>{score}</strong>}
      </button>
    );
  }

  function renderRoadCard(card: KnockoutCardModel, tone: "left" | "right" | "center" = "left", style?: CSSProperties) {
    const isSelected = selectedPathKeys.has(card.key);
    const status = card.isLive ? (card.fixture?.elapsed ? `${card.fixture.elapsed}'` : "LIVE") : card.isDone ? "FT" : "Scheduled";
    return (
      <article
        key={`road-${card.key}`}
        className={`ko-road-card ko-road-card--${tone}${card.isLive ? " ko-road-card--live" : ""}${card.isDone ? " ko-road-card--done" : ""}${isSelected ? " ko-road-card--path" : ""}${shouldDim && !isSelected ? " ko-road-card--dim" : ""}`}
        style={style}
      >
        <div className="ko-road-card__top">
          <span>M{card.matchNo}</span>
          <b>{status}</b>
        </div>
        <div className="ko-road-card__teams">
          {card.teams.map((team, index) => renderRoadTeam(card, team, index))}
        </div>
        <button type="button" className="ko-road-card__details" onClick={() => openMatch(card)}>Details</button>
      </article>
    );
  }

  return (
    <section className="ko-stage" aria-label="Knockout Stage">
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
            <b>{round.cards.filter(card => card.isDone).length}/{round.cards.length}</b>
          </button>
        ))}
      </div>

      <div className="ko-road" aria-label="Road to the World Cup">
        <div className="ko-road__intro">
          <span>Road to the Final</span>
          <b>{selectedTeamName ? `${selectedTeamName}'s path` : "Tap a team to trace their road to the trophy"}</b>
        </div>
        <div className="ko-road__scroll" ref={roadScrollRef}>
          <div className="ko-road__side ko-road__side--left" aria-label="Left side of bracket">
            {leftRoad.map(column => (
              <div key={`left-${column.key}`} data-round={column.key} data-side="left" className={`ko-road__column ko-road__column--${column.key}${activeRound === column.key ? " ko-road__column--active" : ""}`}>
                <div className="ko-road__round"><span>{column.label}</span><small>{column.detail}</small></div>
                <div className="ko-road__stack">
                  {column.cards.map((card, index) => renderRoadCard(card, "left", { gridRow: bracketGridRow(column.key, index) }))}
                </div>
              </div>
            ))}
          </div>

          <div className="ko-road__center" ref={roadCenterRef} aria-label="World Cup final path">
            <div className="ko-road__trophy" style={{ gridRow: "4 / span 3" }}>
              <WorldCupTrophy className="ko-road__cup-img" />
              <span>FIFA World Cup</span>
              <small>MetLife Stadium, New Jersey</small>
            </div>
            {finalCard && renderRoadCard(finalCard, "center", { gridRow: "8 / span 3" })}
            {thirdCard && (
              <div className="ko-road__third" style={{ gridRow: "12 / span 3" }}>
                <span>Third Place</span>
                {renderRoadCard(thirdCard, "center")}
              </div>
            )}
          </div>

          <div className="ko-road__side ko-road__side--right" aria-label="Right side of bracket">
            {rightRoad.map(column => (
              <div key={`right-${column.key}`} data-round={column.key} data-side="right" className={`ko-road__column ko-road__column--${column.key}${activeRound === column.key ? " ko-road__column--active" : ""}`}>
                <div className="ko-road__round"><span>{column.label}</span><small>{column.detail}</small></div>
                <div className="ko-road__stack">
                  {column.cards.map((card, index) => renderRoadCard(card, "right", { gridRow: bracketGridRow(column.key, index) }))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="ko-road__hint" aria-hidden="true">
          <span>←</span>
          <b>Swipe horizontally to explore both sides</b>
          <span>→</span>
        </div>
      </div>

      {selectedCard && (
        <div className="ko-path" aria-label="Selected path to the Final">
          <div className="ko-path__label">Path to Final</div>
          <div className="ko-path__rail">
            {selectedPath.map((card, index) => (
              <div key={card.key} className="ko-path__step">
                <span>{card.round === "final" ? "Final" : card.round.toUpperCase()}</span>
                <b>{card.winnerName || `Winner M${card.matchNo}`}</b>
                {index < selectedPath.length - 1 && <i>↓</i>}
              </div>
            ))}
            <div className="ko-path__step ko-path__step--champ">
              <span>Champion</span>
              <b>Trophy</b>
            </div>
          </div>
        </div>
      )}

      <div className="ko-round-focus" aria-live="polite">
        <div className="ko-round__head">
          <div>
            <span>{activeRoundModel.label}</span>
            <small>{activeRoundModel.cards.filter(card => card.isDone).length ? `${activeRoundModel.cards.filter(card => card.isDone).length} decided` : "Awaiting qualifiers"}</small>
          </div>
          <b>{activeRoundModel.short}</b>
        </div>
        <div className="ko-mobile-list">
          {activeRoundModel.cards.map(card => {
            const v = venueName(card.match.v);
            const status = card.isLive ? (card.fixture?.elapsed ? `${card.fixture.elapsed}'` : "LIVE") : card.isDone ? "FT" : "Scheduled";
            const scoreA = card.fixture?.gh;
            const scoreB = card.fixture?.ga;
            const isSelected = selectedPathKeys.has(card.key);
            return (
              <article
                key={card.key}
                className={`ko-match ko-match--${card.round}${card.isLive ? " ko-match--live" : ""}${card.isDone ? " ko-match--done" : ""}${card.round === "final" ? " ko-match--final" : ""}${isSelected ? " ko-match--path" : ""}${shouldDim && !isSelected ? " ko-match--dim" : ""}`}
              >
                <button type="button" className="ko-match__tap" onClick={() => selectRoad(card)} aria-label={`Show path for match ${card.matchNo}`}>
                  <div className="ko-match__meta">
                    <span>Match {card.matchNo || card.match.mr}</span>
                    <b>{status}</b>
                  </div>
                  <div className="ko-match__teams">
                    {card.teams.map((team, teamIndex) => {
                      const score = teamIndex === 0 ? scoreA : scoreB;
                      return (
                        <div key={`${card.key}-${teamIndex}`} className={`ko-team${team.winner ? " ko-team--winner" : ""}${team.name === "TBD" || team.placeholder ? " ko-team--tbd" : ""}`}>
                          <span className="ko-team__flag">{team.name === "TBD" || team.placeholder ? "TBD" : (data.flags[team.name] || "⚽")}</span>
                          <span className="ko-team__name">{team.name}</span>
                          {team.seed && <span className="ko-team__seed">{team.seed}</span>}
                          {score != null && <strong>{score}</strong>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="ko-match__foot">
                    <span>{fmtDate(card.match)} · {card.match.et}</span>
                    <span>{v.common}</span>
                  </div>
                  <div className="ko-match__advance">{nextDestination(card)}</div>
                </button>
                <button type="button" className="ko-match__details" onClick={() => openMatch(card)}>Match Details</button>
              </article>
            );
          })}
        </div>
      </div>

      <p className="ko-stage__note">
        No unverified scores are shown. Future teams remain TBD until qualifying and live fixture data confirm the matchup.
        {process.env.NODE_ENV === "development" && validationWarnings.length > 0 ? ` Dev validation: ${validationWarnings.length} bracket warning${validationWarnings.length === 1 ? "" : "s"}.` : ""}
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

  if (liveMatches.length > 0) {
    const { match, fixture } = liveMatches[0];
    const v = data.venues[match.v];
    const elapsed = fixture.status === "HT" ? "Half Time" : `${fixture.elapsed || ""}'`;
    return (
      <div className="cd-hero cd-hero--live">
        <div className="cd-hero__label"><span className="cd-hero__pulse" />{liveMatches.length > 1 ? `${liveMatches.length} MATCHES LIVE` : "LIVE NOW"}</div>
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
  let nextKo: KnockoutMatch | null = null;
  for (const k of data.ko) {
    if (k.ts > now && (!nextKo || k.ts < nextKo.ts)) nextKo = k;
  }

  const useGs = nextGs && (!nextKo || nextGs.ts <= nextKo.ts);
  const ts = useGs ? nextGs!.ts : nextKo?.ts;
  if (!ts) return null;

  const diff = Math.max(0, ts - now);
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const mn = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  const isoDate = useGs ? nextGs!.iso : nextKo!.iso;
  const d = parseISO(isoDate);
  const etTime = useGs ? nextGs!.et : nextKo!.et;
  const venCode = useGs ? nextGs!.v : nextKo!.v;
  const v = data.venues[venCode];

  return (
    <div className="cd-hero" role="button" tabIndex={0} onClick={jumpToNext} onKeyDown={handleKey} aria-label="Jump to next match">
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
      ) : nextKo ? (
        <div className="cd-hero__teams"><span className="cd-hero__round">{nextKo.round}</span></div>
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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
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

function mergeRichFixture(primary: LiveFixture | null, fallback: LiveFixture | null): LiveFixture | null {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    ...primary,
    events: primary.events?.length ? primary.events : fallback.events,
    stats: primary.stats && (Object.keys(primary.stats.home).length || Object.keys(primary.stats.away).length) ? primary.stats : fallback.stats,
    lineups: (primary.lineups?.length || 0) >= 2 ? primary.lineups : (fallback.lineups || primary.lineups),
    players: primary.players?.length ? primary.players : fallback.players,
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
  useEffect(() => {
    queueMicrotask(() => setNowMs(Date.now()));
    const id = setInterval(() => { if (!document.hidden) setNowMs(Date.now()); }, 60000);
    return () => clearInterval(id);
  }, []);
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
  const liveFixture = findLive(match, fixtures) || initialFixture;
  const fixture = mergeRichFixture(liveFixture, persistedFixture);

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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

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
        <button className="drawer__close" onClick={onClose} aria-label="Close">&times;</button>
        <div className="md-drawer__badge">Group {match.g} · Match #{match.no}</div>

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
                return <div key={i} className="md-drawer__scorer">⚽ {g.player} {min}{pen}</div>;
              })}
            </div>
            <div className="md-drawer__scorers-col md-drawer__scorers-col--away">
              {awayGoals.map((g, i) => {
                const min = g.extra ? `${g.minute}+${g.extra}'` : `${g.minute}'`;
                const pen = g.detail === "Penalty" ? " (P)" : g.detail === "Own Goal" ? " (OG)" : "";
                return <div key={i} className="md-drawer__scorer">{g.player} {min}{pen} ⚽</div>;
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
          {v.common} · {v.city}, {v.country}
          <br />{match.et}{match.local !== match.et ? ` (${match.local})` : ""}
          {fixture?.referee && <><br />Referee: {fixture.referee}</>}
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
        <div className="md-drawer__empty-icon">📊</div>
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
                    <span>{eventIcon(g.type, g.detail)} {g.player}</span>
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
          {v.common} · {v.city}, {v.country}
          <br />{match.et}{match.local !== match.et ? ` (${match.local})` : ""}
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

/** Stats view — tournament dashboard with visualizations */
function StatsView({ data, fixtures, fl, computeLeaders }: {
  data: TournamentData;
  fixtures: LiveFixture[];
  fl: (t: string) => string;
  computeLeaders: () => {
    topScorers: { name: string; team: string; goals: number; penalties: number }[];
    topAssisters: { name: string; team: string; assists: number }[];
    topCombined: { name: string; team: string; goals: number; assists: number; total: number }[];
    topTeams: { team: string; goals: number }[];
    mostCarded: { name: string; team: string; yellows: number; reds: number }[];
    minuteBuckets: number[];
    bucketLabels: string[];
    totalGoals: number;
    normalGoals: number;
    penGoals: number;
    ownGoals: number;
    totalYellows: number;
    totalReds: number;
    totalSubs: number;
    matchesPlayed: number;
    avgGoals: number;
    cleanSheets: number;
  };
}) {
  const stats = useMemo(() => computeLeaders(), [fixtures, computeLeaders]);
  const {
    topScorers, topAssisters, topCombined, topTeams, mostCarded,
    minuteBuckets, bucketLabels,
    totalGoals, normalGoals, penGoals, ownGoals,
    totalYellows, totalReds, totalSubs,
    matchesPlayed, avgGoals, cleanSheets,
  } = stats;
  const hasData = topScorers.length > 0 || topAssisters.length > 0 || topCombined.length > 0;
  const hasCards = totalYellows > 0 || totalReds > 0;
  const maxBucket = Math.max(...minuteBuckets, 1);
  const maxScorerGoals = topScorers.length > 0 ? topScorers[0].goals : 1;
  const maxTeamGoals = topTeams.length > 0 ? topTeams[0].goals : 1;

  return (
    <main className="section stats-view">
      {/* Trophy hero */}
      <div className="stats-trophy">
        <WorldCupTrophy id="st" className="stats-trophy__svg" />
      </div>

      {!hasData && !hasCards && (
        <div className="stats-empty">
          <p>Goal and assist tallies appear here once matches finish.</p>
          <p className="stats-empty__sub">Data updates automatically from live match events.</p>
        </div>
      )}

      {/* ── Tournament summary cards — two rows ── */}
      {(hasData || hasCards) && (
        <>
          <div className="stats-summary">
            <div className="stats-card stagger-rise">
              <span className="stats-card__value">{totalGoals}</span>
              <span className="stats-card__label">Goals</span>
            </div>
            <div className="stats-card stagger-rise">
              <span className="stats-card__value">{matchesPlayed}</span>
              <span className="stats-card__label">Matches</span>
            </div>
            <div className="stats-card stagger-rise">
              <span className="stats-card__value">{avgGoals}</span>
              <span className="stats-card__label">Avg / Match</span>
            </div>
            <div className="stats-card stagger-rise">
              <span className="stats-card__value">{cleanSheets}</span>
              <span className="stats-card__label">Clean Sheets</span>
            </div>
          </div>
          <div className="stats-summary stats-summary--secondary">
            <div className="stats-card stats-card--yellow stagger-rise">
              <span className="stats-card__value">{totalYellows}</span>
              <span className="stats-card__label">Yellows</span>
            </div>
            <div className="stats-card stats-card--red stagger-rise">
              <span className="stats-card__value">{totalReds}</span>
              <span className="stats-card__label">Reds</span>
            </div>
            <div className="stats-card stats-card--sub stagger-rise">
              <span className="stats-card__value">{totalSubs}</span>
              <span className="stats-card__label">Subs</span>
            </div>
          </div>
        </>
      )}

      {/* ── Goal type breakdown ── */}
      {totalGoals > 0 && (
        <section className="stats-section">
          <h3 className="stats-heading">Goal Types</h3>
          <div className="stats-type-row">
            <div className="stats-type-item">
              <div className="stats-type-bar" style={{ "--bar-pct": `${(normalGoals / totalGoals) * 100}%` } as CSSProperties}>
                <span className="stats-type-fill stats-type-fill--normal" />
              </div>
              <span className="stats-type-count">{normalGoals}</span>
              <span className="stats-type-label">Open Play</span>
            </div>
            <div className="stats-type-item">
              <div className="stats-type-bar" style={{ "--bar-pct": `${(penGoals / totalGoals) * 100}%` } as CSSProperties}>
                <span className="stats-type-fill stats-type-fill--pen" />
              </div>
              <span className="stats-type-count">{penGoals}</span>
              <span className="stats-type-label">Penalty</span>
            </div>
            <div className="stats-type-item">
              <div className="stats-type-bar" style={{ "--bar-pct": `${(ownGoals / totalGoals) * 100}%` } as CSSProperties}>
                <span className="stats-type-fill stats-type-fill--og" />
              </div>
              <span className="stats-type-count">{ownGoals}</span>
              <span className="stats-type-label">Own Goal</span>
            </div>
          </div>
        </section>
      )}

      {/* ── Goals by minute distribution ── */}
      {totalGoals > 0 && (
        <section className="stats-section">
          <h3 className="stats-heading">When Goals Are Scored</h3>
          <div className="stats-chart">
            {minuteBuckets.map((count, i) => (
              <div key={bucketLabels[i]} className="stats-bar-col">
                <span className="stats-bar-val">{count || ""}</span>
                <div className="stats-bar" style={{ "--bar-h": `${(count / maxBucket) * 100}%` } as CSSProperties} />
                <span className="stats-bar-label">{bucketLabels[i]}</span>
              </div>
            ))}
          </div>
          <div className="stats-chart-axis">Minutes</div>
        </section>
      )}

      {/* ── Top Scorers with visual bars ── */}
      {topScorers.length > 0 && (
        <section className="stats-section">
          <h3 className="stats-heading">Top Scorers</h3>
          <div className="stats-scorer-list">
            {topScorers.slice(0, 10).map((s, i) => (
              <div key={`${s.name}-${s.team}`} className={`stats-scorer stagger-rise${i < 3 ? ` stats-scorer--${["gold","silver","bronze"][i]}` : ""}`}>
                <span className="stats-scorer__rank">{i + 1}</span>
                <span className="stats-scorer__flag">{fl(s.team)}</span>
                <div className="stats-scorer__info">
                  <span className="stats-scorer__name">{s.name}</span>
                  <span className="stats-scorer__team">{s.team}</span>
                </div>
                <div className="stats-scorer__bar-wrap">
                  <div className="stats-scorer__bar" style={{ "--bar-w": `${(s.goals / maxScorerGoals) * 100}%` } as CSSProperties} />
                </div>
                <span className="stats-scorer__goals">{s.goals}</span>
                {s.penalties > 0 && <span className="stats-scorer__pen">({s.penalties}p)</span>}
              </div>
            ))}
          </div>
          {topScorers.length > 10 && (
            <details className="stats-expand">
              <summary>Show all {topScorers.length} scorers</summary>
              <div className="stats-scorer-list">
                {topScorers.slice(10).map((s, i) => (
                  <div key={`${s.name}-${s.team}`} className="stats-scorer">
                    <span className="stats-scorer__rank">{i + 11}</span>
                    <span className="stats-scorer__flag">{fl(s.team)}</span>
                    <div className="stats-scorer__info">
                      <span className="stats-scorer__name">{s.name}</span>
                      <span className="stats-scorer__team">{s.team}</span>
                    </div>
                    <div className="stats-scorer__bar-wrap">
                      <div className="stats-scorer__bar" style={{ "--bar-w": `${(s.goals / maxScorerGoals) * 100}%` } as CSSProperties} />
                    </div>
                    <span className="stats-scorer__goals">{s.goals}</span>
                    {s.penalties > 0 && <span className="stats-scorer__pen">({s.penalties}p)</span>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {/* ── Top Assists ── */}
      {topAssisters.length > 0 && (
        <section className="stats-section">
          <h3 className="stats-heading">Top Assists</h3>
          <div className="stats-scorer-list">
            {topAssisters.slice(0, 10).map((a, i) => (
              <div key={`${a.name}-${a.team}`} className={`stats-scorer stagger-rise${i < 3 ? ` stats-scorer--${["gold","silver","bronze"][i]}` : ""}`}>
                <span className="stats-scorer__rank">{i + 1}</span>
                <span className="stats-scorer__flag">{fl(a.team)}</span>
                <div className="stats-scorer__info">
                  <span className="stats-scorer__name">{a.name}</span>
                  <span className="stats-scorer__team">{a.team}</span>
                </div>
                <div className="stats-scorer__bar-wrap">
                  <div className="stats-scorer__bar stats-scorer__bar--assist" style={{ "--bar-w": `${(a.assists / (topAssisters[0]?.assists || 1)) * 100}%` } as CSSProperties} />
                </div>
                <span className="stats-scorer__goals">{a.assists}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Goals + assists ── */}
      {topCombined.length > 0 && (
        <section className="stats-section">
          <h3 className="stats-heading">Goals + Assists</h3>
          <div className="stats-scorer-list">
            {topCombined.slice(0, 10).map((p, i) => (
              <div key={`${p.name}-${p.team}`} className={`stats-scorer stagger-rise${i < 3 ? ` stats-scorer--${["gold","silver","bronze"][i]}` : ""}`}>
                <span className="stats-scorer__rank">{i + 1}</span>
                <span className="stats-scorer__flag">{fl(p.team)}</span>
                <div className="stats-scorer__info">
                  <span className="stats-scorer__name">{p.name}</span>
                  <span className="stats-scorer__team">{p.team} · {p.goals}G {p.assists}A</span>
                </div>
                <div className="stats-scorer__bar-wrap">
                  <div className="stats-scorer__bar stats-scorer__bar--combined" style={{ "--bar-w": `${(p.total / (topCombined[0]?.total || 1)) * 100}%` } as CSSProperties} />
                </div>
                <span className="stats-scorer__goals">{p.total}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Discipline — most carded players ── */}
      {mostCarded.length > 0 && (
        <section className="stats-section">
          <h3 className="stats-heading">Discipline</h3>
          <div className="stats-scorer-list">
            {mostCarded.map((c, i) => (
              <div key={`${c.name}-${c.team}`} className="stats-scorer stagger-rise">
                <span className="stats-scorer__rank">{i + 1}</span>
                <span className="stats-scorer__flag">{fl(c.team)}</span>
                <div className="stats-scorer__info">
                  <span className="stats-scorer__name">{c.name}</span>
                  <span className="stats-scorer__team">{c.team}</span>
                </div>
                <div className="stats-card-icons">
                  {c.yellows > 0 && <span className="stats-card-icon stats-card-icon--yellow" title="Yellow cards">{c.yellows > 1 ? `${c.yellows}x` : ""}🟨</span>}
                  {c.reds > 0 && <span className="stats-card-icon stats-card-icon--red" title="Red cards">{c.reds > 1 ? `${c.reds}x` : ""}🟥</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Team Goals leaderboard ── */}
      {topTeams.length > 0 && (
        <section className="stats-section">
          <h3 className="stats-heading">Goals by Team</h3>
          <div className="stats-scorer-list">
            {topTeams.map((t, i) => (
              <div key={t.team} className="stats-team-row stagger-rise">
                <span className="stats-scorer__rank">{i + 1}</span>
                <span className="stats-scorer__flag" style={{ fontSize: 20 }}>{fl(t.team)}</span>
                <div className="stats-scorer__info">
                  <span className="stats-scorer__name">{t.team}</span>
                </div>
                <div className="stats-scorer__bar-wrap">
                  <div className="stats-scorer__bar stats-scorer__bar--team" style={{ "--bar-w": `${(t.goals / maxTeamGoals) * 100}%` } as CSSProperties} />
                </div>
                <span className="stats-scorer__goals">{t.goals}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

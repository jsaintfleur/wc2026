"use client";
import { useState, useRef, useEffect } from "react";

/* ── types ─────────────────────────────────────────────────────── */

interface BracketBuilderProps {
  flags: Record<string, string>;
  groups: Record<string, string[]>;
  gcolor: Record<string, string>;
}

/* Group predictions: 1st, 2nd, 3rd for each group */
type GroupPredictions = Record<string, { first: string; second: string; third: string }>;

/* Knockout picks: winner of each matchup */
interface KnockoutPicks {
  r32: (string | null)[];   /* 16 winners */
  r16: (string | null)[];   /* 8 winners */
  qf:  (string | null)[];   /* 4 winners */
  sf:  (string | null)[];   /* 2 winners */
  champion: string | null;
}

type ThirdPlaceSlot = "1A" | "1B" | "1D" | "1E" | "1G" | "1I" | "1K" | "1L";
type Seed = `${1 | 2}${string}` | `3@${ThirdPlaceSlot}`;

interface R32Match {
  no: number;
  seeds: [Seed, Seed];
}

/* Official FIFA bracket path. The order below pairs adjacent R32 winners into R16 matches:
   M89 = W73/W75, M90 = W74/W77, M91 = W76/W78, M92 = W79/W80,
   M93 = W83/W84, M94 = W81/W82, M95 = W86/W88, M96 = W85/W87. */
const R32_MATCHES: R32Match[] = [
  { no: 73, seeds: ["2A", "2B"] },
  { no: 75, seeds: ["1F", "2C"] },
  { no: 74, seeds: ["1E", "3@1E"] },
  { no: 77, seeds: ["1I", "3@1I"] },
  { no: 76, seeds: ["1C", "2F"] },
  { no: 78, seeds: ["2E", "2I"] },
  { no: 79, seeds: ["1A", "3@1A"] },
  { no: 80, seeds: ["1L", "3@1L"] },
  { no: 83, seeds: ["2K", "2L"] },
  { no: 84, seeds: ["1H", "2J"] },
  { no: 81, seeds: ["1D", "3@1D"] },
  { no: 82, seeds: ["1G", "3@1G"] },
  { no: 86, seeds: ["1J", "2H"] },
  { no: 88, seeds: ["2D", "2G"] },
  { no: 85, seeds: ["1B", "3@1B"] },
  { no: 87, seeds: ["1K", "3@1K"] },
];

const R16_MATCH_NUMBERS = [89, 90, 91, 92, 93, 94, 95, 96];
const QF_MATCH_NUMBERS = [97, 98, 99, 100];
const SF_MATCH_NUMBERS = [101, 102];
const QF_SOURCE_PAIRS = [[0, 1], [4, 5], [2, 3], [6, 7]] as const;
const SF_SOURCE_PAIRS = [[0, 1], [2, 3]] as const;

/* FIFA Annex C / third-place combination table. Each row is:
   selected third-place groups -> opponents for 1A, 1B, 1D, 1E, 1G, 1I, 1K, 1L. */
const THIRD_PLACE_ASSIGNMENT_DATA = "EFGHIJKL:EJIFHGLK|DFGHIJKL:HGIDJFLK|DEGHIJKL:EJIDHGLK|DEFHIJKL:EJIDHFLK|DEFGIJKL:EGIDJFLK|DEFGHJKL:EGJDHFLK|DEFGHIKL:EGIDHFLK|DEFGHIJL:EGJDHFLI|DEFGHIJK:EGJDHFIK|CFGHIJKL:HGICJFLK|CEGHIJKL:EJICHGLK|CEFHIJKL:EJICHFLK|CEFGIJKL:EGICJFLK|CEFGHJKL:EGJCHFLK|CEFGHIKL:EGICHFLK|CEFGHIJL:EGJCHFLI|CEFGHIJK:EGJCHFIK|CDGHIJKL:HGICJDLK|CDFHIJKL:CJIDHFLK|CDFGIJKL:CGIDJFLK|CDFGHJKL:CGJDHFLK|CDFGHIKL:CGIDHFLK|CDFGHIJL:CGJDHFLI|CDFGHIJK:CGJDHFIK|CDEHIJKL:EJICHDLK|CDEGIJKL:EGICJDLK|CDEGHJKL:EGJCHDLK|CDEGHIKL:EGICHDLK|CDEGHIJL:EGJCHDLI|CDEGHIJK:EGJCHDIK|CDEFIJKL:CJEDIFLK|CDEFHJKL:CJEDHFLK|CDEFHIKL:CEIDHFLK|CDEFHIJL:CJEDHFLI|CDEFHIJK:CJEDHFIK|CDEFGJKL:CGEDJFLK|CDEFGIKL:CGEDIFLK|CDEFGIJL:CGEDJFLI|CDEFGIJK:CGEDJFIK|CDEFGHKL:CGEDHFLK|CDEFGHJL:CGJDHFLE|CDEFGHJK:CGJDHFEK|CDEFGHIL:CGEDHFLI|CDEFGHIK:CGEDHFIK|CDEFGHIJ:CGJDHFEI|BFGHIJKL:HJBFIGLK|BEGHIJKL:EJIBHGLK|BEFHIJKL:EJBFIHLK|BEFGIJKL:EJBFIGLK|BEFGHJKL:EJBFHGLK|BEFGHIKL:EGBFIHLK|BEFGHIJL:EJBFHGLI|BEFGHIJK:EJBFHGIK|BDGHIJKL:HJBDIGLK|BDFHIJKL:HJBDIFLK|BDFGIJKL:IGBDJFLK|BDFGHJKL:HGBDJFLK|BDFGHIKL:HGBDIFLK|BDFGHIJL:HGBDJFLI|BDFGHIJK:HGBDJFIK|BDEHIJKL:EJBDIHLK|BDEGIJKL:EJBDIGLK|BDEGHJKL:EJBDHGLK|BDEGHIKL:EGBDIHLK|BDEGHIJL:EJBDHGLI|BDEGHIJK:EJBDHGIK|BDEFIJKL:EJBDIFLK|BDEFHJKL:EJBDHFLK|BDEFHIKL:EIBDHFLK|BDEFHIJL:EJBDHFLI|BDEFHIJK:EJBDHFIK|BDEFGJKL:EGBDJFLK|BDEFGIKL:EGBDIFLK|BDEFGIJL:EGBDJFLI|BDEFGIJK:EGBDJFIK|BDEFGHKL:EGBDHFLK|BDEFGHJL:HGBDJFLE|BDEFGHJK:HGBDJFEK|BDEFGHIL:EGBDHFLI|BDEFGHIK:EGBDHFIK|BDEFGHIJ:HGBDJFEI|BCGHIJKL:HJBCIGLK|BCFHIJKL:HJBCIFLK|BCFGIJKL:IGBCJFLK|BCFGHJKL:HGBCJFLK|BCFGHIKL:HGBCIFLK|BCFGHIJL:HGBCJFLI|BCFGHIJK:HGBCJFIK|BCEHIJKL:EJBCIHLK|BCEGIJKL:EJBCIGLK|BCEGHJKL:EJBCHGLK|BCEGHIKL:EGBCIHLK|BCEGHIJL:EJBCHGLI|BCEGHIJK:EJBCHGIK|BCEFIJKL:EJBCIFLK|BCEFHJKL:EJBCHFLK|BCEFHIKL:EIBCHFLK|BCEFHIJL:EJBCHFLI|BCEFHIJK:EJBCHFIK|BCEFGJKL:EGBCJFLK|BCEFGIKL:EGBCIFLK|BCEFGIJL:EGBCJFLI|BCEFGIJK:EGBCJFIK|BCEFGHKL:EGBCHFLK|BCEFGHJL:HGBCJFLE|BCEFGHJK:HGBCJFEK|BCEFGHIL:EGBCHFLI|BCEFGHIK:EGBCHFIK|BCEFGHIJ:HGBCJFEI|BCDHIJKL:HJBCIDLK|BCDGIJKL:IGBCJDLK|BCDGHJKL:HGBCJDLK|BCDGHIKL:HGBCIDLK|BCDGHIJL:HGBCJDLI|BCDGHIJK:HGBCJDIK|BCDFIJKL:CJBDIFLK|BCDFHJKL:CJBDHFLK|BCDFHIKL:CIBDHFLK|BCDFHIJL:CJBDHFLI|BCDFHIJK:CJBDHFIK|BCDFGJKL:CGBDJFLK|BCDFGIKL:CGBDIFLK|BCDFGIJL:CGBDJFLI|BCDFGIJK:CGBDJFIK|BCDFGHKL:CGBDHFLK|BCDFGHJL:CGBDHFLJ|BCDFGHJK:HGBCJFDK|BCDFGHIL:CGBDHFLI|BCDFGHIK:CGBDHFIK|BCDFGHIJ:HGBCJFDI|BCDEIJKL:EJBCIDLK|BCDEHJKL:EJBCHDLK|BCDEHIKL:EIBCHDLK|BCDEHIJL:EJBCHDLI|BCDEHIJK:EJBCHDIK|BCDEGJKL:EGBCJDLK|BCDEGIKL:EGBCIDLK|BCDEGIJL:EGBCJDLI|BCDEGIJK:EGBCJDIK|BCDEGHKL:EGBCHDLK|BCDEGHJL:HGBCJDLE|BCDEGHJK:HGBCJDEK|BCDEGHIL:EGBCHDLI|BCDEGHIK:EGBCHDIK|BCDEGHIJ:HGBCJDEI|BCDEFJKL:CJBDEFLK|BCDEFIKL:CEBDIFLK|BCDEFIJL:CJBDEFLI|BCDEFIJK:CJBDEFIK|BCDEFHKL:CEBDHFLK|BCDEFHJL:CJBDHFLE|BCDEFHJK:CJBDHFEK|BCDEFHIL:CEBDHFLI|BCDEFHIK:CEBDHFIK|BCDEFHIJ:CJBDHFEI|BCDEFGKL:CGBDEFLK|BCDEFGJL:CGBDJFLE|BCDEFGJK:CGBDJFEK|BCDEFGIL:CGBDEFLI|BCDEFGIK:CGBDEFIK|BCDEFGIJ:CGBDJFEI|BCDEFGHL:CGBDHFLE|BCDEFGHK:CGBDHFEK|BCDEFGHJ:HGBCJFDE|BCDEFGHI:CGBDHFEI|AFGHIJKL:HJIFAGLK|AEGHIJKL:EJIAHGLK|AEFHIJKL:EJIFAHLK|AEFGIJKL:EJIFAGLK|AEFGHJKL:EGJFAHLK|AEFGHIKL:EGIFAHLK|AEFGHIJL:EGJFAHLI|AEFGHIJK:EGJFAHIK|ADGHIJKL:HJIDAGLK|ADFHIJKL:HJIDAFLK|ADFGIJKL:IGJDAFLK|ADFGHJKL:HGJDAFLK|ADFGHIKL:HGIDAFLK|ADFGHIJL:HGJDAFLI|ADFGHIJK:HGJDAFIK|ADEHIJKL:EJIDAHLK|ADEGIJKL:EJIDAGLK|ADEGHJKL:EGJDAHLK|ADEGHIKL:EGIDAHLK|ADEGHIJL:EGJDAHLI|ADEGHIJK:EGJDAHIK|ADEFIJKL:EJIDAFLK|ADEFHJKL:HJEDAFLK|ADEFHIKL:HEIDAFLK|ADEFHIJL:HJEDAFLI|ADEFHIJK:HJEDAFIK|ADEFGJKL:EGJDAFLK|ADEFGIKL:EGIDAFLK|ADEFGIJL:EGJDAFLI|ADEFGIJK:EGJDAFIK|ADEFGHKL:HGEDAFLK|ADEFGHJL:HGJDAFLE|ADEFGHJK:HGJDAFEK|ADEFGHIL:HGEDAFLI|ADEFGHIK:HGEDAFIK|ADEFGHIJ:HGJDAFEI|ACGHIJKL:HJICAGLK|ACFHIJKL:HJICAFLK|ACFGIJKL:IGJCAFLK|ACFGHJKL:HGJCAFLK|ACFGHIKL:HGICAFLK|ACFGHIJL:HGJCAFLI|ACFGHIJK:HGJCAFIK|ACEHIJKL:EJICAHLK|ACEGIJKL:EJICAGLK|ACEGHJKL:EGJCAHLK|ACEGHIKL:EGICAHLK|ACEGHIJL:EGJCAHLI|ACEGHIJK:EGJCAHIK|ACEFIJKL:EJICAFLK|ACEFHJKL:HJECAFLK|ACEFHIKL:HEICAFLK|ACEFHIJL:HJECAFLI|ACEFHIJK:HJECAFIK|ACEFGJKL:EGJCAFLK|ACEFGIKL:EGICAFLK|ACEFGIJL:EGJCAFLI|ACEFGIJK:EGJCAFIK|ACEFGHKL:HGECAFLK|ACEFGHJL:HGJCAFLE|ACEFGHJK:HGJCAFEK|ACEFGHIL:HGECAFLI|ACEFGHIK:HGECAFIK|ACEFGHIJ:HGJCAFEI|ACDHIJKL:HJICADLK|ACDGIJKL:IGJCADLK|ACDGHJKL:HGJCADLK|ACDGHIKL:HGICADLK|ACDGHIJL:HGJCADLI|ACDGHIJK:HGJCADIK|ACDFIJKL:CJIDAFLK|ACDFHJKL:HJFCADLK|ACDFHIKL:HFICADLK|ACDFHIJL:HJFCADLI|ACDFHIJK:HJFCADIK|ACDFGJKL:CGJDAFLK|ACDFGIKL:CGIDAFLK|ACDFGIJL:CGJDAFLI|ACDFGIJK:CGJDAFIK|ACDFGHKL:HGFCADLK|ACDFGHJL:CGJDAFLH|ACDFGHJK:HGJCAFDK|ACDFGHIL:HGFCADLI|ACDFGHIK:HGFCADIK|ACDFGHIJ:HGJCAFDI|ACDEIJKL:EJICADLK|ACDEHJKL:HJECADLK|ACDEHIKL:HEICADLK|ACDEHIJL:HJECADLI|ACDEHIJK:HJECADIK|ACDEGJKL:EGJCADLK|ACDEGIKL:EGICADLK|ACDEGIJL:EGJCADLI|ACDEGIJK:EGJCADIK|ACDEGHKL:HGECADLK|ACDEGHJL:HGJCADLE|ACDEGHJK:HGJCADEK|ACDEGHIL:HGECADLI|ACDEGHIK:HGECADIK|ACDEGHIJ:HGJCADEI|ACDEFJKL:CJEDAFLK|ACDEFIKL:CEIDAFLK|ACDEFIJL:CJEDAFLI|ACDEFIJK:CJEDAFIK|ACDEFHKL:HEFCADLK|ACDEFHJL:HJFCADLE|ACDEFHJK:HJECAFDK|ACDEFHIL:HEFCADLI|ACDEFHIK:HEFCADIK|ACDEFHIJ:HJECAFDI|ACDEFGKL:CGEDAFLK|ACDEFGJL:CGJDAFLE|ACDEFGJK:CGJDAFEK|ACDEFGIL:CGEDAFLI|ACDEFGIK:CGEDAFIK|ACDEFGIJ:CGJDAFEI|ACDEFGHL:HGFCADLE|ACDEFGHK:HGECAFDK|ACDEFGHJ:HGJCAFDE|ACDEFGHI:HGECAFDI|ABGHIJKL:HJBAIGLK|ABFHIJKL:HJBAIFLK|ABFGIJKL:IJBFAGLK|ABFGHJKL:HJBFAGLK|ABFGHIKL:HGBAIFLK|ABFGHIJL:HJBFAGLI|ABFGHIJK:HJBFAGIK|ABEHIJKL:EJBAIHLK|ABEGIJKL:EJBAIGLK|ABEGHJKL:EJBAHGLK|ABEGHIKL:EGBAIHLK|ABEGHIJL:EJBAHGLI|ABEGHIJK:EJBAHGIK|ABEFIJKL:EJBAIFLK|ABEFHJKL:EJBFAHLK|ABEFHIKL:EIBFAHLK|ABEFHIJL:EJBFAHLI|ABEFHIJK:EJBFAHIK|ABEFGJKL:EJBFAGLK|ABEFGIKL:EGBAIFLK|ABEFGIJL:EJBFAGLI|ABEFGIJK:EJBFAGIK|ABEFGHKL:EGBFAHLK|ABEFGHJL:HJBFAGLE|ABEFGHJK:HJBFAGEK|ABEFGHIL:EGBFAHLI|ABEFGHIK:EGBFAHIK|ABEFGHIJ:HJBFAGEI|ABDHIJKL:IJBDAHLK|ABDGIJKL:IJBDAGLK|ABDGHJKL:HJBDAGLK|ABDGHIKL:IGBDAHLK|ABDGHIJL:HJBDAGLI|ABDGHIJK:HJBDAGIK|ABDFIJKL:IJBDAFLK|ABDFHJKL:HJBDAFLK|ABDFHIKL:HIBDAFLK|ABDFHIJL:HJBDAFLI|ABDFHIJK:HJBDAFIK|ABDFGJKL:FJBDAGLK|ABDFGIKL:IGBDAFLK|ABDFGIJL:FJBDAGLI|ABDFGIJK:FJBDAGIK|ABDFGHKL:HGBDAFLK|ABDFGHJL:HGBDAFLJ|ABDFGHJK:HGBDAFJK|ABDFGHIL:HGBDAFLI|ABDFGHIK:HGBDAFIK|ABDFGHIJ:HGBDAFIJ|ABDEIJKL:EJBAIDLK|ABDEHJKL:EJBDAHLK|ABDEHIKL:EIBDAHLK|ABDEHIJL:EJBDAHLI|ABDEHIJK:EJBDAHIK|ABDEGJKL:EJBDAGLK|ABDEGIKL:EGBAIDLK|ABDEGIJL:EJBDAGLI|ABDEGIJK:EJBDAGIK|ABDEGHKL:EGBDAHLK|ABDEGHJL:HJBDAGLE|ABDEGHJK:HJBDAGEK|ABDEGHIL:EGBDAHLI|ABDEGHIK:EGBDAHIK|ABDEGHIJ:HJBDAGEI|ABDEFJKL:EJBDAFLK|ABDEFIKL:EIBDAFLK|ABDEFIJL:EJBDAFLI|ABDEFIJK:EJBDAFIK|ABDEFHKL:HEBDAFLK|ABDEFHJL:HJBDAFLE|ABDEFHJK:HJBDAFEK|ABDEFHIL:HEBDAFLI|ABDEFHIK:HEBDAFIK|ABDEFHIJ:HJBDAFEI|ABDEFGKL:EGBDAFLK|ABDEFGJL:EGBDAFLJ|ABDEFGJK:EGBDAFJK|ABDEFGIL:EGBDAFLI|ABDEFGIK:EGBDAFIK|ABDEFGIJ:EGBDAFIJ|ABDEFGHL:HGBDAFLE|ABDEFGHK:HGBDAFEK|ABDEFGHJ:HGBDAFEJ|ABDEFGHI:HGBDAFEI|ABCHIJKL:IJBCAHLK|ABCGIJKL:IJBCAGLK|ABCGHJKL:HJBCAGLK|ABCGHIKL:IGBCAHLK|ABCGHIJL:HJBCAGLI|ABCGHIJK:HJBCAGIK|ABCFIJKL:IJBCAFLK|ABCFHJKL:HJBCAFLK|ABCFHIKL:HIBCAFLK|ABCFHIJL:HJBCAFLI|ABCFHIJK:HJBCAFIK|ABCFGJKL:CJBFAGLK|ABCFGIKL:IGBCAFLK|ABCFGIJL:CJBFAGLI|ABCFGIJK:CJBFAGIK|ABCFGHKL:HGBCAFLK|ABCFGHJL:HGBCAFLJ|ABCFGHJK:HGBCAFJK|ABCFGHIL:HGBCAFLI|ABCFGHIK:HGBCAFIK|ABCFGHIJ:HGBCAFIJ|ABCEIJKL:EJBAICLK|ABCEHJKL:EJBCAHLK|ABCEHIKL:EIBCAHLK|ABCEHIJL:EJBCAHLI|ABCEHIJK:EJBCAHIK|ABCEGJKL:EJBCAGLK|ABCEGIKL:EGBAICLK|ABCEGIJL:EJBCAGLI|ABCEGIJK:EJBCAGIK|ABCEGHKL:EGBCAHLK|ABCEGHJL:HJBCAGLE|ABCEGHJK:HJBCAGEK|ABCEGHIL:EGBCAHLI|ABCEGHIK:EGBCAHIK|ABCEGHIJ:HJBCAGEI|ABCEFJKL:EJBCAFLK|ABCEFIKL:EIBCAFLK|ABCEFIJL:EJBCAFLI|ABCEFIJK:EJBCAFIK|ABCEFHKL:HEBCAFLK|ABCEFHJL:HJBCAFLE|ABCEFHJK:HJBCAFEK|ABCEFHIL:HEBCAFLI|ABCEFHIK:HEBCAFIK|ABCEFHIJ:HJBCAFEI|ABCEFGKL:EGBCAFLK|ABCEFGJL:EGBCAFLJ|ABCEFGJK:EGBCAFJK|ABCEFGIL:EGBCAFLI|ABCEFGIK:EGBCAFIK|ABCEFGIJ:EGBCAFIJ|ABCEFGHL:HGBCAFLE|ABCEFGHK:HGBCAFEK|ABCEFGHJ:HGBCAFEJ|ABCEFGHI:HGBCAFEI|ABCDIJKL:IJBCADLK|ABCDHJKL:HJBCADLK|ABCDHIKL:HIBCADLK|ABCDHIJL:HJBCADLI|ABCDHIJK:HJBCADIK|ABCDGJKL:CJBDAGLK|ABCDGIKL:IGBCADLK|ABCDGIJL:CJBDAGLI|ABCDGIJK:CJBDAGIK|ABCDGHKL:HGBCADLK|ABCDGHJL:HGBCADLJ|ABCDGHJK:HGBCADJK|ABCDGHIL:HGBCADLI|ABCDGHIK:HGBCADIK|ABCDGHIJ:HGBCADIJ|ABCDFJKL:CJBDAFLK|ABCDFIKL:CIBDAFLK|ABCDFIJL:CJBDAFLI|ABCDFIJK:CJBDAFIK|ABCDFHKL:HFBCADLK|ABCDFHJL:CJBDAFLH|ABCDFHJK:HJBCAFDK|ABCDFHIL:HFBCADLI|ABCDFHIK:HFBCADIK|ABCDFHIJ:HJBCAFDI|ABCDFGKL:CGBDAFLK|ABCDFGJL:CGBDAFLJ|ABCDFGJK:CGBDAFJK|ABCDFGIL:CGBDAFLI|ABCDFGIK:CGBDAFIK|ABCDFGIJ:CGBDAFIJ|ABCDFGHL:CGBDAFLH|ABCDFGHK:HGBCAFDK|ABCDFGHJ:HGBCAFDJ|ABCDFGHI:HGBCAFDI|ABCDEJKL:EJBCADLK|ABCDEIKL:EIBCADLK|ABCDEIJL:EJBCADLI|ABCDEIJK:EJBCADIK|ABCDEHKL:HEBCADLK|ABCDEHJL:HJBCADLE|ABCDEHJK:HJBCADEK|ABCDEHIL:HEBCADLI|ABCDEHIK:HEBCADIK|ABCDEHIJ:HJBCADEI|ABCDEGKL:EGBCADLK|ABCDEGJL:EGBCADLJ|ABCDEGJK:EGBCADJK|ABCDEGIL:EGBCADLI|ABCDEGIK:EGBCADIK|ABCDEGIJ:EGBCADIJ|ABCDEGHL:HGBCADLE|ABCDEGHK:HGBCADEK|ABCDEGHJ:HGBCADEJ|ABCDEGHI:HGBCADEI|ABCDEFKL:CEBDAFLK|ABCDEFJL:CJBDAFLE|ABCDEFJK:CJBDAFEK|ABCDEFIL:CEBDAFLI|ABCDEFIK:CEBDAFIK|ABCDEFIJ:CJBDAFEI|ABCDEFHL:HFBCADLE|ABCDEFHK:HEBCAFDK|ABCDEFHJ:HJBCAFDE|ABCDEFHI:HEBCAFDI|ABCDEFGL:CGBDAFLE|ABCDEFGK:CGBDAFEK|ABCDEFGJ:CGBDAFEJ|ABCDEFGI:CGBDAFEI|ABCDEFGH:HGBCAFDE";
const THIRD_PLACE_SLOTS: ThirdPlaceSlot[] = ["1A", "1B", "1D", "1E", "1G", "1I", "1K", "1L"];
const THIRD_PLACE_ASSIGNMENTS: Record<string, Record<ThirdPlaceSlot, string>> = Object.fromEntries(
  THIRD_PLACE_ASSIGNMENT_DATA.split("|").map(row => {
    const [key, values] = row.split(":");
    const assignment = Object.fromEntries(THIRD_PLACE_SLOTS.map((slot, i) => [slot, values[i] || ""])) as Record<ThirdPlaceSlot, string>;
    return [key, assignment];
  })
);

const STORAGE_KEY = "wc2026-bracket-v3";

/* ── helpers ────────────────────────────────────────────────────── */

function emptyGroupPredictions(groups: Record<string, string[]>): GroupPredictions {
  const preds: GroupPredictions = {};
  for (const g of Object.keys(groups)) {
    preds[g] = { first: "", second: "", third: "" };
  }
  return preds;
}

function emptyKnockout(): KnockoutPicks {
  return {
    r32: Array(16).fill(null),
    r16: Array(8).fill(null),
    qf: Array(4).fill(null),
    sf: Array(2).fill(null),
    champion: null,
  };
}

interface SavedState {
  groupPreds: GroupPredictions;
  thirdPlaceAdvancing: string[];
  knockout: KnockoutPicks;
  step: number;
}

function loadState(groups: Record<string, string[]>): SavedState {
  if (typeof window === "undefined") return { groupPreds: emptyGroupPredictions(groups), thirdPlaceAdvancing: [], knockout: emptyKnockout(), step: 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { groupPreds: emptyGroupPredictions(groups), thirdPlaceAdvancing: [], knockout: emptyKnockout(), step: 0 };
}

function saveState(state: SavedState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

/* Resolve a seed like "1A" or "2C" to the actual team name from group predictions */
function resolveSeed(seed: string, groupPreds: GroupPredictions): string {
  if (seed.length < 2) return "";
  const pos = seed[0]; /* "1", "2", or "3" */
  const grp = seed.slice(1);
  const pred = groupPreds[grp];
  if (!pred) return "";
  if (pos === "1") return pred.first;
  if (pos === "2") return pred.second;
  if (pos === "3") return pred.third;
  return "";
}

function getThirdPlaceGroups(groupPreds: GroupPredictions, advancing: string[], groupLetters: string[]): string {
  return groupLetters
    .filter(g => {
      const third = groupPreds[g]?.third;
      return third && advancing.includes(third);
    })
    .join("");
}

function getThirdPlaceAssignments(groupPreds: GroupPredictions, advancing: string[], groupLetters: string[]) {
  return THIRD_PLACE_ASSIGNMENTS[getThirdPlaceGroups(groupPreds, advancing, groupLetters)] || null;
}

function seedLabel(seed: Seed, assignments: Record<ThirdPlaceSlot, string> | null): string {
  if (!seed.startsWith("3@")) return seed;
  const slot = seed.slice(2) as ThirdPlaceSlot;
  const group = assignments?.[slot];
  return group ? `3${group}` : "3rd";
}

function resolveBracketSeed(
  seed: Seed,
  groupPreds: GroupPredictions,
  assignments: Record<ThirdPlaceSlot, string> | null,
): string {
  if (!seed.startsWith("3@")) return resolveSeed(seed, groupPreds);
  const slot = seed.slice(2) as ThirdPlaceSlot;
  const group = assignments?.[slot];
  return group ? resolveSeed(`3${group}`, groupPreds) : "";
}

/* Get the two teams in an R32 matchup */
function getR32Teams(
  matchIdx: number,
  groupPreds: GroupPredictions,
  assignments: Record<ThirdPlaceSlot, string> | null,
): [string, string] {
  const match = R32_MATCHES[matchIdx];
  return [
    resolveBracketSeed(match.seeds[0], groupPreds, assignments),
    resolveBracketSeed(match.seeds[1], groupPreds, assignments),
  ];
}

function qfIndexForR16(r16Idx: number): number {
  return QF_SOURCE_PAIRS.findIndex(pair => pair[0] === r16Idx || pair[1] === r16Idx);
}

/* ── component ─────────────────────────────────────────────────── */

export default function BracketBuilder({ flags, groups, gcolor }: BracketBuilderProps) {
  const [state, setState] = useState<SavedState>(() => loadState(groups));
  const { groupPreds, thirdPlaceAdvancing, knockout, step } = state;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => { saveState(state); }, [state]);

  const fl = (t: string) => flags[t] || "⚽";
  const groupLetters = Object.keys(groups).sort();

  /* How many groups are fully predicted */
  const groupsDone = groupLetters.filter(g => groupPreds[g]?.first && groupPreds[g]?.second && groupPreds[g]?.third).length;
  const allGroupsDone = groupsDone === groupLetters.length;

  /* All 3rd-place teams */
  const allThirds = groupLetters.map(g => groupPreds[g]?.third).filter(Boolean);
  const thirdsDone = thirdPlaceAdvancing.length === 8;

  /* Progress */
  const knockoutDone = knockout.r32.filter(Boolean).length + knockout.r16.filter(Boolean).length +
    knockout.qf.filter(Boolean).length + knockout.sf.filter(Boolean).length + (knockout.champion ? 1 : 0);
  const totalKnockout = 16 + 8 + 4 + 2 + 1;

  /* ── Step 0: Group predictions ─────────────────────────────── */

  function setGroupPos(grp: string, pos: "first" | "second" | "third", team: string) {
    setState(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as SavedState;
      const pred = next.groupPreds[grp];
      /* Clear the team from any other position in this group */
      if (pred.first === team) pred.first = "";
      if (pred.second === team) pred.second = "";
      if (pred.third === team) pred.third = "";
      pred[pos] = team;
      /* Clear downstream knockout picks when group predictions change */
      next.knockout = emptyKnockout();
      next.thirdPlaceAdvancing = [];
      return next;
    });
  }

  function toggleThirdAdvancing(team: string) {
    setState(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as SavedState;
      const idx = next.thirdPlaceAdvancing.indexOf(team);
      if (idx >= 0) {
        next.thirdPlaceAdvancing.splice(idx, 1);
      } else if (next.thirdPlaceAdvancing.length < 8) {
        next.thirdPlaceAdvancing.push(team);
      }
      next.knockout = emptyKnockout();
      return next;
    });
  }

  function setKnockoutWinner(round: keyof KnockoutPicks, idx: number, team: string) {
    setState(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as SavedState;
      if (round === "champion") {
        next.knockout.champion = team;
      } else {
        (next.knockout[round] as (string | null)[])[idx] = team;
        /* Clear downstream when upstream changes */
        if (round === "r32") {
          const r16Idx = Math.floor(idx / 2);
          const qfIdx = qfIndexForR16(r16Idx);
          next.knockout.r16[r16Idx] = null;
          if (qfIdx >= 0) {
            next.knockout.qf[qfIdx] = null;
            next.knockout.sf[Math.floor(qfIdx / 2)] = null;
          }
          next.knockout.champion = null;
        } else if (round === "r16") {
          const qfIdx = qfIndexForR16(idx);
          if (qfIdx >= 0) {
            next.knockout.qf[qfIdx] = null;
            next.knockout.sf[Math.floor(qfIdx / 2)] = null;
          }
          next.knockout.champion = null;
        } else if (round === "qf") {
          next.knockout.sf[Math.floor(idx / 2)] = null;
          next.knockout.champion = null;
        } else if (round === "sf") {
          next.knockout.champion = null;
        }
      }
      return next;
    });
  }

  function goStep(s: number) {
    setState(prev => ({ ...prev, step: s }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearAll() {
    const fresh = { groupPreds: emptyGroupPredictions(groups), thirdPlaceAdvancing: [], knockout: emptyKnockout(), step: 0 };
    setState(fresh);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  /* ── Image generation ──────────────────────────────────────── */

  async function generateCarousel() {
    setGenerating(true);
    await new Promise(r => setTimeout(r, 50));

    const W = 1080, H = 1350;
    const canvas = canvasRef.current;
    if (!canvas) { setGenerating(false); return; }
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const assignments = getThirdPlaceAssignments(groupPreds, thirdPlaceAdvancing, groupLetters);

    const drawBg = (title: string, kicker: string, slide: number) => {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#07130d");
      grad.addColorStop(0.55, "#101820");
      grad.addColorStop(1, "#111111");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 54) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 54) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.textAlign = "left";
      ctx.fillStyle = "#d6b55d";
      ctx.font = "700 24px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(kicker.toUpperCase(), 64, 72);
      ctx.fillStyle = "#ffffff";
      ctx.font = "800 54px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(title, 64, 132);
      ctx.textAlign = "right";
      ctx.font = "700 20px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText(`${slide}/6`, W - 64, 72);
      ctx.textAlign = "left";
    };

    const drawFooter = () => {
      ctx.textAlign = "center";
      ctx.font = "600 18px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.38)";
      ctx.fillText("wc2026-xi-gray.vercel.app", W / 2, H - 42);
      ctx.textAlign = "left";
    };

    const truncate = (text: string, maxWidth: number) => {
      if (ctx.measureText(text).width <= maxWidth) return text;
      let out = text;
      while (out.length > 1 && ctx.measureText(out + "…").width > maxWidth) out = out.slice(0, -1);
      return out + "…";
    };

    const teamText = (team: string | null | undefined) => team ? `${fl(team)} ${team}` : "—";

    const drawPill = (x: number, y: number, w: number, h: number, text: string, active = false) => {
      ctx.fillStyle = active ? "rgba(214,181,93,0.2)" : "rgba(255,255,255,0.07)";
      ctx.strokeStyle = active ? "rgba(214,181,93,0.55)" : "rgba(255,255,255,0.11)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "700 25px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(truncate(text, w - 34), x + 17, y + h / 2 + 9);
    };

    const drawGroupCard = (g: string, x: number, y: number, w: number, h: number) => {
      const pred = groupPreds[g];
      ctx.fillStyle = "rgba(255,255,255,0.055)";
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = gcolor[g] || "#d6b55d";
      ctx.font = "800 26px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(`Group ${g}`, x + 22, y + 40);
      const rows = [["1", pred?.first], ["2", pred?.second], ["3", pred?.third]];
      rows.forEach(([pos, team], i) => {
        const yy = y + 78 + i * 54;
        ctx.fillStyle = pos === "1" ? "#d6b55d" : pos === "2" ? "rgba(255,255,255,0.68)" : "rgba(255,255,255,0.45)";
        ctx.font = "800 22px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillText(pos, x + 22, yy);
        ctx.fillStyle = "#fff";
        ctx.font = "700 24px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillText(truncate(teamText(team), w - 75), x + 58, yy);
      });
    };

    const drawGroups = (range: string[], slide: number) => {
      drawBg(slide === 2 ? "Groups A–F" : "Groups G–L", "My World Cup 2026", slide);
      const cardW = 456, cardH = 230;
      range.forEach((g, i) => drawGroupCard(g, 64 + (i % 2) * 496, 190 + Math.floor(i / 2) * 282, cardW, cardH));
      drawFooter();
    };

    const drawThirds = () => {
      drawBg("Best Thirds", "Round of 32 qualifiers", 4);
      ctx.fillStyle = "rgba(255,255,255,0.62)";
      ctx.font = "600 24px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("Eight third-place teams advance. FIFA's Annex C table assigns", 64, 185);
      ctx.fillText("them into the bracket slots below.", 64, 217);
      const selected = groupLetters.filter(g => thirdPlaceAdvancing.includes(groupPreds[g]?.third));
      selected.forEach((g, i) => {
        const team = groupPreds[g]?.third;
        drawPill(64 + (i % 2) * 496, 260 + Math.floor(i / 2) * 86, 456, 62, `3${g}  ${teamText(team)}`, true);
      });
      ctx.fillStyle = "#d6b55d";
      ctx.font = "800 30px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("Third-place slots", 64, 690);
      THIRD_PLACE_SLOTS.forEach((slot, i) => {
        const group = assignments?.[slot];
        const team = group ? groupPreds[group]?.third : "";
        drawPill(64 + (i % 2) * 496, 730 + Math.floor(i / 2) * 86, 456, 62, `${slot} vs 3${group || "?"}  ${teamText(team)}`);
      });
      drawFooter();
    };

    const drawMatch = (x: number, y: number, w: number, label: string, teamA: string, teamB: string, winner: string | null) => {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 112, 14);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.font = "800 17px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(label, x + 16, y + 26);
      ctx.font = "700 22px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = winner === teamA ? "#d6b55d" : "#fff";
      ctx.fillText(truncate(teamText(teamA), w - 32), x + 16, y + 61);
      ctx.fillStyle = winner === teamB ? "#d6b55d" : "#fff";
      ctx.fillText(truncate(teamText(teamB), w - 32), x + 16, y + 94);
    };

    const drawR32 = () => {
      drawBg("Round of 32", "Official bracket path", 5);
      R32_MATCHES.forEach((match, i) => {
        const [teamA, teamB] = getR32Teams(i, groupPreds, assignments);
        const seeds = match.seeds.map(seed => seedLabel(seed, assignments)).join(" vs ");
        drawMatch(52 + (i % 2) * 500, 178 + Math.floor(i / 2) * 132, 476, `M${match.no} · ${seeds}`, teamA, teamB, knockout.r32[i]);
      });
      drawFooter();
    };

    const drawFinalPath = () => {
      drawBg("Final Path", "Round of 16 to champion", 6);
      const drawSection = (
        title: string,
        nums: number[],
        picks: (string | null)[],
        sources: (string | null)[],
        top: number,
        pairs?: readonly (readonly [number, number])[],
      ) => {
        ctx.fillStyle = "#d6b55d";
        ctx.font = "800 28px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillText(title, 64, top - 22);
        nums.forEach((no, i) => {
          const [aIdx, bIdx] = pairs?.[i] || [i * 2, i * 2 + 1];
          const teamA = sources[aIdx] || "";
          const teamB = sources[bIdx] || "";
          drawMatch(64 + (i % 2) * 496, top + Math.floor(i / 2) * 124, 456, `M${no}`, teamA, teamB, picks[i]);
        });
      };
      drawSection("Round of 16", R16_MATCH_NUMBERS, knockout.r16, knockout.r32, 178);
      drawSection("Quarter-finals", QF_MATCH_NUMBERS, knockout.qf, knockout.r16, 728, QF_SOURCE_PAIRS);
      drawSection("Semi-finals", SF_MATCH_NUMBERS, knockout.sf, knockout.qf, 992, SF_SOURCE_PAIRS);
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(214,181,93,0.16)";
      ctx.strokeStyle = "rgba(214,181,93,0.55)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(250, 1162, 580, 108, 22);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#d6b55d";
      ctx.font = "800 24px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("PREDICTED CHAMPION", W / 2, 1206);
      ctx.fillStyle = "#fff";
      ctx.font = "900 34px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(teamText(knockout.champion), W / 2, 1248);
      ctx.textAlign = "left";
      drawFooter();
    };

    const slides = [
      () => {
        drawBg("My Bracket", "World Cup 2026", 1);
        ctx.textAlign = "center";
        ctx.fillStyle = "#fff";
        ctx.font = "900 78px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillText(teamText(knockout.champion || ""), W / 2, 430);
        ctx.fillStyle = "#d6b55d";
        ctx.font = "800 30px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillText("Predicted Champion", W / 2, 480);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = "700 30px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillText("12 groups · 8 best thirds · 32-team knockout", W / 2, 610);
        ctx.fillStyle = "rgba(255,255,255,0.42)";
        ctx.font = "600 24px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillText("Swipe for groups, third-place slots, and the full bracket path", W / 2, 656);
        ctx.textAlign = "left";
        drawFooter();
      },
      () => drawGroups(groupLetters.slice(0, 6), 2),
      () => drawGroups(groupLetters.slice(6), 3),
      drawThirds,
      drawR32,
      drawFinalPath,
    ];

    for (let i = 0; i < slides.length; i++) {
      slides[i]();
      await new Promise<void>(resolve => {
        canvas.toBlob(blob => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `wc2026-bracket-carousel-${String(i + 1).padStart(2, "0")}.png`;
            a.click();
            URL.revokeObjectURL(url);
          }
          resolve();
        }, "image/png");
      });
      await new Promise(r => setTimeout(r, 140));
    }
    setGenerating(false);
  }

  /* ── Render ────────────────────────────────────────────────── */

  return (
    <div className="bracket-builder">
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <div className="bb-header">
        <h2 className="bb-title">My Bracket</h2>
        <p className="bb-sub">Predict your groups, then pick knockout winners. Save and share on Instagram.</p>

        {/* Step tabs */}
        <div className="bb-steps">
          <button className={`bb-step${step === 0 ? " bb-step--active" : ""}`} onClick={() => goStep(0)}>
            <span className="bb-step__num">1</span>
            <span>Groups{allGroupsDone ? " ✓" : ` (${groupsDone}/12)`}</span>
          </button>
          {allGroupsDone && (
            <button className={`bb-step${step === 1 ? " bb-step--active" : ""}`} onClick={() => goStep(1)}>
              <span className="bb-step__num">2</span>
              <span>Best 3rds{thirdsDone ? " ✓" : ` (${thirdPlaceAdvancing.length}/8)`}</span>
            </button>
          )}
          {allGroupsDone && thirdsDone && (
            <button className={`bb-step${step === 2 ? " bb-step--active" : ""}`} onClick={() => goStep(2)}>
              <span className="bb-step__num">3</span>
              <span>Knockout{knockout.champion ? " ✓" : ` (${knockoutDone}/${totalKnockout})`}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Step 0: Group Predictions ── */}
      {step === 0 && (
        <div className="bb-groups">
          <p className="bb-groups__hint">For each group, tap a team to set their predicted finish (1st, 2nd, 3rd). The 4th-place team is eliminated.</p>
          {groupLetters.map(g => {
            const pred = groupPreds[g] || { first: "", second: "", third: "" };
            const teamsList = groups[g];
            const placed = [pred.first, pred.second, pred.third].filter(Boolean);
            const unplaced = teamsList.filter(t => !placed.includes(t));

            return (
              <div key={g} id={`bb-group-${g}`} className={`bb-group${!pred.first || !pred.second || !pred.third ? " bb-group--incomplete" : ""}`} style={{ borderLeftColor: gcolor[g] || "var(--line)" }}>
                <div className="bb-group__hd" style={{ color: gcolor[g] }}>Group {g}</div>

                {/* Position slots */}
                <div className="bb-group__slots">
                  {(["first", "second", "third"] as const).map((pos, pi) => {
                    const team = pred[pos];
                    const posLabel = pi === 0 ? "1st" : pi === 1 ? "2nd" : "3rd";
                    const posClass = pi === 0 ? "bb-pos--first" : pi === 1 ? "bb-pos--second" : "bb-pos--third";
                    return (
                      <div key={pos} className={`bb-pos ${posClass}`}>
                        <span className="bb-pos__label">{posLabel}</span>
                        {team ? (
                          <button
                            className="bb-pos__team bb-pos__team--filled"
                            onClick={() => setGroupPos(g, pos, "")}
                            title="Click to remove"
                          >
                            {fl(team)} {team} <span className="bb-pos__x">✕</span>
                          </button>
                        ) : (
                          <span className="bb-pos__team bb-pos__team--empty">Pick {posLabel}</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Available teams to place */}
                {unplaced.length > 0 && (
                  <div className="bb-group__avail">
                    {unplaced.map(t => (
                      <button
                        key={t}
                        className="bb-team-pill"
                        onClick={() => {
                          /* Auto-place into first empty position */
                          if (!pred.first) setGroupPos(g, "first", t);
                          else if (!pred.second) setGroupPos(g, "second", t);
                          else if (!pred.third) setGroupPos(g, "third", t);
                        }}
                      >
                        {fl(t)} {t}
                      </button>
                    ))}
                  </div>
                )}

                {/* Group complete indicator */}
                {placed.length === 3 && (
                  <div className="bb-group__elim">
                    <span className="bb-group__elim-label">Eliminated:</span>
                    <span className="bb-group__elim-team">{fl(unplaced[0])} {unplaced[0]}</span>
                  </div>
                )}
              </div>
            );
          })}

          {allGroupsDone && (
            <button className="bb-next-btn" onClick={() => goStep(1)}>
              Continue to Best 3rd-Place Teams →
            </button>
          )}
        </div>
      )}

      {/* ── Step 1: Pick 8 best 3rd-place teams ── */}
      {step === 1 && allGroupsDone && (
        <div className="bb-thirds">
          <p className="bb-thirds__hint">8 of 12 third-place teams advance to the Round of 32. Pick which 8 go through.</p>
          <div className="bb-thirds__count">{thirdPlaceAdvancing.length}/8 selected</div>
          <div className="bb-thirds__grid">
            {allThirds.map(t => {
              const isSelected = thirdPlaceAdvancing.includes(t);
              const grp = groupLetters.find(g => groupPreds[g]?.third === t) || "";
              return (
                <button
                  key={t}
                  className={`bb-third-pill${isSelected ? " bb-third-pill--on" : ""}`}
                  onClick={() => toggleThirdAdvancing(t)}
                  disabled={!isSelected && thirdPlaceAdvancing.length >= 8}
                >
                  <span className="bb-third-pill__grp">3rd {grp}</span>
                  <span>{fl(t)} {t}</span>
                  {isSelected && <span className="bb-third-pill__check">✓</span>}
                </button>
              );
            })}
          </div>

          <div className="bb-step-nav">
            <button className="bb-back-btn" onClick={() => goStep(0)}>← Back to Groups</button>
            {thirdsDone && (
              <button className="bb-next-btn" onClick={() => goStep(2)}>Continue to Knockout →</button>
            )}
          </div>
        </div>
      )}

      {/* ── Step 2: Knockout picks ── */}
      {step === 2 && allGroupsDone && thirdsDone && (
        <div className="bb-knockout">
          {/* R32 */}
          <div className="bb-round">
            <div className="bb-round__hd">Round of 32 <span className="bb-round__count">{knockout.r32.filter(Boolean).length}/16</span></div>
            <div className="bb-matches">
              {R32_MATCHES.map((match, i) => {
                const assignments = getThirdPlaceAssignments(groupPreds, thirdPlaceAdvancing, groupLetters);
                const [teamA, teamB] = getR32Teams(i, groupPreds, assignments);
                const winner = knockout.r32[i];
                if (!teamA || !teamB) return null;
                return (
                  <div key={i} className="bb-match">
                    <div className="bb-match__label">Match {match.no} · {match.seeds.map(seed => seedLabel(seed, assignments)).join(" vs ")}</div>
                    <div className="bb-match__pick">
                      <button
                        className={`bb-pick-btn${winner === teamA ? " bb-pick-btn--active" : ""}`}
                        onClick={() => setKnockoutWinner("r32", i, teamA)}
                      >{fl(teamA)} {teamA}</button>
                      <span className="bb-match__vs">vs</span>
                      <button
                        className={`bb-pick-btn${winner === teamB ? " bb-pick-btn--active" : ""}`}
                        onClick={() => setKnockoutWinner("r32", i, teamB)}
                      >{fl(teamB)} {teamB}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* R16 */}
          {knockout.r32.filter(Boolean).length === 16 && (
            <div className="bb-round">
              <div className="bb-round__hd">Round of 16 <span className="bb-round__count">{knockout.r16.filter(Boolean).length}/8</span></div>
              <div className="bb-matches">
                {Array.from({ length: 8 }, (_, i) => {
                  const teamA = knockout.r32[i * 2];
                  const teamB = knockout.r32[i * 2 + 1];
                  if (!teamA || !teamB) return null;
                  const winner = knockout.r16[i];
                  return (
                    <div key={i} className="bb-match">
                      <div className="bb-match__label">Match {R16_MATCH_NUMBERS[i]}</div>
                      <div className="bb-match__pick">
                        <button
                          className={`bb-pick-btn${winner === teamA ? " bb-pick-btn--active" : ""}`}
                          onClick={() => setKnockoutWinner("r16", i, teamA)}
                        >{fl(teamA)} {teamA}</button>
                        <span className="bb-match__vs">vs</span>
                        <button
                          className={`bb-pick-btn${winner === teamB ? " bb-pick-btn--active" : ""}`}
                          onClick={() => setKnockoutWinner("r16", i, teamB)}
                        >{fl(teamB)} {teamB}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* QF */}
          {knockout.r16.filter(Boolean).length === 8 && (
            <div className="bb-round">
              <div className="bb-round__hd">Quarter-finals <span className="bb-round__count">{knockout.qf.filter(Boolean).length}/4</span></div>
              <div className="bb-matches">
                {Array.from({ length: 4 }, (_, i) => {
                  const [aIdx, bIdx] = QF_SOURCE_PAIRS[i];
                  const teamA = knockout.r16[aIdx];
                  const teamB = knockout.r16[bIdx];
                  if (!teamA || !teamB) return null;
                  const winner = knockout.qf[i];
                  return (
                    <div key={i} className="bb-match">
                      <div className="bb-match__label">Match {QF_MATCH_NUMBERS[i]}</div>
                      <div className="bb-match__pick">
                        <button
                          className={`bb-pick-btn${winner === teamA ? " bb-pick-btn--active" : ""}`}
                          onClick={() => setKnockoutWinner("qf", i, teamA)}
                        >{fl(teamA)} {teamA}</button>
                        <span className="bb-match__vs">vs</span>
                        <button
                          className={`bb-pick-btn${winner === teamB ? " bb-pick-btn--active" : ""}`}
                          onClick={() => setKnockoutWinner("qf", i, teamB)}
                        >{fl(teamB)} {teamB}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SF */}
          {knockout.qf.filter(Boolean).length === 4 && (
            <div className="bb-round">
              <div className="bb-round__hd">Semi-finals <span className="bb-round__count">{knockout.sf.filter(Boolean).length}/2</span></div>
              <div className="bb-matches">
                {Array.from({ length: 2 }, (_, i) => {
                  const teamA = knockout.qf[i * 2];
                  const teamB = knockout.qf[i * 2 + 1];
                  if (!teamA || !teamB) return null;
                  const winner = knockout.sf[i];
                  return (
                    <div key={i} className="bb-match">
                      <div className="bb-match__label">Match {SF_MATCH_NUMBERS[i]}</div>
                      <div className="bb-match__pick">
                        <button
                          className={`bb-pick-btn${winner === teamA ? " bb-pick-btn--active" : ""}`}
                          onClick={() => setKnockoutWinner("sf", i, teamA)}
                        >{fl(teamA)} {teamA}</button>
                        <span className="bb-match__vs">vs</span>
                        <button
                          className={`bb-pick-btn${winner === teamB ? " bb-pick-btn--active" : ""}`}
                          onClick={() => setKnockoutWinner("sf", i, teamB)}
                        >{fl(teamB)} {teamB}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Final */}
          {knockout.sf[0] && knockout.sf[1] && (
            <div className="bb-round bb-round--final">
              <div className="bb-round__hd">🏆 Final</div>
              <div className="bb-final">
                <button
                  className={`bb-final-btn${knockout.champion === knockout.sf[0] ? " bb-final-btn--active" : ""}`}
                  onClick={() => setKnockoutWinner("champion", 0, knockout.sf[0]!)}
                >
                  <span className="bb-final-flag">{fl(knockout.sf[0])}</span>
                  <span className="bb-final-name">{knockout.sf[0]}</span>
                </button>
                <span className="bb-final-vs">vs</span>
                <button
                  className={`bb-final-btn${knockout.champion === knockout.sf[1] ? " bb-final-btn--active" : ""}`}
                  onClick={() => setKnockoutWinner("champion", 0, knockout.sf[1]!)}
                >
                  <span className="bb-final-flag">{fl(knockout.sf[1])}</span>
                  <span className="bb-final-name">{knockout.sf[1]}</span>
                </button>
              </div>
              {knockout.champion && (
                <div className="bb-champion">
                  <div className="bb-champion__crown">👑</div>
                  <div className="bb-champion__flag">{fl(knockout.champion)}</div>
                  <div className="bb-champion__name">{knockout.champion}</div>
                  <div className="bb-champion__label">YOUR PREDICTED CHAMPION</div>
                </div>
              )}
            </div>
          )}

          <button className="bb-back-btn" onClick={() => goStep(1)}>← Back to 3rd Place</button>
        </div>
      )}

      {/* Actions */}
      <div className="bb-actions">
        <button
          className="bb-share-btn"
          onClick={() => {
            if (!allGroupsDone) {
              const missing = groupLetters.find(g => !groupPreds[g]?.first || !groupPreds[g]?.second || !groupPreds[g]?.third);
              if (missing) {
                goStep(0);
                setTimeout(() => {
                  const el = document.getElementById(`bb-group-${missing}`);
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "center" });
                    el.classList.add("bb-group--flash");
                    setTimeout(() => el.classList.remove("bb-group--flash"), 2000);
                  }
                }, 100);
              }
              return;
            }
            if (!thirdsDone) {
              goStep(1);
              return;
            }
            generateCarousel();
          }}
          disabled={generating}
        >
          {generating ? "Generating..." : !allGroupsDone ? `⚠ Complete All Groups (${groupsDone}/12)` : !thirdsDone ? `⚠ Pick Best 3rds (${thirdPlaceAdvancing.length}/8)` : "📸 Save IG Carousel"}
        </button>
        <button className="bb-clear-btn" onClick={clearAll}>Clear All</button>
      </div>
      <p className="bb-share-hint">{!allGroupsDone ? "Finish predicting all 12 groups to unlock saving" : !thirdsDone ? "Pick the 8 best third-place teams to unlock the bracket carousel" : "Downloads six 1080×1350 PNG slides for an Instagram carousel"}</p>
    </div>
  );
}

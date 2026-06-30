// Shared team-name normalization and strict fixture-to-match merge logic.
// Used by both the client (tournament.tsx) and the server (ingestion worker).

import type { MatchEvent, MatchStats, PlayerMatchStat, TeamLineup } from "./data";

export const TEAM_NORM: Record<string, string> = {
  turkey: "Türkiye", czechrepublic: "Czechia", czechia: "Czechia",
  korearepublic: "South Korea", southkorea: "South Korea",
  usa: "United States", unitedstates: "United States",
  cotedivoire: "Ivory Coast", ivorycoast: "Ivory Coast",
  congodr: "DR Congo", drcongo: "DR Congo", democraticrepublicofcongo: "DR Congo",
  caboverde: "Cape Verde", capeverdeislands: "Cape Verde", capeverde: "Cape Verde",
  bosniaandherzegovina: "Bosnia & Herzegovina", bosniaherzegovina: "Bosnia & Herzegovina",
  curacao: "Curaçao",
};

export function nrm(s: string): string {
  return (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

export function canon(n: string): string {
  return TEAM_NORM[nrm(n)] || n;
}

// Player name normalization — maps Farsi transliterations and API-Football
// abbreviations to canonical English names (ESPN as reference source).
export const PLAYER_NORM: Record<string, string> = {
  // England
  "H. Kane": "Harry Kane", "Hri Kin": "Harry Kane",
  "J. Bellingham": "Jude Bellingham", "Jvd Blingham": "Jude Bellingham",
  "M. Rashford": "Marcus Rashford",
  // New Zealand
  "Ali Jast": "Elijah Just", "Fin Svrman": "Finn Surman",
  // Germany
  "Dniz Avndav": "Deniz Undav",
  // Brazil
  "Vinicius Junior": "Vinícius Júnior",
  // DR Congo
  "Y. Wissa": "Yoane Wissa", "Fistvn Mail": "Fiston Mayele",
  // Canada
  "Kail Larin": "Cyle Larin", "Astfan Avstakviv": "Stephen Eustáquio",
  "Prvmis Divid": "Promise David", "Mohamed Almnai": "Moïse Bombito",
  // Netherlands
  "Kvdi Khakpv": "Cody Gakpo", "Ian Fn Hkh": "Jan Paul van Hecke",
  "Alis Skhiri": "Ellyes Skhiri",
  // Portugal
  "J. Neves": "João Neves", "Abdalvhid Namtvf": "Abdulwahid Namotaf",
  "Nvnv Mndz": "Nuno Mendes",
  // Morocco
  "Asmaail Saibari": "Ismael Saibari", "Gessime Yassine": "Yassine Gessime",
  "Svfian Rhimi": "Sofiane Rahimi",
  // Switzerland
  "Jvhan Mnzambi": "Johan Manzambi", "Rvbn Vargas": "Rubén Vargas",
  // Mexico
  "Jvlian Kviinvnz": "Julián Quiñones",
  // Uruguay
  "Maximiliano Araújo": "Maxi Araújo",
  // Colombia
  "Dnil Mvnvz": "Daniel Muñoz", "Lviiz Diaz": "Luis Díaz",
  "Khamintvn Kampaz": "Hamilton Campaz",
  // Senegal
  "Paph Gviih": "Pape Gueye", "Ailman Andiaih": "Iliman Ndiaye",
  // Japan
  "Aiash Ivida": "Ayase Ueda",
  // Argentina
  "Jivani Lv Slsv": "Giovani Lo Celso",
  // Ecuador
  "Gvnzalv Plata": "Gonzalo Plata", "Nilsvn Angvlv": "Nelson Angulo",
  // Norway
  "Markvs Hlmgrn Pdrsn": "Markus Holmgren Pedersen",
  // Türkiye
  "Baris Alpr Ailmaz": "Barış Alper Yılmaz", "Kan Aihan": "Kaan Ayhan",
  // Czech Republic
  "mikhal Sadilk": "Michal Sadílek", "‫mikhal Sadilk": "Michal Sadílek",
  // Bosnia & Herzegovina
  "Armin Mhmich": "Ermin Mahmic", "Abvnad": "Edin Džeko",
  "Karim Alaibgvvich": "Karim Alaibegović",
  // South Africa
  "Taplv Maskv": "Thabelo Maseko",
  // Ivory Coast
  "Nikvlas Ph Ph": "Nicolas Pépé",
  // Ghana
  "Drik Lvkasn": "Derrick Luckassen", "Kalb Iirnki": "Caleb Ekuban",
  // Algeria
  "Nzir Bnbvali": "Nazir Benbouali", "Rafik Blghali": "Rafik Belghali",
  // Jordan
  "Mvsi Altmari": "Mousa Al-Tamari",
  // Cape Verde
  "Hliv Varla": "Hélio Varela",
  // Qatar
  // Iran
  // United States
  "Kamrvn Bargs": "Cameron Burgess",
  // Uzbekistan
  "Abas Bk Fiz Allh Af": "Abbas Faizullayev",
  "Aldvr Shvmvrvdvf": "Eldor Shomurodov",
  // Spain
  "Hassan Mohamed Altmbkti": "Lamine Yamal",
  // Croatia
  "M. Baturina": "Martin Baturina", "P. Musa": "Petar Musa",
  // Tunisia
  "Hazm Mstvri": "Hazem Mastouri",
  // Haiti
  // South Korea
};

// Normalize a player name using the PLAYER_NORM table
export function canonPlayer(name: string): string {
  if (!name) return name;
  const trimmed = name.trim().replace(/[​-‏‪-‮﻿]/g, "");
  return PLAYER_NORM[trimmed] || PLAYER_NORM[name] || name;
}

const WINDOW_MS = 75 * 60_000;

export interface VendorFixture {
  ts: number;
  status: string;
  elapsed: number | null;
  venue: string;
  round: string;
  home: string;
  away: string;
  gh: number | null;
  ga: number | null;
  penHome?: number | null;
  penAway?: number | null;
  assistDataMissing?: boolean;
  fixtureId?: number;
  events?: MatchEvent[];
  stats?: MatchStats;
  lineups?: TeamLineup[];
  players?: PlayerMatchStat[];
  referee?: string;
}

export interface ScheduleMatch {
  id: number;
  matchNumber: number;
  kickoffTs: number;
  venueCommon: string;
  homeTeam: string | null;
  awayTeam: string | null;
}

export interface MergeResult {
  match: ScheduleMatch;
  fixture: VendorFixture;
  confidence: "high" | "low";
}

// Strict merge: time window + team-pair match required.
// Each vendor fixture can only be claimed by one schedule match (closest dt wins).
// Returns only high-confidence merges — never writes a low-confidence match.
export function mergeFixtures(
  matches: ScheduleMatch[],
  fixtures: VendorFixture[],
): MergeResult[] {
  const claimed = new Set<number>();
  const candidates: { m: ScheduleMatch; f: VendorFixture; dt: number; fi: number }[] = [];

  for (const m of matches) {
    for (let fi = 0; fi < fixtures.length; fi++) {
      const f = fixtures[fi];
      const dt = Math.abs((f.ts || 0) - m.kickoffTs);
      if (dt > WINDOW_MS) continue;

      if (!m.homeTeam || !m.awayTeam) continue;
      const a = canon(f.home);
      const b = canon(f.away);
      const teamOK = (a === m.homeTeam && b === m.awayTeam) || (a === m.awayTeam && b === m.homeTeam);
      if (!teamOK) continue;

      candidates.push({ m, f, dt, fi });
    }
  }

  // Sort by smallest dt so closest kickoff wins each vendor fixture
  candidates.sort((a, b) => a.dt - b.dt);

  const results: MergeResult[] = [];
  const usedMatches = new Set<number>();

  for (const c of candidates) {
    if (claimed.has(c.fi) || usedMatches.has(c.m.id)) continue;
    claimed.add(c.fi);
    usedMatches.add(c.m.id);
    results.push({ match: c.m, fixture: c.f, confidence: "high" });
  }

  return results;
}

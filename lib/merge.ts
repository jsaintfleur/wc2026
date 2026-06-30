// Shared team-name normalization and strict fixture-to-match merge logic.
// Used by both the client (tournament.tsx) and the server (ingestion worker).

import type { MatchEvent, MatchStats, PlayerMatchStat, TeamLineup } from "./data";

export const TEAM_NORM: Record<string, string> = {
  turkey: "Türkiye", czechrepublic: "Czechia", czechia: "Czechia",
  korearepublic: "South Korea", southkorea: "South Korea",
  usa: "United States", unitedstates: "United States",
  cotedivoire: "Ivory Coast", ivorycoast: "Ivory Coast",
  congodr: "DR Congo", drcongo: "DR Congo", democraticrepublicofcongo: "DR Congo",
  democraticrepublicofthecongo: "DR Congo", congodemocraticrep: "DR Congo",
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
  // Argentina
  "L. Messi": "Lionel Messi",
  "Jivani Lv Slsv": "Giovani Lo Celso", "G. Lo Celso": "Giovani Lo Celso",
  "F. Medina": "Facundo Medina", "L. Martinez": "Lautaro Martínez",
  // England
  "H. Kane": "Harry Kane", "Hri Kin": "Harry Kane",
  "J. Bellingham": "Jude Bellingham", "Jvd Blingham": "Jude Bellingham",
  "M. Rashford": "Marcus Rashford",
  "D. Rice": "Declan Rice", "B. Saka": "Bukayo Saka",
  "E. Anderson": "Elliot Anderson",
  // France
  "K. Mbappe": "Kylian Mbappé", "O. Dembele": "Ousmane Dembélé",
  "M. Olise": "Michael Olise", "B. Barcola": "Bradley Barcola",
  "D. Doue": "Désiré Doué",
  // Norway
  "E. Haaland": "Erling Haaland",
  "Markvs Hlmgrn Pdrsn": "Markus Holmgren Pedersen",
  "M. Pedersen": "Marcus Pedersen",
  "P. Berg": "Patrick Berg", "T. Aasgaard": "Thelo Aasgaard",
  "A. Schjelderup": "Andreas Schjelderup",
  // Brazil
  "Vinicius Junior": "Vinícius Júnior", "M. Cunha": "Matheus Cunha",
  // Germany
  "Dniz Avndav": "Deniz Undav", "D. Undav": "Deniz Undav",
  "F. Nmecha": "Felix Nmecha", "F. Wirtz": "Florian Wirtz",
  "N. Amiri": "Nadiem Amiri", "L. Sane": "Leroy Sané",
  // Netherlands
  "Kvdi Khakpv": "Cody Gakpo", "C. Gakpo": "Cody Gakpo",
  "Ian Fn Hkh": "Jan Paul van Hecke", "J. P. van Hecke": "Jan Paul van Hecke",
  "V. van Dijk": "Virgil van Dijk", "B. Brobbey": "Brian Brobbey",
  "C. Summerville": "Crysencio Summerville",
  "D. Dumfries": "Denzel Dumfries", "M. Depay": "Memphis Depay",
  "T. Reijnders": "Tijjani Reijnders",
  "Alis Skhiri": "Ellyes Skhiri",
  // Portugal
  "J. Neves": "João Neves", "Abdalvhid Namtvf": "Abdulwahid Namotaf",
  "Nvnv Mndz": "Nuno Mendes", "N. Mendes": "Nuno Mendes",
  "C. Ronaldo": "Cristiano Ronaldo", "J. Cancelo": "João Cancelo",
  "B. Fernandes": "Bruno Fernandes", "R. Leao": "Rafael Leão",
  // Japan
  "Aiash Ivida": "Ayase Ueda", "A. Ueda": "Ayase Ueda",
  "K. Nakamura": "Keito Nakamura", "D. Kamada": "Daichi Kamada",
  "K. Itakura": "Ko Itakura", "J. Ito": "Junya Ito",
  "K. Sano": "Kaishu Sano", "D. Maeda": "Daizen Maeda",
  "R. Doan": "Ritsu Doan",
  // Canada
  "Kail Larin": "Cyle Larin", "C. Larin": "Cyle Larin",
  "Astfan Avstakviv": "Stephen Eustáquio",
  "Prvmis Divid": "Promise David", "P. David": "Promise David",
  "J. David": "Jonathan David",
  "N. Saliba": "Nathan-Dylan Saliba",
  "Mohamed Almnai": "Moïse Bombito",
  // Morocco
  "Asmaail Saibari": "Ismael Saibari", "I. Saibari": "Ismael Saibari",
  "Gessime Yassine": "Yassine Gessime", "G. Yassine": "Yassine Gessime",
  "Svfian Rhimi": "Sofiane Rahimi", "S. Rahimi": "Sofiane Rahimi",
  "B. Diaz": "Brahim Diaz", "A. Hakimi": "Achraf Hakimi",
  "C. Riad": "Chadi Riad",
  // Senegal
  "Paph Gviih": "Pape Gueye", "P. Gueye": "Pape Gueye",
  "Ailman Andiaih": "Iliman Ndiaye", "I. Ndiaye": "Iliman Ndiaye",
  "I. Sarr": "Ismaïla Sarr", "N. Jackson": "Nicolas Jackson",
  "H. Diarra": "Habib Diarra", "A. Seck": "Abdoulaye Seck",
  "L. Camara": "Lamine Camara",
  // Switzerland
  "Jvhan Mnzambi": "Johan Manzambi", "J. Manzambi": "Johan Manzambi",
  "Rvbn Vargas": "Rubén Vargas", "R. Vargas": "Rubén Vargas",
  "B. Embolo": "Breel Embolo", "G. Xhaka": "Granit Xhaka",
  // Spain
  "Hassan Mohamed Altmbkti": "Lamine Yamal",
  "M. Oyarzabal": "Mikel Oyarzabal", "A. Laporte": "Aymeric Laporte",
  "D. Olmo": "Dani Olmo", "A. Baena": "Alex Baena",
  "M. Llorente": "Marcos Llorente",
  // Sweden
  "A. Isak": "Alexander Isak", "A. Elanga": "Anthony Elanga",
  // Belgium
  "L. Trossard": "Leandro Trossard", "H. Vanaken": "Hans Vanaken",
  "K. De Bruyne": "Kevin De Bruyne", "R. Lukaku": "Romelu Lukaku",
  "N. Raskin": "Nicolas Raskin", "A. Saelemaekers": "Alexis Saelemaekers",
  // Mexico
  "Jvlian Kviinvnz": "Julián Quiñones", "J. Quinones": "Julián Quiñones",
  "R. Alvarado": "Roberto Alvarado", "L. Romo": "Luis Romo",
  "A. Fidalgo": "Álvaro Fidalgo", "M. Chavez Garcia": "Marcelo Chávez García",
  // Uruguay
  "Maximiliano Araújo": "Maxi Araújo", "M. Araujo": "Maxi Araújo",
  "A. Canobbio": "Agustín Canobbio",
  // Colombia
  "Dnil Mvnvz": "Daniel Muñoz", "D. Munoz": "Daniel Muñoz",
  "Lviiz Diaz": "Luis Díaz", "L. Diaz": "Luis Díaz",
  "Khamintvn Kampaz": "Jaminton Campaz", "J. Campaz": "Jaminton Campaz",
  "G. Puerta": "Gustavo Puerta",
  // Ecuador
  "Gvnzalv Plata": "Gonzalo Plata", "G. Plata": "Gonzalo Plata",
  "Nilsvn Angvlv": "Nelson Angulo", "N. Angulo": "Nelson Angulo",
  "P. Vite": "Pedro Vite", "K. Rodriguez": "Kevin Rodriguez",
  // New Zealand
  "Ali Jast": "Elijah Just", "E. Just": "Elijah Just",
  "Fin Svrman": "Finn Surman", "F. Surman": "Finn Surman",
  "T. Payne": "Tim Payne",
  // DR Congo
  "Y. Wissa": "Yoane Wissa", "Fistvn Mail": "Fiston Mayele",
  // Egypt
  "M. Salah": "Mohamed Salah", "M. Ziko": "Mostafa Ziko",
  "M. Saber": "Mahmoud Saber", "M. Hany": "Mohamed Hany",
  // Algeria
  "Nzir Bnbvali": "Nazir Benbouali", "N. Benbouali": "Nazir Benbouali",
  "Rafik Blghali": "Rafik Belghali", "R. Belghali": "Rafik Belghali",
  "R. Mahrez": "Riyad Mahrez", "A. Gouiri": "Amine Gouiri",
  "H. Aouar": "Houssem Aouar",
  // Austria
  "D. Alaba": "David Alaba", "M. Sabitzer": "Marcel Sabitzer",
  "K. Laimer": "Konrad Laimer", "M. Gregoritsch": "Michael Gregoritsch",
  "M. Arnautovic": "Marko Arnautović", "S. Kalajdzic": "Sasa Kalajdžić",
  // Jordan
  "Mvsi Altmari": "Mousa Al-Tamari", "M. Tamari": "Mousa Al-Tamari",
  "E. Haddad": "Ehsan Haddad", "N. Al Rashdan": "Nabil Al Rashdan",
  // Croatia
  "M. Baturina": "Martin Baturina", "P. Musa": "Petar Musa",
  "A. Budimir": "Ante Budimir", "P. Sucic": "Petar Sučić",
  "N. Vlasic": "Nikola Vlašić",
  // Ivory Coast
  "Nikvlas Ph Ph": "Nicolas Pépé", "N. Pepe": "Nicolas Pépé",
  "F. Kessie": "Franck Kessié", "Y. Diomande": "Yan Diomandé",
  // Ghana
  "Drik Lvkasn": "Derrick Luckassen", "D. Luckassen": "Derrick Luckassen",
  "Kalb Iirnki": "Caleb Ekuban",
  "C. Yirenkyi": "Caleb Yirenkyi", "E. Nuamah": "Ernest Nuamah",
  // Türkiye
  "Baris Alpr Ailmaz": "Barış Alper Yılmaz", "Kan Aihan": "Kaan Ayhan",
  // Czech Republic
  "mikhal Sadilk": "Michal Sadílek", "‫mikhal Sadilk": "Michal Sadílek",
  "M. Sadilek": "Michal Sadílek",
  "A. Sojka": "Alexandr Sojka",
  // Bosnia & Herzegovina
  "Armin Mhmich": "Ermin Mahmic", "E. Mahmic": "Ermin Mahmic",
  "Abvnad": "Edin Džeko",
  "Karim Alaibgvvich": "Karim Alaibegović", "K. Alajbegovic": "Karim Alaibegović",
  // South Africa
  "Taplv Maskv": "Thabelo Maseko", "T. Maseko": "Thabelo Maseko",
  "T. Mokoena": "Teboho Mokoena", "T. Moremi": "Tshepang Moremi",
  // Cape Verde
  "Hliv Varla": "Hélio Varela", "H. Varela": "Hélio Varela",
  "K. Lenini": "Kevin Lenini",
  // Qatar
  "H. Al Haydos": "Hassan Al Haydos",
  // Iran
  "R. Rezaeian": "Ramin Rezaeian",
  // United States
  "Kamrvn Bargs": "Cameron Burgess",
  // Uzbekistan
  "Abas Bk Fiz Allh Af": "Abbas Faizullayev",
  "A. Fayzullaev": "Abbas Faizullayev",
  "Aldvr Shvmvrvdvf": "Eldor Shomurodov",
  // Tunisia
  "Hazm Mstvri": "Hazem Mastouri", "H. Mastouri": "Hazem Mastouri",
  "H. Mejbri": "Hannibal Mejbri",
  // Haiti
  "W. Isidor": "Wilson Isidor", "J. Duverne": "Jean-Kévin Duverne",
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

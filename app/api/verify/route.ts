import { NextRequest, NextResponse } from "next/server";
import { canon, canonPlayer, PLAYER_NORM } from "@/lib/merge";

// ESPN structured JSON APIs — free, no auth, real-time
const ESPN_STATS_URL =
  "https://site.web.api.espn.com/apis/site/v2/sports/soccer/fifa.world/statistics?season=2026&limit=50";
const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

interface EspnScorer {
  name: string;
  team: string;
  goals: number;
  assists: number;
  played: number;
}

interface MatchGoal {
  player: string;
  team: string;
  minute: number;
}

interface EspnMatch {
  date: string;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  status: string;
  goals: MatchGoal[];
}

interface Discrepancy {
  player: string;
  team: string;
  espnGoals: number;
  ourGoals: number;
  delta: number;
  possibleCause: string;
}

interface VerifyResult {
  ok: boolean;
  ts: number;
  source: string;
  matchesFinished: number;
  matchesWithEvents: number;
  totalGoals: number;
  espnScorers: EspnScorer[];
  ourScorers: { name: string; team: string; goals: number; assists: number }[];
  discrepancies: Discrepancy[];
  matchDiscrepancies: {
    date: string;
    home: string;
    away: string;
    espnScore: string;
    ourScore: string;
  }[];
  unmappedNames: { raw: string; team: string; goals: number }[];
  newNameSuggestions: { raw: string; suggested: string; team: string; confidence: string }[];
}

// Fetch top scorers and assist leaders from ESPN's structured JSON API.
// Response shape: { stats: [ { name: "goalsLeaders", leaders: [...] },
//                            { name: "assistsLeaders", leaders: [...] } ] }
// Each leader: { value, athlete: { displayName, team: { displayName }, statistics: [...] } }
async function fetchEspnScorers(): Promise<EspnScorer[]> {
  try {
    const res = await fetch(ESPN_STATS_URL, {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return [];
    const data = await res.json();

    const scorers: EspnScorer[] = [];
    const assistMap = new Map<string, number>();

    // stats[0] = goalsLeaders, stats[1] = assistsLeaders
    const statCategories = data?.stats || [];

    // First pass: collect assist counts so we can attach them to scorers
    const assistCat = statCategories.find(
      (c: { name: string }) => c.name === "assistsLeaders",
    );
    if (assistCat) {
      for (const entry of assistCat.leaders || []) {
        const athlete = entry.athlete || {};
        const name = athlete.displayName || "";
        const team = athlete.team?.displayName || "";
        const assists = Math.round(entry.value || 0);
        if (name) assistMap.set(`${name}|${team}`, assists);
      }
    }

    // Second pass: build scorer list from goals leaders
    const goalsCat = statCategories.find(
      (c: { name: string }) => c.name === "goalsLeaders",
    );
    if (goalsCat) {
      for (const entry of goalsCat.leaders || []) {
        const athlete = entry.athlete || {};
        const team = athlete.team || {};
        const name = athlete.displayName || athlete.shortName || "";
        const teamName = team.displayName || team.name || "";
        const goals = Math.round(entry.value || 0);

        // Get assists from the assist map or from the athlete's statistics
        const assistKey = `${name}|${teamName}`;
        let assists = assistMap.get(assistKey) || 0;
        if (!assists) {
          const aStat = (athlete.statistics || []).find(
            (s: { name: string }) => s.name === "totalAssists",
          );
          assists = aStat ? Math.round(aStat.value || 0) : 0;
        }

        // Get appearances from statistics array
        const appStat = (athlete.statistics || []).find(
          (s: { name: string }) => s.name === "appearances",
        );
        const played = appStat ? Math.round(appStat.value || 0) : 0;

        if (name && goals > 0) {
          scorers.push({ name, team: teamName, goals, assists, played });
        }
      }
    }

    return scorers;
  } catch (err) {
    console.error("[verify] ESPN stats fetch failed:", err);
    return [];
  }
}

// Fetch match results from ESPN scoreboard for a specific date range
async function fetchEspnMatches(startDate: string, endDate: string): Promise<EspnMatch[]> {
  const matches: EspnMatch[] = [];
  try {
    // ESPN accepts date ranges: ?dates=YYYYMMDD-YYYYMMDD
    const url = `${ESPN_SCOREBOARD_URL}?dates=${startDate}-${endDate}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return [];
    const data = await res.json();

    for (const event of data?.events || []) {
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const homeTeam = comp.competitors?.find((c: { homeAway: string }) => c.homeAway === "home");
      const awayTeam = comp.competitors?.find((c: { homeAway: string }) => c.homeAway === "away");
      if (!homeTeam || !awayTeam) continue;

      const goals: MatchGoal[] = [];
      // Extract goal details from key events or details
      for (const detail of comp.details || []) {
        if (detail.type?.text === "Goal" || detail.type?.id === "1") {
          const scorer = detail.athletesInvolved?.[0];
          if (scorer) {
            goals.push({
              player: scorer.displayName || scorer.shortName || "",
              team: detail.team?.displayName || "",
              minute: detail.clock?.displayValue
                ? parseInt(detail.clock.displayValue, 10)
                : 0,
            });
          }
        }
      }

      matches.push({
        date: event.date || "",
        home: homeTeam.team?.displayName || "",
        away: awayTeam.team?.displayName || "",
        homeScore: parseInt(homeTeam.score, 10) || 0,
        awayScore: parseInt(awayTeam.score, 10) || 0,
        status: comp.status?.type?.name || "",
        goals,
      });
    }
  } catch (err) {
    console.error("[verify] ESPN scoreboard fetch failed:", err);
  }
  return matches;
}

// Fetch our live API data and compute scorers
async function fetchOurData(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/live?bust=${Date.now()}`, {
    next: { revalidate: 0 },
  });
  if (!res.ok) return { scorers: [], finished: 0, withEvents: 0, totalGoals: 0, unmapped: [], matchScores: [] };
  const data = await res.json();

  const DONE = new Set(["FT", "AET", "PEN", "PEN_LIVE", "WO", "AWD"]);
  const scorerMap: Record<string, { name: string; team: string; goals: number; assists: number }> = {};
  const unmapped: { raw: string; team: string; goals: number }[] = [];
  const matchScores: { home: string; away: string; gh: number; ga: number; date: string }[] = [];
  let finished = 0;
  let withEvents = 0;
  let totalGoals = 0;

  const knownNorms = new Set(Object.keys(PLAYER_NORM));
  const looksGarbled = (name: string) =>
    /[A-Z][a-z]*[aeiouvk]{2,}[^aeiouy\s]|[bcdfghjklmnpqrstvwxyz]{4}/i.test(name);

  for (const f of data.fixtures || []) {
    if (!DONE.has(f.status)) continue;
    finished++;
    const gh = f.gh || 0;
    const ga = f.ga || 0;
    totalGoals += gh + ga;

    matchScores.push({
      home: f.homeTeam || f.home || "",
      away: f.awayTeam || f.away || "",
      gh,
      ga,
      date: f.date || "",
    });

    if (!f.events || f.events.length === 0) continue;
    withEvents++;

    for (const ev of f.events) {
      if (ev.type !== "Goal") continue;
      if (/shootout/i.test(ev.detail || "")) continue;
      if (ev.detail === "Own Goal") continue;
      if (!ev.player) continue;

      const normalized = canonPlayer(ev.player);
      const team = ev.team ? canon(ev.team) : ev.team;
      const key = `${normalized}|${team}`;

      if (!scorerMap[key]) scorerMap[key] = { name: normalized, team, goals: 0, assists: 0 };
      scorerMap[key].goals++;

      // Track garbled names not in PLAYER_NORM
      if (normalized === ev.player && !knownNorms.has(ev.player) && looksGarbled(ev.player)) {
        const existing = unmapped.find((u) => u.raw === ev.player);
        if (existing) existing.goals++;
        else unmapped.push({ raw: ev.player, team, goals: 1 });
      }

      // Count assists from events
      if (ev.assist && ev.assist !== ev.player) {
        const assistNorm = canonPlayer(ev.assist);
        const assistKey = `${assistNorm}|${team}`;
        if (!scorerMap[assistKey]) scorerMap[assistKey] = { name: assistNorm, team, goals: 0, assists: 0 };
        scorerMap[assistKey].assists++;
      }
    }
  }

  const scorers = Object.values(scorerMap).sort((a, b) => b.goals - a.goals);
  return { scorers, finished, withEvents, totalGoals, unmapped, matchScores };
}

// Fuzzy match garbled names against ESPN data for PLAYER_NORM suggestions
function suggestMatch(
  garbled: string,
  team: string,
  espnScorers: EspnScorer[],
): { suggested: string; confidence: string } | null {
  const sameTeam = espnScorers.filter((s) => canon(s.team) === canon(team));
  if (sameTeam.length === 0) return null;

  const garbledParts = garbled.split(/\s+/);
  const garbledInitials = garbledParts.map((p) => p[0]?.toLowerCase()).join("");

  for (const candidate of sameTeam) {
    const candParts = candidate.name.split(/\s+/);
    const candInitials = candParts.map((p) => p[0]?.toLowerCase()).join("");

    // Same initials and same number of name parts → high confidence
    if (garbledInitials === candInitials && garbledParts.length === candParts.length) {
      return { suggested: candidate.name, confidence: "high" };
    }

    // Same first letter and similar length → medium confidence
    if (
      garbledParts[0]?.[0]?.toLowerCase() === candParts[0]?.[0]?.toLowerCase() &&
      Math.abs(garbled.length - candidate.name.length) <= 3
    ) {
      return { suggested: candidate.name, confidence: "medium" };
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const secret = request.headers.get("authorization")?.replace("Bearer ", "");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && secret !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const baseUrl = request.nextUrl.origin;

    // Fetch ESPN top scorers + our data in parallel
    const [espnScorers, ourData] = await Promise.all([
      fetchEspnScorers(),
      fetchOurData(baseUrl),
    ]);

    // Also fetch recent ESPN match results for score-level verification
    // Cover the full tournament window (Jun 11 – today)
    const espnMatches = await fetchEspnMatches("20260611", new Date().toISOString().slice(0, 10).replace(/-/g, ""));

    // Build discrepancies: compare top scorers
    const discrepancies: Discrepancy[] = [];
    if (espnScorers.length > 0) {
      for (const espn of espnScorers) {
        const ours = ourData.scorers.find((s) => {
          const nameMatch =
            s.name.toLowerCase() === espn.name.toLowerCase() ||
            s.name.toLowerCase().includes(espn.name.split(" ").pop()?.toLowerCase() || "") ||
            espn.name.toLowerCase().includes(s.name.split(" ").pop()?.toLowerCase() || "");
          const teamMatch = canon(s.team) === canon(espn.team);
          return nameMatch && teamMatch;
        });

        if (!ours && espn.goals >= 2) {
          discrepancies.push({
            player: espn.name,
            team: espn.team,
            espnGoals: espn.goals,
            ourGoals: 0,
            delta: -espn.goals,
            possibleCause: "player_missing",
          });
        } else if (ours && ours.goals !== espn.goals) {
          discrepancies.push({
            player: espn.name,
            team: espn.team,
            espnGoals: espn.goals,
            ourGoals: ours.goals,
            delta: ours.goals - espn.goals,
            possibleCause:
              ours.goals < espn.goals ? "missing_events_or_name_split" : "overcounting_or_espn_delayed",
          });
        }
      }
    }

    // Build match-level discrepancies by comparing scores
    const matchDiscrepancies: VerifyResult["matchDiscrepancies"] = [];
    for (const espnMatch of espnMatches) {
      if (espnMatch.status !== "STATUS_FULL_TIME") continue;

      // Find matching fixture in our data by team names
      const ourMatch = ourData.matchScores.find((m) => {
        const h1 = canon(espnMatch.home);
        const a1 = canon(espnMatch.away);
        const h2 = canon(m.home);
        const a2 = canon(m.away);
        return (h1 === h2 && a1 === a2) || (h1 === a2 && a1 === h2);
      });

      if (ourMatch) {
        const espnScore = `${espnMatch.homeScore}-${espnMatch.awayScore}`;
        const ourScore = `${ourMatch.gh}-${ourMatch.ga}`;
        // Check both orientations since home/away may differ
        const ourScoreFlipped = `${ourMatch.ga}-${ourMatch.gh}`;
        if (espnScore !== ourScore && espnScore !== ourScoreFlipped) {
          matchDiscrepancies.push({
            date: espnMatch.date,
            home: espnMatch.home,
            away: espnMatch.away,
            espnScore,
            ourScore,
          });
        }
      }
    }

    // Generate PLAYER_NORM suggestions for garbled names
    const newNameSuggestions: VerifyResult["newNameSuggestions"] = [];
    for (const u of ourData.unmapped) {
      const suggestion = suggestMatch(u.raw, u.team, espnScorers);
      if (suggestion) {
        newNameSuggestions.push({
          raw: u.raw,
          suggested: suggestion.suggested,
          team: u.team,
          confidence: suggestion.confidence,
        });
      }
    }

    const result: VerifyResult = {
      ok: true,
      ts: Date.now(),
      source: "ESPN JSON API (site.web.api.espn.com)",
      matchesFinished: ourData.finished,
      matchesWithEvents: ourData.withEvents,
      totalGoals: ourData.totalGoals,
      espnScorers: espnScorers.slice(0, 25),
      ourScorers: ourData.scorers.slice(0, 25),
      discrepancies,
      matchDiscrepancies,
      unmappedNames: ourData.unmapped,
      newNameSuggestions,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[verify] failed:", err);
    return NextResponse.json(
      { ok: false, error: "verification failed", detail: String(err) },
      { status: 500 },
    );
  }
}

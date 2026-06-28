import { NextRequest, NextResponse } from "next/server";
import { canon, canonPlayer, PLAYER_NORM } from "@/lib/merge";

// ESPN scoring stats page URL for FIFA World Cup 2026
const ESPN_URL = "https://www.espn.com/soccer/stats/_/league/FIFA.WORLD/view/scoring";

// Matches the structured text output from ESPN's scoring page
interface EspnScorer { name: string; team: string; played: number; goals: number }
interface EspnAssist { name: string; team: string; played: number; assists: number }
interface VerifyResult {
  ok: boolean;
  ts: number;
  matchesFinished: number;
  matchesWithEvents: number;
  totalGoals: number;
  espnScorers: EspnScorer[];
  ourScorers: { name: string; team: string; goals: number }[];
  discrepancies: {
    player: string;
    team: string;
    espnGoals: number;
    ourGoals: number;
    delta: number;
    possibleCause: string;
  }[];
  unmappedNames: { raw: string; team: string; goals: number }[];
  newNameSuggestions: { raw: string; suggested: string; team: string; confidence: string }[];
}

// Fetch and parse ESPN scoring stats
async function fetchEspnScorers(): Promise<EspnScorer[]> {
  const res = await fetch(ESPN_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "text/html",
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) return [];
  const html = await res.text();

  // Parse the Top Scorers table from ESPN HTML
  // ESPN uses a consistent structure: <td> cells with player name, team, P, G
  const scorers: EspnScorer[] = [];

  // Extract from the structured data — ESPN embeds JSON-LD or we parse the table
  // Fall back to regex-based extraction from the rendered HTML
  const tableRegex = /class="Table"[^>]*>[\s\S]*?<\/table>/gi;
  const tables = html.match(tableRegex) || [];

  // First table is Top Scorers
  const firstTable = tables[0];
  if (firstTable) {
    const rowRegex = /<tr[^>]*class="Table__TR[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
    let match;
    while ((match = rowRegex.exec(firstTable)) !== null) {
      const cells = match[1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      if (cells.length >= 4) {
        const getText = (cell: string) => cell.replace(/<[^>]*>/g, "").trim();
        const nameCell = getText(cells[1] ?? "");
        const teamCell = getText(cells[2] ?? "");
        const played = parseInt(getText(cells[3] ?? ""), 10);
        const goals = parseInt(getText(cells[4] ?? cells[3] ?? ""), 10);

        if (nameCell && teamCell && !isNaN(goals) && goals > 0) {
          scorers.push({ name: nameCell, team: teamCell, played, goals });
        }
      }
    }
  }

  // If HTML parsing failed, try the text-based approach via the page API
  if (scorers.length === 0) {
    // Parse from the simple text pattern in ESPN pages
    const lines = html.split("\n");
    let inScorers = false;
    for (const line of lines) {
      if (line.includes("Top Scorers")) inScorers = true;
      if (line.includes("Top Assists")) break;
      if (!inScorers) continue;

      // Look for JSON data embedded in the page
      const jsonMatch = line.match(/"displayName":"([^"]+)".*?"goals":(\d+)/);
      if (jsonMatch) {
        scorers.push({ name: jsonMatch[1], team: "", played: 0, goals: parseInt(jsonMatch[2], 10) });
      }
    }
  }

  return scorers;
}

// Fetch our live API data and compute scorers
async function fetchOurScorers(baseUrl: string): Promise<{
  scorers: { name: string; team: string; goals: number }[];
  finished: number;
  withEvents: number;
  totalGoals: number;
  unmapped: { raw: string; team: string; goals: number }[];
}> {
  const res = await fetch(`${baseUrl}/api/live?bust=${Date.now()}`, { next: { revalidate: 0 } });
  if (!res.ok) return { scorers: [], finished: 0, withEvents: 0, totalGoals: 0, unmapped: [] };
  const data = await res.json();

  const DONE = new Set(["FT", "AET", "PEN", "PEN_LIVE", "WO", "AWD"]);
  const scorerMap: Record<string, { name: string; team: string; goals: number }> = {};
  const unmapped: { raw: string; team: string; goals: number }[] = [];
  let finished = 0, withEvents = 0, totalGoals = 0;

  // Known PLAYER_NORM values for detecting unmapped names
  const knownNorms = new Set(Object.keys(PLAYER_NORM));
  const looksGarbled = (name: string) => /[A-Z][a-z]*[aeiouvk]{2,}[^aeiouy\s]|[bcdfghjklmnpqrstvwxyz]{4}/i.test(name);

  for (const f of data.fixtures || []) {
    if (!DONE.has(f.status)) continue;
    finished++;
    totalGoals += (f.gh || 0) + (f.ga || 0);
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

      if (!scorerMap[key]) scorerMap[key] = { name: normalized, team, goals: 0 };
      scorerMap[key].goals++;

      // Track names that might be garbled and aren't in PLAYER_NORM
      if (normalized === ev.player && !knownNorms.has(ev.player) && looksGarbled(ev.player)) {
        const existing = unmapped.find(u => u.raw === ev.player);
        if (existing) existing.goals++;
        else unmapped.push({ raw: ev.player, team, goals: 1 });
      }
    }
  }

  const scorers = Object.values(scorerMap).sort((a, b) => b.goals - a.goals);
  return { scorers, finished, withEvents, totalGoals, unmapped };
}

// Fuzzy name matching for suggesting PLAYER_NORM entries
function suggestMatch(garbled: string, team: string, espnScorers: EspnScorer[]): { suggested: string; confidence: string } | null {
  // Filter ESPN scorers by same team
  const sameTeam = espnScorers.filter(s => {
    const ct = canon(s.team);
    const gt = canon(team);
    return ct === gt;
  });

  if (sameTeam.length === 0) return null;

  // Try initial-letter matching
  const garbledParts = garbled.split(/\s+/);
  const garbledInitials = garbledParts.map(p => p[0]?.toLowerCase()).join("");

  for (const candidate of sameTeam) {
    const candParts = candidate.name.split(/\s+/);
    const candInitials = candParts.map(p => p[0]?.toLowerCase()).join("");

    // Same initials and same number of name parts
    if (garbledInitials === candInitials && garbledParts.length === candParts.length) {
      return { suggested: candidate.name, confidence: "high" };
    }

    // Same first letter and similar length
    if (garbledParts[0]?.[0]?.toLowerCase() === candParts[0]?.[0]?.toLowerCase() &&
        Math.abs(garbled.length - candidate.name.length) <= 3) {
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

    // Fetch both data sources in parallel
    const [espnScorers, ourData] = await Promise.all([
      fetchEspnScorers(),
      fetchOurScorers(baseUrl),
    ]);

    // Build comparison
    const discrepancies: VerifyResult["discrepancies"] = [];
    const newNameSuggestions: VerifyResult["newNameSuggestions"] = [];

    // Compare top scorers if ESPN data is available
    if (espnScorers.length > 0) {
      for (const espn of espnScorers) {
        const ours = ourData.scorers.find(s => {
          const nameMatch = s.name.toLowerCase() === espn.name.toLowerCase() ||
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
            possibleCause: ours.goals < espn.goals ? "missing_events_or_name_split" : "overcounting",
          });
        }
      }
    }

    // Generate suggestions for unmapped garbled names
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
      matchesFinished: ourData.finished,
      matchesWithEvents: ourData.withEvents,
      totalGoals: ourData.totalGoals,
      espnScorers: espnScorers.slice(0, 20),
      ourScorers: ourData.scorers.slice(0, 20),
      discrepancies,
      unmappedNames: ourData.unmapped,
      newNameSuggestions,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[verify] failed:", err);
    return NextResponse.json({ ok: false, error: "verification failed", detail: String(err) }, { status: 500 });
  }
}

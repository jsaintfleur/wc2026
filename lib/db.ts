import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";
import { DATA, type TournamentData, type GroupStageMatch, type KnockoutMatch, type Venue, type MatchEvent, type MatchStats, type TeamLineup, type PlayerMatchStat } from "./data";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — configure it in .env.local before querying the database.",
    );
  }
  return new PrismaClient({
    adapter: new PrismaPg(connectionString),
  });
}

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value = client[property as keyof PrismaClient];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

function dbConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

export async function loadTournamentData(): Promise<{ data: TournamentData; source: "db" | "static" }> {
  if (!dbConfigured()) return { data: DATA, source: "static" };

  try {
    const [allTeams, allVenues, allGroups, allGroupTeams, allMatches] = await Promise.all([
      prisma.team.findMany(),
      prisma.venue.findMany(),
      prisma.group.findMany({ orderBy: { letter: "asc" } }),
      prisma.groupTeam.findMany({ include: { team: true }, orderBy: [{ groupLetter: "asc" }, { position: "asc" }] }),
      prisma.match.findMany({
        include: { homeTeam: true, awayTeam: true, state: true },
        orderBy: { matchNumber: "asc" },
      }),
    ]);

    const venues: Record<string, Venue> = {};
    for (const v of allVenues) {
      venues[v.code] = { common: v.commonName, fifa: v.fifaName, city: v.city, country: v.country, cap: v.capacity };
    }

    const flags: Record<string, string> = {};
    for (const t of allTeams) flags[t.name] = t.flag;

    const hosts = allTeams.filter(t => t.isHost).map(t => t.name);

    const groups: Record<string, string[]> = {};
    const gcolor: Record<string, string> = {};
    for (const g of allGroups) gcolor[g.letter] = g.color;
    for (const gt of allGroupTeams) {
      const letter = gt.groupLetter;
      if (!groups[letter]) groups[letter] = [];
      groups[letter].push(gt.team.name);
    }

    const gs: GroupStageMatch[] = [];
    const ko: KnockoutMatch[] = [];
    const starts: number[] = [];

    for (const m of allMatches) {
      const ts = new Date(m.kickoffUtc).getTime();
      starts.push(ts);
      const iso = m.isoDate.toISOString().slice(0, 10);

      const state = m.state;

      if (m.stage === "group") {
        const dbFixtureId = state?.vendorFixtureId == null ? null : Number(state.vendorFixtureId);
        gs.push({
          no: m.matchNumber,
          iso,
          local: m.localTime,
          et: m.etTime,
          g: m.groupLetter!,
          t1: m.homeTeam?.name || "TBD",
          t2: m.awayTeam?.name || "TBD",
          v: m.venueCode,
          ts,
          ...(state ? {
            dbStatus: state.status,
            dbElapsed: state.elapsed,
            dbGh: state.homeGoals,
            dbGa: state.awayGoals,
            dbEvents: state.events as unknown as MatchEvent[] | undefined,
            dbStats: state.stats as unknown as MatchStats | undefined,
            dbLineups: state.lineups as unknown as TeamLineup[] | undefined,
            dbPlayers: state.players as unknown as PlayerMatchStat[] | undefined,
            dbReferee: state.referee,
            dbFixtureId,
          } : {}),
        });
      } else {
        ko.push({
          round: m.round || "",
          mr: m.matchRange || "",
          iso,
          local: m.localTime,
          et: m.etTime,
          v: m.venueCode,
          ts,
        });
      }
    }

    return {
      data: { venues, groups, hosts, gs, ko, flags, gcolor, starts },
      source: "db",
    };
  } catch (err) {
    console.error("Failed to load from database:", err);
    return { data: DATA, source: "static" };
  }
}

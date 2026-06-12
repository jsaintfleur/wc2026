import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { DATA } from "../lib/data";

const connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!connectionString) {
  console.error("DATABASE_URL or DIRECT_URL must be set to seed the database.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg(connectionString) });

const HOSTS = new Set(["Canada", "Mexico", "United States"]);

async function main() {
  console.log("Seeding WC2026 database…");

  // Teams
  const teamMap: Record<string, number> = {};
  for (const [name, flag] of Object.entries(DATA.flags)) {
    const team = await prisma.team.upsert({
      where: { name },
      update: { flag, isHost: HOSTS.has(name) },
      create: { name, flag, isHost: HOSTS.has(name) },
    });
    teamMap[name] = team.id;
  }
  console.log(`  ${Object.keys(teamMap).length} teams`);

  // Venues
  for (const [code, v] of Object.entries(DATA.venues)) {
    await prisma.venue.upsert({
      where: { code },
      update: { commonName: v.common, fifaName: v.fifa, city: v.city, country: v.country, capacity: v.cap },
      create: { code, commonName: v.common, fifaName: v.fifa, city: v.city, country: v.country, capacity: v.cap },
    });
  }
  console.log(`  ${Object.keys(DATA.venues).length} venues`);

  // Groups + memberships
  for (const [letter, teams] of Object.entries(DATA.groups)) {
    const color = DATA.gcolor[letter];
    await prisma.group.upsert({
      where: { letter },
      update: { color },
      create: { letter, color },
    });
    for (let i = 0; i < teams.length; i++) {
      const teamId = teamMap[teams[i]];
      await prisma.groupTeam.upsert({
        where: { groupLetter_teamId: { groupLetter: letter, teamId } },
        update: { position: i + 1 },
        create: { groupLetter: letter, teamId, position: i + 1 },
      });
    }
  }
  console.log(`  ${Object.keys(DATA.groups).length} groups`);

  // Group-stage matches
  for (const m of DATA.gs) {
    await prisma.match.upsert({
      where: { matchNumber: m.no },
      update: {},
      create: {
        matchNumber: m.no,
        stage: "group",
        groupLetter: m.g,
        venueCode: m.v,
        homeTeamId: teamMap[m.t1],
        awayTeamId: teamMap[m.t2],
        kickoffUtc: new Date(m.ts),
        localTime: m.local,
        etTime: m.et,
        isoDate: new Date(m.iso + "T00:00:00Z"),
      },
    });
  }
  console.log(`  ${DATA.gs.length} group-stage matches`);

  // Knockout matches
  for (const m of DATA.ko) {
    const matchNumber = parseInt(m.mr.split("–")[0]) + DATA.ko.indexOf(m) - DATA.ko.findIndex(k => k.mr === m.mr);
    await prisma.match.upsert({
      where: { matchNumber },
      update: {},
      create: {
        matchNumber,
        stage: "knockout",
        round: m.round,
        matchRange: m.mr,
        venueCode: m.v,
        kickoffUtc: new Date(m.ts),
        localTime: m.local,
        etTime: m.et,
        isoDate: new Date(m.iso + "T00:00:00Z"),
      },
    });
  }
  console.log(`  ${DATA.ko.length} knockout matches`);

  console.log("Done — 104 matches seeded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

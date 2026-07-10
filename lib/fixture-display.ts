import type { LiveFixture } from "./data";
import { canon } from "./merge";

function isResolvedTeam(name: string | null | undefined): name is string {
  return !!name && canon(name) !== "TBD" && !/^(winner|loser|tbd|[123](st|nd|rd)\s+)/i.test(name.trim());
}

export function alignFixtureToDisplayTeams(
  fixture: LiveFixture | null,
  displayHome: string | null | undefined,
  displayAway: string | null | undefined,
): LiveFixture | null {
  if (!fixture) return null;
  if (!isResolvedTeam(displayHome) || !isResolvedTeam(displayAway)) return fixture;

  const fixtureHome = canon(fixture.home);
  const fixtureAway = canon(fixture.away);
  const uiHome = canon(displayHome);
  const uiAway = canon(displayAway);
  const sameOrder = fixtureHome === uiHome && fixtureAway === uiAway;
  const reversedOrder = fixtureHome === uiAway && fixtureAway === uiHome;

  if (!sameOrder && !reversedOrder) return fixture;
  if (sameOrder) {
    if (fixture.home === displayHome && fixture.away === displayAway) return fixture;
    return { ...fixture, home: displayHome, away: displayAway };
  }

  return {
    ...fixture,
    home: displayHome,
    away: displayAway,
    gh: fixture.ga,
    ga: fixture.gh,
    penHome: fixture.penAway,
    penAway: fixture.penHome,
    stats: fixture.stats ? { home: fixture.stats.away, away: fixture.stats.home } : fixture.stats,
    lineups: Array.isArray(fixture.lineups) && fixture.lineups.length >= 2
      ? [fixture.lineups[1], fixture.lineups[0], ...fixture.lineups.slice(2)]
      : fixture.lineups,
  };
}

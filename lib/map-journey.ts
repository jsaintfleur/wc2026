export type JourneyVenueStop<T extends { venueId: string }> = {
  key: string;
  venueId: string;
  matches: T[];
};

export function groupConsecutiveJourneyStops<T extends { key: string; venueId: string }>(matches: T[]): JourneyVenueStop<T>[] {
  const groups: JourneyVenueStop<T>[] = [];
  for (const match of matches) {
    const last = groups[groups.length - 1];
    if (last && last.venueId === match.venueId) {
      last.matches.push(match);
    } else {
      groups.push({ key: match.key, venueId: match.venueId, matches: [match] });
    }
  }
  return groups;
}

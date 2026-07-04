export function resolveFilteredVenueSelection(
  activeVenueId: string,
  filteredVenueIds: Set<string>,
  orderedVenueIds: string[],
): { venueId: string | null; closePanel: boolean } {
  if (filteredVenueIds.has(activeVenueId)) return { venueId: activeVenueId, closePanel: false };
  const first = orderedVenueIds.find(venueId => filteredVenueIds.has(venueId)) || null;
  return first
    ? { venueId: first, closePanel: false }
    : { venueId: null, closePanel: true };
}

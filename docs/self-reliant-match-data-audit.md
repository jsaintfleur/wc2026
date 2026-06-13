# Self-Reliant Match Data Audit

## Goal

Make the app self-reliant for post-match detail views: scores, events, Starting XI, substitutes, formations, player stats, and generated match reports should persist after the vendor live window closes.

## Current State

- The match drawer already renders rich data:
  - Summary timeline from `fixture.events`
  - Stats from `fixture.stats`
  - Starting XI, substitutes, and pitch view from `fixture.lineups`
  - Player ratings/top performers from `fixture.players`
  - Post-match report from final score, events, stats, subs, and player ratings
- `/api/live` can enrich with API-Football lineups/stats/player data while a match is active.
- `/api/ingest` previously stored only score/status in `match_state`.
- Vercel cron previously ran `/api/ingest` once per day, which is not enough to capture lineups and final post-match stats reliably.

## Main Risk

If API-Football no longer returns enriched details after the live window, the app can lose lineups, substitutes, player ratings, and match reports unless those details were loaded live in the browser at the time.

## Proposed Change Set

0. Treat API-Football rich live enrichment as mandatory during match windows.
   - `/api/live` now reports explicit enrichment health metadata.
   - The UI shows a live enrichment warning instead of silently treating basic score fallback as good enough.
   - The admin quality page flags missing API-Football fixture IDs and missing rich snapshots.

1. Persist rich match snapshots in `match_state`.
   - `events_json`
   - `stats_json`
   - `lineups_json`
   - `players_json`
   - `referee`

2. Expand ingestion.
   - Parse API-Football events, stats, lineups, substitutes, player ratings, and referee.
   - Store that data whenever a fixture is matched confidently to the schedule.
   - Keep the existing strict merge rule: time window plus venue or exact team pair.

3. Use DB snapshots as the app fallback.
   - Browser still prefers live enriched fixtures when available.
   - If live enrichment is missing, match detail uses persisted DB data.
   - This keeps Starting XI, substitutes, stats, and reports available after final whistle.

4. Improve cron cadence.
   - Run ingest every 15 minutes.
   - Route still skips outside match windows.
   - Ingest window starts 90 minutes before kickoff and continues 6 hours after kickoff to capture lineups and corrected final stats.
   - Daily quota cap remains in place.

5. Keep the basic community score feed as fallback only.
   - It can help avoid a blank score surface during an upstream issue.
   - It is not considered a healthy live-enrichment state because it does not guarantee Starting XI, substitutions, team stats, or player stats.

## Deployment Requirement

Before deploying the code that reads these fields, run:

```bash
npm run db:push
```

This updates the production database schema. Deploying the app before the database has these columns may break DB-backed page loads.

## Verification Plan

1. Run `npm run db:push`.
2. Run `npm run db:generate`.
3. Run `npm run build`.
4. In a non-production or preview environment, call `/api/ingest/mock`.
5. Open `/?mock=1`, tap a match with mock lineups, and confirm:
   - Summary timeline renders.
   - Stats tab renders.
   - Lineups tab renders Starting XI and Substitutes.
   - Report tab appears after FT.
6. On production match days, check `/api/live?debug=1` and `/api/ingest?force=1` with cron auth.

## Recommended Next Step

After the schema is pushed, add a small internal quality check for rich detail coverage:

- finished matches missing `events_json`
- finished matches missing `lineups_json`
- finished matches missing `stats_json`
- matches with a score but no `vendor_fixture_id`

That gives a single admin surface to catch vendor gaps without manually editing every match.

# FIFA World Cup 2026 — Live Schedule (Vercel)

A single-page mobile app for the 2026 World Cup: confirmed schedule + groups + venues,
with **live scores and group tables** during matches. Live data comes from API-Football's
free tier through a small serverless proxy so your API key is never exposed in the browser.

## Files
- `index.html` — the app (works on its own; just no live scores without the proxy)
- `api/live.js` — Vercel serverless function that calls API-Football and caches the result

## 1. Get a free API key (about 1 minute)
1. Sign up at **dashboard.api-football.com** (this is the *direct* API-Sports key — not RapidAPI).
2. The free plan gives **100 requests/day** — enough here because the app only polls during
   match windows and caches every request at Vercel's edge.
3. Copy your key from the dashboard.

## 2. Deploy to Vercel
```bash
cd wc2026-live
vercel            # first run: create a new project, accept defaults
vercel --prod     # promote to your public URL
```

## 3. Add your key
In the Vercel dashboard → your project → **Settings → Environment Variables**, add:

| Name | Value |
|------|-------|
| `APIFOOTBALL_KEY` | *your key* |

Optional overrides (only if needed):
- `WC_LEAGUE` (default `1` = FIFA World Cup) · `WC_SEASON` (default `2026`)
- `LIVE_TTL` (default `420`s edge cache during matches) · `IDLE_TTL` (default `1800`s between matches)

Then redeploy: `vercel --prod`.

## 4. Verify it's working
- Open **`https://your-app.vercel.app/api/live?debug=1`**. You should see
  `upstreamOk: true`, a `fixtureCount`, your remaining quota, and a few sample fixtures.
- If `fixtureCount` is 0, the World Cup `WC_LEAGUE`/`WC_SEASON` may differ on your plan —
  adjust the env vars and redeploy.
- Preview the live UI any time (no key, no quota) by opening **`index.html?mock=1`** or
  **`https://your-app.vercel.app/?mock=1`** — it shows sample live scores, an in-play match
  and a resolved knockout tie so you can see the design before kickoff.

## 5. Share
Send the `https://your-app.vercel.app` link. On a phone, **Share → Add to Home Screen**
gives it an app icon and full-screen launch.

## Notes
- **Quota behaviour:** if the daily limit is hit, the app shows the latest known scores with a
  "paused" badge instead of erroring. Heaviest days (lots of overlapping matches) can approach
  the free cap; raising `LIVE_TTL` trades freshness for headroom, or API-Football's $19/mo Pro
  plan (7,500/day) removes the worry entirely.
- **Tables** are computed in the browser from full-time scores (no extra API calls). Order uses
  points → goal difference → goals scored; FIFA's official tiebreakers decide the real standings.
- Live data is **unofficial**; FIFA is the source of record.

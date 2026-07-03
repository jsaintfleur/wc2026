# Compet 2026

**A premium World Cup 2026 companion app.**

Compet 2026 is a mobile-first FIFA World Cup 2026 experience: live match schedule, interactive knockout bracket, group standings, team pages, player statistics, and tournament leaders — wrapped in a polished, installable PWA.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-7-2d3748?logo=prisma)](https://www.prisma.io)
[![Deployed on Vercel](https://img.shields.io/badge/Vercel-deployed-black?logo=vercel)](https://vercel.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [App Structure](#app-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Data Architecture](#data-architecture)
- [UX Philosophy](#ux-philosophy)
- [Roadmap](#roadmap)
- [Screenshots](#screenshots)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Compet 2026 tracks the entire FIFA World Cup 2026 — 104 matches across 16 host cities in the United States, Mexico, and Canada — from the group stage through the final at MetLife Stadium.

The app is built around a single principle: **the validated schedule is the source of truth**. Live vendor data only overlays scores and match state on top of verified tournament facts, and a score is never shown unless the merge between the schedule and the live feed is high-confidence. If the live feed goes down, the schedule, standings, bracket, and stats keep working.

Everything is designed mobile-first with bottom-tab navigation and scales up cleanly to desktop.

## Key Features

### Live Schedule
Full 104-match schedule with kickoff times, venues, group tags, and live score overlays. The client polls the live API every 30 seconds during match windows; finished matches render from verified results.

### Interactive Knockout Bracket
A 9-column elimination tree (Round of 32 through the Final, mirrored left/right around the trophy) rendered as a horizontally scrollable CSS Grid with round-tab navigation that smooth-scrolls and centers any round.

### Road to the Final
Tap any team in the bracket to trace their complete path to the trophy — past results and projected future ties are highlighted through the tree.

### Team Profiles
All 48 qualified national teams with squads, group context, and results.

### Player Statistics
Top scorers, assists, and discipline, aggregated from match events with player-name normalization across data sources (transliterations and abbreviations mapped to canonical names).

### Tournament Leaders
Golden Boot race and team leaderboards computed from verified match data.

### Mobile-First Navigation
Bottom tab bar, safe-area-inset handling, and an installable PWA (web manifest + service worker) for a home-screen app experience.

### Responsive Desktop Support
The layout widens to 1280px for the bracket view and stays centered and readable at every breakpoint.

### Shared Tournament Data Layer
Schedule, teams, standings math, merge logic, and stats aggregation live in `lib/` and are shared between the client UI and the server-side ingestion/verification routes.

### Data Refresh & Caching
Vercel Cron jobs ingest, reconcile, and verify data on a schedule; the live endpoint is served with `no-store` headers so scores are never stale, while quiet periods back off to protect API quota.

## Tech Stack

Verified against `package.json` — nothing here is aspirational.

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router) |
| UI | [React 19](https://react.dev), hand-written CSS (`app/globals.css` — no CSS framework) |
| Language | TypeScript 5 |
| Database | PostgreSQL via [Prisma 7](https://www.prisma.io) (`@prisma/client`, `@prisma/adapter-pg`, `pg`) |
| Data fetching | Native `fetch` + client-side polling (no external data library) |
| State | React hooks + `sessionStorage` (no state-management library) |
| Live data | [API-Football](https://www.api-football.com/) (server-side only) |
| Verification | ESPN public JSON APIs (cross-checking scores and scorer stats) |
| Testing | Node's built-in test runner via `tsx --test` |
| Linting | ESLint 9 + `eslint-config-next` |
| Deployment | Vercel (with Vercel Cron for ingestion jobs) |

## App Structure

```
wc2026/
├── app/                        # Next.js App Router
│   ├── page.tsx                # Entry page
│   ├── layout.tsx              # Root layout + metadata
│   ├── tournament.tsx          # Main tournament UI (views, bracket, stats)
│   ├── globals.css             # All styling — design tokens, views, bracket
│   ├── register-sw.tsx         # Service-worker registration (PWA)
│   ├── components/
│   │   ├── BracketBuilder.tsx  # Knockout bracket construction
│   │   ├── WorldCupTrophy.tsx  # Trophy SVG
│   │   └── TriondaBall.tsx     # Match ball SVG
│   ├── admin/quality/          # Internal data-quality dashboard
│   └── api/
│       ├── live/               # Live scores endpoint (client polls this)
│       ├── ingest/             # Cron: pull fixtures from API-Football
│       ├── reconcile/          # Cron: reconcile stored results
│       └── verify/             # Cron: cross-check vs ESPN, flag discrepancies
├── lib/                        # Shared data layer
│   ├── data.ts                 # Static tournament data (schedule, venues, hosts)
│   ├── teams.ts                # Team data and helpers
│   ├── merge.ts                # Name normalization + strict fixture merge
│   ├── stats.ts                # Stats aggregation
│   ├── verified-results.ts     # Manually verified match results
│   └── db.ts                   # Prisma client setup
├── prisma/                     # Schema, migrations config, seed script
├── tests/                      # Unit tests (stats aggregation)
├── public/                     # Icons, logos, manifest.json, sw.js
├── docs/                       # Engineering notes and audits
├── next.config.ts              # Cache-control headers for /api/live
└── vercel.json                 # Cron schedules (ingest / reconcile / verify)
```

## Getting Started

The repo uses **npm** (`package-lock.json` is committed).

```bash
# 1. Clone
git clone https://github.com/jsaintfleur/wc2026.git
cd wc2026

# 2. Install (also runs `prisma generate` via postinstall)
npm install

# 3. Configure environment
cp .env.example .env.local
# fill in DATABASE_URL, DIRECT_URL, APIFOOTBALL_KEY, CRON_SECRET

# 4. Set up the database
npm run db:push        # push schema to your Postgres instance
npm run db:seed        # seed tournament data

# 5. Develop
npm run dev            # http://localhost:3000

# 6. Test / lint
npm test
npm run lint

# 7. Production build
npm run build
npm start
```

## Environment Variables

Documented in [.env.example](.env.example). Placeholders only — never commit real values.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Pooled Postgres connection string used by the app at runtime |
| `DIRECT_URL` | Yes | Direct (non-pooled) connection used for migrations |
| `APIFOOTBALL_KEY` | Yes | API-Football key — server-side only, never shipped to the client |
| `CRON_SECRET` | Yes | Bearer token Vercel Cron sends to authenticate ingestion routes |
| `LIVE_TTL` | No | Cache TTL (seconds) during live match windows (default `420`) |
| `IDLE_TTL` | No | Cache TTL between matches (default `1800`) |
| `WC_LEAGUE` | No | API-Football league id (default `1` = FIFA World Cup) |
| `WC_SEASON` | No | Season (default `2026`) |

## Data Architecture

**Source of truth:** the validated match schedule in `lib/data.ts` (match numbers, kickoff times, venues, group assignments). Vendor data never overwrites these facts.

**Flow:**

1. **Ingest** (`/api/ingest`, cron @ 04:00 UTC) — pulls fixtures from API-Football into Postgres.
2. **Merge** (`lib/merge.ts`) — each vendor fixture is matched to a schedule entry using a strict rule: kickoff within a 75-minute window **and** an exact team-pair match after name normalization. Each fixture can be claimed by only one match; only high-confidence merges are accepted. When unsure, no score is shown.
3. **Live overlay** (`/api/live`) — the client polls every 30 seconds; the endpoint is served with `no-store` headers. Live data overlays only score and match state on top of schedule facts.
4. **Standings** — group tables are computed from full-time scores (points → goal difference → goals scored).
5. **Knockout progression** — bracket slots resolve from verified results; unresolved ties show seeded placeholders.
6. **Stats** (`lib/stats.ts`) — scorers, assists, and cards aggregate from match events, with `PLAYER_NORM` mapping garbled or abbreviated names to canonical ones.
7. **Reconcile & verify** (`/api/reconcile`, `/api/verify`, daily crons) — stored results are reconciled and cross-checked against ESPN's public JSON APIs; discrepancies and unmapped player names are flagged for review on the internal quality dashboard.
8. **Degradation** — if the live feed is down or quota is exhausted, schedule, standings, bracket, and stats continue to work from verified data.

Live data is unofficial; FIFA is the source of record. The data provider is attributed, and no news, video, or highlights are scraped.

## UX Philosophy

- **Premium sports-app feel** — dark theme, gold accents, layered depth; not a generic admin template.
- **Mobile-first** — bottom tab navigation, thumb-reachable controls, safe-area awareness; desktop is an enhancement, not the baseline.
- **Readable match cards** — scores, states, and kickoff times legible at a glance with tabular numerals.
- **Clear live states** — live, HT, FT, AET, and penalties are visually distinct; an unverified score is never displayed.
- **Smooth bracket exploration** — horizontal swipe with round tabs that center any round, plus per-team path tracing.
- **Restrained iconography** — flags where meaningful, minimal emoji elsewhere.
- **Accessible contrast and spacing** — ARIA labels on interactive regions, reduced-motion support, consistent hairline borders and spacing rhythm.

## Roadmap

- [ ] Improve live match sync (tighter polling during match windows, smarter backoff)
- [ ] Add full advanced team stats (possession, shots, xG breakdowns per match)
- [ ] Add xG/xA if the data source supports it
- [ ] Improve bracket gestures (pinch-to-zoom, momentum tuning on iOS)
- [ ] Add match notifications (web push for kickoffs and goals)
- [ ] Add deeper player profiles (per-match logs, heat maps)
- [ ] Add offline fallback (cache last-known data in the service worker)
- [ ] Improve test coverage (merge logic, standings math, bracket progression)

## Screenshots

Screenshots will be added soon.

- Home
- Schedule
- Knockout Bracket
- Team Page
- Stats Page

## Contributing

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes with clear, focused commits (one task per commit)
3. Run `npm test` and `npm run lint`
4. Open a pull request against `main`

## License

MIT — see [LICENSE](LICENSE).

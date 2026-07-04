import { loadTournamentData } from "@/lib/db";
import type { LiveFixture } from "@/lib/data";
import type { ExternalLeaderStat } from "@/lib/stats";
import Tournament from "./tournament";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

type PageSearchParams = Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;

type InitialLiveData = {
  fixtures: LiveFixture[];
  leaderboardStats: ExternalLeaderStat[];
  ts: number;
  active: boolean;
};

async function loadInitialLiveData(): Promise<InitialLiveData | null> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    if (!host) return null;
    const proto = h.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    const res = await fetch(`${proto}://${host}/api/live?initial=1`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache, no-store, max-age=0" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      fixtures: Array.isArray(data.fixtures) ? data.fixtures : [],
      leaderboardStats: Array.isArray(data.leaderboardStats) ? data.leaderboardStats : [],
      ts: typeof data.ts === "number" ? data.ts : Date.now(),
      active: !!data.active,
    };
  } catch {
    return null;
  }
}

export default async function Home({ searchParams }: { searchParams?: PageSearchParams }) {
  const [{ data, source }, initialLiveData] = await Promise.all([
    loadTournamentData(),
    loadInitialLiveData(),
  ]);
  const params = searchParams ? await searchParams : {};
  const rawView = params.view;
  const initialView = Array.isArray(rawView) ? rawView[0] : rawView;
  if (source === "static" && process.env.NODE_ENV !== "production") {
    console.log("[wc2026] DATABASE_URL not configured — serving static schedule data");
  }
  return <Tournament data={data} initialView={initialView} initialLiveData={initialLiveData} />;
}

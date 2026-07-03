import { loadTournamentData } from "@/lib/db";
import Tournament from "./tournament";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

type PageSearchParams = Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;

export default async function Home({ searchParams }: { searchParams?: PageSearchParams }) {
  const { data, source } = await loadTournamentData();
  const params = searchParams ? await searchParams : {};
  const rawView = params.view;
  const initialView = Array.isArray(rawView) ? rawView[0] : rawView;
  if (source === "static" && process.env.NODE_ENV !== "production") {
    console.log("[wc2026] DATABASE_URL not configured — serving static schedule data");
  }
  return <Tournament data={data} initialView={initialView} />;
}

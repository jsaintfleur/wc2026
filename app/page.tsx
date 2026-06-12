import { loadTournamentData } from "@/lib/db";
import Tournament from "./tournament";

export default async function Home() {
  const { data, source } = await loadTournamentData();
  if (source === "static") {
    console.log("[wc2026] Supabase not configured — serving static schedule data");
  }
  return <Tournament data={data} />;
}

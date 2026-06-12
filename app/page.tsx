import { loadTournamentData } from "@/lib/db";
import Tournament from "./tournament";

export const revalidate = 60;

export default async function Home() {
  const { data, source } = await loadTournamentData();
  if (source === "static") {
    console.log("[wc2026] DATABASE_URL not configured — serving static schedule data");
  }
  return <Tournament data={data} />;
}

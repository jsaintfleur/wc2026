/* One-time venue-image fetcher — resolves each World Cup stadium's photo
 * from the Wikipedia REST summary API (keyless, no quota) and bakes the
 * Wikimedia CDN URL into the matching HOST_VENUE_DETAILS entry in
 * lib/data.ts (imageUrl field).
 *
 *   npx tsx scripts/fetch-venue-images.ts
 *
 * Wikimedia hosts these images on stable upload.wikimedia.org URLs and
 * permits hotlinking; the images carry free licenses via their article
 * pages. Idempotent: re-running overwrites the same imageUrl values.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = resolve(ROOT, "lib/data.ts");
const WIKI_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/";

/* venueId → English Wikipedia article title for the stadium */
const VENUE_ARTICLES: Record<string, string> = {
  AZT: "Estadio Azteca",
  AKR: "Estadio Akron",
  BBVA: "Estadio BBVA",
  BMO: "BMO Field",
  BCP: "BC Place",
  SOFI: "SoFi Stadium",
  LEVI: "Levi's Stadium",
  LUMEN: "Lumen Field",
  METLIFE: "MetLife Stadium",
  LINC: "Lincoln Financial Field",
  GILLETTE: "Gillette Stadium",
  HARDROCK: "Hard Rock Stadium",
  MBS: "Mercedes-Benz Stadium",
  ATT: "AT&T Stadium",
  NRG: "NRG Stadium",
  ARROW: "Arrowhead Stadium",
};

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

async function main(): Promise<void> {
  let source = readFileSync(DATA_FILE, "utf8");
  let updated = 0;

  for (const [venueId, article] of Object.entries(VENUE_ARTICLES)) {
    try {
      const res = await fetch(WIKI_SUMMARY + encodeURIComponent(article), {
        headers: { "User-Agent": "Compet2026/1.0 (World Cup tracker; venue images)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.warn(`  ${venueId}: HTTP ${res.status} for "${article}"`);
        continue;
      }
      const body = await res.json() as { thumbnail?: { source?: string }; originalimage?: { source?: string } };
      /* Thumbnail (~320px) suits the panel; prefer it over multi-MB originals */
      const image = body.thumbnail?.source || body.originalimage?.source;
      if (!image) {
        console.warn(`  ${venueId}: no image on "${article}"`);
        continue;
      }
      const linePattern = new RegExp(`(${venueId}: \\{ venueId: "${venueId}"[^\\n]*imageUrl: )(?:null|"[^"]*")`);
      if (!linePattern.test(source)) {
        console.warn(`  ${venueId}: data line not found in lib/data.ts`);
        continue;
      }
      source = source.replace(linePattern, `$1"${image}"`);
      updated++;
      console.log(`  ${venueId}: ${article} → ${image.slice(0, 90)}`);
    } catch (err) {
      console.warn(`  ${venueId}: failed — ${String(err)}`);
    }
    await sleep(250); // polite pacing for Wikimedia
  }

  writeFileSync(DATA_FILE, source);
  console.log(`\nUpdated ${updated}/${Object.keys(VENUE_ARTICLES).length} venue images in lib/data.ts`);
}

main().catch(err => { console.error(err); process.exit(1); });

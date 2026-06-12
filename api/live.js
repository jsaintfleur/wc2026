// Vercel Serverless Function — proxies API-Football, hides the key, caches at the edge.
// Free-tier friendly: only calls upstream during live match windows, caches hard,
// keeps a last-good copy in memory so it degrades to "latest known scores" instead of erroring.
const STARTS = [1781204400000, 1781229600000, 1781290800000, 1781312400000, 1781377200000, 1781388000000, 1781398800000, 1781409600000, 1781456400000, 1781467200000, 1781478000000, 1781488800000, 1781539200000, 1781550000000, 1781560800000, 1781571600000, 1781636400000, 1781647200000, 1781658000000, 1781668800000, 1781715600000, 1781726400000, 1781737200000, 1781748000000, 1781798400000, 1781809200000, 1781820000000, 1781830800000, 1781895600000, 1781906400000, 1781915400000, 1781928000000, 1781974800000, 1781985600000, 1782000000000, 1782014400000, 1782057600000, 1782068400000, 1782079200000, 1782090000000, 1782147600000, 1782162000000, 1782172800000, 1782183600000, 1782234000000, 1782244800000, 1782255600000, 1782266400000, 1782327600000, 1782338400000, 1782349200000, 1782417600000, 1782428400000, 1782439200000, 1782500400000, 1782518400000, 1782529200000, 1782594000000, 1782603000000, 1782612000000, 1782673200000, 1782752400000, 1782765000000, 1782781200000, 1782838800000, 1782853200000, 1782867600000, 1782921600000, 1782936000000, 1782950400000, 1783018800000, 1783033200000, 1783047600000, 1783101600000, 1783116000000, 1783128600000, 1783184400000, 1783198800000, 1783281600000, 1783296000000, 1783364400000, 1783382400000, 1783440000000, 1783454400000, 1783627200000, 1783710000000, 1783803600000, 1783818000000, 1784055600000, 1784142000000, 1784408400000, 1784487600000];                                   // match kickoff times (ms, UTC)
const LIVE_TTL = parseInt(process.env.LIVE_TTL || '420', 10);   // edge cache (s) during match windows
const IDLE_TTL = parseInt(process.env.IDLE_TTL || '1800', 10);  // edge cache (s) between matches
const LEAGUE   = process.env.WC_LEAGUE || '1';                  // API-Football: FIFA World Cup = 1
const SEASON   = process.env.WC_SEASON || '2026';
const PRE = 15 * 60000, POST = 155 * 60000;                  // window: 15m before .. 155m after kickoff

let LAST = null;        // last-good payload (survives within a warm instance)

function inWindow(now){ return STARTS.some(s => now >= s - PRE && now <= s + POST); }

async function fetchFixtures(key){
  const url = `https://v3.football.api-sports.io/fixtures?league=${LEAGUE}&season=${SEASON}`;
  const r = await fetch(url, { headers: { 'x-apisports-key': key } });
  const body = await r.json().catch(() => ({}));
  const quota = { limit: r.headers.get('x-ratelimit-requests-limit'),
                  remaining: r.headers.get('x-ratelimit-requests-remaining') };
  if (!r.ok) return { ok:false, http:r.status, errors:body.errors||null, quota };
  const fixtures = (body.response || []).map(f => ({
    ts: Date.parse(f.fixture.date),
    status: f.fixture.status && f.fixture.status.short,
    elapsed: f.fixture.status && f.fixture.status.elapsed,
    venue: f.fixture.venue && f.fixture.venue.name,
    round: f.league && f.league.round,
    home: f.teams && f.teams.home && f.teams.home.name,
    away: f.teams && f.teams.away && f.teams.away.name,
    gh: f.goals ? f.goals.home : null,
    ga: f.goals ? f.goals.away : null,
  }));
  return { ok:true, fixtures, quota };
}

export default async function handler(req, res){
  const key = process.env.APIFOOTBALL_KEY;
  const now = Date.now();
  const debug = 'debug' in (req.query || {});

  res.setHeader('Content-Type', 'application/json');
  if (req.method && req.method !== 'GET'){
    res.setHeader('Cache-Control','no-store');
    return res.status(405).json({ error:'method_not_allowed' });
  }
  if (!key){
    res.setHeader('Cache-Control','public, s-maxage=120');
    return res.status(200).json({ configured:false, active:inWindow(now), fixtures:[] });
  }

  const active = inWindow(now);

  // Diagnostic: forces one upstream call regardless of window, reports what came back.
  if (debug){
    const r = await fetchFixtures(key).catch(e => ({ ok:false, http:0, errors:String(e) }));
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({
      configured:true, debug:true, active, league:LEAGUE, season:SEASON,
      upstreamOk:r.ok, http:r.http||200, quota:r.quota||null,
      fixtureCount: r.ok ? r.fixtures.length : 0,
      errors: r.errors || null,
      sample: r.ok ? r.fixtures.slice(0,3) : null,
    });
  }

  if (!active){
    res.setHeader('Cache-Control', `public, s-maxage=${IDLE_TTL}, stale-while-revalidate=${IDLE_TTL*2}`);
    return res.status(200).json({ configured:true, active:false, ts:now,
                                  fixtures: LAST ? LAST.fixtures : [] });
  }

  try {
    const r = await fetchFixtures(key);
    if (!r.ok) throw new Error('upstream ' + r.http);
    LAST = { fixtures: r.fixtures, ts: now };
    res.setHeader('Cache-Control', `public, s-maxage=${LIVE_TTL}, stale-while-revalidate=${LIVE_TTL*2}`);
    return res.status(200).json({ configured:true, active:true, ts:now,
                                  fixtures:r.fixtures, quota:r.quota });
  } catch (e) {
    // Degrade: serve last-good if we have it, flagged stale; else empty + paused.
    res.setHeader('Cache-Control','public, s-maxage=120');
    return res.status(200).json({ configured:true, active:true, stale:true,
                                  ts: LAST ? LAST.ts : now,
                                  fixtures: LAST ? LAST.fixtures : [] });
  }
}

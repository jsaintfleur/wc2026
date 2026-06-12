"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { MOCK_FIXTURES, type TournamentData, type LiveFixture, type GroupStageMatch } from "@/lib/data";

const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const LIVE_STATUSES = new Set(["1H","2H","HT","ET","BT","P","LIVE","SUSP","INT"]);
const DONE_STATUSES = new Set(["FT","AET","PEN","PEN_LIVE","WO","AWD"]);

const TEAM_NORM: Record<string, string> = {
  turkey: "Türkiye", czechrepublic: "Czechia", czechia: "Czechia",
  korearepublic: "South Korea", southkorea: "South Korea",
  usa: "United States", unitedstates: "United States",
  cotedivoire: "Ivory Coast", ivorycoast: "Ivory Coast",
  congodr: "DR Congo", drcongo: "DR Congo", democraticrepublicofcongo: "DR Congo",
  caboverde: "Cape Verde", capeverdeislands: "Cape Verde", capeverde: "Cape Verde",
  bosniaandherzegovina: "Bosnia & Herzegovina", bosniaherzegovina: "Bosnia & Herzegovina",
  curacao: "Curaçao",
};

type ViewType = "schedule" | "groups" | "knockout" | "venues" | "about";
type LiveStatus = "init" | "off" | "idle" | "active" | "paused" | "nofix";

function nrm(s: string): string {
  return (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

function canon(n: string): string {
  return TEAM_NORM[nrm(n)] || n;
}

function parseISO(iso: string): Date {
  const [y, m, da] = iso.split("-").map(Number);
  return new Date(y, m - 1, da);
}

function todayISO(): string {
  const n = new Date();
  return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
}

function tomorrowISO(): string {
  const n = new Date();
  n.setDate(n.getDate() + 1);
  return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
}



function liveBadge(f: LiveFixture): string {
  if (LIVE_STATUSES.has(f.status)) return `<span class="lv">${f.status === "HT" ? "HT" : (f.elapsed ? f.elapsed + "'" : "LIVE")}</span>`;
  if (DONE_STATUSES.has(f.status)) return `<span class="ft">${f.status === "AET" ? "AET" : (f.status === "PEN" ? "PENS" : "FT")}</span>`;
  return "";
}

function goalsFor(m: { t1?: string; t2?: string }, f: LiveFixture) {
  const a = canon(f.home);
  const homeIsT1 = a === m.t1;
  if (!homeIsT1 && canon(f.away) !== m.t1) return { t1: f.gh, t2: f.ga, homeIsT1: true };
  return { t1: homeIsT1 ? f.gh : f.ga, t2: homeIsT1 ? f.ga : f.gh, homeIsT1 };
}

function human(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  return h + "h " + (m % 60) + "m";
}

function esc(s: string | number): string {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c));
}

function isMock(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.search.indexOf("mock") > -1;
}

export default function Tournament({ data }: { data: TournamentData }) {
  const fl = (t: string) => data.flags[t] || "⚽";
  const ven = (k: string) => data.venues[k] || { common: "", fifa: "", city: "", country: "", cap: 0 };
  const vName = (k: string) => (data.venues[k] || { common: "" }).common || "";
  const allTeams = [...new Set(Object.values(data.groups).flat())].sort();

  function nextStart(): number | null {
    const n = Date.now();
    let nx: number | null = null;
    for (const s of data.starts) {
      if (s > n - 90 * 60000) { if (nx === null || s < nx) nx = s; }
    }
    return nx;
  }

  function findLive(m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]): LiveFixture | null {
    if (!fx.length) return null;
    let best: LiveFixture | null = null;
    let bd = 75 * 60000;
    const vn = nrm(vName((m as GroupStageMatch).v || ""));
    for (const f of fx) {
      const dt = Math.abs((f.ts || 0) - (m.ts || 0));
      if (dt > 75 * 60000) continue;
      const fv = nrm(f.venue);
      const venOK = vn && fv && (fv === vn || fv.indexOf(vn) > -1 || vn.indexOf(fv) > -1);
      let teamOK = false;
      if (m.t1 && m.t2) {
        const a = canon(f.home), b = canon(f.away);
        teamOK = (a === m.t1 && b === m.t2) || (a === m.t2 && b === m.t1);
      }
      if ((venOK || teamOK) && dt < bd) { bd = dt; best = f; }
    }
    return best;
  }

  const [view, setView] = useState<ViewType>("schedule");
  const [group, setGroup] = useState("ALL");
  const [team, setTeam] = useState("ALL");
  const [query, setQuery] = useState("");
  const [fixtures, setFixtures] = useState<LiveFixture[]>([]);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("init");
  const [liveTs, setLiveTs] = useState(0);
  const [, setLiveStale] = useState(false);
  const [animate, setAnimate] = useState(true);
  const [tick, setTick] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollLive = useCallback(async () => {
    if (isMock()) {
      setFixtures(MOCK_FIXTURES as LiveFixture[]);
      setLiveStatus("active");
      setLiveTs(Date.now());
      return;
    }
    try {
      const r = await fetch("/api/live", { cache: "no-store" });
      if (!r.ok) throw new Error("fetch failed");
      const j = await r.json();
      if (j.configured === false) {
        setLiveStatus("off");
        setFixtures([]);
        return;
      }
      setFixtures(Array.isArray(j.fixtures) ? j.fixtures : []);
      setLiveTs(j.ts || Date.now());
      setLiveStale(!!j.stale);
      if (j.stale) setLiveStatus("paused");
      else if (j.active && (!j.fixtures || j.fixtures.length === 0)) setLiveStatus("nofix");
      else if (j.active) setLiveStatus("active");
      else setLiveStatus("idle");
    } catch {
      setLiveStatus(prev => prev === "init" ? "off" : "paused");
    }
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (isMock()) return;
    const ms = liveStatus === "active" ? 45000 : 180000;
    timerRef.current = setInterval(() => { pollLive(); }, ms);
  }, [liveStatus, pollLive]);

  useEffect(() => {
    pollLive().then(schedule);
    const onVis = () => {
      if (document.hidden) {
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        pollLive().then(schedule);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const refreshTimer = setInterval(() => {
      if (!document.hidden) setTick(t => t + 1);
    }, 60000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (timerRef.current) clearInterval(timerRef.current);
      clearInterval(refreshTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    schedule();
  }, [liveStatus, schedule]);

  const today = todayISO();
  const tomorrow = tomorrowISO();

  function agoStr(): string {
    if (!liveTs) return "";
    const s = Math.max(0, Math.round((Date.now() - liveTs) / 60000));
    return s < 1 ? "just now" : s + "m ago";
  }

  function matchHit(m: GroupStageMatch): boolean {
    if (group !== "ALL" && m.g !== group) return false;
    if (team !== "ALL" && m.t1 !== team && m.t2 !== team) return false;
    if (query) {
      const v = ven(m.v);
      const hay = (m.t1 + " " + m.t2 + " " + v.common + " " + v.fifa + " " + v.city + " " + v.country + " " + m.g).toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    return true;
  }

  function standings(g: string) {
    const teams = data.groups[g];
    const T: Record<string, { t: string; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number }> = {};
    teams.forEach(t => T[t] = { t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
    let played = 0;
    for (const m of data.gs) {
      if (m.g !== g) continue;
      const f = findLive(m, fixtures);
      if (!f || !DONE_STATUSES.has(f.status)) continue;
      const gg = goalsFor(m, f);
      if (gg.t1 == null || gg.t2 == null) continue;
      const A = T[m.t1], Bx = T[m.t2];
      if (!A || !Bx) continue;
      A.p++; Bx.p++; A.gf += gg.t1; A.ga += gg.t2; Bx.gf += gg.t2; Bx.ga += gg.t1; played++;
      if (gg.t1 > gg.t2) { A.w++; A.pts += 3; Bx.l++; }
      else if (gg.t1 < gg.t2) { Bx.w++; Bx.pts += 3; A.l++; }
      else { A.d++; Bx.d++; A.pts++; Bx.pts++; }
    }
    const rows = teams.map(t => T[t]).sort((a, b) =>
      b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.t.localeCompare(b.t));
    return { rows, played };
  }

  function liveChipHtml(): string {
    void tick;
    const s = liveStatus;
    if (s === "off") return `<div class="livebar off" role="status">Live scores are ready — add your API-Football key on the server (see the README) to switch them on. The confirmed schedule is shown below.</div>`;
    if (s === "paused") return `<div class="livebar paused" role="status"><span class="dotlive" style="background:#b58900"></span><b>Live updates paused</b> — free daily limit or a hiccup. Showing the latest known scores${liveTs ? ` (as of ${agoStr()})` : ""}.</div>`;
    if (s === "nofix") return `<div class="livebar nofix" role="status"><b>Connected, but no World Cup fixtures returned.</b> The league or season may need adjusting — open <code>/api/live?debug=1</code> and see the README.</div>`;
    const n = fixtures.filter(f => LIVE_STATUSES.has(f.status)).length;
    if (s === "active" && n) return `<div class="livebar on" role="status" aria-live="polite"><span class="dotlive"></span>Live now — ${n} match${n > 1 ? "es" : ""} in play · updated ${agoStr()}</div>`;
    const nx = nextStart();
    const when = nx ? (nx - Date.now() <= 0 ? "kicking off now" : `in ${human(nx - Date.now())}`) : "after the tournament";
    if (s === "active" || s === "idle") return `<div class="livebar idle" role="status">Connected · scores &amp; tables update during matches · next match ${when}</div>`;
    return `<div class="livebar idle" role="status">Loading live data…</div>`;
  }

  function teamRow(t: string, goal: string, lead: boolean): string {
    const host = data.hosts.includes(t) ? '<span class="host">HOST</span>' : "";
    return `<div class="team${lead ? " lead" : ""}"><span class="fl">${fl(t)}</span><span class="nm">${esc(t)}</span>${host}${goal}</div>`;
  }

  function tixCard(m: GroupStageMatch, anim: boolean): string {
    const v = ven(m.v), gc = data.gcolor[m.g];
    const f = findLive(m, fixtures);
    let timeHtml: string, g1 = "", g2 = "", cls = "";
    let lead1 = false, lead2 = false;
    if (f && (LIVE_STATUSES.has(f.status) || DONE_STATUSES.has(f.status))) {
      const gg = goalsFor(m, f);
      const a = gg.t1 == null ? 0 : gg.t1, b = gg.t2 == null ? 0 : gg.t2;
      g1 = `<span class="gl">${a}</span>`;
      g2 = `<span class="gl">${b}</span>`;
      lead1 = a > b; lead2 = b > a;
      if (LIVE_STATUSES.has(f.status)) cls = " islive";
      timeHtml = `<div class="sc">${a}–${b}</div>${liveBadge(f)}`;
    } else {
      timeHtml = `<div class="lo">${esc(m.local)}</div>${m.local !== m.et ? `<div class="et">${esc(m.et)}</div>` : ""}`;
    }
    return `<article class="tix${cls}${anim ? " rise" : ""}" style="--gc:${gc}">
      <span class="tix__tab"></span>
      <div class="tix__main">
        <div class="tix__teams">${teamRow(m.t1, g1, lead1)}<div class="vs">vs</div>${teamRow(m.t2, g2, lead2)}</div>
        <div class="tix__time">${timeHtml}</div>
      </div>
      <div class="tix__foot"><span class="gbadge">${m.g}</span>
        <span class="ven">${esc(v.common)}</span><span class="cty">· ${esc(v.city)}, ${esc(v.country)}</span>
        <span class="mno">#${m.no}</span></div>
    </article>`;
  }

  function renderSchedule(anim: boolean): string {
    const list = data.gs.filter(matchHit);
    const head = liveChipHtml();
    if (!list.length) return head + `<div class="empty">No matches match your filters.<br>Try clearing the search or picking “All”.</div>`;
    let html = head, cur = "";
    for (const m of list) {
      if (m.iso !== cur) {
        cur = m.iso;
        let pill = m.iso === today
          ? '<span class="today-pill">Today</span>'
          : m.iso === tomorrow
            ? '<span class="today-pill" style="background:#cfe3d9;color:#0A5C3E">Tomorrow</span>'
            : "";
        const t = parseISO(m.iso);
        html += `<div class="dayhead"><span class="dow">${DOW[t.getDay()]}</span><h3>${t.getDate()} ${MON[t.getMonth()]}</h3>${pill}</div>`;
      }
      html += tixCard(m, anim);
    }
    return html;
  }

  function renderGroups(anim: boolean): string {
    let html = `<div class="gwrap">${liveChipHtml()}
      <div class="qkey"><span><i style="background:#1F8A6B"></i>Top 2 advance</span>
      <span><i style="background:#E5B53A"></i>3rd — best 8 advance</span></div>`;
    for (const [g, teams] of Object.entries(data.groups)) {
      const { rows, played } = standings(g);
      const body = rows.map((r, i) => {
        const cls = i < 2 ? "adv" : (i === 2 ? "cont" : "");
        const host = data.hosts.includes(r.t) ? '<span class="host">H</span>' : "";
        const gd = r.gf - r.ga;
        const gds = (gd > 0 ? "+" : "") + gd;
        return `<tr class="${cls}"><td class="pos l">${i + 1}</td>
          <td class="l"><span class="tm"><span class="fl">${fl(r.t)}</span><span class="nm">${esc(r.t)}</span>${host}</span></td>
          <td>${r.p}</td><td>${played ? gds : "–"}</td><td class="pts">${r.pts}</td></tr>`;
      }).join("");
      html += `<div class="gcard${anim ? " rise" : ""}" style="--gc:${data.gcolor[g]}">
        <div class="gcard__h">Group ${g}<span class="pl">${played ? played + " played" : "not started"}</span></div>
        <table class="tbl"><thead><tr><th class="l"></th><th class="l">Team</th><th>P</th><th>GD</th><th>Pts</th></tr></thead>
        <tbody>${body}</tbody></table></div>`;
    }
    html += `<p class="qnote">Tables update from full-time scores as they come in. Order uses points, then goal difference, then goals scored — FIFA’s official tiebreakers (including head-to-head and fair-play) decide the final standings.</p></div>`;
    return html;
  }

  function renderKnockout(anim: boolean): string {
    let html = '<div class="section" style="padding-top:4px">' + liveChipHtml();
    let cur = "";
    for (const k of data.ko) {
      if (k.round !== cur) { cur = k.round; html += `<div class="kohead">${esc(k.round)}<span class="mr">Matches ${esc(k.mr)}</span></div>`; }
      const v = ven(k.v), t = parseISO(k.iso);
      const f = findLive(k as unknown as { ts: number; v: string; t1?: string; t2?: string }, fixtures);
      let top: string, cls = "";
      if (f && f.home && f.away && f.status && f.status !== "TBD") {
        const a = canon(f.home), b = canon(f.away);
        const live = LIVE_STATUSES.has(f.status) || DONE_STATUSES.has(f.status);
        if (LIVE_STATUSES.has(f.status)) cls = " islive";
        const right = live
          ? `<div class="kotix__time"><div class="sc">${f.gh ?? 0}–${f.ga ?? 0}</div>${liveBadge(f)}</div>`
          : `<div class="kotix__time"><div class="lo">${esc(k.local)}</div>${k.local !== k.et ? `<div class="et">${esc(k.et)}</div>` : ""}</div>`;
        top = `<div class="kotix__top"><div class="koteams">
          <div class="team"><span class="fl">${fl(a)}</span><span class="nm">${esc(a)}</span></div>
          <div class="vs">vs</div>
          <div class="team"><span class="fl">${fl(b)}</span><span class="nm">${esc(b)}</span></div></div>${right}</div>`;
      } else {
        top = `<div class="kotix__top"><div class="pend">Pending FIFA Confirmation<span class="dot">vs</span>Pending FIFA Confirmation</div></div>`;
      }
      html += `<article class="kotix${cls}${anim ? " rise" : ""}">${top}
        <div class="kotix__foot"><span>📍</span><span class="ven">${esc(v.common)}</span>· ${esc(v.city)}, ${esc(v.country)}
        <span class="dt">${DOW[t.getDay()]} ${t.getDate()} ${MON[t.getMonth()]} · ${esc(k.local)}${k.local !== k.et ? ` (${esc(k.et)})` : ""}</span></div></article>`;
    }
    html += `<p style="font-size:12.5px;color:var(--muted);margin:14px 2px 0">Dates, times and venues are confirmed. Teams fill in automatically as results come in; until then they read “Pending FIFA Confirmation.” Round-of-32 pairings follow FIFA’s pre-set bracket.</p></div>`;
    return html;
  }

  function renderVenues(anim: boolean): string {
    const order = Object.entries(data.venues).sort((a, b) => b[1].cap - a[1].cap);
    return order.map(([, v]) => {
      const flag = v.country === "USA" ? "🇺🇸" : v.country === "Mexico" ? "🇲🇽" : "🇨🇦";
      return `<div class="vcard${anim ? " rise" : ""}"><div class="vcard__cap"><b>${(v.cap / 1000).toFixed(v.cap % 1000 ? 1 : 0)}k</b><span>Seats</span></div>
        <div class="vcard__b"><h4>${esc(v.common)}</h4><div class="meta">${esc(v.city)}, ${esc(v.country)}</div>
        <div class="fifa">Tournament name: ${esc(v.fifa)}</div></div><span class="flag-c">${flag}</span></div>`;
    }).join("");
  }

  function renderAbout(): string {
    return `<div class="about">
      <h3>About this app</h3>
      <p>A mobile companion to the 2026 World Cup across Canada, Mexico and the United States. The schedule, venues and groups are fixed; <b>scores and group tables update live during matches</b> via API-Football. Filter the schedule by group, team, or search; a <span class="today-pill">Today</span> tag marks the current matchday.</p>
      <h3>Live data &amp; limits</h3>
      <p>Scores come from API-Football’s free tier, so updates run on a short delay and the app only polls while matches are in play, to stay within the daily limit. If the limit is reached it shows the latest known scores and a <b>paused</b> note rather than breaking. Data is unofficial; FIFA is the source of record.</p>
      <h3>Knockout teams</h3>
      <p>Knockout dates, times and venues are confirmed; teams read <span class="legend">Pending FIFA Confirmation</span> and fill in automatically as the bracket is decided.</p>
      <h3>How the schedule was validated</h3>
      <p>Compiled 11 June 2026 and cross-checked against FIFA, FOX Sports, NBC Sports, ESPN, Al Jazeera, FourFourTwo and Wikipedia.</p>
      <div class="callout"><b>Two source errors caught &amp; corrected</b>
        <div class="fix"><span class="ic">1</span><div><b>Belgium v Egypt</b> (15 Jun) is at Lumen Field, <b>Seattle</b> — one source had Vancouver.</div></div>
        <div class="fix"><span class="ic">2</span><div><b>Australia v Türkiye</b> (13 Jun) kicks off <b>9:00 PM PT / 12:00 AM ET</b>, corrected from a mislisted 6:00 PM PT.</div></div></div>
      <h3>Times</h3>
      <p>Each match shows local kick-off and U.S. Eastern (ET). <b>HOST</b> marks Canada, Mexico and the United States.</p>
    </div>`;
  }

  const viewContent = useMemo(() => {
    if (view === "schedule") return renderSchedule(animate);
    if (view === "groups") return renderGroups(animate);
    if (view === "knockout") return renderKnockout(animate);
    if (view === "venues") return renderVenues(animate);
    return renderAbout();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, group, team, query, fixtures, liveStatus, liveTs, animate, tick]);

  function handleTab(v: ViewType) {
    setAnimate(true);
    setView(v);
    window.scrollTo({ top: 0 });
  }

  const tabs: { key: ViewType; label: string }[] = [
    { key: "schedule", label: "Schedule" },
    { key: "groups", label: "Groups & tables" },
    { key: "knockout", label: "Knockout" },
    { key: "venues", label: "Venues" },
    { key: "about", label: "About" },
  ];

  return (
    <div className="wrap">
      <header className="bar">
        <div className="bar__mark">FIFA <b>WORLD CUP</b> 26</div>
        <div className="bar__hosts" aria-label="Hosts: Canada, Mexico, United States">{"🇨🇦 🇲🇽 🇺🇸"}</div>
      </header>

      <section className="hero">
        <div className="hero__eyebrow">Canada &middot; Mexico &middot; United States</div>
        <h1 className="hero__title">LIVE<br />SCHEDULE</h1>
        <div className="hero__sub">11 June &ndash; 19 July 2026 &middot; scores &amp; tables update during matches</div>
        <div className="hero__stats">
          <div className="stat"><b>48</b><span>Teams</span></div>
          <div className="stat"><b>104</b><span>Matches</span></div>
          <div className="stat"><b>16</b><span>Venues</span></div>
          <div className="stat"><b>3</b><span>Nations</span></div>
        </div>
      </section>

      <nav className="tabs" role="tablist" aria-label="Views">
        {tabs.map(t => (
          <button
            key={t.key}
            className="tab"
            role="tab"
            aria-selected={view === t.key}
            onClick={() => handleTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {view === "schedule" && (
        <div className="filters">
          <input
            className="search"
            type="search"
            inputMode="search"
            placeholder="Search team, city or stadium"
            value={query}
            onChange={e => { setAnimate(false); setQuery(e.target.value); }}
            aria-label="Search"
          />
          <div className="row2">
            <select
              className="sel"
              value={team}
              onChange={e => { setAnimate(false); setTeam(e.target.value); }}
              aria-label="Filter by team"
            >
              <option value="ALL">All teams</option>
              {allTeams.map(t => (
                <option key={t} value={t}>{fl(t)} {t}</option>
              ))}
            </select>
          </div>
          <div className="chips" role="group" aria-label="Filter by group">
            <button
              className="chip chip--all"
              aria-pressed={group === "ALL"}
              onClick={() => { setAnimate(true); setGroup("ALL"); }}
            >
              All
            </button>
            {Object.keys(data.groups).map(g => (
              <button
                key={g}
                className="chip"
                aria-pressed={group === g}
                style={group === g ? { background: data.gcolor[g] } : undefined}
                onClick={() => { setAnimate(true); setGroup(g); }}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      )}

      <main
        className={view !== "groups" && view !== "knockout" ? "section" : undefined}
        dangerouslySetInnerHTML={{ __html: viewContent }}
      />

      <div className="foot">
        Schedule cross-checked 11 Jun 2026 &middot; live scores via API-Football (unofficial) &middot; knockout teams fill in as results come in
      </div>
    </div>
  );
}

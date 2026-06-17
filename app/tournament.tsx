"use client";

import { useEffect, useRef, useState, useCallback, useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { MOCK_FIXTURES, type TournamentData, type LiveFixture, type GroupStageMatch, type KnockoutMatch, type MatchEvent, type TeamLineup } from "@/lib/data";
import { nrm, canon } from "@/lib/merge";
import { TEAM_PROFILES, type PlayerInfo } from "@/lib/teams";
import BracketBuilder from "@/app/components/BracketBuilder";
import TriondaBall from "@/app/components/TriondaBall";
import WorldCupTrophy from "@/app/components/WorldCupTrophy";

const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const LIVE_STATUSES = new Set(["1H","2H","HT","ET","BT","P","LIVE","SUSP","INT"]);
const DONE_STATUSES = new Set(["FT","AET","PEN","PEN_LIVE","WO","AWD"]);

// 4 hours: even with ET + penalties + delays, a match can't be live after this
const STALE_LIVE_THRESHOLD = 4 * 60 * 60 * 1000;

function isStaleStatus(ts: number, status: string, now = Date.now()): boolean {
  if (!LIVE_STATUSES.has(status)) return false;
  return now - ts > STALE_LIVE_THRESHOLD;
}

type ViewType = "schedule" | "groups" | "knockout" | "bracket" | "stats" | "venues" | "about";
type LiveStatus = "init" | "off" | "idle" | "active" | "paused" | "nofix";

function parseISO(iso: string): Date {
  const [y, m, da] = iso.split("-").map(Number);
  return new Date(y, m - 1, da);
}

function todayISO(): string {
  const n = new Date();
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
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return totalSec + "s";
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return m + "m " + String(s).padStart(2, "0") + "s";
  const h = Math.floor(m / 60);
  return h + "h " + String(m % 60).padStart(2, "0") + "m " + String(s).padStart(2, "0") + "s";
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
  const [liveEnrichmentIssue, setLiveEnrichmentIssue] = useState("");
  const [animate, setAnimate] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [teamDrawer, setTeamDrawer] = useState<string | null>(null);
  const [matchDetail, setMatchDetail] = useState<{ match: GroupStageMatch; fixture: LiveFixture | null } | null>(null);
  const [playerProfile, setPlayerProfile] = useState<{ name: string; team: string } | null>(null);
  const [goalToast, setGoalToast] = useState<{ team: string; player: string; minute: string; score: string; flag: string } | null>(null);
  const [toastExiting, setToastExiting] = useState(false);
  const prevScoresRef = useRef<Map<string, string>>(new Map());
  const scrolledRef = useRef(false);
  const mainRef = useRef<HTMLElement>(null);

  /* PWA install prompt — captured from beforeinstallprompt event */
  const deferredPromptRef = useRef<any>(null);
  const [showInstall, setShowInstall] = useState(false);

  const pollLive = useCallback(async () => {
    if (isMock()) {
      setFixtures(MOCK_FIXTURES as LiveFixture[]);
      setLiveStatus("active");
      setLiveTs(Date.now());
      setLiveEnrichmentIssue("");
      return;
    }
    try {
      const r = await fetch("/api/live", { cache: "no-store" });
      if (!r.ok) throw new Error("fetch failed");
      const j = await r.json();
      if (j.configured === false) {
        setLiveStatus("off");
        setFixtures(Array.isArray(j.fixtures) ? j.fixtures : []);
        setLiveEnrichmentIssue(j.active ? "Live enrichment is not configured" : "");
        return;
      }
      setFixtures(Array.isArray(j.fixtures) ? j.fixtures : []);
      setLiveTs(j.ts || Date.now());
      setLiveStale(!!j.stale);
      const enrichmentUnhealthy = !!(j.enrichment?.required && !j.enrichment?.healthy);
      setLiveEnrichmentIssue(enrichmentUnhealthy ? "Live enrichment needs attention" : "");
      if (j.stale || enrichmentUnhealthy) setLiveStatus("paused");
      else if (j.active && (!j.fixtures || j.fixtures.length === 0)) setLiveStatus("nofix");
      else if (j.active) setLiveStatus("active");
      else setLiveStatus("idle");
    } catch {
      setLiveEnrichmentIssue("Live enrichment fetch failed");
      setLiveStatus(prev => prev === "init" ? "off" : "paused");
    }
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (isMock()) return;
    const ms = liveStatus === "active" ? 30000 : 180000;
    timerRef.current = setInterval(() => { pollLive(); }, ms);
  }, [liveStatus, pollLive]);

  useEffect(() => {
    queueMicrotask(() => {
      setNowMs(Date.now());
      pollLive().then(schedule);
    });
    const onVis = () => {
      if (document.hidden) {
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setNowMs(Date.now());
        pollLive().then(schedule);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const refreshTimer = setInterval(() => {
      if (!document.hidden) setNowMs(Date.now());
    }, 60000);
    const countdownTimer = setInterval(() => {
      if (document.hidden) return;
      document.querySelectorAll<HTMLSpanElement>(".countdown[data-target]").forEach(el => {
        const target = Number(el.dataset.target);
        const diff = target - Date.now();
        el.textContent = diff <= 0 ? "kicking off now" : human(diff);
      });
    }, 1000);
    /* PWA: capture the install prompt so we can trigger it from the UI */
    const onBip = (e: Event) => { e.preventDefault(); deferredPromptRef.current = e; setShowInstall(true); };
    window.addEventListener("beforeinstallprompt", onBip);
    /* Hide install banner if the app is already installed */
    if (window.matchMedia("(display-mode: standalone)").matches) setShowInstall(false);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeinstallprompt", onBip);
      if (timerRef.current) clearInterval(timerRef.current);
      clearInterval(refreshTimer);
      clearInterval(countdownTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    schedule();
  }, [liveStatus, schedule]);

  useEffect(() => {
    if (scrolledRef.current || view !== "schedule") return;
    requestAnimationFrame(() => {
      const anchor = document.getElementById("next-match-anchor");
      if (anchor) {
        anchor.scrollIntoView({ behavior: "smooth", block: "start" });
        scrolledRef.current = true;
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Detect goal changes and show toast notification
  useEffect(() => {
    if (fixtures.length === 0) return;
    const prev = prevScoresRef.current;
    const next = new Map<string, string>();
    for (const f of fixtures) {
      if (!LIVE_STATUSES.has(f.status) && !DONE_STATUSES.has(f.status)) continue;
      if (f.gh == null || f.ga == null) continue;
      const key = canon(f.home) + ":" + canon(f.away);
      next.set(key, `${f.gh}-${f.ga}`);
      const old = prev.get(key);
      if (old && old !== `${f.gh}-${f.ga}` && LIVE_STATUSES.has(f.status)) {
        const [oldH, oldA] = old.split("-").map(Number);
        const scoringTeam = f.gh > oldH ? f.home : f.away;
        const lastEvent = (f.events || []).filter((e: MatchEvent) => e.type === "Goal").pop();
        const flag = data.flags[scoringTeam] || "⚽";
        setGoalToast({
          team: scoringTeam,
          player: lastEvent?.player || "GOAL",
          minute: lastEvent ? `${lastEvent.minute}'` : `${f.elapsed || ""}'`,
          score: `${f.home} ${f.gh} – ${f.ga} ${f.away}`,
          flag,
        });
        setToastExiting(false);
        setTimeout(() => setToastExiting(true), 3500);
        setTimeout(() => setGoalToast(null), 3900);
      }
    }
    prevScoresRef.current = next;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtures]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const teamEl = (e.target as HTMLElement).closest("[data-team]") as HTMLElement | null;
      if (teamEl) {
        e.preventDefault();
        setTeamDrawer(teamEl.dataset.team || null);
        return;
      }
      const matchEl = (e.target as HTMLElement).closest("[data-match-id]") as HTMLElement | null;
      if (matchEl && !(e.target as HTMLElement).closest("[data-team]")) {
        const matchNo = parseInt(matchEl.dataset.matchId || "0", 10);
        const m = data.gs.find(g => g.no === matchNo);
        if (m) {
          const f = findLive(m, fixtures);
          setMatchDetail({ match: m, fixture: f });
        }
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [fixtures, data.gs]);

  const today = todayISO();

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
      const hasKickedOff = m.ts <= nowMs + 5 * 60000;
      let t1g: number | null = null, t2g: number | null = null;
      if (hasKickedOff && f && DONE_STATUSES.has(f.status)) {
        const gg = goalsFor(m, f);
        t1g = gg.t1; t2g = gg.t2;
      } else if (hasKickedOff && m.dbStatus && DONE_STATUSES.has(m.dbStatus) && m.dbGh != null && m.dbGa != null) {
        t1g = m.dbGh; t2g = m.dbGa;
      }
      if (t1g == null || t2g == null) continue;
      const A = T[m.t1], Bx = T[m.t2];
      if (!A || !Bx) continue;
      A.p++; Bx.p++; A.gf += t1g; A.ga += t2g; Bx.gf += t2g; Bx.ga += t1g; played++;
      if (t1g > t2g) { A.w++; A.pts += 3; Bx.l++; }
      else if (t1g < t2g) { Bx.w++; Bx.pts += 3; A.l++; }
      else { A.d++; Bx.d++; A.pts++; Bx.pts++; }
    }
    const rows = teams.map(t => T[t]).sort((a, b) =>
      b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.t.localeCompare(b.t));
    return { rows, played };
  }

  function formatGD(gd: number, matchesPlayed: number): string {
    if (matchesPlayed === 0 || gd === 0) return "0";
    return gd > 0 ? `+${gd}` : String(gd);
  }

  function liveIndicatorHtml(): string {
    const n = fixtures.filter(f => LIVE_STATUSES.has(f.status)).length;
    if (liveEnrichmentIssue) return `<div class="livebar paused" role="status"><span class="dotlive" style="background:#b58900"></span>${esc(liveEnrichmentIssue)}</div>`;
    if (n > 0) return `<div class="livebar on" role="status" aria-live="polite"><span class="dotlive"></span>${n} match${n > 1 ? "es" : ""} in play</div>`;
    if (liveStatus === "paused") return `<div class="livebar paused" role="status"><span class="dotlive" style="background:#b58900"></span>Showing latest scores</div>`;
    return "";
  }

  function teamRow(t: string, goal: string, lead: boolean): string {
    const host = data.hosts.includes(t) ? '<span class="host">HOST</span>' : "";
    return `<div class="team${lead ? " lead" : ""}"><span class="fl">${fl(t)}</span><a class="nm teamlink" data-team="${esc(t)}" href="#">${esc(t)}</a>${host}${goal}</div>`;
  }

  function goalScorers(events: MatchEvent[] | undefined, teamName: string): string {
    if (!events) return "";
    // Normal goals belong to the scorer's team; own goals belong to the opposing team
    const goals = events.filter(e => {
      if (e.type !== "Goal") return false;
      const isOG = e.detail === "Own Goal";
      const sameTeam = canon(e.team) === canon(teamName);
      return isOG ? !sameTeam : sameTeam;
    });
    if (!goals.length) return "";
    const names = goals.map(g => {
      const surname = g.player.split(" ").pop() || g.player;
      const min = g.extra ? `${g.minute}+${g.extra}'` : `${g.minute}'`;
      const pen = g.detail === "Penalty" ? " (P)" : g.detail === "Own Goal" ? " (OG)" : "";
      return `${esc(surname)} ${min}${pen}`;
    });
    return `<div class="scorers">${names.join(", ")}</div>`;
  }

  function tixCard(m: GroupStageMatch, anim: boolean, dimmed = false): string {
    const v = ven(m.v), gc = data.gcolor[m.g];
    const f = findLive(m, fixtures);
    const hasKickedOff = m.ts <= nowMs + 5 * 60000;
    const fStale = f && isStaleStatus(m.ts, f.status, nowMs);
    const fLive = f && LIVE_STATUSES.has(f.status) && !fStale;
    const fDone = f && DONE_STATUSES.has(f.status);
    let timeHtml: string, g1 = "", g2 = "", cls = dimmed ? " tix--done" : "", scorers1 = "", scorers2 = "";
    let lead1 = false, lead2 = false;
    if (fStale) {
      timeHtml = `<div class="lo tix__updating">Updating...</div>`;
    } else if (fLive || (hasKickedOff && fDone)) {
      const gg = goalsFor(m, f!);
      const a = gg.t1 == null ? 0 : gg.t1, b = gg.t2 == null ? 0 : gg.t2;
      g1 = `<span class="gl">${a}</span>`;
      g2 = `<span class="gl">${b}</span>`;
      lead1 = a > b; lead2 = b > a;
      if (fLive) cls += " islive";
      timeHtml = `<div class="sc">${a}–${b}</div>${liveBadge(f!)}`;
      scorers1 = goalScorers(f!.events, m.t1);
      scorers2 = goalScorers(f!.events, m.t2);
    } else if (hasKickedOff && m.dbStatus && !isStaleStatus(m.ts, m.dbStatus, nowMs) && (LIVE_STATUSES.has(m.dbStatus) || DONE_STATUSES.has(m.dbStatus)) && m.dbGh != null && m.dbGa != null) {
      const a = m.dbGh, b = m.dbGa;
      g1 = `<span class="gl">${a}</span>`;
      g2 = `<span class="gl">${b}</span>`;
      lead1 = a > b; lead2 = b > a;
      const badge = DONE_STATUSES.has(m.dbStatus) ? `<span class="ft">FT</span>` : `<span class="ft live">${m.dbStatus}</span>`;
      timeHtml = `<div class="sc">${a}–${b}</div>${badge}`;
    } else {
      timeHtml = `<div class="lo">${esc(m.et)}</div>${m.local !== m.et ? `<div class="et">${esc(m.local)}</div>` : ""}`;
    }
    return `<article class="tix${cls}${anim ? " stagger-rise" : ""} tix--clickable" style="--gc:${gc}" data-match-id="${m.no}">
      <span class="tix__tab"></span>
      <div class="tix__main">
        <div class="tix__teams">${teamRow(m.t1, g1, lead1)}${scorers1}<div class="vs">vs</div>${teamRow(m.t2, g2, lead2)}${scorers2}</div>
        <div class="tix__time">${timeHtml}</div>
      </div>
      <div class="tix__foot"><span class="gbadge">${m.g}</span>
        <span class="ven">${esc(v.common)}</span><span class="cty">· ${esc(v.city)}, ${esc(v.country)}</span>
        <span class="mno">#${m.no}</span></div>
    </article>`;
  }

  function renderSchedule(anim: boolean): string {
    const now = nowMs;
    const list = data.gs.filter(matchHit);
    if (!list.length) return `<div class="empty">No matches match your filters.<br>Try clearing the search or picking "All".</div>`;

    /* Group matches by ISO date, preserving chronological order */
    const byDate = new Map<string, GroupStageMatch[]>();
    for (const m of list) {
      if (!byDate.has(m.iso)) byDate.set(m.iso, []);
      byDate.get(m.iso)!.push(m);
    }
    const sortedDates = [...byDate.keys()].sort();

    /* Find live matches for the pinned banner */
    const liveMatches: GroupStageMatch[] = [];
    for (const m of list) {
      const f = findLive(m, fixtures);
      const stale = (f && isStaleStatus(m.ts, f.status, now)) || (!f && m.dbStatus && isStaleStatus(m.ts, m.dbStatus, now));
      if (!stale && f && LIVE_STATUSES.has(f.status)) liveMatches.push(m);
    }

    let html = "";

    /* Live banner pinned at top when matches are in progress */
    if (liveMatches.length) {
      html += `<div class="mc-sec" id="mc-live"><div class="mc-hd mc-hd--live"><span class="mc-dot"></span>Live Now</div>`;
      for (const m of liveMatches) html += tixCard(m, anim);
      html += `</div>`;
    }

    /* Chronological timeline — every date gets a section, auto-scroll anchor on the first upcoming date */
    let anchorPlaced = false;
    for (const iso of sortedDates) {
      const matches = byDate.get(iso)!;
      const dt = parseISO(iso);
      const dateLabel = `${DOW[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}`;

      /* Determine if this day is fully in the past, current, or future */
      const allDone = matches.every(m => {
        const f = findLive(m, fixtures);
        const stale = (f && isStaleStatus(m.ts, f.status, now)) || (!f && m.dbStatus && isStaleStatus(m.ts, m.dbStatus, now));
        const hasKickedOff = m.ts <= now + 5 * 60000;
        return !stale && hasKickedOff && (
          (f && DONE_STATUSES.has(f.status)) ||
          (m.dbStatus && DONE_STATUSES.has(m.dbStatus) && m.dbGh != null && m.dbGa != null)
        );
      });
      const isToday = iso === today;
      const isPast = iso < today || (isToday && allDone);

      /* Place the scroll anchor before the first non-past section */
      if (!anchorPlaced && !isPast) {
        html += `<div id="next-match-anchor" style="scroll-margin-top:80px"></div>`;
        anchorPlaced = true;
      }

      const sectionCls = isPast ? "mc-sec mc-sec--past" : "mc-sec";
      const headExtra = isToday ? " — Gameday" : "";
      html += `<div class="${sectionCls}"><div class="mc-hd">${dateLabel}${headExtra}</div>`;

      for (const m of matches) {
        const f = findLive(m, fixtures);
        const stale = (f && isStaleStatus(m.ts, f.status, now)) || (!f && m.dbStatus && isStaleStatus(m.ts, m.dbStatus, now));
        const hasKickedOff = m.ts <= now + 5 * 60000;
        const isDone = !stale && hasKickedOff && !!(
          (f && DONE_STATUSES.has(f.status)) ||
          (m.dbStatus && DONE_STATUSES.has(m.dbStatus) && m.dbGh != null && m.dbGa != null)
        );
        html += tixCard(m, anim, isDone);
      }
      html += `</div>`;
    }

    /* If every single match is done, no anchor was placed — that's fine */
    return html || `<div class="empty">No matches match your filters.</div>`;
  }

  function renderGroups(anim: boolean): string {
    let html = `<div class="gwrap">${liveIndicatorHtml()}
      <div class="qkey"><span><i style="background:#1F8A6B"></i>Top 2 advance</span>
      <span><i style="background:#E5B53A"></i>3rd — best 8 advance</span></div>`;
    for (const g of Object.keys(data.groups)) {
      const { rows, played } = standings(g);
      const body = rows.map((r, i) => {
        const cls = i < 2 ? "adv" : (i === 2 ? "cont" : "");
        const host = data.hosts.includes(r.t) ? '<span class="host">H</span>' : "";
        const gd = r.gf - r.ga;
        const gdCls = gd > 0 ? "gd-col gd-pos" : gd < 0 ? "gd-col gd-neg" : "gd-col";
        return `<tr class="${cls}"><td class="pos l">${i + 1}</td>
          <td class="l"><span class="tm"><span class="fl">${fl(r.t)}</span><a class="nm teamlink" data-team="${esc(r.t)}" href="#">${esc(r.t)}</a>${host}</span></td>
          <td>${r.p}</td><td class="w-col">${r.w}</td><td>${r.d}</td><td class="l-col">${r.l}</td><td class="gf-col">${r.gf}</td><td class="ga-col">${r.ga}</td><td class="${gdCls}">${formatGD(gd, played)}</td><td class="pts">${r.pts}</td></tr>`;
      }).join("");
      html += `<div class="gcard${anim ? " stagger-rise" : ""}" style="--gc:${data.gcolor[g]}">
        <div class="gcard__h">Group ${g}<span class="pl">${played ? played + " played" : "not started"}</span></div>
        <div class="tbl-wrap"><table class="tbl"><colgroup><col class="tbl__pos" /><col class="tbl__team" /><col class="tbl__stat" /><col class="tbl__stat" /><col class="tbl__stat" /><col class="tbl__stat" /><col class="tbl__gf" /><col class="tbl__ga" /><col class="tbl__gd" /><col class="tbl__pts" /></colgroup><thead><tr><th class="l"></th><th class="l">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
        <tbody>${body}</tbody></table></div></div>`;
    }
    html += `<p class="qnote">Tables update from full-time scores as they come in. Order uses points, then goal difference, then goals scored — FIFA's official tiebreakers (including head-to-head and fair-play) decide the final standings.</p></div>`;
    return html;
  }

  function renderKnockout(anim: boolean): string {
    let html = '<div class="section" style="padding-top:4px">' + liveIndicatorHtml();
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
          : `<div class="kotix__time"><div class="lo">${esc(k.et)}</div>${k.local !== k.et ? `<div class="et">${esc(k.local)}</div>` : ""}</div>`;
        top = `<div class="kotix__top"><div class="koteams">
          <div class="team"><span class="fl">${fl(a)}</span><span class="nm">${esc(a)}</span></div>
          <div class="vs">vs</div>
          <div class="team"><span class="fl">${fl(b)}</span><span class="nm">${esc(b)}</span></div></div>${right}</div>`;
      } else {
        top = `<div class="kotix__top"><div class="pend">Pending FIFA Confirmation<span class="dot">vs</span>Pending FIFA Confirmation</div></div>`;
      }
      html += `<article class="kotix${cls}${anim ? " stagger-rise" : ""}">${top}
        <div class="kotix__foot"><span>📍</span><span class="ven">${esc(v.common)}</span>· ${esc(v.city)}, ${esc(v.country)}
        <span class="dt">${DOW[t.getDay()]} ${t.getDate()} ${MON[t.getMonth()]} · ${esc(k.et)}${k.local !== k.et ? ` (${esc(k.local)})` : ""}</span></div></article>`;
    }
    html += `<p style="font-size:12.5px;color:var(--muted);margin:14px 2px 0">Dates, times and venues are confirmed. Teams fill in automatically as results come in; until then they read "Pending FIFA Confirmation." Round-of-32 pairings follow FIFA's pre-set bracket.</p></div>`;
    return html;
  }

  function renderVenues(anim: boolean): string {
    const order = Object.entries(data.venues).sort((a, b) => b[1].cap - a[1].cap);
    return order.map(([, v]) => {
      const flag = v.country === "USA" ? "🇺🇸" : v.country === "Mexico" ? "🇲🇽" : "🇨🇦";
      return `<div class="vcard${anim ? " stagger-rise" : ""}"><div class="vcard__cap"><b>${(v.cap / 1000).toFixed(v.cap % 1000 ? 1 : 0)}k</b><span>Seats</span></div>
        <div class="vcard__b"><h4>${esc(v.common)}</h4><div class="meta">${esc(v.city)}, ${esc(v.country)}</div>
        <div class="fifa">Tournament name: ${esc(v.fifa)}</div></div><span class="flag-c">${flag}</span></div>`;
    }).join("");
  }

  /** Aggregate goal/assist tallies and tournament-wide stats from all finished match events */
  function computeLeaders() {
    const scorers: Record<string, { name: string; team: string; goals: number; penalties: number }> = {};
    const assisters: Record<string, { name: string; team: string; assists: number }> = {};
    const teamGoals: Record<string, { team: string; goals: number }> = {};
    const cardPlayers: Record<string, { name: string; team: string; yellows: number; reds: number }> = {};

    // Goals-by-minute buckets: 0-15, 16-30, 31-45, 46-60, 61-75, 76-90, 90+
    const minuteBuckets = [0, 0, 0, 0, 0, 0, 0];
    let totalGoals = 0;
    let normalGoals = 0;
    let penGoals = 0;
    let ownGoals = 0;
    let totalYellows = 0;
    let totalReds = 0;
    let totalSubs = 0;

    const allEvents: { events: MatchEvent[]; team?: string }[] = [];

    // From live fixtures (primary source — includes DB-enriched data)
    for (const f of fixtures) {
      if (f.events) allEvents.push({ events: f.events });
    }

    // From DB-stored events on group stage matches (fallback for matches not in current live feed)
    for (const m of data.gs) {
      if (m.dbEvents && m.dbEvents.length > 0) {
        const already = fixtures.some(f => Math.abs(f.ts - m.ts) < 60000 && f.events && f.events.length > 0);
        if (!already) allEvents.push({ events: m.dbEvents });
      }
    }

    for (const { events } of allEvents) {
      for (const ev of events) {
        // ── Cards ──
        if (ev.type === "Card") {
          const isRed = ev.detail.includes("Red");
          if (isRed) totalReds++;
          else totalYellows++;

          const cKey = `${ev.player}|${ev.team}`;
          if (!cardPlayers[cKey]) cardPlayers[cKey] = { name: ev.player, team: ev.team, yellows: 0, reds: 0 };
          if (isRed) cardPlayers[cKey].reds++;
          else cardPlayers[cKey].yellows++;
          continue;
        }

        // ── Substitutions ──
        if (ev.type === "subst") {
          totalSubs++;
          continue;
        }

        // ── Goals ──
        if (ev.type !== "Goal") continue;
        totalGoals++;

        const isPen = ev.detail === "Penalty";
        const isOG = ev.detail === "Own Goal";
        if (isOG) { ownGoals++; }
        else if (isPen) { penGoals++; }
        else { normalGoals++; }

        const m = ev.minute;
        if (m <= 15) minuteBuckets[0]++;
        else if (m <= 30) minuteBuckets[1]++;
        else if (m <= 45) minuteBuckets[2]++;
        else if (m <= 60) minuteBuckets[3]++;
        else if (m <= 75) minuteBuckets[4]++;
        else if (m <= 90 && !ev.extra) minuteBuckets[5]++;
        else minuteBuckets[6]++;

        const tKey = ev.team;
        if (!teamGoals[tKey]) teamGoals[tKey] = { team: tKey, goals: 0 };
        teamGoals[tKey].goals++;

        if (isOG) continue;

        const pKey = `${ev.player}|${ev.team}`;
        if (!scorers[pKey]) scorers[pKey] = { name: ev.player, team: ev.team, goals: 0, penalties: 0 };
        scorers[pKey].goals += 1;
        if (isPen) scorers[pKey].penalties += 1;

        if (ev.assist) {
          const aKey = `${ev.assist}|${ev.team}`;
          if (!assisters[aKey]) assisters[aKey] = { name: ev.assist, team: ev.team, assists: 0 };
          assisters[aKey].assists += 1;
        }
      }
    }

    // Count finished matches and clean sheets
    const finishedKeys = new Set<string>();
    let cleanSheets = 0;
    for (const f of fixtures) {
      if (!DONE_STATUSES.has(f.status) || f.gh == null || f.ga == null) continue;
      const key = canon(f.home) + ":" + canon(f.away);
      if (finishedKeys.has(key)) continue;
      finishedKeys.add(key);
      if (f.gh === 0) cleanSheets++;
      if (f.ga === 0) cleanSheets++;
    }
    for (const m of data.gs) {
      if (m.score == null) continue;
      const key = canon(m.home) + ":" + canon(m.away);
      if (finishedKeys.has(key)) continue;
      finishedKeys.add(key);
      const [h, a] = m.score.split("-").map(Number);
      if (h === 0) cleanSheets++;
      if (a === 0) cleanSheets++;
    }

    const matchesPlayed = finishedKeys.size;
    const avgGoals = matchesPlayed > 0 ? +(totalGoals / matchesPlayed).toFixed(1) : 0;

    const topScorers = Object.values(scorers).sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, 20);
    const topAssisters = Object.values(assisters).sort((a, b) => b.assists - a.assists || a.name.localeCompare(b.name)).slice(0, 20);
    const topTeams = Object.values(teamGoals).sort((a, b) => b.goals - a.goals || a.team.localeCompare(b.team)).slice(0, 12);
    const mostCarded = Object.values(cardPlayers).sort((a, b) => (b.yellows + b.reds * 3) - (a.yellows + a.reds * 3) || a.name.localeCompare(b.name)).slice(0, 15);
    const bucketLabels = ["1-15", "16-30", "31-45", "46-60", "61-75", "76-90", "90+"];

    return {
      topScorers, topAssisters, topTeams, mostCarded,
      minuteBuckets, bucketLabels,
      totalGoals, normalGoals, penGoals, ownGoals,
      totalYellows, totalReds, totalSubs,
      matchesPlayed, avgGoals, cleanSheets,
    };
  }

  function renderAbout(): string {
    return `<div class="about">
      <h3>About this app</h3>
      <p><b>Compet 2026</b> is a mobile companion to the 2026 FIFA World Cup across Canada, Mexico and the United States. Scores, statistics, lineups and group tables update live during matches. Tap any match card for detailed statistics, lineups and a full timeline. Install as an app from your browser for the best experience.</p>
      <h3>Live scores &amp; stats</h3>
      <p>Match data updates automatically during live matches. When no matches are in play, the confirmed schedule is displayed. All data is unofficial; FIFA is the source of record.</p>
      <h3>Knockout bracket</h3>
      <p>Knockout dates, times and venues are confirmed; teams read <span class="legend">Pending FIFA Confirmation</span> and fill in automatically as the bracket is decided.</p>
      <h3>Times</h3>
      <p>All times default to <b>U.S. Eastern (ET)</b>. Local venue time is shown below when different. <b>HOST</b> marks Canada, Mexico and the United States.</p>
      <h3>Schedule accuracy</h3>
      <p>Compiled 11 June 2026 and cross-checked against FIFA, FOX Sports, NBC Sports, ESPN, Al Jazeera, FourFourTwo and Wikipedia.</p>
    </div>`;
  }

  const viewContent = useMemo(() => {
    if (view === "schedule") return renderSchedule(animate);
    if (view === "groups") return renderGroups(animate);
    if (view === "knockout") return renderKnockout(animate);
    if (view === "venues") return renderVenues(animate);
    if (view === "stats") return ""; // stats rendered as React, not HTML string
    return renderAbout();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, group, team, query, fixtures, liveStatus, liveTs, liveEnrichmentIssue, animate, nowMs]);

  function handleTab(v: ViewType) {
    setAnimate(true);
    setView(v);
    window.scrollTo({ top: 0 });
  }

  const tabs: { key: ViewType; label: string }[] = [
    { key: "schedule", label: "Schedule" },
    { key: "groups", label: "Tables" },
    { key: "knockout", label: "Knockout" },
    { key: "bracket", label: "Bracket" },
    { key: "stats", label: "Stats" },
    { key: "venues", label: "Venues" },
    { key: "about", label: "About" },
  ];

  return (
    <div className="wrap">
      <header className="bar">
        <div className="bar__mark">
          <img src="/wc26-logo.png" alt="FIFA World Cup 26" className="bar__logo" draggable={false} />
          <TriondaBall id="hb" className="bar__ball" />
        </div>
        <div className="bar__hosts" aria-label="Hosts: Canada, Mexico, United States"><span>🇨🇦</span><span>🇲🇽</span><span>🇺🇸</span></div>
      </header>

      <section className="hero">
        <div className="hero__pitch-lines" aria-hidden="true" />
        <div className="hero__centerpiece">
          <WorldCupTrophy id="hero-trophy" className="hero__trophy" />
          <TriondaBall id="hero" className="hero__ball" />
        </div>
        <div className="hero__eyebrow">Canada &middot; Mexico &middot; United States</div>
        <h1 className="hero__title">COMPET<br />2026</h1>
        <div className="hero__sub">Live scores, fixtures, tables and bracket picks</div>
        <div className="hero__host-row" aria-label="Host nations">
          <span>🇨🇦 Canada</span>
          <span>🇲🇽 Mexico</span>
          <span>🇺🇸 United States</span>
        </div>
        <div className="hero__stats">
          <div className="stat"><b>48</b><span>Teams</span></div>
          <div className="stat"><b>104</b><span>Matches</span></div>
          <div className="stat"><b>16</b><span>Venues</span></div>
          <div className="stat"><b>3</b><span>Hosts</span></div>
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

      <CountdownHero data={data} fixtures={fixtures} findLive={findLive} />

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

      <div key={view} className="view-transition">
        {view === "bracket" ? (
          <BracketBuilder flags={data.flags} groups={data.groups} gcolor={data.gcolor} />
        ) : view === "stats" ? (
          <StatsView data={data} fixtures={fixtures} fl={fl} computeLeaders={computeLeaders} />
        ) : (
          <main
            ref={mainRef}
            className={view !== "groups" && view !== "knockout" ? "section" : undefined}
            dangerouslySetInnerHTML={{ __html: viewContent }}
          />
        )}
      </div>

      {showInstall && (
        <div className="install-banner">
          <div className="install-banner__icon">
            <img src="/icon-192.svg" alt="" width={40} height={40} />
          </div>
          <div className="install-banner__text">
            <strong>Install Compet 2026</strong>
            <span>Add to home screen for live scores &amp; offline access</span>
          </div>
          <button className="install-banner__btn" onClick={async () => {
            const p = deferredPromptRef.current;
            if (!p) return;
            p.prompt();
            const { outcome } = await p.userChoice;
            if (outcome === "accepted") setShowInstall(false);
            deferredPromptRef.current = null;
          }}>Install</button>
          <button className="install-banner__close" onClick={() => setShowInstall(false)} aria-label="Dismiss">&times;</button>
        </div>
      )}

      <div className="foot">
        All data is unofficial &middot; FIFA is the source of record &middot; Knockout teams fill in as results are confirmed
      </div>

      {goalToast && (
        <div className={`goal-toast${toastExiting ? " goal-toast--exit" : ""}`} role="status" aria-live="assertive">
          <span className="goal-toast__icon">⚽</span>
          <div>
            <div className="goal-toast__text">{goalToast.flag} GOAL! {goalToast.player} {goalToast.minute}</div>
            <div className="goal-toast__sub">{goalToast.score}</div>
          </div>
        </div>
      )}

      {teamDrawer && <TeamDrawer name={teamDrawer} flags={data.flags} groups={data.groups} gcolor={data.gcolor} gs={data.gs} hosts={data.hosts} onClose={() => setTeamDrawer(null)} onPlayerClick={(p, t) => { setTeamDrawer(null); setPlayerProfile({ name: p, team: t }); }} />}
      {matchDetail && <MatchDetailDrawer match={matchDetail.match} initialFixture={matchDetail.fixture} fixtures={fixtures} flags={data.flags} venues={data.venues} gcolor={data.gcolor} allMatches={data.gs} vName={vName} findLive={findLive} onClose={() => setMatchDetail(null)} onTeamClick={(t) => { setMatchDetail(null); setTeamDrawer(t); }} onPlayerClick={(p, t) => { setMatchDetail(null); setPlayerProfile({ name: p, team: t }); }} />}
      {playerProfile && <PlayerProfileDrawer playerName={playerProfile.name} teamName={playerProfile.team} flags={data.flags} data={data} onClose={() => setPlayerProfile(null)} onTeamClick={(t) => { setPlayerProfile(null); setTeamDrawer(t); }} />}
    </div>
  );
}

function CountdownHero({ data, fixtures, findLive }: {
  data: TournamentData;
  fixtures: LiveFixture[];
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null;
}) {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setMounted(true);
    setNow(Date.now());
    const id = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => clearInterval(id);
  }, []);

  const fl = (t: string) => data.flags[t] || "⚽";
  const jumpToNext = () => {
    document.getElementById("next-match-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const handleKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      jumpToNext();
    }
  };

  const liveMatches: { match: GroupStageMatch; fixture: LiveFixture }[] = [];
  for (const m of data.gs) {
    const f = findLive(m, fixtures);
    if (f && LIVE_STATUSES.has(f.status)) liveMatches.push({ match: m, fixture: f });
  }

  if (liveMatches.length > 0) {
    const { match, fixture } = liveMatches[0];
    const v = data.venues[match.v];
    const elapsed = fixture.status === "HT" ? "Half Time" : `${fixture.elapsed || ""}'`;
    return (
      <div className="cd-hero cd-hero--live">
        <div className="cd-hero__label"><span className="cd-hero__pulse" />{liveMatches.length > 1 ? `${liveMatches.length} MATCHES LIVE` : "LIVE NOW"}</div>
        <div className="cd-hero__teams">
          <div className="cd-hero__side"><span className="cd-hero__flag">{fl(match.t1)}</span><span className="cd-hero__name">{match.t1}</span></div>
          <div className="cd-hero__score-live">{fixture.gh ?? 0} – {fixture.ga ?? 0}</div>
          <div className="cd-hero__side"><span className="cd-hero__flag">{fl(match.t2)}</span><span className="cd-hero__name">{match.t2}</span></div>
        </div>
        <div className="cd-hero__info">{elapsed}{v ? ` · ${v.common}, ${v.city}` : ""}</div>
      </div>
    );
  }

  let nextGs: GroupStageMatch | null = null;
  for (const m of data.gs) {
    if (m.ts > now && (!nextGs || m.ts < nextGs.ts)) nextGs = m;
  }
  let nextKo: KnockoutMatch | null = null;
  for (const k of data.ko) {
    if (k.ts > now && (!nextKo || k.ts < nextKo.ts)) nextKo = k;
  }

  const useGs = nextGs && (!nextKo || nextGs.ts <= nextKo.ts);
  const ts = useGs ? nextGs!.ts : nextKo?.ts;
  if (!ts) return null;

  const diff = Math.max(0, ts - now);
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const mn = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  const isoDate = useGs ? nextGs!.iso : nextKo!.iso;
  const d = parseISO(isoDate);
  const etTime = useGs ? nextGs!.et : nextKo!.et;
  const venCode = useGs ? nextGs!.v : nextKo!.v;
  const v = data.venues[venCode];

  return (
    <div className="cd-hero" role="button" tabIndex={0} onClick={jumpToNext} onKeyDown={handleKey} aria-label="Jump to next match">
      <div className="cd-hero__label">NEXT MATCH <span className="cd-hero__tap" aria-hidden="true">↘</span></div>
      <div className="cd-hero__countdown" suppressHydrationWarning>
        <span className="cd-hero__digit" suppressHydrationWarning>{mounted ? pad(h) : "--"}</span>
        <span className="cd-hero__colon">:</span>
        <span className="cd-hero__digit" suppressHydrationWarning>{mounted ? pad(mn) : "--"}</span>
        <span className="cd-hero__colon">:</span>
        <span className="cd-hero__digit" suppressHydrationWarning>{mounted ? pad(s) : "--"}</span>
      </div>
      {useGs && nextGs ? (
        <div className="cd-hero__teams">
          <div className="cd-hero__side"><span className="cd-hero__flag">{fl(nextGs.t1)}</span><span className="cd-hero__name">{nextGs.t1}</span></div>
          <span className="cd-hero__vs">vs</span>
          <div className="cd-hero__side"><span className="cd-hero__flag">{fl(nextGs.t2)}</span><span className="cd-hero__name">{nextGs.t2}</span></div>
        </div>
      ) : nextKo ? (
        <div className="cd-hero__teams"><span className="cd-hero__round">{nextKo.round}</span></div>
      ) : null}
      <div className="cd-hero__info">{DOW[d.getDay()]} {d.getDate()} {MON[d.getMonth()]} · {etTime}{v ? ` · ${v.common}` : ""}</div>
    </div>
  );
}

function posLabel(p: string): string {
  return ({ GK: "Goalkeeper", DF: "Defender", MF: "Midfielder", FW: "Forward" }[p]) || p;
}

function posColor(p: string): string {
  return ({ GK: "#b58900", DF: "#2563eb", MF: "#0A5C3E", FW: "#D23B2E" }[p]) || "#5C6B62";
}

function PlayerProfileDrawer({ playerName, teamName, flags, data, onClose, onTeamClick }: {
  playerName: string;
  teamName: string;
  flags: Record<string, string>;
  data: TournamentData;
  onClose: () => void;
  onTeamClick: (team: string) => void;
}) {
  const profile = TEAM_PROFILES[teamName];
  const player = profile?.squad.find(p => p.name === playerName);
  const flag = flags[teamName] || "⚽";

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const groupLetter = Object.entries(data.groups).find(([, teams]) => teams.includes(teamName))?.[0] || null;
  const groupMatches = data.gs.filter(m => m.t1 === teamName || m.t2 === teamName);
  const headerBg = profile?.kitColors.primary || "#0A5C3E";
  const lightColors = ["#FFFFFF","#FFDF00","#FCD116","#FECC02","#FFB81C","#FFCD00","#FF8200","#FFD100"];
  const headerText = lightColors.includes(headerBg) ? "#122019" : "#fff";

  if (!player) {
    return (
      <div className="drawer-overlay" onClick={onClose}>
        <div className="drawer pp-drawer" onClick={e => e.stopPropagation()}>
          <div className="pp-drawer__header" style={{ background: headerBg, color: headerText }}>
            <button className="drawer__close" onClick={onClose} aria-label="Close">&times;</button>
            <div className="pp-drawer__name">{playerName}</div>
            <button className="pp-drawer__team-link" onClick={() => { onClose(); onTeamClick(teamName); }}>
              {flag} {teamName} →
            </button>
          </div>
          <div className="drawer__body">
            <p style={{ textAlign: "center", color: "#5C6B62", padding: "40px 20px" }}>Detailed profile not available yet.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer pp-drawer" onClick={e => e.stopPropagation()}>
        <div className="pp-drawer__header" style={{ background: headerBg, color: headerText }}>
          <button className="drawer__close" onClick={onClose} aria-label="Close">&times;</button>
          {player.number != null && <div className="pp-drawer__number">{player.number}</div>}
          <div className="pp-drawer__name">{player.name}</div>
          <div className="pp-drawer__pos" style={{ background: posColor(player.pos) }}>{posLabel(player.pos)}</div>
        </div>

        <div className="drawer__body">
          <button className="pp-drawer__team-row" onClick={() => { onClose(); onTeamClick(teamName); }}>
            <span>{flag}</span>
            <span className="pp-drawer__team-name">{teamName}</span>
            {groupLetter && <span className="pp-drawer__group" style={{ color: data.gcolor[groupLetter] }}>Group {groupLetter}</span>}
            <span className="pp-drawer__arrow">→</span>
          </button>

          <div className="drawer__stats-grid">
            <div className="drawer__stat"><span className="drawer__stat-val">{player.age}</span><span className="drawer__stat-lbl">Age</span></div>
            <div className="drawer__stat"><span className="drawer__stat-val">{player.caps}</span><span className="drawer__stat-lbl">Caps</span></div>
            <div className="drawer__stat"><span className="drawer__stat-val">{player.goals}</span><span className="drawer__stat-lbl">Int&apos;l Goals</span></div>
            {player.number != null && <div className="drawer__stat"><span className="drawer__stat-val">#{player.number}</span><span className="drawer__stat-lbl">Jersey</span></div>}
          </div>

          <div className="drawer__section">
            <h3 className="drawer__h3">Club</h3>
            <p className="drawer__text">{player.club}</p>
          </div>

          <div className="drawer__section">
            <h3 className="drawer__h3">Position</h3>
            <p className="drawer__text" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="drawer__player-pos" style={{ background: posColor(player.pos) }}>{player.pos}</span>
              {posLabel(player.pos)}
            </p>
          </div>

          {groupMatches.length > 0 && (
            <div className="drawer__section">
              <h3 className="drawer__h3">Group Stage Schedule</h3>
              {groupMatches.map(m => {
                const d = parseISO(m.iso);
                const opponent = m.t1 === teamName ? m.t2 : m.t1;
                const isHome = m.t1 === teamName;
                return (
                  <div key={m.no} className="drawer__match">
                    <div className="drawer__match-date">{d.getDate()} {MON[d.getMonth()]}</div>
                    <div className="drawer__match-vs">
                      <span>{flag}</span>
                      <span className="drawer__match-ha">{isHome ? "vs" : "@"}</span>
                      <span>{flags[opponent] || "⚽"} {opponent}</span>
                    </div>
                    <div className="drawer__match-time">{m.et}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamDrawer({ name, flags, groups, gcolor, gs, hosts, onClose, onPlayerClick }: {
  name: string;
  flags: Record<string, string>;
  groups: Record<string, string[]>;
  gcolor: Record<string, string>;
  gs: GroupStageMatch[];
  hosts: string[];
  onClose: () => void;
  onPlayerClick: (playerName: string, teamName: string) => void;
}) {
  const profile = TEAM_PROFILES[name];
  const flag = flags[name] || "⚽";
  const isHost = hosts.includes(name);

  const groupLetter = Object.entries(groups).find(([, teams]) => teams.includes(name))?.[0] || null;
  const groupMatches = gs.filter(m => m.t1 === name || m.t2 === name);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!profile) {
    return (
      <div className="drawer-overlay" onClick={onClose}>
        <div className="drawer" onClick={e => e.stopPropagation()}>
          <div className="drawer__header">
            <button className="drawer__close" onClick={onClose} aria-label="Close">&times;</button>
            <div className="drawer__flag">{flag}</div>
            <h2 className="drawer__name">{name}</h2>
          </div>
          <div className="drawer__body">
            <p style={{ textAlign: "center", color: "#5C6B62", padding: "40px 20px" }}>Profile data not available yet.</p>
          </div>
        </div>
      </div>
    );
  }

  const byPos: Record<string, PlayerInfo[]> = {};
  for (const p of profile.squad) {
    if (!byPos[p.pos]) byPos[p.pos] = [];
    byPos[p.pos].push(p);
  }
  const posOrder = ["GK", "DF", "MF", "FW"];

  const headerTextColor = (() => {
    const light = ["#FFFFFF","#FFDF00","#FCD116","#FECC02","#FFB81C","#FFCD00","#FF8200","#FFD100"];
    return light.includes(profile.kitColors.primary) ? "#122019" : "#fff";
  })();

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer__header" style={{ background: profile.kitColors.primary, color: headerTextColor }}>
          <button className="drawer__close" onClick={onClose} aria-label="Close">&times;</button>
          <div className="drawer__flag">{flag}</div>
          <h2 className="drawer__name">{name}</h2>
          {profile.nickname && <div className="drawer__nick">{profile.nickname}</div>}
          {isHost && <span className="drawer__host">HOST NATION</span>}
        </div>

        <div className="drawer__body">
          <div className="drawer__stats-grid">
            <div className="drawer__stat">
              <span className="drawer__stat-val">{profile.fifaRanking}</span>
              <span className="drawer__stat-lbl">FIFA Rank</span>
            </div>
            <div className="drawer__stat">
              <span className="drawer__stat-val">{profile.wcAppearances}</span>
              <span className="drawer__stat-lbl">WC Apps</span>
            </div>
            <div className="drawer__stat">
              <span className="drawer__stat-val">{profile.confederation}</span>
              <span className="drawer__stat-lbl">Conf.</span>
            </div>
            {groupLetter && (
              <div className="drawer__stat">
                <span className="drawer__stat-val" style={{ color: gcolor[groupLetter] }}>{groupLetter}</span>
                <span className="drawer__stat-lbl">Group</span>
              </div>
            )}
          </div>

          <div className="drawer__section">
            <div className="drawer__badge">Best Finish</div>
            <p className="drawer__best">{profile.bestFinish}</p>
          </div>

          <div className="drawer__section">
            <h3 className="drawer__h3">History</h3>
            <p className="drawer__text">{profile.history}</p>
          </div>

          <div className="drawer__section">
            <h3 className="drawer__h3">Coach</h3>
            <p className="drawer__text">{profile.coach}</p>
          </div>

          {groupMatches.length > 0 && (
            <div className="drawer__section">
              <h3 className="drawer__h3">Group Matches</h3>
              {groupMatches.map(m => {
                const d = parseISO(m.iso);
                const opponent = m.t1 === name ? m.t2 : m.t1;
                const isHome = m.t1 === name;
                return (
                  <div key={m.no} className="drawer__match">
                    <div className="drawer__match-date">{d.getDate()} {MON[d.getMonth()]}</div>
                    <div className="drawer__match-vs">
                      <span>{flag}</span>
                      <span className="drawer__match-ha">{isHome ? "vs" : "@"}</span>
                      <span>{flags[opponent] || "⚽"} {opponent}</span>
                    </div>
                    <div className="drawer__match-time">{m.et}</div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="drawer__section">
            <h3 className="drawer__h3">Official Squad</h3>
            {posOrder.filter(pos => byPos[pos]).map(pos => (
              <div key={pos}>
                <div className="drawer__pos-head" style={{ color: posColor(pos) }}>{posLabel(pos)}s</div>
                {byPos[pos].map(p => (
                  <div key={p.name} className="drawer__player drawer__player--clickable" onClick={() => onPlayerClick(p.name, name)} role="button" tabIndex={0}>
                    <div className="drawer__player-main">
                      {p.number && <span className="drawer__player-num">{p.number}</span>}
                      <span className="drawer__player-name">{p.name}</span>
                      <span className="drawer__player-pos" style={{ background: posColor(p.pos) }}>{p.pos}</span>
                      <span className="drawer__player-arrow">›</span>
                    </div>
                    <div className="drawer__player-meta">
                      <span>{p.club}</span>
                      <span className="drawer__player-sep">&middot;</span>
                      <span>Age {p.age}</span>
                      <span className="drawer__player-sep">&middot;</span>
                      <span>{p.caps} caps</span>
                      {p.goals > 0 && <><span className="drawer__player-sep">&middot;</span><span>{p.goals} goals</span></>}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function eventIcon(type: string, detail: string): string {
  if (type === "Goal" && detail === "Own Goal") return "🔴";
  if (type === "Goal" && detail === "Penalty") return "⚽️";
  if (type === "Goal") return "⚽";
  if (type === "Card" && detail.includes("Red")) return "🟥";
  if (type === "Card") return "🟨";
  if (type === "subst") return "🔄";
  if (type === "Var") return "📺";
  return "•";
}

type MdTab = "summary" | "stats" | "lineups" | "report";

function mergeRichFixture(primary: LiveFixture | null, fallback: LiveFixture | null): LiveFixture | null {
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    ...primary,
    events: primary.events?.length ? primary.events : fallback.events,
    stats: primary.stats && (Object.keys(primary.stats.home).length || Object.keys(primary.stats.away).length) ? primary.stats : fallback.stats,
    lineups: (primary.lineups?.length || 0) >= 2 ? primary.lineups : (fallback.lineups || primary.lineups),
    players: primary.players?.length ? primary.players : fallback.players,
    referee: primary.referee || fallback.referee,
    fixtureId: primary.fixtureId || fallback.fixtureId,
  };
}

function MatchDetailDrawer({ match, initialFixture, fixtures, flags, venues, gcolor, allMatches, vName: _vName, findLive, onClose, onTeamClick, onPlayerClick }: {
  match: GroupStageMatch;
  initialFixture: LiveFixture | null;
  fixtures: LiveFixture[];
  flags: Record<string, string>;
  venues: Record<string, { common: string; fifa: string; city: string; country: string; cap: number }>;
  gcolor: Record<string, string>;
  allMatches: GroupStageMatch[];
  vName: (k: string) => string;
  findLive: (m: { ts: number; v?: string; t1?: string; t2?: string }, fx: LiveFixture[]) => LiveFixture | null;
  onClose: () => void;
  onTeamClick: (team: string) => void;
  onPlayerClick: (playerName: string, teamName: string) => void;
}) {
  const [tab, setTab] = useState<MdTab>("summary");
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    queueMicrotask(() => setNowMs(Date.now()));
    const id = setInterval(() => { if (!document.hidden) setNowMs(Date.now()); }, 60000);
    return () => clearInterval(id);
  }, []);
  const persistedFixture: LiveFixture | null = match.dbStatus ? {
    ts: match.ts,
    status: match.dbStatus,
    elapsed: match.dbElapsed ?? null,
    venue: venues[match.v]?.common || "",
    round: `Group Stage - ${match.g}`,
    home: match.t1,
    away: match.t2,
    gh: match.dbGh ?? null,
    ga: match.dbGa ?? null,
    events: match.dbEvents,
    stats: match.dbStats,
    lineups: match.dbLineups,
    players: match.dbPlayers,
    referee: match.dbReferee || undefined,
    fixtureId: match.dbFixtureId || undefined,
  } : null;
  const liveFixture = findLive(match, fixtures) || initialFixture;
  const fixture = mergeRichFixture(liveFixture, persistedFixture);

  const hasKickedOff = match.ts <= nowMs + 5 * 60000;
  const hasDbScore = match.dbStatus && match.dbGh != null && match.dbGa != null;
  const fixtureStale = fixture ? isStaleStatus(match.ts, fixture.status, nowMs) : false;
  const dbStale = match.dbStatus ? isStaleStatus(match.ts, match.dbStatus, nowMs) : false;
  const isLive = !fixtureStale && (fixture ? LIVE_STATUSES.has(fixture.status) : (hasKickedOff && hasDbScore && !dbStale ? LIVE_STATUSES.has(match.dbStatus!) : false));
  const isDone = hasKickedOff && !fixtureStale && !dbStale && (fixture ? DONE_STATUSES.has(fixture.status) : (hasDbScore ? DONE_STATUSES.has(match.dbStatus!) : false));
  const isStale = fixtureStale || (hasKickedOff && dbStale && !fixture);
  const isUpcoming = !isLive && !isDone && !isStale;

  const scoreGh = fixture ? (fixture.gh ?? 0) : (match.dbGh ?? 0);
  const scoreGa = fixture ? (fixture.ga ?? 0) : (match.dbGa ?? 0);
  const statusLabel = fixture ? fixture.status : (match.dbStatus || "");
  const v = venues[match.v] || { common: "", city: "", country: "" };

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const homeGoals = fixture ? (fixture.events || []).filter(e => {
    if (e.type !== "Goal") return false;
    const isOG = e.detail === "Own Goal";
    const sameTeam = canon(e.team) === canon(fixture.home);
    return isOG ? !sameTeam : sameTeam;
  }) : [];
  const awayGoals = fixture ? (fixture.events || []).filter(e => {
    if (e.type !== "Goal") return false;
    const isOG = e.detail === "Own Goal";
    const sameTeam = canon(e.team) === canon(fixture.away);
    return isOG ? !sameTeam : sameTeam;
  }) : [];

  const statKeys = ["Ball Possession", "Total Shots", "Shots on Goal", "Corner Kicks", "Fouls", "Offsides", "Yellow Cards", "Red Cards", "Goalkeeper Saves", "Total passes", "Passes accurate"];
  const statLabels: Record<string, string> = {
    "Ball Possession": "Possession", "Total Shots": "Shots", "Shots on Goal": "On Target",
    "Corner Kicks": "Corners", "Fouls": "Fouls", "Offsides": "Offsides",
    "Yellow Cards": "Yellows", "Red Cards": "Reds", "Goalkeeper Saves": "Saves",
    "Total passes": "Passes", "Passes accurate": "Accurate Passes",
  };

  const hasStats = fixture?.stats && (Object.keys(fixture.stats.home).length > 0);
  function renderScoreHeader() {
    return (
      <div className="md-drawer__header" style={{ borderTopColor: gcolor[match.g] || "#0A5C3E" }}>
        <button className="drawer__close" onClick={onClose} aria-label="Close">&times;</button>
        <div className="md-drawer__badge">Group {match.g} · Match #{match.no}</div>

        <div className="md-drawer__score-row">
          <button className="md-drawer__team md-drawer__team--link" onClick={() => onTeamClick(match.t1)} aria-label={`View ${match.t1} profile`}>
            <span className="md-drawer__flag">{flags[match.t1] || "⚽"}</span>
            <span className="md-drawer__team-name">{match.t1}</span>
          </button>
          <div className="md-drawer__score">
            {isUpcoming ? (
              <span className="md-drawer__time-display">{match.et}</span>
            ) : (
              <>
                <span className="md-drawer__goals">{scoreGh}</span>
                <span className="md-drawer__sep">–</span>
                <span className="md-drawer__goals">{scoreGa}</span>
              </>
            )}
          </div>
          <button className="md-drawer__team md-drawer__team--link" onClick={() => onTeamClick(match.t2)} aria-label={`View ${match.t2} profile`}>
            <span className="md-drawer__flag">{flags[match.t2] || "⚽"}</span>
            <span className="md-drawer__team-name">{match.t2}</span>
          </button>
        </div>

        <div className="md-drawer__status">
          {isLive && <span className="md-drawer__live">{statusLabel === "HT" ? "HALF TIME" : `${fixture?.elapsed || ""}'`}</span>}
          {isDone && <span className="md-drawer__ft">{statusLabel === "AET" ? "AFTER EXTRA TIME" : statusLabel === "PEN" ? "PENALTIES" : "FULL TIME"}</span>}
          {isStale && <span className="md-drawer__updating">Updating...</span>}
          {isUpcoming && <span className="md-drawer__upcoming">UPCOMING</span>}
        </div>

        {!isUpcoming && (homeGoals.length > 0 || awayGoals.length > 0) && (
          <div className="md-drawer__scorers-row">
            <div className="md-drawer__scorers-col">
              {homeGoals.map((g, i) => {
                const min = g.extra ? `${g.minute}+${g.extra}'` : `${g.minute}'`;
                const pen = g.detail === "Penalty" ? " (P)" : g.detail === "Own Goal" ? " (OG)" : "";
                return <div key={i} className="md-drawer__scorer">⚽ {g.player} {min}{pen}</div>;
              })}
            </div>
            <div className="md-drawer__scorers-col md-drawer__scorers-col--away">
              {awayGoals.map((g, i) => {
                const min = g.extra ? `${g.minute}+${g.extra}'` : `${g.minute}'`;
                const pen = g.detail === "Penalty" ? " (P)" : g.detail === "Own Goal" ? " (OG)" : "";
                return <div key={i} className="md-drawer__scorer">{g.player} {min}{pen} ⚽</div>;
              })}
            </div>
          </div>
        )}

        {(isDone || isLive) && typeof navigator !== "undefined" && navigator.share && (
          <button
            className="share-btn"
            style={{ margin: "8px auto 4px", display: "flex" }}
            onClick={() => {
              const text = `${flags[match.t1] || ""} ${match.t1} ${scoreGh} – ${scoreGa} ${match.t2} ${flags[match.t2] || ""}\n${isDone ? "Full Time" : `${fixture?.elapsed || ""}'`} · FIFA World Cup 2026`;
              navigator.share({ text }).catch(() => {});
            }}
          >
            ↗ Share Result
          </button>
        )}

        {!isUpcoming && (
          <div className="md-tabs" role="tablist">
            {(["summary", "stats", "lineups", "report"] as MdTab[]).map(t => {
              const label: Record<MdTab, string> = { summary: "Summary", stats: "Stats", lineups: "Lineups", report: "Report" };
              return (
                <button key={t} role="tab" aria-selected={tab === t} className={`md-tab${tab === t ? " md-tab--active" : ""}`}
                  onClick={() => setTab(t)}>
                  {label[t]}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderSummaryTab() {
    return (
      <>
        <div className="md-drawer__venue">
          {v.common} · {v.city}, {v.country}
          <br />{match.et}{match.local !== match.et ? ` (${match.local})` : ""}
          {fixture?.referee && <><br />Referee: {fixture.referee}</>}
        </div>

        {fixture?.events && fixture.events.length > 0 && (
          <div className="drawer__section">
            <h3 className="drawer__h3">Match Timeline</h3>
            <div className="md-drawer__timeline">
              {fixture.events.map((ev, i) => {
                const isHome = canon(ev.team) === canon(match.t1);
                const min = ev.extra ? `${ev.minute}+${ev.extra}'` : `${ev.minute}'`;
                return (
                  <div key={i} className={`md-drawer__event ${isHome ? "md-drawer__event--home" : "md-drawer__event--away"}`}>
                    <span className="md-drawer__event-min">{min}</span>
                    <span className="md-drawer__event-icon">{eventIcon(ev.type, ev.detail)}</span>
                    <span className="md-drawer__event-text">
                      {ev.player}
                      {ev.type === "Goal" && ev.assist && <span className="md-drawer__event-assist"> (assist: {ev.assist})</span>}
                      {ev.type === "Goal" && ev.detail === "Penalty" && <span className="md-drawer__event-detail"> PEN</span>}
                      {ev.type === "Goal" && ev.detail === "Own Goal" && <span className="md-drawer__event-detail"> OG</span>}
                      {ev.type === "subst" && ev.assist && <span className="md-drawer__event-assist"> ↩ {ev.assist}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {hasStats && (
          <div className="drawer__section">
            <h3 className="drawer__h3">Key Stats</h3>
            <div className="md-drawer__stats">
              {["Ball Possession", "Total Shots", "Shots on Goal", "Corner Kicks", "Fouls"].filter(k => fixture!.stats!.home[k] != null).map(k => {
                const hv = fixture!.stats!.home[k];
                const av = fixture!.stats!.away[k];
                const hNum = typeof hv === "string" ? parseInt(hv) : (hv ?? 0);
                const aNum = typeof av === "string" ? parseInt(av) : (av ?? 0);
                const total = (typeof hNum === "number" ? hNum : 0) + (typeof aNum === "number" ? aNum : 0);
                const hPct = total > 0 ? (typeof hNum === "number" ? hNum : 0) / total * 100 : 50;
                return (
                  <div key={k} className="md-drawer__stat-row">
                    <span className="md-drawer__stat-val">{hv ?? 0}</span>
                    <div className="md-drawer__stat-bar-wrap">
                      <div className="md-drawer__stat-label">{statLabels[k] || k}</div>
                      <div className="md-drawer__stat-bar">
                        <div className="md-drawer__stat-bar-h" style={{ width: `${hPct}%` }} />
                        <div className="md-drawer__stat-bar-a" style={{ width: `${100 - hPct}%` }} />
                      </div>
                    </div>
                    <span className="md-drawer__stat-val">{av ?? 0}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>
    );
  }

  function renderStatsTab() {
    if (!fixture?.stats) return (
      <div className="md-drawer__empty-section">
        <div className="md-drawer__empty-icon">📊</div>
        <div className="md-drawer__empty-title">Match Statistics</div>
        <div className="md-drawer__empty-desc">Possession, shots, passes, fouls, and more will appear here {isDone ? "once data is synced" : "once the match kicks off"}.</div>
      </div>
    );
    const visibleStatKeys = [
      ...statKeys,
      ...Object.keys(fixture.stats.home),
      ...Object.keys(fixture.stats.away),
    ].filter((key, index, arr) => arr.indexOf(key) === index);
    return (
      <div className="drawer__section" style={{ marginTop: 0 }}>
        <div className="md-drawer__stats-header">
          <span>{flags[match.t1] || "⚽"} {match.t1}</span>
          <span>{match.t2} {flags[match.t2] || "⚽"}</span>
        </div>
        <div className="md-drawer__stats">
          {visibleStatKeys.filter(k => fixture.stats!.home[k] != null || fixture.stats!.away[k] != null).map(k => {
            const hv = fixture.stats!.home[k];
            const av = fixture.stats!.away[k];
            const hNum = typeof hv === "string" ? parseInt(hv) : (hv ?? 0);
            const aNum = typeof av === "string" ? parseInt(av) : (av ?? 0);
            const total = (typeof hNum === "number" ? hNum : 0) + (typeof aNum === "number" ? aNum : 0);
            const hPct = total > 0 ? (typeof hNum === "number" ? hNum : 0) / total * 100 : 50;
            return (
              <div key={k} className="md-drawer__stat-row">
                <span className="md-drawer__stat-val">{hv ?? 0}</span>
                <div className="md-drawer__stat-bar-wrap">
                  <div className="md-drawer__stat-label">{statLabels[k] || k}</div>
                  <div className="md-drawer__stat-bar">
                    <div className="md-drawer__stat-bar-h" style={{ width: `${hPct}%` }} />
                    <div className="md-drawer__stat-bar-a" style={{ width: `${100 - hPct}%` }} />
                  </div>
                </div>
                <span className="md-drawer__stat-val">{av ?? 0}</span>
              </div>
            );
          })}
        </div>

        {fixture.players && fixture.players.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h3 className="drawer__h3">Top Performers</h3>
            <div className="md-drawer__performers">
              {[...fixture.players].filter(p => p.rating).sort((a, b) => parseFloat(b.rating || "0") - parseFloat(a.rating || "0")).slice(0, 6).map((p, i) => (
                <div key={i} className="md-drawer__performer">
                  <div className="md-drawer__performer-rating">{parseFloat(p.rating || "0").toFixed(1)}</div>
                  <div className="md-drawer__performer-info">
                    <span className="md-drawer__performer-name">{p.name}</span>
                    <span className="md-drawer__performer-team">{flags[p.team] || "⚽"} {p.team}</span>
                  </div>
                  <div className="md-drawer__performer-stats">
                    {p.goals > 0 && <span>{p.goals}G</span>}
                    {p.assists > 0 && <span>{p.assists}A</span>}
                    {p.shotsOn > 0 && <span>{p.shotsOn} SoT</span>}
                    {p.tackles > 0 && <span>{p.tackles} Tkl</span>}
                    {p.passAccuracy && <span>{p.passAccuracy} Pass</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderLineupTeam(lineup: TeamLineup, teamName: string) {
    const resolvedTeam = canon(teamName);
    const matchTeam = canon(match.t1) === resolvedTeam ? match.t1 : match.t2;
    return (
      <div className="md-lineup">
        <div className="md-lineup__header">
          <span className="md-lineup__flag">{flags[matchTeam] || "⚽"}</span>
          <span className="md-lineup__team">{matchTeam}</span>
          <span className="md-lineup__formation">{lineup.formation}</span>
        </div>
        <div className="md-lineup__section-label">Starting XI</div>
        {lineup.startXI.map((p, i) => {
          const playerStats = fixture?.players?.find(ps => ps.number === p.number && canon(ps.team) === canon(teamName));
          return (
            <div key={i} className="md-lineup__player md-lineup__player--clickable" onClick={() => onPlayerClick(p.name, matchTeam)} role="button" tabIndex={0}>
              <span className="md-lineup__num">{p.number}</span>
              <span className="md-lineup__name">{p.name}</span>
              <span className="md-lineup__pos" data-pos={p.pos}>{p.pos}</span>
              {playerStats?.rating && <span className="md-lineup__rating">{parseFloat(playerStats.rating).toFixed(1)}</span>}
              {playerStats && (playerStats.goals > 0 || playerStats.yellowCards > 0 || playerStats.redCards > 0) && (
                <span className="md-lineup__icons">
                  {playerStats.goals > 0 && "⚽"}
                  {playerStats.yellowCards > 0 && "🟨"}
                  {playerStats.redCards > 0 && "🟥"}
                </span>
              )}
            </div>
          );
        })}
        {lineup.substitutes.length > 0 && (
          <>
            <div className="md-lineup__section-label">Substitutes</div>
            {lineup.substitutes.map((p, i) => (
              <div key={i} className="md-lineup__player md-lineup__player--sub md-lineup__player--clickable" onClick={() => onPlayerClick(p.name, matchTeam)} role="button" tabIndex={0}>
                <span className="md-lineup__num">{p.number}</span>
                <span className="md-lineup__name">{p.name}</span>
                <span className="md-lineup__pos" data-pos={p.pos}>{p.pos}</span>
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  function renderFormation(lineup: TeamLineup, teamName: string, flip: boolean) {
    const resolvedTeam = canon(teamName) === canon(match.t1) ? match.t1 : match.t2;
    const rows: Record<number, { name: string; number: number; pos: string; col: number }[]> = {};
    for (const p of lineup.startXI) {
      if (!p.grid) continue;
      const [r, c] = p.grid.split(":").map(Number);
      if (!rows[r]) rows[r] = [];
      rows[r].push({ name: p.name, number: p.number, pos: p.pos, col: c });
    }
    const sortedRows = Object.keys(rows).map(Number).sort((a, b) => flip ? b - a : a - b);
    const maxRow = Math.max(...sortedRows, 5);
    return (
      <div className="fm-pitch">
        <div className="fm-pitch__label">
          <span className="fm-pitch__flag">{flags[resolvedTeam] || "⚽"}</span>
          <span>{resolvedTeam}</span>
          <span className="fm-pitch__formation">{lineup.formation}</span>
        </div>
        <div className="fm-pitch__field">
          {sortedRows.map(row => {
            const players = rows[row].sort((a, b) => a.col - b.col);
            const maxCol = Math.max(...players.map(p => p.col), 1);
            return (
              <div key={row} className="fm-pitch__row" style={{ top: `${((flip ? maxRow - row : row - 1) / (maxRow - 1)) * 85 + 5}%` }}>
                {players.map((p, i) => {
                  const left = maxCol === 1 ? 50 : (p.col - 1) / (maxCol - 1) * 70 + 15;
                  const ps = fixture?.players?.find(ps => ps.number === p.number && canon(ps.team) === canon(teamName));
                  return (
                    <button key={i} className="fm-pitch__player" style={{ left: `${left}%` }}
                      onClick={() => onPlayerClick(p.name, resolvedTeam)}>
                      <span className="fm-pitch__num">{p.number}</span>
                      <span className="fm-pitch__name">{p.name.split(" ").pop()}</span>
                      {ps?.rating && <span className="fm-pitch__rating">{parseFloat(ps.rating).toFixed(1)}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderLineupsTab() {
    if (!fixture?.lineups || fixture.lineups.length === 0) return (
      <div className="drawer__section" style={{ marginTop: 0 }}>
        <div className="md-drawer__empty-section">
          <div className="md-drawer__empty-icon">👥</div>
          <div className="md-drawer__empty-title">Confirmed Lineups Pending</div>
          <div className="md-drawer__empty-desc">Starting XIs and substitutions will sync from live enrichment. Until then, the available squad lists are shown below.</div>
        </div>
        {renderSquadColumn(match.t1)}
        {renderSquadColumn(match.t2)}
      </div>
    );
    const hasGrid = fixture.lineups.length >= 2 && fixture.lineups[0].startXI.some(p => p.grid) && fixture.lineups[1].startXI.some(p => p.grid);
    return (
      <div className="drawer__section" style={{ marginTop: 0 }}>
        {hasGrid && (
          <div className="fm-wrap">
            {renderFormation(fixture.lineups[0], fixture.lineups[0].team, false)}
            <div className="fm-divider" />
            {renderFormation(fixture.lineups[1], fixture.lineups[1].team, true)}
          </div>
        )}
        {fixture.lineups.map((lineup, index) => (
          <div key={`${lineup.team}-${index}`}>
            {index > 0 && <div style={{ height: 16 }} />}
            {renderLineupTeam(lineup, lineup.team)}
          </div>
        ))}
      </div>
    );
  }

  function renderReportTab() {
    if (!fixture || !isDone) return (
      <div className="md-drawer__empty-section">
        <div className="md-drawer__empty-icon">📝</div>
        <div className="md-drawer__empty-title">Match Report</div>
        <div className="md-drawer__empty-desc">A full match summary with goals, cards, and key moments will be generated after the final whistle.</div>
      </div>
    );

    const events = fixture.events || [];
    const goals = events.filter(e => e.type === "Goal");
    const cards = events.filter(e => e.type === "Card");
    const subs = events.filter(e => e.type === "subst");
    const gh = fixture.gh ?? 0;
    const ga = fixture.ga ?? 0;

    const homeGoals = goals.filter(e => {
      const isOG = e.detail === "Own Goal";
      const sameTeam = canon(e.team) === canon(fixture.home);
      return isOG ? !sameTeam : sameTeam;
    });
    const awayGoals = goals.filter(e => {
      const isOG = e.detail === "Own Goal";
      const sameTeam = canon(e.team) === canon(fixture.away);
      return isOG ? !sameTeam : sameTeam;
    });
    const possession = fixture.stats?.home?.["Ball Possession"];

    let narrative = "";

    if (gh === ga) {
      narrative += `${match.t1} and ${match.t2} played out a ${gh}–${ga} draw at ${v.common} in ${v.city}. `;
    } else {
      const winner = gh > ga ? match.t1 : match.t2;
      const loser = gh > ga ? match.t2 : match.t1;
      const winScore = Math.max(gh, ga);
      const loseScore = Math.min(gh, ga);
      narrative += `${winner} ${winScore === 1 && loseScore === 0 ? "edged past" : "defeated"} ${loser} ${winScore}–${loseScore} at ${v.common} in ${v.city}. `;
    }

    if (goals.length > 0) {
      const opener = goals[0];
      narrative += `${opener.player} opened the scoring in the ${opener.minute}${opener.extra ? `+${opener.extra}` : ""}’ minute`;
      if (opener.assist) narrative += ` with an assist from ${opener.assist}`;
      narrative += `. `;
    }

    if (homeGoals.length > 1) {
      narrative += `${match.t1} added ${homeGoals.length - 1} more goal${homeGoals.length > 2 ? "s" : ""} through ${homeGoals.slice(1).map(g => g.player).join(" and ")}. `;
    }
    if (awayGoals.length > 1) {
      narrative += `${match.t2} responded with goal${awayGoals.length > 1 ? "s" : ""} from ${awayGoals.map(g => g.player).join(" and ")}. `;
    }

    if (possession) {
      narrative += `${match.t1} controlled ${possession} of possession. `;
    }

    const totalShots = (fixture.stats?.home?.["Total Shots"] || 0) as number;
    const totalShotsAway = (fixture.stats?.away?.["Total Shots"] || 0) as number;
    if (totalShots || totalShotsAway) {
      narrative += `The shot count finished ${totalShots}–${totalShotsAway}. `;
    }

    if (cards.length > 0) {
      const yellows = cards.filter(c => c.detail.includes("Yellow")).length;
      const reds = cards.filter(c => c.detail.includes("Red")).length;
      if (yellows > 0) narrative += `The referee showed ${yellows} yellow card${yellows !== 1 ? "s" : ""}`;
      if (reds > 0) narrative += `${yellows > 0 ? " and " : ""}${reds} red card${reds !== 1 ? "s" : ""}`;
      narrative += `. `;
    }

    if (subs.length > 0) {
      narrative += `There were ${subs.length} substitution${subs.length !== 1 ? "s" : ""} across both sides. `;
    }

    const topPerformers = (fixture.players || [])
      .filter(p => p.rating)
      .sort((a, b) => parseFloat(b.rating || "0") - parseFloat(a.rating || "0"))
      .slice(0, 3);

    return (
      <div className="drawer__section" style={{ marginTop: 0 }}>
        <div className="report">
          <div className="report__header">
            <span className="report__badge">Match Report</span>
            <span className="report__match">Group {match.g} · Match #{match.no}</span>
          </div>

          <h3 className="report__title">
            {match.t1} {gh} – {ga} {match.t2}
          </h3>

          <p className="report__narrative">{narrative}</p>

          {topPerformers.length > 0 && (
            <div className="report__section">
              <h4 className="report__h4">Player of the Match</h4>
              {topPerformers.map((p, i) => (
                <div key={i} className="report__potm">
                  <span className="report__potm-rating">{parseFloat(p.rating || "0").toFixed(1)}</span>
                  <span className="report__potm-name">{p.name}</span>
                  <span className="report__potm-team">{flags[p.team] || "⚽"} {p.team}</span>
                  <span className="report__potm-stats">
                    {p.goals > 0 && `${p.goals}G `}
                    {p.assists > 0 && `${p.assists}A `}
                    {p.passAccuracy && `${p.passAccuracy} pass`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {goals.length > 0 && (
            <div className="report__section">
              <h4 className="report__h4">Goals</h4>
              {goals.map((g, i) => {
                const min = g.extra ? `${g.minute}+${g.extra}'` : `${g.minute}'`;
                return (
                  <div key={i} className="report__goal">
                    <span className="report__goal-min">{min}</span>
                    <span>{eventIcon(g.type, g.detail)} {g.player}</span>
                    <span className="report__goal-team">{flags[g.team] || "⚽"}</span>
                    {g.detail !== "Normal Goal" && <span className="report__goal-detail">({g.detail})</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderSquadColumn(teamName: string) {
    const profile = TEAM_PROFILES[teamName];
    if (!profile) return null;
    const posOrder = ["GK", "DF", "MF", "FW"];
    const byPos: Record<string, PlayerInfo[]> = {};
    for (const p of profile.squad) {
      if (!byPos[p.pos]) byPos[p.pos] = [];
      byPos[p.pos].push(p);
    }
    return (
      <div className="md-squad">
        <div className="md-squad__header">
          <span>{flags[teamName] || "⚽"}</span>
          <span className="md-squad__team">{teamName}</span>
        </div>
        {posOrder.filter(pos => byPos[pos]).map(pos => (
          <div key={pos}>
            <div className="md-squad__pos" style={{ color: posColor(pos) }}>{posLabel(pos)}s</div>
            {byPos[pos].map(p => (
              <div key={p.name} className="md-squad__player" onClick={() => onPlayerClick(p.name, teamName)} role="button" tabIndex={0}>
                {p.number != null && <span className="md-squad__num">{p.number}</span>}
                <span className="md-squad__name">{p.name}</span>
                <span className="md-squad__club">{p.club}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  function renderUpcomingBody() {
    const profile1 = TEAM_PROFILES[match.t1];
    const profile2 = TEAM_PROFILES[match.t2];
    return (
      <>
        <div className="md-drawer__venue">
          {v.common} · {v.city}, {v.country}
          <br />{match.et}{match.local !== match.et ? ` (${match.local})` : ""}
        </div>
        <div className="md-drawer__prematch">
          <div className="md-drawer__prematch-row">
            <button className="md-drawer__prematch-team" onClick={() => onTeamClick(match.t1)}>
              <span className="md-drawer__prematch-flag">{flags[match.t1] || "⚽"}</span>
              <span>{match.t1}</span>
              <span className="md-drawer__prematch-arrow">→</span>
            </button>
          </div>
          <div className="md-drawer__prematch-row">
            <button className="md-drawer__prematch-team" onClick={() => onTeamClick(match.t2)}>
              <span className="md-drawer__prematch-flag">{flags[match.t2] || "⚽"}</span>
              <span>{match.t2}</span>
              <span className="md-drawer__prematch-arrow">→</span>
            </button>
          </div>
        </div>

        {(profile1 || profile2) && (
          <div className="drawer__section">
            <h3 className="drawer__h3">Official Squads</h3>
            {renderSquadColumn(match.t1)}
            {renderSquadColumn(match.t2)}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer md-drawer" onClick={e => e.stopPropagation()}>
        {renderScoreHeader()}
        <div className="drawer__body">
          {isUpcoming && renderUpcomingBody()}
          {!isUpcoming && tab === "summary" && renderSummaryTab()}
          {!isUpcoming && tab === "stats" && renderStatsTab()}
          {!isUpcoming && tab === "lineups" && renderLineupsTab()}
          {!isUpcoming && tab === "report" && renderReportTab()}
        </div>
      </div>
    </div>
  );
}

/** Stats view — tournament dashboard with visualizations */
function StatsView({ data, fixtures, fl, computeLeaders }: {
  data: TournamentData;
  fixtures: LiveFixture[];
  fl: (t: string) => string;
  computeLeaders: () => {
    topScorers: { name: string; team: string; goals: number; penalties: number }[];
    topAssisters: { name: string; team: string; assists: number }[];
    topTeams: { team: string; goals: number }[];
    mostCarded: { name: string; team: string; yellows: number; reds: number }[];
    minuteBuckets: number[];
    bucketLabels: string[];
    totalGoals: number;
    normalGoals: number;
    penGoals: number;
    ownGoals: number;
    totalYellows: number;
    totalReds: number;
    totalSubs: number;
    matchesPlayed: number;
    avgGoals: number;
    cleanSheets: number;
  };
}) {
  const stats = useMemo(() => computeLeaders(), [fixtures, computeLeaders]);
  const {
    topScorers, topAssisters, topTeams, mostCarded,
    minuteBuckets, bucketLabels,
    totalGoals, normalGoals, penGoals, ownGoals,
    totalYellows, totalReds, totalSubs,
    matchesPlayed, avgGoals, cleanSheets,
  } = stats;
  const hasData = topScorers.length > 0 || topAssisters.length > 0;
  const hasCards = totalYellows > 0 || totalReds > 0;
  const maxBucket = Math.max(...minuteBuckets, 1);
  const maxScorerGoals = topScorers.length > 0 ? topScorers[0].goals : 1;
  const maxTeamGoals = topTeams.length > 0 ? topTeams[0].goals : 1;

  return (
    <main className="section stats-view">
      {/* Trophy hero */}
      <div className="stats-trophy">
        <WorldCupTrophy id="st" className="stats-trophy__svg" />
      </div>

      {!hasData && !hasCards && (
        <div className="stats-empty">
          <p>Goal and assist tallies appear here once matches finish.</p>
          <p className="stats-empty__sub">Data updates automatically from live match events.</p>
        </div>
      )}

      {/* ── Tournament summary cards — two rows ── */}
      {(hasData || hasCards) && (
        <>
          <div className="stats-summary">
            <div className="stats-card stagger-rise">
              <span className="stats-card__value">{totalGoals}</span>
              <span className="stats-card__label">Goals</span>
            </div>
            <div className="stats-card stagger-rise">
              <span className="stats-card__value">{matchesPlayed}</span>
              <span className="stats-card__label">Matches</span>
            </div>
            <div className="stats-card stagger-rise">
              <span className="stats-card__value">{avgGoals}</span>
              <span className="stats-card__label">Avg / Match</span>
            </div>
            <div className="stats-card stagger-rise">
              <span className="stats-card__value">{cleanSheets}</span>
              <span className="stats-card__label">Clean Sheets</span>
            </div>
          </div>
          <div className="stats-summary stats-summary--secondary">
            <div className="stats-card stats-card--yellow stagger-rise">
              <span className="stats-card__value">{totalYellows}</span>
              <span className="stats-card__label">Yellows</span>
            </div>
            <div className="stats-card stats-card--red stagger-rise">
              <span className="stats-card__value">{totalReds}</span>
              <span className="stats-card__label">Reds</span>
            </div>
            <div className="stats-card stats-card--sub stagger-rise">
              <span className="stats-card__value">{totalSubs}</span>
              <span className="stats-card__label">Subs</span>
            </div>
          </div>
        </>
      )}

      {/* ── Goal type breakdown ── */}
      {totalGoals > 0 && (
        <section className="stats-section">
          <h3 className="stats-heading">Goal Types</h3>
          <div className="stats-type-row">
            <div className="stats-type-item">
              <div className="stats-type-bar" style={{ "--bar-pct": `${(normalGoals / totalGoals) * 100}%` } as React.CSSProperties}>
                <span className="stats-type-fill stats-type-fill--normal" />
              </div>
              <span className="stats-type-count">{normalGoals}</span>
              <span className="stats-type-label">Open Play</span>
            </div>
            <div className="stats-type-item">
              <div className="stats-type-bar" style={{ "--bar-pct": `${(penGoals / totalGoals) * 100}%` } as React.CSSProperties}>
                <span className="stats-type-fill stats-type-fill--pen" />
              </div>
              <span className="stats-type-count">{penGoals}</span>
              <span className="stats-type-label">Penalty</span>
            </div>
            <div className="stats-type-item">
              <div className="stats-type-bar" style={{ "--bar-pct": `${(ownGoals / totalGoals) * 100}%` } as React.CSSProperties}>
                <span className="stats-type-fill stats-type-fill--og" />
              </div>
              <span className="stats-type-count">{ownGoals}</span>
              <span className="stats-type-label">Own Goal</span>
            </div>
          </div>
        </section>
      )}

      {/* ── Goals by minute distribution ── */}
      {totalGoals > 0 && (
        <section className="stats-section">
          <h3 className="stats-heading">When Goals Are Scored</h3>
          <div className="stats-chart">
            {minuteBuckets.map((count, i) => (
              <div key={bucketLabels[i]} className="stats-bar-col">
                <span className="stats-bar-val">{count || ""}</span>
                <div className="stats-bar" style={{ "--bar-h": `${(count / maxBucket) * 100}%` } as React.CSSProperties} />
                <span className="stats-bar-label">{bucketLabels[i]}</span>
              </div>
            ))}
          </div>
          <div className="stats-chart-axis">Minutes</div>
        </section>
      )}

      {/* ── Top Scorers with visual bars ── */}
      {topScorers.length > 0 && (
        <section className="stats-section">
          <h3 className="stats-heading">Top Scorers</h3>
          <div className="stats-scorer-list">
            {topScorers.slice(0, 10).map((s, i) => (
              <div key={`${s.name}-${s.team}`} className={`stats-scorer stagger-rise${i < 3 ? ` stats-scorer--${["gold","silver","bronze"][i]}` : ""}`}>
                <span className="stats-scorer__rank">{i + 1}</span>
                <span className="stats-scorer__flag">{fl(s.team)}</span>
                <div className="stats-scorer__info">
                  <span className="stats-scorer__name">{s.name}</span>
                  <span className="stats-scorer__team">{s.team}</span>
                </div>
                <div className="stats-scorer__bar-wrap">
                  <div className="stats-scorer__bar" style={{ "--bar-w": `${(s.goals / maxScorerGoals) * 100}%` } as React.CSSProperties} />
                </div>
                <span className="stats-scorer__goals">{s.goals}</span>
                {s.penalties > 0 && <span className="stats-scorer__pen">({s.penalties}p)</span>}
              </div>
            ))}
          </div>
          {topScorers.length > 10 && (
            <details className="stats-expand">
              <summary>Show all {topScorers.length} scorers</summary>
              <div className="stats-scorer-list">
                {topScorers.slice(10).map((s, i) => (
                  <div key={`${s.name}-${s.team}`} className="stats-scorer">
                    <span className="stats-scorer__rank">{i + 11}</span>
                    <span className="stats-scorer__flag">{fl(s.team)}</span>
                    <div className="stats-scorer__info">
                      <span className="stats-scorer__name">{s.name}</span>
                      <span className="stats-scorer__team">{s.team}</span>
                    </div>
                    <div className="stats-scorer__bar-wrap">
                      <div className="stats-scorer__bar" style={{ "--bar-w": `${(s.goals / maxScorerGoals) * 100}%` } as React.CSSProperties} />
                    </div>
                    <span className="stats-scorer__goals">{s.goals}</span>
                    {s.penalties > 0 && <span className="stats-scorer__pen">({s.penalties}p)</span>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {/* ── Top Assists ── */}
      {topAssisters.length > 0 && (
        <section className="stats-section">
          <h3 className="stats-heading">Top Assists</h3>
          <div className="stats-scorer-list">
            {topAssisters.slice(0, 10).map((a, i) => (
              <div key={`${a.name}-${a.team}`} className={`stats-scorer stagger-rise${i < 3 ? ` stats-scorer--${["gold","silver","bronze"][i]}` : ""}`}>
                <span className="stats-scorer__rank">{i + 1}</span>
                <span className="stats-scorer__flag">{fl(a.team)}</span>
                <div className="stats-scorer__info">
                  <span className="stats-scorer__name">{a.name}</span>
                  <span className="stats-scorer__team">{a.team}</span>
                </div>
                <div className="stats-scorer__bar-wrap">
                  <div className="stats-scorer__bar stats-scorer__bar--assist" style={{ "--bar-w": `${(a.assists / (topAssisters[0]?.assists || 1)) * 100}%` } as React.CSSProperties} />
                </div>
                <span className="stats-scorer__goals">{a.assists}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Discipline — most carded players ── */}
      {mostCarded.length > 0 && (
        <section className="stats-section">
          <h3 className="stats-heading">Discipline</h3>
          <div className="stats-scorer-list">
            {mostCarded.map((c, i) => (
              <div key={`${c.name}-${c.team}`} className="stats-scorer stagger-rise">
                <span className="stats-scorer__rank">{i + 1}</span>
                <span className="stats-scorer__flag">{fl(c.team)}</span>
                <div className="stats-scorer__info">
                  <span className="stats-scorer__name">{c.name}</span>
                  <span className="stats-scorer__team">{c.team}</span>
                </div>
                <div className="stats-card-icons">
                  {c.yellows > 0 && <span className="stats-card-icon stats-card-icon--yellow" title="Yellow cards">{c.yellows > 1 ? `${c.yellows}x` : ""}🟨</span>}
                  {c.reds > 0 && <span className="stats-card-icon stats-card-icon--red" title="Red cards">{c.reds > 1 ? `${c.reds}x` : ""}🟥</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Team Goals leaderboard ── */}
      {topTeams.length > 0 && (
        <section className="stats-section">
          <h3 className="stats-heading">Goals by Team</h3>
          <div className="stats-scorer-list">
            {topTeams.map((t, i) => (
              <div key={t.team} className="stats-team-row stagger-rise">
                <span className="stats-scorer__rank">{i + 1}</span>
                <span className="stats-scorer__flag" style={{ fontSize: 20 }}>{fl(t.team)}</span>
                <div className="stats-scorer__info">
                  <span className="stats-scorer__name">{t.team}</span>
                </div>
                <div className="stats-scorer__bar-wrap">
                  <div className="stats-scorer__bar stats-scorer__bar--team" style={{ "--bar-w": `${(t.goals / maxTeamGoals) * 100}%` } as React.CSSProperties} />
                </div>
                <span className="stats-scorer__goals">{t.goals}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

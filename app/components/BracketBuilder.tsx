"use client";
import { useState, useCallback, useRef, useEffect } from "react";

/* ── types ─────────────────────────────────────────────────────── */

interface BracketBuilderProps {
  flags: Record<string, string>;
  teams: string[];
}

interface BracketPicks {
  /* R32 slots: 16 matchups, each with teamA and teamB + winner */
  r32: { a: string; b: string; winner: string }[];
  /* R16 winners (8) */
  r16: string[];
  /* QF winners (4) */
  qf: string[];
  /* SF winners (2) */
  sf: string[];
  /* Final winner */
  champion: string;
  /* Third place winner */
  thirdPlace: string;
}

/* ── bracket structure ─────────────────────────────────────────── */

/* R32 matchup labels based on FIFA 48-team format.
   Group positions map to R32 slots — users pick teams into these. */
const R32_LABELS = [
  ["1A", "3C/D/E"], ["2C", "2A"], ["1E", "2D"], ["1F", "3A/B/F"],
  ["1B", "3A/D/F"], ["2D", "2F"], ["1C", "3B/C/E"], ["2B", "2E"],
  ["1G", "3I/J/K"], ["2I", "2G"], ["1K", "2J"], ["1L", "3H/I/K"],
  ["1H", "3G/J/L"], ["2J", "2L"], ["1I", "3G/H/L"], ["2H", "2K"],
];

const ROUNDS = ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final"] as const;

const STORAGE_KEY = "wc2026-bracket-picks";

function emptyPicks(): BracketPicks {
  return {
    r32: R32_LABELS.map(([a, b]) => ({ a: "", b: "", winner: "" })),
    r16: Array(8).fill(""),
    qf: Array(4).fill(""),
    sf: Array(2).fill(""),
    champion: "",
    thirdPlace: "",
  };
}

function loadPicks(): BracketPicks {
  if (typeof window === "undefined") return emptyPicks();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return emptyPicks();
}

function savePicks(picks: BracketPicks) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(picks)); } catch { /* ignore */ }
}

/* ── component ─────────────────────────────────────────────────── */

export default function BracketBuilder({ flags, teams }: BracketBuilderProps) {
  const [picks, setPicks] = useState<BracketPicks>(emptyPicks);
  const [activeSlot, setActiveSlot] = useState<{ round: string; index: number; side: "a" | "b" | "winner" } | null>(null);
  const [search, setSearch] = useState("");
  const [generating, setGenerating] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* Load saved picks on mount */
  useEffect(() => { setPicks(loadPicks()); }, []);

  /* Save whenever picks change */
  useEffect(() => { savePicks(picks); }, [picks]);

  const fl = (t: string) => flags[t] || "⚽";

  /* Pick a team for a slot */
  const pickTeam = useCallback((team: string) => {
    if (!activeSlot) return;
    setPicks(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as BracketPicks;
      const { round, index, side } = activeSlot;

      if (round === "r32") {
        if (side === "a") next.r32[index].a = team;
        else if (side === "b") next.r32[index].b = team;
        else {
          next.r32[index].winner = team;
          /* Cascade: winner flows to R16 */
          const r16Idx = Math.floor(index / 2);
          if (index % 2 === 0) {
            /* This R32 winner becomes the "top" team in R16 matchup — just set the R16 slot if it was this pick */
          }
          next.r16[r16Idx] = cascadeR16(next, r16Idx);
        }
      } else if (round === "r16") {
        next.r16[index] = team;
        const qfIdx = Math.floor(index / 2);
        next.qf[qfIdx] = cascadeQF(next, qfIdx);
      } else if (round === "qf") {
        next.qf[index] = team;
        const sfIdx = Math.floor(index / 2);
        next.sf[sfIdx] = cascadeSF(next, sfIdx);
      } else if (round === "sf") {
        next.sf[index] = team;
        if (next.sf[0] && next.sf[1]) {
          /* Don't auto-set champion, let user pick */
        }
      } else if (round === "champion") {
        next.champion = team;
      } else if (round === "thirdPlace") {
        next.thirdPlace = team;
      }

      return next;
    });
    setActiveSlot(null);
    setSearch("");
  }, [activeSlot]);

  /* Clear all picks */
  const clearAll = () => {
    setPicks(emptyPicks());
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  };

  /* Count filled picks */
  const filledCount =
    picks.r32.filter(m => m.a && m.b && m.winner).length +
    picks.r16.filter(Boolean).length +
    picks.qf.filter(Boolean).length +
    picks.sf.filter(Boolean).length +
    (picks.champion ? 1 : 0);
  const totalSlots = 16 + 8 + 4 + 2 + 1;

  /* ── Image generation ──────────────────────────────────────── */

  const generateImage = useCallback(async () => {
    setGenerating(true);
    await new Promise(r => setTimeout(r, 50));

    const W = 1080, H = 1350;
    const canvas = canvasRef.current;
    if (!canvas) { setGenerating(false); return; }
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    /* Background gradient */
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0a0f1a");
    grad.addColorStop(0.5, "#0d1520");
    grad.addColorStop(1, "#0a0a12");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    /* Subtle grid lines */
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    /* Title */
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 42px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("MY WORLD CUP 2026", W / 2, 60);
    ctx.font = "bold 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillStyle = "#c9a84c";
    ctx.fillText("BRACKET", W / 2, 96);

    /* Hosts line */
    ctx.font = "16px -apple-system, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText("🇨🇦  🇲🇽  🇺🇸   Canada · Mexico · United States", W / 2, 126);

    /* Draw bracket halves */
    const bracketTop = 160;
    const slotH = 26;
    const slotGap = 4;
    const matchH = slotH * 2 + slotGap;
    const colW = 160;
    const leftX = 30;
    const rightX = W - 30 - colW;

    /* Helper: draw a team slot */
    function drawSlot(x: number, y: number, w: number, team: string, isWinner: boolean, isChampion: boolean) {
      /* Background */
      ctx.fillStyle = isChampion ? "rgba(201,168,76,0.25)" : isWinner ? "rgba(31,138,107,0.2)" : "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.roundRect(x, y, w, slotH, 4);
      ctx.fill();

      /* Border */
      ctx.strokeStyle = isChampion ? "#c9a84c" : isWinner ? "rgba(31,138,107,0.6)" : "rgba(255,255,255,0.1)";
      ctx.lineWidth = isChampion ? 2 : 1;
      ctx.stroke();

      /* Team text */
      if (team) {
        ctx.textAlign = "left";
        ctx.font = "14px -apple-system, sans-serif";
        ctx.fillStyle = isChampion ? "#c9a84c" : isWinner ? "#1F8A6B" : "#ffffff";
        const flag = flags[team] || "";
        ctx.fillText(`${flag} ${team}`, x + 6, y + 18);
      } else {
        ctx.textAlign = "left";
        ctx.font = "italic 12px -apple-system, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.fillText("—", x + 6, y + 18);
      }
    }

    /* Helper: draw a connector line between rounds */
    function drawConnector(x1: number, y1: number, x2: number, y2: number) {
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const midX = (x1 + x2) / 2;
      ctx.moveTo(x1, y1);
      ctx.lineTo(midX, y1);
      ctx.lineTo(midX, y2);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    /* ── LEFT BRACKET (R32 matches 0-7) ── */
    const leftR32Y = bracketTop;
    const r32MatchGap = 12;

    /* R32 left */
    for (let i = 0; i < 8; i++) {
      const m = picks.r32[i];
      const y = leftR32Y + i * (matchH + r32MatchGap);
      drawSlot(leftX, y, colW - 10, m.a, m.winner === m.a && m.a !== "", false);
      drawSlot(leftX, y + slotH + slotGap, colW - 10, m.b, m.winner === m.b && m.b !== "", false);
    }

    /* R16 left (4 matches) */
    const r16X = leftX + colW + 10;
    for (let i = 0; i < 4; i++) {
      const topMatch = i * 2;
      const botMatch = i * 2 + 1;
      const topY = leftR32Y + topMatch * (matchH + r32MatchGap) + matchH / 2;
      const botY = leftR32Y + botMatch * (matchH + r32MatchGap) + matchH / 2;
      const midY = (topY + botY) / 2;

      /* Connector lines */
      drawConnector(leftX + colW - 10, topY, r16X, midY - slotH / 2 - slotGap / 2);
      drawConnector(leftX + colW - 10, botY, r16X, midY + slotH / 2 + slotGap / 2);

      const winner0 = picks.r32[topMatch].winner;
      const winner1 = picks.r32[botMatch].winner;
      const r16winner = picks.r16[i];
      drawSlot(r16X, midY - slotH - slotGap / 2, colW - 10, winner0, r16winner === winner0 && winner0 !== "", false);
      drawSlot(r16X, midY + slotGap / 2, colW - 10, winner1, r16winner === winner1 && winner1 !== "", false);
    }

    /* QF left (2 matches) */
    const qfX = r16X + colW + 10;
    for (let i = 0; i < 2; i++) {
      const topR16 = i * 2;
      const botR16 = i * 2 + 1;
      const topTopMatch = topR16 * 2;
      const topBotMatch = topR16 * 2 + 1;
      const botTopMatch = botR16 * 2;
      const botBotMatch = botR16 * 2 + 1;

      const topY = (leftR32Y + topTopMatch * (matchH + r32MatchGap) + matchH / 2 + leftR32Y + topBotMatch * (matchH + r32MatchGap) + matchH / 2) / 2;
      const botY = (leftR32Y + botTopMatch * (matchH + r32MatchGap) + matchH / 2 + leftR32Y + botBotMatch * (matchH + r32MatchGap) + matchH / 2) / 2;
      const midY = (topY + botY) / 2;

      drawConnector(r16X + colW - 10, topY, qfX, midY - slotH - slotGap / 2);
      drawConnector(r16X + colW - 10, botY, qfX, midY + slotGap / 2);

      const r16a = picks.r16[topR16];
      const r16b = picks.r16[botR16];
      const qfWinner = picks.qf[i];
      drawSlot(qfX, midY - slotH - slotGap / 2, colW - 10, r16a, qfWinner === r16a && r16a !== "", false);
      drawSlot(qfX, midY + slotGap / 2, colW - 10, r16b, qfWinner === r16b && r16b !== "", false);
    }

    /* SF left */
    const sfX = qfX + colW + 10;
    const sfLeftY = (bracketTop + 3.5 * (matchH + r32MatchGap)) / 1 + 180;
    const sfLeftTeam = picks.sf[0];
    drawSlot(sfX, sfLeftY, colW - 10, picks.qf[0], sfLeftTeam === picks.qf[0] && picks.qf[0] !== "", false);
    drawSlot(sfX, sfLeftY + slotH + slotGap, colW - 10, picks.qf[1], sfLeftTeam === picks.qf[1] && picks.qf[1] !== "", false);

    /* ── RIGHT BRACKET (R32 matches 8-15) ── */
    for (let i = 0; i < 8; i++) {
      const m = picks.r32[i + 8];
      const y = leftR32Y + i * (matchH + r32MatchGap);
      drawSlot(rightX + 10, y, colW - 10, m.a, m.winner === m.a && m.a !== "", false);
      drawSlot(rightX + 10, y + slotH + slotGap, colW - 10, m.b, m.winner === m.b && m.b !== "", false);
    }

    /* R16 right */
    const r16RX = rightX - colW + 10;
    for (let i = 0; i < 4; i++) {
      const topMatch = i * 2 + 8;
      const botMatch = i * 2 + 9;
      const topY = leftR32Y + (topMatch - 8) * (matchH + r32MatchGap) + matchH / 2;
      const botY = leftR32Y + (botMatch - 8) * (matchH + r32MatchGap) + matchH / 2;
      const midY = (topY + botY) / 2;

      drawConnector(rightX + 10, topY, r16RX + colW - 10, midY);
      drawConnector(rightX + 10, botY, r16RX + colW - 10, midY);

      const winner0 = picks.r32[topMatch].winner;
      const winner1 = picks.r32[botMatch].winner;
      const r16winner = picks.r16[i + 4];
      drawSlot(r16RX, midY - slotH - slotGap / 2, colW - 10, winner0, r16winner === winner0 && winner0 !== "", false);
      drawSlot(r16RX, midY + slotGap / 2, colW - 10, winner1, r16winner === winner1 && winner1 !== "", false);
    }

    /* QF right */
    const qfRX = r16RX - colW;
    for (let i = 0; i < 2; i++) {
      const topR16 = i * 2 + 4;
      const botR16 = i * 2 + 5;
      const topTopMatch = (topR16 - 4) * 2;
      const topBotMatch = (topR16 - 4) * 2 + 1;
      const botTopMatch = (botR16 - 4) * 2;
      const botBotMatch = (botR16 - 4) * 2 + 1;

      const topY = (leftR32Y + topTopMatch * (matchH + r32MatchGap) + matchH / 2 + leftR32Y + topBotMatch * (matchH + r32MatchGap) + matchH / 2) / 2;
      const botY = (leftR32Y + botTopMatch * (matchH + r32MatchGap) + matchH / 2 + leftR32Y + botBotMatch * (matchH + r32MatchGap) + matchH / 2) / 2;
      const midY = (topY + botY) / 2;

      const r16a = picks.r16[topR16];
      const r16b = picks.r16[botR16];
      const qfWinner = picks.qf[i + 2];
      drawSlot(qfRX + 10, midY - slotH - slotGap / 2, colW - 10, r16a, qfWinner === r16a && r16a !== "", false);
      drawSlot(qfRX + 10, midY + slotGap / 2, colW - 10, r16b, qfWinner === r16b && r16b !== "", false);
    }

    /* SF right */
    const sfRightTeam = picks.sf[1];
    drawSlot(sfX, sfLeftY + 80, colW - 10, picks.qf[2], sfRightTeam === picks.qf[2] && picks.qf[2] !== "", false);
    drawSlot(sfX, sfLeftY + 80 + slotH + slotGap, colW - 10, picks.qf[3], sfRightTeam === picks.qf[3] && picks.qf[3] !== "", false);

    /* ── FINAL ── */
    const finalY = sfLeftY + 40;
    const finalX = W / 2 - colW / 2;

    /* Champion crown */
    if (picks.champion) {
      ctx.textAlign = "center";
      ctx.font = "40px -apple-system, sans-serif";
      ctx.fillText("👑", W / 2, finalY - 20);

      ctx.font = "bold 22px -apple-system, sans-serif";
      ctx.fillStyle = "#c9a84c";
      ctx.fillText(picks.champion.toUpperCase(), W / 2, finalY + 6);
      ctx.fillStyle = "#ffffff";
    }

    /* Final matchup */
    drawSlot(finalX, finalY + 16, colW, picks.sf[0], picks.champion === picks.sf[0] && picks.sf[0] !== "", picks.champion === picks.sf[0]);
    ctx.textAlign = "center";
    ctx.font = "bold 11px -apple-system, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillText("FINAL", W / 2, finalY + 16 + slotH + slotGap + 8);
    drawSlot(finalX, finalY + 16 + slotH + slotGap + 14, colW, picks.sf[1], picks.champion === picks.sf[1] && picks.sf[1] !== "", picks.champion === picks.sf[1]);

    /* Footer watermark */
    ctx.textAlign = "center";
    ctx.font = "13px -apple-system, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillText("wc2026-xi-gray.vercel.app", W / 2, H - 20);

    /* Download */
    canvas.toBlob((blob) => {
      if (!blob) { setGenerating(false); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-wc2026-bracket.png";
      a.click();
      URL.revokeObjectURL(url);
      setGenerating(false);
    }, "image/png");
  }, [picks, flags]);

  /* ── Team picker modal ── */
  const filteredTeams = search
    ? teams.filter(t => t.toLowerCase().includes(search.toLowerCase()))
    : teams;

  /* Already picked teams for visual indicator */
  const pickedTeams = new Set<string>();
  picks.r32.forEach(m => { if (m.a) pickedTeams.add(m.a); if (m.b) pickedTeams.add(m.b); });

  return (
    <div className="bracket-builder">
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Header */}
      <div className="bb-header">
        <h2 className="bb-title">My Bracket</h2>
        <p className="bb-sub">Pick your winners from Round of 32 to the Final, then save and share your bracket on Instagram.</p>
        <div className="bb-progress">
          <div className="bb-progress__bar" style={{ width: `${(filledCount / totalSlots) * 100}%` }} />
          <span className="bb-progress__label">{filledCount}/{totalSlots} picks</span>
        </div>
      </div>

      {/* Round-by-round picker */}
      <div className="bb-rounds">
        {/* R32 */}
        <div className="bb-round">
          <div className="bb-round__hd">Round of 32 <span className="bb-round__count">{picks.r32.filter(m => m.winner).length}/16</span></div>
          <div className="bb-matches">
            {picks.r32.map((m, i) => (
              <div key={i} className="bb-match">
                <div className="bb-match__label">Match {73 + i} · {R32_LABELS[i].join(" vs ")}</div>
                <button
                  className={`bb-slot${m.winner === m.a && m.a ? " bb-slot--winner" : ""}`}
                  onClick={() => { setActiveSlot({ round: "r32", index: i, side: "a" }); setSearch(""); }}
                >
                  {m.a ? `${fl(m.a)} ${m.a}` : <span className="bb-slot__empty">Pick team ({R32_LABELS[i][0]})</span>}
                </button>
                <button
                  className={`bb-slot${m.winner === m.b && m.b ? " bb-slot--winner" : ""}`}
                  onClick={() => { setActiveSlot({ round: "r32", index: i, side: "b" }); setSearch(""); }}
                >
                  {m.b ? `${fl(m.b)} ${m.b}` : <span className="bb-slot__empty">Pick team ({R32_LABELS[i][1]})</span>}
                </button>
                {m.a && m.b && (
                  <div className="bb-match__pick">
                    <span className="bb-match__pick-label">Winner:</span>
                    <button
                      className={`bb-pick-btn${m.winner === m.a ? " bb-pick-btn--active" : ""}`}
                      onClick={() => { setPicks(p => { const n = JSON.parse(JSON.stringify(p)); n.r32[i].winner = m.a; return n; }); }}
                    >{fl(m.a)} {m.a}</button>
                    <button
                      className={`bb-pick-btn${m.winner === m.b ? " bb-pick-btn--active" : ""}`}
                      onClick={() => { setPicks(p => { const n = JSON.parse(JSON.stringify(p)); n.r32[i].winner = m.b; return n; }); }}
                    >{fl(m.b)} {m.b}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* R16 */}
        <div className="bb-round">
          <div className="bb-round__hd">Round of 16 <span className="bb-round__count">{picks.r16.filter(Boolean).length}/8</span></div>
          <div className="bb-matches">
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
              const teamA = picks.r32[i * 2]?.winner || "";
              const teamB = picks.r32[i * 2 + 1]?.winner || "";
              return (
                <div key={i} className="bb-match">
                  <div className="bb-match__label">Match {89 + i}</div>
                  <div className="bb-slot bb-slot--readonly">{teamA ? `${fl(teamA)} ${teamA}` : "—"}</div>
                  <div className="bb-slot bb-slot--readonly">{teamB ? `${fl(teamB)} ${teamB}` : "—"}</div>
                  {teamA && teamB && (
                    <div className="bb-match__pick">
                      <span className="bb-match__pick-label">Winner:</span>
                      <button
                        className={`bb-pick-btn${picks.r16[i] === teamA ? " bb-pick-btn--active" : ""}`}
                        onClick={() => setPicks(p => { const n = JSON.parse(JSON.stringify(p)); n.r16[i] = teamA; return n; })}
                      >{fl(teamA)} {teamA}</button>
                      <button
                        className={`bb-pick-btn${picks.r16[i] === teamB ? " bb-pick-btn--active" : ""}`}
                        onClick={() => setPicks(p => { const n = JSON.parse(JSON.stringify(p)); n.r16[i] = teamB; return n; })}
                      >{fl(teamB)} {teamB}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* QF */}
        <div className="bb-round">
          <div className="bb-round__hd">Quarter-finals <span className="bb-round__count">{picks.qf.filter(Boolean).length}/4</span></div>
          <div className="bb-matches">
            {[0, 1, 2, 3].map(i => {
              const teamA = picks.r16[i * 2] || "";
              const teamB = picks.r16[i * 2 + 1] || "";
              return (
                <div key={i} className="bb-match">
                  <div className="bb-match__label">Match {97 + i}</div>
                  <div className="bb-slot bb-slot--readonly">{teamA ? `${fl(teamA)} ${teamA}` : "—"}</div>
                  <div className="bb-slot bb-slot--readonly">{teamB ? `${fl(teamB)} ${teamB}` : "—"}</div>
                  {teamA && teamB && (
                    <div className="bb-match__pick">
                      <span className="bb-match__pick-label">Winner:</span>
                      <button
                        className={`bb-pick-btn${picks.qf[i] === teamA ? " bb-pick-btn--active" : ""}`}
                        onClick={() => setPicks(p => { const n = JSON.parse(JSON.stringify(p)); n.qf[i] = teamA; return n; })}
                      >{fl(teamA)} {teamA}</button>
                      <button
                        className={`bb-pick-btn${picks.qf[i] === teamB ? " bb-pick-btn--active" : ""}`}
                        onClick={() => setPicks(p => { const n = JSON.parse(JSON.stringify(p)); n.qf[i] = teamB; return n; })}
                      >{fl(teamB)} {teamB}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* SF */}
        <div className="bb-round">
          <div className="bb-round__hd">Semi-finals <span className="bb-round__count">{picks.sf.filter(Boolean).length}/2</span></div>
          <div className="bb-matches">
            {[0, 1].map(i => {
              const teamA = picks.qf[i * 2] || "";
              const teamB = picks.qf[i * 2 + 1] || "";
              return (
                <div key={i} className="bb-match">
                  <div className="bb-match__label">Match {101 + i}</div>
                  <div className="bb-slot bb-slot--readonly">{teamA ? `${fl(teamA)} ${teamA}` : "—"}</div>
                  <div className="bb-slot bb-slot--readonly">{teamB ? `${fl(teamB)} ${teamB}` : "—"}</div>
                  {teamA && teamB && (
                    <div className="bb-match__pick">
                      <span className="bb-match__pick-label">Winner:</span>
                      <button
                        className={`bb-pick-btn${picks.sf[i] === teamA ? " bb-pick-btn--active" : ""}`}
                        onClick={() => setPicks(p => { const n = JSON.parse(JSON.stringify(p)); n.sf[i] = teamA; return n; })}
                      >{fl(teamA)} {teamA}</button>
                      <button
                        className={`bb-pick-btn${picks.sf[i] === teamB ? " bb-pick-btn--active" : ""}`}
                        onClick={() => setPicks(p => { const n = JSON.parse(JSON.stringify(p)); n.sf[i] = teamB; return n; })}
                      >{fl(teamB)} {teamB}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* FINAL */}
        {picks.sf[0] && picks.sf[1] && (
          <div className="bb-round bb-round--final">
            <div className="bb-round__hd">🏆 Final <span className="bb-round__count">{picks.champion ? "1/1" : "0/1"}</span></div>
            <div className="bb-final">
              <button
                className={`bb-final-btn${picks.champion === picks.sf[0] ? " bb-final-btn--active" : ""}`}
                onClick={() => setPicks(p => ({ ...p, champion: p.sf[0] }))}
              >
                <span className="bb-final-flag">{fl(picks.sf[0])}</span>
                <span className="bb-final-name">{picks.sf[0]}</span>
              </button>
              <span className="bb-final-vs">vs</span>
              <button
                className={`bb-final-btn${picks.champion === picks.sf[1] ? " bb-final-btn--active" : ""}`}
                onClick={() => setPicks(p => ({ ...p, champion: p.sf[1] }))}
              >
                <span className="bb-final-flag">{fl(picks.sf[1])}</span>
                <span className="bb-final-name">{picks.sf[1]}</span>
              </button>
            </div>
            {picks.champion && (
              <div className="bb-champion">
                <div className="bb-champion__crown">👑</div>
                <div className="bb-champion__flag">{fl(picks.champion)}</div>
                <div className="bb-champion__name">{picks.champion}</div>
                <div className="bb-champion__label">YOUR PREDICTED CHAMPION</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="bb-actions">
        <button
          className="bb-share-btn"
          onClick={generateImage}
          disabled={generating || filledCount < 5}
        >
          {generating ? "Generating..." : "📸 Save My Bracket"}
        </button>
        <button className="bb-clear-btn" onClick={clearAll}>Clear All</button>
      </div>
      <p className="bb-share-hint">Downloads a 1080×1350 image perfect for Instagram stories and posts</p>

      {/* Team picker overlay */}
      {activeSlot && (
        <div className="bb-overlay" onClick={() => setActiveSlot(null)}>
          <div className="bb-picker" onClick={e => e.stopPropagation()}>
            <div className="bb-picker__hd">
              <span>Pick a team</span>
              <button className="bb-picker__close" onClick={() => setActiveSlot(null)}>✕</button>
            </div>
            <input
              className="bb-picker__search"
              placeholder="Search teams..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
            <div className="bb-picker__list">
              {filteredTeams.map(t => (
                <button
                  key={t}
                  className={`bb-picker__team${pickedTeams.has(t) ? " bb-picker__team--used" : ""}`}
                  onClick={() => pickTeam(t)}
                >
                  <span className="bb-picker__flag">{fl(t)}</span>
                  <span>{t}</span>
                  {pickedTeams.has(t) && <span className="bb-picker__check">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Cascade helpers — return the team that should auto-fill the next round slot.
   Returns empty string if both feeder picks aren't made yet. */
function cascadeR16(picks: BracketPicks, idx: number): string {
  /* R16 slot idx is fed by R32 matches idx*2 and idx*2+1 */
  return picks.r16[idx]; // don't auto-cascade, let user pick
}
function cascadeQF(picks: BracketPicks, idx: number): string {
  return picks.qf[idx];
}
function cascadeSF(picks: BracketPicks, idx: number): string {
  return picks.sf[idx];
}

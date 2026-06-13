"use client";
import { useState, useRef, useEffect, useCallback } from "react";

/* ── types ─────────────────────────────────────────────────────── */

interface BracketBuilderProps {
  flags: Record<string, string>;
  groups: Record<string, string[]>;
  gcolor: Record<string, string>;
}

/* Group predictions: 1st, 2nd, 3rd for each group */
type GroupPredictions = Record<string, { first: string; second: string; third: string }>;

/* Knockout picks: winner of each matchup */
interface KnockoutPicks {
  r32: (string | null)[];   /* 16 winners */
  r16: (string | null)[];   /* 8 winners */
  qf:  (string | null)[];   /* 4 winners */
  sf:  (string | null)[];   /* 2 winners */
  champion: string | null;
}

/* R32 bracket slots — maps each match to the group positions that feed it.
   Format: [topSeed, bottomSeed]. Seeds like "1A" mean "winner of Group A".
   "3*" slots are best-third wildcards — filled after user picks 8 advancing 3rds. */
const R32_STRUCTURE: [string, string][] = [
  ["1A", "3C/D/E"],  ["2C", "2A"],
  ["1E", "2D"],      ["1F", "3A/B/F"],
  ["1B", "3A/D/F"],  ["2D", "2F"],
  ["1C", "3B/C/E"],  ["2B", "2E"],
  ["1G", "3I/J/K"],  ["2I", "2G"],
  ["1K", "2J"],      ["1L", "3H/I/K"],
  ["1H", "3G/J/L"],  ["2J", "2L"],
  ["1I", "3G/H/L"],  ["2H", "2K"],
];

const STORAGE_KEY = "wc2026-bracket-v2";

/* ── helpers ────────────────────────────────────────────────────── */

function emptyGroupPredictions(groups: Record<string, string[]>): GroupPredictions {
  const preds: GroupPredictions = {};
  for (const g of Object.keys(groups)) {
    preds[g] = { first: "", second: "", third: "" };
  }
  return preds;
}

function emptyKnockout(): KnockoutPicks {
  return {
    r32: Array(16).fill(null),
    r16: Array(8).fill(null),
    qf: Array(4).fill(null),
    sf: Array(2).fill(null),
    champion: null,
  };
}

interface SavedState {
  groupPreds: GroupPredictions;
  thirdPlaceAdvancing: string[];
  knockout: KnockoutPicks;
  step: number;
}

function loadState(groups: Record<string, string[]>): SavedState {
  if (typeof window === "undefined") return { groupPreds: emptyGroupPredictions(groups), thirdPlaceAdvancing: [], knockout: emptyKnockout(), step: 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { groupPreds: emptyGroupPredictions(groups), thirdPlaceAdvancing: [], knockout: emptyKnockout(), step: 0 };
}

function saveState(state: SavedState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

/* Resolve a seed like "1A" or "2C" to the actual team name from group predictions */
function resolveSeed(seed: string, groupPreds: GroupPredictions): string {
  if (seed.length < 2) return "";
  const pos = seed[0]; /* "1", "2", or "3" */
  const grp = seed.slice(1);
  const pred = groupPreds[grp];
  if (!pred) return "";
  if (pos === "1") return pred.first;
  if (pos === "2") return pred.second;
  if (pos === "3") return pred.third;
  return "";
}

/* Resolve a 3rd-place wildcard slot like "3C/D/E" to the team,
   given the user's picks for which 3rd-place teams advance */
function resolveThirdPlace(slot: string, groupPreds: GroupPredictions, advancing: string[]): string {
  /* slot is like "3C/D/E" — the 3rd-place team from one of groups C, D, or E */
  const groups = slot.slice(1).split("/");
  for (const g of groups) {
    const third = groupPreds[g]?.third;
    if (third && advancing.includes(third)) return third;
  }
  return "";
}

/* Get the two teams in an R32 matchup */
function getR32Teams(
  matchIdx: number,
  groupPreds: GroupPredictions,
  advancing: string[],
): [string, string] {
  const [topSeed, botSeed] = R32_STRUCTURE[matchIdx];
  const top = topSeed.startsWith("3")
    ? resolveThirdPlace(topSeed, groupPreds, advancing)
    : resolveSeed(topSeed, groupPreds);
  const bot = botSeed.startsWith("3")
    ? resolveThirdPlace(botSeed, groupPreds, advancing)
    : resolveSeed(botSeed, groupPreds);
  return [top, bot];
}

/* ── component ─────────────────────────────────────────────────── */

export default function BracketBuilder({ flags, groups, gcolor }: BracketBuilderProps) {
  const [state, setState] = useState<SavedState>(() => loadState(groups));
  const { groupPreds, thirdPlaceAdvancing, knockout, step } = state;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => { setState(loadState(groups)); }, [groups]);
  useEffect(() => { saveState(state); }, [state]);

  const fl = (t: string) => flags[t] || "⚽";
  const groupLetters = Object.keys(groups).sort();

  /* How many groups are fully predicted */
  const groupsDone = groupLetters.filter(g => groupPreds[g]?.first && groupPreds[g]?.second && groupPreds[g]?.third).length;
  const allGroupsDone = groupsDone === groupLetters.length;

  /* All 3rd-place teams */
  const allThirds = groupLetters.map(g => groupPreds[g]?.third).filter(Boolean);
  const thirdsDone = thirdPlaceAdvancing.length === 8;

  /* Progress */
  const knockoutDone = knockout.r32.filter(Boolean).length + knockout.r16.filter(Boolean).length +
    knockout.qf.filter(Boolean).length + knockout.sf.filter(Boolean).length + (knockout.champion ? 1 : 0);
  const totalKnockout = 16 + 8 + 4 + 2 + 1;

  /* ── Step 0: Group predictions ─────────────────────────────── */

  function setGroupPos(grp: string, pos: "first" | "second" | "third", team: string) {
    setState(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as SavedState;
      const pred = next.groupPreds[grp];
      /* Clear the team from any other position in this group */
      if (pred.first === team) pred.first = "";
      if (pred.second === team) pred.second = "";
      if (pred.third === team) pred.third = "";
      pred[pos] = team;
      /* Clear downstream knockout picks when group predictions change */
      next.knockout = emptyKnockout();
      next.thirdPlaceAdvancing = [];
      return next;
    });
  }

  function toggleThirdAdvancing(team: string) {
    setState(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as SavedState;
      const idx = next.thirdPlaceAdvancing.indexOf(team);
      if (idx >= 0) {
        next.thirdPlaceAdvancing.splice(idx, 1);
      } else if (next.thirdPlaceAdvancing.length < 8) {
        next.thirdPlaceAdvancing.push(team);
      }
      next.knockout = emptyKnockout();
      return next;
    });
  }

  function setKnockoutWinner(round: keyof KnockoutPicks, idx: number, team: string) {
    setState(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as SavedState;
      if (round === "champion") {
        next.knockout.champion = team;
      } else {
        (next.knockout[round] as (string | null)[])[idx] = team;
        /* Clear downstream when upstream changes */
        if (round === "r32") {
          const r16Idx = Math.floor(idx / 2);
          next.knockout.r16[r16Idx] = null;
          next.knockout.qf[Math.floor(r16Idx / 2)] = null;
          next.knockout.sf[Math.floor(r16Idx / 4)] = null;
          next.knockout.champion = null;
        } else if (round === "r16") {
          const qfIdx = Math.floor(idx / 2);
          next.knockout.qf[qfIdx] = null;
          next.knockout.sf[Math.floor(qfIdx / 2)] = null;
          next.knockout.champion = null;
        } else if (round === "qf") {
          next.knockout.sf[Math.floor(idx / 2)] = null;
          next.knockout.champion = null;
        } else if (round === "sf") {
          next.knockout.champion = null;
        }
      }
      return next;
    });
  }

  function goStep(s: number) {
    setState(prev => ({ ...prev, step: s }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearAll() {
    const fresh = { groupPreds: emptyGroupPredictions(groups), thirdPlaceAdvancing: [], knockout: emptyKnockout(), step: 0 };
    setState(fresh);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  /* ── Image generation ──────────────────────────────────────── */

  const generateImage = useCallback(async () => {
    setGenerating(true);
    await new Promise(r => setTimeout(r, 50));

    const W = 1080, H = 1920;
    const canvas = canvasRef.current;
    if (!canvas) { setGenerating(false); return; }
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    /* Background */
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#0a0f1a");
    grad.addColorStop(0.5, "#0d1520");
    grad.addColorStop(1, "#0a0a12");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    /* Subtle grid */
    ctx.strokeStyle = "rgba(255,255,255,0.02)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    /* Title */
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 44px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("MY WORLD CUP 2026", W / 2, 70);
    ctx.font = "bold 24px -apple-system, sans-serif";
    ctx.fillStyle = "#c9a84c";
    ctx.fillText("B R A C K E T", W / 2, 104);
    ctx.font = "14px -apple-system, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillText("🇨🇦  🇲🇽  🇺🇸   Canada · Mexico · United States", W / 2, 134);

    /* Champion at top */
    if (knockout.champion) {
      ctx.font = "48px -apple-system, sans-serif";
      ctx.fillText("👑", W / 2, 190);
      ctx.font = "bold 28px -apple-system, sans-serif";
      ctx.fillStyle = "#c9a84c";
      ctx.fillText(`${fl(knockout.champion)} ${knockout.champion.toUpperCase()}`, W / 2, 226);
      ctx.font = "10px -apple-system, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText("PREDICTED CHAMPION", W / 2, 246);
    }

    /* Group predictions grid */
    const gridTop = knockout.champion ? 280 : 170;
    const cellW = (W - 80) / 4;
    const cellH = 115;
    const gridGap = 8;

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("GROUP PREDICTIONS", 40, gridTop - 10);

    for (let i = 0; i < groupLetters.length; i++) {
      const g = groupLetters[i];
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 40 + col * (cellW + gridGap);
      const y = gridTop + row * (cellH + gridGap);

      /* Cell bg */
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.beginPath();
      ctx.roundRect(x, y, cellW, cellH, 6);
      ctx.fill();

      /* Group label */
      ctx.fillStyle = gcolor[g] || "#666";
      ctx.font = "bold 13px -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`Group ${g}`, x + 8, y + 18);

      /* 1st, 2nd, 3rd */
      const pred = groupPreds[g];
      const entries = [
        { pos: "1st", team: pred?.first },
        { pos: "2nd", team: pred?.second },
        { pos: "3rd", team: pred?.third },
      ];
      for (let j = 0; j < 3; j++) {
        const ey = y + 30 + j * 26;
        ctx.font = "bold 10px -apple-system, sans-serif";
        ctx.fillStyle = j === 0 ? "#c9a84c" : j === 1 ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.35)";
        ctx.fillText(entries[j].pos, x + 8, ey + 10);
        ctx.font = "13px -apple-system, sans-serif";
        ctx.fillStyle = entries[j].team ? "#ffffff" : "rgba(255,255,255,0.15)";
        const label = entries[j].team ? `${fl(entries[j].team)} ${entries[j].team}` : "—";
        ctx.fillText(label, x + 36, ey + 10);
      }
    }

    /* Knockout bracket — simplified vertical list */
    const koTop = gridTop + Math.ceil(groupLetters.length / 4) * (cellH + gridGap) + 30;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("KNOCKOUT PICKS", 40, koTop);

    const rounds = [
      { label: "R32", picks: knockout.r32, count: 16 },
      { label: "R16", picks: knockout.r16, count: 8 },
      { label: "QF", picks: knockout.qf, count: 4 },
      { label: "SF", picks: knockout.sf, count: 2 },
    ];

    let ky = koTop + 20;
    for (const round of rounds) {
      ctx.font = "bold 11px -apple-system, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText(round.label, 40, ky + 10);

      const cols = Math.min(round.count, 4);
      const rows = Math.ceil(round.count / cols);
      const tw = (W - 120) / cols;

      for (let i = 0; i < round.count; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const tx = 80 + c * tw;
        const ty = ky + r * 24;
        const team = round.picks[i];

        ctx.font = "12px -apple-system, sans-serif";
        ctx.fillStyle = team ? "#ffffff" : "rgba(255,255,255,0.15)";
        ctx.fillText(team ? `${fl(team)} ${team}` : "—", tx, ty + 10);
      }
      ky += rows * 24 + 16;
    }

    /* Footer */
    ctx.textAlign = "center";
    ctx.font = "12px -apple-system, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillText("wc2026-xi-gray.vercel.app", W / 2, H - 30);

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
  }, [state, flags, gcolor, groupLetters, groupPreds, knockout, fl]);

  /* ── Render ────────────────────────────────────────────────── */

  return (
    <div className="bracket-builder">
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <div className="bb-header">
        <h2 className="bb-title">My Bracket</h2>
        <p className="bb-sub">Predict your groups, then pick knockout winners. Save and share on Instagram.</p>

        {/* Step tabs */}
        <div className="bb-steps">
          <button className={`bb-step${step === 0 ? " bb-step--active" : ""}`} onClick={() => goStep(0)}>
            <span className="bb-step__num">1</span>
            <span>Groups{allGroupsDone ? " ✓" : ` (${groupsDone}/12)`}</span>
          </button>
          {allGroupsDone && (
            <button className={`bb-step${step === 1 ? " bb-step--active" : ""}`} onClick={() => goStep(1)}>
              <span className="bb-step__num">2</span>
              <span>Best 3rds{thirdsDone ? " ✓" : ` (${thirdPlaceAdvancing.length}/8)`}</span>
            </button>
          )}
          {allGroupsDone && thirdsDone && (
            <button className={`bb-step${step === 2 ? " bb-step--active" : ""}`} onClick={() => goStep(2)}>
              <span className="bb-step__num">3</span>
              <span>Knockout{knockout.champion ? " ✓" : ` (${knockoutDone}/${totalKnockout})`}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Step 0: Group Predictions ── */}
      {step === 0 && (
        <div className="bb-groups">
          <p className="bb-groups__hint">For each group, tap a team to set their predicted finish (1st, 2nd, 3rd). The 4th-place team is eliminated.</p>
          {groupLetters.map(g => {
            const pred = groupPreds[g] || { first: "", second: "", third: "" };
            const teamsList = groups[g];
            const placed = [pred.first, pred.second, pred.third].filter(Boolean);
            const unplaced = teamsList.filter(t => !placed.includes(t));

            return (
              <div key={g} id={`bb-group-${g}`} className={`bb-group${!pred.first || !pred.second || !pred.third ? " bb-group--incomplete" : ""}`} style={{ borderLeftColor: gcolor[g] || "var(--line)" }}>
                <div className="bb-group__hd" style={{ color: gcolor[g] }}>Group {g}</div>

                {/* Position slots */}
                <div className="bb-group__slots">
                  {(["first", "second", "third"] as const).map((pos, pi) => {
                    const team = pred[pos];
                    const posLabel = pi === 0 ? "1st" : pi === 1 ? "2nd" : "3rd";
                    const posClass = pi === 0 ? "bb-pos--first" : pi === 1 ? "bb-pos--second" : "bb-pos--third";
                    return (
                      <div key={pos} className={`bb-pos ${posClass}`}>
                        <span className="bb-pos__label">{posLabel}</span>
                        {team ? (
                          <button
                            className="bb-pos__team bb-pos__team--filled"
                            onClick={() => setGroupPos(g, pos, "")}
                            title="Click to remove"
                          >
                            {fl(team)} {team} <span className="bb-pos__x">✕</span>
                          </button>
                        ) : (
                          <span className="bb-pos__team bb-pos__team--empty">Pick {posLabel}</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Available teams to place */}
                {unplaced.length > 0 && (
                  <div className="bb-group__avail">
                    {unplaced.map(t => (
                      <button
                        key={t}
                        className="bb-team-pill"
                        onClick={() => {
                          /* Auto-place into first empty position */
                          if (!pred.first) setGroupPos(g, "first", t);
                          else if (!pred.second) setGroupPos(g, "second", t);
                          else if (!pred.third) setGroupPos(g, "third", t);
                        }}
                      >
                        {fl(t)} {t}
                      </button>
                    ))}
                  </div>
                )}

                {/* Group complete indicator */}
                {placed.length === 3 && (
                  <div className="bb-group__elim">
                    <span className="bb-group__elim-label">Eliminated:</span>
                    <span className="bb-group__elim-team">{fl(unplaced[0])} {unplaced[0]}</span>
                  </div>
                )}
              </div>
            );
          })}

          {allGroupsDone && (
            <button className="bb-next-btn" onClick={() => goStep(1)}>
              Continue to Best 3rd-Place Teams →
            </button>
          )}
        </div>
      )}

      {/* ── Step 1: Pick 8 best 3rd-place teams ── */}
      {step === 1 && allGroupsDone && (
        <div className="bb-thirds">
          <p className="bb-thirds__hint">8 of 12 third-place teams advance to the Round of 32. Pick which 8 go through.</p>
          <div className="bb-thirds__count">{thirdPlaceAdvancing.length}/8 selected</div>
          <div className="bb-thirds__grid">
            {allThirds.map(t => {
              const isSelected = thirdPlaceAdvancing.includes(t);
              const grp = groupLetters.find(g => groupPreds[g]?.third === t) || "";
              return (
                <button
                  key={t}
                  className={`bb-third-pill${isSelected ? " bb-third-pill--on" : ""}`}
                  onClick={() => toggleThirdAdvancing(t)}
                  disabled={!isSelected && thirdPlaceAdvancing.length >= 8}
                >
                  <span className="bb-third-pill__grp">3rd {grp}</span>
                  <span>{fl(t)} {t}</span>
                  {isSelected && <span className="bb-third-pill__check">✓</span>}
                </button>
              );
            })}
          </div>

          <div className="bb-step-nav">
            <button className="bb-back-btn" onClick={() => goStep(0)}>← Back to Groups</button>
            {thirdsDone && (
              <button className="bb-next-btn" onClick={() => goStep(2)}>Continue to Knockout →</button>
            )}
          </div>
        </div>
      )}

      {/* ── Step 2: Knockout picks ── */}
      {step === 2 && allGroupsDone && thirdsDone && (
        <div className="bb-knockout">
          {/* R32 */}
          <div className="bb-round">
            <div className="bb-round__hd">Round of 32 <span className="bb-round__count">{knockout.r32.filter(Boolean).length}/16</span></div>
            <div className="bb-matches">
              {R32_STRUCTURE.map((_, i) => {
                const [teamA, teamB] = getR32Teams(i, groupPreds, thirdPlaceAdvancing);
                const winner = knockout.r32[i];
                if (!teamA || !teamB) return null;
                return (
                  <div key={i} className="bb-match">
                    <div className="bb-match__label">Match {73 + i}</div>
                    <div className="bb-match__pick">
                      <button
                        className={`bb-pick-btn${winner === teamA ? " bb-pick-btn--active" : ""}`}
                        onClick={() => setKnockoutWinner("r32", i, teamA)}
                      >{fl(teamA)} {teamA}</button>
                      <span className="bb-match__vs">vs</span>
                      <button
                        className={`bb-pick-btn${winner === teamB ? " bb-pick-btn--active" : ""}`}
                        onClick={() => setKnockoutWinner("r32", i, teamB)}
                      >{fl(teamB)} {teamB}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* R16 */}
          {knockout.r32.filter(Boolean).length === 16 && (
            <div className="bb-round">
              <div className="bb-round__hd">Round of 16 <span className="bb-round__count">{knockout.r16.filter(Boolean).length}/8</span></div>
              <div className="bb-matches">
                {Array.from({ length: 8 }, (_, i) => {
                  const teamA = knockout.r32[i * 2];
                  const teamB = knockout.r32[i * 2 + 1];
                  if (!teamA || !teamB) return null;
                  const winner = knockout.r16[i];
                  return (
                    <div key={i} className="bb-match">
                      <div className="bb-match__label">Match {89 + i}</div>
                      <div className="bb-match__pick">
                        <button
                          className={`bb-pick-btn${winner === teamA ? " bb-pick-btn--active" : ""}`}
                          onClick={() => setKnockoutWinner("r16", i, teamA)}
                        >{fl(teamA)} {teamA}</button>
                        <span className="bb-match__vs">vs</span>
                        <button
                          className={`bb-pick-btn${winner === teamB ? " bb-pick-btn--active" : ""}`}
                          onClick={() => setKnockoutWinner("r16", i, teamB)}
                        >{fl(teamB)} {teamB}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* QF */}
          {knockout.r16.filter(Boolean).length === 8 && (
            <div className="bb-round">
              <div className="bb-round__hd">Quarter-finals <span className="bb-round__count">{knockout.qf.filter(Boolean).length}/4</span></div>
              <div className="bb-matches">
                {Array.from({ length: 4 }, (_, i) => {
                  const teamA = knockout.r16[i * 2];
                  const teamB = knockout.r16[i * 2 + 1];
                  if (!teamA || !teamB) return null;
                  const winner = knockout.qf[i];
                  return (
                    <div key={i} className="bb-match">
                      <div className="bb-match__label">Match {97 + i}</div>
                      <div className="bb-match__pick">
                        <button
                          className={`bb-pick-btn${winner === teamA ? " bb-pick-btn--active" : ""}`}
                          onClick={() => setKnockoutWinner("qf", i, teamA)}
                        >{fl(teamA)} {teamA}</button>
                        <span className="bb-match__vs">vs</span>
                        <button
                          className={`bb-pick-btn${winner === teamB ? " bb-pick-btn--active" : ""}`}
                          onClick={() => setKnockoutWinner("qf", i, teamB)}
                        >{fl(teamB)} {teamB}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SF */}
          {knockout.qf.filter(Boolean).length === 4 && (
            <div className="bb-round">
              <div className="bb-round__hd">Semi-finals <span className="bb-round__count">{knockout.sf.filter(Boolean).length}/2</span></div>
              <div className="bb-matches">
                {Array.from({ length: 2 }, (_, i) => {
                  const teamA = knockout.qf[i * 2];
                  const teamB = knockout.qf[i * 2 + 1];
                  if (!teamA || !teamB) return null;
                  const winner = knockout.sf[i];
                  return (
                    <div key={i} className="bb-match">
                      <div className="bb-match__label">Match {101 + i}</div>
                      <div className="bb-match__pick">
                        <button
                          className={`bb-pick-btn${winner === teamA ? " bb-pick-btn--active" : ""}`}
                          onClick={() => setKnockoutWinner("sf", i, teamA)}
                        >{fl(teamA)} {teamA}</button>
                        <span className="bb-match__vs">vs</span>
                        <button
                          className={`bb-pick-btn${winner === teamB ? " bb-pick-btn--active" : ""}`}
                          onClick={() => setKnockoutWinner("sf", i, teamB)}
                        >{fl(teamB)} {teamB}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Final */}
          {knockout.sf[0] && knockout.sf[1] && (
            <div className="bb-round bb-round--final">
              <div className="bb-round__hd">🏆 Final</div>
              <div className="bb-final">
                <button
                  className={`bb-final-btn${knockout.champion === knockout.sf[0] ? " bb-final-btn--active" : ""}`}
                  onClick={() => setKnockoutWinner("champion", 0, knockout.sf[0]!)}
                >
                  <span className="bb-final-flag">{fl(knockout.sf[0])}</span>
                  <span className="bb-final-name">{knockout.sf[0]}</span>
                </button>
                <span className="bb-final-vs">vs</span>
                <button
                  className={`bb-final-btn${knockout.champion === knockout.sf[1] ? " bb-final-btn--active" : ""}`}
                  onClick={() => setKnockoutWinner("champion", 0, knockout.sf[1]!)}
                >
                  <span className="bb-final-flag">{fl(knockout.sf[1])}</span>
                  <span className="bb-final-name">{knockout.sf[1]}</span>
                </button>
              </div>
              {knockout.champion && (
                <div className="bb-champion">
                  <div className="bb-champion__crown">👑</div>
                  <div className="bb-champion__flag">{fl(knockout.champion)}</div>
                  <div className="bb-champion__name">{knockout.champion}</div>
                  <div className="bb-champion__label">YOUR PREDICTED CHAMPION</div>
                </div>
              )}
            </div>
          )}

          <button className="bb-back-btn" onClick={() => goStep(1)}>← Back to 3rd Place</button>
        </div>
      )}

      {/* Actions */}
      <div className="bb-actions">
        <button
          className="bb-share-btn"
          onClick={() => {
            if (!allGroupsDone) {
              const missing = groupLetters.find(g => !groupPreds[g]?.first || !groupPreds[g]?.second || !groupPreds[g]?.third);
              if (missing) {
                goStep(0);
                setTimeout(() => {
                  const el = document.getElementById(`bb-group-${missing}`);
                  if (el) {
                    el.scrollIntoView({ behavior: "smooth", block: "center" });
                    el.classList.add("bb-group--flash");
                    setTimeout(() => el.classList.remove("bb-group--flash"), 2000);
                  }
                }, 100);
              }
              return;
            }
            generateImage();
          }}
          disabled={generating}
        >
          {generating ? "Generating..." : !allGroupsDone ? `⚠ Complete All Groups (${groupsDone}/12)` : "📸 Save My Bracket"}
        </button>
        <button className="bb-clear-btn" onClick={clearAll}>Clear All</button>
      </div>
      <p className="bb-share-hint">{!allGroupsDone ? "Finish predicting all 12 groups to unlock saving" : "Downloads a 1080×1920 image for Instagram stories"}</p>
    </div>
  );
}

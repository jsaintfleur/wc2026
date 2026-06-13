import { prisma } from "@/lib/db";

export const revalidate = 60;
export const dynamic = "force-dynamic";

const LIVE_STATUSES = new Set(["1H", "2H", "HT", "ET", "BT", "P", "LIVE", "SUSP", "INT"]);
const DONE_STATUSES = new Set(["FT", "AET", "PEN", "WO", "AWD"]);
const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000;
const LINEUP_CAPTURE_WINDOW_MS = 90 * 60 * 1000;

interface QualityIssue {
  matchNumber: number;
  home: string;
  away: string;
  kickoff: string;
  status: string;
  issue: string;
  severity: "critical" | "warning" | "info";
}

function jsonArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function jsonObjectKeys(value: unknown): number {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).length
    : 0;
}

async function audit(): Promise<{ issues: QualityIssue[]; summary: Record<string, number>; total: number }> {
  const now = Date.now();
  const issues: QualityIssue[] = [];

  const queryMatches = async () => {
    try {
      return await prisma.match.findMany({
        include: { state: true, homeTeam: true, awayTeam: true },
        orderBy: { matchNumber: "asc" },
      });
    } catch {
      return null;
    }
  };
  const matches = await queryMatches();

  if (!matches || matches.length === 0) {
    return { issues: [{ matchNumber: 0, home: "-", away: "-", kickoff: "-", status: "-", issue: "Database not configured or empty", severity: "critical" }], summary: { critical: 1 }, total: 0 };
  }

  const summary: Record<string, number> = { critical: 0, warning: 0, info: 0 };

  for (const m of matches) {
    const kickoff = new Date(m.kickoffUtc).getTime();
    const elapsed = now - kickoff;
    const isPast = elapsed > 0;
    const inLineupWindow = now >= kickoff - LINEUP_CAPTURE_WINDOW_MS && now <= kickoff + STALE_THRESHOLD_MS;
    const home = m.homeTeam?.name || "TBD";
    const away = m.awayTeam?.name || "TBD";
    const kickoffStr = m.kickoffUtc.toISOString();

    if (!m.state && inLineupWindow) {
      issues.push({ matchNumber: m.matchNumber, home, away, kickoff: kickoffStr, status: "NO_STATE", issue: "Lineup/live enrichment window is open but no vendor state has been captured", severity: "warning" });
      summary.warning++;
    }

    if (isPast && elapsed > STALE_THRESHOLD_MS && !m.state) {
      issues.push({ matchNumber: m.matchNumber, home, away, kickoff: kickoffStr, status: "NO_STATE", issue: "Past match with no state record", severity: "critical" });
      summary.critical++;
    }

    if (m.state) {
      if (LIVE_STATUSES.has(m.state.status) && elapsed > STALE_THRESHOLD_MS) {
        issues.push({ matchNumber: m.matchNumber, home, away, kickoff: kickoffStr, status: m.state.status, issue: `Stale live status (${Math.round(elapsed / 3600000)}h since kickoff)`, severity: "critical" });
        summary.critical++;
      }

      if (DONE_STATUSES.has(m.state.status) && (m.state.homeGoals == null || m.state.awayGoals == null)) {
        issues.push({ matchNumber: m.matchNumber, home, away, kickoff: kickoffStr, status: m.state.status, issue: "Done status but missing score", severity: "critical" });
        summary.critical++;
      }

      if (m.state.status === "NS" && isPast && elapsed > STALE_THRESHOLD_MS) {
        issues.push({ matchNumber: m.matchNumber, home, away, kickoff: kickoffStr, status: "NS", issue: "Still NS after kickoff window", severity: "warning" });
        summary.warning++;
      }

      const stateAge = now - new Date(m.state.updatedAt).getTime();
      if (LIVE_STATUSES.has(m.state.status) && stateAge > 10 * 60 * 1000) {
        issues.push({ matchNumber: m.matchNumber, home, away, kickoff: kickoffStr, status: m.state.status, issue: `State not updated in ${Math.round(stateAge / 60000)}min`, severity: "warning" });
        summary.warning++;
      }

      if ((LIVE_STATUSES.has(m.state.status) || DONE_STATUSES.has(m.state.status)) && !m.state.vendorFixtureId) {
        issues.push({ matchNumber: m.matchNumber, home, away, kickoff: kickoffStr, status: m.state.status, issue: "Missing API-Football fixture ID for live enrichment", severity: "critical" });
        summary.critical++;
      }

      if (LIVE_STATUSES.has(m.state.status) || DONE_STATUSES.has(m.state.status)) {
        const missing: string[] = [];
        if (jsonArrayLength(m.state.lineups) < 2) missing.push("lineups/substitutes");
        if (jsonObjectKeys(m.state.stats) === 0) missing.push("team stats");
        if (DONE_STATUSES.has(m.state.status) && jsonArrayLength(m.state.events) === 0) missing.push("events");
        if (DONE_STATUSES.has(m.state.status) && jsonArrayLength(m.state.players) === 0) missing.push("player stats");

        if (missing.length > 0) {
          const done = DONE_STATUSES.has(m.state.status);
          issues.push({
            matchNumber: m.matchNumber,
            home,
            away,
            kickoff: kickoffStr,
            status: m.state.status,
            issue: `Missing rich live enrichment: ${missing.join(", ")}`,
            severity: done ? "critical" : "warning",
          });
          summary[done ? "critical" : "warning"]++;
        }
      }
    }
  }

  issues.sort((a, b) => {
    const sev = { critical: 0, warning: 1, info: 2 };
    return sev[a.severity] - sev[b.severity] || a.matchNumber - b.matchNumber;
  });

  return { issues, summary, total: matches.length };
}

export default async function QualityDashboard() {
  const { issues, summary, total } = await audit();

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Data Quality Dashboard</h1>
      <p style={{ color: "#666", fontSize: 14, marginBottom: 24 }}>Internal monitoring — {total} matches in database</p>

      <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
        <div style={{ padding: "12px 20px", borderRadius: 8, background: (summary.critical || 0) > 0 ? "#fef2f2" : "#f0fdf4", border: `1px solid ${(summary.critical || 0) > 0 ? "#fecaca" : "#bbf7d0"}` }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: (summary.critical || 0) > 0 ? "#dc2626" : "#16a34a" }}>{summary.critical || 0}</div>
          <div style={{ fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: 1 }}>Critical</div>
        </div>
        <div style={{ padding: "12px 20px", borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#d97706" }}>{summary.warning || 0}</div>
          <div style={{ fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: 1 }}>Warning</div>
        </div>
        <div style={{ padding: "12px 20px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#475569" }}>{summary.info || 0}</div>
          <div style={{ fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: 1 }}>Info</div>
        </div>
      </div>

      {issues.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "#16a34a", fontSize: 16 }}>All clear — no data quality issues detected.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e2e8f0", textAlign: "left" }}>
              <th style={{ padding: "8px 6px" }}>#</th>
              <th style={{ padding: "8px 6px" }}>Match</th>
              <th style={{ padding: "8px 6px" }}>Status</th>
              <th style={{ padding: "8px 6px" }}>Issue</th>
              <th style={{ padding: "8px 6px" }}>Severity</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px 6px", fontWeight: 600 }}>{issue.matchNumber}</td>
                <td style={{ padding: "8px 6px" }}>{issue.home} vs {issue.away}</td>
                <td style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 12 }}>{issue.status}</td>
                <td style={{ padding: "8px 6px" }}>{issue.issue}</td>
                <td style={{ padding: "8px 6px" }}>
                  <span style={{
                    display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                    background: issue.severity === "critical" ? "#fef2f2" : issue.severity === "warning" ? "#fffbeb" : "#f8fafc",
                    color: issue.severity === "critical" ? "#dc2626" : issue.severity === "warning" ? "#d97706" : "#475569",
                  }}>{issue.severity}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 24, padding: 16, background: "#f8fafc", borderRadius: 8, fontSize: 13, color: "#64748b" }}>
        <strong>Reconciliation endpoint:</strong> <code>GET /api/reconcile</code> — forces stale live statuses to FT. Requires CRON_SECRET authorization.
      </div>
    </div>
  );
}

import React, { useMemo } from "react";

// ── Aliases (mirrors App.js) ─────────────────────────────────────────────────
const CALL_BOOKED_ALIASES = ["call booked","call booked - y/n","call booked y/n","booked call","booking call"];
const SHOWUP_CALL_ALIASES = ["show-up on call","showup on call","show up on call","showed up","show up call","showup call"];
const CONVERTED_ALIASES   = ["converted","conversion","is converted","deal closed","closed"];
const DATE_CONTACT_ALIASES= ["date of contact","contact date","date contacted","contacted on","date"];
const MANAGER_ALIASES     = ["managed by","manager","managed_by","managedby","team lead","team_lead","teamlead","lead","handled by","assigned to","owner","reporting to","reports to","supervisor","incharge","in charge"];
const SHOWUP_MSG_ALIASES  = ["showup messaging process","showup messaging","show up messaging","messaging process","showup msg"];

function findCol(columns, aliases) {
  const set = new Set(aliases.map(a => a.trim().toLowerCase()));
  return columns.find(c => set.has(c.trim().toLowerCase())) || null;
}

function yesCount(rows, col) {
  if (!col) return null;
  return rows.filter(r => {
    const v = String(r[col] || "").trim().toLowerCase();
    return v === "yes" || v === "y" || v === "true" || v === "1";
  }).length;
}

function computeMonthKpi(rows, columns) {
  const callBookedCol = findCol(columns, CALL_BOOKED_ALIASES);
  const showupCol     = findCol(columns, SHOWUP_CALL_ALIASES);
  const convertedCol  = findCol(columns, CONVERTED_ALIASES);
  const managerCol    = columns.find(c => {
    const n = c.trim().toLowerCase();
    return MANAGER_ALIASES.some(a => n.includes(a));
  });
  const showupMsgCol  = findCol(columns, SHOWUP_MSG_ALIASES);

  const total      = rows.length;
  const callBooked = yesCount(rows, callBookedCol);
  const showup     = yesCount(rows, showupCol);
  const converted  = yesCount(rows, convertedCol);

  // Per-week breakdown using date column
  const dateCol = findCol(columns, DATE_CONTACT_ALIASES);
  const weeks = {};
  if (dateCol) {
    rows.forEach(row => {
      const raw = String(row[dateCol] || "").trim();
      if (!raw) return;
      let d = null;
      const ddmm = /^(\d{1,2})\/(\d{1,2})$/.exec(raw);
      if (ddmm) { const now = new Date(); d = new Date(now.getFullYear(), parseInt(ddmm[2])-1, parseInt(ddmm[1])); }
      else {
        const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
        if (ddmmyyyy) d = new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2])-1, parseInt(ddmmyyyy[1]));
        else { const p = new Date(raw); if (!isNaN(p)) d = p; }
      }
      if (!d) return;
      const wk = `Week ${Math.ceil(d.getDate() / 7)}`;
      if (!weeks[wk]) weeks[wk] = { total:0, callBooked:0, showup:0, converted:0 };
      weeks[wk].total++;
      if (callBookedCol) { const v = String(row[callBookedCol]||"").trim().toLowerCase(); if (v==="yes"||v==="y"||v==="true"||v==="1") weeks[wk].callBooked++; }
      if (showupCol)     { const v = String(row[showupCol]||"").trim().toLowerCase();     if (v==="yes"||v==="y"||v==="true"||v==="1") weeks[wk].showup++; }
      if (convertedCol)  { const v = String(row[convertedCol]||"").trim().toLowerCase();  if (v==="yes"||v==="y"||v==="true"||v==="1") weeks[wk].converted++; }
    });
  }

  // Per-manager breakdown
  const managers = {};
  if (managerCol) {
    rows.forEach(row => {
      const mgr = String(row[managerCol] || "").trim();
      if (!mgr) return;
      if (!managers[mgr]) managers[mgr] = { total:0, callBooked:0, showup:0, converted:0 };
      managers[mgr].total++;
      if (callBookedCol) { const v = String(row[callBookedCol]||"").trim().toLowerCase(); if (v==="yes"||v==="y"||v==="true"||v==="1") managers[mgr].callBooked++; }
      if (showupCol)     { const v = String(row[showupCol]||"").trim().toLowerCase();     if (v==="yes"||v==="y"||v==="true"||v==="1") managers[mgr].showup++; }
      if (convertedCol)  { const v = String(row[convertedCol]||"").trim().toLowerCase();  if (v==="yes"||v==="y"||v==="true"||v==="1") managers[mgr].converted++; }
    });
  }

  return {
    total,
    callBooked,
    showup,
    converted,
    callBookedRate: total > 0 && callBooked != null ? Math.round((callBooked / total) * 100) : null,
    showupRate:     callBooked > 0 && showup != null  ? Math.round((showup    / callBooked) * 100) : null,
    conversionRate: total > 0 && converted != null    ? Math.round((converted / total) * 100) : null,
    weeks: Object.entries(weeks).sort((a,b) => {
      const wa = parseInt(a[0].replace(/\D/g,""));
      const wb = parseInt(b[0].replace(/\D/g,""));
      return wa - wb;
    }),
    managers: Object.entries(managers).sort((a,b) => b[1].total - a[1].total),
    hasCallBooked: callBookedCol != null,
    hasShowup: showupCol != null,
    hasConverted: convertedCol != null,
  };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function RateBar({ value, color }) {
  if (value == null) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ height: 4, borderRadius: 3, background: "rgba(255,255,255,0.06)" }}>
        <div style={{
          height: "100%", borderRadius: 3,
          width: `${Math.min(value, 100)}%`,
          background: color,
          transition: "width 0.6s cubic-bezier(.4,0,.2,1)"
        }} />
      </div>
    </div>
  );
}

function KpiMetricCard({ icon, label, value, rate, rateLabel, color, subLabel }) {
  return (
    <div style={css.metricCard}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontSize: 11, color: "#718096", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: 36, fontWeight: 700, color: color || "#e2e8f0", fontFamily: "'DM Mono',monospace", lineHeight: 1 }}>
        {value ?? "—"}
      </div>
      {subLabel && <div style={{ fontSize: 11, color: "#4a5568", marginTop: 3 }}>{subLabel}</div>}
      {rate != null && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11 }}>
            <span style={{ color: "#718096" }}>{rateLabel}</span>
            <span style={{ color: rate >= 50 ? "#48bb78" : rate >= 25 ? "#f6ad55" : "#fc8181", fontWeight: 700 }}>{rate}%</span>
          </div>
          <RateBar value={rate} color={rate >= 50 ? "#48bb78" : rate >= 25 ? "#f6ad55" : "#fc8181"} />
        </>
      )}
    </div>
  );
}

function WeekTable({ weeks, hasCallBooked, hasShowup, hasConverted }) {
  if (!weeks || weeks.length === 0) return null;
  return (
    <div style={css.section}>
      <div style={css.sectionTitle}>📅 Weekly Breakdown</div>
      <div style={{ overflowX: "auto" }}>
        <table style={css.table}>
          <thead>
            <tr>
              <th style={css.th}>Week</th>
              <th style={css.th}>Total Leads</th>
              {hasCallBooked && <th style={css.th}>Calls Booked</th>}
              {hasShowup && <th style={css.th}>Show-ups</th>}
              {hasConverted && <th style={css.th}>Converted</th>}
              {hasConverted && <th style={css.th}>Conv. Rate</th>}
            </tr>
          </thead>
          <tbody>
            {weeks.map(([wk, d]) => {
              const convRate = d.total > 0 ? Math.round((d.converted / d.total) * 100) : 0;
              return (
                <tr key={wk} style={css.tr}>
                  <td style={{ ...css.td, fontWeight: 600, color: "#63b3ed" }}>{wk}</td>
                  <td style={{ ...css.td, fontFamily: "'DM Mono',monospace" }}>{d.total}</td>
                  {hasCallBooked && <td style={{ ...css.td, color: "#63b3ed", fontFamily: "'DM Mono',monospace" }}>{d.callBooked}</td>}
                  {hasShowup     && <td style={{ ...css.td, color: "#f6ad55", fontFamily: "'DM Mono',monospace" }}>{d.showup}</td>}
                  {hasConverted  && <td style={{ ...css.td, color: "#48bb78", fontFamily: "'DM Mono',monospace" }}>{d.converted}</td>}
                  {hasConverted  && (
                    <td style={css.td}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: convRate >= 50 ? "rgba(72,187,120,0.15)" : convRate >= 25 ? "rgba(246,173,85,0.15)" : "rgba(252,129,129,0.15)",
                        color: convRate >= 50 ? "#48bb78" : convRate >= 25 ? "#f6ad55" : "#fc8181",
                      }}>{convRate}%</span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManagerTable({ managers, hasCallBooked, hasShowup, hasConverted }) {
  if (!managers || managers.length === 0) return null;
  return (
    <div style={css.section}>
      <div style={css.sectionTitle}>👤 Manager Breakdown</div>
      <div style={{ overflowX: "auto" }}>
        <table style={css.table}>
          <thead>
            <tr>
              <th style={css.th}>Manager</th>
              <th style={css.th}>Total</th>
              {hasCallBooked && <th style={css.th}>Calls</th>}
              {hasShowup     && <th style={css.th}>Show-ups</th>}
              {hasConverted  && <th style={css.th}>Converted</th>}
              {hasConverted  && <th style={css.th}>Rate</th>}
            </tr>
          </thead>
          <tbody>
            {managers.map(([mgr, d]) => {
              const rate = d.total > 0 ? Math.round((d.converted / d.total) * 100) : 0;
              return (
                <tr key={mgr} style={css.tr}>
                  <td style={{ ...css.td, fontWeight: 600, color: "#e2e8f0" }}>
                    <span style={{ marginRight: 6 }}>👤</span>{mgr}
                  </td>
                  <td style={{ ...css.td, fontFamily: "'DM Mono',monospace" }}>{d.total}</td>
                  {hasCallBooked && <td style={{ ...css.td, color: "#63b3ed", fontFamily: "'DM Mono',monospace" }}>{d.callBooked}</td>}
                  {hasShowup     && <td style={{ ...css.td, color: "#f6ad55", fontFamily: "'DM Mono',monospace" }}>{d.showup}</td>}
                  {hasConverted  && <td style={{ ...css.td, color: "#48bb78", fontFamily: "'DM Mono',monospace" }}>{d.converted}</td>}
                  {hasConverted  && (
                    <td style={css.td}>
                      <span style={{
                        padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: rate >= 50 ? "rgba(72,187,120,0.15)" : rate >= 25 ? "rgba(246,173,85,0.15)" : "rgba(252,129,129,0.15)",
                        color: rate >= 50 ? "#48bb78" : rate >= 25 ? "#f6ad55" : "#fc8181",
                      }}>{rate}%</span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main KpiPanel export ────────────────────────────────────────────────────

export default function KpiPanel({
  monthDataMap,    // { [monthName]: { columns, rows, loading, error } }
  selectedMonth,   // "all" | "May" | "June" ...
  onMonthChange,
  allMonthNames,
}) {
  // Compute KPI for each month
  const kpiByMonth = useMemo(() => {
    const result = {};
    Object.entries(monthDataMap).forEach(([month, { columns, rows }]) => {
      if (rows && columns) result[month] = computeMonthKpi(rows, columns);
    });
    return result;
  }, [monthDataMap]);

  // Combined "all months" KPI
  const allKpi = useMemo(() => {
    const allRows = [];
    let allCols = [];
    Object.values(monthDataMap).forEach(({ rows, columns }) => {
      if (rows) { allRows.push(...rows); if (columns?.length > allCols.length) allCols = columns; }
    });
    return allRows.length ? computeMonthKpi(allRows, allCols) : null;
  }, [monthDataMap]);

  const displayMonths = selectedMonth === "all" ? allMonthNames : [selectedMonth];
  const isAll = selectedMonth === "all";

  if (allMonthNames.length === 0) {
    return (
      <div style={css.empty}>
        No month sheets detected. Name your Google Sheet tabs after months (e.g. "May", "June") to enable auto-computed KPIs.
      </div>
    );
  }

  return (
    <div>
      {/* Month selector tabs */}
      <div style={css.tabs}>
        <button
          style={{ ...css.tab, ...(selectedMonth === "all" ? css.tabActive : {}) }}
          onClick={() => onMonthChange("all")}
        >
          📊 All Months
        </button>
        {allMonthNames.map(m => {
          const d = monthDataMap[m];
          return (
            <button
              key={m}
              style={{ ...css.tab, ...(selectedMonth === m ? css.tabActive : {}) }}
              onClick={() => onMonthChange(m)}
            >
              {d?.loading ? "⏳" : d?.error ? "⚠️" : "📅"} {m}
              {d?.rows && <span style={css.tabBadge}>{d.rows.length}</span>}
            </button>
          );
        })}
      </div>

      {/* All-months summary */}
      {isAll && allKpi && (
        <div style={{ marginBottom: 28 }}>
          <div style={css.monthHeader}>
            <span style={css.monthTitle}>📊 All Months Combined</span>
            <span style={css.monthMeta}>{allKpi.total} total leads across {allMonthNames.length} month{allMonthNames.length > 1 ? "s" : ""}</span>
          </div>
          <div style={css.metricsGrid}>
            <KpiMetricCard icon="📋" label="Total Leads"   value={allKpi.total}      color="#e2e8f0" />
            {allKpi.hasCallBooked && <KpiMetricCard icon="📞" label="Calls Booked"  value={allKpi.callBooked} rate={allKpi.callBookedRate} rateLabel="of total leads"    color="#63b3ed" />}
            {allKpi.hasShowup     && <KpiMetricCard icon="🎯" label="Show-ups"      value={allKpi.showup}     rate={allKpi.showupRate}     rateLabel="of calls booked"   color="#f6ad55" />}
            {allKpi.hasConverted  && <KpiMetricCard icon="✅" label="Converted"     value={allKpi.converted}  rate={allKpi.conversionRate} rateLabel="of total leads"    color="#48bb78" />}
          </div>

          {/* Cross-month comparison table */}
          {allMonthNames.length > 1 && (
            <div style={css.section}>
              <div style={css.sectionTitle}>📆 Month-by-Month Comparison</div>
              <div style={{ overflowX: "auto" }}>
                <table style={css.table}>
                  <thead>
                    <tr>
                      <th style={css.th}>Month</th>
                      <th style={css.th}>Leads</th>
                      {allKpi.hasCallBooked && <th style={css.th}>Calls</th>}
                      {allKpi.hasShowup     && <th style={css.th}>Show-ups</th>}
                      {allKpi.hasConverted  && <th style={css.th}>Converted</th>}
                      {allKpi.hasConverted  && <th style={css.th}>Conv. Rate</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {allMonthNames.map(m => {
                      const k = kpiByMonth[m];
                      if (!k) return null;
                      const rate = k.total > 0 && k.converted != null ? Math.round((k.converted / k.total) * 100) : null;
                      return (
                        <tr key={m} style={{ ...css.tr, cursor: "pointer" }} onClick={() => onMonthChange(m)}>
                          <td style={{ ...css.td, fontWeight: 600, color: "#63b3ed" }}>{m}</td>
                          <td style={{ ...css.td, fontFamily: "'DM Mono',monospace" }}>{k.total}</td>
                          {allKpi.hasCallBooked && <td style={{ ...css.td, color: "#63b3ed", fontFamily: "'DM Mono',monospace" }}>{k.callBooked ?? "—"}</td>}
                          {allKpi.hasShowup     && <td style={{ ...css.td, color: "#f6ad55", fontFamily: "'DM Mono',monospace" }}>{k.showup ?? "—"}</td>}
                          {allKpi.hasConverted  && <td style={{ ...css.td, color: "#48bb78", fontFamily: "'DM Mono',monospace" }}>{k.converted ?? "—"}</td>}
                          {allKpi.hasConverted  && (
                            <td style={css.td}>
                              {rate != null ? (
                                <span style={{
                                  padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                                  background: rate >= 50 ? "rgba(72,187,120,0.15)" : rate >= 25 ? "rgba(246,173,85,0.15)" : "rgba(252,129,129,0.15)",
                                  color: rate >= 50 ? "#48bb78" : rate >= 25 ? "#f6ad55" : "#fc8181",
                                }}>{rate}%</span>
                              ) : "—"}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {/* Totals row */}
                    <tr style={{ ...css.tr, background: "rgba(99,179,237,0.05)", borderTop: "1px solid rgba(99,179,237,0.2)" }}>
                      <td style={{ ...css.td, fontWeight: 700, color: "#e2e8f0" }}>Total</td>
                      <td style={{ ...css.td, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: "#e2e8f0" }}>{allKpi.total}</td>
                      {allKpi.hasCallBooked && <td style={{ ...css.td, fontWeight: 700, color: "#63b3ed", fontFamily: "'DM Mono',monospace" }}>{allKpi.callBooked}</td>}
                      {allKpi.hasShowup     && <td style={{ ...css.td, fontWeight: 700, color: "#f6ad55", fontFamily: "'DM Mono',monospace" }}>{allKpi.showup}</td>}
                      {allKpi.hasConverted  && <td style={{ ...css.td, fontWeight: 700, color: "#48bb78", fontFamily: "'DM Mono',monospace" }}>{allKpi.converted}</td>}
                      {allKpi.hasConverted  && (
                        <td style={css.td}>
                          <span style={{
                            padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700,
                            background: "rgba(99,179,237,0.15)", color: "#63b3ed",
                          }}>{allKpi.conversionRate}%</span>
                        </td>
                      )}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Single month view */}
      {!isAll && displayMonths.map(month => {
        const data = monthDataMap[month];
        const kpi  = kpiByMonth[month];

        if (data?.loading) return (
          <div key={month} style={css.loadingBox}>
            <div style={css.spinner} />
            Loading {month} data…
          </div>
        );
        if (data?.error) return (
          <div key={month} style={css.errorBox}>⚠️ {month}: {data.error}</div>
        );
        if (!kpi) return null;

        return (
          <div key={month}>
            <div style={css.monthHeader}>
              <span style={css.monthTitle}>📅 {month}</span>
              <span style={css.monthMeta}>{kpi.total} leads · auto-computed from sheet</span>
            </div>

            <div style={css.metricsGrid}>
              <KpiMetricCard icon="📋" label="Total Leads"  value={kpi.total}      color="#e2e8f0" />
              {kpi.hasCallBooked && <KpiMetricCard icon="📞" label="Calls Booked" value={kpi.callBooked} rate={kpi.callBookedRate} rateLabel="of total leads"  color="#63b3ed" />}
              {kpi.hasShowup     && <KpiMetricCard icon="🎯" label="Show-ups"     value={kpi.showup}     rate={kpi.showupRate}     rateLabel="of calls booked" color="#f6ad55" />}
              {kpi.hasConverted  && <KpiMetricCard icon="✅" label="Converted"    value={kpi.converted}  rate={kpi.conversionRate} rateLabel="of total leads"  color="#48bb78" />}
            </div>

            <WeekTable   weeks={kpi.weeks}    hasCallBooked={kpi.hasCallBooked} hasShowup={kpi.hasShowup} hasConverted={kpi.hasConverted} />
            <ManagerTable managers={kpi.managers} hasCallBooked={kpi.hasCallBooked} hasShowup={kpi.hasShowup} hasConverted={kpi.hasConverted} />
          </div>
        );
      })}
    </div>
  );
}

const css = {
  tabs: { display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" },
  tab:  { padding: "8px 18px", borderRadius: 20, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#718096", cursor: "pointer", fontSize: 13, fontFamily: "'DM Sans',sans-serif", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s" },
  tabActive: { background: "rgba(99,179,237,0.12)", borderColor: "rgba(99,179,237,0.4)", color: "#63b3ed", fontWeight: 600 },
  tabBadge: { background: "rgba(99,179,237,0.2)", color: "#63b3ed", borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "1px 6px" },
  monthHeader: { display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 },
  monthTitle:  { fontSize: 18, fontWeight: 700, color: "#e2e8f0" },
  monthMeta:   { fontSize: 12, color: "#4a5568" },
  metricsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 24 },
  metricCard:  { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "16px 18px" },
  section:     { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "16px 18px", marginBottom: 20 },
  sectionTitle:{ fontSize: 12, fontWeight: 600, color: "#718096", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14 },
  table:       { width: "100%", borderCollapse: "collapse" },
  th:          { padding: "8px 14px", textAlign: "left", fontSize: 11, fontWeight: 500, color: "#4a5568", textTransform: "uppercase", letterSpacing: "0.6px", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.06)", whiteSpace: "nowrap" },
  tr:          { borderBottom: "1px solid rgba(255,255,255,0.04)" },
  td:          { padding: "10px 14px", fontSize: 13, color: "#a0aec0", whiteSpace: "nowrap" },
  empty:       { textAlign: "center", padding: 40, color: "#4a5568", fontSize: 14, background: "rgba(255,255,255,0.02)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", marginBottom: 24 },
  loadingBox:  { display: "flex", alignItems: "center", gap: 10, padding: 24, color: "#718096", fontSize: 14 },
  errorBox:    { padding: 16, background: "rgba(252,129,129,0.08)", border: "1px solid rgba(252,129,129,0.2)", borderRadius: 10, color: "#fc8181", fontSize: 13, marginBottom: 16 },
  spinner:     { width: 18, height: 18, border: "2px solid rgba(255,255,255,0.08)", borderTopColor: "#63b3ed", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
};
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { fetchSheetData, fetchSpreadsheetTabs } from "../sheets.js";

// ─── Column finders ───────────────────────────────────────────────────────────
function findCol(columns, aliases) {
  const set = new Set(aliases.map(a => a.trim().toLowerCase()));
  return columns.find(c => set.has(c.trim().toLowerCase())) || null;
}

function findColPartial(columns, partials) {
  return columns.find(c => {
    const n = c.trim().toLowerCase();
    return partials.some(p => n.includes(p.toLowerCase()));
  }) || null;
}

// ─── Date parser (handles dd/mm, dd/mm/yyyy, ISO) ────────────────────────────
function parseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s || s === "—") return null;
  // dd/mm
  const ddmm = /^(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (ddmm) {
    const now = new Date();
    return new Date(now.getFullYear(), parseInt(ddmm[2]) - 1, parseInt(ddmm[1]));
  }
  // dd/mm/yyyy
  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (ddmmyyyy) return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2]) - 1, parseInt(ddmmyyyy[1]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function getWeekNum(date) {
  return Math.ceil(date.getDate() / 7);
}

// ─── Compute KPI rows from raw sheet data ─────────────────────────────────────
function computeKpiFromSheet(rows, columns, sheetName) {
  const dateCol       = findColPartial(columns, ["date of contact", "date contacted", "contact date", "date"]);
  const callBookedCol = findColPartial(columns, ["call booked"]);
  const showupCol     = findColPartial(columns, ["show-up on call", "showup on call", "show up on call"]);
  const convertedCol  = findColPartial(columns, ["converted"]);
  const remarksCol    = findColPartial(columns, ["remarks", "remark", "notes", "note"]);
  const showupMsgCol  = findColPartial(columns, ["showup messaging", "show up messaging", "messaging process"]);

  // Group rows by week number
  const weekBuckets = {}; // { 1: [...rows], 2: [...rows], ... }

  rows.forEach(row => {
    // Skip header-like rows (WEEK 2, WEEK 3 label rows inside the sheet)
    const dateVal = row[dateCol] || "";
    const isWeekLabel = /^week\s*\d/i.test(String(dateVal).trim());
    if (isWeekLabel) return;

    // Determine week from date column
    let weekNum = null;
    if (dateCol) {
      const d = parseDate(row[dateCol]);
      if (d) weekNum = getWeekNum(d);
    }
    if (!weekNum) return; // skip rows with no parseable date

    if (!weekBuckets[weekNum]) weekBuckets[weekNum] = [];
    weekBuckets[weekNum].push(row);
  });

  // Build KPI row for each week
  const weekNums = Object.keys(weekBuckets).map(Number).sort((a, b) => a - b);

  const weekRows = weekNums.map(wk => {
    const wkRows = weekBuckets[wk];
    const total = wkRows.length;

    let noResponse = 0, notApplicable = 0, callBooked = 0, noShow = 0, showup = 0, converted = 0;

    wkRows.forEach(row => {
      const cb   = String(row[callBookedCol]  || "").trim().toLowerCase();
      const su   = String(row[showupCol]      || "").trim().toLowerCase();
      const conv = String(row[convertedCol]   || "").trim().toLowerCase();
      const rem  = String(row[remarksCol]     || "").trim().toLowerCase();
      const msg  = String(row[showupMsgCol]   || "").trim().toLowerCase();

      // No Response: call booked = no AND show-up blank/no, OR remarks contains "no response"
      const cbNo  = cb === "no"  || cb === "n"  || cb === "";
      const suBlank = su === "" || su === "-";
      const remNoResponse = rem.includes("no response") || rem.includes("no resp");
      if (remNoResponse || (cbNo && suBlank && !rem.includes("na") && !rem.includes("not applicable"))) {
        noResponse++;
      }

      // Not Applicable: call booked = NA, or converted = NA, or remarks = NA/not applicable
      const isNA = cb === "na" || conv === "na" || rem === "na" || rem.includes("not applicable") ||
                   msg.toLowerCase().includes("na") ||
                   (cb !== "yes" && cb !== "y" && cbNo && (rem === "na" || conv === "na"));
      if (cb === "na" || conv === "na") notApplicable++;

      // Call Booked: yes/y
      if (cb === "yes" || cb === "y") callBooked++;

      // No Show
      if (su === "no show" || su.includes("no show")) noShow++;

      // Show-up
      if (su === "yes" || su === "y") showup++;

      // Converted
      if (conv === "yes" || conv === "y") converted++;
    });

    return { week: `Week ${wk}`, total, noResponse, notApplicable, callBooked, noShow, showup, converted };
  });

  // Total row
  const totals = weekRows.reduce((acc, r) => ({
    week: "Total",
    total:         acc.total         + r.total,
    noResponse:    acc.noResponse    + r.noResponse,
    notApplicable: acc.notApplicable + r.notApplicable,
    callBooked:    acc.callBooked    + r.callBooked,
    noShow:        acc.noShow        + r.noShow,
    showup:        acc.showup        + r.showup,
    converted:     acc.converted     + r.converted,
  }), { week:"Total", total:0, noResponse:0, notApplicable:0, callBooked:0, noShow:0, showup:0, converted:0 });

  return { weekRows, totals, sheetName };
}

// ─── Detect which tabs are month sheets ───────────────────────────────────────
const MONTH_NAMES = ["january","february","march","april","may","june","july","august","september","october","november","december"];
function isMonthTab(name) {
  const n = name.trim().toLowerCase();
  return MONTH_NAMES.some(m => n.startsWith(m));
}

// ─── KPI Table for one month ──────────────────────────────────────────────────
function MonthKpiTable({ monthName, kpi, loading, error }) {
  const headerCols = [
    { key: "week",          label: monthName,           color: "#e2e8f0" },
    { key: "total",         label: "No. of Leads",      color: "#63b3ed" },
    { key: "noResponse",    label: "No Response",       color: "#fc8181" },
    { key: "notApplicable", label: "Not Applicable",    color: "#718096" },
    { key: "callBooked",    label: "Total Calls Booked",color: "#48bb78" },
    { key: "noShow",        label: "No Show",           color: "#f6ad55" },
    { key: "showup",        label: "Total Show-up",     color: "#9f7aea" },
    { key: "converted",     label: "Converted",         color: "#38b2ac" },
  ];

  return (
    <div style={st.monthBlock}>
      {/* Month header */}
      <div style={st.monthLabel}>
        <span style={st.monthDot} />
        {monthName}
        {loading && <span style={st.loadingPill}>syncing…</span>}
        {error   && <span style={st.errorPill}>⚠ {error}</span>}
        {kpi     && <span style={st.rowCountPill}>{kpi.totals.total} leads</span>}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={st.table}>
          <thead>
            <tr>
              {headerCols.map(h => (
                <th key={h.key} style={{ ...st.th, color: h.color }}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={headerCols.length} style={st.placeholderTd}>
                  <div style={st.loadingRow}>
                    <div style={st.spinner} />
                    Loading {monthName} data…
                  </div>
                </td>
              </tr>
            )}
            {!loading && !kpi && !error && (
              <tr><td colSpan={headerCols.length} style={st.placeholderTd}>No data</td></tr>
            )}
            {!loading && kpi && kpi.weekRows.map((row, i) => (
              <tr key={i} style={st.dataRow}>
                <td style={{ ...st.td, color: "#a0aec0", fontWeight: 500 }}>{row.week}</td>
                <td style={{ ...st.tdNum, color: "#63b3ed" }}>{row.total}</td>
                <td style={{ ...st.tdNum, color: "#fc8181" }}>{row.noResponse}</td>
                <td style={{ ...st.tdNum, color: "#718096" }}>{row.notApplicable}</td>
                <td style={{ ...st.tdNum, color: "#48bb78" }}>{row.callBooked}</td>
                <td style={{ ...st.tdNum, color: "#f6ad55" }}>{row.noShow}</td>
                <td style={{ ...st.tdNum, color: "#9f7aea" }}>{row.showup}</td>
                <td style={{ ...st.tdNum, color: "#38b2ac" }}>{row.converted}</td>
              </tr>
            ))}
            {!loading && kpi && (
              <tr style={st.totalRow}>
                <td style={{ ...st.td, color: "#e2e8f0", fontWeight: 700 }}>Total</td>
                <td style={{ ...st.tdNum, color: "#63b3ed", fontWeight: 700 }}>{kpi.totals.total}</td>
                <td style={{ ...st.tdNum, color: "#fc8181", fontWeight: 700 }}>{kpi.totals.noResponse}</td>
                <td style={{ ...st.tdNum, color: "#718096", fontWeight: 700 }}>{kpi.totals.notApplicable}</td>
                <td style={{ ...st.tdNum, color: "#48bb78", fontWeight: 700 }}>{kpi.totals.callBooked}</td>
                <td style={{ ...st.tdNum, color: "#f6ad55", fontWeight: 700 }}>{kpi.totals.noShow}</td>
                <td style={{ ...st.tdNum, color: "#9f7aea", fontWeight: 700 }}>{kpi.totals.showup}</td>
                <td style={{ ...st.tdNum, color: "#38b2ac", fontWeight: 700 }}>{kpi.totals.converted}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function KpiSheetView({ sheetTabs, refreshMs = 15000 }) {
  const monthTabs = useMemo(() => sheetTabs.filter(isMonthTab), [sheetTabs]);

  // { [tabName]: { rows, columns, loading, error } }
  const [dataMap, setDataMap] = useState({});

  const fetchMonth = useCallback(async (tab) => {
    setDataMap(prev => ({ ...prev, [tab]: { ...(prev[tab] || {}), loading: true, error: null } }));
    try {
      const { rows, columns } = await fetchSheetData(tab);
      setDataMap(prev => ({ ...prev, [tab]: { rows, columns, loading: false, error: null } }));
    } catch (err) {
      setDataMap(prev => ({ ...prev, [tab]: { rows: [], columns: [], loading: false, error: err.message || "Failed" } }));
    }
  }, []);

  // Fetch all month tabs on mount + on interval
  useEffect(() => {
    if (monthTabs.length === 0) return;
    monthTabs.forEach(tab => fetchMonth(tab));
    const iv = setInterval(() => monthTabs.forEach(tab => fetchMonth(tab)), refreshMs);
    return () => clearInterval(iv);
  }, [monthTabs.join(",")]); // eslint-disable-line

  // Compute KPI per month
  const kpiMap = useMemo(() => {
    const result = {};
    Object.entries(dataMap).forEach(([tab, { rows, columns }]) => {
      if (rows && rows.length && columns && columns.length) {
        result[tab] = computeKpiFromSheet(rows, columns, tab);
      }
    });
    return result;
  }, [dataMap]);

  if (monthTabs.length === 0) {
    return (
      <div style={st.empty}>
        No month sheets found. Name your tabs after months (e.g. "May 2026", "June 2026") and they will appear here automatically.
      </div>
    );
  }

  return (
    <div style={st.wrap}>
      <div style={st.topBar}>
        <div style={st.heading}>📊 KPI Dashboard</div>
        <div style={st.subheading}>
          Auto-computed from {monthTabs.join(", ")} · refreshes every {refreshMs / 1000}s
        </div>
      </div>

      {monthTabs.map(tab => (
        <MonthKpiTable
          key={tab}
          monthName={tab}
          kpi={kpiMap[tab] || null}
          loading={dataMap[tab]?.loading ?? true}
          error={dataMap[tab]?.error ?? null}
        />
      ))}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const st = {
  wrap:         { padding: "4px 0" },
  topBar:       { marginBottom: 24 },
  heading:      { fontSize: 20, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 },
  subheading:   { fontSize: 12, color: "#4a5568" },

  monthBlock:   { marginBottom: 32 },
  monthLabel:   { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
  monthDot:     { width: 10, height: 10, borderRadius: "50%", background: "#63b3ed", flexShrink: 0 },
  loadingPill:  { fontSize: 11, color: "#63b3ed", background: "rgba(99,179,237,0.1)", border: "1px solid rgba(99,179,237,0.25)", borderRadius: 10, padding: "2px 8px" },
  errorPill:    { fontSize: 11, color: "#fc8181", background: "rgba(252,129,129,0.1)", border: "1px solid rgba(252,129,129,0.25)", borderRadius: 10, padding: "2px 8px" },
  rowCountPill: { fontSize: 11, color: "#48bb78", background: "rgba(72,187,120,0.1)", border: "1px solid rgba(72,187,120,0.2)", borderRadius: 10, padding: "2px 8px" },

  table:        { width: "100%", borderCollapse: "collapse", minWidth: 640 },
  th:           {
    padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600,
    textTransform: "uppercase", letterSpacing: "0.5px",
    background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)",
    whiteSpace: "nowrap",
  },
  dataRow:      { borderBottom: "1px solid rgba(255,255,255,0.04)", transition: "background 0.15s" },
  totalRow:     {
    borderTop: "2px solid rgba(255,255,255,0.1)",
    background: "rgba(99,179,237,0.05)",
  },
  td:           { padding: "11px 16px", fontSize: 13, whiteSpace: "nowrap" },
  tdNum:        { padding: "11px 16px", fontSize: 14, fontFamily: "'DM Mono',monospace", fontWeight: 600, whiteSpace: "nowrap" },
  placeholderTd:{ padding: "24px 16px", textAlign: "center", color: "#4a5568", fontSize: 13 },
  loadingRow:   { display: "flex", alignItems: "center", gap: 10, justifyContent: "center" },
  spinner:      { width: 16, height: 16, border: "2px solid rgba(255,255,255,0.08)", borderTopColor: "#63b3ed", borderRadius: "50%", animation: "kpi-spin 0.8s linear infinite" },
  empty:        { padding: 40, textAlign: "center", color: "#4a5568", fontSize: 14, background: "rgba(255,255,255,0.02)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" },
};
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { fetchSheetData, fetchSpreadsheetTabs } from "./sheets";
import DashboardCharts from "./components/DashboardCharts";
import {
  filterByPeriod,
  sortRows,
  computeStatsFromList,
  HR_COLUMNS,
} from "./utils/analytics";
import { rowMatchesSearch, findColumn } from "./utils/sheetData";

const REFRESH_MS = Number(process.env.REACT_APP_REFRESH_MS) || 5000;

const MANAGER_ALIASES    = ["managed by","manager","managed_by","team lead","team_lead","lead","handled by","assigned to","owner"];
const UNIVERSITY_ALIASES = ["university","college","institution","school","institute","university name","college name"];
const ID_ALIASES         = ["id","sr no","sr. no","s.no","s no","serial no","serial number","no.","no","employee id","emp id","lead id","row id"];
const BOOKING_ID_ALIASES = ["booking id","booking_id","bookingid","booking no","booking number","booking ref","reference id","ref id","reservation id"];
const SOURCE_ALIASES     = ["source","lead source","lead_source","channel","referral","utm source","origin","platform","medium"];
const NAME_ALIASES       = ["name","full name","fullname","full_name","candidate name","client name","customer name","contact name","person name","first name","student name"];

const PERIOD_OPTIONS = [
  { id: "all", label: "All Time" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
];

const SORT_OPTIONS = [
  { id: "id-asc",      label: "ID ↑" },
  { id: "id-desc",     label: "ID ↓" },
  { id: "date-desc",   label: "Join Date ↓" },
  { id: "date-asc",    label: "Join Date ↑" },
  { id: "name-asc",    label: "Name A–Z" },
  { id: "name-desc",   label: "Name Z–A" },
  { id: "salary-desc", label: "Salary ↓" },
  { id: "salary-asc",  label: "Salary ↑" },
];

const STATUS_COLORS = {
  Active:   { bg: "rgba(72,187,120,0.15)",  color: "#48bb78" },
  active:   { bg: "rgba(72,187,120,0.15)",  color: "#48bb78" },
  Inactive: { bg: "rgba(252,129,129,0.15)", color: "#fc8181" },
  inactive: { bg: "rgba(252,129,129,0.15)", color: "#fc8181" },
  "On Leave": { bg: "rgba(246,173,85,0.15)", color: "#f6ad55" },
};

const FILTER_ICONS = {
  manager: "👤", university: "🎓", source: "📡", name: "🙍",
  bookingId: "🔖", dept: "🏢", period: "📅", sort: "↕️",
};

function formatCell(col, value) {
  const text = value != null ? String(value) : "";
  if (!text) return "—";
  if (col.toLowerCase().includes("salary") && !Number.isNaN(Number(text.replace(/,/g, "")))) {
    return `₹${Number(text.replace(/,/g, "")).toLocaleString()}`;
  }
  return text;
}

function isStatusColumn(col) {
  return col.toLowerCase() === "status";
}

// ── Active filter chip ────────────────────────────────────────────────────────
function FilterChip({ icon, label, value, onRemove }) {
  return (
    <div style={chip.wrap}>
      <span style={chip.icon}>{icon}</span>
      <span style={chip.label}>{label}:</span>
      <span style={chip.value}>{value}</span>
      <button onClick={onRemove} style={chip.x} title="Remove filter">✕</button>
    </div>
  );
}
const chip = {
  wrap:  { display:"flex", alignItems:"center", gap:4, background:"rgba(99,179,237,0.12)", border:"1px solid rgba(99,179,237,0.3)", borderRadius:20, padding:"4px 10px 4px 8px", fontSize:12 },
  icon:  { fontSize:13 },
  label: { color:"#718096", fontWeight:500 },
  value: { color:"#63b3ed", fontWeight:600, maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  x:     { background:"none", border:"none", color:"#4a5568", cursor:"pointer", fontSize:13, padding:"0 0 0 4px", lineHeight:1, display:"flex", alignItems:"center" },
};

// ── Single filter row inside panel ───────────────────────────────────────────
function FilterRow({ label, icon, children }) {
  return (
    <div style={fr.row}>
      <div style={fr.labelWrap}>
        <span style={fr.icon}>{icon}</span>
        <span style={fr.label}>{label}</span>
      </div>
      {children}
    </div>
  );
}
const fr = {
  row:       { display:"flex", alignItems:"center", gap:12, padding:"8px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" },
  labelWrap: { display:"flex", alignItems:"center", gap:6, minWidth:110 },
  icon:      { fontSize:14 },
  label:     { fontSize:11, color:"#718096", textTransform:"uppercase", letterSpacing:"0.5px", fontWeight:500 },
};

export default function App() {
  const [columns, setColumns]         = useState([]);
  const [rows, setRows]               = useState([]);
  const [sheetTabs, setSheetTabs]     = useState([]);
  const [activeSheet, setActiveSheet] = useState(null);
  const [tabsLoading, setTabsLoading] = useState(true);
  const [loading, setLoading]         = useState(true);

  // ── All filters ──────────────────────────────────────────────────────────
  const [search,         setSearch]         = useState("");
  const [filterDept,     setFilterDept]     = useState("All");
  const [filterManager,  setFilterManager]  = useState("All");
  const [filterUniversity, setFilterUniversity] = useState("All");
  const [filterSource,   setFilterSource]   = useState("All");
  const [filterName,     setFilterName]     = useState("All");
  const [filterBookingId,setFilterBookingId]= useState("");
  const [period,         setPeriod]         = useState("all");
  const [sortBy,         setSortBy]         = useState("id-asc");

  const [toast, setToast]             = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const prevHash     = useRef("");
  const prevTabsRef  = useRef([]);
  const isFirstLoad  = useRef(true);

  const resetFilters = () => {
    setSearch(""); setFilterDept("All"); setFilterManager("All");
    setFilterUniversity("All"); setFilterSource("All");
    setFilterName("All"); setFilterBookingId("");
    setPeriod("all"); setSortBy("id-asc");
  };

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchAll = useCallback(async (silent = false) => {
    if (!activeSheet) return;
    try {
      const data = await fetchSheetData(activeSheet);
      const hash = `${activeSheet}:${JSON.stringify(data)}`;
      const changed = hash !== prevHash.current;
      prevHash.current = hash;
      setColumns(data.columns);
      setRows(data.rows);
      if (changed && silent && !isFirstLoad.current) {
        showToast(`"${activeSheet}" — ${data.rows.length} row(s), ${data.columns.length} col(s)`);
      }
      setLastRefresh(new Date());
    } catch (err) {
      setColumns([]); setRows([]);
      showToast(`"${activeSheet}": ${err.message || "Failed to load"}`, "error");
    } finally {
      setLoading(false);
      isFirstLoad.current = false;
    }
  }, [activeSheet]);

  const switchSheet = (name) => {
    if (name === activeSheet) return;
    prevHash.current = "";
    setLoading(true); setColumns([]); setRows([]);
    resetFilters();
    setActiveSheet(name);
  };

  const refreshSheetTabs = useCallback(async () => {
    try {
      const tabs = await fetchSpreadsheetTabs();
      const prev = prevTabsRef.current;
      const added = tabs.filter((t) => !prev.includes(t));
      setSheetTabs(tabs);
      if (added.length > 0 && prev.length > 0) {
        const newest = added[added.length - 1];
        showToast(`New sheet "${newest}" — loading data…`);
        prevHash.current = "";
        setLoading(true); setColumns([]); setRows([]);
        resetFilters();
        setActiveSheet(newest);
      } else {
        setActiveSheet((cur) => (cur && tabs.includes(cur) ? cur : tabs[0] ?? null));
      }
      prevTabsRef.current = tabs;
      return tabs;
    } catch (err) {
      const fallback = process.env.REACT_APP_SHEET_NAME?.split(",")[0]?.trim() || "Sheet1";
      setSheetTabs([fallback]);
      setActiveSheet((cur) => cur || fallback);
      showToast(err.message || "Could not load sheet tabs", "error");
      return [];
    } finally {
      setTabsLoading(false);
    }
  }, []);

  const handleSyncNow = useCallback(async () => {
    setTabsLoading(true);
    await refreshSheetTabs();
    await fetchAll();
  }, [refreshSheetTabs, fetchAll]);

  useEffect(() => {
    refreshSheetTabs();
    const iv = setInterval(refreshSheetTabs, REFRESH_MS);
    return () => clearInterval(iv);
  }, [refreshSheetTabs]);

  useEffect(() => {
    if (!activeSheet) return;
    fetchAll();
    const iv = setInterval(() => fetchAll(true), REFRESH_MS);
    return () => clearInterval(iv);
  }, [fetchAll, activeSheet]);

  // ── Column detection ────────────────────────────────────────────────────
  const deptColumn       = useMemo(() => findColumn(columns, HR_COLUMNS.department), [columns]);
  const dateColumn       = useMemo(() => findColumn(columns, HR_COLUMNS.joinDate),   [columns]);
  const managerColumn    = useMemo(() => findColumn(columns, MANAGER_ALIASES),        [columns]);
  const universityColumn = useMemo(() => findColumn(columns, UNIVERSITY_ALIASES),     [columns]);
  const idColumn         = useMemo(() => findColumn(columns, ID_ALIASES),             [columns]);
  const bookingIdColumn  = useMemo(() => findColumn(columns, BOOKING_ID_ALIASES),     [columns]);
  const sourceColumn     = useMemo(() => findColumn(columns, SOURCE_ALIASES),         [columns]);
  const nameColumn       = useMemo(() => findColumn(columns, NAME_ALIASES),           [columns]);

  const periodFiltered = useMemo(() => filterByPeriod(rows, columns, period), [rows, columns, period]);

  // ── Dropdown option lists (unique values from ALL rows, not just filtered) ─
  const departments  = useMemo(() => {
    if (!deptColumn) return [];
    return ["All", ...new Set(periodFiltered.map((r) => r[deptColumn]).filter(Boolean))];
  }, [periodFiltered, deptColumn]);

  const managers = useMemo(() => {
    if (!managerColumn) return [];
    return ["All", ...[...new Set(periodFiltered.map((r) => String(r[managerColumn]||"").trim()).filter(Boolean))].sort()];
  }, [periodFiltered, managerColumn]);

  const universities = useMemo(() => {
    if (!universityColumn) return [];
    return ["All", ...[...new Set(periodFiltered.map((r) => String(r[universityColumn]||"").trim()).filter(Boolean))].sort()];
  }, [periodFiltered, universityColumn]);

  const sources = useMemo(() => {
    if (!sourceColumn) return [];
    return ["All", ...[...new Set(periodFiltered.map((r) => String(r[sourceColumn]||"").trim()).filter(Boolean))].sort()];
  }, [periodFiltered, sourceColumn]);

  const names = useMemo(() => {
    if (!nameColumn) return [];
    return ["All", ...[...new Set(periodFiltered.map((r) => String(r[nameColumn]||"").trim()).filter(Boolean))].sort()];
  }, [periodFiltered, nameColumn]);

  // ── Filtered + sorted rows ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    const list = periodFiltered.filter((row) => {
      if (!rowMatchesSearch(row, columns, search)) return false;
      if (deptColumn       && filterDept       !== "All" && row[deptColumn] !== filterDept) return false;
      if (managerColumn    && filterManager    !== "All" && String(row[managerColumn]||"").trim()    !== filterManager)    return false;
      if (universityColumn && filterUniversity !== "All" && String(row[universityColumn]||"").trim() !== filterUniversity) return false;
      if (sourceColumn     && filterSource     !== "All" && String(row[sourceColumn]||"").trim()     !== filterSource)     return false;
      if (nameColumn       && filterName       !== "All" && String(row[nameColumn]||"").trim()       !== filterName)       return false;
      if (bookingIdColumn  && filterBookingId.trim() &&
          !String(row[bookingIdColumn]||"").toLowerCase().includes(filterBookingId.trim().toLowerCase())) return false;
      return true;
    });
    if ((sortBy === "id-asc" || sortBy === "id-desc") && idColumn) {
      return [...list].sort((a, b) => {
        const av = parseFloat(String(a[idColumn]||"").replace(/[^0-9.-]/g,"")) || 0;
        const bv = parseFloat(String(b[idColumn]||"").replace(/[^0-9.-]/g,"")) || 0;
        return sortBy === "id-asc" ? av - bv : bv - av;
      });
    }
    return sortRows(list, columns, sortBy);
  }, [periodFiltered, columns, search, filterDept, deptColumn, filterManager, managerColumn,
      filterUniversity, universityColumn, filterSource, sourceColumn, filterName, nameColumn,
      filterBookingId, bookingIdColumn, idColumn, sortBy]);

  // ── Active filter chips list ───────────────────────────────────────────
  const activeFilters = useMemo(() => {
    const chips = [];
    if (period !== "all")             chips.push({ key:"period",     icon:FILTER_ICONS.period,    label:"Period",     value: PERIOD_OPTIONS.find(p=>p.id===period)?.label, clear:()=>setPeriod("all") });
    if (sortBy !== "id-asc")          chips.push({ key:"sort",       icon:FILTER_ICONS.sort,      label:"Sort",       value: SORT_OPTIONS.find(s=>s.id===sortBy)?.label,   clear:()=>setSortBy("id-asc") });
    if (filterDept !== "All")         chips.push({ key:"dept",       icon:FILTER_ICONS.dept,      label:"Dept",       value: filterDept,       clear:()=>setFilterDept("All") });
    if (filterManager !== "All")      chips.push({ key:"manager",    icon:FILTER_ICONS.manager,   label:"Manager",    value: filterManager,    clear:()=>setFilterManager("All") });
    if (filterUniversity !== "All")   chips.push({ key:"university", icon:FILTER_ICONS.university,label:"University", value: filterUniversity, clear:()=>setFilterUniversity("All") });
    if (filterSource !== "All")       chips.push({ key:"source",     icon:FILTER_ICONS.source,    label:"Source",     value: filterSource,     clear:()=>setFilterSource("All") });
    if (filterName !== "All")         chips.push({ key:"name",       icon:FILTER_ICONS.name,      label:"Name",       value: filterName,       clear:()=>setFilterName("All") });
    if (filterBookingId.trim())       chips.push({ key:"bookingId",  icon:FILTER_ICONS.bookingId, label:"Booking ID", value: filterBookingId,  clear:()=>setFilterBookingId("") });
    if (search.trim())                chips.push({ key:"search",     icon:"🔍",                   label:"Search",     value: search,           clear:()=>setSearch("") });
    return chips;
  }, [period, sortBy, filterDept, filterManager, filterUniversity, filterSource, filterName, filterBookingId, search]);

  // ── Stats ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => computeStatsFromList(filtered, columns), [filtered, columns]);

  // Manager-count KPI cards (one per manager, sorted by count desc)
  const managerKpiCards = useMemo(() => {
    if (!managerColumn) return null;
    const map = {};
    filtered.forEach((row) => {
      const mgr = String(row[managerColumn] || "").trim() || "(Unassigned)";
      map[mgr] = (map[mgr] || 0) + 1;
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ label: name, value: count, icon: "👤" }));
  }, [filtered, managerColumn]);

  const statCards = useMemo(() => {
    // If we have manager data, show manager KPI cards + a total card
    if (managerKpiCards && managerKpiCards.length > 0) {
      return [
        { label: "Total Rows", value: filtered.length, icon: "📋" },
        ...managerKpiCards,
      ];
    }
    if (stats.isHr) return [
      { label:"Total Rows",   value: stats.total,      icon:"👥" },
      { label:"Active",       value: stats.active ?? "—", icon:"✅" },
      { label:"Departments",  value: stats.departments ?? "—", icon:"🏢" },
      { label:"Total Salary", value: stats.totalSalary != null ? `₹${(stats.totalSalary/100000).toFixed(1)}L` : "—", icon:"💰" },
    ];
    return [
      { label:"Total Rows",   value: stats.total,                 icon:"📋" },
      { label:"Columns",      value: stats.columns ?? columns.length, icon:"📊" },
      { label:"Sheet",        value: activeSheet || "—",          icon:"📑" },
      { label:"Filled Cells", value: stats.filledCells ?? "—",   icon:"✏️" },
    ];
  }, [stats, columns.length, activeSheet, managerKpiCards, filtered.length]);

  const appSelect = {
    padding:"8px 36px 8px 12px", borderRadius:8,
    border:"1px solid rgba(255,255,255,0.12)",
    background:"#0d1829", color:"#e2e8f0", fontSize:13,
    fontFamily:"'DM Sans',sans-serif", cursor:"pointer",
    outline:"none", appearance:"none", width:"100%",
    backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23a0aec0' d='M2 4l4 4 4-4'/%3E%3C/svg%3E\")",
    backgroundRepeat:"no-repeat", backgroundPosition:"right 12px center",
  };

  return (
    <div style={s.app}>
      {toast && (
        <div style={{ ...s.toast, background: toast.type==="error"?"#7f1d1d":"#14532d", borderColor: toast.type==="error"?"#fc8181":"#48bb78" }}>
          {toast.type==="error"?"⚠ ":"✓ "}{toast.msg}
        </div>
      )}

      {/* ── Header ── */}
      <div style={s.header}>
        <div>
          <div style={s.logo}>HR Dashboard</div>
          <div style={s.subtitle}>Live from Google Sheets · New tabs appear automatically</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={s.liveIndicator}>
            <span style={s.liveDot}></span>
            {lastRefresh
              ? `Last sync: ${lastRefresh.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}`
              : "Connecting..."}
          </div>
          <button onClick={handleSyncNow} style={s.refreshBtn}>↻ Sync Now</button>
        </div>
      </div>

      <div style={s.main}>
        {/* ── Stat cards ── */}
        <div style={{ ...s.statsGrid, gridTemplateColumns: `repeat(auto-fit, minmax(160px, 1fr))` }}>
          {statCards.map((st) => (
            <div key={st.label} style={s.statCard}>
              <div style={s.statIcon}>{st.icon}</div>
              <div style={s.statValue}>{loading ? "—" : st.value}</div>
              <div style={s.statLabel}>{st.label}</div>
            </div>
          ))}
        </div>

        {/* ── Inline Filters (always visible) ── */}
        <div style={s.inlineFilters}>
          {/* Search */}
          <div style={{ position:"relative", flex:"2 1 200px", minWidth:180 }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"#4a5568", fontSize:14, pointerEvents:"none" }}>🔍</span>
            <input
              placeholder="Search all columns..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...s.searchInput, paddingLeft:36 }}
            />
          </div>

          {/* Sheet selector */}
          {!tabsLoading && sheetTabs.length > 0 && (
            <div style={s.filterItem}>
              <span style={s.filterItemLabel}>📋 Sheet</span>
              <select style={appSelect} value={activeSheet||""} onChange={(e)=>switchSheet(e.target.value)}>
                {sheetTabs.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}

          {/* Manager */}
          {managers.length > 1 && (
            <div style={s.filterItem}>
              <span style={s.filterItemLabel}>👤 Managed By</span>
              <select style={{ ...appSelect, borderColor: filterManager!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                value={filterManager} onChange={(e)=>setFilterManager(e.target.value)}>
                {managers.map((m) => <option key={m} value={m}>{m==="All"?"All Managers":m}</option>)}
              </select>
            </div>
          )}

          {/* University */}
          {universities.length > 1 && (
            <div style={s.filterItem}>
              <span style={s.filterItemLabel}>🎓 University</span>
              <select style={{ ...appSelect, borderColor: filterUniversity!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                value={filterUniversity} onChange={(e)=>setFilterUniversity(e.target.value)}>
                {universities.map((u) => <option key={u} value={u}>{u==="All"?"All Universities":u}</option>)}
              </select>
            </div>
          )}

          {/* Source */}
          {sources.length > 1 && (
            <div style={s.filterItem}>
              <span style={s.filterItemLabel}>📡 Source</span>
              <select style={{ ...appSelect, borderColor: filterSource!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                value={filterSource} onChange={(e)=>setFilterSource(e.target.value)}>
                {sources.map((src) => <option key={src} value={src}>{src==="All"?"All Sources":src}</option>)}
              </select>
            </div>
          )}

          {/* Name */}
          {names.length > 1 && (
            <div style={s.filterItem}>
              <span style={s.filterItemLabel}>🙍 Name</span>
              <select style={{ ...appSelect, borderColor: filterName!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                value={filterName} onChange={(e)=>setFilterName(e.target.value)}>
                {names.map((n) => <option key={n} value={n}>{n==="All"?"All Names":n}</option>)}
              </select>
            </div>
          )}

          {/* Booking ID */}
          {bookingIdColumn && (
            <div style={s.filterItem}>
              <span style={s.filterItemLabel}>🔖 Booking ID</span>
              <div style={{ position:"relative" }}>
                <input
                  placeholder="Search booking ID…"
                  value={filterBookingId}
                  onChange={(e)=>setFilterBookingId(e.target.value)}
                  style={{ ...appSelect, paddingRight: filterBookingId ? 30 : 12, cursor:"text", appearance:"none", backgroundImage:"none", width:"100%", boxSizing:"border-box" }}
                />
                {filterBookingId && (
                  <button onClick={()=>setFilterBookingId("")}
                    style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:"#718096", cursor:"pointer", fontSize:13 }}>✕</button>
                )}
              </div>
            </div>
          )}

          {/* Period */}
          {dateColumn && (
            <div style={s.filterItem}>
              <span style={s.filterItemLabel}>📅 Period</span>
              <select style={appSelect} value={period} onChange={(e)=>setPeriod(e.target.value)}>
                {PERIOD_OPTIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
          )}

          {/* Dept */}
          {departments.length > 1 && (
            <div style={s.filterItem}>
              <span style={s.filterItemLabel}>🏢 Department</span>
              <select style={{ ...appSelect, borderColor: filterDept!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                value={filterDept} onChange={(e)=>setFilterDept(e.target.value)}>
                {departments.map((d) => <option key={d} value={d}>{d==="All"?"All Departments":d}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* ── Row count + reset ── */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <span style={{ fontSize:12, color:"#4a5568" }}>{filtered.length} of {rows.length} rows match</span>
          {activeFilters.length > 0 && (
            <button onClick={resetFilters} style={s.clearBtn}>✕ Reset all filters</button>
          )}
        </div>

        {/* ── Charts ── */}
        {!loading && <DashboardCharts rows={filtered} columns={columns} period={period} />}

        {/* ── Table ── */}
        <div style={s.tableWrap}>
          <div style={s.tableHeader}>
            <span style={s.tableTitle}>
              Data
              {activeSheet && <span style={{ color:"#63b3ed", marginLeft:6 }}>· {activeSheet}</span>}
              {" "}<span style={{ color:"#4a5568", fontWeight:400 }}>({filtered.length} rows · {columns.length} columns)</span>
            </span>
            {(tabsLoading || sheetTabs.length > 0) && !tabsLoading && (
              <span style={{ fontSize:11, color:"#4a5568" }}>
                {sheetTabs.length} tab{sheetTabs.length===1?"":"s"} · refreshes every {REFRESH_MS/1000}s
              </span>
            )}
          </div>

          {loading ? (
            <div style={s.empty}>Loading from Google Sheets...</div>
          ) : filtered.length === 0 ? (
            <div style={s.empty}>
              {rows.length === 0
                ? `No data in "${activeSheet}". Add a header row and data in Google Sheets.`
                : "No rows match your filters. Try adjusting or clearing them."}
            </div>
          ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={s.table}>
                <thead>
                  <tr>{columns.map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {filtered.map((row, i) => (
                    <tr key={i} style={s.tr}>
                      {columns.map((col) => {
                        const val = row[col];
                        if (isStatusColumn(col)) {
                          return (
                            <td key={col} style={s.td}>
                              <span style={{ ...s.badge, background: STATUS_COLORS[val]?.bg||"rgba(255,255,255,0.08)", color: STATUS_COLORS[val]?.color||"#a0aec0" }}>
                                {val||"—"}
                              </span>
                            </td>
                          );
                        }
                        return <td key={col} style={s.td}>{formatCell(col, val)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const s = {
  app:        { minHeight:"100vh", background:"#0a0f1e", fontFamily:"'DM Sans',sans-serif", color:"#e2e8f0" },
  header:     { background:"#0d1422", borderBottom:"1px solid rgba(255,255,255,0.07)", padding:"16px 28px", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:100 },
  logo:       { fontSize:18, fontWeight:600, color:"#63b3ed", letterSpacing:"-0.3px" },
  subtitle:   { fontSize:12, color:"#4a5568", marginTop:2 },
  liveIndicator: { display:"flex", alignItems:"center", gap:6, fontSize:12, color:"#718096", fontFamily:"'DM Mono',monospace" },
  liveDot:    { width:6, height:6, borderRadius:"50%", background:"#48bb78", display:"inline-block" },
  refreshBtn: { padding:"8px 16px", borderRadius:8, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:"#a0aec0", cursor:"pointer", fontSize:13, fontFamily:"'DM Sans',sans-serif" },
  main:       { padding:"24px 28px" },
  statsGrid:  { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16, marginBottom:24 },
  statCard:   { background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:20, textAlign:"center" },
  statIcon:   { fontSize:24, marginBottom:8 },
  statValue:  { fontSize:28, fontWeight:600, color:"#e2e8f0", fontFamily:"'DM Mono',monospace" },
  statLabel:  { fontSize:12, color:"#718096", marginTop:4, textTransform:"uppercase", letterSpacing:"0.5px" },

  // filter bar
  inlineFilters: { display:"flex", alignItems:"flex-end", gap:10, marginBottom:14, flexWrap:"wrap", background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:"14px 16px" },
  filterItem: { display:"flex", flexDirection:"column", gap:4, flex:"1 1 140px", minWidth:130 },
  filterItemLabel: { fontSize:11, color:"#718096", fontWeight:500, textTransform:"uppercase", letterSpacing:"0.4px" },
  searchInput:{ flex:"2 1 200px", minWidth:180, padding:"10px 16px", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, color:"#e2e8f0", fontSize:14, fontFamily:"'DM Sans',sans-serif", outline:"none" },

  // table
  tableWrap:   { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, overflow:"hidden" },
  tableHeader: { padding:"14px 20px", borderBottom:"1px solid rgba(255,255,255,0.06)", display:"flex", alignItems:"center", justifyContent:"space-between" },
  tableTitle:  { fontSize:14, fontWeight:500, color:"#a0aec0" },
  table:       { width:"100%", borderCollapse:"collapse" },
  th:          { padding:"10px 16px", textAlign:"left", fontSize:11, fontWeight:500, color:"#4a5568", textTransform:"uppercase", letterSpacing:"0.6px", background:"rgba(255,255,255,0.02)", borderBottom:"1px solid rgba(255,255,255,0.06)", whiteSpace:"nowrap" },
  tr:          { borderBottom:"1px solid rgba(255,255,255,0.04)" },
  td:          { padding:"11px 16px", fontSize:13, color:"#a0aec0", whiteSpace:"nowrap" },
  badge:       { padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:500 },
  empty:       { textAlign:"center", padding:48, color:"#4a5568", fontSize:14 },
  toast:       { position:"fixed", bottom:24, right:24, padding:"12px 20px", borderRadius:10, border:"1px solid", fontSize:13, fontWeight:500, zIndex:9999 },
};
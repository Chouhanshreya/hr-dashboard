import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { fetchSheetData, fetchSpreadsheetTabs } from "./sheets.js";
import DashboardCharts from "./components/DashboardCharts";
import KpiSheetView from "./components/KpisheetView";
import {
  filterByPeriod,
  buildPeriodOptions,
  computeStatsFromList,
  HR_COLUMNS,
} from "./utils/analytics";
import { rowMatchesSearch, findColumn } from "./utils/sheetData";

const REFRESH_MS = Number(process.env.REACT_APP_REFRESH_MS) || 5000;

/** True when the active tab IS the KPI summary sheet (not a month data sheet) */
function isKpiTabName(name) {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  // Match: "kpi", "kpi sheet", "kpisheet", "kpi data", "kpi summary", etc.
  return n === "kpi" || n.startsWith("kpi ") || n.startsWith("kpi_") || n.includes("kpi");
}

const MANAGER_ALIASES    = ["managed by","manager","managed_by","managedby","managed_by_name","team lead","team_lead","teamlead","lead","handled by","assigned to","owner","reporting to","reports to","supervisor","incharge","in charge"];
const UNIVERSITY_ALIASES = ["university","college","institution","school","institute","university name","college name"];
const ID_ALIASES         = ["id","sr no","sr. no","s.no","s no","serial no","serial number","no.","no","employee id","emp id","lead id","row id"];
const BOOKING_ID_ALIASES = ["booking id","booking_id","bookingid","booking no","booking number","booking ref","reference id","ref id","reservation id"];
const SOURCE_ALIASES     = ["source","lead source","lead_source","channel","referral","utm source","origin","platform","medium"];
const NAME_ALIASES       = ["name","full name","fullname","full_name","candidate name","client name","customer name","contact name","person name","first name","student name"];
const SHOWUP_MSG_ALIASES = ["showup messaging process","showup messaging","show up messaging","messaging process","showup msg"];
const CALL_BOOKED_ALIASES= ["call booked","call booked - y/n","call booked y/n","booked call","booking call"];
const SHOWUP_CALL_ALIASES= ["show-up on call","showup on call","show up on call","showed up","show up call","showup call"];
const CONVERTED_ALIASES  = ["converted","conversion","is converted","deal closed","closed"];
const DATE_CONTACT_ALIASES=["date of contact","contact date","date contacted","contacted on","date"];
const CALL_DATE_ALIASES  = ["call date","date of call","scheduled date","appointment date"];

const PERIOD_MODE_OPTIONS = [
  { id: "all",     label: "All Time" },
  { id: "monthly", label: "By Month" },
  { id: "weekly",  label: "By Week" },
  { id: "daily",   label: "By Day" },
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
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ── All filters ──────────────────────────────────────────────────────────
  const [search,         setSearch]         = useState("");
  const [filterDept,     setFilterDept]     = useState("All");
  const [filterManager,  setFilterManager]  = useState("All");
  const [filterUniversity, setFilterUniversity] = useState("All");
  const [filterSource,   setFilterSource]   = useState("All");
  const [filterName,     setFilterName]     = useState("All");
  const [filterBookingId,setFilterBookingId]= useState("All");
  const [filterShowupMsg,  setFilterShowupMsg]  = useState("All");
  const [filterCallBooked, setFilterCallBooked] = useState("All");
  const [filterShowupCall, setFilterShowupCall] = useState("All");
  const [filterConverted,  setFilterConverted]  = useState("All");
  const [periodMode,     setPeriodMode]     = useState("all");
  const [periodValue,    setPeriodValue]    = useState("all");
  const [kpiMonth,       setKpiMonth]       = useState("all");  // for KPI sheet
  const [kpiWeek,        setKpiWeek]        = useState("all");  // for KPI sheet
  const [weekFilter,     setWeekFilter]     = useState("all");  // for data sheets (week of month)
  const [monthFilter,    setMonthFilter]    = useState("all");  // for data sheets (month)

  const [toast, setToast]             = useState(null);
  const [isSyncing, setIsSyncing]     = useState(false);
  const [kpiSyncKey, setKpiSyncKey]   = useState(0);
  const [lastRefresh, setLastRefresh] = useState(null);
  const prevHash     = useRef("");
  const prevTabsRef  = useRef([]);
  const isFirstLoad  = useRef(true);

  const resetFilters = () => {
    setSearch(""); setFilterDept("All"); setFilterManager("All");
    setFilterUniversity("All"); setFilterSource("All");
    setFilterName("All"); setFilterBookingId("All");
    setFilterShowupMsg("All"); setFilterCallBooked("All");
    setFilterShowupCall("All"); setFilterConverted("All");
    setPeriodMode("all"); setPeriodValue("all");
    setKpiMonth("all"); setKpiWeek("all");
    setWeekFilter("all"); setMonthFilter("all");
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
    setIsSyncing(true);
    setTabsLoading(true);
    try {
      await refreshSheetTabs();
      await fetchAll();
      setKpiSyncKey(k => k + 1);
    } finally {
      setIsSyncing(false);
    }
  }, [refreshSheetTabs, fetchAll]);

  const goHome = useCallback(() => {
    resetFilters();
    if (sheetTabs.length > 0) {
      setActiveSheet(sheetTabs[0]);
    }
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/");
    }
  }, [sheetTabs]);

  useEffect(() => {
    // Load tabs once on mount — manual Sync Now button handles re-fetching
    refreshSheetTabs();
  }, [refreshSheetTabs]);

  useEffect(() => {
    // Load sheet data once when activeSheet changes — no auto-refresh
    if (!activeSheet) return;
    fetchAll();
  }, [fetchAll, activeSheet]);

  // ── Column detection ────────────────────────────────────────────────────
  const deptColumn       = useMemo(() => findColumn(columns, HR_COLUMNS.department), [columns]);
  const dateColumn       = useMemo(() => findColumn(columns, HR_COLUMNS.joinDate),   [columns]);
  const universityColumn = useMemo(() => findColumn(columns, UNIVERSITY_ALIASES),     [columns]);

  // Manager column — exact match first, then partial match fallback
  // This ensures "Managed By", "Manager", "Reporting To" etc. are ALL caught
  const managerColumn = useMemo(() => {
    const exact = findColumn(columns, MANAGER_ALIASES);
    if (exact) return exact;
    return columns.find((c) => {
      const n = c.trim().toLowerCase();
      return n.includes("manag") || n.includes("reporting") || n.includes("supervisor");
    }) || null;
  }, [columns]);

  const dateContactColumn= useMemo(() => findColumn(columns, DATE_CONTACT_ALIASES),[columns]);
  const callDateColumn   = useMemo(() => findColumn(columns, CALL_DATE_ALIASES),   [columns]);

  // ── Date parsing helpers (defined early — used by filtered useMemo below) ──
  const activeDateCol = useMemo(() =>
    dateContactColumn || callDateColumn || null,
    [dateContactColumn, callDateColumn]
  );

  const parseDateVal = (val) => {
    if (!val) return null;
    const s = String(val).trim();
    if (!s || s === "—" || s === "-") return null;
    const ddmm = /^(\d{1,2})\/(\d{1,2})$/.exec(s);
    if (ddmm) {
      const now = new Date();
      return new Date(now.getFullYear(), parseInt(ddmm[2]) - 1, parseInt(ddmm[1]));
    }
    const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (ddmmyyyy) return new Date(parseInt(ddmmyyyy[3]), parseInt(ddmmyyyy[2])-1, parseInt(ddmmyyyy[1]));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  const getWeekMonthLabel = (date) => {
    const weekNum = Math.ceil(date.getDate() / 7);
    const month = date.toLocaleString("en-US", { month: "long" });
    return `Week ${weekNum} of ${month}`;
  };

  const getMonthYearLabel = (date) =>
    date.toLocaleString("en-US", { month: "long", year: "numeric" });

  const showupMsgColumn  = useMemo(() => findColumn(columns, SHOWUP_MSG_ALIASES),  [columns]);
  const callBookedColumn = useMemo(() => findColumn(columns, CALL_BOOKED_ALIASES), [columns]);
  const showupCallColumn = useMemo(() => findColumn(columns, SHOWUP_CALL_ALIASES), [columns]);
  const convertedColumn  = useMemo(() => findColumn(columns, CONVERTED_ALIASES),   [columns]);
  const idColumn         = useMemo(() => findColumn(columns, ID_ALIASES),             [columns]);
  const bookingIdColumn  = useMemo(() => findColumn(columns, BOOKING_ID_ALIASES),     [columns]);
  const sourceColumn     = useMemo(() => findColumn(columns, SOURCE_ALIASES),         [columns]);
  const nameColumn       = useMemo(() => findColumn(columns, NAME_ALIASES),           [columns]);

  // ── KPI sheet detection (must be before dataMonthOptions) ────────────
  // ── KPI tab ────────────────────────────────────────────────────────────
  const isKpiTab = isKpiTabName(activeSheet);

  // Inject spinner keyframes once
  useEffect(() => {
    const id = "kpi-spin-style";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = "@keyframes kpi-spin { to { transform: rotate(360deg); } }";
      document.head.appendChild(style);
    }
  }, []);

  const isKpiSheet = useMemo(() => {
    if (!columns.length || !rows.length) return false;
    const firstCol = columns[0];
    const vals = rows.map(r => String(r[firstCol] || "").trim().toLowerCase());
    // KPI sheet must have BOTH week rows ("week 1", "week2") AND standalone month name rows
    const weekPattern = /^week\s*\d/;
    const hasWeeks = vals.some(v => weekPattern.test(v));
    const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    // Standalone month name (exact) or "Month Year" — never a date like "May 12, 2025"
    const hasMonths = vals.some(v => monthNames.some(m => v === m || /^[a-z]+ \d{4}$/.test(v)));
    return hasWeeks && hasMonths;
  }, [columns, rows]);

  // Build unique month/week options from data sheet rows
  const dataMonthOptions = useMemo(() => {
    if (isKpiSheet || !activeDateCol) return [];
    const months = new Map();
    rows.forEach(r => {
      const d = parseDateVal(r[activeDateCol]);
      if (!d) return;
      const label = getMonthYearLabel(d);
      if (!months.has(label)) months.set(label, d.getFullYear() * 100 + d.getMonth());
    });
    const sorted = [...months.entries()].sort((a,b) => a[1]-b[1]).map(e => e[0]);
    return sorted.length ? ["all", ...sorted] : [];
  }, [isKpiSheet, rows, activeDateCol]);

  const dataWeekOptions = useMemo(() => {
    if (isKpiSheet || !activeDateCol || monthFilter === "all") return [];
    const weeks = new Map();
    rows.forEach(r => {
      const d = parseDateVal(r[activeDateCol]);
      if (!d) return;
      if (getMonthYearLabel(d) !== monthFilter) return;
      const label = getWeekMonthLabel(d);
      const sortKey = d.getFullYear() * 10000 + d.getMonth() * 100 + Math.ceil(d.getDate()/7);
      if (!weeks.has(label)) weeks.set(label, sortKey);
    });
    const sorted = [...weeks.entries()].sort((a,b) => a[1]-b[1]).map(e => e[0]);
    return sorted.length ? ["all", ...sorted] : [];
  }, [isKpiSheet, rows, activeDateCol, monthFilter]);

  const periodFiltered = useMemo(
    // KPI tab has its own structure-based filtering — skip period filter for it
    () => isKpiTab ? rows : filterByPeriod(rows, columns, activeDateCol, periodMode, periodValue),
    [isKpiTab, rows, columns, activeDateCol, periodMode, periodValue]
  );

  // Build period value options dynamically from actual data
  const periodValueOptions = useMemo(() => {
    if (periodMode === "all") return [];
    return buildPeriodOptions(rows, columns, periodMode);
  }, [rows, columns, periodMode]);

  // ── Dropdown option lists (unique values from ALL rows, not just filtered) ─
  const departments  = useMemo(() => {
    if (!deptColumn) return [];
    return ["All", ...new Set(periodFiltered.map((r) => r[deptColumn]).filter(Boolean))];
  }, [periodFiltered, deptColumn]);

  // Use ALL rows (not periodFiltered) so manager list is always full regardless of period filter
  const managers = useMemo(() => {
    if (!managerColumn) return [];
    return ["All", ...[...new Set(rows.map((r) => String(r[managerColumn]||"").trim()).filter(Boolean))].sort()];
  }, [rows, managerColumn]);

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

  // Y/N style dropdowns — always use ALL rows so options never disappear
  const showupMsgOptions  = useMemo(() => {
    if (!showupMsgColumn)  return [];
    return ["All", ...[...new Set(rows.map((r) => String(r[showupMsgColumn]||"").trim()).filter(Boolean))].sort()];
  }, [rows, showupMsgColumn]);

  const callBookedOptions = useMemo(() => {
    if (!callBookedColumn) return [];
    return ["All", ...[...new Set(rows.map((r) => String(r[callBookedColumn]||"").trim()).filter(Boolean))].sort()];
  }, [rows, callBookedColumn]);

  const showupCallOptions = useMemo(() => {
    if (!showupCallColumn) return [];
    return ["All", ...[...new Set(rows.map((r) => String(r[showupCallColumn]||"").trim()).filter(Boolean))].sort()];
  }, [rows, showupCallColumn]);

  const convertedOptions  = useMemo(() => {
    if (!convertedColumn)  return [];
    return ["All", ...[...new Set(rows.map((r) => String(r[convertedColumn]||"").trim()).filter(Boolean))].sort()];
  }, [rows, convertedColumn]);

  // ── Filtered + sorted rows ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    const list = periodFiltered.filter((row) => {
      if (!rowMatchesSearch(row, columns, search)) return false;
      if (deptColumn       && filterDept       !== "All" && row[deptColumn] !== filterDept) return false;
      if (managerColumn    && filterManager    !== "All" && String(row[managerColumn]||"").trim()    !== filterManager)    return false;
      if (universityColumn && filterUniversity !== "All" && String(row[universityColumn]||"").trim() !== filterUniversity) return false;
      if (sourceColumn     && filterSource     !== "All" && String(row[sourceColumn]||"").trim()     !== filterSource)     return false;
      if (nameColumn       && filterName       !== "All" && String(row[nameColumn]||"").trim()       !== filterName)       return false;
      if (bookingIdColumn && filterBookingId !== "All" &&
          String(row[bookingIdColumn]||"").trim() !== filterBookingId) return false;
      // Data sheet month/week filter
      if (!isKpiSheet && activeDateCol && (monthFilter !== "all" || weekFilter !== "all")) {
        const d = parseDateVal(row[activeDateCol]);
        if (!d) return false;
        if (monthFilter !== "all" && getMonthYearLabel(d) !== monthFilter) return false;
        if (weekFilter  !== "all" && getWeekMonthLabel(d) !== weekFilter)  return false;
      }
      if (showupMsgColumn  && filterShowupMsg  !== "All" && String(row[showupMsgColumn]||"").trim()  !== filterShowupMsg)  return false;
      if (callBookedColumn && filterCallBooked !== "All" && String(row[callBookedColumn]||"").trim() !== filterCallBooked) return false;
      if (showupCallColumn && filterShowupCall !== "All" && String(row[showupCallColumn]||"").trim() !== filterShowupCall) return false;
      if (convertedColumn  && filterConverted  !== "All" && String(row[convertedColumn]||"").trim()  !== filterConverted)  return false;
      return true;
    });
    return list;
  }, [periodFiltered, columns, search, filterDept, deptColumn, filterManager, managerColumn,
      filterUniversity, universityColumn, filterSource, sourceColumn, filterName, nameColumn,
      filterBookingId, bookingIdColumn, idColumn,
      filterShowupMsg, showupMsgColumn, filterCallBooked, callBookedColumn,
      filterShowupCall, showupCallColumn, filterConverted, convertedColumn,
      monthFilter, weekFilter, activeDateCol, isKpiSheet,
      kpiMonth, kpiWeek]);

  // ── Active filter chips list ───────────────────────────────────────────

  const activeFilters = useMemo(() => {
    const chips = [];
    if (periodMode !== "all" && periodValue !== "all") chips.push({ key:"period", icon:FILTER_ICONS.period, label:"Period", value: periodValue, clear:()=>{ setPeriodMode("all"); setPeriodValue("all"); } });
    if (kpiMonth !== "all")   chips.push({ key:"kpiMonth",    icon:"🗓️", label:"Month", value: kpiMonth,    clear:()=>{ setKpiMonth("all"); setKpiWeek("all"); } });
    if (kpiWeek   !== "all")   chips.push({ key:"kpiWeek",     icon:"📅", label:"Week",  value: kpiWeek,     clear:()=>setKpiWeek("all") });
    if (monthFilter !== "all") chips.push({ key:"monthFilter", icon:"🗓️", label:"Month", value: monthFilter, clear:()=>{ setMonthFilter("all"); setWeekFilter("all"); } });
    if (weekFilter  !== "all") chips.push({ key:"weekFilter",  icon:"📅", label:"Week",  value: weekFilter,  clear:()=>setWeekFilter("all") });
    if (filterDept !== "All")         chips.push({ key:"dept",       icon:FILTER_ICONS.dept,      label:"Dept",       value: filterDept,       clear:()=>setFilterDept("All") });
    if (filterManager !== "All")      chips.push({ key:"manager",    icon:FILTER_ICONS.manager,   label:"Manager",    value: filterManager,    clear:()=>setFilterManager("All") });
    if (filterUniversity !== "All")   chips.push({ key:"university", icon:FILTER_ICONS.university,label:"University", value: filterUniversity, clear:()=>setFilterUniversity("All") });
    if (filterSource !== "All")       chips.push({ key:"source",     icon:FILTER_ICONS.source,    label:"Source",     value: filterSource,     clear:()=>setFilterSource("All") });
    if (filterName !== "All")         chips.push({ key:"name",       icon:FILTER_ICONS.name,      label:"Name",       value: filterName,       clear:()=>setFilterName("All") });
    if (filterBookingId !== "All")    chips.push({ key:"bookingId",   icon:FILTER_ICONS.bookingId,  label:"Booking ID",   value: filterBookingId,    clear:()=>setFilterBookingId("All") });
    if (filterShowupMsg  !== "All")   chips.push({ key:"showupMsg",   icon:"💬",                    label:"Messaging",    value: filterShowupMsg,    clear:()=>setFilterShowupMsg("All") });
    if (filterCallBooked !== "All")   chips.push({ key:"callBooked",  icon:"📞",                    label:"Call Booked",  value: filterCallBooked,   clear:()=>setFilterCallBooked("All") });
    if (filterShowupCall !== "All")   chips.push({ key:"showupCall",  icon:"🎯",                    label:"Show-up Call", value: filterShowupCall,   clear:()=>setFilterShowupCall("All") });
    if (filterConverted  !== "All")   chips.push({ key:"converted",   icon:"✅",                    label:"Converted",    value: filterConverted,    clear:()=>setFilterConverted("All") });
    if (search.trim())                chips.push({ key:"search",      icon:"🔍",                    label:"Search",       value: search,             clear:()=>setSearch("") });
    return chips;
  }, [periodMode, periodValue, kpiMonth, kpiWeek, monthFilter, weekFilter,
      filterDept, filterManager, filterUniversity, filterSource, filterName, filterBookingId,
      filterShowupMsg, filterCallBooked, filterShowupCall, filterConverted, search]);

  // ── Stats ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => computeStatsFromList(filtered, columns), [filtered, columns]);
  const statCards = useMemo(() => {
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
  }, [stats, columns.length, activeSheet]);

  // ── KPI sheet detection ─────────────────────────────────────────────────
  // KPI sheet: first column has period labels like "May", "Week 1", "Week 2", "Total"


  // Month tabs list for KPI tab filter dropdown — derived from actual sheet tab names
  const MONTH_NAMES_LIST = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const kpiTabMonths = useMemo(() => {
    if (!isKpiTab) return [];
    const months = sheetTabs.filter(t => {
      const n = t.trim().toLowerCase();
      return MONTH_NAMES_LIST.some(m => n.startsWith(m));
    });
    return months.length ? ["all", ...months] : [];
  }, [isKpiTab, sheetTabs]);

  // Extract unique month names from KPI sheet first column
  const kpiMonths = useMemo(() => {
    if (!isKpiSheet || !columns.length) return [];
    const firstCol = columns[0];
    const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    const months = rows
      .map(r => String(r[firstCol] || "").trim())
      .filter(v => {
        const lo = v.toLowerCase();
        // Only standalone month name (exact) — skip header rows, week rows, "Total"
        return monthNames.some(m => lo === m);
      });
    return ["all", ...new Set(months)];
  }, [isKpiSheet, rows, columns]);

  // Extract weeks for the selected month
  const kpiWeeks = useMemo(() => {
    if (!isKpiSheet || !columns.length || kpiMonth === "all") return [];
    const firstCol = columns[0];
    const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    
    // Find rows that belong to selected month section
    let inSection = false;
    const weeks = [];
    for (const row of rows) {
      const val = String(row[firstCol] || "").trim();
      const lo = val.toLowerCase();
      const isMonth = monthNames.some(m => lo === m); // exact month name only
      if (isMonth) {
        inSection = val.toLowerCase().startsWith(kpiMonth.toLowerCase());
        continue;
      }
      if (inSection) {
        const isWeek = /^week\s*\d/i.test(val);
        const isTotal = /^total$/i.test(val);
        if (isTotal) { inSection = false; continue; }
        if (isWeek) weeks.push(val);
      }
    }
    return ["all", ...weeks];
  }, [isKpiSheet, rows, columns, kpiMonth]);

  // KPI filtered rows — applies month/week structure filter + all dropdown filters + search
  const kpiFiltered = useMemo(() => {
    if (!isKpiSheet || !columns.length) return rows;
    const firstCol = columns[0];
    const monthNames = ["january","february","march","april","may","june","july","august","september","october","november","december"];

    // Step 1: filter by month/week structure
    let structureFiltered;
    if (kpiMonth === "all") {
      structureFiltered = rows;
    } else {
      let inSection = false;
      const result = [];
      for (const row of rows) {
        const val = String(row[firstCol] || "").trim();
        const lo = val.toLowerCase();
        const isMonth = monthNames.some(m => lo === m); // exact month name only
        if (isMonth) {
          inSection = lo.startsWith(kpiMonth.toLowerCase());
          if (inSection) result.push(row); // include month header row
          continue;
        }
        if (inSection) {
          const isTotal = /^total$/i.test(val);
          if (isTotal) {
            result.push(row); // include total row
            inSection = false;
            continue;
          }
          if (kpiWeek !== "all") {
            if (val.toLowerCase() === kpiWeek.toLowerCase()) result.push(row);
          } else {
            result.push(row);
          }
        }
      }
      structureFiltered = result;
    }

    // Step 2: apply search + dropdown filters on top
    return structureFiltered.filter((row) => {
      if (search && !rowMatchesSearch(row, columns, search)) return false;
      if (deptColumn       && filterDept       !== "All" && row[deptColumn] !== filterDept) return false;
      if (managerColumn    && filterManager    !== "All" && String(row[managerColumn]||"").trim()    !== filterManager)    return false;
      if (universityColumn && filterUniversity !== "All" && String(row[universityColumn]||"").trim() !== filterUniversity) return false;
      if (sourceColumn     && filterSource     !== "All" && String(row[sourceColumn]||"").trim()     !== filterSource)     return false;
      if (nameColumn       && filterName       !== "All" && String(row[nameColumn]||"").trim()       !== filterName)       return false;
      if (bookingIdColumn  && filterBookingId  !== "All" && String(row[bookingIdColumn]||"").trim()  !== filterBookingId)  return false;
      if (showupMsgColumn  && filterShowupMsg  !== "All" && String(row[showupMsgColumn]||"").trim()  !== filterShowupMsg)  return false;
      if (callBookedColumn && filterCallBooked !== "All" && String(row[callBookedColumn]||"").trim() !== filterCallBooked) return false;
      if (showupCallColumn && filterShowupCall !== "All" && String(row[showupCallColumn]||"").trim() !== filterShowupCall) return false;
      if (convertedColumn  && filterConverted  !== "All" && String(row[convertedColumn]||"").trim()  !== filterConverted)  return false;
      return true;
    });
  }, [isKpiSheet, rows, columns, kpiMonth, kpiWeek,
      search, filterDept, deptColumn, filterManager, managerColumn,
      filterUniversity, universityColumn, filterSource, sourceColumn,
      filterName, nameColumn, filterBookingId, bookingIdColumn,
      filterShowupMsg, showupMsgColumn, filterCallBooked, callBookedColumn,
      filterShowupCall, showupCallColumn, filterConverted, convertedColumn]);

  // ── Display rows — KPI sheet uses kpiFiltered, others use filtered ────────
  const displayRows = isKpiSheet ? kpiFiltered : filtered;
  const isMaySheet = Boolean(activeSheet && /^may(\b|\s|\d)/i.test(activeSheet.trim()));

  // ── Manager summary (per-manager stats from ALL filtered rows) ──────────
  const managerSummary = useMemo(() => {
    if (!managerColumn) return [];
    const map = {};
    filtered.forEach((row) => {
      const mgr = String(row[managerColumn] || "").trim();
      if (!mgr) return;
      if (!map[mgr]) map[mgr] = { name: mgr, total: 0, converted: 0, callBooked: 0, showup: 0 };
      map[mgr].total += 1;
      if (convertedColumn) {
        const v = String(row[convertedColumn] || "").trim().toLowerCase();
        if (v === "yes" || v === "y" || v === "true" || v === "1") map[mgr].converted += 1;
      }
      if (callBookedColumn) {
        const v = String(row[callBookedColumn] || "").trim().toLowerCase();
        if (v === "yes" || v === "y" || v === "true" || v === "1") map[mgr].callBooked += 1;
      }
      if (showupCallColumn) {
        const v = String(row[showupCallColumn] || "").trim().toLowerCase();
        if (v === "yes" || v === "y" || v === "true" || v === "1") map[mgr].showup += 1;
      }
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [filtered, managerColumn, convertedColumn, callBookedColumn, showupCallColumn]);

  // Booking IDs dropdown list — all unique values from the column
  const bookingIds = useMemo(() => {
    if (!bookingIdColumn) return [];
    return ["All", ...[...new Set(rows.map((r) => String(r[bookingIdColumn]||"").trim()).filter(Boolean))].sort()];
  }, [rows, bookingIdColumn]);

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
          <div style={s.logo}>Outreach Dashboard</div>
          <div style={s.subtitle}>Live from Google Sheets · Manual sync only</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <button onClick={goHome} style={s.homeBtn}>🏠 Back to Home</button>
          <div style={s.liveIndicator}>
            <span style={s.liveDot}></span>
            {lastRefresh
              ? `Last sync: ${lastRefresh.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}`
              : "Connecting..."}
          </div>
          <button
            onClick={handleSyncNow}
            disabled={isSyncing}
            style={{
              ...s.refreshBtn,
              opacity: isSyncing ? 0.6 : 1,
              cursor: isSyncing ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <span style={{
              display: "inline-block",
              animation: isSyncing ? "kpi-spin 0.8s linear infinite" : "none",
              fontSize: 15,
            }}>↻</span>
            {isSyncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      </div>

      <div style={s.main}>

        {/* ── Manager Summary Cards (when Managed By column exists) ── */}
        {managerColumn && managerSummary.length > 0 ? (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, color: "#4a5568", textTransform: "uppercase", letterSpacing: "0.6px", fontWeight: 500, marginBottom: 10 }}>
              👤 Manager Summary — {managerSummary.length} manager{managerSummary.length > 1 ? "s" : ""} · {displayRows.length} total leads
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
              {loading ? (
                [1,2,3,4].map(i => (
                  <div key={i} style={{ ...s.mgrCard, opacity: 0.4 }}>
                    <div style={s.mgrName}>—</div>
                  </div>
                ))
              ) : managerSummary.map((mgr) => {
                const convRate = mgr.total > 0 ? Math.round((mgr.converted / mgr.total) * 100) : 0;
                const isFiltered = filterManager === mgr.name;
                return (
                  <div
                    key={mgr.name}
                    onClick={() => setFilterManager(isFiltered ? "All" : mgr.name)}
                    style={{
                      ...s.mgrCard,
                      borderColor: isFiltered ? "rgba(99,179,237,0.6)" : "rgba(255,255,255,0.07)",
                      background: isFiltered ? "rgba(99,179,237,0.08)" : "rgba(255,255,255,0.03)",
                      cursor: "pointer",
                    }}
                  >
                    <div style={s.mgrName}>
                      <span style={{ fontSize: 15 }}>👤</span>
                      <span style={s.mgrNameText}>{mgr.name}</span>
                      {isFiltered && <span style={{ fontSize: 10, color: "#63b3ed", whiteSpace:"nowrap" }}>● active</span>}
                    </div>
                    <div style={s.mgrTotal}>{mgr.total}</div>
                    <div style={{ fontSize: 11, color: "#718096", marginBottom: 10, letterSpacing:"0.3px" }}>total leads</div>
                    <div style={s.mgrStats}>
                      {callBookedColumn && (
                        <div style={s.mgrStat}>
                          <span>📞</span>
                          <span style={{ ...s.mgrStatVal, color:"#63b3ed" }}>{mgr.callBooked}</span>
                          <span style={s.mgrStatLbl}>calls</span>
                        </div>
                      )}
                      {showupCallColumn && (
                        <div style={s.mgrStat}>
                          <span>🎯</span>
                          <span style={{ ...s.mgrStatVal, color:"#f6ad55" }}>{mgr.showup}</span>
                          <span style={s.mgrStatLbl}>show-up</span>
                        </div>
                      )}
                      {convertedColumn && (
                        <div style={s.mgrStat}>
                          <span>✅</span>
                          <span style={{ ...s.mgrStatVal, color:"#48bb78" }}>{mgr.converted}</span>
                          <span style={s.mgrStatLbl}>converted</span>
                        </div>
                      )}
                    </div>
                    {convertedColumn && (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems:"center", fontSize: 11, color: "#718096", marginBottom: 5 }}>
                          <span>Conversion rate</span>
                          <span style={{ color: convRate >= 50 ? "#48bb78" : convRate >= 25 ? "#f6ad55" : "#fc8181", fontWeight: 700, fontSize:13 }}>{convRate}%</span>
                        </div>
                        <div style={{ height: 4, borderRadius: 3, background: "rgba(255,255,255,0.06)" }}>
                          <div style={{ height: "100%", borderRadius: 3, width: `${convRate}%`, background: convRate >= 50 ? "#48bb78" : convRate >= 25 ? "#f6ad55" : "#fc8181", transition: "width 0.4s ease" }} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* ── Default Stat cards (when no manager column) ── */
          <div style={s.statsGrid}>
            {statCards.map((st) => (
              <div key={st.label} style={s.statCard}>
                <div style={s.statIcon}>{st.icon}</div>
                <div style={s.statValue}>{loading ? "—" : st.value}</div>
                <div style={s.statLabel}>{st.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Filter bar trigger + chips ── */}
        <div style={s.filterBar}>
          {/* Search */}
          <div style={{ position:"relative", flex:1, minWidth:220 }}>
            <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", color:"#4a5568", fontSize:15, pointerEvents:"none" }}>🔍</span>
            <input
              placeholder="Search all columns..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...s.searchInput, paddingLeft:36 }}
            />
          </div>

          {/* Filter button */}
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            style={{ ...s.filterToggleBtn, ...(filtersOpen || activeFilters.length > 0 ? s.filterToggleBtnActive : {}) }}
          >
            <span style={{ fontSize:15 }}>⚙</span>
            Filters
            {activeFilters.length > 0 && (
              <span style={s.filterBadge}>{activeFilters.length}</span>
            )}
            <span style={{ marginLeft:2, fontSize:10, opacity:0.6 }}>{filtersOpen ? "▲" : "▼"}</span>
          </button>

          {/* Clear all */}
          {activeFilters.length > 0 && (
            <button onClick={resetFilters} style={s.clearBtn}>✕ Clear all</button>
          )}
        </div>

        {/* ── Active filter chips ── */}
        {activeFilters.length > 0 && (
          <div style={s.chipsRow}>
            {activeFilters.map((f) => (
              <FilterChip key={f.key} icon={f.icon} label={f.label} value={f.value} onRemove={f.clear} />
            ))}
          </div>
        )}

        {/* ── Expandable filter panel ── */}
        {filtersOpen && (
          <div style={s.filterPanel}>
            <div style={s.filterPanelGrid}>

              {/* Sheet selector */}
              {(tabsLoading || sheetTabs.length > 0) && (
                <FilterRow label="Sheet" icon="📋">
                  {tabsLoading ? (
                    <span style={{ fontSize:12, color:"#718096" }}>Loading…</span>
                  ) : (
                    <select style={appSelect} value={activeSheet||""} onChange={(e)=>switchSheet(e.target.value)}>
                      {sheetTabs.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  )}
                </FilterRow>
              )}

              {/* Data Sheet Month + Week filters (non-KPI sheets) */}
              {!isKpiSheet && dataMonthOptions.length > 1 && (
                <FilterRow label="Month" icon="🗓️">
                  <select
                    style={{ ...appSelect, borderColor: monthFilter !== "all" ? "rgba(99,179,237,0.5)" : undefined }}
                    value={monthFilter}
                    onChange={(e) => { setMonthFilter(e.target.value); setWeekFilter("all"); }}
                  >
                    {dataMonthOptions.map(m => (
                      <option key={m} value={m}>{m === "all" ? `All Months (${dataMonthOptions.length - 1})` : m}</option>
                    ))}
                  </select>
                </FilterRow>
              )}

              {!isKpiSheet && monthFilter !== "all" && dataWeekOptions.length > 1 && (
                <FilterRow label="Week" icon="📅">
                  <select
                    style={{ ...appSelect, borderColor: weekFilter !== "all" ? "rgba(99,179,237,0.5)" : undefined }}
                    value={weekFilter}
                    onChange={(e) => setWeekFilter(e.target.value)}
                  >
                    {dataWeekOptions.map(w => (
                      <option key={w} value={w}>{w === "all" ? `All Weeks (${dataWeekOptions.length - 1})` : w}</option>
                    ))}
                  </select>
                </FilterRow>
              )}

              {/* KPI Tab Filters — Month + Week */}
              {isKpiTab && kpiTabMonths.length > 1 && (
                <FilterRow label="Month" icon="🗓️">
                  <select
                    style={{ ...appSelect, borderColor: kpiMonth !== "all" ? "rgba(99,179,237,0.5)" : undefined }}
                    value={kpiMonth}
                    onChange={(e) => { setKpiMonth(e.target.value); setKpiWeek("all"); }}
                  >
                    {kpiTabMonths.map(m => (
                      <option key={m} value={m}>{m === "all" ? `All Months (${kpiTabMonths.length - 1})` : m}</option>
                    ))}
                  </select>
                </FilterRow>
              )}

              {isKpiTab && kpiMonth !== "all" && (
                <FilterRow label="Week" icon="📅">
                  <select
                    style={{ ...appSelect, borderColor: kpiWeek !== "all" ? "rgba(99,179,237,0.5)" : undefined }}
                    value={kpiWeek}
                    onChange={(e) => setKpiWeek(e.target.value)}
                  >
                    {["all","Week 1","Week 2","Week 3","Week 4","Week 5"].map(w => (
                      <option key={w} value={w}>{w === "all" ? "All Weeks" : w}</option>
                    ))}
                  </select>
                </FilterRow>
              )}

              {/* Period Mode + Value — only for non-KPI sheets */}
              {!isKpiSheet && (
                <>
                  <FilterRow label="Period" icon={FILTER_ICONS.period}>
                    <select style={appSelect} value={periodMode} onChange={(e)=>{ setPeriodMode(e.target.value); setPeriodValue("all"); }}>
                      {PERIOD_MODE_OPTIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  </FilterRow>
                  {periodMode !== "all" && periodValueOptions.length > 0 && (
                    <FilterRow label={periodMode === "monthly" ? "Month" : periodMode === "weekly" ? "Week" : "Day"} icon="📆">
                      <select
                        style={{ ...appSelect, borderColor: periodValue !== "all" ? "rgba(99,179,237,0.5)" : undefined }}
                        value={periodValue}
                        onChange={(e) => setPeriodValue(e.target.value)}
                      >
                        <option value="all">All {periodMode === "monthly" ? "Months" : periodMode === "weekly" ? "Weeks" : "Days"} ({periodValueOptions.length})</option>
                        {periodValueOptions.map((o) => (
                          <option key={o.id} value={o.id}>{o.label}</option>
                        ))}
                      </select>
                    </FilterRow>
                  )}
                </>
              )}

              {/* Manager — shows whenever column detected, even single manager */}
              {managerColumn && managers.length > 0 && (
                <FilterRow label={managerColumn} icon={FILTER_ICONS.manager}>
                  <select style={{ ...appSelect, borderColor: filterManager!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                    value={filterManager} onChange={(e)=>setFilterManager(e.target.value)}>
                    {managers.map((m) => <option key={m} value={m}>{m==="All"?`All (${managers.length - 1})`:m}</option>)}
                  </select>
                </FilterRow>
              )}

              {/* University */}
              {universities.length > 1 && (
                <FilterRow label="University" icon={FILTER_ICONS.university}>
                  <select style={{ ...appSelect, borderColor: filterUniversity!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                    value={filterUniversity} onChange={(e)=>setFilterUniversity(e.target.value)}>
                    {universities.map((u) => <option key={u} value={u}>{u==="All"?"All Universities":u}</option>)}
                  </select>
                </FilterRow>
              )}

              {/* Source */}
              {sources.length > 1 && (
                <FilterRow label="Source" icon={FILTER_ICONS.source}>
                  <select style={{ ...appSelect, borderColor: filterSource!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                    value={filterSource} onChange={(e)=>setFilterSource(e.target.value)}>
                    {sources.map((src) => <option key={src} value={src}>{src==="All"?"All Sources":src}</option>)}
                  </select>
                </FilterRow>
              )}

              {/* Name */}
              {names.length > 1 && (
                <FilterRow label="Name" icon={FILTER_ICONS.name}>
                  <select style={{ ...appSelect, borderColor: filterName!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                    value={filterName} onChange={(e)=>setFilterName(e.target.value)}>
                    {names.map((n) => <option key={n} value={n}>{n==="All"?"All Names":n}</option>)}
                  </select>
                </FilterRow>
              )}

              {/* Booking ID */}
              {bookingIds.length > 0 && (
                <FilterRow label="Booking ID" icon={FILTER_ICONS.bookingId}>
                  <select style={{ ...appSelect, borderColor: filterBookingId!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                    value={filterBookingId} onChange={(e)=>setFilterBookingId(e.target.value)}>
                    {bookingIds.map((b) => <option key={b} value={b}>{b==="All"?`All Booking IDs (${bookingIds.length-1})`:b}</option>)}
                  </select>
                </FilterRow>
              )}

              {/* Dept */}
              {departments.length > 1 && (
                <FilterRow label="Department" icon={FILTER_ICONS.dept}>
                  <select style={{ ...appSelect, borderColor: filterDept!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                    value={filterDept} onChange={(e)=>setFilterDept(e.target.value)}>
                    {departments.map((d) => <option key={d} value={d}>{d==="All"?"All Departments":d}</option>)}
                  </select>
                </FilterRow>
              )}

              {/* Showup Messaging Process */}
              {showupMsgOptions.length > 0 && (
                <FilterRow label="Messaging Process" icon="💬">
                  <select style={{ ...appSelect, borderColor: filterShowupMsg!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                    value={filterShowupMsg} onChange={(e)=>setFilterShowupMsg(e.target.value)}>
                    {showupMsgOptions.map((v) => <option key={v} value={v}>{v==="All"?"All":v}</option>)}
                  </select>
                </FilterRow>
              )}

              {/* Call Booked */}
              {callBookedOptions.length > 0 && (
                <FilterRow label="Call Booked" icon="📞">
                  <select style={{ ...appSelect, borderColor: filterCallBooked!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                    value={filterCallBooked} onChange={(e)=>setFilterCallBooked(e.target.value)}>
                    {callBookedOptions.map((v) => <option key={v} value={v}>{v==="All"?"All":v}</option>)}
                  </select>
                </FilterRow>
              )}

              {/* Show-up On Call */}
              {showupCallOptions.length > 0 && (
                <FilterRow label="Show-up On Call" icon="🎯">
                  <select style={{ ...appSelect, borderColor: filterShowupCall!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                    value={filterShowupCall} onChange={(e)=>setFilterShowupCall(e.target.value)}>
                    {showupCallOptions.map((v) => <option key={v} value={v}>{v==="All"?"All":v}</option>)}
                  </select>
                </FilterRow>
              )}

              {/* Converted */}
              {convertedOptions.length > 0 && (
                <FilterRow label="Converted" icon="✅">
                  <select style={{ ...appSelect, borderColor: filterConverted!=="All" ? "rgba(99,179,237,0.5)" : undefined }}
                    value={filterConverted} onChange={(e)=>setFilterConverted(e.target.value)}>
                    {convertedOptions.map((v) => <option key={v} value={v}>{v==="All"?"All":v}</option>)}
                  </select>
                </FilterRow>
              )}

            </div>

            {/* Panel footer */}
            <div style={s.filterPanelFooter}>
              <span style={{ fontSize:12, color:"#4a5568" }}>
                {displayRows.length} of {rows.length} rows match
              </span>
              <button onClick={resetFilters} style={s.clearBtn}>✕ Reset all filters</button>
            </div>
          </div>
        )}

        {/* ── KPI Tab → show live-computed KPI dashboard ── */}
        {isKpiTab && (
          <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:"20px 24px" }}>
            <KpiSheetView key={kpiSyncKey} sheetTabs={sheetTabs} refreshMs={0} syncKey={kpiSyncKey} filterMonth={kpiMonth} filterWeek={kpiWeek} />
          </div>
        )}

        {/* ── Charts (hidden on KPI tab) ── */}
        {!loading && !isKpiTab && <DashboardCharts rows={displayRows} columns={columns} period={periodMode} />}

        {/* ── Table (hidden on KPI tab) ── */}
        {!isKpiTab && <div style={s.tableWrap}>
          <div style={s.tableHeader}>
            <span style={s.tableTitle}>
              Data
              {activeSheet && <span style={{ color:"#63b3ed", marginLeft:6 }}>· {activeSheet}</span>}
              {" "}<span style={{ color:"#4a5568", fontWeight:400 }}>({displayRows.length} rows · {columns.length} columns)</span>
            </span>
            {(tabsLoading || sheetTabs.length > 0) && !tabsLoading && (
              <span style={{ fontSize:11, color:"#4a5568" }}>
                {sheetTabs.length} tab{sheetTabs.length===1?"":"s"} · refreshes every {REFRESH_MS/1000}s
              </span>
            )}
          </div>

          {loading ? (
            <div style={s.empty}>Loading from Google Sheets...</div>
          ) : displayRows.length === 0 ? (
            <div style={s.empty}>
              {rows.length === 0
                ? `No data in "${activeSheet}". Add a header row and data in Google Sheets.`
                : "No rows match your filters. Try adjusting or clearing them."}
            </div>
          ) : (
            <div className="table-scroll" style={s.tableScroll}>
              <table style={{
                ...s.table,
                minWidth: !isMaySheet ? Math.max(columns.length * 140, 900) : undefined,
              }}>
                <thead>
                  <tr>{columns.map((h) => <th key={h} style={s.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {displayRows.map((row, i) => (
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
        </div>}
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
  mgrCard:    { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:"18px 20px", transition:"border-color 0.2s, background 0.2s", minWidth:0 },
  mgrName:    { fontSize:14, fontWeight:600, color:"#e2e8f0", marginBottom:8, display:"flex", alignItems:"center", gap:6, overflow:"hidden" },
  mgrNameText:{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 },
  mgrTotal:   { fontSize:36, fontWeight:700, color:"#63b3ed", fontFamily:"'DM Mono',monospace", lineHeight:1, marginBottom:2 },
  mgrStats:   { display:"flex", gap:14, marginTop:6, flexWrap:"wrap" },
  mgrStat:    { display:"flex", alignItems:"center", gap:4, fontSize:12, background:"rgba(255,255,255,0.04)", borderRadius:6, padding:"3px 8px" },
  mgrStatVal: { color:"#e2e8f0", fontWeight:600, fontFamily:"'DM Mono',monospace" },
  mgrStatLbl: { color:"#718096" },
  statCard:   { background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:20, textAlign:"center" },
  statIcon:   { fontSize:24, marginBottom:8 },
  statValue:  { fontSize:28, fontWeight:600, color:"#e2e8f0", fontFamily:"'DM Mono',monospace" },
  statLabel:  { fontSize:12, color:"#718096", marginTop:4, textTransform:"uppercase", letterSpacing:"0.5px" },

  // filter bar
  filterBar:  { display:"flex", alignItems:"center", gap:10, marginBottom:10, flexWrap:"wrap" },
  searchInput:{ flex:1, minWidth:220, padding:"10px 16px", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, color:"#e2e8f0", fontSize:14, fontFamily:"'DM Sans',sans-serif", outline:"none" },
  filterToggleBtn: { display:"flex", alignItems:"center", gap:6, padding:"9px 16px", borderRadius:8, border:"1px solid rgba(255,255,255,0.12)", background:"rgba(255,255,255,0.04)", color:"#a0aec0", cursor:"pointer", fontSize:13, fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap" },
  filterToggleBtnActive: { background:"rgba(59,130,246,0.12)", borderColor:"rgba(59,130,246,0.4)", color:"#63b3ed" },
  filterBadge:{ marginLeft:4, background:"#3b82f6", color:"#fff", borderRadius:10, fontSize:10, fontWeight:700, padding:"1px 6px", lineHeight:"16px" },
  clearBtn:   { padding:"8px 14px", borderRadius:8, border:"1px solid rgba(252,129,129,0.25)", background:"rgba(252,129,129,0.06)", color:"#fc8181", cursor:"pointer", fontSize:12, fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap" },
  homeBtn:    { padding:"9px 16px", borderRadius:8, border:"1px solid rgba(96,165,250,0.4)", background:"rgba(59,130,246,0.12)", color:"#93c5fd", cursor:"pointer", fontSize:13, fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap" },

  // chips
  chipsRow:   { display:"flex", flexWrap:"wrap", gap:8, marginBottom:14 },

  // filter panel
  filterPanel: { background:"rgba(13,20,34,0.95)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12, padding:"4px 20px 0", marginBottom:20, backdropFilter:"blur(8px)" },
  filterPanelGrid: { display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px,1fr))", gap:"0 24px" },
  filterPanelFooter: { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 0", borderTop:"1px solid rgba(255,255,255,0.06)", marginTop:4 },

  // table
  tableWrap:   { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, overflow:"visible" },
  tableHeader: { padding:"14px 20px", borderBottom:"1px solid rgba(255,255,255,0.06)", display:"flex", alignItems:"center", justifyContent:"space-between" },
  tableTitle:  { fontSize:14, fontWeight:500, color:"#a0aec0" },
  tableScroll: { maxHeight: "520px", overflowY: "scroll", overflowX: "auto", paddingBottom: 4 },
  table:       { width:"100%", borderCollapse:"collapse", display:"table" },
  th:          { padding:"10px 16px", textAlign:"left", fontSize:11, fontWeight:500, color:"#4a5568", textTransform:"uppercase", letterSpacing:"0.6px", background:"rgba(255,255,255,0.02)", borderBottom:"1px solid rgba(255,255,255,0.06)", whiteSpace:"nowrap" },
  tr:          { borderBottom:"1px solid rgba(255,255,255,0.04)" },
  td:          { padding:"11px 16px", fontSize:13, color:"#a0aec0", whiteSpace:"nowrap" },
  badge:       { padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:500 },
  empty:       { textAlign:"center", padding:48, color:"#4a5568", fontSize:14 },
  toast:       { position:"fixed", bottom:24, right:24, padding:"12px 20px", borderRadius:10, border:"1px solid", fontSize:13, fontWeight:500, zIndex:9999 },
};
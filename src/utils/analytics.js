import {
  findColumn,
  getRowValue,
  HR_COLUMNS,
  isHrSheet,
} from "./sheetData";

export function parseSalary(row, columns) {
  const col = findColumn(columns, HR_COLUMNS.salary);
  if (!col) return 0;
  return parseFloat(String(row[col] || "").replace(/,/g, "")) || 0;
}

export function parseJoinDate(str) {
  if (!str) return null;
  const text = String(str).trim();
  const gviz = /^Date\((\d+),(\d+),(\d+)\)$/.exec(text);
  if (gviz) {
    const d = new Date(Number(gviz[1]), Number(gviz[2]), Number(gviz[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

export function filterByPeriod(rows, columns, period) {
  if (period === "all") return rows;
  const dateCol = findColumn(columns, HR_COLUMNS.joinDate);
  if (!dateCol) return rows;

  const now = new Date();
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);
  const yearStart = startOfYear(now);

  return rows.filter((row) => {
    const joined = parseJoinDate(row[dateCol]);
    if (!joined) return false;
    if (period === "weekly") return joined >= weekStart && joined <= now;
    if (period === "monthly") return joined >= monthStart && joined <= now;
    if (period === "yearly") return joined >= yearStart && joined <= now;
    return true;
  });
}

export function sortRows(rows, columns, sortBy) {
  const list = [...rows];
  const nameCol = findColumn(columns, HR_COLUMNS.name);
  const dateCol = findColumn(columns, HR_COLUMNS.joinDate);
  const salaryCol = findColumn(columns, HR_COLUMNS.salary);

  switch (sortBy) {
    case "name-asc":
      if (!nameCol) return list;
      return list.sort((a, b) => String(a[nameCol]).localeCompare(String(b[nameCol])));
    case "name-desc":
      if (!nameCol) return list;
      return list.sort((a, b) => String(b[nameCol]).localeCompare(String(a[nameCol])));
    case "salary-asc":
      if (!salaryCol) return list;
      return list.sort((a, b) => parseSalary(a, columns) - parseSalary(b, columns));
    case "salary-desc":
      if (!salaryCol) return list;
      return list.sort((a, b) => parseSalary(b, columns) - parseSalary(a, columns));
    case "date-asc":
      if (!dateCol) return list;
      return list.sort(
        (a, b) => (parseJoinDate(a[dateCol]) || 0) - (parseJoinDate(b[dateCol]) || 0)
      );
    case "date-desc":
    default:
      if (!dateCol) return list;
      return list.sort(
        (a, b) => (parseJoinDate(b[dateCol]) || 0) - (parseJoinDate(a[dateCol]) || 0)
      );
  }
}

export function groupCountChart(rows, column) {
  const map = {};
  rows.forEach((row) => {
    const key = String(row[column] ?? "").trim() || "(empty)";
    map[key] = (map[key] || 0) + 1;
  });
  return Object.entries(map)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

export function deptChartData(rows, columns) {
  const col = findColumn(columns, HR_COLUMNS.department);
  if (!col) return [];
  return groupCountChart(rows, col);
}

export function statusChartData(rows, columns) {
  const col = findColumn(columns, HR_COLUMNS.status);
  if (!col) return [];
  const map = {};
  rows.forEach((row) => {
    const status = String(row[col] ?? "").trim() || "Unknown";
    map[status] = (map[status] || 0) + 1;
  });
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}

export function salaryByDeptData(rows, columns) {
  const deptCol = findColumn(columns, HR_COLUMNS.department);
  const salaryCol = findColumn(columns, HR_COLUMNS.salary);
  if (!deptCol || !salaryCol) return [];

  const map = {};
  rows.forEach((row) => {
    const dept = String(row[deptCol] ?? "").trim() || "Unknown";
    map[dept] = (map[dept] || 0) + parseSalary(row, columns);
  });
  return Object.entries(map)
    .map(([name, salary]) => ({ name, salary: Math.round(salary) }))
    .sort((a, b) => b.salary - a.salary);
}

export function hiresTimelineData(rows, columns, period) {
  const dateCol = findColumn(columns, HR_COLUMNS.joinDate);
  if (!dateCol) return [];

  const buckets = {};
  rows.forEach((row) => {
    const joined = parseJoinDate(row[dateCol]);
    if (!joined) return;

    let key;
    if (period === "yearly") {
      key = joined.toLocaleString("en-US", { month: "short" });
    } else if (period === "monthly") {
      key = `Week ${Math.ceil(joined.getDate() / 7)}`;
    } else if (period === "weekly") {
      key = joined.toLocaleDateString("en-US", { weekday: "short" });
    } else {
      key = joined.toLocaleString("en-US", { month: "short", year: "2-digit" });
    }
    buckets[key] = (buckets[key] || 0) + 1;
  });

  return Object.entries(buckets).map(([name, hires]) => ({ name, hires }));
}

export function computeStatsFromList(rows, columns) {
  const statusCol = findColumn(columns, HR_COLUMNS.status);
  const deptCol = findColumn(columns, HR_COLUMNS.department);

  const active = statusCol
    ? rows.filter((r) => String(r[statusCol] || "").toLowerCase() === "active").length
    : null;

  const departments = deptCol
    ? new Set(rows.map((r) => r[deptCol]).filter(Boolean)).size
    : null;

  const totalSalary = findColumn(columns, HR_COLUMNS.salary)
    ? rows.reduce((sum, r) => sum + parseSalary(r, columns), 0)
    : null;

  const filledCells = rows.reduce((sum, row) => {
    return sum + columns.filter((c) => String(row[c] ?? "").trim() !== "").length;
  }, 0);

  return {
    total: rows.length,
    active,
    departments,
    totalSalary,
    columns: columns.length,
    filledCells,
    isHr: isHrSheet(columns),
  };
}

export { isHrSheet, getRowValue, HR_COLUMNS };

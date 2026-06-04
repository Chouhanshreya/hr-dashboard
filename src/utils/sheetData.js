/** HR-style columns (optional — charts/stats use these when present). */
export const HR_COLUMNS = {
  name: ["name"],
  email: ["email"],
  department: ["department", "dept"],
  position: ["position", "role"],
  status: ["status"],
  joinDate: ["join date", "join_date", "joined", "date joined"],
  salary: ["salary", "pay", "compensation"],
};

export function normalizeKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function findColumn(columns, aliases) {
  const set = new Set(aliases.map(normalizeKey));
  return columns.find((c) => set.has(normalizeKey(c))) || null;
}

export function isHrSheet(columns) {
  return Boolean(findColumn(columns, HR_COLUMNS.name) || findColumn(columns, HR_COLUMNS.department));
}

export function getRowValue(row, aliases) {
  const col = findColumn(Object.keys(row), aliases);
  return col ? row[col] : "";
}

export function rowMatchesSearch(row, columns, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return columns.some((col) => String(row[col] ?? "").toLowerCase().includes(q));
}

export function makeUniqueHeaders(headers) {
  const seen = {};
  return headers.map((raw, i) => {
    const base = String(raw ?? "").trim() || `Column ${i + 1}`;
    const key = base;
    if (!seen[key]) {
      seen[key] = 1;
      return base;
    }
    seen[key] += 1;
    return `${base} (${seen[key]})`;
  });
}

export function computeGenericStats(rows, columns) {
  const filledCells = rows.reduce((sum, row) => {
    return sum + columns.filter((c) => String(row[c] ?? "").trim() !== "").length;
  }, 0);
  return {
    total: rows.length,
    columns: columns.length,
    filledCells,
    isHr: isHrSheet(columns),
  };
}

import { makeUniqueHeaders } from "./utils/sheetData";

const SHEET_ID = process.env.REACT_APP_SHEET_ID;
const GOOGLE_API_KEY = process.env.REACT_APP_GOOGLE_API_KEY;

function parseSheetNameList(value) {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Manual list only when auto-detect fails (optional fallback). */
function getConfiguredSheetNames() {
  const fromNames = parseSheetNameList(process.env.REACT_APP_SHEET_NAMES);
  if (fromNames.length > 0) return fromNames;
  return null;
}

function fetchTabsFromAtomFeedJsonp() {
  return new Promise((resolve, reject) => {
    const callbackName = `__hrSheetTabs_${Date.now()}`;
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Sheet list request timed out"));
    }, 12000);

    const cleanup = () => {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = (data) => {
      cleanup();
      const entries = data?.feed?.entry;
      if (!entries) {
        reject(new Error("No sheets in feed response"));
        return;
      }
      const list = Array.isArray(entries) ? entries : [entries];
      const names = list
        .map((entry) => entry?.title?.$t || entry?.title || "")
        .filter(Boolean);
      if (names.length === 0) reject(new Error("No sheets in feed response"));
      else resolve(names);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Could not load sheet list feed"));
    };

    script.src =
      `https://spreadsheets.google.com/feeds/worksheets/${SHEET_ID}/public/full` +
      `?alt=json-in-script&callback=${callbackName}`;
    document.body.appendChild(script);
  });
}

function getDefaultSheetName() {
  const configured = getConfiguredSheetNames();
  if (configured?.length) return configured[0];
  const single = process.env.REACT_APP_SHEET_NAME?.trim();
  if (single && !single.includes(",")) return single;
  return "Sheet1";
}

function assertSheetId() {
  if (!SHEET_ID) {
    throw new Error("REACT_APP_SHEET_ID is not set in frontend/.env");
  }
}

function hasApiKey() {
  return Boolean(GOOGLE_API_KEY && GOOGLE_API_KEY !== "PASTE_YOUR_API_KEY_HERE");
}

function sheetRange(sheetName) {
  const escaped = String(sheetName).replace(/'/g, "''");
  return encodeURIComponent(`'${escaped}'!A:ZZ`);
}

function cellValue(cell) {
  if (!cell) return "";
  if (cell.f != null && cell.f !== "") {
    const dateMatch = /^Date\((\d+),(\d+),(\d+)\)$/.exec(String(cell.f));
    if (dateMatch) {
      const y = Number(dateMatch[1]);
      const m = Number(dateMatch[2]);
      const d = Number(dateMatch[3]);
      const dt = new Date(y, m, d);
      if (!Number.isNaN(dt.getTime())) {
        return dt.toISOString().slice(0, 10);
      }
    }
    return String(cell.f);
  }
  if (cell.v != null) return String(cell.v);
  return "";
}

function parseGvizResponse(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Invalid response from Google Sheets");
  }
  return JSON.parse(text.slice(start, end + 1));
}

function rowHasData(row, columns) {
  return columns.some((col) => String(row[col] ?? "").trim() !== "");
}

/** Build { columns, rows } exactly from sheet header row + data rows. */
function buildSheetDataFromTable(cols, tableRows) {
  // Forward-fill blank column labels
  let lastLabel = "";
  const rawHeaders = cols.map((col, i) => {
    const val = String(col.label ?? "").trim();
    if (val) { lastLabel = val; return val; }
    return lastLabel ? `${lastLabel} (${i + 1})` : `Column ${i + 1}`;
  });
  const columns = makeUniqueHeaders(rawHeaders);

  const rows = (tableRows || [])
    .map((row) => {
      const record = {};
      // Use max of declared cols or actual row cells
      const cellCount = Math.max(columns.length, (row.c || []).length);
      Array.from({ length: cellCount }).forEach((_, i) => {
        const header = columns[i] || `Column ${i + 1}`;
        record[header] = cellValue(row.c?.[i]);
      });
      return record;
    })
    .filter((row) => rowHasData(row, columns));

  return { columns, rows };
}

function looksLikeHeader(row) {
  if (!row || row.length === 0) return false;
  // A header row typically has mostly text (not numbers/dates) and no empty leading cell
  const nonEmpty = row.filter((c) => String(c ?? "").trim() !== "");
  if (nonEmpty.length === 0) return false;
  // If >60% cells are non-numeric strings, treat as header
  const textCells = nonEmpty.filter((c) => isNaN(Number(String(c).replace(/[,/-]/g, ""))));
  return textCells.length / nonEmpty.length > 0.6;
}

function buildSheetDataFromValues(values) {
  if (!values?.length) return { columns: [], rows: [] };

  // Row 0 is ALWAYS the header when fetched via Sheets API (?headers=1 for gviz too).
  // Only fall back to scanning if row 0 is empty/blank.
  let headerRowIndex = 0;
  if (!looksLikeHeader(values[0])) {
    // Scan first 5 rows for the first one that looks like a header
    for (let i = 1; i < Math.min(5, values.length); i++) {
      if (looksLikeHeader(values[i])) { headerRowIndex = i; break; }
    }
  }

  // Find the maximum number of columns across ALL rows (not just header row)
  const maxCols = Math.max(...values.map((r) => r.length));

  const headerRow = values[headerRowIndex];

  // Pad header row to maxCols so extra data columns get a name
  const paddedHeader = Array.from({ length: maxCols }, (_, i) => headerRow[i] ?? "");

  // Forward-fill blank header cells
  let lastHeader = "";
  const rawHeaders = paddedHeader.map((h, i) => {
    const val = String(h ?? "").trim();
    if (val) { lastHeader = val; return val; }
    return lastHeader ? `${lastHeader} (${i + 1})` : `Column ${i + 1}`;
  });

  const columns = makeUniqueHeaders(rawHeaders);

  const rows = values
    .slice(headerRowIndex + 1)
    .map((row) => {
      const record = {};
      columns.forEach((header, i) => {
        record[header] = row[i] != null ? String(row[i]) : "";
      });
      return record;
    })
    .filter((row) => rowHasData(row, columns));

  return { columns, rows };
}

async function fetchTabsFromSheetsApi() {
  if (!hasApiKey()) {
    throw new Error("REACT_APP_GOOGLE_API_KEY is missing in frontend/.env");
  }

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}` +
    `?fields=sheets.properties(title,index)` +
    `&key=${encodeURIComponent(GOOGLE_API_KEY)}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.error?.message || `Sheets API returned ${res.status}`);
  }

  const names = (data.sheets || [])
    .map((s) => s.properties)
    .filter((p) => p?.title)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => p.title);

  if (names.length === 0) throw new Error("Spreadsheet has no tabs");
  return names;
}

async function fetchSheetDataFromSheetsApi(sheetName) {
  if (!hasApiKey()) {
    throw new Error("REACT_APP_GOOGLE_API_KEY is missing in frontend/.env");
  }

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/` +
    `${sheetRange(sheetName)}?key=${encodeURIComponent(GOOGLE_API_KEY)}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.error?.message || `Sheets API returned ${res.status}`);
  }

  return buildSheetDataFromValues(data.values || []);
}

async function fetchSheetDataFromGviz(sheetName) {
  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:json&sheet=${encodeURIComponent(sheetName)}&headers=1`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Sheets returned ${res.status}. Share the sheet as "Anyone with the link can view".`);
  }

  const text = await res.text();
  const data = parseGvizResponse(text);

  if (data.status === "error") {
    throw new Error(data.errors?.[0]?.detailed_message || "Could not read Google Sheet");
  }

  return buildSheetDataFromTable(data.table.cols, data.table.rows);
}

/**
 * Lists every tab in the spreadsheet (auto-detect).
 * New tabs in Google Sheets appear here without code or .env changes.
 */
export async function fetchSpreadsheetTabs() {
  assertSheetId();

  if (hasApiKey()) {
    try {
      return await fetchTabsFromSheetsApi();
    } catch (err) {
      console.warn("Sheets API tab list failed:", err.message);
    }
  }

  try {
    return await fetchTabsFromAtomFeedJsonp();
  } catch (err) {
    console.warn("Public feed tab list failed:", err.message);
  }

  const configured = getConfiguredSheetNames();
  if (configured) return configured;

  return [getDefaultSheetName()];
}

/** Returns columns and rows exactly as defined in the Google Sheet tab. */
export async function fetchSheetData(sheetName = getDefaultSheetName()) {
  assertSheetId();

  if (hasApiKey()) {
    try {
      return await fetchSheetDataFromSheetsApi(sheetName);
    } catch (err) {
      console.warn("Sheets API read failed, trying public link:", err.message);
    }
  }

  return fetchSheetDataFromGviz(sheetName);
}

/** @deprecated use fetchSheetData */
export async function fetchEmployees(sheetName) {
  const { rows } = await fetchSheetData(sheetName);
  return rows;
}
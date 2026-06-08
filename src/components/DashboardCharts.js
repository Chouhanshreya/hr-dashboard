import React from "react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  deptChartData,
  statusChartData,
  salaryByDeptData,
  hiresTimelineData,
  groupCountChart,
  isHrSheet,
} from "../utils/analytics";
import { findColumn } from "../utils/sheetData";

const COLORS = ["#3b82f6", "#48bb78", "#f6ad55", "#fc8181", "#9f7aea", "#38b2ac", "#ed8936", "#667eea"];
const CHART_TOOLTIP = {
  contentStyle: { background: "#1a1f2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 },
  labelStyle: { color: "#e2e8f0" },
  itemStyle: { color: "#a0aec0" },
};

const MANAGER_ALIASES = [
  "managed by","manager","managed_by","managedby","managed_by_name","team lead","team_lead","teamlead","lead","handled by","assigned to","owner","reporting to","reports to","supervisor","incharge","in charge",
];
const BOOKING_ID_ALIASES = [
  "booking id","booking_id","bookingid","booking no","booking number","booking ref","reference id","ref id","reservation id",
];

function bookingCountByManagerData(rows, columns) {
  const managerCol = findColumn(columns, MANAGER_ALIASES);
  const bookingIdCol = findColumn(columns, BOOKING_ID_ALIASES);
  if (!managerCol || !bookingIdCol) return [];

  const map = {};
  rows.forEach((row) => {
    const manager = String(row[managerCol] ?? "").trim() || "(unassigned)";
    const bookingId = String(row[bookingIdCol] ?? "").trim();
    if (!bookingId) return;
    if (!map[manager]) map[manager] = new Set();
    map[manager].add(bookingId);
  });

  return Object.entries(map)
    .map(([name, ids]) => ({ name, bookings: ids.size }))
    .sort((a, b) => b.bookings - a.bookings)
    .slice(0, 12);
}

function ChartCard({ title, children }) {
  return (
    <div style={styles.card}>
      <div style={styles.title}>{title}</div>
      {children}
    </div>
  );
}

function GenericColumnCharts({ rows, columns, bookingsByManagerData }) {
  const chartCols = columns
    .map((col) => ({ col, data: groupCountChart(rows, col) }))
    .filter(({ data }) => data.length > 0)
    .slice(0, 4);

  const barColors = ["#3b82f6", "#48bb78", "#f6ad55", "#9f7aea"];

  const noCharts = chartCols.length === 0 && bookingsByManagerData.length === 0;
  if (noCharts) {
    return (
      <div style={styles.empty}>
        Charts need at least one column with values. Table below shows all sheet data.
      </div>
    );
  }

  return (
    <div style={styles.grid}>
      {bookingsByManagerData.length > 0 && (
        <ChartCard title="Bookings by Manager">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={bookingsByManagerData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" tick={{ fill: "#718096", fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fill: "#718096", fontSize: 11 }} />
              <Tooltip {...CHART_TOOLTIP} />
              <Bar dataKey="bookings" fill="#38b2ac" radius={[6, 6, 0, 0]} name="Bookings" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
      {chartCols.map(({ col, data }, i) => (
        <ChartCard key={col} title={`Count by ${col}`}>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" tick={{ fill: "#718096", fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fill: "#718096", fontSize: 11 }} />
              <Tooltip {...CHART_TOOLTIP} />
              <Bar dataKey="count" fill={barColors[i % barColors.length]} radius={[6, 6, 0, 0]} name="Rows" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      ))}
    </div>
  );
}

export default function DashboardCharts({ rows, columns, period }) {
  if (rows.length === 0) {
    return <div style={styles.empty}>No data to chart for the selected filters.</div>;
  }

  const hr = isHrSheet(columns);
  const deptData = deptChartData(rows, columns);
  const statusData = statusChartData(rows, columns);
  const salaryData = salaryByDeptData(rows, columns);
  const timelineData = hiresTimelineData(rows, columns, period);
  const bookingsByManagerData = bookingCountByManagerData(rows, columns);

  const hasHrCharts =
    deptData.length > 0 ||
    statusData.length > 0 ||
    salaryData.length > 0 ||
    timelineData.length > 0;

  if (!hr || !hasHrCharts) {
    return <GenericColumnCharts rows={rows} columns={columns} bookingsByManagerData={bookingsByManagerData} />;
  }

  return (
    <div style={styles.grid}>
      {bookingsByManagerData.length > 0 && (
        <ChartCard title="Bookings by Manager">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={bookingsByManagerData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" tick={{ fill: "#718096", fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: "#718096", fontSize: 11 }} />
              <Tooltip {...CHART_TOOLTIP} />
              <Bar dataKey="bookings" fill="#38b2ac" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {deptData.length > 0 && (
        <ChartCard title="By Department">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={deptData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" tick={{ fill: "#718096", fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: "#718096", fontSize: 11 }} />
              <Tooltip {...CHART_TOOLTIP} />
              <Bar dataKey="count" fill="#3b82f6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {statusData.length > 0 && (
        <ChartCard title="Status">
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={52} label={false}>
                {statusData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip {...CHART_TOOLTIP} />
              <Legend wrapperStyle={{ color: "#a0aec0", fontSize: 10 }} iconSize={8} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {salaryData.length > 0 && (
        <ChartCard title="Salary by Department">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={salaryData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" tick={{ fill: "#718096", fontSize: 11 }} />
              <YAxis tick={{ fill: "#718096", fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
              <Tooltip {...CHART_TOOLTIP} formatter={(v) => [`₹${Number(v).toLocaleString()}`, "Salary"]} />
              <Bar dataKey="salary" fill="#48bb78" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {timelineData.length > 0 && (
        <ChartCard title="Join Date Timeline">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={timelineData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" tick={{ fill: "#718096", fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: "#718096", fontSize: 11 }} />
              <Tooltip {...CHART_TOOLTIP} />
              <Bar dataKey="hires" fill="#f6ad55" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  );
}

const styles = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
    marginBottom: 20,
  },
  card: {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 10,
    padding: "10px 10px 4px",
    minWidth: 0,
  },
  title: {
    fontSize: 11,
    fontWeight: 500,
    color: "#a0aec0",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: "0.4px",
  },
  empty: {
    textAlign: "center",
    padding: 32,
    color: "#4a5568",
    marginBottom: 24,
    background: "rgba(255,255,255,0.03)",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.07)",
  },
};

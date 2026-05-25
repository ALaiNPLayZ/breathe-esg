import { useQuery } from "@tanstack/react-query";
import { fetchStats } from "../api";
import { Link } from "react-router-dom";
import {
  Database,
  CheckCircle,
  AlertTriangle,
  Clock,
  XCircle,
  Lock,
  ArrowRight,
  Zap,
  Flame,
  Plane,
} from "lucide-react";
import type { Stats } from "../types";

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  sub,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  sub?: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <div className={`rounded-lg p-2 ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-3xl font-bold text-gray-900">{value.toLocaleString()}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function SourceBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-gray-900">{value.toLocaleString()}</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div
          className={`h-2 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function RunRow({ run }: { run: Stats["recent_runs"][0] }) {
  const statusColor: Record<string, string> = {
    COMPLETE: "text-green-600 bg-green-50",
    FAILED:   "text-red-600 bg-red-50",
    PROCESSING: "text-blue-600 bg-blue-50",
    PENDING:  "text-gray-600 bg-gray-50",
  };

  const sourceIcon: Record<string, React.ElementType> = {
    SAP_FUEL:    Flame,
    UTILITY_ELEC: Zap,
    CORP_TRAVEL: Plane,
  };
  const Icon = sourceIcon[run.source_type] ?? Database;

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-gray-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{run.file_name}</p>
        <p className="text-xs text-gray-500">
          {new Date(run.ingested_at).toLocaleDateString()} ·{" "}
          {run.row_count_total} rows
        </p>
      </div>
      <span
        className={`text-xs font-medium px-2 py-0.5 rounded ${
          statusColor[run.status] ?? "text-gray-600 bg-gray-100"
        }`}
      >
        {run.status_display}
      </span>
    </div>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
    refetchInterval: 15_000,
  });

  if (isLoading || !stats) {
    return (
      <div className="p-8">
        <div className="h-8 bg-gray-200 rounded w-48 animate-pulse mb-4" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-5 h-28 animate-pulse bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {stats.total} records ingested
          </p>
        </div>
        <Link to="/review" className="btn-primary">
          Review Queue
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Review status cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard
          label="Total"
          value={stats.total}
          icon={Database}
          color="bg-gray-100 text-gray-600"
        />
        <StatCard
          label="Pending"
          value={stats.pending}
          icon={Clock}
          color="bg-gray-100 text-gray-500"
          sub="Needs review"
        />
        <StatCard
          label="Flagged"
          value={stats.flagged}
          icon={AlertTriangle}
          color="bg-amber-100 text-amber-600"
          sub="Check anomalies"
        />
        <StatCard
          label="Approved"
          value={stats.approved}
          icon={CheckCircle}
          color="bg-green-100 text-green-600"
        />
        <StatCard
          label="Rejected"
          value={stats.rejected}
          icon={XCircle}
          color="bg-red-100 text-red-600"
        />
        <StatCard
          label="Locked"
          value={stats.locked}
          icon={Lock}
          color="bg-indigo-100 text-indigo-600"
          sub="Audit-ready"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scope breakdown */}
        <div className="card p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">By GHG Scope</h2>
          <div className="space-y-4">
            <SourceBar
              label="Scope 1 – Direct (SAP fuel)"
              value={stats.by_scope.scope_1}
              total={stats.total}
              color="bg-orange-400"
            />
            <SourceBar
              label="Scope 2 – Purchased electricity"
              value={stats.by_scope.scope_2}
              total={stats.total}
              color="bg-blue-400"
            />
            <SourceBar
              label="Scope 3 – Business travel"
              value={stats.by_scope.scope_3}
              total={stats.total}
              color="bg-purple-400"
            />
          </div>
        </div>

        {/* Source breakdown */}
        <div className="card p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">By Data Source</h2>
          <div className="space-y-4">
            <SourceBar
              label="SAP Fuel & Procurement"
              value={stats.by_source.SAP_FUEL}
              total={stats.total}
              color="bg-cyan-400"
            />
            <SourceBar
              label="Utility Electricity"
              value={stats.by_source.UTILITY_ELEC}
              total={stats.total}
              color="bg-yellow-400"
            />
            <SourceBar
              label="Corporate Travel"
              value={stats.by_source.CORP_TRAVEL}
              total={stats.total}
              color="bg-pink-400"
            />
          </div>
        </div>

        {/* Recent ingestion runs */}
        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Recent Ingestion Runs</h2>
            <Link to="/ingest" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
              Ingest new data →
            </Link>
          </div>
          {stats.recent_runs.length === 0 ? (
            <p className="text-sm text-gray-500">No ingestion runs yet.</p>
          ) : (
            <div>
              {stats.recent_runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Attention banner */}
      {stats.pending > 0 && (
        <div className="mt-6 rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <p className="text-sm text-amber-800">
              <span className="font-semibold">{stats.pending + stats.flagged}</span> records
              need analyst review before they can be locked for audit.
            </p>
          </div>
          <Link to="/review" className="btn-primary ml-4 shrink-0">
            Review now
          </Link>
        </div>
      )}
    </div>
  );
}

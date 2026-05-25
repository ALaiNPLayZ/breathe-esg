import { useQuery } from "@tanstack/react-query";
import { fetchStats } from "../api";
import { Link, useNavigate } from "react-router-dom";
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
  TrendingUp,
} from "lucide-react";
import type { Stats } from "../types";

function ProgressRing({ reviewed, total }: { reviewed: number; total: number }) {
  const pct = total > 0 ? reviewed / total : 0;
  const R = 38;
  const C = 2 * Math.PI * R;
  const color = pct >= 0.8 ? "#16a34a" : pct >= 0.4 ? "#f59e0b" : "#6366f1";
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={96} height={96} viewBox="0 0 96 96">
        <circle cx={48} cy={48} r={R} fill="none" stroke="#e5e7eb" strokeWidth={9} />
        <circle
          cx={48} cy={48} r={R}
          fill="none"
          stroke={color}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          transform="rotate(-90 48 48)"
          style={{ transition: "stroke-dashoffset 0.7s ease" }}
        />
        <text
          x={48} y={44}
          textAnchor="middle"
          fontSize={17}
          fontWeight="700"
          fill="#111827"
        >
          {Math.round(pct * 100)}%
        </text>
        <text x={48} y={58} textAnchor="middle" fontSize={9} fill="#6b7280">
          reviewed
        </text>
      </svg>
      <p className="text-xs text-gray-500">
        {reviewed.toLocaleString()} of {total.toLocaleString()} records
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  sub,
  to,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  sub?: string;
  to?: string;
}) {
  const navigate = useNavigate();
  const inner = (
    <div className={`card p-5 transition-shadow ${to ? "cursor-pointer hover:shadow-md" : ""}`}>
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
  if (to) return <div onClick={() => navigate(to)}>{inner}</div>;
  return inner;
}

function ScopeBar({ label, value, total, color, bgLight }: {
  label: string; value: number; total: number; color: string; bgLight: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-gray-600">{label}</span>
        <span className="font-semibold text-gray-900">{value.toLocaleString()}</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%`, transition: "width 0.6s ease" }} />
      </div>
      <p className="text-xs text-gray-400 mt-0.5">{pct}% of total</p>
    </div>
  );
}

function RunRow({ run }: { run: Stats["recent_runs"][0] }) {
  const statusStyle: Record<string, string> = {
    COMPLETE:   "text-green-700 bg-green-50 ring-1 ring-green-200",
    FAILED:     "text-red-700 bg-red-50 ring-1 ring-red-200",
    PROCESSING: "text-blue-700 bg-blue-50 ring-1 ring-blue-200",
    PENDING:    "text-gray-600 bg-gray-50 ring-1 ring-gray-200",
  };
  const sourceIcon: Record<string, React.ElementType> = {
    SAP_FUEL: Flame, UTILITY_ELEC: Zap, CORP_TRAVEL: Plane,
  };
  const sourceColor: Record<string, string> = {
    SAP_FUEL: "bg-cyan-100 text-cyan-600", UTILITY_ELEC: "bg-yellow-100 text-yellow-600", CORP_TRAVEL: "bg-pink-100 text-pink-600",
  };
  const Icon = sourceIcon[run.source_type] ?? Database;

  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${sourceColor[run.source_type] ?? "bg-gray-100 text-gray-500"}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{run.file_name}</p>
        <p className="text-xs text-gray-500">
          {new Date(run.ingested_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          {" · "}{run.row_count_total} rows
          {run.row_count_flagged > 0 && (
            <span className="text-amber-600"> · {run.row_count_flagged} flagged</span>
          )}
        </p>
      </div>
      <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusStyle[run.status] ?? "text-gray-600 bg-gray-100"}`}>
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

  const reviewed = stats.approved + stats.rejected + stats.locked;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {stats.total.toLocaleString()} records ingested across all sources
          </p>
        </div>
        <Link to="/review" className="btn-primary">
          Review Queue
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {/* Stat cards — clicking navigates to filtered review */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard label="Total" value={stats.total} icon={Database} color="bg-gray-100 text-gray-600" />
        <StatCard label="Pending" value={stats.pending} icon={Clock} color="bg-gray-100 text-gray-500" sub="Needs review" to="/review?review_status=PENDING" />
        <StatCard label="Flagged" value={stats.flagged} icon={AlertTriangle} color="bg-amber-100 text-amber-600" sub="Check anomalies" to="/review?review_status=FLAGGED" />
        <StatCard label="Approved" value={stats.approved} icon={CheckCircle} color="bg-green-100 text-green-600" to="/review?review_status=APPROVED" />
        <StatCard label="Rejected" value={stats.rejected} icon={XCircle} color="bg-red-100 text-red-600" to="/review?review_status=REJECTED" />
        <StatCard label="Locked" value={stats.locked} icon={Lock} color="bg-indigo-100 text-indigo-600" sub="Audit-ready" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Review progress ring */}
        <div className="card p-6 flex flex-col items-center justify-center gap-4">
          <div className="flex items-center gap-2 self-start w-full">
            <TrendingUp className="w-4 h-4 text-gray-400" />
            <h2 className="text-base font-semibold text-gray-900">Review progress</h2>
          </div>
          <ProgressRing reviewed={reviewed} total={stats.total} />
          <div className="w-full grid grid-cols-2 gap-2 text-center">
            <div className="bg-gray-50 rounded-lg p-2">
              <p className="text-lg font-bold text-gray-900">{stats.pending + stats.flagged}</p>
              <p className="text-xs text-gray-500">need review</p>
            </div>
            <div className="bg-indigo-50 rounded-lg p-2">
              <p className="text-lg font-bold text-indigo-700">{stats.locked}</p>
              <p className="text-xs text-indigo-500">locked</p>
            </div>
          </div>
        </div>

        {/* Scope breakdown */}
        <div className="card p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-5">By GHG Scope</h2>
          <div className="space-y-5">
            <ScopeBar label="Scope 1 – Direct (fuel)" value={stats.by_scope.scope_1} total={stats.total} color="bg-orange-400" bgLight="bg-orange-50" />
            <ScopeBar label="Scope 2 – Purchased electricity" value={stats.by_scope.scope_2} total={stats.total} color="bg-blue-400" bgLight="bg-blue-50" />
            <ScopeBar label="Scope 3 – Business travel" value={stats.by_scope.scope_3} total={stats.total} color="bg-purple-400" bgLight="bg-purple-50" />
          </div>
        </div>

        {/* Source breakdown */}
        <div className="card p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-5">By Data Source</h2>
          <div className="space-y-5">
            <ScopeBar label="SAP Fuel & Procurement" value={stats.by_source.SAP_FUEL} total={stats.total} color="bg-cyan-400" bgLight="bg-cyan-50" />
            <ScopeBar label="Utility Electricity" value={stats.by_source.UTILITY_ELEC} total={stats.total} color="bg-yellow-400" bgLight="bg-yellow-50" />
            <ScopeBar label="Corporate Travel" value={stats.by_source.CORP_TRAVEL} total={stats.total} color="bg-pink-400" bgLight="bg-pink-50" />
          </div>
        </div>
      </div>

      {/* Recent ingestion runs */}
      <div className="card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Recent Ingestion Runs</h2>
          <Link to="/ingest" className="text-sm text-brand-600 hover:text-brand-700 font-medium">
            Ingest new data →
          </Link>
        </div>
        {stats.recent_runs.length === 0 ? (
          <p className="text-sm text-gray-500">No ingestion runs yet.</p>
        ) : (
          stats.recent_runs.map((run) => <RunRow key={run.id} run={run} />)
        )}
      </div>

      {/* Attention banner */}
      {(stats.pending + stats.flagged) > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <p className="text-sm text-amber-800">
              <span className="font-semibold">{stats.pending + stats.flagged}</span> records need analyst review before locking for audit.
              {stats.flagged > 0 && (
                <span className="ml-1">
                  <span className="font-semibold">{stats.flagged}</span> are flagged with anomalies.
                </span>
              )}
            </p>
          </div>
          <Link to="/review?review_status=FLAGGED" className="btn-primary shrink-0 text-sm">
            Review flagged first
          </Link>
        </div>
      )}
    </div>
  );
}

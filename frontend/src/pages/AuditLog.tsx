import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAuditLog } from "../api";
import { ScrollText, CheckCircle, XCircle, AlertTriangle, Lock, PlusCircle, Filter } from "lucide-react";
import clsx from "clsx";

const ACTION_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string; dot: string }> = {
  CREATED:    { label: "Ingested",  icon: PlusCircle,    color: "text-blue-600 bg-blue-50",   dot: "bg-blue-400" },
  APPROVED:   { label: "Approved",  icon: CheckCircle,   color: "text-green-600 bg-green-50", dot: "bg-green-400" },
  FLAGGED:    { label: "Flagged",   icon: AlertTriangle, color: "text-amber-600 bg-amber-50", dot: "bg-amber-400" },
  REJECTED:   { label: "Rejected",  icon: XCircle,       color: "text-red-600 bg-red-50",     dot: "bg-red-400" },
  NOTE_ADDED: { label: "Note",      icon: ScrollText,    color: "text-gray-500 bg-gray-50",   dot: "bg-gray-400" },
  LOCKED:     { label: "Locked",    icon: Lock,          color: "text-indigo-600 bg-indigo-50",dot: "bg-indigo-400" },
  UNLOCKED:   { label: "Unlocked",  icon: Lock,          color: "text-gray-500 bg-gray-50",   dot: "bg-gray-300" },
};

const ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  { value: "CREATED", label: "Ingested" },
  { value: "APPROVED", label: "Approved" },
  { value: "FLAGGED", label: "Flagged" },
  { value: "REJECTED", label: "Rejected" },
  { value: "LOCKED", label: "Locked" },
];

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function AuditLog() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["audit-log", action, page],
    queryFn: () => fetchAuditLog({ action: action || undefined, page }),
  });

  const totalPages = data ? Math.ceil(data.count / 50) : 1;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Append-only record of every review action — available to auditors on request.
        </p>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-4 mb-5">
        <Filter className="w-4 h-4 text-gray-400 shrink-0" />
        <select
          className="select w-44"
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
        >
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {data && (
          <span className="text-sm text-gray-500 ml-auto">
            {data.count.toLocaleString()} entries
          </span>
        )}
      </div>

      {/* Timeline */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <div className="w-9 h-9 rounded-full bg-gray-200 animate-pulse shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse" />
                  <div className="h-3 bg-gray-100 rounded w-1/2 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : !data?.results.length ? (
          <div className="p-14 text-center">
            <ScrollText className="w-9 h-9 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No audit log entries yet.</p>
          </div>
        ) : (
          <div className="relative">
            {/* Vertical timeline line */}
            <div className="absolute left-[2.35rem] top-0 bottom-0 w-px bg-gray-100" />
            <div className="divide-y divide-gray-100">
              {data.results.map((entry) => {
                const cfg = ACTION_CONFIG[entry.action] ?? ACTION_CONFIG.NOTE_ADDED;
                const Icon = cfg.icon;
                return (
                  <div key={entry.id} className="relative flex items-start gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                    <div className={clsx("flex items-center justify-center w-9 h-9 rounded-full shrink-0 z-10", cfg.color)}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-gray-900">{cfg.label}</span>
                        <span className="text-sm text-gray-600 truncate max-w-xs">{entry.record_summary}</span>
                        {entry.previous_status && entry.new_status && entry.previous_status !== entry.new_status && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono">
                            {entry.previous_status} → {entry.new_status}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400 flex-wrap">
                        <span className="font-medium text-gray-500">{entry.user_username}</span>
                        <span>·</span>
                        <span title={new Date(entry.timestamp).toLocaleString()}>{relativeTime(entry.timestamp)}</span>
                      </div>
                      {entry.notes && (
                        <p className="text-xs text-gray-500 mt-1.5 italic bg-gray-50 border border-gray-100 rounded px-2.5 py-1.5 inline-block">
                          "{entry.notes}"
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

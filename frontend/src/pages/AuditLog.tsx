import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAuditLog } from "../api";
import { ScrollText, CheckCircle, XCircle, AlertTriangle, Lock, PlusCircle } from "lucide-react";
import clsx from "clsx";

const ACTION_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  CREATED:    { label: "Created",  icon: PlusCircle,    color: "text-blue-500 bg-blue-50" },
  APPROVED:   { label: "Approved", icon: CheckCircle,   color: "text-green-500 bg-green-50" },
  FLAGGED:    { label: "Flagged",  icon: AlertTriangle, color: "text-amber-500 bg-amber-50" },
  REJECTED:   { label: "Rejected", icon: XCircle,       color: "text-red-500 bg-red-50" },
  NOTE_ADDED: { label: "Note",     icon: ScrollText,    color: "text-gray-500 bg-gray-50" },
  LOCKED:     { label: "Locked",   icon: Lock,          color: "text-indigo-500 bg-indigo-50" },
  UNLOCKED:   { label: "Unlocked", icon: Lock,          color: "text-gray-500 bg-gray-50" },
};

const ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  { value: "CREATED", label: "Created" },
  { value: "APPROVED", label: "Approved" },
  { value: "FLAGGED", label: "Flagged" },
  { value: "REJECTED", label: "Rejected" },
  { value: "LOCKED", label: "Locked" },
];

export default function AuditLog() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["audit-log", action, page],
    queryFn: () => fetchAuditLog({ action: action || undefined, page }),
  });

  const totalPages = data ? Math.ceil(data.count / 50) : 1;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Append-only record of every review action. Available to auditors on request.
        </p>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-4 mb-5">
        <select
          className="select w-48"
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
        >
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {data && (
          <span className="text-sm text-gray-500">
            {data.count.toLocaleString()} entries
          </span>
        )}
      </div>

      {/* Timeline */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-gray-200 animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse" />
                  <div className="h-3 bg-gray-100 rounded w-1/2 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : !data?.results.length ? (
          <div className="p-12 text-center">
            <ScrollText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No audit log entries yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.results.map((entry) => {
              const cfg = ACTION_CONFIG[entry.action] ?? ACTION_CONFIG.NOTE_ADDED;
              const Icon = cfg.icon;

              return (
                <div key={entry.id} className="flex items-start gap-4 px-6 py-4 hover:bg-gray-50">
                  <div
                    className={clsx(
                      "flex items-center justify-center w-9 h-9 rounded-full shrink-0",
                      cfg.color
                    )}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-900">
                        {cfg.label}
                      </span>
                      <span className="text-sm text-gray-500 truncate">
                        {entry.record_summary}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 flex-wrap">
                      <span>by {entry.user_username}</span>
                      <span>·</span>
                      <span>{new Date(entry.timestamp).toLocaleString()}</span>
                      {entry.previous_status && entry.new_status && (
                        <>
                          <span>·</span>
                          <span className="text-gray-400">
                            {entry.previous_status} → {entry.new_status}
                          </span>
                        </>
                      )}
                    </div>
                    {entry.notes && (
                      <p className="text-xs text-gray-600 mt-1 italic">
                        "{entry.notes}"
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="btn-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

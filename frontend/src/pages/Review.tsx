import { useState, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  fetchRecords,
  approveRecord,
  flagRecord,
  rejectRecord,
  bulkApprove,
  lockApproved,
} from "../api";
import type { NormalizedRecord, ReviewStatus } from "../types";
import { StatusBadge, ScopeBadge, SourceBadge } from "../components/Badge";
import FlagList from "../components/FlagList";
import { ConfirmModal } from "../components/ConfirmModal";
import { useToast } from "../hooks/useToast";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Lock,
  Filter,
  Database,
} from "lucide-react";
import clsx from "clsx";

const SOURCE_OPTIONS = [
  { value: "", label: "All sources" },
  { value: "SAP_FUEL", label: "SAP Fuel" },
  { value: "UTILITY_ELEC", label: "Utility" },
  { value: "CORP_TRAVEL", label: "Travel" },
];
const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "FLAGGED", label: "Flagged" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];
const SCOPE_OPTIONS = [
  { value: "", label: "All scopes" },
  { value: "1", label: "Scope 1" },
  { value: "2", label: "Scope 2" },
  { value: "3", label: "Scope 3" },
];

interface Filters { review_status: string; source_type: string; scope: string; page: number }
type ExpandTab = "flags" | "raw" | "meta";

function ActionModal({
  action, record, onClose, onSubmit,
}: {
  action: "reject" | "flag";
  record: NormalizedRecord;
  onClose: () => void;
  onSubmit: (notes: string) => void;
}) {
  const [notes, setNotes] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900 mb-1">
          {action === "reject" ? "Reject record" : "Flag for review"}
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          {record.activity_type_display} · {record.site_code || "—"} · {record.period_start}
        </p>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Notes {action === "reject" && <span className="text-red-500">*</span>}
        </label>
        <textarea
          className="input h-24 resize-none"
          placeholder={action === "reject" ? "Required: explain why this record is being rejected…" : "Optional: describe why this record is being flagged…"}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          autoFocus
        />
        <div className="flex justify-end gap-3 mt-4">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            className={action === "reject" ? "btn-danger" : "btn-primary"}
            disabled={action === "reject" && !notes.trim()}
            onClick={() => onSubmit(notes)}
          >
            {action === "reject" ? "Reject" : "Flag"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RawDataTable({ data }: { data: Record<string, string> | null }) {
  if (!data || Object.keys(data).length === 0) {
    return <p className="text-xs text-gray-400 italic">No raw data available.</p>;
  }
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== "");
  return (
    <div className="overflow-auto max-h-52 rounded-lg border border-gray-200">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            <th className="text-left px-3 py-2 font-medium text-gray-600 border-b border-gray-200 w-1/3">Field</th>
            <th className="text-left px-3 py-2 font-medium text-gray-600 border-b border-gray-200">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {entries.map(([k, v]) => (
            <tr key={k} className="hover:bg-gray-50">
              <td className="px-3 py-1.5 font-mono text-gray-500 whitespace-nowrap">{k}</td>
              <td className="px-3 py-1.5 text-gray-800 font-medium">{String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordRow({ record }: { record: NormalizedRecord }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<ExpandTab>("flags");
  const [modal, setModal] = useState<"reject" | "flag" | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["records"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };

  const approveMut = useMutation({
    mutationFn: () => approveRecord(record.id),
    onSuccess: () => { invalidate(); toast("success", "Record approved."); },
    onError: () => toast("error", "Failed to approve record."),
  });

  const onActionSubmit = async (action: "reject" | "flag", notes: string) => {
    try {
      if (action === "reject") await rejectRecord(record.id, notes);
      else await flagRecord(record.id, notes);
      invalidate();
      toast("success", action === "reject" ? "Record rejected." : "Record flagged for review.");
    } catch {
      toast("error", `Failed to ${action} record.`);
    }
    setModal(null);
  };

  const flagCount = record.review_flags?.length ?? 0;
  const errorCount = record.review_flags?.filter((f) => f.severity === "ERROR").length ?? 0;
  const hasRawData = record.raw_data && Object.keys(record.raw_data).length > 0;
  const hasMetadata = record.metadata && Object.values(record.metadata).some((v) => v !== null && v !== "");

  const tabs: { id: ExpandTab; label: string; show: boolean }[] = [
    { id: "flags", label: `Anomalies${flagCount > 0 ? ` (${flagCount})` : ""}`, show: true },
    { id: "raw", label: "Raw data", show: !!hasRawData },
    { id: "meta", label: "Metadata", show: !!hasMetadata },
  ];

  return (
    <>
      {modal && (
        <ActionModal
          action={modal}
          record={record}
          onClose={() => setModal(null)}
          onSubmit={(notes) => onActionSubmit(modal, notes)}
        />
      )}
      <tr
        className={clsx(
          "border-b border-gray-100 hover:bg-gray-50/70 transition-colors",
          record.review_status === "FLAGGED" && "bg-amber-50/30 hover:bg-amber-50/50",
          record.review_status === "REJECTED" && "bg-red-50/20",
        )}
      >
        <td className="px-3 py-3">
          <button onClick={() => setExpanded(!expanded)} className="text-gray-400 hover:text-gray-600">
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </td>
        <td className="px-3 py-3"><SourceBadge source={record.source_type} /></td>
        <td className="px-3 py-3"><ScopeBadge scope={record.scope} /></td>
        <td className="px-3 py-3 text-sm text-gray-700">{record.activity_type_display}</td>
        <td className="px-3 py-3 text-sm font-medium text-gray-900">
          {record.site_code || "—"}
          {record.site_name && (
            <span className="block text-xs text-gray-400 font-normal truncate max-w-[130px]">{record.site_name}</span>
          )}
        </td>
        <td className="px-3 py-3 text-sm text-gray-600 whitespace-nowrap">
          {record.period_start}
          {record.period_start !== record.period_end && (
            <span className="text-gray-400"> – {record.period_end}</span>
          )}
        </td>
        <td className="px-3 py-3 text-sm font-semibold text-gray-900 whitespace-nowrap">
          {parseFloat(record.quantity_normalized).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
          <span className="text-gray-400 font-normal text-xs">{record.unit_normalized}</span>
          <div className="text-xs text-gray-400 font-normal">
            {parseFloat(record.quantity).toLocaleString()} {record.unit}
          </div>
        </td>
        <td className="px-3 py-3">
          {flagCount > 0 && (
            <span className={clsx(
              "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded",
              errorCount > 0 ? "text-red-700 bg-red-100" : "text-amber-700 bg-amber-100"
            )}>
              <AlertTriangle className="w-3 h-3" />
              {errorCount > 0 ? `${errorCount} err` : `${flagCount} warn`}
            </span>
          )}
        </td>
        <td className="px-3 py-3"><StatusBadge status={record.review_status} locked={record.is_locked} /></td>
        <td className="px-3 py-3">
          {!record.is_locked && record.review_status !== "REJECTED" && record.review_status !== "APPROVED" && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => approveMut.mutate()}
                disabled={approveMut.isPending}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Approve
              </button>
              <button
                onClick={() => setModal("flag")}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                title="Flag for review"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setModal("reject")}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                title="Reject"
              >
                <XCircle className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {!record.is_locked && record.review_status === "APPROVED" && (
            <button
              onClick={() => setModal("flag")}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <AlertTriangle className="w-3.5 h-3.5" /> Flag
            </button>
          )}
        </td>
      </tr>

      {expanded && (
        <tr className="bg-gray-50/80 border-b border-gray-100">
          <td colSpan={10} className="px-6 pt-3 pb-5">
            {/* Tabs */}
            <div className="flex gap-0.5 mb-4 border-b border-gray-200">
              {tabs.filter((t) => t.show).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={clsx(
                    "px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
                    activeTab === t.id
                      ? "border-brand-500 text-brand-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  )}
                >
                  {t.label}
                </button>
              ))}
              {record.review_notes && (
                <div className="ml-auto flex items-center gap-2 text-xs text-gray-500 pb-2">
                  <span className="font-medium">Note:</span>
                  <span className="italic">"{record.review_notes}"</span>
                  {record.reviewed_by_username && (
                    <span className="text-gray-400">— {record.reviewed_by_username}</span>
                  )}
                </div>
              )}
            </div>

            {/* Tab content */}
            {activeTab === "flags" && (
              <div>
                {flagCount > 0 ? (
                  <FlagList flags={record.review_flags} />
                ) : (
                  <p className="text-xs text-gray-400 italic">No anomaly flags on this record.</p>
                )}
                {record.parse_errors && record.parse_errors.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-red-600 mb-1">Parse warnings</p>
                    <ul className="text-xs text-red-700 space-y-0.5">
                      {record.parse_errors.map((e, i) => <li key={i}>• {e}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {activeTab === "raw" && <RawDataTable data={record.raw_data} />}

            {activeTab === "meta" && (
              <div className="overflow-auto max-h-52 rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-600 border-b border-gray-200 w-1/3">Field</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600 border-b border-gray-200">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {Object.entries(record.metadata || {})
                      .filter(([, v]) => v !== null && v !== "")
                      .map(([k, v]) => (
                        <tr key={k} className="hover:bg-gray-50">
                          <td className="px-3 py-1.5 font-mono text-gray-500">{k}</td>
                          <td className="px-3 py-1.5 text-gray-800 font-medium">{String(v)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function Review() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [confirmModal, setConfirmModal] = useState<"bulk" | "lock" | null>(null);

  const [filters, setFilters] = useState<Filters>({
    review_status: searchParams.get("review_status") ?? "PENDING",
    source_type: "",
    scope: "",
    page: 1,
  });

  // Sync URL param on mount only
  useEffect(() => {
    const s = searchParams.get("review_status");
    if (s) setFilters((f) => ({ ...f, review_status: s }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["records", filters],
    queryFn: () => fetchRecords(filters),
  });

  const bulkApproveMut = useMutation({
    mutationFn: () => bulkApprove(),
    onSuccess: ({ approved }) => {
      toast("success", `${approved} record${approved !== 1 ? "s" : ""} approved.`);
      qc.invalidateQueries({ queryKey: ["records"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: () => toast("error", "Bulk approve failed."),
  });

  const lockMut = useMutation({
    mutationFn: () => lockApproved(),
    onSuccess: ({ locked }) => {
      toast("success", `${locked} record${locked !== 1 ? "s" : ""} locked for audit.`);
      qc.invalidateQueries({ queryKey: ["records"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: () => toast("error", "Lock failed."),
  });

  function setFilter(key: keyof Filters, value: string | number) {
    setFilters((f) => ({ ...f, [key]: value, page: key === "page" ? (value as number) : 1 }));
  }

  const totalPages = data ? Math.ceil(data.count / 50) : 1;

  return (
    <div className="p-8">
      {confirmModal === "bulk" && (
        <ConfirmModal
          title="Approve all pending records?"
          message="This will approve all records currently in PENDING status. Flagged records are not affected."
          confirmLabel="Approve all pending"
          onConfirm={() => bulkApproveMut.mutate()}
          onClose={() => setConfirmModal(null)}
        />
      )}
      {confirmModal === "lock" && (
        <ConfirmModal
          title="Lock approved records for audit?"
          message="Approved records will be marked as locked and become immutable. This cannot be undone."
          confirmLabel="Lock records"
          danger
          onConfirm={() => lockMut.mutate()}
          onClose={() => setConfirmModal(null)}
        />
      )}

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Review Queue</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Approve, flag, or reject records before locking for audit.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="btn-secondary"
            onClick={() => setConfirmModal("bulk")}
            disabled={bulkApproveMut.isPending}
          >
            <CheckCircle className="w-4 h-4 text-green-500" />
            Approve all pending
          </button>
          <button
            className="btn-primary"
            onClick={() => setConfirmModal("lock")}
            disabled={lockMut.isPending}
          >
            <Lock className="w-4 h-4" />
            Lock approved
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-5 flex items-center gap-4 flex-wrap">
        <Filter className="w-4 h-4 text-gray-400 shrink-0" />
        <select className="select w-auto" value={filters.review_status} onChange={(e) => setFilter("review_status", e.target.value)}>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="select w-auto" value={filters.source_type} onChange={(e) => setFilter("source_type", e.target.value)}>
          {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="select w-auto" value={filters.scope} onChange={(e) => setFilter("scope", e.target.value)}>
          {SCOPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {data && (
          <span className="text-sm text-gray-500 ml-auto">
            {data.count.toLocaleString()} record{data.count !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[920px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="w-8 px-3 py-3" />
              <th className="text-left px-3 py-3 font-medium text-gray-600">Source</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600">Scope</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600">Activity</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600">Site</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600">Period</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600">Quantity</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600">Flags</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-100">
                  {Array.from({ length: 10 }).map((__, j) => (
                    <td key={j} className="px-3 py-4">
                      <div className="h-4 bg-gray-200 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : !data?.results.length ? (
              <tr>
                <td colSpan={10} className="px-4 py-16 text-center">
                  <Database className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No records match the current filters.</p>
                </td>
              </tr>
            ) : (
              data.results.map((rec) => <RecordRow key={rec.id} record={rec} />)
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">Page {filters.page} of {totalPages}</p>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={filters.page === 1} onClick={() => setFilter("page", filters.page - 1)}>Previous</button>
            <button className="btn-secondary" disabled={filters.page >= totalPages} onClick={() => setFilter("page", filters.page + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

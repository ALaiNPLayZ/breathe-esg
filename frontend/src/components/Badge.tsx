import clsx from "clsx";
import type { ReviewStatus, Scope } from "../types";

const STATUS_STYLES: Record<ReviewStatus, string> = {
  PENDING:  "bg-gray-100 text-gray-700 ring-1 ring-gray-300",
  APPROVED: "bg-green-50 text-green-700 ring-1 ring-green-300",
  FLAGGED:  "bg-amber-50 text-amber-700 ring-1 ring-amber-300",
  REJECTED: "bg-red-50 text-red-700 ring-1 ring-red-300",
};

const STATUS_LABELS: Record<ReviewStatus, string> = {
  PENDING:  "Pending",
  APPROVED: "Approved",
  FLAGGED:  "Flagged",
  REJECTED: "Rejected",
};

const SCOPE_STYLES: Record<Scope, string> = {
  1: "bg-orange-50 text-orange-700 ring-1 ring-orange-300",
  2: "bg-blue-50 text-blue-700 ring-1 ring-blue-300",
  3: "bg-purple-50 text-purple-700 ring-1 ring-purple-300",
};

interface StatusBadgeProps {
  status: ReviewStatus;
  locked?: boolean;
}

export function StatusBadge({ status, locked }: StatusBadgeProps) {
  if (locked) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 ring-1 ring-indigo-300">
        Locked
      </span>
    );
  }
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        STATUS_STYLES[status]
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ScopeBadge({ scope }: { scope: Scope }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold",
        SCOPE_STYLES[scope]
      )}
    >
      Scope {scope}
    </span>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  SAP_FUEL:    "SAP",
  UTILITY_ELEC: "Utility",
  CORP_TRAVEL: "Travel",
};
const SOURCE_STYLES: Record<string, string> = {
  SAP_FUEL:    "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-300",
  UTILITY_ELEC: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-300",
  CORP_TRAVEL: "bg-pink-50 text-pink-700 ring-1 ring-pink-300",
};

export function SourceBadge({ source }: { source: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        SOURCE_STYLES[source] ?? "bg-gray-100 text-gray-700"
      )}
    >
      {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

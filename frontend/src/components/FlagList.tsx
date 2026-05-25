import { AlertTriangle, AlertCircle } from "lucide-react";
import type { Flag } from "../types";
import clsx from "clsx";

export default function FlagList({ flags }: { flags: Flag[] }) {
  if (!flags || flags.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {flags.map((flag, i) => (
        <div
          key={i}
          className={clsx(
            "flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
            flag.severity === "ERROR"
              ? "bg-red-50 text-red-800"
              : "bg-amber-50 text-amber-800"
          )}
        >
          {flag.severity === "ERROR" ? (
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          )}
          <div>
            <span className="font-mono font-semibold">{flag.code}</span>{" "}
            <span>{flag.message}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchIngestionRuns, uploadFile, loadSample } from "../api";
import { Upload, Zap, Flame, Plane, CheckCircle, XCircle, AlertTriangle, Download } from "lucide-react";
import type { IngestionRun } from "../types";
import clsx from "clsx";

const SOURCES = [
  {
    key: "SAP_FUEL",
    label: "SAP Fuel & Procurement",
    icon: Flame,
    color: "bg-cyan-50 border-cyan-200",
    iconColor: "text-cyan-600 bg-cyan-100",
    description:
      "Tab-delimited flat file from SAP MB51 (Material Documents). German column headers, German decimal format, plant codes.",
    accept: ".txt,.csv,.tsv",
    hint: "Supports: UTF-8, Windows-1252. German/English column headers.",
  },
  {
    key: "UTILITY_ELEC",
    label: "Utility Electricity",
    icon: Zap,
    color: "bg-yellow-50 border-yellow-200",
    iconColor: "text-yellow-600 bg-yellow-100",
    description:
      "Green Button Alliance CSV export from utility portals (PG&E, ConEd, Eversource). Billing periods may not align with calendar months.",
    accept: ".csv",
    hint: "Supports: kWh and MWh usage, multiple meters per account.",
  },
  {
    key: "CORP_TRAVEL",
    label: "Corporate Travel",
    icon: Plane,
    color: "bg-pink-50 border-pink-200",
    iconColor: "text-pink-600 bg-pink-100",
    description:
      "Concur Analytics standard expense report CSV. Includes flights (airport codes), hotels (nights), and ground transport.",
    accept: ".csv",
    hint: "Supports: multi-currency, Business/Economy class, missing flight distances.",
  },
] as const;

type SourceKey = (typeof SOURCES)[number]["key"];

function StatusIcon({ status }: { status: IngestionRun["status"] }) {
  if (status === "COMPLETE") return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (status === "FAILED")   return <XCircle className="w-4 h-4 text-red-500" />;
  if (status === "PROCESSING") return <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />;
  return <div className="w-4 h-4 rounded-full bg-gray-300" />;
}

export default function Ingest() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["ingestion-runs"],
    queryFn: fetchIngestionRuns,
    refetchInterval: 5_000,
  });

  const [uploading, setUploading] = useState<SourceKey | null>(null);
  const [loadingSample, setLoadingSample] = useState<SourceKey | null>(null);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function showToast(type: "ok" | "err", msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleFile(sourceKey: SourceKey, file: File) {
    setUploading(sourceKey);
    try {
      await uploadFile(file, sourceKey);
      qc.invalidateQueries({ queryKey: ["ingestion-runs"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      showToast("ok", `${file.name} ingested successfully.`);
    } catch (e: unknown) {
      showToast("err", e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(null);
      const input = fileRefs.current[sourceKey];
      if (input) input.value = "";
    }
  }

  async function handleLoadSample(sourceKey: SourceKey) {
    setLoadingSample(sourceKey);
    try {
      await loadSample(sourceKey);
      qc.invalidateQueries({ queryKey: ["ingestion-runs"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      showToast("ok", "Sample data loaded.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load sample.";
      if (msg.includes("already loaded")) {
        showToast("ok", "Sample data already loaded.");
      } else {
        showToast("err", msg);
      }
    } finally {
      setLoadingSample(null);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Toast */}
      {toast && (
        <div
          className={clsx(
            "fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium",
            toast.type === "ok"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          )}
        >
          {toast.type === "ok" ? (
            <CheckCircle className="w-4 h-4 text-green-500" />
          ) : (
            <XCircle className="w-4 h-4 text-red-500" />
          )}
          {toast.msg}
        </div>
      )}

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Ingest Data</h1>
      <p className="text-sm text-gray-500 mb-8">
        Upload files from your data sources. Rows are parsed, normalised, and flagged for review automatically.
      </p>

      {/* Source upload cards */}
      <div className="grid grid-cols-1 gap-5 mb-10">
        {SOURCES.map((src) => {
          const isUp = uploading === src.key;
          const isSample = loadingSample === src.key;
          const Icon = src.icon;

          return (
            <div key={src.key} className={clsx("card border p-6", src.color)}>
              <div className="flex items-start gap-4">
                <div className={clsx("rounded-xl p-3 shrink-0", src.iconColor)}>
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-gray-900 mb-0.5">
                    {src.label}
                  </h2>
                  <p className="text-sm text-gray-600 mb-1">{src.description}</p>
                  <p className="text-xs text-gray-500">{src.hint}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3 flex-wrap">
                {/* Hidden file input */}
                <input
                  type="file"
                  accept={src.accept}
                  className="hidden"
                  ref={(el) => { fileRefs.current[src.key] = el; }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(src.key, file);
                  }}
                />
                <button
                  className="btn-primary"
                  disabled={isUp || isSample}
                  onClick={() => fileRefs.current[src.key]?.click()}
                >
                  <Upload className="w-4 h-4" />
                  {isUp ? "Uploading…" : "Upload file"}
                </button>
                <button
                  className="btn-secondary"
                  disabled={isUp || isSample}
                  onClick={() => handleLoadSample(src.key)}
                >
                  <Download className="w-4 h-4" />
                  {isSample ? "Loading…" : "Load sample data"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Ingestion history */}
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Ingestion History</h2>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card p-4 animate-pulse bg-gray-100 h-16" />
            ))}
          </div>
        ) : !data?.results.length ? (
          <div className="card p-8 text-center">
            <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No files ingested yet. Upload a file above to get started.</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">File</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Total</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">OK</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Flagged</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Failed</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.results.map((run) => (
                  <tr key={run.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">
                      {run.file_name}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{run.source_type_display}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(run.ingested_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-900 font-medium">
                      {run.row_count_total}
                    </td>
                    <td className="px-4 py-3 text-center text-green-600 font-medium">
                      {run.row_count_success}
                    </td>
                    <td className="px-4 py-3 text-center text-amber-600 font-medium">
                      {run.row_count_flagged}
                    </td>
                    <td className="px-4 py-3 text-center text-red-600 font-medium">
                      {run.row_count_failed}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusIcon status={run.status} />
                        <span className="text-gray-700">{run.status_display}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

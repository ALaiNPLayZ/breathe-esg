import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchIngestionRuns, uploadFile, loadSample } from "../api";
import { Upload, Zap, Flame, Plane, CheckCircle, XCircle, AlertTriangle, RefreshCw } from "lucide-react";
import type { IngestionRun } from "../types";
import { useToast } from "../hooks/useToast";
import clsx from "clsx";

const SOURCES = [
  {
    key: "SAP_FUEL",
    label: "SAP Fuel & Procurement",
    icon: Flame,
    cardClass: "bg-gradient-to-br from-cyan-50 to-cyan-100/50 border-cyan-200",
    iconClass: "text-cyan-600 bg-cyan-100",
    accentClass: "bg-cyan-500",
    description: "Tab-delimited export from SAP MB51 (Material Documents List). German column headers, German decimal format, plant codes.",
    accept: ".txt,.csv,.tsv",
    hint: "Supports UTF-8, Windows-1252 encoding. Handles German and Anglo-Saxon decimal formats.",
  },
  {
    key: "UTILITY_ELEC",
    label: "Utility Electricity",
    icon: Zap,
    cardClass: "bg-gradient-to-br from-yellow-50 to-yellow-100/50 border-yellow-200",
    iconClass: "text-yellow-600 bg-yellow-100",
    accentClass: "bg-yellow-500",
    description: "Green Button Alliance CSV from utility portals (PG&E, ConEd, Eversource). Billing periods may not align with calendar months.",
    accept: ".csv",
    hint: "Supports kWh and MWh usage columns, multiple meters per account, overlapping billing period detection.",
  },
  {
    key: "CORP_TRAVEL",
    label: "Corporate Travel",
    icon: Plane,
    cardClass: "bg-gradient-to-br from-pink-50 to-pink-100/50 border-pink-200",
    iconClass: "text-pink-600 bg-pink-100",
    accentClass: "bg-pink-500",
    description: "Concur Analytics standard expense report CSV. Covers flights, hotels, and ground transport across all currencies.",
    accept: ".csv",
    hint: "Handles multi-currency, Business/Economy class, airport-code-only flights, missing distances.",
  },
] as const;

type SourceKey = (typeof SOURCES)[number]["key"];

function StatusPip({ status }: { status: IngestionRun["status"] }) {
  if (status === "COMPLETE") return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (status === "FAILED") return <XCircle className="w-4 h-4 text-red-500" />;
  if (status === "PROCESSING") return <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />;
  return <div className="w-4 h-4 rounded-full bg-gray-300" />;
}

function RunBreakdown({ run }: { run: IngestionRun }) {
  if (run.row_count_total === 0) return null;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-green-600 font-medium">{run.row_count_success} ok</span>
      {run.row_count_flagged > 0 && (
        <span className="text-amber-600 font-medium flex items-center gap-0.5">
          <AlertTriangle className="w-3 h-3" />{run.row_count_flagged} flagged
        </span>
      )}
      {run.row_count_failed > 0 && (
        <span className="text-red-600 font-medium">{run.row_count_failed} failed</span>
      )}
    </div>
  );
}

export default function Ingest() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["ingestion-runs"],
    queryFn: fetchIngestionRuns,
    refetchInterval: 5_000,
  });

  const [uploading, setUploading] = useState<SourceKey | null>(null);
  const [loadingSample, setLoadingSample] = useState<SourceKey | null>(null);
  const [dragOver, setDragOver] = useState<SourceKey | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function handleFile(sourceKey: SourceKey, file: File) {
    setUploading(sourceKey);
    try {
      const run = await uploadFile(file, sourceKey);
      qc.invalidateQueries({ queryKey: ["ingestion-runs"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      const flagged = run.row_count_flagged;
      toast(
        flagged > 0 ? "info" : "success",
        flagged > 0
          ? `${file.name}: ${run.row_count_success} ok, ${flagged} flagged — go to Review to inspect.`
          : `${file.name} ingested: ${run.row_count_success} records ready for review.`,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed.";
      if (msg.includes("already been ingested")) {
        toast("info", "This file has already been ingested (duplicate detected).");
      } else {
        toast("error", msg);
      }
    } finally {
      setUploading(null);
      const input = fileRefs.current[sourceKey];
      if (input) input.value = "";
    }
  }

  async function handleLoadSample(sourceKey: SourceKey) {
    setLoadingSample(sourceKey);
    try {
      const run = await loadSample(sourceKey);
      qc.invalidateQueries({ queryKey: ["ingestion-runs"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast("success", `Sample loaded: ${run.row_count_success} ok, ${run.row_count_flagged} flagged.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load sample.";
      if (msg.includes("already loaded") || msg.includes("already been ingested")) {
        toast("info", "Sample data already loaded.");
      } else {
        toast("error", msg);
      }
    } finally {
      setLoadingSample(null);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Ingest Data</h1>
      <p className="text-sm text-gray-500 mb-8">
        Upload files from your enterprise systems. Records are parsed, normalised to SI units, and anomaly-checked automatically.
      </p>

      <div className="grid grid-cols-1 gap-5 mb-10">
        {SOURCES.map((src) => {
          const isUp = uploading === src.key;
          const isSample = loadingSample === src.key;
          const isDrag = dragOver === src.key;
          const Icon = src.icon;
          const busy = isUp || isSample;

          return (
            <div
              key={src.key}
              className={clsx(
                "relative card border p-6 transition-all",
                src.cardClass,
                isDrag && "ring-2 ring-brand-400 ring-offset-1 scale-[1.005]",
              )}
              onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(src.key); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                const file = e.dataTransfer.files[0];
                if (file && !busy) handleFile(src.key, file);
              }}
            >
              {/* Drag overlay hint */}
              {isDrag && (
                <div className="absolute inset-0 rounded-xl bg-brand-500/10 border-2 border-brand-400 border-dashed flex items-center justify-center z-10 pointer-events-none">
                  <p className="text-brand-600 font-semibold text-sm flex items-center gap-2">
                    <Upload className="w-4 h-4" /> Drop to ingest
                  </p>
                </div>
              )}

              <div className="flex items-start gap-4">
                <div className={clsx("rounded-xl p-3 shrink-0", src.iconClass)}>
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-gray-900 mb-0.5">{src.label}</h2>
                  <p className="text-sm text-gray-600 mb-1">{src.description}</p>
                  <p className="text-xs text-gray-500">{src.hint}</p>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3 flex-wrap">
                <input
                  type="file"
                  accept={src.accept}
                  className="hidden"
                  ref={(el) => { fileRefs.current[src.key] = el; }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(src.key, f); }}
                />
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => fileRefs.current[src.key]?.click()}
                >
                  {isUp ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Uploading…</>
                  ) : (
                    <><Upload className="w-4 h-4" /> Upload file</>
                  )}
                </button>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => handleLoadSample(src.key)}
                >
                  {isSample ? (
                    <><RefreshCw className="w-4 h-4 animate-spin" /> Loading…</>
                  ) : (
                    "Load sample data"
                  )}
                </button>
                <span className="text-xs text-gray-400 ml-auto hidden sm:block">
                  or drag &amp; drop a file anywhere on this card
                </span>
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
          <div className="card p-10 text-center">
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
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Results</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.results.map((run) => (
                  <tr key={run.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{run.file_name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{run.source_type_display}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(run.ingested_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3"><RunBreakdown run={run} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusPip status={run.status} />
                        <span className="text-gray-600 text-xs">{run.status_display}</span>
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

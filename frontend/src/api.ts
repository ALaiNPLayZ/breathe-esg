import type {
  AuditLogEntry,
  AuthTokens,
  IngestionRun,
  NormalizedRecord,
  PaginatedResponse,
  Stats,
} from "./types";

const BASE = "/api";

function getToken(): string | null {
  return localStorage.getItem("access_token");
}

function setTokens(tokens: AuthTokens) {
  localStorage.setItem("access_token", tokens.access);
  localStorage.setItem("refresh_token", tokens.refresh);
}

function clearTokens() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
}

async function request<T>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });

  if (res.status === 401) {
    // Try refresh
    const refreshed = await tryRefresh();
    if (!refreshed) {
      clearTokens();
      window.location.href = "/login";
      throw new Error("Session expired");
    }
    headers["Authorization"] = `Bearer ${getToken()}`;
    const retry = await fetch(`${BASE}${path}`, { ...opts, headers });
    if (!retry.ok) throw new Error(await retry.text());
    return retry.json();
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function tryRefresh(): Promise<boolean> {
  const refresh = localStorage.getItem("refresh_token");
  if (!refresh) return false;
  try {
    const res = await fetch(`${BASE}/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    localStorage.setItem("access_token", data.access);
    return true;
  } catch {
    return false;
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch(`${BASE}/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error("Invalid credentials");
  const tokens: AuthTokens = await res.json();
  setTokens(tokens);
}

export function logout() {
  clearTokens();
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function fetchStats(): Promise<Stats> {
  return request<Stats>("/stats/");
}

// ── Ingestion runs ───────────────────────────────────────────────────────────

export function fetchIngestionRuns(): Promise<PaginatedResponse<IngestionRun>> {
  return request<PaginatedResponse<IngestionRun>>("/ingestion-runs/");
}

export async function uploadFile(file: File, sourceType: string): Promise<IngestionRun> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);
  form.append("source_type", sourceType);

  const res = await fetch(`${BASE}/ingestion-runs/upload/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || body.warning || res.statusText);
  }
  return res.json();
}

export async function loadSample(sourceType: string): Promise<IngestionRun> {
  return request<IngestionRun>("/ingestion-runs/load_sample/", {
    method: "POST",
    body: JSON.stringify({ source_type: sourceType }),
  });
}

// ── Normalized records ───────────────────────────────────────────────────────

export interface RecordFilters {
  review_status?: string;
  source_type?: string;
  scope?: string;
  run_id?: string;
  period_start?: string;
  period_end?: string;
  site_code?: string;
  page?: number;
}

export function fetchRecords(
  filters: RecordFilters = {}
): Promise<PaginatedResponse<NormalizedRecord>> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== "") params.set(k, String(v));
  });
  return request<PaginatedResponse<NormalizedRecord>>(
    `/records/?${params.toString()}`
  );
}

export function approveRecord(id: string, notes?: string): Promise<NormalizedRecord> {
  return request<NormalizedRecord>(`/records/${id}/approve/`, {
    method: "POST",
    body: JSON.stringify({ notes: notes ?? "" }),
  });
}

export function flagRecord(id: string, notes?: string): Promise<NormalizedRecord> {
  return request<NormalizedRecord>(`/records/${id}/flag/`, {
    method: "POST",
    body: JSON.stringify({ notes: notes ?? "" }),
  });
}

export function rejectRecord(id: string, notes: string): Promise<NormalizedRecord> {
  return request<NormalizedRecord>(`/records/${id}/reject/`, {
    method: "POST",
    body: JSON.stringify({ notes }),
  });
}

export function bulkApprove(ids?: string[]): Promise<{ approved: number }> {
  return request<{ approved: number }>("/records/bulk_approve/", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export function lockApproved(): Promise<{ locked: number }> {
  return request<{ locked: number }>("/records/lock_approved/", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// ── Audit log ────────────────────────────────────────────────────────────────

export function fetchAuditLog(
  filters: { record_id?: string; action?: string; page?: number } = {}
): Promise<PaginatedResponse<AuditLogEntry>> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== "") params.set(k, String(v));
  });
  return request<PaginatedResponse<AuditLogEntry>>(
    `/audit-log/?${params.toString()}`
  );
}

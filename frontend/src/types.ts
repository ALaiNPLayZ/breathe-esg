export interface User {
  id: number;
  username: string;
  email: string;
  tenant: string | null;
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

export type ReviewStatus = "PENDING" | "APPROVED" | "FLAGGED" | "REJECTED";
export type Scope = 1 | 2 | 3;
export type SourceType = "SAP_FUEL" | "UTILITY_ELEC" | "CORP_TRAVEL";

export interface Flag {
  code: string;
  message: string;
  severity: "ERROR" | "WARNING";
}

export interface NormalizedRecord {
  id: string;
  scope: Scope;
  scope_display: string;
  scope_category: string;
  activity_type: string;
  activity_type_display: string;
  source_type: SourceType;
  source_type_display: string;
  quantity: string;
  unit: string;
  quantity_normalized: string;
  unit_normalized: string;
  period_start: string;
  period_end: string;
  site_code: string;
  site_name: string;
  cost_center: string;
  country: string;
  currency: string;
  amount: string | null;
  metadata: Record<string, unknown>;
  review_status: ReviewStatus;
  review_status_display: string;
  review_flags: Flag[];
  reviewed_by: number | null;
  reviewed_by_username: string | null;
  reviewed_at: string | null;
  review_notes: string;
  is_locked: boolean;
  locked_at: string | null;
  ingestion_run: string;
  raw_data: Record<string, string> | null;
  parse_errors: string[];
  created_at: string;
  updated_at: string;
}

export interface IngestionRun {
  id: string;
  source_type: SourceType;
  source_type_display: string;
  file_name: string;
  file_hash: string;
  status: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";
  status_display: string;
  ingested_by: number;
  ingested_by_username: string;
  ingested_at: string;
  completed_at: string | null;
  row_count_total: number;
  row_count_success: number;
  row_count_failed: number;
  row_count_flagged: number;
  error_message: string;
}

export interface AuditLogEntry {
  id: string;
  normalized_record: string;
  record_summary: string;
  user: number;
  user_username: string;
  action: string;
  action_display: string;
  previous_status: string;
  new_status: string;
  notes: string;
  timestamp: string;
}

export interface Stats {
  total: number;
  pending: number;
  flagged: number;
  approved: number;
  rejected: number;
  locked: number;
  by_scope: { scope_1: number; scope_2: number; scope_3: number };
  by_source: { SAP_FUEL: number; UTILITY_ELEC: number; CORP_TRAVEL: number };
  recent_runs: IngestionRun[];
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

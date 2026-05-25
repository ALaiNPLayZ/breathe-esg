# Feature Reference — Breathe ESG Data Ingestion Prototype

Live demo: **https://breathe-esg-nimt.onrender.com**  
Credentials: `analyst / analyst123` or `admin / admin123`

---

## Table of contents

1. [Data ingestion](#1-data-ingestion)
2. [Parsing & normalisation](#2-parsing--normalisation)
3. [Anomaly detection](#3-anomaly-detection)
4. [Review workflow](#4-review-workflow)
5. [Dashboard](#5-dashboard)
6. [Audit trail](#6-audit-trail)
7. [Data model](#7-data-model)
8. [API](#8-api)
9. [Multi-tenancy & security](#9-multi-tenancy--security)
10. [Infrastructure & deployment](#10-infrastructure--deployment)

---

## 1. Data ingestion

### Three enterprise source types

| Source | Format | Real-world origin |
|--------|--------|-------------------|
| **SAP Fuel & Procurement** | Tab-delimited flat file | SAP MB51 Material Documents List (ALV grid export) |
| **Utility Electricity** | CSV | Green Button Alliance standard (NAESB REQ.21 ESPI) |
| **Corporate Travel** | CSV | SAP Concur Analytics expense report export |

### File upload
- Drag-and-drop or click-to-browse on each source card in the Ingest page
- Any file that has already been ingested is rejected with a SHA-256 hash check before parsing begins — prevents double-counting
- Upload result toast shows `N ok, M flagged` with a prompt to jump to Review

### Sample data loader
- Each source has a "Load sample data" button that loads the pre-built realistic sample files
- Idempotent: calling it twice skips re-ingestion based on file hash

### Ingestion history table
- Shows every run with file name, source type, date, row breakdown (ok / flagged / failed), and status
- Auto-refreshes every 5 seconds while a run is in PROCESSING state

---

## 2. Parsing & normalisation

### SAP parser (`parsers.py → parse_sap_file`)

- **Encoding detection**: tries UTF-8-sig (BOM), then Windows-1252, then ISO-8859-1 — matching real SAP European export behaviour
- **German decimal format**: handles `1.234,56` (German) and `1234.56` (Anglo-Saxon) in the same file
- **German date format**: `DD.MM.YYYY` and `DD/MM/YYYY`, as well as ISO `YYYY-MM-DD`
- **German column headers**: mapped via `_SAP_HEADER_MAP` (e.g. `Buchungsdatum` → `posting_date`, `Menge` → `quantity`, `ME` → `unit`)
- **Movement type filtering**: only consumption movements (201, 261, 551, 601, 641, 643) are treated as emissions; receipt movements (101, 501, 521) are ingested but classified separately
- **Scope/activity classification**: keyword matching on material description and material number assigns Scope 1 (FUEL_STAT / FUEL_MOB) or Scope 3 (PROCURE)

### Utility parser (`parse_utility_file`)

- Detects `Usage (kWh)` vs `Usage (MWh)` column and converts to canonical kWh
- Handles `MM/DD/YYYY` and `YYYY-MM-DD` date formats
- Preserves exact billing start/end dates (which rarely align with calendar month boundaries)
- Multiple meters per account ingested as separate records

### Travel parser (`parse_travel_file`)

- Case-insensitive `_EXPENSE_TYPE_MAP` resolves free-text expense types ("Airfare", "AIR TRAVEL", "Flight") to canonical types
- **Flights**: airport codes stored in metadata; distance missing → amount stored as cost proxy with a "Distance not provided" WARNING flag
- **Hotels**: nightly rate × nights used to derive stay period; class of service stored in metadata
- **Ground transport**: rail and car hire handled separately from flights
- Multi-currency: original currency and amount preserved; normalisation deferred (noted in TRADEOFFS.md)

### Unit normalisation table

All quantities are stored in both original and canonical units:

| Input unit | Canonical | Conversion factor | Source |
|-----------|-----------|-------------------|--------|
| GAL (US gallon) | L | × 3.785411784 | NIST SP 811 |
| MWh | kWh | × 1000 | IEA |
| MI | km | × 1.609344 | NIST |
| FT³ | m³ | × 0.028316847 | NIST |
| kg | kg | × 1 (identity) | — |
| L | L | × 1 (identity) | — |
| kWh | kWh | × 1 (identity) | — |
| km | km | × 1 (identity) | — |
| nights | nights | × 1 (identity) | — |

---

## 3. Anomaly detection

Seven automated checks run on every record immediately after normalisation. Anomaly detection never breaks ingestion — all checks are wrapped in try/except.

| Check | Severity | Trigger |
|-------|----------|---------|
| **Zero or negative quantity** | ERROR (negative) / WARNING (zero) | `quantity_normalized ≤ 0` |
| **Future date** | WARNING | `period_end > today + 7 days` |
| **Missing cost centre** | WARNING | Scope 1 or 2 record has no `cost_center` |
| **Duplicate period** | ERROR | An approved or flagged record already exists for the same (site, activity, period_start, period_end) |
| **Year-over-year spike** | WARNING | >50% change vs same period ±31 days in the prior year |
| **Unit/activity mismatch** | WARNING | e.g. kWh unit on a FUEL_STAT activity, or km on an ELEC activity |
| **Overlapping billing period** | WARNING | Electricity meter has a billing period that overlaps an existing record for the same meter |

Records with any ERROR-severity flag, or with a WARNING parse status, are automatically set to **FLAGGED**. Records with only WARNING-severity anomaly flags stay **PENDING** and are surfaced to the analyst for review.

### Sample data anomalies (intentional)

The included sample files contain realistic edge cases to exercise every check:

- **SAP**: row with GAL unit (US plant), row missing cost centre, row with 180,000 L (YoY spike trigger), row with zero quantity, row with negative quantity, row with unknown plant code 3000
- **Utility**: MTR-RTM-W2 with suspiciously low reading (2.8 kWh), MTR-HAM-A1 with overlapping January billing periods
- **Travel**: 14 of 30 rows flagged — flights without distance, one Business class long-haul, future travel date

---

## 4. Review workflow

### State machine

```
PENDING ──► APPROVED ──► LOCKED  (immutable, audit-ready)
   │             │
   ▼             ▼
FLAGGED       FLAGGED
   │
   ▼
REJECTED
```

- **Approve**: mark a record as correct; no notes required
- **Flag**: send back for additional scrutiny with optional notes
- **Reject**: permanently exclude from reporting; analyst notes **required**
- **Bulk approve**: approve all PENDING records in one action (with confirmation modal)
- **Lock approved**: make all APPROVED records immutable for audit sign-off (with confirmation modal; irreversible)

### Review queue UX

- Filter by status, source type, and GHG scope simultaneously
- URL parameter sync: clicking "Review flagged first" on the Dashboard opens Review pre-filtered to `FLAGGED`
- Expandable rows with three tabs:
  - **Anomaly flags** — each flag shows code, human-readable message, and severity (ERROR/WARNING)
  - **Raw data** — the original source file row as a key/value table (e.g. German SAP field names and values exactly as parsed)
  - **Metadata** — source-specific overflow fields (class of service, origin/destination airport, concur estimate, etc.)
- No `alert()` or `confirm()` dialogs — all feedback delivered via toast notifications and proper modal dialogs
- Row colour coding: flagged rows get a subtle amber tint; rejected rows get a red tint

---

## 5. Dashboard

- **Review progress ring**: SVG donut showing `(approved + rejected + locked) / total` percentage, colour-coded by progress level (indigo → amber → green)
- **Six stat cards**: Total, Pending, Flagged, Approved, Rejected, Locked — Pending, Flagged, Approved, Rejected cards are clickable and deep-link to the filtered Review queue
- **GHG Scope breakdown**: horizontal bar charts for Scope 1 / 2 / 3 with percentage labels
- **Source breakdown**: bar charts for SAP / Utility / Travel
- **Recent ingestion runs**: last 5 runs with source icon, file name, date, row count, and flagged count
- **Attention banner**: shown when `pending + flagged > 0`; links directly to flagged records
- Auto-refreshes every 15 seconds

---

## 6. Audit trail

- **Append-only**: every status change, bulk action, and lock creates an `AuditLog` entry — records are never modified or deleted
- Fields captured: user, action type, previous status, new status, notes, timestamp
- **Filterable** by action type (Ingested / Approved / Flagged / Rejected / Locked)
- **Relative timestamps**: "just now", "2h ago", "3d ago" with full datetime on hover
- **Timeline UI**: vertical connector line, colour-coded action icons, status transition pills (`PENDING → APPROVED`)
- Status transitions shown inline: `PENDING → APPROVED`

---

## 7. Data model

See [MODEL.md](MODEL.md) for full detail. Key design decisions:

### Immutable raw record + derived normalised record

Every ingested row produces a `RawRecord` (immutable, stores exact raw_data JSON with original field names) and a `NormalizedRecord` (derived, canonical schema). Raw records are never modified. This preserves the full audit chain: you can always trace a normalised value back to the exact bytes in the source file.

### Dual quantity storage

`NormalizedRecord` stores both the original quantity/unit (e.g. `45.5 GAL`) and the canonical quantity/unit (e.g. `172.24 L`). Auditors can verify the conversion factor and trace back to the source.

### Scope & activity type

Each record carries:
- `scope`: 1, 2, or 3 (GHG Protocol Corporate Standard)
- `scope_category`: human-readable (e.g. "Stationary combustion", "Purchased electricity", "Business air travel")
- `activity_type`: machine code (`FUEL_STAT`, `FUEL_MOB`, `ELEC`, `FLIGHT`, `HOTEL`, `GROUND`, `PROCURE`)

### Review flags as structured JSON

`review_flags` is a `JSONField` containing `[{code, message, severity}]` — not a free-text string. Structured flags allow the UI to colour-code ERROR vs WARNING, count them separately, and display them in a table.

### Composite indexes

```python
models.Index(fields=["tenant", "review_status"])
models.Index(fields=["tenant", "scope", "period_start"])
models.Index(fields=["tenant", "site_code", "activity_type", "period_start"])
models.Index(fields=["tenant", "is_locked"])
```

---

## 8. API

All endpoints require `Authorization: Bearer <access_token>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/token/` | Obtain JWT (username + password) |
| POST | `/api/token/refresh/` | Refresh access token |
| GET | `/api/me/` | Current user info (username, tenant, is_staff) |
| GET | `/api/stats/` | Dashboard statistics |
| GET | `/api/ingestion-runs/` | List ingestion runs |
| POST | `/api/ingestion-runs/upload/` | Upload a new file (multipart/form-data) |
| POST | `/api/ingestion-runs/load_sample/` | Load pre-built sample data |
| GET | `/api/records/` | List normalised records (filterable, paginated) |
| POST | `/api/records/{id}/approve/` | Approve a record |
| POST | `/api/records/{id}/flag/` | Flag a record for review |
| POST | `/api/records/{id}/reject/` | Reject a record (notes required) |
| POST | `/api/records/bulk_approve/` | Approve all pending records |
| POST | `/api/records/lock_approved/` | Lock all approved records |
| GET | `/api/audit-log/` | Append-only review history |

### Record filters

```
GET /api/records/?review_status=FLAGGED&source_type=SAP_FUEL&scope=1&period_start=2024-01-01
```

Supported params: `review_status`, `source_type`, `scope`, `run_id`, `period_start`, `period_end`, `site_code`, `page`

### Duplicate detection

`POST /api/ingestion-runs/upload/` returns `409 Conflict` with `existing_run_id` if the SHA-256 hash of the uploaded file matches an existing ingestion run for this tenant.

---

## 9. Multi-tenancy & security

- **Row-level tenancy**: every model that holds data has a `tenant` FK; all querysets are filtered by `request.user.tenant` in every view — one tenant cannot see another's data
- **Custom User model**: `AUTH_USER_MODEL = "ingestion.User"` — User has a nullable `tenant` FK (null = platform superadmin with Django admin access)
- **JWT authentication**: SimpleJWT with 8-hour access tokens and 7-day refresh tokens; frontend handles silent refresh automatically
- **Token storage**: localStorage (pragmatic for a prototype; tradeoffs documented in DECISIONS.md)
- **CORS**: configured per-environment via `CORS_ORIGINS` env var
- **Production hardening**: `SECURE_PROXY_SSL_HEADER`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE` enabled when `DEBUG=False`

---

## 10. Infrastructure & deployment

### Render (production)

- Single `render.yaml` Blueprint: one web service + one managed PostgreSQL database
- Build pipeline: `pip install` → `npm ci && npm run build` → copy React dist to `backend/frontend_build/` → `migrate` → `collectstatic` → `create_demo_data`
- Django serves the React SPA via WhiteNoise (`WHITENOISE_ROOT`) for all non-API routes — no separate CDN or static site needed
- `create_demo_data` is idempotent: re-running on redeploy skips already-loaded files via SHA-256 hash check

### Docker Compose (local)

```bash
docker compose up
# Frontend: http://localhost:5173
# Backend:  http://localhost:8000/api/
# Admin:    http://localhost:8000/admin/
```

Three services: `db` (postgres:16-alpine), `backend`, `frontend` (node:20-alpine with Vite dev server and hot reload).

### Database

- **Development**: SQLite (zero-config, file-based)
- **Production**: PostgreSQL 16 via `dj-database-url`; `conn_max_age=600` for connection pooling

### Python version pinning

`backend/runtime.txt` pins `3.11.8` (Render format); `PYTHON_VERSION` env var in `render.yaml` as belt-and-suspenders. Required because `psycopg2-binary` has no prebuilt wheel for Python 3.14.

---

## What was deliberately not built

See [TRADEOFFS.md](TRADEOFFS.md) for the full rationale. In brief:

1. **Emission factor calculation** — converting kWh or litres to CO₂e requires a GHG-Protocol-aligned emission factor database (DEFRA, EPA eGRID, IPCC AR6). Building and maintaining this correctly is a separate product surface; getting it wrong produces worse outputs than not calculating at all.

2. **Real-time API ingestion** — SAP, utility portals, and Concur all have API access modes, but each requires IT engagement, OAuth setup, data access agreements, and production SAP credentials. File upload is the format that actually works across client environments on day one.

3. **Multi-currency FX normalisation** — corporate travel data arrives in USD, GBP, EUR, SGD, JPY, INR. Normalising to a single currency requires a live FX rate API with a defined rate-fixing methodology (spot vs. month-average vs. annual average). The original currency and amount are preserved in the data model for when this is added.

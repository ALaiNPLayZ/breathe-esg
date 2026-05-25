# Data Model

## Overview

The model has four concerns: raw storage, normalisation, workflow, and audit. They are deliberately separated because they have different immutability requirements.

```
Tenant ──┬── User
         ├── PlantLookup
         ├── IngestionRun ── RawRecord ── NormalizedRecord ── AuditLog
         └── (all NormalizedRecords)
```

---

## Entities

### Tenant

One row per client company. Every other entity has a `tenant` FK. Multi-tenancy is row-level — every query in the API layer filters by `request.user.tenant`. This is simpler than schema-per-tenant and sufficient for a prototype at this scale.

**Why not schema-per-tenant?** Complete isolation with no risk of cross-tenant data leaks. But it requires migrations to run per-tenant and makes querying across tenants impossible without a router. For a prototype with one team sharing the database, row-level is the right tradeoff. Django's ORM supports schema routing if we need to promote this later.

### User

Extends `AbstractUser`. Has a nullable `tenant` FK — null means platform superadmin. Analysts belong to a tenant and can only see that tenant's records.

### PlantLookup

SAP plant codes ("1000", "US01", "IN01") are internal identifiers meaningless without context. This table maps `(tenant, plant_code)` → (name, country, facility_type). It is tenant-specific because the same code can refer to different physical sites for different clients. Unique constraint on `(tenant, plant_code)`.

Used during SAP ingestion to populate `site_name` and `country` on NormalizedRecord. If a plant code is not in the table, we flag the record (`UNKNOWN_PLANT`).

### IngestionRun

One row per file upload. Captures provenance: who uploaded, when, what file (by SHA-256 hash), and a summary count. The SHA-256 hash prevents the same file being ingested twice — a common mistake when sustainability teams re-export the same period.

`row_count_*` fields are denormalised summaries — they avoid a COUNT query every time someone views the ingestion history.

### RawRecord

**Immutable.** One row per row of source data. `raw_data` is a JSONField containing the exact field names and values from the source file, before any transformation. `parse_errors` records what went wrong if parsing failed.

This table is the permanent audit evidence. If we need to re-run normalisation (e.g. we update unit conversion factors or our scope classifier), we can re-derive NormalizedRecord from RawRecord without requiring the client to re-upload the file. The RawRecord never changes.

`parse_status` distinguishes:
- `OK` — parsed cleanly
- `WARNING` — parsed but with issues (e.g. unknown unit, distance missing)
- `ERROR` — could not be parsed; no NormalizedRecord is created

### NormalizedRecord

The canonical form of one activity data point. The critical design choices:

#### 1. Both original and normalised quantities

```
quantity          / unit           – original values from source, never modified
quantity_normalized / unit_normalized – converted to canonical unit
```

Canonical units: **L** (liquid fuel), **kg** (mass), **kWh** (energy), **km** (distance), **nights** (hotel).

We never lose the source value. When an auditor asks "this says 48,230 kWh — why does your report say 48,230?", we can show them the source row and confirm the values match. When the source says "2,800 GAL" and we store "10,598.15 L", we can show both.

#### 2. Scope classification

Following GHG Protocol Corporate Standard:

| scope | scope_category | activity_type | Triggered by |
|-------|---------------|---------------|-------------|
| 1 | 1.1 Stationary Combustion | FUEL_STAT | SAP fuel materials on-site |
| 1 | 1.2 Mobile Combustion | FUEL_MOB | SAP fuel materials with vehicle keywords |
| 2 | 2.1 Purchased Electricity | ELEC | Utility CSV |
| 3 | 3.1 Purchased Goods & Services | PROCURE | SAP non-fuel materials |
| 3 | 3.6 Business Travel – Air | FLIGHT | Travel: Air expense type |
| 3 | 3.6 Business Travel – Hotel | HOTEL | Travel: Hotel expense type |
| 3 | 3.6 Business Travel – Ground Transport | GROUND | Travel: Taxi/Rail/Car expense type |

`scope_category` is a string, not an enum, because the GHG Protocol adds sub-categories over time and we don't want a schema migration for each one.

#### 3. Source-of-truth tracking

`raw_record` is a OneToOne FK to RawRecord. It answers: which source row produced this record, when, from which file.

`ingestion_run` FK: which upload event.

`tenant` FK: which client.

Together these form a complete chain: `Tenant → IngestionRun → RawRecord → NormalizedRecord`.

#### 4. Review workflow

```
PENDING → APPROVED   (analyst approves — anomalies checked, looks good)
PENDING → FLAGGED    (system auto-flags on ERROR anomaly; analyst can also flag manually)
PENDING → REJECTED   (analyst rejects — won't be included in emissions report)
FLAGGED → APPROVED   (analyst reviews the flags and accepts the record with a note)
FLAGGED → REJECTED
APPROVED → LOCKED    (bulk lock before sending to auditors — irreversible)
```

`is_locked = True` makes the record immutable. The API refuses modifications to locked records. Rejected records are terminal — if the source data was wrong, the client re-exports and re-ingests.

#### 5. metadata JSONField

Source-specific fields that don't fit the canonical schema are preserved here. SAP provides document type and movement type. Concur provides class of service and the platform's own carbon estimate. We don't discard these — they're needed if we ever implement emission factor calculation.

The tradeoff: fields in JSONField aren't indexed and can't be efficiently filtered. For anything we need to filter or aggregate on, it goes in a proper column.

#### 6. Indexes

```python
Index(fields=['tenant', 'review_status'])         # review queue filter
Index(fields=['tenant', 'scope', 'period_start'])  # scope × period aggregation
Index(fields=['tenant', 'site_code', 'activity_type', 'period_start'])  # duplicate detection
Index(fields=['tenant', 'is_locked'])              # audit lock queries
```

### AuditLog

Append-only. Every state change writes a row: user, timestamp, action, before/after status, optional notes. Records are never deleted. The `previous_status` + `new_status` fields make the trail self-contained — an auditor can reconstruct the full review history of any record without needing to join to NormalizedRecord.

---

## ER Diagram (text)

```
Tenant (1) ─────────────── (*) User
   │                           │
   │ (1)                    created/reviewed
   │                           │
   │─── (*) IngestionRun (1)──(*) RawRecord (1)──(0..1) NormalizedRecord (*)──AuditLog
   │              │                                    │
   └── (*) PlantLookup        site_code lookup         └── reviewed_by, locked_by ──> User
```

---

## Unit normalisation table

| Source unit | Canonical unit | Factor |
|-------------|---------------|--------|
| L, LT, LTR  | L | 1 |
| GAL (US)    | L | 3.785411784 (NIST exact) |
| M3          | L | 1000 |
| KG          | kg | 1 |
| T, TO, MT   | kg | 1000 |
| LB          | kg | 0.45359237 (exact) |
| KWH         | kWh | 1 |
| MWH         | kWh | 1000 |
| GJ          | kWh | 277.778 |
| MJ          | kWh | 0.27778 |
| BTU         | kWh | 0.00029307 |
| MMBTU       | kWh | 293.071 |
| KM          | km | 1 |
| MI          | km | 1.609344 (exact) |
| NM (nautical) | km | 1.852 (exact) |
| NIGHTS      | nights | 1 |

Factors sourced from NIST (mass/length) and IEA/GHG Protocol appendices (energy).

---

## What this model does NOT include (by design)

1. **Emission factors.** We store activity data (litres of diesel, kWh of electricity, km of flight distance). Multiplying by emission factors requires a database of GHG-Protocol-aligned factors (IPCC, IEA, GreenHouse Gas Protocol cross-sector tools) that changes annually and is country/fuel/grid-specific. This is a deliberate omission — see TRADEOFFS.md.

2. **FX normalisation.** Financial amounts are stored in original currency. Currency normalisation requires a live FX rate feed or a historical rates database. Not needed for the carbon calculation path; the cost data is supplementary. Noted in TRADEOFFS.md.

3. **Real-time data feeds.** All ingestion is file-upload based. SAP OData/RFC, utility APIs, and Concur OAuth integration are real-world next steps. See DECISIONS.md and TRADEOFFS.md for why file upload is the right prototype choice.

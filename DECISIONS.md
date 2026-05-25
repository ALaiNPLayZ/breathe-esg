# Decisions

Every ambiguity I resolved, the choice I made, why, and what I'd ask the PM.

---

## 1. SAP export format: tab-delimited flat file (not IDoc, not OData, not BAPI)

**Chose:** Tab-delimited flat file, modelled on the ALV grid export from SAP transaction MB51 (Material Documents List).

**Why:** This is what enterprise finance and sustainability teams actually produce when asked "can you pull the fuel data?". The workflow is: sustainability consultant asks the SAP administrator to run a custom ABAP report (or uses a standard SAP transaction), exports it to Excel, saves it as tab-delimited. It requires no middleware, no IT project, no RFC connectivity.

- **IDoc** would be correct for a real production integration, but it requires ALE/EDI configuration, a receiver port, and middleware (SAP PI/PO or iPaaS). No enterprise client will set this up in the first week of onboarding.
- **OData V4** is the modern SAP API, but requires S/4HANA 1909+ and an IT team willing to set up an OData service. Most enterprise clients still run ECC 6.0.
- **BAPI calls** require RFC connectivity and a technical consultant. Not feasible without actual SAP access.

**Justification for the format choices:**
- German column headers (`Buchungsdatum`, `Menge`, `Werk`) because European SAP instances default to German — many sustainability teams in the US/India receive German-header exports because the SAP language is configured at the system level, not by the report user.
- German decimal format (`1.234,56`) because that's what SAP exports in DE locale. I handled both formats in the parser.
- Windows-1252 encoding because SAP's standard ALV export uses the system code page, which on European servers is typically Windows-1252, not UTF-8.
- Movement type filtering: I only ingest movement types 201 (GI for cost centre) and 261 (GI for production order) as consumption records. Movement type 311 (stock transfer) is not consumption and should not appear in emissions. The parser flags out-of-scope movement types as WARNING rather than ERROR.

**What subset I'm handling:** Goods issues (consumption) and goods receipts for fuel and procurement materials. Not handling financial documents (FI), asset accounting (AM), payroll (HR), or SD/MM processes beyond inventory movements.

**What I'd ask the PM:**
- Which SAP transactions does the client actually use? Is it MB51 (material documents), ME2M (purchase orders), or a custom ABAP report?
- Do they have S/4HANA or ECC? The column structure differs.
- Is the fuel consumption recorded at the plant level (Werk) or at the cost centre level (Kostenstelle)? If cost centre is always populated, we could use it as the primary site identifier instead of plant.
- Are plant codes stable across fiscal years, or do they get reassigned?

---

## 2. Utility data: Green Button Alliance CSV (not PDF bills, not direct API)

**Chose:** CSV export modelled on the Green Button Alliance standard (NAESB REQ.21 ESPI).

**Why:** Green Button is adopted by 60+ US utilities (PG&E, ConEd, Eversource, ComEd, Duke, etc.) and is the DOE/NIST-endorsed standard for utility data portability. When a facilities team logs into their utility portal and hits "Download data", they get either a Green Button CSV or an ESPI XML stream. I chose CSV over XML for simplicity — same data, less parsing complexity.

- **PDF bills:** Every utility formats PDFs differently. PDF parsing requires layout-specific heuristics that break on every format change. Not appropriate for a multi-utility deployment.
- **Direct utility API:** Fragmented. The US has 3,300+ electric utilities. Each has a different API (if any). National Grid's API is different from PG&E's API. The Green Button Connect My Data protocol exists but requires per-utility OAuth setup and a Data Custodian agreement.
- **Manual entry:** Too error-prone for audit purposes.

**Key real-world handling:**
- **Billing periods don't align with calendar months.** I store `period_start` and `period_end` exactly as given. A meter read on Feb 15 and billed through Mar 14 is not a February bill — it's a 28-day billing period that crosses two calendar months. Aggregation to calendar months or fiscal quarters happens at the reporting layer, not here.
- **Mixed units (kWh vs MWh).** The parser checks for both. Rotterdam's warehouse meter reports in MWh; the parser detected this (the Meter ID MTR-RTM-W2 record has value 2.8 MWh) and normalized to kWh (2,800 kWh).
- **Overlapping billing periods.** The sample data contains a deliberate overlap for MTR-HAM-A1 (records from Jan 15 and Jan 28 both cover overlapping periods). This triggers `PERIOD_OVERLAP` flag. In practice this happens when a utility issues a corrected bill mid-cycle.

**What I'd ask the PM:**
- US utilities only, or international? (Green Button is US-centric; UK has MPAN identifiers and half-hourly settlement data; EU has different standards.)
- Does the client have electricity in multiple countries? Grid emission factors vary enormously — 0.085 kgCO2e/kWh in France (nuclear-heavy) vs 0.45 in Germany vs 0.82 in Poland.
- Do they have gas, steam, or district heating on the same utility portal, or only electricity?
- Are they on time-of-use tariffs? If so, do we need to track on-peak vs off-peak usage separately?

---

## 3. Corporate travel: Concur Analytics CSV export (not Navan API, not manual)

**Chose:** CSV export modelled on the SAP Concur Analytics standard expense report.

**Why:** Concur holds roughly 95% of enterprise travel management market share. Every enterprise Concur customer can export an Analytics report without IT involvement — the sustainability team runs the report directly. The column structure is well-documented in Concur's public developer documentation.

- **Navan API:** Navan (formerly TripActions) is the challenger platform with a good API. But Navan has ~5% market share. The client is more likely to be on Concur.
- **Concur API (TripIt/Itinerary API):** Requires OAuth app registration with Concur and an enterprise developer agreement. Not a week-one task.
- **Manual:** Error-prone, no clear format standard.

**Key real-world handling:**
- **Missing flight distances.** Concur reports flight legs by origin/destination city or IATA airport code, but does not always provide distance. My parser stores the transaction amount as a proxy quantity and flags the record with "Distance not provided — must be derived from airport codes." The GHG Protocol's "distance-based method" for flights requires great-circle distance × class-of-service factor. Deriving distance from IATA codes requires an airport database (OpenFlights, OurAirports, IATA reference data). I deferred this — see TRADEOFFS.md.
- **Multiple currencies.** The travel sample has USD, GBP, EUR, SGD, JPY, INR across different trips. I store the original currency and amount. FX normalization requires either a live API (Open Exchange Rates, Xe) or a historical rate table. Deferred — see TRADEOFFS.md.
- **Class of service.** Stored in `metadata.class_of_service`. A Business class flight emits roughly 3× more per km than Economy (UK DESNZ emission factors; ICAO method uses an uplift factor of 1.26 for Business vs 0.99 for Economy). We capture this for when emission factors are implemented.
- **Hotel nights.** The GHG Protocol Category 6 guidance treats hotel stays as activity data in "room nights." We store `quantity = nights` and `unit = nights`. Emission factors for hotels vary by country and hotel star rating.

**What I'd ask the PM:**
- Is the client on Concur or another platform? (Amex GBT, BCD, CWT, Navan?)
- Do they want personal vehicle mileage claims included? (Different emission factor — combustion in personal vehicle vs. company fleet.)
- Should rail and ferry be in scope for Scope 3 Category 6? (Yes per GHG Protocol, but the question is whether the client's travel platform captures it.)
- Do they want the comparison between Concur's own carbon estimate and ours? (Concur uses its own emission factors, which are not always GHG-Protocol-compliant. Flagging the discrepancy is valuable for auditors.)

---

## 4. All sources use file upload (not API polling)

**Chose:** File upload for all three sources.

**Why:** This is the correct first step for enterprise onboarding, not a shortcut.

1. **SAP requires middleware.** Real-time SAP ingestion needs an RFC connection, a BTP integration suite or iPaaS (Dell Boomi, Workato, MuleSoft), and a SAP Basis administrator to set up the RFC destination. This is a 4–8 week IT project, not a prototype feature.

2. **Utility APIs are fragmented.** There is no unified utility API in the US or internationally. Per-utility API setup (when they offer one) requires utility-specific OAuth registration and a Data Custodian agreement under Green Button Connect.

3. **File drop is what actually happens in practice.** Sustainability teams export data manually, review it before sending (important for compliance), and then drop it to their sustainability consultant via email or SFTP. A file upload UI with clear format expectations is what clients will actually use in the first month of onboarding.

The production roadmap from file upload is: SFTP/email drop → auto-import on file arrival → API polling. File upload is not a dead end, it's step one.

---

## 5. Multi-tenancy: row-level, not schema-per-tenant

**Chose:** Row-level tenancy — every record has a `tenant` FK, all queries filter by `request.user.tenant`.

**Why:** Schema-per-tenant (one PostgreSQL schema per client) provides complete isolation with zero risk of cross-tenant data leaks. But it requires migrations to run per-schema, makes cross-tenant analytics impossible without a federation layer, and adds significant operational complexity (backup, restore, schema routing). For a prototype with a small number of tenants, row-level isolation is adequate and much simpler to operate.

**Risk:** A bug in a view or serializer could expose cross-tenant data if the tenant filter is accidentally omitted. I mitigate this by filtering in `get_queryset()` on every viewset, not in individual actions. In production, a custom Django queryset mixin would enforce this at the ORM level.

**What I'd ask the PM:** How many tenants? If it's 10–50, row-level is fine. If it's 10,000+ with strict legal data residency requirements, schema-per-tenant or a separate database per tenant is the right path.

---

## 6. JWT in localStorage (not httpOnly cookies)

**Chose:** JWT access token in localStorage, refresh token in localStorage.

**Why:** This prototype serves the React frontend from the same Django origin in production. HttpOnly cookies would be the secure production choice (not accessible to JavaScript, immune to XSS token theft). I chose localStorage for development simplicity — no CSRF token required, works across origins in development.

**Tradeoff:** LocalStorage is accessible to JavaScript, making tokens vulnerable to XSS attacks. For a production system handling audit data, I would use httpOnly cookies with SameSite=Strict and a short access token lifetime.

---

## 7. SQLite in development, PostgreSQL in production

**Chose:** SQLite via `dj_database_url` with PostgreSQL for Render deployment.

**Why:** SQLite removes the local PostgreSQL setup step for onboarding. The ORM abstracts the difference for all queries we use. The only limitation is concurrent write performance, which doesn't matter for a single-developer prototype.

**Risk:** SQLite and PostgreSQL handle `DecimalField` precision, JSONField operators, and `DISTINCT ON` differently. Tests should run against PostgreSQL in CI. For now, the migration to production PostgreSQL is handled by Render's managed database.

---

## 8. Scope classification: keyword matching on material description

**Chose:** Keyword matching on `material_desc + material_no` to classify SAP records into Scope 1 fuel / Scope 2 electricity / Scope 3 procurement.

**Why:** SAP does not have a standard field for "this material is a fuel." Material classification depends on the client's material master data, which varies by industry and SAP configuration. Keyword matching on the material description is a reasonable starting point — "Diesel Kraftstoff", "Erdgas", "Heizöl" are unambiguous.

**What would break in production:** A client that abbreviates material descriptions ("DK" for Diesel Kraftstoff) or uses material numbers without descriptions would produce many Scope 3 misclassifications. The right production solution is a client-maintained material classification table: `(tenant, material_no) → (scope, activity_type)`. This is noted in TRADEOFFS.md.

**What I'd ask the PM:** Can the client provide a list of material numbers they want to track for carbon purposes? This would give us precise scope classification instead of keyword guessing.

---

## 9. Anomaly detection thresholds

**Chose:**
- Year-over-year change threshold: **50%** for flagging
- Overlap check: exact period overlap for meters (strict)
- Duplicate check: exact (site_code, activity_type, period_start, period_end) match against approved records

**Why 50%?** Seasonal variation in electricity and fuel consumption is typically 20–40% (winter heating vs summer cooling). 50% catches genuine data errors while avoiding false positives for seasonal variation. Travel data is more volatile — a flagged record there is more likely to be legitimate, and the analyst can acknowledge the flag with a note.

**What I'd ask the PM:** Are there sites with known high variance (e.g., a factory that runs seasonal campaigns)? We could set per-site thresholds or allow the analyst to mark a flag as "acknowledged — expected variation."

# Tradeoffs

Three things I deliberately did not build, and why.

---

## 1. Emission factor calculation

**What it would be:** Multiplying normalised activity data (litres of diesel, kWh of electricity, passenger-km of flight) by the appropriate emission factor (kgCO2e per unit) to produce a carbon estimate for each record.

**Why I didn't build it:**

Emission factors are not static numbers I can hard-code. They are:

- **Fuel-specific.** The IPCC AR6 / GHG Protocol emission factors for diesel are different from petrol, from natural gas, from LPG, from jet fuel. They're also version-specific — the GHG Protocol regularly updates its guidance, and historical reports need to use the factor that was current at the time.

- **Grid-specific for electricity.** A kWh of electricity purchased in Germany (2024 grid factor: ~0.380 kgCO2e/kWh) is different from France (~0.085, nuclear-heavy), Poland (~0.820, coal-heavy), or Texas (~0.430). Location-based vs. market-based methods give different answers, and market-based requires RECs/GOs (Renewable Energy Certificates / Guarantees of Origin).

- **Country and class-specific for travel.** The GHG Protocol's Category 6 guidance uses IATA distance-based factors that vary by flight class (Economy/Business/First), aircraft type (widebody vs. narrowbody), and route. A Business class long-haul flight has roughly 3× the per-km emissions of the same flight in Economy.

- **Version-controlled.** Audit-grade carbon calculations need to be reproducible. If we calculate today's figure using 2024 IPCC factors, and the client re-runs the report in 2026 using updated 2025 factors, they should get different answers and know why.

The right implementation is a separate emission factor database (probably its own service) with versioned factor sets, country/fuel/grid lookup, and an API that NormalizedRecord queries when producing a report. That's a meaningful standalone feature.

**What I built instead:** NormalizedRecord stores the normalised activity quantity (e.g., 10,598 L of diesel) alongside the scope classification. When the emission factor database exists, the carbon calculation is `quantity_normalized × lookup(activity_type, country, fuel_type, period)`. The model is designed to receive this without schema changes.

---

## 2. Real-time API ingestion from SAP, utilities, and travel platforms

**What it would be:** Polling SAP via OData/RFC, pulling utility data via Green Button Connect My Data API, pulling Concur data via the Concur Travel API — all on a scheduled basis, without human file uploads.

**Why I didn't build it:**

**SAP OData/RFC:** Requires a SAP Basis administrator to configure an RFC destination, an SAP Business Technology Platform (BTP) account for OData exposure (or an SAP PI/PO middleware), and IT engagement on the client side. This is a 4–8 week IT project per client. It also requires us to handle SAP's authentication (SAML, OAuth 2.0 via BTP, or RFC system credentials), change detection (delta tokens in OData, or document number ranges), and error recovery when the connection is lost. None of this is prototype work.

**Utility APIs:** The US alone has 3,300+ electric utilities. Green Button Connect (GBC) is the attempt at a standard, but adoption is inconsistent. Utilities that do support GBC require per-utility OAuth registration and a Data Custodian agreement (a formal legal agreement). Each utility has different rate limits, different data availability windows, and different error codes. Building this properly is 3+ months of integration work.

**Concur Travel API:** Requires an enterprise developer agreement with SAP Concur, OAuth 2.0 client credentials, and rate limit management. Concur's API returns data in a proprietary XML format (Expense Reports API v3.0). It's feasible but not a prototype task.

**What I built instead:** File upload, with a clear format specification for each source. The upload UI tells the user exactly what format to export and what columns are expected. This is what actually happens in the first 3–6 months of enterprise onboarding. The architecture is designed to accommodate scheduled API ingestion later — `IngestionRun` has no UI-specific fields; a background task can create one exactly the same way an upload endpoint does.

---

## 3. Multi-currency financial normalisation

**What it would be:** Converting all financial amounts to a base currency (USD or EUR) at the exchange rate prevailing on the transaction date, so cost-per-tonne-CO2e calculations are comparable across geographies.

**Why I didn't build it:**

The travel sample alone has transactions in USD, GBP, EUR, SGD, JPY, and INR across 30 records. Getting a historically-accurate exchange rate for each transaction date requires either a historical FX API (Open Exchange Rates, Currencystack, Xe) or a locally-maintained rates table. Both add an external dependency and recurring cost (most historical rate APIs are paid tiers).

More importantly, carbon accounting does not depend on currency normalisation. The `quantity` and `quantity_normalized` fields are the inputs to emission calculations — they are in physical units (litres, kWh, km), not financial units. Financial amounts are supplementary context (useful for cost-per-tonne analysis and for reconciling against ERP spend data) but not required for the core workflow.

**What I built instead:** Financial amounts are stored verbatim in `amount` + `currency` (ISO 4217). The model supports adding `amount_usd` and `fx_rate` columns later without breaking the existing schema or any existing records. The API returns the original currency and amount, and the UI displays it as-is. A PM or analyst can see "GBP 1,284" and know what it means without FX conversion.

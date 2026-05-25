# Sources

For each data source: what real-world format I researched, what I learned, what my sample data looks like and why, and what would break in a real deployment.

---

## 1. SAP – Fuel & Procurement

### What I researched

SAP's data extraction landscape has four realistic options:

**IDoc (Intermediate Document):** SAP's proprietary electronic data interchange format. IDocs are XML-like structured documents used for system-to-system integration. A fuel consumption IDoc would be a MATMAS (material master) or MBGMCR (goods movement) IDoc type. IDocs require ALE (Application Link Enabling) configuration, a partner profile, and a message type setup by the SAP Basis team. The format has `EDI_DC40` control records and `E1` segment records with positional fields. This is the right format for automated SAP-to-SAP or SAP-to-iPaaS integration — not for a first-month data pull.

**OData V2/V4:** SAP Gateway exposes standard OData services for many business objects. For materials and goods movements, the relevant OData API is the MM (Materials Management) API in SAP S/4HANA Cloud (`API_MATERIAL_DOCUMENT_SRV`). This returns JSON with fields like `MaterialDocumentYear`, `MaterialDocumentItem`, `Plant`, `StorageLocation`, `BaseUnit`, `QuantityInBaseUnit`. Requires S/4HANA 1809+ and a developer OAuth client registered via SAP BTP.

**BAPI (Business Application Programming Interface):** SAP function modules callable via RFC. `BAPI_MATERIAL_GETLIST` returns material master data; `BAPI_GOODSMVT_GETITEMS` returns goods movement items. Requires an RFC connection (configured in SM59 in SAP) and a user with RFC authorization. Not feasible without real SAP access.

**ALV Grid flat file export:** What I chose. When a SAP user is in any list transaction (MB51, ME2M, ME80FN, etc.) and the result is displayed in an ALV (ABAP List Viewer) grid, they can export it to local file: Spreadsheet → Unconverted (produces tab-delimited text) or Spreadsheet (produces Excel). The tab-delimited export preserves the exact column headers from the ALV grid, which default to the DDIC field descriptions in the system language.

### What I learned

- SAP MB51 (Material Documents List) shows goods movements. It's the standard transaction sustainability teams use to pull fuel consumption.
- The column names in a German-language SAP system: `Buchungsdatum` (Posting Date), `Werk` (Plant), `Material` (Material Number), `Materialkurztext` (Material Short Text), `Menge` (Quantity), `ME` (Unit of Measure, using SAP internal codes), `Wert in HW` (Value in Local Currency), `HWährung` (Local Currency), `Kostenstelle` (Cost Center), `Bewegungsart` (Movement Type).
- SAP unit codes are not ISO units. `TO` is metric tonne, `GAL` is US gallon, `M3` is cubic metre. I mapped these in the parser.
- German number format: `1.500,000` means 1,500.000 (period = thousands separator, comma = decimal point). The parser handles both German and Anglo-Saxon decimal formats.
- Movement type 201 = Goods Issue for Cost Centre (most common for direct fuel consumption). Movement type 261 = Goods Issue for Production Order (fuel used in manufacturing). Movement type 101 = Goods Receipt from Purchase Order (inbound, not consumption). I filter and label these appropriately.
- Plant codes are 4 characters, alphanumeric. European SAP systems often use "1000", "2000"; international ones use "US01", "IN01". They're meaningless without a lookup table.

### What my sample data looks like and why

The sample (`sap_export.txt`) covers Q1 2024 across four plants:
- **1000** (Hamburg, Germany): diesel, natural gas, heating oil — a manufacturing plant with on-site combustion
- **2000** (Rotterdam, Netherlands): diesel, natural gas — a distribution centre
- **US01** (Houston, USA): diesel in US gallons (not litres), gasoline — a US processing facility; I deliberately used `GAL` to test unit conversion
- **IN01** (Mumbai, India): HSD (High Speed Diesel, the Indian standard grade), CNG — regional office

Deliberate quirks to test the parser:
- Row 6 (IN01, 31.01.2024): missing `Kostenstelle` (cost centre). Triggers `MISSING_COST_CENTER` flag.
- Row 11 (2000, 20.02.2024): 180,000 L of diesel in one record. This is a real scenario (tanker delivery) but triggers `LARGE_YOY_CHANGE` if there's a comparison period, and looks suspicious otherwise.
- Row 19 (2000, 28.03.2024): zero quantity Erdgas. Triggers `ZERO_VALUE` flag.
- Row 21 (plant 3000, movement 101): Goods receipt with document type RE. A receipt at plant 3000 that has no plant lookup entry — triggers `UNKNOWN_PLANT` flag.
- Row 22: negative quantity (−250 L). A reversal entry. Triggers `NEGATIVE_VALUE` flag.
- Row 16 (US01, BENZIN): uses `GAL`, not `L`. Converted to `3,785.41 L`.
- One record with Kerosin (Jet A-1): aviation fuel for a company aircraft. Scope 1, stationary combustion (aviation fuel is classified as stationary if it's a company-operated aircraft).

### What would break in a real deployment

1. **Material classification.** My keyword matching on `Materialkurztext` works for the sample but fails for abbreviated descriptions ("DK", "EGAS"), material codes without descriptions, or clients with custom material types for fuel blends. The production solution is a client-maintained material classification table.

2. **Plant code lookup.** Plant codes 3000 and any plant not in the lookup table produce `UNKNOWN_PLANT` flags. A client with 200 plants needs to upload their full plant master (MD01 or MM60 export) before the first ingestion.

3. **Cost centre hierarchy.** SAP cost centres come in hierarchy trees (CC-PROD-01 is under CC-PROD, under the legal entity). We store `cost_center` as a flat string. Proper hierarchical aggregation needs the cost centre hierarchy, exported from SAP transaction KS03 or via the hierarchy API.

4. **Reversals.** Movement type 262 is a reversal of 261. My parser skips 262, which means reversals are not processed. In practice, a reversal + re-posting in the same period should cancel out. If the reversal and the corrected posting span different periods, emissions in the first period are overstated. A production system needs to match reversals to their originating documents.

5. **Multi-currency.** The Hamburg plant posts in EUR; Houston posts in USD; Mumbai posts in INR. We store the original currency. Cross-plant reporting requires FX normalisation.

---

## 2. Utility – Electricity

### What I researched

**Green Button Alliance:** A US Department of Energy initiative launched in 2012, now adopted by 60+ utilities serving 60M+ customers. Two variants:
- **Green Button Download My Data (DMD):** Customer logs into the utility portal and downloads their data as an XML file (ESPI/NAESB REQ.21 format) or CSV. This is what I modelled.
- **Green Button Connect My Data (CMD):** Real-time API connection where the utility pushes data to authorised third parties. Requires per-utility Data Custodian agreement and OAuth 2.0.

**ESPI XML format:** The Energy Service Provider Interface XML stream has `UsagePoint` elements containing `IntervalBlock` and `IntervalReading` elements with timestamps and values in Wh (watt-hours, not kWh). For billing data, `ReadingType` specifies the unit. The XML is verbose and consistent — I chose CSV because portal CSV exports are what facilities teams actually download.

**Utility portal CSV exports:** Not strictly standardised, but most utilities that participate in Green Button produce CSVs with columns close to what I modelled: account, meter, billing period dates, usage (kWh), peak demand (kW), cost. I researched PG&E, ConEd, and Eversource portal downloads — they all have this structure, with minor column name variations.

**EU:** Outside scope for this prototype. European utilities use MPAN (Meter Point Administration Number) in the UK, EAN (European Article Number) for metering points in continental Europe, and EDIEL/MSCONS formats for half-hourly settlement data. These are significantly different from Green Button.

### What I learned

- **Billing periods.** The most important real-world detail: billing cycles are based on meter read dates, not calendar months. A meter read on January 15 and the next read on February 13 gives a 29-day billing period. This creates a misalignment problem for monthly reporting — do you attribute the Jan 15 – Feb 13 bill to January or February? We store exact `period_start` and `period_end` and let the reporting layer decide.

- **Units.** Small commercial meters report in kWh. Large industrial meters often report in MWh (because kWh values become 7+ digit numbers). The Green Button standard uses Wh (watt-hours) as the base unit; CSV exports usually convert to kWh or MWh. My parser handles both.

- **Peak demand.** Many commercial tariffs charge partly on peak demand (kW), not just consumption (kWh). The peak demand charge doesn't affect the energy quantity but affects the cost calculation. I store it in `metadata.peak_demand_kw`.

- **Rate schedules.** Large commercial customers are on time-of-use (TOU) tariffs: different prices for on-peak (weekdays 3–9 PM) and off-peak hours. Rate schedule names vary by utility: "TOU-GS-3D" (PG&E), "C&I-TOU-HT" (generic). These affect cost but not the kWh quantity.

- **Corrected bills.** Utilities sometimes issue corrected bills for a previous period, either adding a credit or a charge. This can create two records for the same meter and period — the original bill and the correction. My `PERIOD_OVERLAP` flag catches this.

### What my sample data looks like and why

The sample (`utility_electricity.csv`) covers three accounts across Acme's facilities:
- **ACC-HAM-001** (Hamburg): three meters — Halle 1 (87,420 kWh), Halle 2 (54,230 kWh), Verwaltung/office (12,840 kWh). Billing cycles start Jan 15 for Halle meters, Jan 17 for office meter — deliberately different to show period misalignment.
- **ACC-RTM-002** (Rotterdam): two meters — warehouse (143,500 kWh) and refrigerated warehouse. The refrigerated warehouse meter **MTR-RTM-W2** reports in MWh (2.8 MWh = 2,800 kWh) — deliberately using MWh to test unit detection.
- **ACC-HOU-003** (Houston): main building (234,670 kWh) and EV charging station on a separate meter and rate schedule.

Deliberate quirks:
- MTR-HAM-A1 has **two overlapping billing periods** (Jan 15–Feb 13 and Jan 28–Feb 27). This simulates a corrected bill and triggers `PERIOD_OVERLAP`.
- MTR-RTM-W2 uses MWh not kWh.
- Billing periods span month boundaries throughout (none align with the 1st–31st).

### What would break in a real deployment

1. **Non-US utilities.** Green Button is US-specific. UK, EU, and Asia-Pacific utilities use different formats and standards. International clients need per-region parsers.

2. **Multiple accounts per site.** A large facility might have 50 meters across 5 utility accounts. The sample has 3 accounts — a real enterprise client might have 500. Meter IDs need to be linked to physical locations (rooms, buildings, floors) via a site registry.

3. **Estimated vs. actual reads.** Utilities sometimes estimate meter reads (marked with an "E" in the data) when physical access isn't possible. Estimated reads can differ significantly from actuals; the next bill has an adjustment. We don't distinguish estimated from actual reads.

4. **Solar/generation exports.** Buildings with rooftop solar export excess generation back to the grid. Some utility exports include negative consumption (net metering). We don't handle negative electricity quantities specially (the `NEGATIVE_VALUE` flag would trigger, which is correct — it needs analyst attention).

5. **Natural gas meters.** Many utility portals show gas usage on the same portal as electricity. Gas is Scope 1, not Scope 2. My utility parser only handles electricity. Gas on the utility portal needs separate handling (different units — therms, CCF, Mcf — and different scope classification).

---

## 3. Corporate Travel – Flights, Hotels, Ground Transport

### What I researched

**SAP Concur:** Market-dominant enterprise travel management system (~95% corporate market share). The Concur Analytics product allows admins to export expense reports in CSV. The export includes all expense line items from expense reports submitted in a date range.

**Concur Expense API v3.0:** Returns expense reports in XML, with entries including expense type, amount, currency, transaction date, location, and custom fields. Flights may have itinerary data (origin/destination) if linked to a Concur Travel booking, but standalone expense reimbursements often don't.

**Navan (formerly TripActions):** The major Concur challenger. Has a REST API (Navan Reporting API) that returns trip data in JSON. Better API design than Concur's, but requires enterprise agreement.

**GHG Protocol Category 6 guidance:** Business travel should be reported using distance-based or spend-based method. Distance-based is more accurate: distance (km) × emission factor (kgCO2e/km) × class uplift. Emission factors from UK DESNZ (formerly BEIS) or ICAO Carbon Offset Calculator. The spend-based method (cost × $-per-kg factor) is a fallback when distance is unavailable.

**IATA airport codes:** Three-letter IATA codes (JFK, LHR, ORD, CDG) are the standard way travel platforms record origin/destination. They don't directly give distance — you need a lookup table of airport coordinates plus great-circle calculation (Haversine formula).

### What I learned

- **Concur CSV structure.** The Concur Analytics report export includes: Report ID, Employee ID, Employee Name, Department, Business Unit, Expense Type, Transaction Date, Merchant Name, City, Country, Amount, Currency, Reimbursable (Y/N), Payment Type, custom fields, and for travel: Origin, Destination, Class of Service, Distance.

- **Distance is often missing.** Concur populates Distance only when the expense is linked to a Concur Travel booking with an itinerary. When an employee books on Expedia and submits a manual expense, there's no itinerary and no distance. This is very common (>50% of submissions at many companies). My parser flags these with "Distance not provided — must be derived from airport codes."

- **Expense types are inconsistent.** Different companies configure Concur with different expense type names. "Air Travel", "Airfare", "Flight", "Airline" are all common names for the same thing. My parser does case-insensitive partial matching on a keyword list.

- **Multi-leg flights.** An NYC–Paris–Munich trip is two expense rows (JFK→CDG and CDG→MUC). We don't do itinerary reconstruction — each row is its own record. A round-trip is two rows, each with their own emission factor.

- **Hotel emission factors.** The GHG Protocol uses a spend-based method for hotels (lacking standardised physical activity data). Some hotel chains now publish property-level carbon data (Hilton, Marriott, IHG through the Hotel Carbon Measurement Initiative). We store nights and cost, which supports both methods.

### What my sample data looks like and why

The sample (`corporate_travel.csv`) covers Q1 2024 for 6 employees across Operations, Finance, Sales, Engineering, and Procurement departments.

I included:
- **Long-haul international flights** (JFK–LHR, ORD–FRA, SFO–NRT, PVG–LAX) with no distance (only airport codes). All flagged "Distance not provided."
- **One Business class flight** (EMP-2301, ORD–FRA at $4,850 vs $1,920 for the economy return). Business class is captured in `metadata.class_of_service`.
- **Short-haul domestic flight** (IAH–LAX at $389) with distance in miles (1,379 mi = 2,219 km). This one has distance, so it's normalised correctly.
- **Rail** (Frankfurt–Munich, Deutsche Bahn) with distance. Correctly classified as GROUND.
- **Shinkansen** (Tokyo–Osaka, 248 miles) with distance and JPY currency.
- **Rideshare** (Mumbai, in INR) with distance.
- **Hotels** in multiple cities, with correct nights and currencies.
- **Car rental** in Los Angeles with mileage (245 miles).
- **Concur carbon estimates** in a separate column (`Carbon Est (kg CO2)`) — these are Concur's own estimates which may differ from GHG-Protocol-compliant calculations. Stored in `metadata.concur_carbon_kg` for comparison.

Deliberate quirks:
- Concur's estimate for EMP-1042's Business class CDG flights (2,104.8 kg × 2) vs the actual DESNZ factor for JFK–CDG Business (approximately 1,380 km per leg × 0.251 kgCO2e/km Business = 346 kg per leg) — a significant discrepancy, showing why Concur's estimates shouldn't be taken at face value.
- Hotel record for EMP-5521 in JPY (¥95,400) — large-looking number in JPY is modest in USD, which tests that the analyst doesn't accidentally flag it as suspicious based on face value.

### What would break in a real deployment

1. **No distance for flights.** The majority of real-world Concur exports have no distance for flights. Every flight record becomes a "cost proxy" record that can't support the GHG Protocol distance-based method. You need either an IATA airport coordinate database + Haversine calculation, or a partnership with a flight-distance API (OAG, Cirium, IATA's API).

2. **Currency normalisation.** USD, GBP, EUR, SGD, JPY, INR in one export. Without FX rates at the transaction date, cost-based comparisons across geographies are meaningless.

3. **Concur's own carbon estimates.** Concur includes `carbonEmission` in its API response and exports. These estimates use Concur's own factors, not GHG-Protocol-compliant factors. If a client has previously reported using Concur's figures and now switches to ours, there will be restatement questions from auditors.

4. **Personal vehicle mileage.** Many travel expense reports include personal vehicle mileage claims (employee reimbursed at IRS rate, e.g. $0.67/mile). These are Scope 3 Category 6 (if using the expense-based method) but the emission factor is different from car rental. My parser would classify these as GROUND but wouldn't distinguish.

5. **Booking vs. actual travel.** Concur expense reports reflect what was paid for. A flight booked but not taken (refunded) might still appear in the export if the refund is in a different period. Expense reports are the financial record, not the travel record — they can be amended and resubmitted, creating versioning issues.

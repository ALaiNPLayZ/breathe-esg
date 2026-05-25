"""
Parsers for the three supported data sources.

SAP_FUEL:    Tab-delimited flat file, modelled on the ALV grid export from
             SAP transaction MB51 (Material Documents). This is what enterprise
             finance/sustainability teams actually produce when asked to pull
             fuel and procurement data — a custom ABAP report saved as
             tab-delimited text. Encoding is typically Windows-1252 (not UTF-8).
             German column headers in some configs. German decimal format.

UTILITY_ELEC: CSV export modelled on the Green Button Alliance standard
              (NAESB REQ.21 ESPI). Adopted by 60+ US utilities including PG&E,
              ConEd, ComEd. Captures billing periods (which don't align with
              calendar months), interval data, and meter metadata. Units may
              vary by meter (kWh vs MWh).

CORP_TRAVEL:  CSV export modelled on the Concur Analytics standard expense
              report. Concur holds ~95% of enterprise travel-management market.
              The analytics CSV export is available to all customers without
              IT involvement. Contains flights (with airport codes, rarely
              distances), hotels (nights), and ground transport.
"""

import csv
import io
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional


# ---------------------------------------------------------------------------
# Shared types
# ---------------------------------------------------------------------------

@dataclass
class ParsedRow:
    row_number: int
    raw_data: dict
    status: str = "OK"          # OK | WARNING | ERROR
    errors: list = field(default_factory=list)
    normalized: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Unit normalizer
# ---------------------------------------------------------------------------
# Canonical units:
#   liquid fuel / volume → L  (litres)
#   mass                 → kg
#   energy               → kWh
#   distance             → km
#   hotel nights         → nights
#
# All conversion factors are exact or from NIST / GHG Protocol appendices.

_UNIT_TABLE: dict[str, tuple[str, Decimal]] = {
    # Volume → L
    "L":      ("L", Decimal("1")),
    "LT":     ("L", Decimal("1")),
    "LTR":    ("L", Decimal("1")),
    "GAL":    ("L", Decimal("3.785411784")),   # US liquid gallon
    "GALN":   ("L", Decimal("3.785411784")),
    "M3":     ("L", Decimal("1000")),          # cubic metre
    "CM3":    ("L", Decimal("0.001")),         # cubic centimetre
    # Mass → kg
    "KG":     ("kg", Decimal("1")),
    "G":      ("kg", Decimal("0.001")),
    "T":      ("kg", Decimal("1000")),         # metric tonne
    "TO":     ("kg", Decimal("1000")),         # SAP internal code for tonne
    "MT":     ("kg", Decimal("1000")),
    "LB":     ("kg", Decimal("0.45359237")),   # avoirdupois pound (exact)
    "LBS":    ("kg", Decimal("0.45359237")),
    "ST":     ("kg", Decimal("907.18474")),    # US short ton
    # Energy → kWh
    "KWH":    ("kWh", Decimal("1")),
    "MWH":    ("kWh", Decimal("1000")),
    "GWH":    ("kWh", Decimal("1000000")),
    "GJ":     ("kWh", Decimal("277.77778")),   # 1 GJ = 1000/3.6 kWh
    "MJ":     ("kWh", Decimal("0.27778")),
    "BTU":    ("kWh", Decimal("0.00029307")),  # British thermal unit (IT)
    "MMBTU":  ("kWh", Decimal("293.07107")),   # 10^6 BTU
    "THERM":  ("kWh", Decimal("29.30711")),    # 1 therm = 100,000 BTU
    # Distance → km
    "KM":     ("km", Decimal("1")),
    "MI":     ("km", Decimal("1.609344")),     # international mile (exact)
    "MILES":  ("km", Decimal("1.609344")),
    "NM":     ("km", Decimal("1.852")),        # nautical mile (exact)
    # Hotel stays
    "NIGHTS": ("nights", Decimal("1")),
    "NIGHT":  ("nights", Decimal("1")),
}


def normalize_unit(quantity: Decimal, unit: str) -> tuple[Decimal, str]:
    """
    Convert (quantity, unit) to canonical unit.
    Returns (normalized_quantity, canonical_unit).
    Raises ValueError for unknown units.
    """
    key = unit.upper().strip()
    if key not in _UNIT_TABLE:
        raise ValueError(f"Unknown unit: {unit!r}")
    canonical, factor = _UNIT_TABLE[key]
    return quantity * factor, canonical


# ---------------------------------------------------------------------------
# Scope / activity classifier for SAP records
# ---------------------------------------------------------------------------

_FUEL_KEYWORDS = frozenset({
    "diesel", "benzin", "petrol", "gasoline", "kraftstoff",
    "erdgas", "natural gas", "naturgas", "heizoel", "heizöl", "heizol",
    "kerosin", "kerosene", "kerosin", "jet fuel", "avgas",
    "propan", "propane", "butan", "butane",
    "fluessiggas", "flüssiggas", "lpg", "lng", "cng",
    "fuel oil", "mazut", "heavy oil",
})

_ELECTRICITY_KEYWORDS = frozenset({
    "elektriz", "electricity", "strom", "elektrisch", "electric", "power",
})

_MOBILE_KEYWORDS = frozenset({
    "fahrzeug", "vehicle", "mobile", "kfz", "pkw", "lkw",
    "truck", "fleet", "car", "auto",
})


def classify_sap_material(
    material_desc: str, material_no: str
) -> tuple[int, str, str]:
    """
    Returns (scope, scope_category, activity_type) for an SAP material.

    Decision logic mirrors GHG Protocol Corporate Standard Chapter 4:
    - Fuel consumed on-site → Scope 1 Stationary
    - Fuel consumed in company vehicles → Scope 1 Mobile
    - Electricity purchased → Scope 2 (though SAP rarely carries this)
    - Everything else → Scope 3 Purchased Goods
    """
    text = (material_desc + " " + material_no).lower()

    if any(kw in text for kw in _ELECTRICITY_KEYWORDS):
        return 2, "2.1 Purchased Electricity", "ELEC"

    if any(kw in text for kw in _FUEL_KEYWORDS):
        if any(kw in text for kw in _MOBILE_KEYWORDS):
            return 1, "1.2 Mobile Combustion", "FUEL_MOB"
        return 1, "1.1 Stationary Combustion", "FUEL_STAT"

    return 3, "3.1 Purchased Goods & Services", "PROCURE"


# ---------------------------------------------------------------------------
# SAP parser
# ---------------------------------------------------------------------------
# Columns from MB51 (Material Documents List) in German and English variants.
# German is more common in European SAP instances; English appears in US/India.

_SAP_HEADER_MAP = {
    # German → internal
    "Buchungsdatum":    "posting_date",
    "Belegjahr":        "doc_year",
    "Belegnummer":      "doc_number",
    "Position":         "item",
    "Belegart":         "doc_type",
    "Werk":             "plant",
    "Lagerort":         "storage_location",
    "Material":         "material_no",
    "Materialkurztext": "material_desc",
    "Menge":            "quantity",
    "ME":               "unit",
    "Wert in HW":       "value_lc",
    "Wert.in.HW":       "value_lc",
    "HWährung":         "currency",
    "HW":               "currency",
    "Kostenstelle":     "cost_center",
    "Bewegungsart":     "movement_type",
    # English → internal
    "Posting Date":     "posting_date",
    "Document Year":    "doc_year",
    "Document Number":  "doc_number",
    "Item":             "item",
    "Document Type":    "doc_type",
    "Plant":            "plant",
    "Storage Location": "storage_location",
    "Material Description": "material_desc",
    "Quantity":         "quantity",
    "Unit":             "unit",
    "Value in LC":      "value_lc",
    "LC":               "currency",
    "Cost Center":      "cost_center",
    "Mvt Type":         "movement_type",
    "Movement Type":    "movement_type",
}

# Movement types that represent consumption (goods issue from stock)
# 201 = GI for cost centre, 261 = GI for production order
# 551 = scrapping, 601 = GI for delivery (internal customer)
_CONSUMPTION_MOVEMENTS = frozenset({"201", "261", "551", "601", "641", "643"})

# Movement types that represent inbound procurement (goods receipt)
# 101 = GR from PO, 501 = receipt without PO
_RECEIPT_MOVEMENTS = frozenset({"101", "501", "521"})


def _parse_german_decimal(s: str) -> Decimal:
    """
    SAP German number format: "1.500,250" → Decimal("1500.250")
    Also handles plain decimal: "1500.250" → Decimal("1500.250")
    """
    s = s.strip().replace(" ", "")
    if not s:
        raise ValueError("Empty quantity field")
    # German format uses period as thousands separator and comma as decimal
    if "," in s and "." in s:
        # Remove thousands separator, convert decimal separator
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        # Only comma — treat as decimal separator (no thousands sep)
        s = s.replace(",", ".")
    return Decimal(s)


def _parse_date(s: str) -> date:
    """Parse dates in DD.MM.YYYY, DD/MM/YYYY, or YYYY-MM-DD format."""
    s = s.strip()
    for fmt in ("%d.%m.%Y", "%d/%m/%Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Cannot parse date: {s!r}")


def parse_sap_file(content: bytes) -> list[ParsedRow]:
    """
    Parse an SAP MB51-style tab-delimited flat file.

    Encoding: tries UTF-8 with BOM first (modern SAP), then Windows-1252
    (classic SAP European export), then ISO-8859-1. SAP never emits UTF-8
    without BOM on older systems.

    Movement type handling: only CONSUMPTION_MOVEMENTS and RECEIPT_MOVEMENTS
    are ingested. Transfer orders, reversals, and statistical movements are
    skipped (flagged as WARNING, not ERROR — they're not wrong, just out of
    scope for carbon accounting).
    """
    text = None
    for encoding in ("utf-8-sig", "windows-1252", "iso-8859-1"):
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError("Cannot decode SAP file — expected UTF-8 or Windows-1252/Latin-1")

    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    rows: list[ParsedRow] = []

    for i, row in enumerate(reader, start=1):
        raw = {k: (v or "") for k, v in row.items()}

        # Map German/English headers to internal names
        mapped: dict[str, str] = {}
        for header, value in raw.items():
            internal = _SAP_HEADER_MAP.get(header.strip())
            mapped[internal if internal else header.strip()] = value.strip()

        parsed = ParsedRow(row_number=i, raw_data=raw)

        # Movement type gate
        movement = mapped.get("movement_type", "").strip()
        if movement and movement not in (_CONSUMPTION_MOVEMENTS | _RECEIPT_MOVEMENTS):
            parsed.status = "WARNING"
            parsed.errors.append(
                f"Movement type {movement!r} is a transfer/reversal — "
                "not in scope for direct consumption accounting"
            )
            rows.append(parsed)
            continue

        # Date
        try:
            posting_date = _parse_date(mapped.get("posting_date", ""))
        except ValueError as e:
            parsed.status = "ERROR"
            parsed.errors.append(f"Date parse failed: {e}")
            rows.append(parsed)
            continue

        # Quantity
        try:
            quantity = _parse_german_decimal(mapped.get("quantity", ""))
        except (ValueError, InvalidOperation) as e:
            parsed.status = "ERROR"
            parsed.errors.append(f"Quantity parse failed: {e}")
            rows.append(parsed)
            continue

        unit = mapped.get("unit", "").strip()
        material_no = mapped.get("material_no", "").strip()
        material_desc = mapped.get("material_desc", "").strip()
        plant = mapped.get("plant", "").strip()
        cost_center = mapped.get("cost_center", "").strip()

        # Unit normalization
        try:
            quantity_norm, unit_norm = normalize_unit(quantity, unit)
        except ValueError as e:
            parsed.errors.append(str(e))
            parsed.status = "WARNING"
            quantity_norm = quantity
            unit_norm = unit

        # Local-currency value
        value_str = mapped.get("value_lc", "").strip()
        amount: Optional[Decimal] = None
        if value_str:
            try:
                amount = _parse_german_decimal(value_str)
            except (ValueError, InvalidOperation):
                parsed.errors.append(f"Cannot parse value {value_str!r} — stored as null")

        scope, scope_category, activity_type = classify_sap_material(material_desc, material_no)

        # A goods-movement record has a single posting date; we use it as
        # both period_start and period_end. Monthly aggregation happens at the
        # reporting layer, not the ingestion layer.
        parsed.normalized = {
            "scope": scope,
            "scope_category": scope_category,
            "activity_type": activity_type,
            "quantity": quantity,
            "unit": unit,
            "quantity_normalized": quantity_norm,
            "unit_normalized": unit_norm,
            "period_start": posting_date,
            "period_end": posting_date,
            "site_code": plant,
            "site_name": "",    # resolved from PlantLookup in the view
            "cost_center": cost_center,
            "country": "",      # resolved from PlantLookup in the view
            "currency": mapped.get("currency", "").strip(),
            "amount": amount,
            "metadata": {
                "doc_number":      mapped.get("doc_number", ""),
                "doc_type":        mapped.get("doc_type", ""),
                "movement_type":   movement,
                "material_no":     material_no,
                "material_desc":   material_desc,
                "storage_location": mapped.get("storage_location", ""),
                "doc_year":        mapped.get("doc_year", ""),
            },
        }

        if parsed.errors:
            parsed.status = "WARNING"

        rows.append(parsed)

    return rows


# ---------------------------------------------------------------------------
# Utility electricity parser
# ---------------------------------------------------------------------------
# Modelled on Green Button Alliance CSV (ESPI standard, NAESB REQ.21).
# The ESPI XML stream is the authoritative format, but the CSV download from
# utility portals (PG&E, ConEd, Eversource, etc.) follows this column layout.
#
# Key real-world detail: billing periods are NOT calendar months. A billing
# cycle is typically 28–35 days starting from the meter read date. The same
# meter might be read on the 15th in January and the 17th in February.
# We store period_start and period_end exactly as given — aggregation to
# calendar months is the reporting layer's job.

def _parse_utility_date(s: str) -> date:
    s = s.strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Cannot parse utility date: {s!r}")


def parse_utility_file(content: bytes) -> list[ParsedRow]:
    """
    Parse a Green Button-style utility electricity CSV.

    Handles:
    - Billing periods that cross month boundaries
    - Mixed kWh / MWh units (normalizes to kWh)
    - Multiple meters per account
    - Optional peak demand column
    - Optional cost column
    """
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows: list[ParsedRow] = []

    for i, row in enumerate(reader, start=1):
        raw = {k: (v or "") for k, v in row.items()}
        parsed = ParsedRow(row_number=i, raw_data=raw)

        # Normalise column names (strip whitespace)
        norm = {k.strip(): v.strip() for k, v in raw.items()}

        meter_id = (
            norm.get("Meter ID")
            or norm.get("meter_id")
            or norm.get("MeterID", "")
        )
        account = (
            norm.get("Account Number")
            or norm.get("account_number", "")
        )

        billing_start_str = (
            norm.get("Billing Start")
            or norm.get("Service Start")
            or norm.get("billing_start", "")
        )
        billing_end_str = (
            norm.get("Billing End")
            or norm.get("Service End")
            or norm.get("billing_end", "")
        )

        # Usage may come in kWh or MWh depending on meter configuration
        usage_str = norm.get("Usage (kWh)") or norm.get("usage_kwh") or ""
        usage_unit = "kWh"
        if not usage_str:
            usage_str = norm.get("Usage (MWh)") or norm.get("usage_mwh") or ""
            usage_unit = "MWh"
        if not usage_str:
            usage_str = norm.get("Usage") or ""

        if not all([meter_id, billing_start_str, billing_end_str, usage_str]):
            parsed.status = "ERROR"
            parsed.errors.append(
                "Missing required fields: Meter ID, Billing Start, Billing End, or Usage"
            )
            rows.append(parsed)
            continue

        try:
            billing_start = _parse_utility_date(billing_start_str)
        except ValueError as e:
            parsed.status = "ERROR"
            parsed.errors.append(str(e))
            rows.append(parsed)
            continue

        try:
            billing_end = _parse_utility_date(billing_end_str)
        except ValueError as e:
            parsed.status = "ERROR"
            parsed.errors.append(str(e))
            rows.append(parsed)
            continue

        try:
            usage = Decimal(usage_str.replace(",", ""))
        except InvalidOperation:
            parsed.status = "ERROR"
            parsed.errors.append(f"Cannot parse usage: {usage_str!r}")
            rows.append(parsed)
            continue

        try:
            usage_norm, unit_norm = normalize_unit(usage, usage_unit)
        except ValueError as e:
            parsed.errors.append(str(e))
            parsed.status = "WARNING"
            usage_norm = usage
            unit_norm = usage_unit

        cost_str = (
            norm.get("Cost (USD)")
            or norm.get("cost_usd")
            or norm.get("Cost", "")
        ).replace("$", "").replace(",", "")
        amount: Optional[Decimal] = None
        if cost_str:
            try:
                amount = Decimal(cost_str)
            except InvalidOperation:
                parsed.errors.append(f"Cannot parse cost: {cost_str!r}")

        demand_str = norm.get("Peak Demand (kW)") or norm.get("peak_demand_kw") or ""

        parsed.normalized = {
            "scope": 2,
            "scope_category": "2.1 Purchased Electricity",
            "activity_type": "ELEC",
            "quantity": usage,
            "unit": usage_unit,
            "quantity_normalized": usage_norm,
            "unit_normalized": unit_norm,
            "period_start": billing_start,
            "period_end": billing_end,
            "site_code": meter_id,
            "site_name": norm.get("Service Address", ""),
            "cost_center": "",
            "country": "US",    # Green Button is a US standard
            "currency": "USD",
            "amount": amount,
            "metadata": {
                "account_number": account,
                "rate_schedule":  norm.get("Rate Schedule", ""),
                "peak_demand_kw": demand_str,
                "meter_type":     norm.get("Meter Type", "ELECTRIC"),
            },
        }

        if parsed.errors:
            parsed.status = "WARNING"

        rows.append(parsed)

    return rows


# ---------------------------------------------------------------------------
# Corporate travel parser
# ---------------------------------------------------------------------------
# Modelled on Concur Analytics standard expense report export (SAP Concur).
# Concur is the dominant enterprise TEM platform (~95% market share).
# The Analytics CSV export requires no IT involvement — any admin can run it.
#
# Key real-world details:
# - Flights are listed with origin/destination city or airport code.
#   Distance is frequently absent — it must be derived from airport codes
#   using great-circle calculation, which we flag but don't compute here
#   (that requires an airport-code database, deferred per TRADEOFFS.md).
# - Hotel records contain a nights count, not a distance.
# - Multiple currencies are common in a single report.
# - Class of service (Economy / Business / First) affects emission factors
#   but does not affect quantity — stored in metadata.

_EXPENSE_TYPE_MAP: dict[str, str] = {
    "air travel":           "FLIGHT",
    "airfare":              "FLIGHT",
    "flight":               "FLIGHT",
    "airline":              "FLIGHT",
    "hotel":                "HOTEL",
    "lodging":              "HOTEL",
    "accommodation":        "HOTEL",
    "car rental":           "GROUND",
    "rental car":           "GROUND",
    "taxi":                 "GROUND",
    "ride share":           "GROUND",
    "rideshare":            "GROUND",
    "uber":                 "GROUND",
    "lyft":                 "GROUND",
    "ground transportation":"GROUND",
    "ground transport":     "GROUND",
    "rail":                 "GROUND",
    "train":                "GROUND",
    "bus":                  "GROUND",
    "ferry":                "GROUND",
}

_SCOPE3_TRAVEL_CATEGORY: dict[str, str] = {
    "FLIGHT": "3.6 Business Travel – Air",
    "HOTEL":  "3.6 Business Travel – Hotel",
    "GROUND": "3.6 Business Travel – Ground Transport",
}


def _resolve_expense_type(raw_type: str) -> Optional[str]:
    lower = raw_type.lower().strip()
    if lower in _EXPENSE_TYPE_MAP:
        return _EXPENSE_TYPE_MAP[lower]
    for keyword, atype in _EXPENSE_TYPE_MAP.items():
        if keyword in lower:
            return atype
    return None


def parse_travel_file(content: bytes) -> list[ParsedRow]:
    """
    Parse a Concur Analytics expense report CSV.

    Handles:
    - Multiple expense types (flights, hotels, ground transport)
    - Missing distance for flight records (airport codes only)
    - Multiple currencies — stored verbatim, FX normalisation deferred
    - Nights field for hotel records
    - Class of service preserved in metadata
    """
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows: list[ParsedRow] = []

    for i, row in enumerate(reader, start=1):
        raw = {k: (v or "") for k, v in row.items()}
        parsed = ParsedRow(row_number=i, raw_data=raw)

        norm = {k.strip(): v.strip() for k, v in raw.items()}

        expense_type_raw = (
            norm.get("Expense Type") or norm.get("expense_type", "")
        )
        activity_type = _resolve_expense_type(expense_type_raw)
        if not activity_type:
            parsed.status = "WARNING"
            parsed.errors.append(
                f"Unknown expense type {expense_type_raw!r} — cannot classify; row skipped"
            )
            rows.append(parsed)
            continue

        # Date
        date_str = (
            norm.get("Travel Date")
            or norm.get("Expense Date")
            or norm.get("travel_date", "")
        )
        try:
            for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
                try:
                    travel_date = datetime.strptime(date_str, fmt).date()
                    break
                except ValueError:
                    continue
            else:
                raise ValueError(f"Cannot parse date: {date_str!r}")
        except ValueError as e:
            parsed.status = "ERROR"
            parsed.errors.append(str(e))
            rows.append(parsed)
            continue

        # Amount
        amount_str = (norm.get("Amount") or norm.get("amount", "")).replace(",", "")
        try:
            amount = Decimal(amount_str)
        except InvalidOperation:
            parsed.status = "ERROR"
            parsed.errors.append(f"Cannot parse amount: {amount_str!r}")
            rows.append(parsed)
            continue

        currency = norm.get("Currency") or norm.get("currency") or "USD"

        origin = (
            norm.get("Origin City")
            or norm.get("Origin")
            or norm.get("origin", "")
        )
        destination = (
            norm.get("Destination City")
            or norm.get("Destination")
            or norm.get("destination", "")
        )

        nights_str = norm.get("Nights") or norm.get("nights") or "0"
        try:
            nights = int(nights_str)
        except ValueError:
            nights = 0

        dist_str = (
            norm.get("Distance (mi)")
            or norm.get("distance_mi")
            or norm.get("Distance", "")
        ).replace(",", "")

        # Determine quantity and unit by activity type
        if activity_type == "HOTEL":
            quantity = Decimal(max(nights, 1))
            unit = "nights"
            period_start = travel_date
            period_end = travel_date + timedelta(days=max(nights, 1))
        elif dist_str:
            try:
                quantity = Decimal(dist_str)
                unit = "mi"
            except InvalidOperation:
                quantity = amount
                unit = currency
                parsed.errors.append(f"Cannot parse distance {dist_str!r} — using cost as proxy")
            period_start = travel_date
            period_end = travel_date
        else:
            # Distance not provided — common for flights (only IATA codes given).
            # We use the transaction amount as a stand-in quantity and flag the record.
            # Actual distance must be derived from IATA codes via a separate lookup.
            quantity = amount
            unit = currency
            period_start = travel_date
            period_end = travel_date
            parsed.errors.append(
                "Distance not provided — must be derived from origin/destination airport codes. "
                "Stored cost as proxy quantity; flagged for analyst review."
            )

        # Normalize unit
        try:
            quantity_norm, unit_norm = normalize_unit(quantity, unit)
        except ValueError:
            quantity_norm = quantity
            unit_norm = unit

        scope_category = _SCOPE3_TRAVEL_CATEGORY[activity_type]

        parsed.normalized = {
            "scope": 3,
            "scope_category": scope_category,
            "activity_type": activity_type,
            "quantity": quantity,
            "unit": unit,
            "quantity_normalized": quantity_norm,
            "unit_normalized": unit_norm,
            "period_start": period_start,
            "period_end": period_end,
            "site_code": "",
            "site_name": f"{origin} → {destination}" if (origin or destination) else "",
            "cost_center": (
                norm.get("Department")
                or norm.get("Cost Center")
                or norm.get("department", "")
            ),
            "country": "",
            "currency": currency,
            "amount": amount,
            "metadata": {
                "report_id":        norm.get("Report ID", ""),
                "employee_id":      norm.get("Employee ID", ""),
                "employee_name":    norm.get("Employee Name", ""),
                "origin":           origin,
                "destination":      destination,
                "class_of_service": (
                    norm.get("Class of Service")
                    or norm.get("Class", "")
                ),
                "vendor":           norm.get("Vendor", ""),
                "nights":           nights,
                "concur_carbon_kg": norm.get("Carbon Est (kg CO2)", ""),
            },
        }

        if parsed.errors:
            parsed.status = "WARNING"

        rows.append(parsed)

    return rows

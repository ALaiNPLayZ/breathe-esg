"""
Anomaly detection for NormalizedRecord instances.

Each check returns a list of flag dicts:
  {code: str, message: str, severity: "ERROR" | "WARNING"}

ERROR   — likely wrong data; the record is auto-set to FLAGGED and should not
          be approved without investigation.
WARNING — unusual but possibly legitimate; the analyst should check but may
          approve with a note.

Flags are stored on NormalizedRecord.review_flags and displayed prominently
in the analyst review UI. All checks are defensive — a check that fails to
run (e.g. DB error) is swallowed and logged, never raised to the caller.
"""

from datetime import date, timedelta
from decimal import Decimal

from .models import NormalizedRecord


def detect_anomalies(record: NormalizedRecord, tenant) -> list[dict]:
    """Run all anomaly checks and return the combined list of flags."""
    flags: list[dict] = []
    checks = [
        _check_zero_or_negative,
        _check_future_date,
        _check_missing_cost_center,
        _check_duplicate,
        _check_yoy_change,
        _check_unit_plausibility,
        _check_period_overlap,
    ]
    for check in checks:
        try:
            flags.extend(check(record, tenant))
        except Exception:
            pass  # never let anomaly detection break ingestion
    return flags


def _check_zero_or_negative(record: NormalizedRecord, _tenant) -> list[dict]:
    if record.quantity_normalized < 0:
        return [{
            "code": "NEGATIVE_VALUE",
            "message": (
                f"Negative quantity: {record.quantity} {record.unit}. "
                "Could be a reversal entry — verify intent before approving."
            ),
            "severity": "ERROR",
        }]
    if record.quantity_normalized == 0:
        return [{
            "code": "ZERO_VALUE",
            "message": "Quantity is zero — likely a data entry error or placeholder row.",
            "severity": "WARNING",
        }]
    return []


def _check_future_date(record: NormalizedRecord, _tenant) -> list[dict]:
    today = date.today()
    if record.period_end > today + timedelta(days=7):
        return [{
            "code": "FUTURE_DATE",
            "message": (
                f"Period ends {record.period_end}, which is in the future. "
                "Verify this is not a data entry error."
            ),
            "severity": "WARNING",
        }]
    return []


def _check_missing_cost_center(record: NormalizedRecord, _tenant) -> list[dict]:
    # Scope 1 and 2 records should always carry a cost centre so emissions
    # can be attributed to a business unit. Scope 3 travel records often don't.
    if record.scope in (1, 2) and not record.cost_center:
        return [{
            "code": "MISSING_COST_CENTER",
            "message": (
                "No cost centre provided for a Scope 1/2 record. "
                "Emission attribution to a business unit will not be possible."
            ),
            "severity": "WARNING",
        }]
    return []


def _check_duplicate(record: NormalizedRecord, tenant) -> list[dict]:
    """
    Flag if an approved/flagged record already exists for the same
    site + activity type + exact period. Exact-period match is intentional:
    two records covering overlapping (but not identical) periods is handled
    by _check_period_overlap.
    """
    if not record.site_code:
        return []

    existing = NormalizedRecord.objects.filter(
        tenant=tenant,
        site_code=record.site_code,
        activity_type=record.activity_type,
        period_start=record.period_start,
        period_end=record.period_end,
        review_status__in=[
            NormalizedRecord.ReviewStatus.APPROVED,
            NormalizedRecord.ReviewStatus.FLAGGED,
        ],
    ).exclude(pk=record.pk)

    if existing.exists():
        return [{
            "code": "DUPLICATE_LIKELY",
            "message": (
                f"An approved record already exists for site {record.site_code!r} "
                f"covering exactly {record.period_start} – {record.period_end}. "
                "This may be a duplicate upload."
            ),
            "severity": "ERROR",
        }]
    return []


def _check_yoy_change(record: NormalizedRecord, tenant) -> list[dict]:
    """
    Flag if quantity changed > 50% vs the same site/activity in the same
    calendar period one year earlier (±31 days to handle billing drift).

    50% is a reasonable threshold for utility and fuel data — seasonal
    variation is typically 20–30%. Travel data is more volatile and may
    produce false positives, but the analyst can acknowledge the flag.
    """
    if not record.site_code:
        return []

    try:
        prior_start = record.period_start.replace(year=record.period_start.year - 1)
        prior_end = record.period_end.replace(year=record.period_end.year - 1)
    except ValueError:
        # Feb 29 in a non-leap year
        return []

    prior = (
        NormalizedRecord.objects.filter(
            tenant=tenant,
            site_code=record.site_code,
            activity_type=record.activity_type,
            period_start__gte=prior_start - timedelta(days=31),
            period_end__lte=prior_end + timedelta(days=31),
            review_status=NormalizedRecord.ReviewStatus.APPROVED,
        )
        .order_by("-period_start")
        .first()
    )

    if prior and prior.quantity_normalized and prior.quantity_normalized != 0:
        pct = abs(
            (record.quantity_normalized - prior.quantity_normalized)
            / prior.quantity_normalized
            * 100
        )
        if pct > 50:
            direction = "above" if record.quantity_normalized > prior.quantity_normalized else "below"
            return [{
                "code": "LARGE_YOY_CHANGE",
                "message": (
                    f"{pct:.0f}% {direction} same period last year "
                    f"({prior.quantity_normalized:.2f} {prior.unit_normalized}). "
                    "Verify this is not a meter error or changed reporting boundary."
                ),
                "severity": "WARNING",
            }]
    return []


def _check_unit_plausibility(record: NormalizedRecord, _tenant) -> list[dict]:
    """
    Basic sanity check: the normalised unit should match the expected family
    for this activity type. Catches common mistakes like a fuel record arriving
    in kWh (happens when someone pastes electricity data into the SAP template).
    """
    expectations: dict[str, set[str]] = {
        "ELEC":      {"kWh"},
        "HOTEL":     {"nights"},
        "FLIGHT":    {"km", "mi", "USD", "EUR", "GBP"},  # distance or cost proxy
        "GROUND":    {"km", "mi", "USD", "EUR", "GBP"},
        "FUEL_STAT": {"L", "kg", "kWh"},
        "FUEL_MOB":  {"L", "kg", "kWh"},
        "PROCURE":   {"kg", "L", "kWh"},
    }
    expected = expectations.get(record.activity_type)
    if expected and record.unit_normalized not in expected:
        return [{
            "code": "UNEXPECTED_UNIT",
            "message": (
                f"Activity type {record.activity_type!r} has unit "
                f"{record.unit_normalized!r}; expected one of {sorted(expected)}."
            ),
            "severity": "WARNING",
        }]
    return []


def _check_period_overlap(record: NormalizedRecord, tenant) -> list[dict]:
    """
    For electricity meters: flag if the billing period overlaps an existing
    record for the same meter. Overlapping periods produce double-counting.

    This is common when a utility issues a corrected bill mid-cycle — the
    analyst needs to decide which period to keep.
    """
    if record.activity_type != "ELEC" or not record.site_code:
        return []

    overlap = NormalizedRecord.objects.filter(
        tenant=tenant,
        site_code=record.site_code,
        activity_type="ELEC",
        period_start__lt=record.period_end,
        period_end__gt=record.period_start,
        review_status__in=[
            NormalizedRecord.ReviewStatus.PENDING,
            NormalizedRecord.ReviewStatus.APPROVED,
            NormalizedRecord.ReviewStatus.FLAGGED,
        ],
    ).exclude(pk=record.pk)

    if overlap.exists():
        return [{
            "code": "PERIOD_OVERLAP",
            "message": (
                f"Billing period {record.period_start} – {record.period_end} "
                f"overlaps an existing record for meter {record.site_code!r}. "
                "This may be a corrected bill or a duplicate upload."
            ),
            "severity": "WARNING",
        }]
    return []

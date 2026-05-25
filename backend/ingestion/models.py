"""
Data model for Breathe ESG ingestion prototype.

Design principles:
  1. Every NormalizedRecord traces back to an immutable RawRecord — the exact
     bytes received, serialised as JSON. If we update normalization logic, we
     can re-derive without re-upload. If an auditor asks "where did this come
     from?", we can show them the original row.

  2. Both original and normalized quantities are stored on NormalizedRecord.
     quantity + unit = what the source said.
     quantity_normalized + unit_normalized = canonical form for aggregation.
     We never lose the source value.

  3. Scope and scope_category follow GHG Protocol Corporate Standard structure.
     scope=1 → direct, scope=2 → purchased energy, scope=3 → value chain.
     scope_category is the sub-category string (e.g. "1.1 Stationary Combustion").

  4. Multi-tenancy is row-level: every row carries a tenant FK. Queries in views
     are always filtered by request.user.tenant. Not schema-per-tenant (overkill
     for a prototype) but the model is ready for that migration if needed.

  5. Review workflow state machine:
       PENDING → APPROVED | FLAGGED | REJECTED
       FLAGGED → APPROVED | REJECTED
       APPROVED → LOCKED (irreversible via bulk lock)
       REJECTED is terminal (re-ingest the source to get a new record)

  6. AuditLog is append-only. Every state change writes a row with before/after
     status, the user who made the change, and optional notes. Auditors can
     reconstruct the full history of any record.

  7. PlantLookup resolves SAP plant codes to human-readable names and ISO 3166
     country codes. It is tenant-specific because the same code means different
     facilities for different clients.
"""

import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models


class Tenant(models.Model):
    """
    A client company. Every data record, ingestion run, and analyst user
    belongs to exactly one tenant.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True, help_text='URL-safe identifier, e.g. "acme-corp"')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class User(AbstractUser):
    """
    Extends Django's built-in User with tenant association.
    A null tenant indicates a platform superadmin who can see all tenants.
    """
    tenant = models.ForeignKey(
        Tenant,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="users",
        help_text="Null for platform superadmin",
    )

    class Meta:
        db_table = "auth_user"


class PlantLookup(models.Model):
    """
    Maps SAP plant codes (e.g. "1000", "US01") to human-readable metadata.

    SAP plant codes are internal identifiers that mean nothing without a
    lookup table. This table is tenant-specific because the same code can
    refer to different physical sites for different clients.
    """
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="plant_lookups")
    plant_code = models.CharField(max_length=10)
    plant_name = models.CharField(max_length=255)
    country = models.CharField(max_length=2, help_text="ISO 3166-1 alpha-2")
    facility_type = models.CharField(
        max_length=20,
        choices=[
            ("OFFICE", "Office"),
            ("FACTORY", "Manufacturing Facility"),
            ("WAREHOUSE", "Warehouse / Distribution"),
            ("DATA_CENTER", "Data Center"),
            ("OTHER", "Other"),
        ],
        default="OTHER",
    )

    class Meta:
        unique_together = [["tenant", "plant_code"]]

    def __str__(self):
        return f"{self.plant_code} – {self.plant_name}"


class IngestionRun(models.Model):
    """
    Records a single file upload / ingestion event.

    file_hash (SHA-256) lets us detect and reject duplicate uploads before
    parsing begins. row_count_* fields give a quick summary without joining
    to RawRecord.
    """

    class SourceType(models.TextChoices):
        SAP_FUEL = "SAP_FUEL", "SAP Fuel & Procurement"
        UTILITY_ELEC = "UTILITY_ELEC", "Utility Electricity"
        CORP_TRAVEL = "CORP_TRAVEL", "Corporate Travel"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        PROCESSING = "PROCESSING", "Processing"
        COMPLETE = "COMPLETE", "Complete"
        FAILED = "FAILED", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.PROTECT, related_name="ingestion_runs")
    source_type = models.CharField(max_length=20, choices=SourceType.choices)
    file_name = models.CharField(max_length=255)
    file_hash = models.CharField(
        max_length=64,
        help_text="SHA-256 of the uploaded file; prevents duplicate ingestion",
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    ingested_by = models.ForeignKey("User", on_delete=models.PROTECT, related_name="ingestion_runs")
    ingested_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    row_count_total = models.IntegerField(default=0)
    row_count_success = models.IntegerField(default=0)
    row_count_failed = models.IntegerField(default=0)
    row_count_flagged = models.IntegerField(default=0)
    error_message = models.TextField(blank=True)

    class Meta:
        ordering = ["-ingested_at"]

    def __str__(self):
        return f"{self.get_source_type_display()} | {self.file_name} | {self.ingested_at:%Y-%m-%d} | {self.status}"


class RawRecord(models.Model):
    """
    Immutable store of exactly what was received, row by row.

    Never modified after creation. raw_data holds the exact field names and
    values as they appeared in the source file (serialized as JSON). This is
    the permanent audit evidence — NormalizedRecord is derived from it and can
    be re-computed, but RawRecord cannot change.
    """

    class ParseStatus(models.TextChoices):
        OK = "OK", "Parsed OK"
        WARNING = "WARNING", "Parsed with warnings"
        ERROR = "ERROR", "Parse failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ingestion_run = models.ForeignKey(
        IngestionRun, on_delete=models.CASCADE, related_name="raw_records"
    )
    row_number = models.IntegerField()
    raw_data = models.JSONField(
        help_text="Exact parsed row with original field names and values"
    )
    parse_status = models.CharField(
        max_length=10, choices=ParseStatus.choices, default=ParseStatus.OK
    )
    parse_errors = models.JSONField(default=list, help_text="List of parse error strings")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [["ingestion_run", "row_number"]]
        ordering = ["ingestion_run", "row_number"]

    def __str__(self):
        return f"Row {self.row_number} of {self.ingestion_run}"


class NormalizedRecord(models.Model):
    """
    The canonical form of one activity data point after parsing and normalization.

    Key design decisions:
    - raw_record OneToOne: every record traces to its source row.
    - quantity/unit: original values, never modified.
    - quantity_normalized/unit_normalized: converted to canonical unit for aggregation.
    - scope + scope_category: GHG Protocol Corporate Standard structure.
    - review_flags: auto-detected anomalies from ingestion; analyst can override.
    - is_locked: once locked, the record is immutable — no modifications allowed.
    - metadata JSONField: source-specific fields that don't fit the canonical schema
      (SAP document type, travel class of service, utility tariff schedule, etc.).
      We don't lose data just because it doesn't fit.
    """

    class ReviewStatus(models.TextChoices):
        PENDING = "PENDING", "Pending Review"
        APPROVED = "APPROVED", "Approved"
        FLAGGED = "FLAGGED", "Flagged for Review"
        REJECTED = "REJECTED", "Rejected"

    class Scope(models.IntegerChoices):
        SCOPE_1 = 1, "Scope 1 – Direct Emissions"
        SCOPE_2 = 2, "Scope 2 – Purchased Energy"
        SCOPE_3 = 3, "Scope 3 – Value Chain"

    class ActivityType(models.TextChoices):
        FUEL_STATIONARY = "FUEL_STAT", "Stationary Combustion"
        FUEL_MOBILE = "FUEL_MOB", "Mobile Combustion"
        ELECTRICITY = "ELEC", "Purchased Electricity"
        FLIGHT = "FLIGHT", "Business Travel – Flight"
        HOTEL = "HOTEL", "Business Travel – Hotel"
        GROUND_TRANSPORT = "GROUND", "Business Travel – Ground Transport"
        PROCUREMENT = "PROCURE", "Purchased Goods & Services"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(
        Tenant, on_delete=models.PROTECT, db_index=True, related_name="records"
    )
    raw_record = models.OneToOneField(
        RawRecord,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="normalized",
        help_text="Source row; null only for manually created records",
    )
    ingestion_run = models.ForeignKey(
        IngestionRun, on_delete=models.PROTECT, related_name="normalized_records"
    )

    # GHG Protocol classification
    scope = models.IntegerField(choices=Scope.choices)
    scope_category = models.CharField(
        max_length=100,
        help_text='e.g. "1.1 Stationary Combustion", "3.6 Business Travel"',
    )
    activity_type = models.CharField(max_length=20, choices=ActivityType.choices)

    # Activity quantity — original values from source, never modified
    quantity = models.DecimalField(max_digits=18, decimal_places=6)
    unit = models.CharField(max_length=20, help_text="Original unit string from source")

    # Activity quantity — normalized to canonical unit for this activity type
    quantity_normalized = models.DecimalField(max_digits=18, decimal_places=6)
    unit_normalized = models.CharField(
        max_length=20,
        help_text="kWh for electricity, L for liquid fuel, kg for mass, km for distance, nights for hotel",
    )

    # Reporting period — billing period or activity date range
    period_start = models.DateField()
    period_end = models.DateField()

    # Organizational context
    site_code = models.CharField(
        max_length=50,
        blank=True,
        db_index=True,
        help_text="SAP plant code, utility meter ID, or similar site identifier",
    )
    site_name = models.CharField(max_length=255, blank=True)
    cost_center = models.CharField(max_length=50, blank=True)
    country = models.CharField(max_length=2, blank=True, help_text="ISO 3166-1 alpha-2")

    # Financial context — optional, not all sources include cost
    currency = models.CharField(max_length=3, blank=True, help_text="ISO 4217")
    amount = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)

    # Source-specific overflow — fields that don't fit the canonical schema
    metadata = models.JSONField(
        default=dict,
        help_text="Source-specific fields preserved verbatim from raw data",
    )

    # Review workflow
    review_status = models.CharField(
        max_length=20,
        choices=ReviewStatus.choices,
        default=ReviewStatus.PENDING,
        db_index=True,
    )
    review_flags = models.JSONField(
        default=list,
        help_text="Auto-detected anomalies: [{code, message, severity}]",
    )
    reviewed_by = models.ForeignKey(
        "User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_records",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_notes = models.TextField(
        blank=True,
        help_text="Analyst notes; required when rejecting a record",
    )

    # Audit lock — once locked, this record is immutable
    is_locked = models.BooleanField(default=False, db_index=True)
    locked_at = models.DateTimeField(null=True, blank=True)
    locked_by = models.ForeignKey(
        "User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="locked_records",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-period_start", "site_code"]
        indexes = [
            models.Index(fields=["tenant", "review_status"]),
            models.Index(fields=["tenant", "scope", "period_start"]),
            models.Index(fields=["tenant", "site_code", "activity_type", "period_start"]),
            models.Index(fields=["tenant", "is_locked"]),
        ]

    def __str__(self):
        return (
            f"{self.get_activity_type_display()} | {self.site_code} | "
            f"{self.period_start} | {self.quantity} {self.unit}"
        )


class AuditLog(models.Model):
    """
    Append-only log of every state change to a NormalizedRecord.

    Records are never deleted. Every approval, rejection, flag, and lock is
    written here with the user, timestamp, before/after status, and optional
    notes. Auditors can reconstruct the complete review history of any record.
    """

    class Action(models.TextChoices):
        CREATED = "CREATED", "Record Created"
        APPROVED = "APPROVED", "Approved"
        FLAGGED = "FLAGGED", "Flagged"
        REJECTED = "REJECTED", "Rejected"
        NOTE_ADDED = "NOTE_ADDED", "Note Added"
        LOCKED = "LOCKED", "Locked for Audit"
        UNLOCKED = "UNLOCKED", "Unlocked"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    normalized_record = models.ForeignKey(
        NormalizedRecord, on_delete=models.CASCADE, related_name="audit_logs"
    )
    user = models.ForeignKey("User", on_delete=models.PROTECT)
    action = models.CharField(max_length=20, choices=Action.choices)
    previous_status = models.CharField(max_length=20, blank=True)
    new_status = models.CharField(max_length=20, blank=True)
    notes = models.TextField(blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-timestamp"]

    def __str__(self):
        return f"{self.action} | {self.normalized_record_id} | {self.user} | {self.timestamp:%Y-%m-%d %H:%M}"

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import AuditLog, IngestionRun, NormalizedRecord, PlantLookup, RawRecord, Tenant, User


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ["name", "slug", "created_at"]
    search_fields = ["name", "slug"]


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["username", "email", "tenant", "is_staff"]
    list_filter = ["tenant", "is_staff", "is_superuser"]
    fieldsets = BaseUserAdmin.fieldsets + (
        ("Breathe ESG", {"fields": ("tenant",)}),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        ("Breathe ESG", {"fields": ("tenant",)}),
    )


@admin.register(PlantLookup)
class PlantLookupAdmin(admin.ModelAdmin):
    list_display = ["plant_code", "plant_name", "country", "facility_type", "tenant"]
    list_filter = ["tenant", "facility_type", "country"]
    search_fields = ["plant_code", "plant_name"]


@admin.register(IngestionRun)
class IngestionRunAdmin(admin.ModelAdmin):
    list_display = [
        "file_name", "source_type", "status", "tenant",
        "ingested_by", "ingested_at",
        "row_count_total", "row_count_success", "row_count_failed",
    ]
    list_filter = ["source_type", "status", "tenant"]
    readonly_fields = ["file_hash", "ingested_at", "completed_at"]


@admin.register(RawRecord)
class RawRecordAdmin(admin.ModelAdmin):
    list_display = ["row_number", "ingestion_run", "parse_status", "created_at"]
    list_filter = ["parse_status"]
    readonly_fields = ["ingestion_run", "row_number", "raw_data", "parse_errors", "created_at"]


@admin.register(NormalizedRecord)
class NormalizedRecordAdmin(admin.ModelAdmin):
    list_display = [
        "activity_type", "scope", "site_code", "period_start", "period_end",
        "quantity", "unit", "review_status", "is_locked", "tenant",
    ]
    list_filter = ["scope", "activity_type", "review_status", "is_locked", "tenant"]
    search_fields = ["site_code", "site_name", "cost_center"]
    readonly_fields = [
        "id", "raw_record", "ingestion_run", "created_at", "updated_at",
        "locked_at", "locked_by", "reviewed_at",
    ]


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = [
        "action", "user", "normalized_record", "previous_status", "new_status", "timestamp",
    ]
    list_filter = ["action"]
    readonly_fields = list_display + ["notes"]

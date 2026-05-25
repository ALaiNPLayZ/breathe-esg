from rest_framework import serializers
from .models import AuditLog, IngestionRun, NormalizedRecord, RawRecord


class RawRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = RawRecord
        fields = ["id", "row_number", "raw_data", "parse_status", "parse_errors", "created_at"]


class IngestionRunSerializer(serializers.ModelSerializer):
    source_type_display = serializers.CharField(source="get_source_type_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    ingested_by_username = serializers.CharField(source="ingested_by.username", read_only=True)

    class Meta:
        model = IngestionRun
        fields = [
            "id", "source_type", "source_type_display",
            "file_name", "file_hash", "status", "status_display",
            "ingested_by", "ingested_by_username", "ingested_at", "completed_at",
            "row_count_total", "row_count_success", "row_count_failed",
            "row_count_flagged", "error_message",
        ]
        read_only_fields = fields


class NormalizedRecordSerializer(serializers.ModelSerializer):
    scope_display = serializers.CharField(source="get_scope_display", read_only=True)
    activity_type_display = serializers.CharField(source="get_activity_type_display", read_only=True)
    review_status_display = serializers.CharField(source="get_review_status_display", read_only=True)
    reviewed_by_username = serializers.CharField(source="reviewed_by.username", read_only=True, default=None)
    source_type = serializers.CharField(source="ingestion_run.source_type", read_only=True)
    source_type_display = serializers.CharField(
        source="ingestion_run.get_source_type_display", read_only=True
    )
    raw_data = serializers.JSONField(source="raw_record.raw_data", read_only=True, default=None)
    parse_errors = serializers.JSONField(source="raw_record.parse_errors", read_only=True, default=None)

    class Meta:
        model = NormalizedRecord
        fields = [
            "id",
            "scope", "scope_display", "scope_category",
            "activity_type", "activity_type_display",
            "source_type", "source_type_display",
            "quantity", "unit",
            "quantity_normalized", "unit_normalized",
            "period_start", "period_end",
            "site_code", "site_name",
            "cost_center", "country",
            "currency", "amount",
            "metadata",
            "review_status", "review_status_display",
            "review_flags",
            "reviewed_by", "reviewed_by_username",
            "reviewed_at", "review_notes",
            "is_locked", "locked_at",
            "ingestion_run",
            "raw_data", "parse_errors",
            "created_at", "updated_at",
        ]
        read_only_fields = fields


class AuditLogSerializer(serializers.ModelSerializer):
    user_username = serializers.CharField(source="user.username", read_only=True)
    action_display = serializers.CharField(source="get_action_display", read_only=True)
    record_summary = serializers.SerializerMethodField()

    def get_record_summary(self, obj) -> str:
        r = obj.normalized_record
        return f"{r.get_activity_type_display()} | {r.site_code or '—'} | {r.period_start}"

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "normalized_record",
            "record_summary",
            "user", "user_username",
            "action", "action_display",
            "previous_status", "new_status",
            "notes", "timestamp",
        ]
        read_only_fields = fields

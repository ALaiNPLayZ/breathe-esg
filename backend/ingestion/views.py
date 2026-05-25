import hashlib
import os

from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AuditLog, IngestionRun, NormalizedRecord, PlantLookup, RawRecord
from .parsers import parse_sap_file, parse_travel_file, parse_utility_file
from .serializers import (
    AuditLogSerializer,
    IngestionRunSerializer,
    NormalizedRecordSerializer,
)
from .validators import detect_anomalies

SAMPLE_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "sample_data")

_PARSER_MAP = {
    "SAP_FUEL":    parse_sap_file,
    "UTILITY_ELEC": parse_utility_file,
    "CORP_TRAVEL": parse_travel_file,
}

_SAMPLE_FILES = {
    "SAP_FUEL":    "sap_export.txt",
    "UTILITY_ELEC": "utility_electricity.csv",
    "CORP_TRAVEL": "corporate_travel.csv",
}


class IngestionRunViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = IngestionRunSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return IngestionRun.objects.filter(tenant=self.request.user.tenant)

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser])
    def upload(self, request):
        """Upload and ingest a new data file."""
        file_obj = request.FILES.get("file")
        source_type = request.data.get("source_type", "").strip()

        if not file_obj:
            return Response({"error": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)
        if source_type not in _PARSER_MAP:
            return Response(
                {
                    "error": f"Invalid source_type. Valid choices: {list(_PARSER_MAP)}",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        content = file_obj.read()
        file_hash = hashlib.sha256(content).hexdigest()

        existing = IngestionRun.objects.filter(
            tenant=request.user.tenant, file_hash=file_hash
        ).first()
        if existing:
            return Response(
                {
                    "warning": "This exact file has already been ingested.",
                    "existing_run_id": str(existing.id),
                },
                status=status.HTTP_409_CONFLICT,
            )

        run = IngestionRun.objects.create(
            tenant=request.user.tenant,
            source_type=source_type,
            file_name=file_obj.name,
            file_hash=file_hash,
            ingested_by=request.user,
            status=IngestionRun.Status.PROCESSING,
        )

        try:
            _run_ingestion(run, content, source_type, request.user)
        except Exception as exc:
            run.status = IngestionRun.Status.FAILED
            run.error_message = str(exc)
            run.completed_at = timezone.now()
            run.save()
            return Response(
                {"error": f"Ingestion failed: {exc}", "run_id": str(run.id)},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        return Response(IngestionRunSerializer(run).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"])
    def load_sample(self, request):
        """Load pre-built sample data (for demo purposes)."""
        source_type = request.data.get("source_type", "").strip()
        if source_type not in _SAMPLE_FILES:
            return Response({"error": "Invalid source_type."}, status=status.HTTP_400_BAD_REQUEST)

        fname = _SAMPLE_FILES[source_type]
        path = os.path.join(SAMPLE_DATA_DIR, fname)
        with open(path, "rb") as f:
            content = f.read()

        file_hash = hashlib.sha256(content).hexdigest()
        existing = IngestionRun.objects.filter(
            tenant=request.user.tenant, file_hash=file_hash
        ).first()
        if existing:
            return Response(
                {"warning": "Sample data already loaded.", "existing_run_id": str(existing.id)},
                status=status.HTTP_409_CONFLICT,
            )

        run = IngestionRun.objects.create(
            tenant=request.user.tenant,
            source_type=source_type,
            file_name=fname,
            file_hash=file_hash,
            ingested_by=request.user,
            status=IngestionRun.Status.PROCESSING,
        )
        _run_ingestion(run, content, source_type, request.user)
        return Response(IngestionRunSerializer(run).data, status=status.HTTP_201_CREATED)


@transaction.atomic
def _run_ingestion(run: IngestionRun, content: bytes, source_type: str, user):
    """Core ingestion pipeline: parse → persist raw → normalize → flag → audit."""
    parser = _PARSER_MAP[source_type]
    parsed_rows = parser(content)

    success = failed = flagged = 0

    for pr in parsed_rows:
        raw = RawRecord.objects.create(
            ingestion_run=run,
            row_number=pr.row_number,
            raw_data=pr.raw_data,
            parse_status=pr.status,
            parse_errors=pr.errors,
        )

        if pr.status == "ERROR" or not pr.normalized:
            failed += 1
            continue

        n = pr.normalized
        record = NormalizedRecord(
            tenant=run.tenant,
            raw_record=raw,
            ingestion_run=run,
            scope=n["scope"],
            scope_category=n["scope_category"],
            activity_type=n["activity_type"],
            quantity=n["quantity"],
            unit=n["unit"],
            quantity_normalized=n["quantity_normalized"],
            unit_normalized=n["unit_normalized"],
            period_start=n["period_start"],
            period_end=n["period_end"],
            site_code=n.get("site_code", ""),
            site_name=n.get("site_name", ""),
            cost_center=n.get("cost_center", ""),
            country=n.get("country", ""),
            currency=n.get("currency", ""),
            amount=n.get("amount"),
            metadata=n.get("metadata", {}),
            review_flags=[],
        )

        # Resolve SAP plant code from lookup table
        if source_type == "SAP_FUEL" and record.site_code:
            try:
                lookup = PlantLookup.objects.get(
                    tenant=run.tenant, plant_code=record.site_code
                )
                record.site_name = lookup.plant_name
                record.country = lookup.country
            except PlantLookup.DoesNotExist:
                record.review_flags.append({
                    "code": "UNKNOWN_PLANT",
                    "message": (
                        f"Plant code {record.site_code!r} not found in lookup table. "
                        "Country and site name cannot be resolved."
                    ),
                    "severity": "WARNING",
                })

        record.save()

        # Run anomaly detection now that the record has a PK
        flags = detect_anomalies(record, run.tenant)
        # Merge any parse-time flags that were stored pre-save
        record.review_flags = record.review_flags + flags

        has_error = (
            any(f["severity"] == "ERROR" for f in record.review_flags)
            or pr.status == "WARNING"
        )
        if has_error:
            record.review_status = NormalizedRecord.ReviewStatus.FLAGGED
            flagged += 1
        else:
            success += 1

        record.save()

        AuditLog.objects.create(
            normalized_record=record,
            user=user,
            action=AuditLog.Action.CREATED,
            new_status=record.review_status,
            notes=f"Ingested from {run.file_name}, row {pr.row_number}",
        )

    run.status = IngestionRun.Status.COMPLETE
    run.completed_at = timezone.now()
    run.row_count_total = len(parsed_rows)
    run.row_count_success = success
    run.row_count_failed = failed
    run.row_count_flagged = flagged
    run.save()


class NormalizedRecordViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NormalizedRecordSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = NormalizedRecord.objects.filter(
            tenant=self.request.user.tenant
        ).select_related("ingestion_run", "reviewed_by", "raw_record")

        params = self.request.query_params
        if v := params.get("review_status"):
            qs = qs.filter(review_status=v)
        if v := params.get("source_type"):
            qs = qs.filter(ingestion_run__source_type=v)
        if v := params.get("scope"):
            qs = qs.filter(scope=v)
        if v := params.get("run_id"):
            qs = qs.filter(ingestion_run_id=v)
        if v := params.get("period_start"):
            qs = qs.filter(period_start__gte=v)
        if v := params.get("period_end"):
            qs = qs.filter(period_end__lte=v)
        if v := params.get("site_code"):
            qs = qs.filter(site_code__icontains=v)

        return qs

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        record = self.get_object()
        return _change_status(
            record, request.user,
            new_status=NormalizedRecord.ReviewStatus.APPROVED,
            action=AuditLog.Action.APPROVED,
            notes=request.data.get("notes", ""),
        )

    @action(detail=True, methods=["post"])
    def flag(self, request, pk=None):
        record = self.get_object()
        return _change_status(
            record, request.user,
            new_status=NormalizedRecord.ReviewStatus.FLAGGED,
            action=AuditLog.Action.FLAGGED,
            notes=request.data.get("notes", ""),
        )

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        record = self.get_object()
        notes = request.data.get("notes", "").strip()
        if not notes:
            return Response(
                {"error": "notes is required when rejecting a record."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return _change_status(
            record, request.user,
            new_status=NormalizedRecord.ReviewStatus.REJECTED,
            action=AuditLog.Action.REJECTED,
            notes=notes,
        )

    @action(detail=False, methods=["post"])
    def bulk_approve(self, request):
        """Approve all PENDING records (optionally filtered by a list of IDs)."""
        ids = request.data.get("ids")
        qs = NormalizedRecord.objects.filter(
            tenant=request.user.tenant,
            is_locked=False,
            review_status=NormalizedRecord.ReviewStatus.PENDING,
        )
        if ids:
            qs = qs.filter(id__in=ids)

        count = 0
        for record in qs:
            _change_status(
                record, request.user,
                new_status=NormalizedRecord.ReviewStatus.APPROVED,
                action=AuditLog.Action.APPROVED,
                notes="Bulk approved",
            )
            count += 1
        return Response({"approved": count})

    @action(detail=False, methods=["post"])
    def lock_approved(self, request):
        """Lock all APPROVED records — makes them immutable for audit sign-off."""
        qs = NormalizedRecord.objects.filter(
            tenant=request.user.tenant,
            review_status=NormalizedRecord.ReviewStatus.APPROVED,
            is_locked=False,
        )
        now = timezone.now()
        count = 0
        for record in qs:
            record.is_locked = True
            record.locked_at = now
            record.locked_by = request.user
            record.save()
            AuditLog.objects.create(
                normalized_record=record,
                user=request.user,
                action=AuditLog.Action.LOCKED,
                previous_status=NormalizedRecord.ReviewStatus.APPROVED,
                new_status=NormalizedRecord.ReviewStatus.APPROVED,
                notes="Locked for audit",
            )
            count += 1
        return Response({"locked": count})


def _change_status(record: NormalizedRecord, user, new_status: str, action: str, notes: str):
    if record.is_locked:
        return Response(
            {"error": "This record is locked for audit and cannot be modified."},
            status=status.HTTP_403_FORBIDDEN,
        )
    prev_status = record.review_status
    record.review_status = new_status
    record.reviewed_by = user
    record.reviewed_at = timezone.now()
    record.review_notes = notes
    record.save()

    AuditLog.objects.create(
        normalized_record=record,
        user=user,
        action=action,
        previous_status=prev_status,
        new_status=new_status,
        notes=notes,
    )
    return Response(NormalizedRecordSerializer(record).data)


class StatsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tenant = request.user.tenant
        qs = NormalizedRecord.objects.filter(tenant=tenant)

        return Response({
            "total":   qs.count(),
            "pending": qs.filter(review_status="PENDING").count(),
            "flagged": qs.filter(review_status="FLAGGED").count(),
            "approved": qs.filter(review_status="APPROVED").count(),
            "rejected": qs.filter(review_status="REJECTED").count(),
            "locked":  qs.filter(is_locked=True).count(),
            "by_scope": {
                "scope_1": qs.filter(scope=1).count(),
                "scope_2": qs.filter(scope=2).count(),
                "scope_3": qs.filter(scope=3).count(),
            },
            "by_source": {
                "SAP_FUEL":    qs.filter(ingestion_run__source_type="SAP_FUEL").count(),
                "UTILITY_ELEC": qs.filter(ingestion_run__source_type="UTILITY_ELEC").count(),
                "CORP_TRAVEL": qs.filter(ingestion_run__source_type="CORP_TRAVEL").count(),
            },
            "recent_runs": IngestionRunSerializer(
                IngestionRun.objects.filter(tenant=tenant)[:5], many=True
            ).data,
        })


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = AuditLog.objects.filter(
            normalized_record__tenant=self.request.user.tenant
        ).select_related("user", "normalized_record")

        if v := self.request.query_params.get("record_id"):
            qs = qs.filter(normalized_record_id=v)
        if v := self.request.query_params.get("action"):
            qs = qs.filter(action=v)

        return qs

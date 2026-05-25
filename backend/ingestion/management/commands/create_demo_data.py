"""
Management command: create_demo_data

Sets up a fully working demo environment:
  - One tenant: "Acme Corporation"
  - Two users: admin (superuser) and analyst
  - SAP plant lookup table for Acme's four facilities
  - Pre-loaded sample data for all three source types

Usage:
    python manage.py create_demo_data
    python manage.py create_demo_data --reset   # wipe tenant data first
"""

import hashlib
import os

from django.core.management.base import BaseCommand

from ingestion.models import IngestionRun, PlantLookup, Tenant, User
from ingestion.views import _run_ingestion

SAMPLE_DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
    "sample_data",
)


class Command(BaseCommand):
    help = "Bootstrap demo tenant, users, and sample data"

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete existing demo data before re-creating",
        )

    def handle(self, *args, **options):
        if options["reset"]:
            Tenant.objects.filter(slug="acme-corp").delete()
            self.stdout.write("Deleted existing demo tenant.")

        # ── Tenant ──────────────────────────────────────────────────────────
        tenant, _ = Tenant.objects.get_or_create(
            slug="acme-corp",
            defaults={"name": "Acme Corporation"},
        )
        self.stdout.write(f"Tenant: {tenant.name}")

        # ── Users ────────────────────────────────────────────────────────────
        admin_user, _ = User.objects.get_or_create(
            username="admin",
            defaults={
                "email": "admin@acme.example",
                "tenant": tenant,
                "is_staff": True,
                "is_superuser": True,
            },
        )
        admin_user.set_password("admin123")
        admin_user.save()
        self.stdout.write("User: admin / admin123 (superuser)")

        analyst, _ = User.objects.get_or_create(
            username="analyst",
            defaults={
                "email": "analyst@acme.example",
                "tenant": tenant,
                "is_staff": False,
                "is_superuser": False,
            },
        )
        analyst.set_password("analyst123")
        analyst.save()
        self.stdout.write("User: analyst / analyst123")

        # ── Plant lookup table ───────────────────────────────────────────────
        plants = [
            ("1000", "Hamburg Manufacturing Plant", "DE", "FACTORY"),
            ("2000", "Rotterdam Distribution Centre", "NL", "WAREHOUSE"),
            ("US01", "Houston Processing Facility",  "US", "FACTORY"),
            ("IN01", "Mumbai Regional Office",       "IN", "OFFICE"),
        ]
        for code, name, country, ftype in plants:
            PlantLookup.objects.get_or_create(
                tenant=tenant,
                plant_code=code,
                defaults={"plant_name": name, "country": country, "facility_type": ftype},
            )
        self.stdout.write(f"Plant lookup: {len(plants)} entries")

        # ── Sample data ingestion ────────────────────────────────────────────
        sources = [
            ("SAP_FUEL",    "sap_export.txt"),
            ("UTILITY_ELEC", "utility_electricity.csv"),
            ("CORP_TRAVEL", "corporate_travel.csv"),
        ]
        for source_type, fname in sources:
            path = os.path.join(SAMPLE_DATA_DIR, fname)
            if not os.path.exists(path):
                self.stderr.write(f"Sample file not found: {path}")
                continue

            with open(path, "rb") as f:
                content = f.read()

            file_hash = hashlib.sha256(content).hexdigest()
            if IngestionRun.objects.filter(tenant=tenant, file_hash=file_hash).exists():
                self.stdout.write(f"Sample already loaded: {fname}")
                continue

            run = IngestionRun.objects.create(
                tenant=tenant,
                source_type=source_type,
                file_name=fname,
                file_hash=file_hash,
                ingested_by=admin_user,
                status=IngestionRun.Status.PROCESSING,
            )
            _run_ingestion(run, content, source_type, admin_user)
            self.stdout.write(
                f"Ingested {fname}: "
                f"{run.row_count_success} ok, "
                f"{run.row_count_flagged} flagged, "
                f"{run.row_count_failed} failed"
            )

        self.stdout.write(self.style.SUCCESS("\nDemo environment ready."))
        self.stdout.write("  Login: admin / admin123  or  analyst / analyst123")

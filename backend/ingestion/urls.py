from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import AuditLogViewSet, IngestionRunViewSet, MeView, NormalizedRecordViewSet, StatsView

router = DefaultRouter()
router.register("ingestion-runs", IngestionRunViewSet, basename="ingestion-run")
router.register("records", NormalizedRecordViewSet, basename="record")
router.register("audit-log", AuditLogViewSet, basename="audit-log")

urlpatterns = [
    path("stats/", StatsView.as_view(), name="stats"),
    path("me/", MeView.as_view(), name="me"),
    path("", include(router.urls)),
]

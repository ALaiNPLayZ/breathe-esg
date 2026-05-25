# Breathe ESG – Emissions Data Ingestion Prototype

A Django REST + React prototype for ingesting emissions activity data from three enterprise sources, normalising it to a canonical schema, and surfacing an analyst review dashboard before records are locked for audit.

**Live app:** https://breathe-esg.onrender.com  
**Demo credentials:** `analyst / analyst123` or `admin / admin123`

---

## Architecture

```
┌─────────────────┐        ┌──────────────────────────────────┐
│  React frontend  │  API   │         Django backend            │
│  (Vite + TS +    │◄──────►│  DRF + JWT + WhiteNoise          │
│   Tailwind CSS)  │        │                                   │
└─────────────────┘        │  ┌──────────┐  ┌──────────────┐  │
                            │  │ Parsers  │  │  Validators  │  │
                            │  │ SAP      │  │  Anomaly     │  │
                            │  │ Utility  │  │  detection   │  │
                            │  │ Travel   │  └──────────────┘  │
                            │  └──────────┘                    │
                            │  ┌───────────────────────────┐   │
                            │  │  PostgreSQL / SQLite       │   │
                            │  │  Tenant → IngestionRun    │   │
                            │  │       → RawRecord         │   │
                            │  │       → NormalizedRecord  │   │
                            │  │       → AuditLog          │   │
                            │  └───────────────────────────┘   │
                            └──────────────────────────────────┘
```

---

## Local development (Docker Compose)

```bash
git clone <repo>
docker compose up
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000/api/
- Django admin: http://localhost:8000/admin/ (admin / admin123)

The `create_demo_data` management command runs automatically on first start and loads all three sample data files.

---

## Local development (manual)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # edit as needed
python manage.py migrate
python manage.py create_demo_data
python manage.py runserver
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Visit http://localhost:5173. API proxied to http://localhost:8000 via Vite.

---

## Production deployment (Render)

The `render.yaml` in the repo root configures a single Render web service + PostgreSQL database.

1. Fork or push this repo to GitHub.
2. Create a new Render Blueprint from the repo root.
3. Render reads `render.yaml`, creates the web service and database.
4. The build script installs Python deps, builds the React app, copies the build into `backend/frontend_build/`, runs Django migrations, and seeds demo data.
5. Django serves the React SPA via WhiteNoise for any non-API route.

One service, one URL. No separate static site deployment needed.

---

## API overview

All endpoints require `Authorization: Bearer <access_token>` (obtain from `/api/token/`).

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/token/` | Obtain JWT (username + password) |
| POST | `/api/token/refresh/` | Refresh access token |
| GET | `/api/stats/` | Dashboard statistics |
| GET | `/api/ingestion-runs/` | List ingestion runs |
| POST | `/api/ingestion-runs/upload/` | Upload a new file |
| POST | `/api/ingestion-runs/load_sample/` | Load pre-built sample data |
| GET | `/api/records/` | List normalised records (filterable) |
| POST | `/api/records/{id}/approve/` | Approve a record |
| POST | `/api/records/{id}/flag/` | Flag a record for review |
| POST | `/api/records/{id}/reject/` | Reject a record (notes required) |
| POST | `/api/records/bulk_approve/` | Approve all pending records |
| POST | `/api/records/lock_approved/` | Lock all approved records for audit |
| GET | `/api/audit-log/` | Append-only review history |

### Record filters

`GET /api/records/?review_status=FLAGGED&source_type=SAP_FUEL&scope=1`

Query params: `review_status`, `source_type`, `scope`, `run_id`, `period_start`, `period_end`, `site_code`, `page`.

---

## Data sources and expected formats

### 1. SAP Fuel & Procurement (`SAP_FUEL`)
Tab-delimited flat file from SAP transaction MB51 (Material Documents List).  
**Encoding:** UTF-8 with BOM or Windows-1252 (SAP European default).  
**Date format:** `DD.MM.YYYY` or `DD/MM/YYYY`.  
**Decimal format:** German (`1.234,56`) or Anglo-Saxon (`1234.56`).  
**Required columns:** `Buchungsdatum`, `Werk`, `Material`, `Materialkurztext`, `Menge`, `ME`.  
→ See `backend/sample_data/sap_export.txt` for a realistic example.

### 2. Utility Electricity (`UTILITY_ELEC`)
CSV modelled on Green Button Alliance standard (NAESB REQ.21).  
**Required columns:** `Meter ID`, `Billing Start`, `Billing End`, `Usage (kWh)` or `Usage (MWh)`.  
**Optional columns:** `Account Number`, `Rate Schedule`, `Peak Demand (kW)`, `Cost (USD)`.  
→ See `backend/sample_data/utility_electricity.csv`.

### 3. Corporate Travel (`CORP_TRAVEL`)
CSV modelled on SAP Concur Analytics expense report export.  
**Required columns:** `Expense Type`, `Travel Date`, `Amount`, `Currency`.  
**Optional columns:** `Origin`, `Destination`, `Class of Service`, `Distance (mi)`, `Nights`.  
→ See `backend/sample_data/corporate_travel.csv`.

---

## Documentation

| File | Contents |
|------|----------|
| [MODEL.md](MODEL.md) | Data model, design rationale, ER diagram, unit normalisation table |
| [DECISIONS.md](DECISIONS.md) | Every ambiguity resolved, format choices, PM questions |
| [TRADEOFFS.md](TRADEOFFS.md) | Three things deliberately not built and why |
| [SOURCES.md](SOURCES.md) | Research on each source format, sample data rationale, production risks |

---

## Running tests

```bash
cd backend
python manage.py test
```

Basic unit tests cover the parsers, unit normaliser, and anomaly detection.

---

## Project structure

```
tech_assignment/
├── backend/
│   ├── breathe_esg/          # Django project (settings, urls, wsgi)
│   ├── ingestion/            # Single Django app
│   │   ├── models.py         # All models
│   │   ├── parsers.py        # SAP, utility, travel parsers
│   │   ├── validators.py     # Anomaly detection
│   │   ├── serializers.py    # DRF serializers
│   │   ├── views.py          # API views
│   │   └── management/commands/create_demo_data.py
│   ├── sample_data/          # Realistic sample files
│   ├── requirements.txt
│   ├── Procfile
│   └── build.sh              # Render build script
├── frontend/
│   └── src/
│       ├── pages/            # Dashboard, Ingest, Review, AuditLog
│       └── components/       # Layout, Badge, FlagList
├── MODEL.md
├── DECISIONS.md
├── TRADEOFFS.md
├── SOURCES.md
├── docker-compose.yml
└── render.yaml
```

# RouteIQ — Delivery Route Planning & Live Fleet Mapping

RouteIQ plans delivery routes and visualises a live fleet on real maps. Addresses are
geocoded on the server, routes are calculated by a real routing engine, and every
position drawn on the map comes from the database — nothing is generated in the browser.

> **Scope:** map rendering, geocoding, route *preview* and multi-vehicle route
> *optimisation* (CVRPTW) are implemented. Live GPS streaming and WebSockets are
> explicitly **not** implemented.

---

## What is real

| Concern | Implementation |
| --- | --- |
| Basemap | Leaflet + keyless OpenStreetMap raster tiles, served from `GET /api/v1/maps/config`. The dark style is the same tiles with a CSS filter, so there is no second provider or API key |
| Geocoding | OpenStreetMap Nominatim (address → coordinates, and reverse) |
| Routing | OSRM (`router.project-osrm.org`) — real road distance, duration and geometry |
| Route optimisation | Google OR-Tools RoutingModel — capacitated VRP with time windows and shift availability |
| Vehicle positions | `vehicles.current_latitude` / `current_longitude` in the database |
| Delivery positions | Geocoded by the backend from the delivery address on create/update |

All three providers sit behind abstractions (`GeocodingService`, `RoutingService`,
`MapProvider`) selected by environment variables, so swapping in Google/Mapbox/GraphHopper
means implementing one interface and registering it — no caller changes. The frontend never
calls a provider directly and no provider credential ever leaves the backend.

### Timestamps are UTC

Every timestamp the API returns is a **naive UTC** string (`2026-10-05T14:13:55.954927`),
which is what SQLAlchemy emits for a `DateTime` column with no timezone. `new Date()` on
such a string interprets it as *local* time, so the frontend must not parse timestamps
directly. Use the helpers in `frontend/src/utils/datetime.ts`:

```ts
formatApiClock(value)       // "14:13" in the viewer's zone
formatApiDate(value)        // "05 Oct 2026"
apiTimestampMs(value)       // for comparing against Date.now()
parseApiDate(value)         // a Date | null
```

Getting this wrong is not only a display error — anything comparing an API timestamp to
`Date.now()` (delay alerts, the analytics "overdue" count) silently shifts by the UTC
offset. `localInputToUtcIso` is the one exception: a `<input type="datetime-local">` value
is genuinely local wall-clock time and must be converted *to* UTC, not read as UTC.

---

## Route optimisation

`POST /api/v1/routes/optimize` solves a capacitated vehicle-routing problem with time windows
(CVRPTW) using OR-Tools. It is a real solver over real data:

- **Travel costs come from the routing provider.** The engine requests one
  `origin × destination` matrix from the provider (`/table` on OSRM) and minimises travel
  distance/time on that matrix. It never falls back to straight-line distance.
- **Data comes from the database.** Deliveries and vehicles are read from their tables.
  Deliveries without coordinates are geocoded first; if that fails they are reported, never
  invented.
- **Excluded records stay out.** Delivered/cancelled deliveries and unavailable/offline
  vehicles (or vehicles whose driver is inactive) are filtered before solving.
- **Hard constraints:** per-vehicle weight (`capacity_kg`) and volume (`capacity_m3`),
  delivery time windows (`time_window_start` / `time_window_end`), and the shift the whole
  plan must fit inside (`preferences.shift_start` / `preferences.shift_end`).
- **Waiting is modelled.** A vehicle that arrives before a window opens waits, and the
  response reports the wait per stop.
- **Infeasibility is explained, never faked.** Provably impossible inputs are rejected with
  `422` (bad request) or `409` (valid request, no feasible plan) and a specific reason. Set
  `allow_partial: true` to get the best subset that fits plus an explicit `unassigned` list.
- **`409` always means "no plan exists"**, whether the pre-flight checks or the solver proved
  it. Pre-flight rejections return `{ "detail": "..." }`; solver-detected infeasibility
  returns the complete response body (`status: "infeasible"`, every delivery listed as
  `unassigned`) under the same `409`, so the UI can show *why* rather than a bare message.
- **`reference_time` defaults to `shift_start`**, or to now when no shift is given, so
  planning a past shift is anchored to that shift instead of to the current clock. A shift
  that has already closed is rejected rather than silently returning a plan.
- **A labelled baseline** compares the plan against a simple first-fit assignment, so the
  reported saving is measured rather than asserted.
- **Solving never blocks the event loop** — it runs in a worker thread with a time limit
  (`time_limit_seconds`, default 5s).
- **Nothing is assigned in the database.** The response is a proposal; writing it back is a
  separate, explicit action.

Response shape (abridged):

```jsonc
{
  "status": "optimal",              // optimal | feasible | partial | infeasible
  "summary": { "total_distance_km": 12.4, "deliveries_assigned": 5, "...": "..." },
  "routes": [
    {
      "vehicle_number": "V-201",
      "stops": [
        {
          "sequence": 1,
          "tracking_number": "RL-1001",
          "estimated_arrival": "2026-10-04T13:05:00",
          "wait_seconds": 0,
          "within_window": true
        }
      ],
      "capacity": { "used_kg": 40.0, "capacity_kg": 500.0, "utilization_percent": 8.0 },
      "geometry": [[12.97, 77.59], "..."],  // real road polyline, [lat, lng] pairs
      "bounds": [12.93, 77.55, 12.99, 77.64]  // [south, west, north, east]
    }
  ],
  "unassigned": [],
  "baseline": { "baseline": { "label": "..." }, "distance_saved_percent": 18.2 },
  "solver": { "wall_time_ms": 42, "matrix_degraded": false }
}
```

`GET /api/v1/routes/optimize/capabilities` reports the provider, limits and which
constraints the current data activates.

---

## 🏗️ Project Architecture

```
RouteIQ/
├── frontend/                      # React 19 + TypeScript + Vite
│   ├── src/
│   │   ├── components/
│   │   │   ├── map/FleetMap.tsx   # The single reusable Leaflet surface
│   │   │   └── TrackingMap.tsx    # Fleet telemetry view built on FleetMap
│   │   ├── context/
│   │   │   ├── FleetContext.tsx   # Vehicles, deliveries, drivers, tracking state
│   │   │   └── MapContext.tsx     # Basemap config from the backend
│   │   ├── pages/                 # Dashboard, Deliveries, Vehicles, Drivers, Planner, Maps, Tracking, Analytics, Settings
│   │   ├── services/api.ts        # REST client (no provider calls)
│   │   ├── utils/geo.ts           # GeoJSON → [lat, lng], formatting helpers
│   │   └── types/                 # Mirrors of the backend Pydantic schemas
│   └── vite.config.ts             # Dev proxy: /api → http://localhost:8000
└── backend/                       # Python + FastAPI
    └── app/
        ├── api/endpoints/         # routes, geocoding, maps, deliveries, tracking…
        ├── schemas/               # Pydantic request/response contracts
        └── services/
            ├── providers/         # Shared errors, throttled HTTP client, TTL cache
            ├── geocoding/         # GeocodingService + Nominatim + registry + resolver
            ├── routing/           # RoutingService + OSRM + registry
            ├── maps/              # MapProvider + tile style descriptors
            ├── route_preview_service.py   # Address → coordinates → route
            └── optimization/      # OR-Tools CVRPTW engine
                ├── models.py      # Dataclasses, statuses, objective, baseline
                ├── constraints.py # Eligibility, capacity and time-window checks
                ├── matrix.py      # Provider-native travel matrix
                ├── optimizer.py   # RoutingModel build, solve, audit
                └── service.py     # DB orchestration → API response
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+ & npm
- PostgreSQL (optional — SQLite works out of the box)

### 1. Backend

```bash
cd backend
python -m venv venv
# Windows: venv\Scripts\activate   Linux/macOS: source venv/bin/activate

pip install -r requirements.txt
# For PostgreSQL, add the driver:
pip install "psycopg[binary]"
copy .env.example .env

# Create the schema from the Alembic migrations (not create_all)
python -m alembic upgrade head

# Optional: load the demo fleet, drivers and deliveries
python seed.py

python -m uvicorn app.main:app --reload --port 8000
```

- API: `http://localhost:8000/api/v1`
- Swagger: `http://localhost:8000/docs`
- Health: `http://localhost:8000/api/v1/health`

#### Using PostgreSQL

```env
DATABASE_URL=postgresql+psycopg://routeiq:routeiq@127.0.0.1:5432/routeiq
```

Create the role and database once, then migrate:

```bash
createuser  --pwprompt routeiq
createdb    -O routeiq routeiq
python -m alembic upgrade head
python seed.py
```

The schema lives in `backend/alembic/versions/`. Useful commands:

```bash
python -m alembic current        # which revision is applied
python -m alembic upgrade head   # apply everything outstanding
python -m alembic check          # confirm models and migrations agree
python -m alembic downgrade base # tear the schema down (dev only)
```

`seed.py` is idempotent: re-running it restores the demo state, including
relative time windows and which vehicles are tracked, so the demo never drifts
into an empty map after a walkthrough.

> **Run `python seed.py` immediately before a demo.** Delivery time windows are
> anchored to the moment the script ran and stored as absolute UTC timestamps.
> A database left overnight will have every window in the past, and the Route
> Planner's "select all" will correctly report that no plan is feasible.

### 2. Frontend

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

Dashboard: `http://localhost:5173`

The dev server proxies `/api` to `http://localhost:8000`, so `VITE_API_BASE_URL=/api/v1`
works without CORS. Override with `VITE_BACKEND_URL` if the backend runs elsewhere.

---

## 🗺️ Mapping features

- **Route Planner** (`/planner`) — two modes:
  - *Optimize deliveries* (default): tick the deliveries to serve and optionally restrict the
    vehicles, set a travel profile, shift window and solver time limit, then get a real
    multi-vehicle plan. Each vehicle gets its own colour, numbered stops and road polyline on
    the map; select a vehicle to highlight it. The panel shows distance, duration, load,
    per-stop ETA and waiting time, window compliance, unassigned deliveries and any
    constraint violations, plus the saving against the labelled baseline.
  - *Route preview*: enter an origin, destination and up to 25 intermediate stops for a real
    route with distance, duration, snapped waypoints, per-leg breakdown and geometry. Stop
    order is preserved here — this mode does not reorder stops.
- **Maps** (`/maps`) — fleet vehicles and geocoded deliveries on one map, with address
  search, layer toggles and the active provider metadata.
- **Live Tracking** (`/tracking`) and the **Dashboard** map show tracked vehicles from the
  same `FleetContext` state, so both views always agree.
- **Deliveries** — the add-delivery dialog has a map: *Locate* geocodes the typed address,
  and clicking the map reverse-geocodes to fill the address. Coordinates are optional —
  the backend geocodes the address on save either way.
- **Time windows are entered as date + From/To clock times**, in the viewer's local zone,
  and converted to the API's naive-UTC convention on submit. A `To` earlier than `From`
  rolls into the next day (an overnight window) instead of being rejected.
- **Full CRUD from the UI.** Deliveries, vehicles and drivers can be created, edited and
  deleted from their pages; every write calls the API and the list re-reads from the
  database. Deletes go through a confirmation that states what else changes (a vehicle
  stops being tracked and releases its deliveries; a driver releases their vehicles).
- **Nothing is fabricated.** A vehicle or delivery with no stored coordinates is listed as
  "no position" and left off the map; the UI says so explicitly.
- **Accessibility.** Every map control is a real focusable button with an accessible name,
  markers expose `role="button"` plus an `aria-label` and respond to Enter/Space, and the
  basemap switcher uses `aria-pressed`.

---

## 🔌 API

### Mapping & routing

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/maps/config` | Basemap provider, tile styles, default viewport |
| `GET` | `/api/v1/maps/providers` | Basemap + routing + geocoding provider metadata |
| `POST` | `/api/v1/routes/preview` | Address/coordinates → real route preview |
| `POST` | `/api/v1/routes/optimize` | Deliveries + vehicles → optimized multi-vehicle plan (CVRPTW) |
| `GET` | `/api/v1/routes/optimize/capabilities` | Optimization limits, provider and active constraints |
| `GET` | `/api/v1/routes/providers` | Routing provider metadata & profiles |
| `POST` | `/api/v1/geocoding/geocode` | Address → coordinates |
| `POST` | `/api/v1/geocoding/reverse?latitude=&longitude=` | Coordinates → address |
| `GET` | `/api/v1/geocoding/providers` | Geocoding provider metadata |
| `POST` | `/api/v1/deliveries/{id}/geocode` | Re-resolve a delivery's coordinates |

### Core CRUD

Deliveries, vehicles and drivers are full create / read / update / delete resources — the
UI forms write straight through to PostgreSQL, and the list you see is what the database
holds.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/api/v1/deliveries` | List / create deliveries |
| `GET` / `PUT` / `DELETE` | `/api/v1/deliveries/{id}` | Read / update / delete a delivery |
| `GET` / `POST` | `/api/v1/vehicles` | List / create vehicles |
| `GET` / `PUT` / `DELETE` | `/api/v1/vehicles/{id}` | Read / update / delete a vehicle |
| `GET` / `POST` | `/api/v1/drivers` | List / create drivers |
| `GET` / `PUT` / `DELETE` | `/api/v1/drivers/{id}` | Read / update / delete a driver |
| `GET` | `/api/v1/drivers/{id}/vehicles` | Vehicles currently assigned to a driver |

Deleting a driver unassigns — but does not delete — the vehicles assigned to them, so a
driver can be removed without orphaning fleet records.

Route preview example:

```bash
curl -X POST http://localhost:8000/api/v1/routes/preview \
  -H "Content-Type: application/json" \
  -d '{
        "origin":      {"address": "MG Road, Bengaluru 560001"},
        "destination": {"address": "Whitefield Main Road, Bengaluru 560066"},
        "stops":       [{"address": "100 Feet Road, Indiranagar, Bengaluru 560038"}],
        "profile":     "driving"
      }'
```

Provider failures are normalised, never leaked:

| Status | Meaning |
| --- | --- |
| `422` | Invalid input (bad coordinates, address too short, too many stops) |
| `404` | Provider is healthy but found no match / no route |
| `429` | Provider rate limit reached |
| `502` | Provider unavailable or returned an unusable response |
| `504` | Provider timed out |

---

## 🔒 Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_NAME`, `APP_ENV`, `VERSION`, `DEBUG` | — | App metadata |
| `BACKEND_CORS_ORIGINS` | `["http://localhost:5173"]` | Allowed origins |
| `DATABASE_URL` | `sqlite:///./routeiq.db` | SQLAlchemy URL (SQLite or PostgreSQL) |
| `MAP_PROVIDER` | `openstreetmap` | Basemap provider id |
| `MAP_DEFAULT_STYLE` | `dark` | Style id used on first load |
| `MAP_DEFAULT_LATITUDE/LONGITUDE/ZOOM` | Bengaluru / 11 | Initial viewport |
| `GEOCODING_PROVIDER` | `nominatim` | Geocoding provider id |
| `GEOCODING_BASE_URL` | `https://nominatim.openstreetmap.org` | Provider endpoint |
| `GEOCODING_USER_AGENT` | RouteIQ | **Required** by Nominatim's usage policy |
| `GEOCODING_LANGUAGE`, `GEOCODING_TIMEOUT_SECONDS`, `GEOCODING_MIN_INTERVAL_SECONDS` | `en`, `10`, `1.0` | Request behaviour (1 req/s is Nominatim's limit) |
| `GEOCODING_CACHE_TTL_SECONDS`, `GEOCODING_CACHE_MAX_ENTRIES` | `86400`, `2048` | Server-side cache |
| `ROUTING_PROVIDER` | `osrm` | Routing provider id |
| `ROUTING_BASE_URL` | `https://router.project-osrm.org` | Routing endpoint |
| `ROUTING_PROFILE` | `driving` | Default profile |
| `ROUTING_TIMEOUT_SECONDS`, `ROUTING_MIN_INTERVAL_SECONDS` | `15`, `0.25` | Request behaviour |
| `ROUTING_CACHE_TTL_SECONDS`, `ROUTING_CACHE_MAX_ENTRIES` | `300`, `512` | Server-side cache |

The public Nominatim and OSRM demo servers are fine for development. For production, run
your own Nominatim/OSRM instance or use a commercial provider, and raise the cache TTLs.

### Frontend (`frontend/.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api/v1` | REST root, proxied by Vite in dev |
| `VITE_APP_NAME` | `RouteIQ` | UI branding |

---

## 🧪 Tests

```bash
cd backend
python -m pytest                       # 161 tests, no network access
ROUTEIQ_LIVE_PROVIDER_TESTS=1 python -m pytest tests/test_providers_live.py -v   # live provider smoke tests
```

The default suite runs entirely against deterministic fakes
(`backend/tests/provider_fakes.py`) — it never touches the network. Live provider checks
are opt-in via `ROUTEIQ_LIVE_PROVIDER_TESTS=1`.

```bash
cd frontend
npm run build     # type-check + production build
npm run lint
```

---

## 📡 Data Sources & Offline Behaviour

When the backend is unreachable the app logs a warning and falls back to bundled mock data
so every page stays navigable (`FleetContext.dataSource === 'mock'`). The map still renders
real OpenStreetMap tiles from the built-in fallback style, but no coordinates are invented:
in mock mode a new delivery is stored with `coordinates: null`.

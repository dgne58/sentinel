# How To Run

## Prerequisites

- Python 3.11+
- Node.js 18+
- `GeoLite2-City.mmdb` in `backend/` (download from maxmind.com — free account required)
- `backend/.env` with:
  ```
  CLOUDFLARE_TOKEN=your_token
  ABUSEIPDB_KEY=your_key
  ```

## Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt

# Live server (real APIs, port 8000)
.venv/Scripts/python main.py

# Simulator (synthetic data, no API keys, port 8001)
.venv/Scripts/python simulate.py
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## Health check

```bash
curl http://localhost:8000/health
```

Expected healthy response:
```json
{
  "status": "ok",
  "connected_clients": 1,
  "geo_cache_size": 100,
  "geo_db_available": true,
  "last_poll": { "cloudflare": "...", "abuseipdb": "...", "sans_isc": "..." },
  "event_deque_size": 412,
  "data_source": "live",
  "db_snapshot_count": 19500
}
```

If `geo_db_available` is `false`, download and place `GeoLite2-City.mmdb` in `backend/` and restart. If `data_source` is `"fallback"`, check API keys in `.env`.

## WebSocket smoke test

```bash
wscat -c ws://localhost:8000/ws/attacks
```

Should immediately receive a JSON array of events followed by a stats object.

---
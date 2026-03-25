# Gasman - Vancouver Gas Price Monitor

Real-time gas prices across Greater Vancouver, powered by GasBuddy data.

## Stack
- **Backend**: Python / FastAPI + py-gasbuddy
- **Frontend**: React + Vite

## Setup

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

## Features
- Live prices for Regular, Mid-grade, Premium, and Diesel
- Covers Downtown, East Van, North Van, Richmond, and Burnaby
- Sort by price or station name
- Highlights cheapest station per fuel type
- Auto-refreshes every 5 minutes
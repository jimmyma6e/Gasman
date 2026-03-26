# ── Stage 1: Build the React frontend ──────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
RUN cd frontend && npm run build

# ── Stage 2: Python backend with Playwright Chromium ───────────────────────
# Official Playwright image ships with all browser OS dependencies pre-installed
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy

WORKDIR /app

# Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Chromium browser for Playwright
RUN playwright install chromium

# App code
COPY backend/ .

# Built frontend → served as static files by FastAPI
COPY --from=frontend-build /app/frontend/dist ./static

EXPOSE 8000

# PORT is injected by Railway (defaults to 8000 locally)
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]

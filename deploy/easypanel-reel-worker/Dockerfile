# Playwright-maintained image: Chromium + Python bindings preinstalled.
# Pin tag to a known-good release; bump when you upgrade Playwright in main reelscraper.
#
# Entry is inlined (no docker-entrypoint.sh) so Windows CRLF in zip/git cannot break exec.

FROM mcr.microsoft.com/playwright/python:v1.49.0-jammy

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

COPY requirements-worker.txt /app/requirements-worker.txt
RUN python3 -m pip install --no-cache-dir --upgrade pip && \
    python3 -m pip install --no-cache-dir -r /app/requirements-worker.txt && \
    python3 -c "from playwright.async_api import async_playwright; print('playwright import ok')"

COPY reelscraper/ /app/reelscraper/
COPY app/ /app/app/

# EasyPanel / platforms often inject PORT (e.g. 80)
ENV PORT=8790
EXPOSE 8790

# Same Python for pip + uvicorn; optional runtime pip if layer was skipped; ${PORT} from env
CMD ["sh", "-c", "set -e; cd /app; if ! python3 -c \"import playwright\" 2>/dev/null; then echo '[reel-worker] installing deps...'; python3 -m pip install --no-cache-dir -r /app/requirements-worker.txt; fi; python3 -c \"import playwright\"; exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8790}"]

"""HTTP API for Instagram reel scraping (Playwright). Used by ModelClone API via REEL_SCRAPER_WORKER_URL."""

from __future__ import annotations

import os
import sys
from typing import Any, Optional

from fastapi import Depends, FastAPI, Form, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

# /app/reelscraper package (copied from repo by scripts/sync-easypanel-reel-worker.mjs)
sys.path.insert(0, "/app")

from reelscraper.scraper import scrape_profile_reels, scrape_reel_url

WORKER_VERSION = "1.4.2"

app = FastAPI(title="ModelClone reel worker", version=WORKER_VERSION)
security = HTTPBearer(auto_error=False)

EXPECTED_SECRET = (os.environ.get("REEL_SCRAPER_WORKER_SECRET") or "").strip()


def require_auth(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> None:
    if not EXPECTED_SECRET:
        return
    if not creds or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Missing bearer token")
    if (creds.credentials or "").strip() != EXPECTED_SECRET:
        raise HTTPException(status_code=403, detail="Invalid token")


class ProfileBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    limit: int = Field(27, ge=1, le=80)


class ReelBody(BaseModel):
    url: str = Field(..., min_length=12, max_length=2048)


@app.get("/")
async def root() -> dict[str, Any]:
    """Hit this after deploy: if `routes` does not include profile-form, the image is outdated."""
    return {
        "service": "modelclone-reel-worker",
        "version": WORKER_VERSION,
        "routes": [
            "GET /health",
            "POST /v1/scrape/profile",
            "POST /v1/scrape/profile-form",
            "POST /v1/scrape/reel",
            "POST /v1/scrape/reel-form",
        ],
    }


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": WORKER_VERSION}


async def _scrape_profile(body: ProfileBody) -> list[dict[str, Any]]:
    u = body.username.strip().lstrip("@").lower()
    try:
        return await scrape_profile_reels(u, limit=body.limit, headless=True)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:2000]) from e


async def _scrape_reel(body: ReelBody) -> list[dict[str, Any]]:
    try:
        row = await scrape_reel_url(body.url.strip(), headless=True)
        return [row] if row else []
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:2000]) from e


@app.post("/v1/scrape/profile")
async def scrape_profile(
    body: ProfileBody,
    _: None = Depends(require_auth),
) -> list[dict[str, Any]]:
    return await _scrape_profile(body)


@app.post("/v1/scrape/profile-form")
async def scrape_profile_form(
    username: str = Form(...),
    limit: int = Form(27),
    _: None = Depends(require_auth),
) -> list[dict[str, Any]]:
    """Same as /v1/scrape/profile but uses form fields (avoids Windows curl JSON quoting issues)."""
    return await _scrape_profile(ProfileBody(username=username, limit=limit))


@app.post("/v1/scrape/reel")
async def scrape_reel(
    body: ReelBody,
    _: None = Depends(require_auth),
) -> list[dict[str, Any]]:
    return await _scrape_reel(body)


@app.post("/v1/scrape/reel-form")
async def scrape_reel_form(
    url: str = Form(...),
    _: None = Depends(require_auth),
) -> list[dict[str, Any]]:
    """Same as /v1/scrape/reel but uses a form field (avoids Windows curl JSON quoting issues)."""
    return await _scrape_reel(ReelBody(url=url))

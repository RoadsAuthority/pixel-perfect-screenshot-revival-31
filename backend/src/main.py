"""
Clinic Archive API — FastAPI entry point for Render.

Render start command:  uvicorn src.main:app --host 0.0.0.0 --port $PORT
Root dir:              backend/
"""

import logging
import os
import sys
from pathlib import Path

# Make sibling modules (handler.py) importable whether uvicorn is started as
# `src.main:app` from backend/ or as `main:app --app-dir src`.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import boto3
from botocore.exceptions import ClientError
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from handler import ArchiveError, dispatch

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Clinic Archive API",
    description="Role-based rural health clinic archive backed by AWS Bedrock and DynamoDB.",
    version="1.0.0",
    docs_url="/docs",       # Swagger UI at /docs — handy for manual testing
    redoc_url="/redoc",
)

# CORS — Render exposes HTTPS automatically, so this is safe.
# Set ALLOWED_ORIGIN in Render's environment variables to restrict to your
# Lovable app URL in production (e.g. https://your-app.lovable.app).
_allowed_origins_raw = os.environ.get("ALLOWED_ORIGIN", "*")
_allowed_origins = (
    ["*"] if _allowed_origins_raw.strip() == "*"
    else [o.strip() for o in _allowed_origins_raw.split(",") if o.strip()]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    max_age=300,
)


# ── AWS client factory (cached at module level after first request) ────────────

_clients_cache: dict | None = None


def _get_clients() -> dict:
    global _clients_cache
    if _clients_cache is not None:
        return _clients_cache

    region = os.environ.get("AWS_REGION", "eu-north-1")
    dynamodb = boto3.resource("dynamodb", region_name=region)

    _clients_cache = {
        "users_table":    dynamodb.Table(_require_env("AUTH_USERS_TABLE")),
        "sessions_table": dynamodb.Table(_require_env("AUTH_SESSIONS_TABLE")),
        "audit_table":    dynamodb.Table(_require_env("AUDIT_TABLE")),
        "bedrock":        boto3.client("bedrock-agent-runtime", region_name=region),  # Knowledge Base retrieve
        "bedrock_runtime": boto3.client("bedrock-runtime", region_name=region),     # Converse (generation)
        "s3":             boto3.client("s3", region_name=region),
    }
    return _clients_cache


def _get_config() -> dict:
    return {
        "knowledge_base_id":    _require_env("KB_ID"),
        "generation_model_arn": _require_env("GENERATION_MODEL_ARN"),
        "archive_bucket":       _require_env("BUCKET_NAME"),
    }


def _require_env(key: str) -> str:
    value = os.environ.get(key, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return value


# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict:
    """Render uses this to confirm the service is up."""
    return {"status": "ok", "service": "clinic-archive"}


# ── Main archive endpoint ──────────────────────────────────────────────────────

@app.post("/archive")
async def archive(request: Request) -> JSONResponse:
    """
    Single endpoint for all archive actions.

    Request body (JSON):
      { "action": "verify"|"ask"|"summary"|"logs"|"ussd", ... }

    Authorization:
      verify  — sends user_id + pin in body, receives token in response
      all others — sends Authorization: Bearer <token> header
    """
    # Parse body
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"message": "The request body must be valid JSON."})

    if not isinstance(body, dict):
        return JSONResponse(status_code=400, content={"message": "The request body must be a JSON object."})

    # Extract Authorization header
    auth_header = request.headers.get("authorization", "")

    try:
        clients = _get_clients()
        config  = _get_config()
        status_code, payload = dispatch(body, clients, config, auth_header)
        return JSONResponse(status_code=status_code, content=payload)

    except ArchiveError as err:
        return JSONResponse(status_code=err.status_code, content={"message": str(err)})

    except ClientError:
        logger.exception("AWS service error on action=%s", body.get("action"))
        return JSONResponse(
            status_code=502,
            content={"message": "The clinic archive service could not complete this request."},
        )

    except RuntimeError as err:
        # Missing env vars — surface clearly in Render logs
        logger.error("Configuration error: %s", err)
        return JSONResponse(
            status_code=500,
            content={"message": "The server is not configured correctly. Contact the administrator."},
        )

    except Exception:
        logger.exception("Unexpected error on action=%s", body.get("action"))
        return JSONResponse(
            status_code=500,
            content={"message": "An unexpected error occurred. Please try again."},
        )

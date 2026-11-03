"""Configuration settings for Civora Backend."""
import os
import sys
import logging
from pathlib import Path
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load from root or local .env if available
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(ROOT_DIR / ".env")

# Server Config
PORT = int(os.getenv("PORT", 8000))
HOST = os.getenv("HOST", "0.0.0.0")

# AI Microservice URL (can run in-process or via HTTP)
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://127.0.0.1:8001")

# Vercel / Production environment detection
IS_VERCEL = bool(os.getenv("VERCEL"))
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

# Storage
if IS_VERCEL:
    UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/tmp/uploads")
    DB_PATH = os.getenv("DB_PATH", "/tmp/civora.db")
    if not os.path.exists(DB_PATH):
        seed_db = ROOT_DIR / "civora.db"
        if seed_db.exists():
            import shutil
            try:
                shutil.copy(seed_db, DB_PATH)
            except Exception:
                pass
else:
    UPLOAD_DIR = os.getenv("UPLOAD_DIR", str(ROOT_DIR / "uploads"))
    DB_PATH = os.getenv("DB_PATH", str(ROOT_DIR / "civora.db"))

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(os.path.join(UPLOAD_DIR, "reports"), exist_ok=True)
os.makedirs(os.path.join(UPLOAD_DIR, "resolutions"), exist_ok=True)

# Security & Secrets
DEFAULT_DEV_SECRET = "civora-super-secret-key-capstone-2026"
SECRET_KEY = os.getenv("SECRET_KEY", DEFAULT_DEV_SECRET)
if ENVIRONMENT == "production" and SECRET_KEY == DEFAULT_DEV_SECRET:
    logger.warning("CRITICAL SECURITY WARNING: Production environment is using default SECRET_KEY! Set SECRET_KEY in environment variables.")

ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 1440))

# CORS Configuration
raw_origins = os.getenv("ALLOWED_ORIGINS", "")
if raw_origins:
    ALLOWED_ORIGINS = [o.strip() for o in raw_origins.split(",") if o.strip()]
else:
    ALLOWED_ORIGINS = [
        "http://localhost:3000",
        "http://localhost:8000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000"
    ]

# Duplicate Detection threshold (in meters)
DUPLICATE_RADIUS_METERS = float(os.getenv("DUPLICATE_RADIUS_METERS", 50.0))

"""Configuration settings for Civora Backend."""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load from root or local .env if available
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(ROOT_DIR / ".env")

# Server Config
PORT = int(os.getenv("PORT", 8000))
HOST = os.getenv("HOST", "0.0.0.0")

# AI Microservice URL (can run in-process or via HTTP)
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://127.0.0.1:8001")

# Vercel environment detection (Vercel filesystem is read-only except /tmp)
IS_VERCEL = bool(os.getenv("VERCEL"))

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

# Security
SECRET_KEY = os.getenv("SECRET_KEY", "civora-super-secret-key-capstone-2026")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 1440))

# Duplicate Detection threshold (in meters)
DUPLICATE_RADIUS_METERS = float(os.getenv("DUPLICATE_RADIUS_METERS", 50.0))

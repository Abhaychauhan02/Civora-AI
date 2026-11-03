"""Civora Central Backend API Server."""
import os
import sys
from pathlib import Path

# Ensure project root and app directory are always in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
APP_DIR = Path(__file__).resolve().parent
for p in [str(ROOT_DIR), str(APP_DIR)]:
    if p not in sys.path:
        sys.path.insert(0, p)

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.app.config import PORT, HOST, UPLOAD_DIR
from backend.app.database import init_db, get_db
from backend.app.auth import hash_password
from backend.app.routes.auth_routes import router as auth_router
from backend.app.routes.report_routes import router as report_router
from backend.app.routes.issue_routes import router as issue_router
from backend.app.routes.analytics_routes import router as analytics_router


def seed_initial_accounts():
    """Seeds default admin and test citizen accounts if empty for instant testing."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as count FROM users")
        if cursor.fetchone()["count"] == 0:
            # Create Default Admin
            cursor.execute("""
                INSERT INTO users (id, email, password_hash, full_name, role, phone)
                VALUES (?, ?, ?, ?, 'ADMIN', ?)
            """, (
                "usr_admin_01",
                "admin@civora.org",
                hash_password("admin123"),
                "Campus Facility Director",
                "+1-555-0199"
            ))

            # Create Default Citizen
            cursor.execute("""
                INSERT INTO users (id, email, password_hash, full_name, role, phone)
                VALUES (?, ?, ?, ?, 'CITIZEN', ?)
            """, (
                "usr_citizen_01",
                "citizen@civora.org",
                hash_password("citizen123"),
                "Abhay Chauhan",
                "+1-555-0142"
            ))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Ensure tables and directories exist
    init_db()
    seed_initial_accounts()
    yield


app = FastAPI(
    title="Civora Backend API",
    description="Central backend for Civora: Issue Lifecycle, Citizen Reports, Duplicate Clustering & Management",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for frontend PWA
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded report & resolution images
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Register routers
app.include_router(auth_router)
app.include_router(report_router)
app.include_router(issue_router)
app.include_router(analytics_router)


@app.get("/api/health")
def health():
    return {
        "platform": "Civora Civic Issue Management Platform",
        "status": "online",
        "docs_url": "/docs",
        "api_version": "1.0.0"
    }


# Mount Frontend Progressive Web Application at root
frontend_dir = os.path.join(ROOT_DIR, "frontend")
if not os.path.exists(frontend_dir):
    frontend_dir = os.path.join(APP_DIR, "frontend")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)

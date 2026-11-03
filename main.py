"""Civora Central Application Entrypoint for Vercel, Docker & Local Dev."""
import os
import sys
from pathlib import Path

# Add project root to sys.path so 'backend' and 'src' modules resolve cleanly
ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# Export FastAPI app for Vercel and ASGI servers
from backend.main import app

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)

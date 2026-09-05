#!/usr/bin/env bash
# Civora Platform Start Script

echo "🚀 Starting Civora Platform..."

# Ensure we are in project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate Virtual Environment if present
if [ -d "venv" ]; then
    echo "📦 Activating venv..."
    source venv/bin/activate
fi

# Ensure storage directories exist
mkdir -p uploads/reports uploads/resolutions temp_uploads

echo "Starting Backend & PWA at http://localhost:8000"
python backend/main.py

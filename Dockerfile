# Civora Multi-Service Dockerfile
FROM python:3.11-slim

# Install system dependencies for OpenCV and SQLite
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependencies list
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Ensure storage directories exist
RUN mkdir -p uploads/reports uploads/resolutions temp_uploads

# Default port
EXPOSE 8000 8001

# Run central backend server
CMD ["python", "backend/main.py"]

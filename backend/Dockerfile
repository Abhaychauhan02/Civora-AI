# Civora Multi-Service Dockerfile (Backend Subdirectory)
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Link /app to /app/backend so 'from backend.app' imports work seamlessly
RUN ln -sf /app /app/backend

# Ensure storage directories exist
RUN mkdir -p uploads/reports uploads/resolutions temp_uploads

ENV PORT=10000
EXPOSE 10000 8000

CMD ["python", "main.py"]

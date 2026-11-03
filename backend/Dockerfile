# Civora Multi-Service Dockerfile (Backend Subdirectory)
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root requirements if building from root, or local requirements if building from backend
COPY requirements.txt* ./
RUN if [ -f "requirements.txt" ]; then pip install --no-cache-dir -r requirements.txt; fi

COPY . .

RUN mkdir -p uploads/reports uploads/resolutions temp_uploads

ENV PORT=10000
EXPOSE 10000 8000

CMD ["python", "main.py"]

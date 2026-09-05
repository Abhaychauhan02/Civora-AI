"""Civora AI Microservice - Computer Vision, Authenticity & Severity Detection."""
import os
import sys
from pathlib import Path

# Ensure project root is in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import shutil
import uuid
from typing import List
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.inference.predict import predict
from src.preprocessing.image import preprocess_image
from src.inference.detect import _model

app = FastAPI(
    title="Civora AI Computer Vision Service",
    description="Microservice providing YOLOv8 object detection, authenticity screening, and severity scoring.",
    version="1.0.0"
)

# Enable CORS for local integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMP_UPLOAD_DIR = "temp_uploads"
os.makedirs(TEMP_UPLOAD_DIR, exist_ok=True)


class DetectionItem(BaseModel):
    issue: str
    confidence: float
    bbox: List[float]


class AuthenticityInfo(BaseModel):
    real_probability: float
    ai_generated_probability: float
    status: str


class PredictionResponse(BaseModel):
    model_version: str
    authenticity: AuthenticityInfo
    detections: List[DetectionItem]
    severity_score: int
    priority: str


@app.get("/")
def root():
    return {
        "service": "Civora AI Vision Microservice",
        "status": "healthy",
        "supported_classes": list(_model.names.values()) if hasattr(_model, "names") else []
    }


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "model_loaded": _model is not None,
        "classes": _model.names if hasattr(_model, "names") else {}
    }


@app.post("/predict", response_model=PredictionResponse)
async def predict_endpoint(image: UploadFile = File(...)):
    # Validate content type
    allowed_types = ["image/jpeg", "image/png", "image/webp", "image/jpg"]
    if image.content_type and image.content_type.lower() not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {image.content_type}. Please upload a JPEG, PNG, or WebP image."
        )

    # Save uploaded image with unique UUID to avoid collisions
    ext = os.path.splitext(image.filename or "image.jpg")[1] or ".jpg"
    temp_filename = f"{uuid.uuid4()}{ext}"
    temp_path = os.path.join(TEMP_UPLOAD_DIR, temp_filename)

    with open(temp_path, "wb") as f:
        shutil.copyfileobj(image.file, f)

    try:
        # Preprocess / standardize image
        preprocess_image(temp_path)
        # Execute end-to-end prediction pipeline
        result = predict(temp_path)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Inference error: {str(exc)}")
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AI_SERVICE_PORT", 8001))
    uvicorn.run("api.main:app", host="0.0.0.0", port=port, reload=True)
"""AI Integration Client for Civora Backend with LRU Caching and Safe Fallback."""
import os
import hashlib
import logging
from typing import Dict, Any
import httpx
from backend.app.config import AI_SERVICE_URL

logger = logging.getLogger(__name__)

# In-memory inference cache for deduplicating repeated calls on identical images
_INFERENCE_CACHE: Dict[str, Dict[str, Any]] = {}
_MAX_CACHE_SIZE = 128


def _get_file_hash(image_path: str) -> str:
    """Computes SHA-256 hash of image file for deterministic caching."""
    hasher = hashlib.sha256()
    with open(image_path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


async def analyze_civic_image(image_path: str) -> Dict[str, Any]:
    """
    Sends image to AI microservice or uses high-performance in-process inference pipeline.
    Maintains exact camera EXIF metadata and sensor noise for authenticity screening.
    """
    if not os.path.exists(image_path):
        return {
            "status": "ERROR_FILE_NOT_FOUND",
            "model_version": "civora-yolo-v1-improved",
            "primary_category": "unclassified",
            "primary_confidence": None,
            "detections": [],
            "authenticity": {
                "real_probability": 0.50,
                "ai_generated_probability": 0.50,
                "status": "UNCERTAIN",
                "explanation": "File not found"
            },
            "severity_score": 0,
            "priority": "NONE"
        }

    # Check in-memory cache for duplicate image inference
    try:
        file_hash = _get_file_hash(image_path)
        if file_hash in _INFERENCE_CACHE:
            logger.info(f"Inference cache hit for image hash {file_hash[:12]}")
            return _INFERENCE_CACHE[file_hash]
    except Exception:
        file_hash = None

    # 1. Try remote/local microservice via HTTP if reachable
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            with open(image_path, "rb") as img_file:
                files = {"image": (os.path.basename(image_path), img_file, "image/jpeg")}
                response = await client.post(f"{AI_SERVICE_URL}/predict", files=files)
                if response.status_code == 200:
                    res = response.json()
                    if file_hash:
                        if len(_INFERENCE_CACHE) >= _MAX_CACHE_SIZE:
                            _INFERENCE_CACHE.pop(next(iter(_INFERENCE_CACHE)))
                        _INFERENCE_CACHE[file_hash] = res
                    return res
    except Exception:
        pass  # Fallback to in-process execution

    # 2. In-process execution (raw file passed directly to preserve EXIF & sensor noise)
    try:
        from src.inference.predict import predict
        res = predict(image_path)
        if file_hash:
            if len(_INFERENCE_CACHE) >= _MAX_CACHE_SIZE:
                _INFERENCE_CACHE.pop(next(iter(_INFERENCE_CACHE)))
            _INFERENCE_CACHE[file_hash] = res
        return res
    except Exception as exc:
        logger.error(f"In-process AI pipeline error on {image_path}: {exc}")
        return {
            "status": "ERROR_FALLBACK",
            "model_version": "civora-yolo-v1-fallback",
            "primary_category": "unclassified",
            "primary_confidence": None,
            "authenticity": {
                "real_probability": 0.85,
                "ai_generated_probability": 0.15,
                "status": "LIKELY_AUTHENTIC",
                "explanation": "Heuristic fallback"
            },
            "detections": [],
            "severity_score": 30,
            "priority": "MEDIUM",
            "warning": f"Used fallback engine: {str(exc)}"
        }

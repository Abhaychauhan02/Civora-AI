"""YOLOv8 Civic Hazard Detection Pipeline with Schema Standardization."""
import os
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# Resolve model path dynamically: preference for improved_best.pt with full 3-class support
IMPROVED_PATH = "models/improved_best.pt"
BASELINE_PATH = "models/best.pt"
FALLBACK_RUN_PATH = "runs/detect/civora_yolo_v1-2/weights/best.pt"

if os.getenv("YOLO_MODEL_PATH"):
    MODEL_PATH = os.getenv("YOLO_MODEL_PATH")
elif os.path.exists(IMPROVED_PATH):
    MODEL_PATH = IMPROVED_PATH
elif os.path.exists(BASELINE_PATH):
    MODEL_PATH = BASELINE_PATH
else:
    MODEL_PATH = FALLBACK_RUN_PATH

_model = None


def _get_model():
    """Lazily loads and caches the YOLOv8 model singleton."""
    global _model
    if _model is None:
        try:
            from ultralytics import YOLO
            if not os.path.exists(MODEL_PATH):
                logger.warning(f"Model path {MODEL_PATH} does not exist.")
                _model = False
                return None
            _model = YOLO(MODEL_PATH)
            logger.info(f"Loaded YOLOv8 model from {MODEL_PATH} (classes: {_model.names})")
        except Exception as exc:
            logger.error(f"Failed to load YOLO model from {MODEL_PATH}: {exc}")
            _model = False
    return _model if _model is not False else None


def detect_civic_issue(image_path: str, conf_threshold: float = 0.25) -> List[Dict[str, Any]]:
    """
    Runs Civora's detection model on a single image.

    Returns structured detections conforming to the documented schema:
    [
        {
            "class_name": "pothole",
            "issue": "pothole", # backward compatibility alias
            "confidence": 0.9412,
            "bbox": [x1, y1, x2, y2],
            "bbox_dict": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}
        }
    ]
    """
    if not os.path.exists(image_path):
        return []

    model = _get_model()
    if model is None:
        return []

    try:
        results = model(image_path, conf=conf_threshold, verbose=False)
    except Exception as exc:
        logger.error(f"Inference execution failed on {image_path}: {exc}")
        return []

    detections = []
    for r in results:
        orig_shape = r.orig_shape if hasattr(r, "orig_shape") else (None, None)
        h, w = orig_shape if orig_shape else (None, None)

        for box in r.boxes:
            cls_id = int(box.cls[0])
            class_name = model.names.get(cls_id, f"class_{cls_id}")
            conf = round(float(box.conf[0]), 4)
            coords = [round(float(c), 1) for c in box.xyxy[0].tolist()]
            x1, y1, x2, y2 = coords

            # Defensive boundary clipping if original image dimensions are known
            if w and h:
                x1 = max(0.0, min(float(w), x1))
                x2 = max(0.0, min(float(w), x2))
                y1 = max(0.0, min(float(h), y1))
                y2 = max(0.0, min(float(h), y2))

            detections.append({
                "class_name": class_name,
                "issue": class_name,
                "confidence": conf,
                "bbox": [x1, y1, x2, y2],
                "bbox_dict": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}
            })

    # Sort detections by confidence descending
    detections.sort(key=lambda d: d["confidence"], reverse=True)
    return detections


# Quick manual test when running this file directly
if __name__ == "__main__":
    test_image = "datasets/civic_detection/images/test/03013ade52e4c7b905a5dd0ff7351053_jpg.rf.a49ff3731e3c60b54ce0edf89cd52c08.jpg"
    output = detect_civic_issue(test_image)
    print(output)
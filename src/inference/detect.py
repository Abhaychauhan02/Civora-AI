"""YOLOv8 Civic Hazard Detection Pipeline with Schema Standardization."""
import os
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# Resolve model paths: improved model (with streetlight support) as primary, baseline as secondary cascade
IMPROVED_PATH = "models/improved_best.pt"
BASELINE_PATH = "models/best.pt"
FALLBACK_RUN_PATH = "runs/detect/civora_yolo_v1-2/weights/best.pt"

_primary_model = None
_secondary_model = None


def _get_models():
    """Lazily loads and caches the primary improved YOLOv8 model and baseline secondary model."""
    global _primary_model, _secondary_model
    if _primary_model is None:
        try:
            from ultralytics import YOLO
            primary_path = os.getenv("YOLO_MODEL_PATH", IMPROVED_PATH if os.path.exists(IMPROVED_PATH) else BASELINE_PATH)
            if os.path.exists(primary_path):
                _primary_model = YOLO(primary_path)
                logger.info(f"Loaded primary YOLOv8 model from {primary_path} (classes: {_primary_model.names})")
            else:
                _primary_model = False

            # Secondary model for challenging low-light / wet pavement defects
            if os.path.exists(BASELINE_PATH) and primary_path != BASELINE_PATH:
                _secondary_model = YOLO(BASELINE_PATH)
                logger.info(f"Loaded secondary cascade YOLOv8 model from {BASELINE_PATH}")
            else:
                _secondary_model = None
        except Exception as exc:
            logger.error(f"Failed to load YOLO model: {exc}")
            _primary_model = False
    return (_primary_model if _primary_model is not False else None, _secondary_model)


def _get_model():
    """Backwards-compatible accessor returning the primary cached YOLO model."""
    primary, _ = _get_models()
    return primary


def detect_civic_issue(image_path: str, conf_threshold: float = 0.25) -> List[Dict[str, Any]]:
    """
    Runs Civora's detection model on a single image.
    Uses multi-model cascade: primary improved model, cascading to baseline for low-light road hazards.

    Returns structured detections conforming to the documented schema:
    [
        {
            "class_name": "pothole",
            "issue": "pothole", # backward compatibility alias
            "confidence": 0.9412,
            "bbox": [x1, y1, x2, y2],
            "bbox_dict": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
            "model_source": "primary"
        }
    ]
    """
    if not os.path.exists(image_path):
        return []

    primary_model, secondary_model = _get_models()
    if primary_model is None and secondary_model is None:
        return []

    def _extract_boxes(model, conf_thresh, source_tag):
        found = []
        try:
            results = model(image_path, conf=conf_thresh, verbose=False)
            for r in results:
                orig_shape = r.orig_shape if hasattr(r, "orig_shape") else (None, None)
                h, w = orig_shape if orig_shape else (None, None)

                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    class_name = model.names.get(cls_id, f"class_{cls_id}")
                    conf = round(float(box.conf[0]), 4)
                    coords = [round(float(c), 1) for c in box.xyxy[0].tolist()]
                    x1, y1, x2, y2 = coords

                    if w and h:
                        x1 = max(0.0, min(float(w), x1))
                        x2 = max(0.0, min(float(w), x2))
                        y1 = max(0.0, min(float(h), y1))
                        y2 = max(0.0, min(float(h), y2))

                    found.append({
                        "class_name": class_name,
                        "issue": class_name,
                        "confidence": conf,
                        "bbox": [x1, y1, x2, y2],
                        "bbox_dict": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                        "model_source": source_tag
                    })
        except Exception as exc:
            logger.error(f"Inference execution failed on {image_path}: {exc}")
        return found

    # 1. Primary improved model run
    detections = []
    if primary_model:
        detections = _extract_boxes(primary_model, conf_threshold, "improved")

    # 2. If primary yields no detections, cascade to secondary model at 0.20 threshold for low-light road defects
    if not detections and secondary_model:
        detections = _extract_boxes(secondary_model, min(conf_threshold, 0.20), "baseline_fallback")

    # Sort detections by confidence descending
    detections.sort(key=lambda d: d["confidence"], reverse=True)
    return detections


# Quick manual test when running this file directly
if __name__ == "__main__":
    test_image = "datasets/civic_detection/images/test/03013ade52e4c7b905a5dd0ff7351053_jpg.rf.a49ff3731e3c60b54ce0edf89cd52c08.jpg"
    output = detect_civic_issue(test_image)
    print(output)
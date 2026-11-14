"""YOLOv8 Civic Hazard Detection Pipeline with Schema Standardization."""
from PIL import Image, ImageOps
import os
import logging
from typing import List, Dict, Any, Optional, Tuple

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


def get_image_dimensions(image_path: str) -> Tuple[int, int]:
    """Retrieves normalized image dimensions respecting EXIF orientation tags."""
    try:
        with Image.open(image_path) as img:
            transposed = ImageOps.exif_transpose(img)
            return transposed.width, transposed.height
    except Exception as exc:
        logger.warning(f"Failed to read image dimensions for {image_path}: {exc}")
        return 640, 640


def detect_civic_issue_detailed(image_path: str, conf_threshold: float = 0.25) -> Dict[str, Any]:
    """
    Runs Civora's detection pipeline on a single image and returns complete
    instance-level defect localization metadata, image dimensions, and schema.
    """
    if not os.path.exists(image_path):
        return {
            "image_width": 640,
            "image_height": 640,
            "detections": [],
            "status": "ERROR_FILE_NOT_FOUND",
            "model_version": "civora-yolo-v1-improved"
        }

    img_w, img_h = get_image_dimensions(image_path)
    primary_model, secondary_model = _get_models()
    if primary_model is None and secondary_model is None:
        return {
            "image_width": img_w,
            "image_height": img_h,
            "detections": [],
            "status": "NO_MODEL_LOADED",
            "model_version": "civora-yolo-v1-improved"
        }

    def _extract_boxes(model, conf_thresh, source_tag):
        found = []
        try:
            results = model(image_path, conf=conf_thresh, verbose=False)
            for r in results:
                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    class_name = model.names.get(cls_id, f"class_{cls_id}")
                    conf = round(float(box.conf[0]), 4)
                    coords = [round(float(c), 1) for c in box.xyxy[0].tolist()]
                    x1, y1, x2, y2 = coords

                    if img_w and img_h:
                        x1 = max(0.0, min(float(img_w), x1))
                        x2 = max(0.0, min(float(img_w), x2))
                        y1 = max(0.0, min(float(img_h), y1))
                        y2 = max(0.0, min(float(img_h), y2))

                    box_area = max(0.0, (x2 - x1) * (y2 - y1))
                    total_area = float(img_w * img_h) if (img_w and img_h) else 1.0
                    area_ratio = round(box_area / total_area, 4)

                    if area_ratio >= 0.08:
                        relative_size = "LARGE"
                    elif area_ratio >= 0.02:
                        relative_size = "MEDIUM"
                    else:
                        relative_size = "SMALL"

                    hazard_flag = bool(area_ratio >= 0.08 or (class_name == "pothole" and conf >= 0.40))

                    found.append({
                        "class_id": cls_id,
                        "class_name": class_name,
                        "issue": class_name,  # backward compatibility alias
                        "confidence": conf,
                        "bbox": [x1, y1, x2, y2],
                        "bbox_dict": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                        "area_ratio": area_ratio,
                        "relative_size": relative_size,
                        "hazard_flag": hazard_flag,
                        "model_source": source_tag
                    })
        except Exception as exc:
            logger.error(f"Inference execution failed on {image_path}: {exc}")
        return found

    # 1. Primary improved model run
    detections = []
    if primary_model:
        detections = _extract_boxes(primary_model, conf_threshold, "improved")

    # 2. If primary yields no detections, cascade to secondary model at 0.20 threshold
    if not detections and secondary_model:
        detections = _extract_boxes(secondary_model, min(conf_threshold, 0.20), "baseline_fallback")

    # Sort detections by confidence descending and assign 1-indexed detection_ids
    detections.sort(key=lambda d: d["confidence"], reverse=True)
    for idx, d in enumerate(detections, start=1):
        d["detection_id"] = idx

    return {
        "image_width": img_w,
        "image_height": img_h,
        "detections": detections,
        "status": "DETECTION_FOUND" if detections else "NO_CONFIDENT_DETECTION",
        "model_version": "civora-yolo-v1-improved"
    }


def detect_civic_issue(image_path: str, conf_threshold: float = 0.25) -> List[Dict[str, Any]]:
    """
    Standard detection entry point returning the list of detected defect objects.
    Maintains complete backwards compatibility with existing pipelines and tests.
    """
    res = detect_civic_issue_detailed(image_path, conf_threshold)
    return res.get("detections", [])


# Quick manual test when running this file directly
if __name__ == "__main__":
    test_image = "datasets/civic_detection/images/test/03013ade52e4c7b905a5dd0ff7351053_jpg.rf.a49ff3731e3c60b54ce0edf89cd52c08.jpg"
    output = detect_civic_issue(test_image)
    print(output)
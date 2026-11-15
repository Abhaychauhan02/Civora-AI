"""YOLOv8 Civic Hazard Detection Pipeline with Schema Standardization & Multi-Model Ensemble."""
import os
import time
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from PIL import Image, ImageOps
import torch

logger = logging.getLogger(__name__)

# Dynamically resolve root and model checkpoint paths
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
IMPROVED_PATH = ROOT_DIR / "models" / "improved_best.pt"
BASELINE_PATH = ROOT_DIR / "models" / "best.pt"

_primary_model = None
_secondary_model = None


def _get_models():
    """Lazily loads and caches the primary improved YOLOv8 model and baseline secondary model."""
    global _primary_model, _secondary_model
    if _primary_model is None:
        try:
            from ultralytics import YOLO
            env_override = os.getenv("YOLO_MODEL_PATH")
            if env_override and "civora_yolo_v1-2" not in env_override and Path(env_override).exists():
                p_path = Path(env_override)
            else:
                p_path = IMPROVED_PATH if IMPROVED_PATH.exists() else BASELINE_PATH
            
            if p_path.exists():
                _primary_model = YOLO(str(p_path))
                logger.info(f"Loaded primary YOLOv8 model from {p_path} (classes: {_primary_model.names})")
            else:
                _primary_model = False

            # Secondary model for challenging low-light / wet pavement road defects
            sec_path = BASELINE_PATH if BASELINE_PATH.exists() else (ROOT_DIR / "runs/detect/civora_yolo_v1-2/weights/best.pt")
            if sec_path.exists() and sec_path.resolve() != p_path.resolve():
                _secondary_model = YOLO(str(sec_path))
                logger.info(f"Loaded secondary cascade YOLOv8 model from {sec_path}")
            else:
                _secondary_model = None
        except Exception as exc:
            logger.error(f"Failed to load YOLO models: {exc}")
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


def _batched_nms(boxes_t: torch.Tensor, scores_t: torch.Tensor, classes_t: torch.Tensor, iou_thresh: float = 0.45) -> torch.Tensor:
    """Class-aware Non-Maximum Suppression with automatic torchvision / pure-PyTorch fallback."""
    try:
        import torchvision
        return torchvision.ops.batched_nms(boxes_t, scores_t, classes_t, iou_thresh)
    except Exception:
        keep_indices = []
        for c in torch.unique(classes_t):
            cls_mask = (classes_t == c).nonzero().squeeze(1)
            cls_boxes = boxes_t[cls_mask]
            cls_scores = scores_t[cls_mask]
            order = cls_scores.argsort(descending=True)
            keep_cls = []
            while order.numel() > 0:
                i = order[0].item()
                keep_cls.append(cls_mask[i].item())
                if order.numel() == 1:
                    break
                xx1 = torch.maximum(cls_boxes[i, 0], cls_boxes[order[1:], 0])
                yy1 = torch.maximum(cls_boxes[i, 1], cls_boxes[order[1:], 1])
                xx2 = torch.minimum(cls_boxes[i, 2], cls_boxes[order[1:], 2])
                yy2 = torch.minimum(cls_boxes[i, 3], cls_boxes[order[1:], 3])
                w = torch.clamp(xx2 - xx1, min=0.0)
                h = torch.clamp(yy2 - yy1, min=0.0)
                inter = w * h
                area_i = (cls_boxes[i, 2] - cls_boxes[i, 0]) * (cls_boxes[i, 3] - cls_boxes[i, 1])
                area_others = (cls_boxes[order[1:], 2] - cls_boxes[order[1:], 0]) * (cls_boxes[order[1:], 3] - cls_boxes[order[1:], 1])
                union = area_i + area_others - inter
                iou = inter / torch.clamp(union, min=1e-6)
                inds = (iou <= iou_thresh).nonzero().squeeze(1)
                order = order[inds + 1]
            keep_indices.extend(keep_cls)
        return torch.tensor(keep_indices, dtype=torch.long)


def detect_civic_issue_detailed(image_path: str, conf_threshold: float = 0.20) -> Dict[str, Any]:
    """
    Runs Civora's multi-model ensemble detection pipeline on a single image.
    Fuses predictions from primary improved checkpoint and road-defect baseline checkpoint
    using batched class-aware NMS to maximize recall without increasing false positives.

    Returns complete instance-level defect localization metadata, image dimensions, and schema.
    """
    start_t = time.perf_counter()

    if not os.path.exists(image_path):
        return {
            "image_width": 640,
            "image_height": 640,
            "detection_count": 0,
            "inference_time_ms": 0.0,
            "detections": [],
            "status": "ERROR_FILE_NOT_FOUND",
            "model_version": "civora-yolo-v1-ensemble"
        }

    img_w, img_h = get_image_dimensions(image_path)
    primary_model, secondary_model = _get_models()
    if primary_model is None and secondary_model is None:
        return {
            "image_width": img_w,
            "image_height": img_h,
            "detection_count": 0,
            "inference_time_ms": 0.0,
            "detections": [],
            "status": "NO_MODEL_LOADED",
            "model_version": "civora-yolo-v1-ensemble"
        }

    all_boxes = []
    all_scores = []
    all_classes = []
    all_sources = []

    def _collect_boxes(model, conf_thresh, augment, source_tag):
        try:
            results = model(image_path, conf=conf_thresh, augment=augment, verbose=False)
            for r in results:
                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    conf = round(float(box.conf[0]), 4)
                    coords = [round(float(c), 1) for c in box.xyxy[0].tolist()]
                    all_boxes.append(coords)
                    all_scores.append(conf)
                    all_classes.append(cls_id)
                    all_sources.append(source_tag)
        except Exception as exc:
            logger.error(f"Inference execution failed on {image_path} with {source_tag}: {exc}")

    # 1. Primary improved model (strongest on streetlights, general defects)
    if primary_model:
        _collect_boxes(primary_model, conf_thresh=conf_threshold, augment=False, source_tag="improved")

    # 2. Secondary baseline model (with TTA for wet, low-light asphalt road defects)
    if secondary_model:
        _collect_boxes(secondary_model, conf_thresh=conf_threshold, augment=True, source_tag="baseline_tta")

    elapsed_ms = round((time.perf_counter() - start_t) * 1000.0, 1)

    if not all_boxes:
        return {
            "status": "NO_CONFIDENT_DETECTION",
            "model_version": "civora-yolo-v1-ensemble",
            "image_width": img_w,
            "image_height": img_h,
            "detection_count": 0,
            "inference_time_ms": elapsed_ms,
            "detections": []
        }

    # Apply class-aware NMS to fuse multi-model predictions
    boxes_t = torch.tensor(all_boxes, dtype=torch.float32)
    scores_t = torch.tensor(all_scores, dtype=torch.float32)
    classes_t = torch.tensor(all_classes, dtype=torch.int64)

    keep_indices = _batched_nms(boxes_t, scores_t, classes_t, iou_thresh=0.45).tolist()

    class_names = {0: "pothole", 1: "garbage", 2: "damaged_streetlight"}
    if primary_model and hasattr(primary_model, "names"):
        class_names.update(primary_model.names)

    detections = []
    total_area = float(img_w * img_h) if (img_w and img_h) else 1.0

    for idx in keep_indices:
        cls_id = int(classes_t[idx])
        class_name = class_names.get(cls_id, f"class_{cls_id}")
        conf = float(scores_t[idx])
        coords = [round(float(c), 1) for c in boxes_t[idx].tolist()]
        x1, y1, x2, y2 = coords

        # Clip bounds to image dimensions
        if img_w and img_h:
            x1 = max(0.0, min(float(img_w), x1))
            x2 = max(0.0, min(float(img_w), x2))
            y1 = max(0.0, min(float(img_h), y1))
            y2 = max(0.0, min(float(img_h), y2))

        box_area = max(0.0, (x2 - x1) * (y2 - y1))
        area_ratio = round(box_area / total_area, 4)

        if area_ratio >= 0.08:
            relative_size = "LARGE"
        elif area_ratio >= 0.02:
            relative_size = "MEDIUM"
        else:
            relative_size = "SMALL"

        hazard_flag = bool(area_ratio >= 0.08 or (class_name == "pothole" and conf >= 0.35))

        detections.append({
            "class_id": cls_id,
            "class_name": class_name,
            "issue": class_name,  # backward compatibility alias
            "confidence": round(conf, 4),
            "bbox": [x1, y1, x2, y2],
            "bbox_dict": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
            "area_ratio": area_ratio,
            "relative_size": relative_size,
            "hazard_flag": hazard_flag,
            "model_source": all_sources[idx]
        })

    # Sort detections by confidence descending and assign 1-indexed detection_ids
    detections.sort(key=lambda d: d["confidence"], reverse=True)
    for i, d in enumerate(detections, start=1):
        d["detection_id"] = i

    return {
        "status": "DETECTION_FOUND" if detections else "NO_CONFIDENT_DETECTION",
        "model_version": "civora-yolo-v1-ensemble",
        "image_width": img_w,
        "image_height": img_h,
        "detection_count": len(detections),
        "inference_time_ms": elapsed_ms,
        "detections": detections
    }


def detect_civic_issue(image_path: str, conf_threshold: float = 0.20) -> List[Dict[str, Any]]:
    """
    Standard detection entry point returning the list of detected defect objects.
    Maintains complete backwards compatibility with existing pipelines and tests.
    """
    res = detect_civic_issue_detailed(image_path, conf_threshold)
    return res.get("detections", [])


# Quick manual test when running this file directly
if __name__ == "__main__":
    import sys
    test_p = sys.argv[1] if len(sys.argv) > 1 else "/Users/abhaychauhan/.gemini/antigravity/brain/7b20ba2f-ab2e-470c-b6ca-c840a7342327/.user_uploaded/media_1794373554329_8684c80c.png"
    output = detect_civic_issue_detailed(test_p)
    print("Status:", output["status"])
    print("Detections count:", output["detection_count"])
    for d in output["detections"]:
        print(" ", d["detection_id"], d["class_name"], d["confidence"], d["bbox"], d["relative_size"])

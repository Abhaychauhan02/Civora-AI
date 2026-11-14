"""
Civora Unified AI Pipeline: Authenticity Screening + YOLO Object Detection + Severity Scoring.
"""
from typing import Dict, Any
from src.inference.detect import detect_civic_issue_detailed
from src.authenticity.screen import screen_authenticity
from src.severity.scoring import calculate_severity


def predict(image_path: str) -> Dict[str, Any]:
    """
    Full Civora AI pipeline:
    1. Authenticity screening on raw image file (preserves camera EXIF & sensor noise).
    2. Civic hazard detection via fine-tuned YOLOv8 with instance-level localization.
    3. Rule-based severity scoring and priority mapping.
    """
    authenticity = screen_authenticity(image_path)
    detailed = detect_civic_issue_detailed(image_path)
    detections = detailed.get("detections", [])
    img_w = detailed.get("image_width", 640)
    img_h = detailed.get("image_height", 640)
    severity = calculate_severity(detections)

    if detections:
        top_detection = detections[0]
        primary_category = top_detection.get("class_name") or top_detection.get("issue")
        primary_confidence = top_detection.get("confidence")
        status = "DETECTION_FOUND"
    else:
        primary_category = "unclassified"
        primary_confidence = None
        status = "NO_DETECTIONS_FOUND"

    return {
        "status": status,
        "model_version": detailed.get("model_version", "civora-yolo-v1-improved"),
        "image_width": img_w,
        "image_height": img_h,
        "primary_category": primary_category,
        "primary_confidence": primary_confidence,
        "detections": detections,
        "authenticity": authenticity,
        "severity_score": severity["severity_score"],
        "priority": severity["priority"]
    }


if __name__ == "__main__":
    test_image = "datasets/civic_detection/images/test/03013ade52e4c7b905a5dd0ff7351053_jpg.rf.a49ff3731e3c60b54ce0edf89cd52c08.jpg"
    import json
    print(json.dumps(predict(test_image), indent=2))
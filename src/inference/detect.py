import os
from ultralytics import YOLO

# Resolve model path dynamically
MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "models/best.pt")
if not os.path.exists(MODEL_PATH):
    fallback_path = "runs/detect/civora_yolo_v1-2/weights/best.pt"
    if os.path.exists(fallback_path):
        MODEL_PATH = fallback_path

# Load model once at module initialization
_model = YOLO(MODEL_PATH)


def detect_civic_issue(image_path, conf_threshold=0.4):
    """
    Runs Civora's detection model on a single image.

    Args:
        image_path: path to the image file
        conf_threshold: minimum confidence to keep a detection

    Returns:
        A list of detections, each as a dict:
        {
            "issue": "pothole",
            "confidence": 0.91,
            "bbox": [x1, y1, x2, y2]
        }
    """
    results = _model(image_path, conf=conf_threshold, verbose=False)

    detections = []
    for r in results:
        for box in r.boxes:
            cls_id = int(box.cls[0])
            detections.append({
                "issue": _model.names[cls_id],
                "confidence": round(float(box.conf[0]), 2),
                "bbox": [round(x, 1) for x in box.xyxy[0].tolist()],
            })

    return detections


# Quick manual test when running this file directly
if __name__ == "__main__":
    test_image = "datasets/civic_detection/images/test/03013ade52e4c7b905a5dd0ff7351053_jpg.rf.a49ff3731e3c60b54ce0edf89cd52c08.jpg"
    output = detect_civic_issue(test_image)
    print(output)
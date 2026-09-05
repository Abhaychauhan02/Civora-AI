"""Model evaluation utilities for Civora YOLO detector."""
import os
from ultralytics import YOLO

def evaluate_model(
    model_path: str = "runs/detect/civora_yolo_v1-2/weights/best.pt",
    data_yaml: str = "datasets/civic_detection/data.yaml"
):
    """
    Evaluates fine-tuned YOLO model on the test split and returns validation metrics.
    """
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Weights file not found at {model_path}")
    if not os.path.exists(data_yaml):
        raise FileNotFoundError(f"Data config not found at {data_yaml}")

    model = YOLO(model_path)
    metrics = model.val(data=data_yaml, split="test")

    return {
        "mAP50": round(float(metrics.box.map50), 4),
        "mAP50-95": round(float(metrics.box.map), 4),
        "precision": round(float(metrics.box.mp), 4),
        "recall": round(float(metrics.box.mr), 4),
        "class_names": model.names
    }

if __name__ == "__main__":
    results = evaluate_model()
    print("Evaluation Results:", results)

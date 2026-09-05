"""Training pipeline module for fine-tuning YOLO models on civic datasets."""
import os
from ultralytics import YOLO

def train_civic_detector(
    base_model: str = "yolov8n.pt",
    data_yaml: str = "datasets/civic_detection/data.yaml",
    epochs: int = 30,
    imgsz: int = 640,
    batch: int = 16,
    project_name: str = "civora_yolo",
    device: str = "mps"
):
    """
    Standard training pipeline wrapper.
    """
    model = YOLO(base_model)
    results = model.train(
        data=data_yaml,
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        name=project_name,
        patience=10,
        device=device,
    )
    return results

if __name__ == "__main__":
    train_civic_detector()

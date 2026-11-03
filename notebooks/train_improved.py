"""
Civora Phase 1: Train improved YOLOv8 detector on the leak-free, 3-class dataset.
Saves model checkpoints cleanly and tracks training curves.
"""

import sys
import torch
from pathlib import Path
from ultralytics import YOLO

def train():
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"Using device: {device}")

    # Start from pretrained YOLOv8n
    model = YOLO("yolov8n.pt")

    results = model.train(
        data="datasets/civic_detection_v2/data.yaml",
        epochs=30,
        imgsz=640,
        batch=16,
        name="civora_yolo_v2_leakfree",
        project="runs/detect",
        patience=10,
        device=device,
        seed=42,
        deterministic=True,
        close_mosaic=5,
        save=True,
        save_period=-1,
        plots=True,
        verbose=True
    )

    print("\nTraining completed successfully!")
    best_weights = Path("runs/detect/civora_yolo_v2_leakfree/weights/best.pt")
    if best_weights.exists():
        print(f"Best weights saved at: {best_weights.resolve()}")
    return results

if __name__ == "__main__":
    train()

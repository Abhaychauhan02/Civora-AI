from ultralytics import YOLO

model = YOLO("yolov8n.pt")

results = model.train(
    data="datasets/civic_detection/data.yaml",
    epochs=30,
    imgsz=640,
    batch=16,
    name="civora_yolo_v1",
    patience=10,
    device="mps",
)
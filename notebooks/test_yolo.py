from ultralytics import YOLO

# Load pretrained YOLOv8 nano model (small, fast, good for testing)
model = YOLO("yolov8n.pt")

# Run inference on a sample image (COCO's built-in test image)
results = model("https://ultralytics.com/images/bus.jpg")

# Print detected objects
for r in results:
    for box in r.boxes:
        cls_id = int(box.cls[0])
        cls_name = model.names[cls_id]
        confidence = float(box.conf[0])
        bbox = box.xyxy[0].tolist()
        print(f"Detected: {cls_name}, confidence: {confidence:.2f}, bbox: {bbox}")

# Save the annotated image
r.save(filename="notebooks/test_output.jpg")
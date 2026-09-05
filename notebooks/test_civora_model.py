from ultralytics import YOLO

model = YOLO("runs/detect/civora_yolo_v1-2/weights/best.pt")

# Test on an image from your test set
results = model("datasets/civic_detection/images/test", save=True)

for r in results[:3]:  # print first 3 results
    for box in r.boxes:
        cls_id = int(box.cls[0])
        cls_name = model.names[cls_id]
        conf = float(box.conf[0])
        print(f"Detected: {cls_name}, confidence: {conf:.2f}")
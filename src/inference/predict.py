from src.inference.detect import detect_civic_issue
from src.authenticity.screen import screen_authenticity
from src.severity.scoring import calculate_severity


def predict(image_path):
    """
    Full Civora AI pipeline: authenticity + detection + severity.
    This is the function the API endpoint will call.
    """
    authenticity = screen_authenticity(image_path)
    detections = detect_civic_issue(image_path)
    severity = calculate_severity(detections)

    return {
        "model_version": "civora-yolo-v1",
        "authenticity": authenticity,
        "detections": detections,
        "severity_score": severity["severity_score"],
        "priority": severity["priority"],
    }


if __name__ == "__main__":
    test_image = "datasets/civic_detection/images/test/03013ade52e4c7b905a5dd0ff7351053_jpg.rf.a49ff3731e3c60b54ce0edf89cd52c08.jpg"
    import json
    print(json.dumps(predict(test_image), indent=2))
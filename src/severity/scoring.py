def calculate_severity(detections):
    """
    Simple, transparent rule-based severity scoring.
    Takes the list of detections and returns a severity score + priority.
    This is business logic, NOT an ML prediction.
    """
    if not detections:
        return {"severity_score": 0, "priority": "NONE"}

    # Base weight per issue type (you can tune these later)
    issue_weights = {
        "pothole": 40,
        "garbage": 25,
        "damaged_streetlight": 30,
    }

    # Take the highest-confidence detection as the primary issue
    top = max(detections, key=lambda d: d["confidence"])
    base_score = issue_weights.get(top["issue"], 20)

    # Scale by model confidence, and give a small bump if multiple issues detected
    score = base_score * top["confidence"]
    score += min(len(detections) - 1, 3) * 5  # up to +15 for multiple detections
    score = min(round(score), 100)

    if score >= 70:
        priority = "HIGH"
    elif score >= 40:
        priority = "MEDIUM"
    else:
        priority = "LOW"

    return {"severity_score": score, "priority": priority}
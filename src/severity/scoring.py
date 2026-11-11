def calculate_severity(detections):
    """
    Transparent, calibrated civic safety severity scoring.
    Evaluates physical danger to vehicles and pedestrians:
    - Road potholes / craters: High vehicular hazard (score 60-85)
    - Damaged streetlights: Night safety and electrical hazard (score 50-70)
    - Sanitation / garbage overflow: Public hygiene risk (score 45-65)
    - Scaled by detection confidence and defect physical size.
    """
    if not detections:
        return {"severity_score": 40, "priority": "MEDIUM"}

    issue_base_severity = {
        "pothole": 65,
        "waterlogging": 60,
        "damaged_streetlight": 55,
        "streetlight": 55,
        "garbage": 45,
        "other": 40
    }

    top = max(detections, key=lambda d: d.get("confidence", 0.0))
    cat = (top.get("class_name") or top.get("issue") or "other").lower()
    base_weight = issue_base_severity.get(cat, 50)
    conf = float(top.get("confidence", 0.5))

    # Calibrated score: base weight weighted by model confidence
    score = base_weight * (0.65 + 0.35 * conf)

    # Check bounding box physical extent if available (larger defect = higher road hazard)
    bbox = top.get("bbox") or []
    if len(bbox) == 4:
        w = abs(bbox[2] - bbox[0])
        h = abs(bbox[3] - bbox[1])
        if w > 80 and h > 60:
            score += 12

    # Multiple detected defects bonus
    if len(detections) > 1:
        score += min((len(detections) - 1) * 6, 18)

    score = max(25, min(100, round(score)))

    if score >= 75:
        priority = "CRITICAL"
    elif score >= 55:
        priority = "HIGH"
    elif score >= 35:
        priority = "MEDIUM"
    else:
        priority = "LOW"

    return {"severity_score": score, "priority": priority}
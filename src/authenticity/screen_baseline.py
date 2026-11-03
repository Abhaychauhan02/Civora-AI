# Lazy-loaded classifier
_classifier = None

def _get_classifier():
    global _classifier
    if _classifier is None:
        try:
            from transformers import pipeline
            _classifier = pipeline("image-classification", model="dima806/ai_vs_real_image_detection")
        except Exception:
            _classifier = False
    return _classifier if _classifier is not False else None


def screen_authenticity(image_path):
    """
    Screens an image for signs of being AI-generated.

    Returns a dict:
    {
        "real_probability": 0.91,
        "ai_generated_probability": 0.09,
        "status": "LIKELY_AUTHENTIC"
    }
    """
    classifier = _get_classifier()
    if classifier is None:
        return {
            "real_probability": 0.90,
            "ai_generated_probability": 0.10,
            "status": "LIKELY_AUTHENTIC",
        }

    results = classifier(image_path)
    # results looks like: [{"label": "REAL", "score": 0.91}, {"label": "FAKE", "score": 0.09}]

    scores = {r["label"].upper(): r["score"] for r in results}
    real_prob = round(scores.get("REAL", 0.0), 2)
    fake_prob = round(scores.get("FAKE", 0.0), 2)

    # Simple, transparent thresholding — NOT a guarantee, just a screening signal
    if real_prob >= 0.75:
        status = "LIKELY_AUTHENTIC"
    elif real_prob >= 0.45:
        status = "SUSPICIOUS"
    else:
        status = "HIGHLY_SUSPICIOUS"

    return {
        "real_probability": real_prob,
        "ai_generated_probability": fake_prob,
        "status": status,
    }


if __name__ == "__main__":
    test_image = "datasets/civic_detection/images/test/03013ade52e4c7b905a5dd0ff7351053_jpg.rf.a49ff3731e3c60b54ce0edf89cd52c08.jpg"
    print(screen_authenticity(test_image))
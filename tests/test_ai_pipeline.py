"""
Comprehensive Unit & Regression Tests for AI Vision & Authenticity Pipeline (Phase B).
"""
import unittest
import os
import tempfile
import asyncio
from PIL import Image
from src.inference.detect import detect_civic_issue, _get_model
from src.inference.predict import predict
from src.authenticity.screen import screen_authenticity, extract_camera_evidence
from backend.app.ai_client import analyze_civic_image, _INFERENCE_CACHE


class TestAIPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Create a sample clean image for testing
        cls.temp_dir = tempfile.mkdtemp()
        cls.sample_img_path = os.path.join(cls.temp_dir, "test_sample.jpg")
        img = Image.new("RGB", (640, 640), color=(128, 128, 128))
        img.save(cls.sample_img_path, "JPEG")

        # Create a sample corrupt image file
        cls.corrupt_img_path = os.path.join(cls.temp_dir, "test_corrupt.jpg")
        with open(cls.corrupt_img_path, "wb") as f:
            f.write(b"NOT_AN_IMAGE_PAYLOAD_12345")

    @classmethod
    def tearDownClass(cls):
        import shutil
        shutil.rmtree(cls.temp_dir, ignore_errors=True)

    def test_model_loading_and_classes(self):
        model = _get_model()
        self.assertIsNotNone(model)
        # Verify supported classes
        names = model.names
        self.assertIn("pothole", names.values())
        self.assertIn("garbage", names.values())
        self.assertIn("damaged_streetlight", names.values())
        # Verify Waterlogging is NOT an object detection class in the YOLO model
        self.assertNotIn("waterlogging", names.values())

    def test_detect_civic_issue_schema(self):
        # Run detection on sample image
        detections = detect_civic_issue(self.sample_img_path)
        self.assertIsInstance(detections, list)
        for det in detections:
            # Check mandatory schema fields
            self.assertIn("class_name", det)
            self.assertIn("issue", det)
            self.assertIn("confidence", det)
            self.assertIn("bbox", det)
            self.assertIn("bbox_dict", det)
            self.assertIsInstance(det["confidence"], float)
            self.assertIsInstance(det["bbox"], list)
            self.assertEqual(len(det["bbox"]), 4)
            # Verify coordinates are valid non-negative floats
            for c in det["bbox"]:
                self.assertGreaterEqual(c, 0.0)

    def test_predict_standard_schema(self):
        result = predict(self.sample_img_path)
        self.assertIn("status", result)
        self.assertIn(result["status"], ["DETECTION_FOUND", "NO_DETECTIONS_FOUND"])
        self.assertIn("model_version", result)
        self.assertIn("primary_category", result)
        self.assertIn("primary_confidence", result)
        self.assertIn("detections", result)
        self.assertIn("authenticity", result)
        self.assertIn("severity_score", result)
        self.assertIn("priority", result)

        if result["status"] == "NO_DETECTIONS_FOUND":
            self.assertEqual(len(result["detections"]), 0)
            self.assertIsNone(result["primary_confidence"])

    def test_authenticity_four_operational_tiers(self):
        valid_statuses = {"LIKELY_AUTHENTIC", "UNCERTAIN", "REVIEW_REQUIRED", "SUSPICIOUS"}
        auth_res = screen_authenticity(self.sample_img_path)
        self.assertIn(auth_res["status"], valid_statuses)
        self.assertIn("real_probability", auth_res)
        self.assertIn("ai_generated_probability", auth_res)
        self.assertIn("explanation", auth_res)
        self.assertIn("metadata_evidence", auth_res)

    def test_corrupt_and_missing_image_resilience(self):
        # Non-existent file
        missing_res = predict("/non/existent/path/image.jpg")
        self.assertEqual(missing_res["status"], "NO_DETECTIONS_FOUND")
        self.assertEqual(missing_res["authenticity"]["status"], "UNCERTAIN")

        # Corrupt file
        corrupt_auth = screen_authenticity(self.corrupt_img_path)
        self.assertIn(corrupt_auth["status"], ["UNCERTAIN", "REVIEW_REQUIRED", "LIKELY_AUTHENTIC"])

    def test_async_ai_client_caching(self):
        # First call
        res1 = asyncio.run(analyze_civic_image(self.sample_img_path))
        self.assertIn("model_version", res1)

        # Second call should hit memory cache
        res2 = asyncio.run(analyze_civic_image(self.sample_img_path))
        self.assertEqual(res1["model_version"], res2["model_version"])


if __name__ == "__main__":
    unittest.main()

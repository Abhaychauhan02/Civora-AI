"""
Unit and integration tests for Civora Authenticity Screening Module.
"""

import os
import unittest
import tempfile
from pathlib import Path
from PIL import Image
from src.authenticity.screen import (
    screen_authenticity,
    extract_camera_evidence,
    THRESHOLD_AUTHENTIC,
    THRESHOLD_SUSPICIOUS,
    THRESHOLD_REVIEW_REQUIRED
)

class TestAuthenticityScreening(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Create a small temporary real-looking RGB test image
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.valid_img_path = os.path.join(cls.temp_dir.name, "test_valid.jpg")
        img = Image.new("RGB", (200, 200), color=(128, 128, 128))
        img.save(cls.valid_img_path, "JPEG")

        # Create a corrupted image file
        cls.corrupt_img_path = os.path.join(cls.temp_dir.name, "test_corrupt.jpg")
        with open(cls.corrupt_img_path, "wb") as f:
            f.write(b"NOT_A_VALID_IMAGE_HEADER_RANDOM_GARBAGE")

        cls.non_existent_path = os.path.join(cls.temp_dir.name, "does_not_exist.jpg")

    @classmethod
    def tearDownClass(cls):
        cls.temp_dir.cleanup()

    def test_screen_output_structure(self):
        """Verifies that screen_authenticity returns all required contract fields."""
        res = screen_authenticity(self.valid_img_path)
        required_keys = [
            "real_probability",
            "ai_generated_probability",
            "status",
            "review_required",
            "confidence_tier",
            "explanation",
            "metadata_evidence"
        ]
        for key in required_keys:
            self.assertIn(key, res, f"Missing required key: {key}")

        self.assertIsInstance(res["real_probability"], (float, int))
        self.assertIsInstance(res["ai_generated_probability"], (float, int))
        self.assertIsInstance(res["review_required"], bool)
        self.assertIsInstance(res["confidence_tier"], str)
        self.assertIsInstance(res["explanation"], str)

    def test_status_categories(self):
        """Verifies that the returned status is one of the 4 calibrated states."""
        valid_statuses = {"LIKELY_AUTHENTIC", "UNCERTAIN", "REVIEW_REQUIRED", "SUSPICIOUS"}
        res = screen_authenticity(self.valid_img_path)
        self.assertIn(res["status"], valid_statuses)

    def test_missing_file_handling(self):
        """Verifies non-existent image paths return a safe fallback without crashing."""
        res = screen_authenticity(self.non_existent_path)
        self.assertEqual(res["status"], "UNCERTAIN")
        self.assertTrue(res["review_required"])
        self.assertEqual(res["confidence_tier"], "LOW")

    def test_corrupt_file_handling(self):
        """Verifies corrupt image files are safely caught and return UNCERTAIN."""
        res = screen_authenticity(self.corrupt_img_path)
        self.assertEqual(res["status"], "UNCERTAIN")
        self.assertTrue(res["review_required"])

    def test_probabilities_bounded(self):
        """Verifies probabilities are bounded between 0.0 and 1.0."""
        res = screen_authenticity(self.valid_img_path)
        self.assertGreaterEqual(res["real_probability"], 0.0)
        self.assertLessEqual(res["real_probability"], 1.0)
        self.assertGreaterEqual(res["ai_generated_probability"], 0.0)
        self.assertLessEqual(res["ai_generated_probability"], 1.0)
        self.assertAlmostEqual(res["real_probability"] + res["ai_generated_probability"], 1.0, places=1)

    def test_camera_metadata_extraction(self):
        """Verifies EXIF inspection helper."""
        evidence = extract_camera_evidence(self.valid_img_path)
        self.assertIn("has_exif", evidence)
        self.assertIn("camera_make", evidence)
        self.assertIn("camera_model", evidence)

    def test_threshold_monotonicity(self):
        """Verifies calibration thresholds are strictly monotonic."""
        self.assertLess(THRESHOLD_AUTHENTIC, THRESHOLD_REVIEW_REQUIRED)
        self.assertLess(THRESHOLD_REVIEW_REQUIRED, THRESHOLD_SUSPICIOUS)

if __name__ == "__main__":
    unittest.main()

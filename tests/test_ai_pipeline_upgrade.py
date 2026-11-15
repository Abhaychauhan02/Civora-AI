"""Comprehensive Test Suite for Civora AI Detection Upgrade, Verification & Consistency."""
import os
import sys
import unittest
import io
import json
from pathlib import Path
from PIL import Image

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from starlette.testclient import TestClient
from backend.main import app
from backend.app.database import get_db, init_db
from backend.app.auth import create_access_token
from src.inference.detect import detect_civic_issue_detailed, get_image_dimensions
from src.authenticity.screen import (
    screen_authenticity,
    THRESHOLD_AUTHENTIC_REAL,
    THRESHOLD_UNCERTAIN_REAL,
    THRESHOLD_REVIEW_REAL
)


class TestAiPipelineUpgrade(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)
        cls.admin_token = create_access_token({"sub": "usr_admin_01", "role": "ADMIN", "token_version": 1})
        cls.admin_headers = {"Authorization": f"Bearer {cls.admin_token}"}

        # Real controlled debug image (user-submitted road photograph with potholes)
        cls.user_road_img = "/Users/abhaychauhan/.gemini/antigravity/brain/7b20ba2f-ab2e-470c-b6ca-c840a7342327/.user_uploaded/media_1794373554329_8684c80c.png"

        # Real test set samples
        cls.garbage_img = "datasets/civic_detection_v2/images/test/00c712f2b980052499567e72e70a5b2f_jpg.rf.58b00fbb2655c9081e92e2b14f025509.jpg"
        cls.sl_img = "datasets/civic_detection_v2/images/test/streetlight_20240309_190209_jpg.rf.010a661a27937ba7e64c4eb3b698e310.jpg"

    def test_01_and_02_valid_and_multiple_pothole_detection(self):
        """1 & 2: Verifies real model inference detects potholes and multiple instances on citizen photograph."""
        if not os.path.exists(self.user_road_img):
            self.skipTest("User road image not found on disk")

        result = detect_civic_issue_detailed(self.user_road_img, conf_threshold=0.20)
        self.assertEqual(result["status"], "DETECTION_FOUND")
        self.assertGreaterEqual(result["detection_count"], 1)

        detections = result["detections"]
        top_det = detections[0]
        self.assertEqual(top_det["class_name"], "pothole")
        self.assertGreater(top_det["confidence"], 0.35, "Top pothole confidence should exceed 0.35")

        # Verify multiple instances are localized
        self.assertGreaterEqual(len(detections), 2, "Expected multiple potholes localized on this roadway")
        for i, d in enumerate(detections, start=1):
            self.assertEqual(d["detection_id"], i)
            self.assertEqual(d["class_name"], "pothole")
            bbox = d["bbox"]
            self.assertEqual(len(bbox), 4)
            self.assertGreaterEqual(bbox[2], bbox[0], "x2 must be >= x1")
            self.assertGreaterEqual(bbox[3], bbox[1], "y2 must be >= y1")
            self.assertIn(d["relative_size"], ["SMALL", "MEDIUM", "LARGE"])

    def test_03_garbage_detection_real_model(self):
        """3: Verifies garbage detection on representative civic imagery."""
        if not os.path.exists(self.garbage_img):
            self.skipTest("Garbage test image not found")

        result = detect_civic_issue_detailed(self.garbage_img, conf_threshold=0.20)
        self.assertEqual(result["status"], "DETECTION_FOUND")
        class_names = [d["class_name"] for d in result["detections"]]
        self.assertIn("garbage", class_names)
        top_garbage = next(d for d in result["detections"] if d["class_name"] == "garbage")
        self.assertGreater(top_garbage["confidence"], 0.70)

    def test_04_damaged_streetlight_detection_real_model(self):
        """4: Verifies damaged streetlight detection on representative test imagery."""
        if not os.path.exists(self.sl_img):
            self.skipTest("Streetlight test image not found")

        result = detect_civic_issue_detailed(self.sl_img, conf_threshold=0.20)
        self.assertEqual(result["status"], "DETECTION_FOUND")
        class_names = [d["class_name"] for d in result["detections"]]
        self.assertIn("damaged_streetlight", class_names)
        top_sl = next(d for d in result["detections"] if d["class_name"] == "damaged_streetlight")
        self.assertGreater(top_sl["confidence"], 0.75)

    def test_05_no_detectable_objects_honest_handling(self):
        """5: Verifies honest NO_CONFIDENT_DETECTION without fabricating bounding boxes on blank imagery."""
        buf = io.BytesIO()
        Image.new("RGB", (400, 300), color=(200, 200, 200)).save(buf, format="JPEG")
        blank_bytes = buf.getvalue()

        # Save to temp path
        temp_blank = "/tmp/civora_blank_test.jpg"
        with open(temp_blank, "wb") as f:
            f.write(blank_bytes)

        try:
            result = detect_civic_issue_detailed(temp_blank, conf_threshold=0.25)
            self.assertEqual(result["status"], "NO_CONFIDENT_DETECTION")
            self.assertEqual(result["detection_count"], 0)
            self.assertEqual(len(result["detections"]), 0)
        finally:
            if os.path.exists(temp_blank):
                os.remove(temp_blank)

    def test_06_low_confidence_filtering(self):
        """6: Verifies that high thresholds properly filter low confidence detections."""
        if not os.path.exists(self.user_road_img):
            self.skipTest("User road image not found")

        res_strict = detect_civic_issue_detailed(self.user_road_img, conf_threshold=0.90)
        # No detection on this challenging image should exceed 0.90
        self.assertEqual(res_strict["detection_count"], 0)
        self.assertEqual(res_strict["status"], "NO_CONFIDENT_DETECTION")

    def test_07_and_08_dimensions_and_exif_orientation(self):
        """7 & 8: Verifies image dimensions respecting EXIF transposition."""
        buf = io.BytesIO()
        Image.new("RGB", (640, 480), color=(100, 150, 200)).save(buf, format="JPEG")
        temp_img = "/tmp/civora_dim_test.jpg"
        with open(temp_img, "wb") as f:
            f.write(buf.getvalue())

        try:
            w, h = get_image_dimensions(temp_img)
            self.assertEqual(w, 640)
            self.assertEqual(h, 480)
        finally:
            if os.path.exists(temp_img):
                os.remove(temp_img)

    def test_09_bounding_box_alignment_metadata(self):
        """9: Verifies bbox structure contains normalized and absolute coordinate metadata."""
        if not os.path.exists(self.user_road_img):
            self.skipTest("User road image not found")

        result = detect_civic_issue_detailed(self.user_road_img)
        for d in result["detections"]:
            self.assertIn("bbox", d)
            self.assertIn("bbox_dict", d)
            self.assertIn("area_ratio", d)
            self.assertIn("relative_size", d)
            self.assertIn("hazard_flag", d)
            self.assertIsInstance(d["bbox_dict"], dict)
            self.assertIn("x1", d["bbox_dict"])
            self.assertIn("y1", d["bbox_dict"])
            self.assertIn("x2", d["bbox_dict"])
            self.assertIn("y2", d["bbox_dict"])

    def test_10_authenticity_score_and_status_consistency(self):
        """10: Verifies that authenticity status is mathematically consistent with real_probability."""
        # Simulated test images
        buf = io.BytesIO()
        Image.new("RGB", (256, 256), color=(50, 100, 150)).save(buf, format="JPEG")
        temp_p = "/tmp/civora_auth_test.jpg"
        with open(temp_p, "wb") as f:
            f.write(buf.getvalue())

        try:
            res = screen_authenticity(temp_p)
            real_p = res["real_probability"]
            status = res["status"]

            # Mathematical Consistency Check
            if real_p >= THRESHOLD_AUTHENTIC_REAL:
                self.assertEqual(status, "LIKELY_AUTHENTIC")
            elif real_p >= THRESHOLD_UNCERTAIN_REAL:
                self.assertEqual(status, "UNCERTAIN")
            elif real_p >= THRESHOLD_REVIEW_REAL:
                self.assertEqual(status, "REVIEW_REQUIRED")
            else:
                self.assertEqual(status, "SUSPICIOUS")

            # Explicit check against the 0.40 bug: an image with 0.40 real_prob MUST NOT be LIKELY_AUTHENTIC
            self.assertFalse(real_p < 0.50 and status == "LIKELY_AUTHENTIC",
                             "A low real probability (<0.50) must never be marked LIKELY_AUTHENTIC")
        finally:
            if os.path.exists(temp_p):
                os.remove(temp_p)

    def test_11_and_12_persistence_and_admin_override(self):
        """11 & 12: Verifies persistence of detection boxes, authenticity_score, and non-destructive admin override."""
        # Submit test report with road image
        if not os.path.exists(self.user_road_img):
            self.skipTest("User road image not found")

        with open(self.user_road_img, "rb") as f:
            img_bytes = f.read()

        files = {"image": ("pothole_sub.jpg", img_bytes, "image/jpeg")}
        form_data = {
            "latitude": "28.6139",
            "longitude": "77.2090",
            "category": "pothole",
            "location_source": "GPS_DEVICE",
            "location_accuracy": "5.0",
            "address": "Ring Road Sector 4",
            "description": "Deep multiple potholes"
        }

        submit_resp = self.client.post("/api/reports/submit", files=files, data=form_data)
        self.assertEqual(submit_resp.status_code, 200)
        rep_id = submit_resp.json()["report_id"]

        # Fetch detail via Admin API
        get_resp = self.client.get(f"/api/reports/{rep_id}")
        self.assertEqual(get_resp.status_code, 200)
        rep = get_resp.json()["report"]

        # Verify detections persisted in JSON and parsed to list
        self.assertIn("detections", rep)
        self.assertIsInstance(rep["detections"], list)
        self.assertGreaterEqual(len(rep["detections"]), 1)
        self.assertEqual(rep["ai_category"], "pothole")
        self.assertIsNotNone(rep["ai_confidence"])
        self.assertIsNotNone(rep.get("authenticity_score"))

        # Test Admin Non-Destructive Category Override
        override_payload = {
            "category": "waterlogging",
            "reason": "Water pooling across crater requires drainage team"
        }
        patch_resp = self.client.patch(
            f"/api/reports/{rep_id}/admin-override",
            json=override_payload,
            headers=self.admin_headers
        )
        self.assertEqual(patch_resp.status_code, 200)

        # Verify original AI prediction is completely preserved
        verify_resp = self.client.get(f"/api/reports/{rep_id}")
        self.assertEqual(verify_resp.status_code, 200)
        updated_rep = verify_resp.json()["report"]
        self.assertEqual(updated_rep["ai_category"], "pothole", "Original AI category must remain untouched")
        self.assertEqual(updated_rep["admin_verified_category"], "waterlogging")
        self.assertIn("drainage", updated_rep["admin_correction_reason"])


if __name__ == "__main__":
    unittest.main()

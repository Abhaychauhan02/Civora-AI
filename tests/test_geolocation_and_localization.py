"""Test suite for Phase 8: Geolocation Intelligence, Defect Localization, and Admin Category Override."""
import os
import sys
import unittest
import io
from pathlib import Path
from PIL import Image

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from starlette.testclient import TestClient
from backend.main import app
from backend.app.database import get_db, init_db
from backend.app.auth import create_access_token


class TestGeolocationAndLocalization(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)
        cls.admin_token = create_access_token({"sub": "usr_admin_01", "role": "ADMIN", "token_version": 1})
        cls.admin_headers = {"Authorization": f"Bearer {cls.admin_token}"}

        # Create a small valid test JPEG image in memory
        cls.img_buf = io.BytesIO()
        test_img = Image.new("RGB", (320, 240), color=(128, 128, 128))
        test_img.save(cls.img_buf, format="JPEG")
        cls.img_bytes = cls.img_buf.getvalue()

    def test_geo_reverse_and_cache(self):
        """Verifies reverse geocoding returns address and caches subsequent lookups."""
        resp = self.client.get("/api/geo/reverse?lat=28.6139&lon=77.2090")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("address", data)
        self.assertIn("country", data)

        # Subsequent identical lookup must hit in-memory cache
        resp2 = self.client.get("/api/geo/reverse?lat=28.6139&lon=77.2090")
        self.assertEqual(resp2.status_code, 200)
        data2 = resp2.json()
        self.assertEqual(data2.get("cached"), True)

    def test_geo_search(self):
        """Verifies search places endpoint returns matching items or fallback."""
        resp = self.client.get("/api/geo/search?q=Connaught+Place")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("results", data)
        self.assertIsInstance(data["results"], list)

    def test_prescan_does_not_persist(self):
        """Verifies instant pre-scan produces defect localization without writing to database."""
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM reports")
            count_before = cursor.fetchone()[0]

        files = {"image": ("prescan_test.jpg", self.img_bytes, "image/jpeg")}
        resp = self.client.post("/api/reports/pre-scan", files=files)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        self.assertIn("status", data)
        self.assertIn("image_width", data)
        self.assertIn("image_height", data)
        self.assertIn("detections", data)
        self.assertIn("authenticity", data)
        self.assertIn("suggested_category", data)
        self.assertEqual(data["image_width"], 320)
        self.assertEqual(data["image_height"], 240)

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM reports")
            count_after = cursor.fetchone()[0]

        self.assertEqual(count_before, count_after, "Pre-scan must not persist reports to the database")

    def test_report_submission_location_accuracy_and_admin_override(self):
        """Verifies submission persists location_accuracy and admin can override category."""
        # 1. Submit report with location_accuracy
        files = {"image": ("test_accuracy.jpg", self.img_bytes, "image/jpeg")}
        form_data = {
            "latitude": "28.6139",
            "longitude": "77.2090",
            "category": "pothole",
            "location_source": "GPS_DEVICE",
            "location_accuracy": "8.5",
            "address": "Connaught Place, New Delhi",
            "description": "Deep crater near circle"
        }

        submit_resp = self.client.post("/api/reports/submit", files=files, data=form_data)
        self.assertEqual(submit_resp.status_code, 200)
        rep_id = submit_resp.json()["report_id"]

        # 2. Inspect report details via Admin API
        get_resp = self.client.get(f"/api/reports/{rep_id}")
        self.assertEqual(get_resp.status_code, 200)
        rep_data = get_resp.json()
        self.assertEqual(rep_data["report"]["location_accuracy"], 8.5)
        ai_cat_original = rep_data["report"]["ai_category"]

        # 3. Test Admin Category Override
        override_payload = {
            "category": "waterlogging",
            "reason": "Visible standing water pooled across entire road lane after rain"
        }
        patch_resp = self.client.patch(
            f"/api/reports/{rep_id}/admin-override",
            json=override_payload,
            headers=self.admin_headers
        )
        self.assertEqual(patch_resp.status_code, 200)
        patch_data = patch_resp.json()
        self.assertEqual(patch_data["admin_verified_category"], "waterlogging")
        self.assertEqual(patch_data["admin_verified_by"], "Campus Facility Director")

        # 4. Re-fetch and verify AI category was preserved and admin verification stored
        verify_resp = self.client.get(f"/api/reports/{rep_id}")
        self.assertEqual(verify_resp.status_code, 200)
        updated_rep = verify_resp.json()["report"]
        self.assertEqual(updated_rep["ai_category"], ai_cat_original, "Original AI category must remain untouched")
        self.assertEqual(updated_rep["admin_verified_category"], "waterlogging")
        self.assertIn("standing water", updated_rep["admin_correction_reason"])
        self.assertEqual(updated_rep["admin_verified_by"], "Campus Facility Director")
        self.assertIsNotNone(updated_rep["admin_verified_at"])

        # 5. Invalid category rejected with 400
        invalid_resp = self.client.patch(
            f"/api/reports/{rep_id}/admin-override",
            json={"category": "flying_carpet", "reason": "test"},
            headers=self.admin_headers
        )
        self.assertEqual(invalid_resp.status_code, 400)


if __name__ == "__main__":
    unittest.main()

"""
Test suite for Civora Phase 9: Complete GPS, HTTPS & Geolocation Verification.
Tests location verification persistence, coordinate integrity, reverse geocoding,
search autocompletion, admin detail inspection, and deployment configurations.
"""
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


class TestGeolocationAndHttps(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)
        cls.admin_token = create_access_token({"sub": "usr_admin_01", "role": "ADMIN", "token_version": 1})
        cls.admin_headers = {"Authorization": f"Bearer {cls.admin_token}"}

        # Create valid test image
        cls.img_buf = io.BytesIO()
        test_img = Image.new("RGB", (320, 240), color=(128, 128, 128))
        test_img.save(cls.img_buf, format="JPEG")
        cls.img_bytes = cls.img_buf.getvalue()

    def test_submit_report_gps_verified(self):
        """Verifies report submission preserves GPS_VERIFIED state and precision accuracy."""
        files = {"image": ("pothole.jpg", self.img_bytes, "image/jpeg")}
        data = {
            "latitude": "28.6139",
            "longitude": "77.2090",
            "category": "pothole",
            "address": "Connaught Place, New Delhi",
            "location_source": "GPS_LOCKED",
            "location_accuracy": "14.2",
            "location_verification": "GPS_VERIFIED",
            "description": "High precision on-site GPS verification test."
        }
        resp = self.client.post("/api/reports/submit", files=files, data=data)
        self.assertEqual(resp.status_code, 200, resp.text)
        res_data = resp.json()
        self.assertTrue(res_data["success"])
        self.assertEqual(res_data["location_verification"], "GPS_VERIFIED")

        # Verify DB persistence
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT location_verification, location_accuracy, location_source FROM reports WHERE id = ?", (res_data["report_id"],))
            row = cursor.fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["location_verification"], "GPS_VERIFIED")
            self.assertAlmostEqual(row["location_accuracy"], 14.2, places=1)
            self.assertEqual(row["location_source"], "GPS_LOCKED")

    def test_submit_report_gps_approximate(self):
        """Verifies report submission correctly handles GPS_APPROXIMATE (>30m accuracy)."""
        files = {"image": ("waste.jpg", self.img_bytes, "image/jpeg")}
        data = {
            "latitude": "28.5355",
            "longitude": "77.3910",
            "category": "garbage",
            "address": "Noida Expressway, Sector 62",
            "location_source": "GPS_LOCKED",
            "location_accuracy": "65.0",
            "location_verification": "GPS_APPROXIMATE",
            "description": "Approximate GPS accuracy report test."
        }
        resp = self.client.post("/api/reports/submit", files=files, data=data)
        self.assertEqual(resp.status_code, 200)
        res_data = resp.json()
        self.assertEqual(res_data["location_verification"], "GPS_APPROXIMATE")

    def test_submit_report_manually_selected(self):
        """Verifies manual map pin positioning assigns MANUALLY_SELECTED verification state."""
        files = {"image": ("light.jpg", self.img_bytes, "image/jpeg")}
        data = {
            "latitude": "28.7041",
            "longitude": "77.1025",
            "category": "damaged_streetlight",
            "address": "Pitampura, New Delhi",
            "location_source": "MANUAL_PIN",
            "location_verification": "MANUALLY_SELECTED",
            "description": "Citizen positioned pin manually on the hazard spot."
        }
        resp = self.client.post("/api/reports/submit", files=files, data=data)
        self.assertEqual(resp.status_code, 200)
        res_data = resp.json()
        self.assertEqual(res_data["location_verification"], "MANUALLY_SELECTED")

    def test_invalid_verification_fallback(self):
        """Ensures arbitrary invalid verification inputs fall back safely to LOCATION_UNVERIFIED."""
        files = {"image": ("test.jpg", self.img_bytes, "image/jpeg")}
        data = {
            "latitude": "28.6139",
            "longitude": "77.2090",
            "category": "pothole",
            "location_verification": "HACKED_STATE_123"
        }
        resp = self.client.post("/api/reports/submit", files=files, data=data)
        self.assertEqual(resp.status_code, 200)
        res_data = resp.json()
        self.assertEqual(res_data["location_verification"], "LOCATION_UNVERIFIED")

    def test_admin_report_detail_contains_geospatial_metadata(self):
        """Verifies admin inspection endpoint delivers coordinates, verification, and accuracy."""
        # First submit a report
        files = {"image": ("admin_check.jpg", self.img_bytes, "image/jpeg")}
        data = {
            "latitude": "28.6289",
            "longitude": "77.2065",
            "category": "pothole",
            "address": "Mandir Marg, New Delhi",
            "location_source": "GPS_LOCKED",
            "location_accuracy": "18.5",
            "location_verification": "GPS_VERIFIED",
            "description": "Pothole near school gate."
        }
        submit_resp = self.client.post("/api/reports/submit", files=files, data=data)
        report_id = submit_resp.json()["report_id"]

        # Admin fetches details
        admin_resp = self.client.get(f"/api/reports/{report_id}", headers=self.admin_headers)
        self.assertEqual(admin_resp.status_code, 200)
        res_json = admin_resp.json()
        detail = res_json.get("report", res_json)
        self.assertAlmostEqual(detail["latitude"], 28.6289, places=3)
        self.assertAlmostEqual(detail["longitude"], 77.2065, places=3)
        self.assertEqual(detail["location_verification"], "GPS_VERIFIED")
        self.assertEqual(detail["location_source"], "GPS_LOCKED")
        self.assertAlmostEqual(detail["location_accuracy"], 18.5, places=1)
        self.assertEqual(detail["address"], "Mandir Marg, New Delhi")

    def test_geo_search_autocompletion(self):
        """Verifies geo search endpoint returns results suitable for instant suggestions."""
        resp = self.client.get("/api/geo/search?q=Saket")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("results", data)
        self.assertIsInstance(data["results"], list)

    def test_deployment_artifacts_exist(self):
        """Verifies Nginx configuration, systemd service, and EC2 setup script are present."""
        nginx_conf = ROOT_DIR / "deploy" / "nginx_civora.conf"
        service_file = ROOT_DIR / "deploy" / "civora.service"
        setup_script = ROOT_DIR / "scripts" / "setup_https_ec2.sh"

        self.assertTrue(nginx_conf.exists(), "deploy/nginx_civora.conf missing")
        self.assertTrue(service_file.exists(), "deploy/civora.service missing")
        self.assertTrue(setup_script.exists(), "scripts/setup_https_ec2.sh missing")

        # Verify key configuration directives in nginx conf
        conf_content = nginx_conf.read_text()
        self.assertIn("13.211.32.245.nip.io", conf_content)
        self.assertIn("listen 443 ssl", conf_content)
        self.assertIn("proxy_pass http://127.0.0.1:8000", conf_content)

        # Verify service file directives
        serv_content = service_file.read_text()
        self.assertIn("WorkingDirectory=/home/ubuntu/Civora-AI", serv_content)
        self.assertIn("ExecStart=/home/ubuntu/Civora-AI/venv/bin/python main.py", serv_content)
        self.assertIn("Restart=always", serv_content)


if __name__ == "__main__":
    unittest.main()

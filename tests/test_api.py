"""API integration tests using FastAPI TestClient."""
import unittest
import os
import json
from starlette.testclient import TestClient
from backend.main import app
from backend.app.database import init_db


class TestCivoraAPI(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        init_db()
        from backend.main import seed_initial_accounts
        seed_initial_accounts()
        cls.client = TestClient(app)

    def test_root_endpoint(self):
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/html", res.headers.get("content-type", ""))

        health_res = self.client.get("/api/health")
        self.assertEqual(health_res.status_code, 200)
        self.assertEqual(health_res.json()["status"], "online")

    def test_login_admin(self):
        res = self.client.post("/api/auth/login", json={
            "email": "admin@civora.org",
            "password": "admin123"
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("access_token", data)
        self.assertEqual(data["user"]["role"], "ADMIN")

    def test_login_citizen(self):
        res = self.client.post("/api/auth/login", json={
            "email": "citizen@civora.org",
            "password": "citizen123"
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("access_token", data)
        self.assertEqual(data["user"]["role"], "CITIZEN")

    def test_list_issues(self):
        res = self.client.get("/api/issues")
        self.assertEqual(res.status_code, 200)
        self.assertIn("issues", res.json())

    def test_map_issues(self):
        res = self.client.get("/api/issues/map")
        self.assertEqual(res.status_code, 200)
        self.assertIn("issues", res.json())

    def test_submit_report_and_duplicate_clustering(self):
        # Create a sample small test image in memory
        from PIL import Image
        import io
        img = Image.new("RGB", (100, 100), color=(73, 109, 137))
        img_bytes = io.BytesIO()
        img.save(img_bytes, format="JPEG")
        img_bytes.seek(0)

        import random
        # Random unique coordinate base to ensure isolated test runs
        base_lat = 30.0 + random.uniform(1.0, 50.0)
        base_lon = 70.0 + random.uniform(1.0, 50.0)

        # 1. First report submission
        res1 = self.client.post(
            "/api/reports/submit",
            data={
                "latitude": str(base_lat),
                "longitude": str(base_lon),
                "address": "North Campus Gate 3",
                "description": "Large deep pothole"
            },
            files={"image": ("test_pothole.jpg", img_bytes, "image/jpeg")}
        )
        self.assertEqual(res1.status_code, 200)
        data1 = res1.json()
        self.assertTrue(data1["success"])
        issue_id_1 = data1["issue_id"]
        self.assertFalse(data1["is_linked_to_existing_issue"])

        # 2. Second report near the same location (approx 10-15 meters away: 0.0001 deg ~ 11 meters)
        img_bytes.seek(0)
        res2 = self.client.post(
            "/api/reports/submit",
            data={
                "latitude": str(base_lat + 0.0001),
                "longitude": str(base_lon + 0.0001),
                "address": "Opposite Gate 3",
                "description": "Danger for bikes"
            },
            files={"image": ("test_pothole_2.jpg", img_bytes, "image/jpeg")}
        )
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()
        self.assertTrue(data2["success"])
        # Should link to the same issue!
        self.assertEqual(data2["issue_id"], issue_id_1)
        self.assertTrue(data2["is_linked_to_existing_issue"])


if __name__ == "__main__":
    unittest.main()

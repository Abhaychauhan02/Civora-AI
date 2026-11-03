"""
End-to-end integration tests verifying frontend static asset serving,
citizen reporting workflow, AI transparency payloads, and administrative triage lifecycle.
"""

import io
import unittest
from starlette.testclient import TestClient
from PIL import Image

from backend.main import app
from backend.app.database import init_db
from backend.app.security_utils import rate_limiter


class TestFrontendFlows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)

        # Login admin
        admin_resp = cls.client.post("/api/auth/login", json={"email": "admin@civora.org", "password": "admin123"})
        cls.admin_token = admin_resp.json().get("access_token")

        # Login citizen
        cit_resp = cls.client.post("/api/auth/login", json={"email": "citizen@civora.org", "password": "citizen123"})
        cls.citizen_token = cit_resp.json().get("access_token")

    def setUp(self):
        rate_limiter.reset()

    def test_frontend_root_and_pwa_assets_served(self):
        """Verifies that the root URL and essential PWA assets serve correctly."""
        root_resp = self.client.get("/")
        self.assertEqual(root_resp.status_code, 200)
        self.assertIn("CIVORA", root_resp.text)
        self.assertIn("Step 1: Capture or Upload Issue Photo", root_resp.text)

        # Manifest and Service Worker
        manifest_resp = self.client.get("/manifest.json")
        self.assertEqual(manifest_resp.status_code, 200)

        sw_resp = self.client.get("/sw.js")
        self.assertEqual(sw_resp.status_code, 200)

        # JS modules
        for js_file in ["app.js", "citizen.js", "admin.js", "auth.js", "api.js"]:
            resp = self.client.get(f"/js/{js_file}")
            self.assertEqual(resp.status_code, 200, f"Failed to serve /js/{js_file}")

    def test_citizen_report_submission_and_ai_transparency(self):
        """Tests that citizen report submission returns structured AI diagnostics and authenticity."""
        img_buf = io.BytesIO()
        Image.new("RGB", (128, 128), color="red").save(img_buf, format="JPEG")

        files = {"image": ("street_pothole.jpg", img_buf.getvalue(), "image/jpeg")}
        data = {
            "latitude": "28.6139",
            "longitude": "77.2090",
            "address": "North Campus Gate 3",
            "description": "Hazardous road pothole near crosswalk"
        }
        headers = {"Authorization": f"Bearer {self.citizen_token}"}

        resp = self.client.post("/api/reports/submit", files=files, data=data, headers=headers)
        self.assertEqual(resp.status_code, 200)

        res_data = resp.json()
        self.assertTrue(res_data["success"])
        self.assertIn("report_id", res_data)
        self.assertIn("issue_id", res_data)

        # Verify AI transparency breakdown
        ai = res_data["ai_analysis"]
        self.assertIn("category", ai)
        self.assertIn("confidence", ai)
        self.assertIn("severity_score", ai)
        self.assertIn("detections", ai)
        self.assertIn("authenticity", ai)

        auth = ai["authenticity"]
        self.assertIn(auth["status"], ["LIKELY_AUTHENTIC", "UNCERTAIN", "REVIEW_REQUIRED", "SUSPICIOUS"])
        self.assertIn("real_probability", auth)
        self.assertIn("ai_generated_probability", auth)
        self.assertIn("review_required", auth)

    def test_citizen_my_reports_tracking(self):
        """Verifies that citizen can track their submitted reports with lifecycle status."""
        headers = {"Authorization": f"Bearer {self.citizen_token}"}
        resp = self.client.get("/api/reports/my", headers=headers)
        self.assertEqual(resp.status_code, 200)

        data = resp.json()
        self.assertIn("reports", data)
        self.assertIsInstance(data["reports"], list)
        if data["reports"]:
            r = data["reports"][0]
            self.assertIn("issue_status", r)
            self.assertIn("ai_category", r)
            self.assertIn("authenticity_status", r)

    def test_admin_triage_and_resolution_evidence_flow(self):
        """Verifies complete admin workflow: listing, assignment, resolution with proof photo."""
        admin_headers = {"Authorization": f"Bearer {self.admin_token}"}

        # 1. List issues
        issues_resp = self.client.get("/api/issues?limit=1", headers=admin_headers)
        self.assertEqual(issues_resp.status_code, 200)
        issues = issues_resp.json().get("issues", [])
        self.assertGreater(len(issues), 0, "No issues found in database for testing triage flow")
        target_issue_id = issues[0]["id"]

        # 2. Assign staff
        assign_resp = self.client.patch(
            f"/api/issues/{target_issue_id}/assign",
            json={"assigned_to": "Officer Vikram", "assigned_department": "Public Works Dept"},
            headers=admin_headers
        )
        self.assertEqual(assign_resp.status_code, 200)

        # 3. Resolve issue with remarks and proof image
        proof_buf = io.BytesIO()
        Image.new("RGB", (64, 64), color="green").save(proof_buf, format="JPEG")

        proof_files = {"resolution_image": ("repaired_pothole.jpg", proof_buf.getvalue(), "image/jpeg")}
        proof_data = {"resolution_notes": "Bitumen patch compacted and leveled with asphalt roller."}

        resolve_resp = self.client.post(
            f"/api/issues/{target_issue_id}/resolve",
            files=proof_files,
            data=proof_data,
            headers=admin_headers
        )
        self.assertEqual(resolve_resp.status_code, 200)
        res_info = resolve_resp.json()
        self.assertEqual(res_info["status"], "RESOLVED")
        self.assertIsNotNone(res_info["resolution_image_url"])

        # 4. Verify issue details reflects resolution proof and audit timeline
        details_resp = self.client.get(f"/api/issues/{target_issue_id}")
        self.assertEqual(details_resp.status_code, 200)
        iss_data = details_resp.json()["issue"]
        self.assertEqual(iss_data["status"], "RESOLVED")
        self.assertEqual(iss_data["assigned_to"], "Officer Vikram")
        self.assertIsNotNone(iss_data["resolution_image_url"])
        self.assertGreater(len(iss_data["timeline"]), 0)


if __name__ == "__main__":
    unittest.main()

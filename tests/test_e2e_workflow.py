"""End-to-End Civic Lifecycle Integration Test Suite.

Verifies the complete municipal resolution pipeline:
Citizen Submission -> AI Analysis -> DB Persistence -> Admin Listing & Triage
-> Department Assignment -> Status Transitions -> Resolution Proof -> Citizen Lifecycle Tracking.
"""
import io
import os
import unittest
from PIL import Image
from starlette.testclient import TestClient

from backend.main import app
from backend.app.database import init_db, get_db
from backend.app.auth import hash_password


class TestEndToEndCivicWorkflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)

        cls.admin_email = "admin_e2e@civora.org"
        cls.admin_pass = "StrongAdminPass123!"
        cls.citizen_email = "citizen_e2e@civora.org"
        cls.citizen_pass = "StrongCitizenPass123!"

        # Seed test admin & citizen
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM users WHERE email IN (?, ?)", (cls.admin_email, cls.citizen_email))
            cursor.execute("""
                INSERT INTO users (id, email, password_hash, full_name, role, phone, token_version)
                VALUES (?, ?, ?, ?, ?, ?, 1)
            """, ("usr_e2e_admin", cls.admin_email, hash_password(cls.admin_pass), "E2E Municipal Director", "ADMIN", "+919876543210"))
            cursor.execute("""
                INSERT INTO users (id, email, password_hash, full_name, role, phone, token_version)
                VALUES (?, ?, ?, ?, ?, ?, 1)
            """, ("usr_e2e_citizen", cls.citizen_email, hash_password(cls.citizen_pass), "E2E Resident Citizen", "CITIZEN", "+919876543211"))

        # Obtain JWT tokens
        res_admin = cls.client.post("/api/auth/login", json={"email": cls.admin_email, "password": cls.admin_pass})
        cls.admin_token = res_admin.json()["access_token"]

        res_citizen = cls.client.post("/api/auth/login", json={"email": cls.citizen_email, "password": cls.citizen_pass})
        cls.citizen_token = res_citizen.json()["access_token"]

    def _create_sample_image(self, color=(120, 100, 80)):
        buf = io.BytesIO()
        im = Image.new("RGB", (320, 240), color=color)
        im.save(buf, format="JPEG")
        return buf.getvalue()

    def test_full_civic_lifecycle_e2e(self):
        """Validates the entire citizen-to-admin-to-resolution lifecycle without mocks."""
        citizen_headers = {"Authorization": f"Bearer {self.citizen_token}"}
        admin_headers = {"Authorization": f"Bearer {self.admin_token}"}

        # Step 1: Citizen submits report with photo and location
        img_bytes = self._create_sample_image(color=(70, 70, 70))
        submit_res = self.client.post(
            "/api/reports/submit",
            headers=citizen_headers,
            data={
                "latitude": "28.6139",
                "longitude": "77.2090",
                "category": "pothole",
                "address": "Connaught Place Radial 3",
                "description": "Deep asphalt depression causing slow moving traffic."
            },
            files={"image": ("incident.jpg", img_bytes, "image/jpeg")}
        )
        self.assertEqual(submit_res.status_code, 200, submit_res.text)
        data = submit_res.json()

        report_id = data["report_id"]
        issue_id = data["issue_id"]
        self.assertTrue(report_id.startswith("rep_"))
        self.assertTrue(issue_id.startswith("iss_"))
        self.assertIn(data["status"], ["DETECTION_FOUND", "NO_CONFIDENT_DETECTION"])
        self.assertIn("priority_level", data)
        self.assertIn("assigned_department", data)

        # Step 2: Admin lists reports and finds the newly submitted report
        list_reports_res = self.client.get("/api/reports?limit=20", headers=admin_headers)
        self.assertEqual(list_reports_res.status_code, 200)
        reports_list = list_reports_res.json()["reports"]
        matching_report = next((r for r in reports_list if r["id"] == report_id), None)
        self.assertIsNotNone(matching_report, f"Report {report_id} not found in admin reports list")
        self.assertEqual(matching_report["issue_id"], issue_id)

        # Step 3: Admin inspects the Issue details
        issue_detail_res = self.client.get(f"/api/issues/{issue_id}", headers=admin_headers)
        self.assertEqual(issue_detail_res.status_code, 200)
        issue_obj = issue_detail_res.json()["issue"]
        self.assertEqual(issue_obj["id"], issue_id)
        self.assertEqual(issue_obj["status"], "REPORTED")
        self.assertGreaterEqual(len(issue_obj["reports"]), 1)
        self.assertGreaterEqual(len(issue_obj["timeline"]), 1)

        # Step 4: Admin assigns department and crew
        assign_res = self.client.patch(
            f"/api/issues/{issue_id}/assign",
            headers=admin_headers,
            json={
                "assigned_to": "Engineer Sharma",
                "assigned_department": "Public Works Dept (Road Maintenance Wing)",
                "notes": "Dispatched emergency pothole cold-mix repair crew."
            }
        )
        self.assertEqual(assign_res.status_code, 200)
        self.assertEqual(assign_res.json()["status"], "ASSIGNED")

        # Step 5: Admin updates lifecycle status to IN_PROGRESS
        status_res = self.client.patch(
            f"/api/issues/{issue_id}/status",
            headers=admin_headers,
            json={"status": "IN_PROGRESS", "notes": "Compaction and bitumen leveling in progress."}
        )
        self.assertEqual(status_res.status_code, 200)
        self.assertEqual(status_res.json()["status"], "IN_PROGRESS")

        # Step 6: Admin marks issue RESOLVED with photographic evidence
        proof_bytes = self._create_sample_image(color=(40, 160, 40))
        resolve_res = self.client.post(
            f"/api/issues/{issue_id}/resolve",
            headers=admin_headers,
            data={"resolution_notes": "Bitumen patch completed and smoothed with 2-ton road roller."},
            files={"resolution_image": ("proof_repaired.jpg", proof_bytes, "image/jpeg")}
        )
        self.assertEqual(resolve_res.status_code, 200)
        resolve_data = resolve_res.json()
        self.assertEqual(resolve_data["status"], "RESOLVED")
        self.assertTrue(resolve_data["resolution_image_url"].startswith("/uploads/resolutions/"))

        # Step 7: Citizen checks their report history and verifies certified resolution
        my_reports_res = self.client.get("/api/reports/my", headers=citizen_headers)
        self.assertEqual(my_reports_res.status_code, 200)
        my_reports = my_reports_res.json()["reports"]
        citizen_view = next((r for r in my_reports if r["id"] == report_id), None)
        self.assertIsNotNone(citizen_view)
        self.assertEqual(citizen_view["issue_status"], "RESOLVED")
        self.assertIn("Bitumen patch completed", citizen_view["resolution_notes"])
        self.assertTrue(citizen_view["resolution_image_url"].startswith("/uploads/resolutions/"))

    def test_unauthorized_admin_reports_access_denied(self):
        """Ensures citizens cannot access admin reporting queue."""
        citizen_headers = {"Authorization": f"Bearer {self.citizen_token}"}
        res = self.client.get("/api/reports", headers=citizen_headers)
        self.assertEqual(res.status_code, 403)


if __name__ == "__main__":
    unittest.main()

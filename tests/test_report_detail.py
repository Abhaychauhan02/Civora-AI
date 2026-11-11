"""Test suite for Report Inspection Details and the 8 Operational Analytics Metrics."""
import unittest
import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from starlette.testclient import TestClient
from backend.main import app
from backend.app.database import get_db, init_db
from backend.app.auth import create_access_token


class TestReportDetailAndAnalytics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)
        cls.admin_token = create_access_token({"sub": "usr_admin_01", "role": "ADMIN", "token_version": 1})
        cls.admin_headers = {"Authorization": f"Bearer {cls.admin_token}"}

    def test_analytics_eight_metrics(self):
        """Verifies that the analytics summary returns the 8 distinct civic operational metrics."""
        resp = self.client.get("/api/admin/analytics", headers=self.admin_headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        summary = data["summary"]

        # Check all 8 verified metrics are present and are integers
        self.assertIn("total_reports", summary)
        self.assertIn("total_unique_issues", summary)
        self.assertIn("unresolved_issues", summary)
        self.assertIn("resolved_issues", summary)
        self.assertIn("unassigned_issues", summary)
        self.assertIn("corroborating_reports", summary)
        self.assertIn("awaiting_review_reports", summary)
        self.assertIn("unclassified_submissions", summary)

        self.assertIsInstance(summary["total_reports"], int)
        self.assertIsInstance(summary["total_unique_issues"], int)
        self.assertIsInstance(summary["unresolved_issues"], int)
        self.assertIsInstance(summary["resolved_issues"], int)
        self.assertIsInstance(summary["unassigned_issues"], int)
        self.assertIsInstance(summary["corroborating_reports"], int)
        self.assertIsInstance(summary["awaiting_review_reports"], int)
        self.assertIsInstance(summary["unclassified_submissions"], int)

    def test_report_detail_enrichment(self):
        """Verifies that single report inspection returns parent issue, siblings and timeline."""
        # Find an existing report in DB
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM reports LIMIT 1")
            row = cursor.fetchone()
        
        if not row:
            self.skipTest("No reports in database to test detail endpoint")

        report_id = row["id"]
        resp = self.client.get(f"/api/reports/{report_id}", headers=self.admin_headers)
        self.assertEqual(resp.status_code, 200)
        rep = resp.json()["report"]

        self.assertEqual(rep["id"], report_id)
        self.assertIn("issue_title", rep)
        self.assertIn("issue_status", rep)
        self.assertIn("sibling_reports", rep)
        self.assertIn("timeline", rep)
        self.assertIsInstance(rep["sibling_reports"], list)
        self.assertIsInstance(rep["timeline"], list)


if __name__ == "__main__":
    unittest.main()

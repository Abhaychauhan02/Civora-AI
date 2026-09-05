"""Unit tests for priority engine scoring logic."""
import unittest
from backend.app.priority_engine import calculate_dynamic_priority


class TestPriorityEngine(unittest.TestCase):

    def test_single_report_pothole(self):
        score, tier = calculate_dynamic_priority(category="pothole", base_severity=50, report_count=1)
        # base_severity * 0.5 (25) + 35 * 0.3 (10.5) + 0 = ~36
        self.assertTrue(30 <= score <= 45)
        self.assertEqual(tier, "MEDIUM")

    def test_multiple_reports_raise_priority(self):
        score1, tier1 = calculate_dynamic_priority(category="pothole", base_severity=70, report_count=1)
        score5, tier5 = calculate_dynamic_priority(category="pothole", base_severity=70, report_count=5)
        self.assertTrue(score5 > score1, f"5 reports score {score5} should be higher than 1 report score {score1}")
        self.assertIn(tier5, ["HIGH", "CRITICAL"])

    def test_bounds_never_exceed_100(self):
        score, tier = calculate_dynamic_priority(category="pothole", base_severity=100, report_count=50)
        self.assertLessEqual(score, 100)
        self.assertGreaterEqual(score, 0)
        self.assertEqual(tier, "CRITICAL")


if __name__ == "__main__":
    unittest.main()

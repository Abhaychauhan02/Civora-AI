"""Unit tests for duplicate detection and Haversine distance."""
import unittest
from backend.app.duplicate_engine import haversine_distance_meters


class TestDuplicateEngine(unittest.TestCase):

    def test_haversine_distance_zero(self):
        dist = haversine_distance_meters(28.6139, 77.2090, 28.6139, 77.2090)
        self.assertAlmostEqual(dist, 0.0, places=1)

    def test_haversine_distance_near(self):
        # Coordinates approximately 30 meters apart
        dist = haversine_distance_meters(28.61390, 77.20900, 28.61410, 77.20915)
        self.assertTrue(20.0 < dist < 45.0, f"Distance {dist} should be around 30m")

    def test_haversine_distance_far(self):
        # New Delhi to Mumbai (~1150 km)
        dist = haversine_distance_meters(28.6139, 77.2090, 19.0760, 72.8777)
        self.assertTrue(dist > 1_000_000, f"Distance {dist} should exceed 1000km")


if __name__ == "__main__":
    unittest.main()

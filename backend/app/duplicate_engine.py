"""Civora Duplicate Detection Engine.

Clusters citizen reports into single physical civic issues based on GPS distance and category.
"""
import math
from typing import Optional, Tuple
from backend.app.config import DUPLICATE_RADIUS_METERS
from backend.app.database import get_db


def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates great-circle distance between two GPS coordinates in meters."""
    R = 6371000.0  # Earth's radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


def find_existing_issue_for_report(
    category: str,
    latitude: float,
    longitude: float,
    radius_meters: float = DUPLICATE_RADIUS_METERS
) -> Optional[Tuple[str, float]]:
    """
    Checks if an unresolved issue of the same category exists within radius_meters.
    Returns (issue_id, distance_meters) or None.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        # Query only unresolved issues
        cursor.execute("""
            SELECT id, category, latitude, longitude, status, report_count
            FROM issues
            WHERE status != 'RESOLVED'
        """)
        rows = cursor.fetchall()

        closest_issue_id = None
        min_distance = float("inf")

        for row in rows:
            # Check matching category
            if row["category"].lower() == category.lower():
                dist = haversine_distance_meters(latitude, longitude, row["latitude"], row["longitude"])
                if dist <= radius_meters and dist < min_distance:
                    min_distance = dist
                    closest_issue_id = row["id"]

        if closest_issue_id:
            return closest_issue_id, round(min_distance, 1)
        return None

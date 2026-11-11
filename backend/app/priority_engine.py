"""Civora Priority Engine.

Calculates dynamic priority score and priority tier for civic issues based on:
- AI Severity score
- Total number of citizen reports (duplicate cluster size)
- Category risk weight (e.g. pothole on road vs garbage)
- Age/Time pending
"""
from datetime import datetime
from typing import Tuple


CATEGORY_RISK_WEIGHTS = {
    "pothole": 50,              # High road hazard for two-wheelers & vehicular traffic
    "waterlogging": 45,         # Road submergence, pedestrian hazard & drain overflow
    "damaged_streetlight": 40,  # Night visibility & pedestrian safety
    "streetlight": 40,
    "garbage": 35,              # Sanitation & public hygiene
    "other": 25
}


def calculate_dynamic_priority(
    category: str,
    base_severity: int,
    report_count: int,
    created_at_iso: str = None
) -> Tuple[int, str]:
    """
    Computes priority score (0-100) and corresponding priority tier:
    Score = (0.55 * base_severity) + (category_risk_weight * 0.35) + (report_count_bump) + (aging_bump)
    """
    cat_key = category.lower() if category.lower() in CATEGORY_RISK_WEIGHTS else "other"
    category_factor = CATEGORY_RISK_WEIGHTS[cat_key]

    # Multiple reports bump urgency (+6 points per extra report, up to +30)
    report_bump = min((max(1, report_count) - 1) * 6, 30)

    # Aging factor (points for older unresolved issues)
    aging_bump = 0
    if created_at_iso:
        try:
            created_dt = datetime.fromisoformat(created_at_iso.replace("Z", "+00:00"))
            hours_old = (datetime.now() - created_dt.replace(tzinfo=None)).total_seconds() / 3600.0
            aging_bump = min(int(hours_old / 12) * 2, 20)  # +2 points per 12 hours up to +20
        except Exception:
            aging_bump = 0

    # Composite formula
    raw_score = (base_severity * 0.55) + (category_factor * 0.35) + report_bump + aging_bump
    score = max(15, min(100, round(raw_score)))

    # Priority tier classification
    if score >= 75:
        tier = "CRITICAL"
    elif score >= 55:
        tier = "HIGH"
    elif score >= 35:
        tier = "MEDIUM"
    else:
        tier = "LOW"

    return score, tier

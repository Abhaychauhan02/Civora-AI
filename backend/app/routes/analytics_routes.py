"""Analytics and operational metrics endpoints for Administrators."""
from fastapi import APIRouter, Depends
from backend.app.database import get_db
from backend.app.auth import require_admin

router = APIRouter(prefix="/api/admin/analytics", tags=["Analytics"])


@router.get("")
def get_dashboard_analytics(admin_user: dict = Depends(require_admin)):
    """Computes high-level civic metrics for the authority dashboard."""
    with get_db() as conn:
        cursor = conn.cursor()

        # Total counts
        cursor.execute("SELECT COUNT(*) as total FROM issues")
        total_issues = cursor.fetchone()["total"]

        cursor.execute("SELECT COUNT(*) as total FROM reports")
        total_reports = cursor.fetchone()["total"]

        # Status breakdown
        cursor.execute("""
            SELECT status, COUNT(*) as count 
            FROM issues 
            GROUP BY status
        """)
        status_counts = {r["status"]: r["count"] for r in cursor.fetchall()}

        # Category breakdown
        cursor.execute("""
            SELECT category, COUNT(*) as count 
            FROM issues 
            GROUP BY category
        """)
        category_counts = {r["category"]: r["count"] for r in cursor.fetchall()}

        # Priority breakdown
        cursor.execute("""
            SELECT priority_level, COUNT(*) as count 
            FROM issues 
            GROUP BY priority_level
        """)
        priority_counts = {r["priority_level"]: r["count"] for r in cursor.fetchall()}

        # Duplicate / corroborating reports count
        duplicates_prevented = max(0, total_reports - total_issues)

        # Unresolved unique issues (active operations)
        cursor.execute("SELECT COUNT(*) as count FROM issues WHERE status != 'RESOLVED'")
        unresolved_issues = cursor.fetchone()["count"]

        # Resolved issues
        resolved_issues = status_counts.get("RESOLVED", 0)

        # Unassigned issues (awaiting department/technician dispatch)
        cursor.execute("""
            SELECT COUNT(*) as count FROM issues 
            WHERE (assigned_to IS NULL OR assigned_to = '' OR assigned_department IS NULL OR assigned_department = '')
            AND status != 'RESOLVED'
        """)
        unassigned_issues = cursor.fetchone()["count"]

        # Reports awaiting human review
        cursor.execute("""
            SELECT COUNT(*) as count FROM reports 
            WHERE authenticity_status IN ('REVIEW_REQUIRED', 'SUSPICIOUS') OR ai_confidence IS NULL
        """)
        awaiting_review_reports = cursor.fetchone()["count"]

        # Unclassified submissions
        cursor.execute("""
            SELECT COUNT(*) as count FROM reports 
            WHERE ai_category IS NULL OR ai_category IN ('unclassified', 'general_infrastructure')
        """)
        unclassified_submissions = cursor.fetchone()["count"]

        # Average resolution time in hours for resolved issues
        cursor.execute("""
            SELECT 
                AVG((julianday(resolved_at) - julianday(created_at)) * 24) as avg_resolution_hours
            FROM issues
            WHERE status = 'RESOLVED' AND resolved_at IS NOT NULL
        """)
        avg_res_row = cursor.fetchone()
        avg_resolution_hours = round(avg_res_row["avg_resolution_hours"], 1) if avg_res_row and avg_res_row["avg_resolution_hours"] else None

        return {
            "summary": {
                "total_issues": total_issues,
                "total_reports": total_reports,
                "total_unique_issues": total_issues,
                "unresolved_issues": unresolved_issues,
                "resolved_issues": resolved_issues,
                "unassigned_issues": unassigned_issues,
                "corroborating_reports": duplicates_prevented,
                "duplicates_prevented": duplicates_prevented,
                "awaiting_review_reports": awaiting_review_reports,
                "unclassified_submissions": unclassified_submissions,
                "resolved_count": resolved_issues,
                "in_progress_count": status_counts.get("IN_PROGRESS", 0),
                "pending_count": status_counts.get("PENDING", 0) + status_counts.get("REPORTED", 0),
                "critical_count": priority_counts.get("CRITICAL", 0) + priority_counts.get("HIGH", 0),
                "avg_resolution_hours": avg_resolution_hours
            },
            "by_status": status_counts,
            "by_category": category_counts,
            "by_priority": priority_counts
        }

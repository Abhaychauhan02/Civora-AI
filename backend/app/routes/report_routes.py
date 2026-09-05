"""Report submission and citizen reporting endpoints."""
import os
import uuid
import json
import shutil
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends

from backend.app.config import UPLOAD_DIR
from backend.app.database import get_db
from backend.app.auth import get_current_user, require_auth
from backend.app.ai_client import analyze_civic_image
from backend.app.duplicate_engine import find_existing_issue_for_report
from backend.app.priority_engine import calculate_dynamic_priority

router = APIRouter(prefix="/api/reports", tags=["Reports"])


@router.post("/submit")
async def submit_report(
    image: UploadFile = File(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    address: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    current_user: Optional[dict] = Depends(get_current_user)
):
    """
    Submits a civic report:
    1. Saves image to storage
    2. Runs AI vision analysis (YOLOv8 + Authenticity + Severity)
    3. Checks for nearby duplicates (~50m) of the same category
    4. Creates a new Issue OR links to an existing Issue
    5. Recalculates dynamic priority
    """
    # 1. Save uploaded image
    file_ext = os.path.splitext(image.filename or "image.jpg")[1] or ".jpg"
    report_filename = f"rep_{uuid.uuid4().hex[:12]}{file_ext}"
    report_rel_path = os.path.join("reports", report_filename)
    report_abs_path = os.path.join(UPLOAD_DIR, report_rel_path)

    with open(report_abs_path, "wb") as buffer:
        shutil.copyfileobj(image.file, buffer)

    # 2. Analyze with AI
    ai_result = await analyze_civic_image(report_abs_path)

    detections = ai_result.get("detections", [])
    authenticity = ai_result.get("authenticity", {})
    severity_score = int(ai_result.get("severity_score", 30))
    auth_status = authenticity.get("status", "LIKELY_AUTHENTIC")

    # Determine primary category and confidence
    if detections:
        top_det = max(detections, key=lambda d: d.get("confidence", 0))
        primary_category = top_det.get("issue", "general_issue")
        primary_confidence = float(top_det.get("confidence", 0.0))
    else:
        primary_category = "unclassified"
        primary_confidence = 0.0

    user_id = current_user["id"] if current_user else None
    user_name = current_user["full_name"] if current_user else "Anonymous Citizen"
    report_id = f"rep_{uuid.uuid4().hex[:10]}"
    image_web_url = f"/uploads/reports/{report_filename}"

    # 3. Check for existing duplicate issue
    is_duplicate = False
    duplicate_match = find_existing_issue_for_report(primary_category, latitude, longitude)

    with get_db() as conn:
        cursor = conn.cursor()

        if duplicate_match:
            # Found existing active issue in vicinity!
            issue_id, dist_meters = duplicate_match
            is_duplicate = True

            cursor.execute("SELECT report_count, priority_score, created_at FROM issues WHERE id = ?", (issue_id,))
            issue_row = cursor.fetchone()
            current_count = issue_row["report_count"] + 1
            created_at_str = issue_row["created_at"]

            # Recalculate bumped priority
            new_score, new_tier = calculate_dynamic_priority(
                category=primary_category,
                base_severity=severity_score,
                report_count=current_count,
                created_at_iso=created_at_str
            )

            cursor.execute("""
                UPDATE issues
                SET report_count = ?,
                    priority_score = ?,
                    priority_level = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (current_count, new_score, new_tier, issue_id))

            # Audit timeline
            cursor.execute("""
                INSERT INTO issue_timeline (id, issue_id, from_status, to_status, action_notes, actor_name)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                str(uuid.uuid4()),
                issue_id,
                None,
                "UPDATED",
                f"New corroborating citizen report added ({dist_meters}m away). Total reports: {current_count}. Priority raised to {new_score} ({new_tier}).",
                user_name
            ))

        else:
            # Create a brand new issue
            issue_id = f"iss_{uuid.uuid4().hex[:8]}"
            cat_display = primary_category.replace("_", " ").title()
            issue_title = f"{cat_display} at {address or f'Lat {latitude:.4f}, Lon {longitude:.4f}'}"

            initial_score, initial_tier = calculate_dynamic_priority(
                category=primary_category,
                base_severity=severity_score,
                report_count=1
            )

            cursor.execute("""
                INSERT INTO issues (
                    id, title, category, description, latitude, longitude, address,
                    status, priority_score, priority_level, report_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'REPORTED', ?, ?, 1)
            """, (
                issue_id, issue_title, primary_category, description,
                latitude, longitude, address, initial_score, initial_tier
            ))

            # Timeline initial entry
            cursor.execute("""
                INSERT INTO issue_timeline (id, issue_id, from_status, to_status, action_notes, actor_name)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                str(uuid.uuid4()),
                issue_id,
                None,
                "REPORTED",
                f"Issue filed by {user_name} via AI detection: {primary_category} ({int(primary_confidence*100)}% conf).",
                user_name
            ))

        # 4. Insert Report record
        cursor.execute("""
            INSERT INTO reports (
                id, issue_id, user_id, image_url, latitude, longitude, address,
                description, ai_category, ai_confidence, ai_detections_json,
                authenticity_status, severity_score
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            report_id, issue_id, user_id, image_web_url, latitude, longitude, address,
            description, primary_category, primary_confidence,
            json.dumps(detections), auth_status, severity_score
        ))

    return {
        "success": True,
        "message": "Report submitted and analyzed successfully",
        "report_id": report_id,
        "issue_id": issue_id,
        "is_linked_to_existing_issue": is_duplicate,
        "ai_analysis": {
            "category": primary_category,
            "confidence": primary_confidence,
            "severity_score": severity_score,
            "authenticity": authenticity,
            "detections": detections
        }
    }


@router.get("/my")
def get_my_reports(user: dict = Depends(require_auth)):
    """Retrieves all reports submitted by the logged-in citizen with associated issue status."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                r.id, r.issue_id, r.image_url, r.latitude, r.longitude, r.address,
                r.description, r.ai_category, r.ai_confidence, r.authenticity_status,
                r.severity_score, r.created_at,
                i.title as issue_title, i.status as issue_status,
                i.priority_level as issue_priority, i.resolution_image_url,
                i.resolution_notes, i.resolved_at
            FROM reports r
            LEFT JOIN issues i ON r.issue_id = i.id
            WHERE r.user_id = ?
            ORDER BY r.created_at DESC
        """, (user["id"],))
        rows = cursor.fetchall()
        return {"reports": [dict(r) for r in rows]}


@router.get("/{report_id}")
def get_report_details(report_id: str):
    """Retrieves single report details."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT r.*, i.status as issue_status, i.title as issue_title
            FROM reports r
            LEFT JOIN issues i ON r.issue_id = i.id
            WHERE r.id = ?
        """, (report_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Report not found")
        data = dict(row)
        if data.get("ai_detections_json"):
            data["detections"] = json.loads(data["ai_detections_json"])
        return {"report": data}

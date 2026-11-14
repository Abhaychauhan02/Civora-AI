"""Report submission and citizen reporting endpoints with strict security validation."""
import os
import uuid
import json
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, Request

from backend.app.config import UPLOAD_DIR
from backend.app.database import get_db
from backend.app.auth import get_current_user, require_auth, require_admin
from backend.app.ai_client import analyze_civic_image
from backend.app.duplicate_engine import find_existing_issue_for_report
from backend.app.priority_engine import calculate_dynamic_priority
from backend.app.security_utils import validate_image_upload, enforce_rate_limit

from pydantic import BaseModel

router = APIRouter(prefix="/api/reports", tags=["Reports"])


class CategoryOverrideRequest(BaseModel):
    category: str
    reason: str


@router.post("/pre-scan")
async def prescan_report_image(
    request: Request,
    image: UploadFile = File(...)
):
    """
    Instant AI visual defect localization and pre-submission screening:
    Accepts raw citizen photo, runs instance-level YOLO detection and authenticity screening,
    and returns exact bounding boxes, confidence, defect sizes, and suggested category.
    Does NOT persist to the database.
    """
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(f"prescan:{client_ip}", max_requests=40, window_seconds=60, action_name="image pre-scan")

    try:
        file_bytes = await image.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read image: {str(exc)}")

    is_valid, err_msg, canonical_ext = validate_image_upload(file_bytes, image.filename or "scan.jpg")
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Image validation failed: {err_msg}")

    # Stage temporary image in staging directory
    staging_filename = f"scan_{uuid.uuid4().hex[:12]}{canonical_ext}"
    staging_rel_path = os.path.join("staging", staging_filename)
    staging_abs_path = os.path.join(UPLOAD_DIR, staging_rel_path)

    os.makedirs(os.path.dirname(staging_abs_path), exist_ok=True)
    with open(staging_abs_path, "wb") as buffer:
        buffer.write(file_bytes)

    try:
        ai_result = await analyze_civic_image(staging_abs_path)
    finally:
        # Cleanup temporary staging file
        try:
            if os.path.exists(staging_abs_path):
                os.remove(staging_abs_path)
        except Exception:
            pass

    detections = ai_result.get("detections", [])
    authenticity = ai_result.get("authenticity", {})
    severity_score = int(ai_result.get("severity_score", 40))

    if detections:
        top_det = max(detections, key=lambda d: d.get("confidence", 0.0))
        suggested_category = top_det.get("class_name") or top_det.get("issue")
        detection_status = "DETECTION_FOUND"
    else:
        suggested_category = "unclassified"
        detection_status = "NO_CONFIDENT_DETECTION"

    return {
        "status": detection_status,
        "model_version": ai_result.get("model_version", "civora-yolo-v1-improved"),
        "image_width": ai_result.get("image_width", 640),
        "image_height": ai_result.get("image_height", 640),
        "detections": detections,
        "authenticity": authenticity,
        "suggested_category": suggested_category,
        "severity_score": severity_score,
        "hazard_count": len(detections)
    }


@router.post("/submit")
async def submit_report(
    request: Request,
    image: UploadFile = File(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    category: Optional[str] = Form(None),
    address: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    location_source: Optional[str] = Form("MANUAL_PIN"),
    location_accuracy: Optional[float] = Form(None),
    current_user: Optional[dict] = Depends(get_current_user)
):
    """
    Submits a civic report:
    1. Enforces rate limits
    2. Validates geographical boundaries
    3. Validates uploaded image format, size, magic bytes, and image decoding
    4. Runs AI vision analysis (YOLOv8 + Authenticity + Severity)
    5. Checks for nearby duplicates (~50m) of the same category
    6. Creates a new Issue OR links to an existing Issue
    7. Recalculates dynamic priority
    """
    # 1. Rate limiting
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(f"report_submit:{client_ip}", max_requests=20, window_seconds=60, action_name="report submission")

    # 2. Coordinate validation
    if not (-90.0 <= latitude <= 90.0):
        raise HTTPException(status_code=400, detail="Latitude must be between -90.0 and 90.0 degrees")
    if not (-180.0 <= longitude <= 180.0):
        raise HTTPException(status_code=400, detail="Longitude must be between -180.0 and 180.0 degrees")

    # 3. Secure Image Validation
    try:
        file_bytes = await image.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read uploaded image: {str(exc)}")

    is_valid, err_msg, canonical_ext = validate_image_upload(file_bytes, image.filename or "image.jpg")
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Image upload validation failed: {err_msg}")

    # 4. Save validated image to storage using sanitized UUID filename
    report_filename = f"rep_{uuid.uuid4().hex[:12]}{canonical_ext}"
    report_rel_path = os.path.join("reports", report_filename)
    report_abs_path = os.path.join(UPLOAD_DIR, report_rel_path)

    os.makedirs(os.path.dirname(report_abs_path), exist_ok=True)
    with open(report_abs_path, "wb") as buffer:
        buffer.write(file_bytes)

    # 5. Analyze with AI
    ai_result = await analyze_civic_image(report_abs_path)

    detections = ai_result.get("detections", [])
    authenticity = ai_result.get("authenticity", {})
    severity_score = int(ai_result.get("severity_score", 30))
    auth_status = authenticity.get("status", "LIKELY_AUTHENTIC")

    # Determine primary category and confidence from real AI detection
    if detections:
        top_det = max(detections, key=lambda d: d.get("confidence", 0.0))
        ai_detected_category = top_det.get("class_name") or top_det.get("issue")
        primary_confidence = float(top_det.get("confidence", 0.0))
        detection_status = "DETECTION_FOUND"
        primary_category = ai_detected_category
    else:
        # Real triage: no fabricated boxes, citizen category is accepted for routing
        ai_detected_category = None
        primary_confidence = None
        detection_status = "NO_CONFIDENT_DETECTION"
        primary_category = (category or "general_infrastructure").strip().lower().replace(" ", "_")

    user_id = current_user["id"] if current_user else None
    user_name = current_user["full_name"] if current_user else "Anonymous Citizen"
    report_id = f"rep_{uuid.uuid4().hex[:10]}"
    image_web_url = f"/uploads/reports/{report_filename}"

    # 6. Check for existing duplicate issue
    is_duplicate = False
    duplicate_match = find_existing_issue_for_report(primary_category, latitude, longitude)

    with get_db() as conn:
        cursor = conn.cursor()

        if duplicate_match:
            issue_id, dist_meters = duplicate_match
            is_duplicate = True

            cursor.execute("SELECT report_count, priority_score, created_at FROM issues WHERE id = ?", (issue_id,))
            issue_row = cursor.fetchone()
            current_count = issue_row["report_count"] + 1
            created_at_str = issue_row["created_at"]

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
                    status, priority_score, priority_level, report_count, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'REPORTED', ?, ?, 1, CURRENT_TIMESTAMP)
            """, (
                issue_id, issue_title, primary_category, description or "Citizen reported civic issue.",
                latitude, longitude, address or f"Lat {latitude:.4f}, Lon {longitude:.4f}", initial_score, initial_tier
            ))

            conf_str = f"{int(primary_confidence * 100)}% conf" if primary_confidence is not None else "manual triage"
            cursor.execute("""
                INSERT INTO issue_timeline (id, issue_id, from_status, to_status, action_notes, actor_name)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                str(uuid.uuid4()),
                issue_id,
                None,
                "REPORTED",
                f"Issue filed by {user_name}: {primary_category} ({conf_str}).",
                user_name
            ))

        cursor.execute("""
            INSERT INTO reports (
                id, issue_id, user_id, image_url, latitude, longitude, address,
                description, citizen_category, ai_category, ai_confidence, ai_detections_json,
                authenticity_status, severity_score, location_source, location_accuracy
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            report_id, issue_id, user_id, image_web_url, latitude, longitude,
            address or f"Lat {latitude:.4f}, Lon {longitude:.4f}",
            description, category, ai_detected_category, primary_confidence,
            json.dumps(detections), auth_status, severity_score, location_source or "MANUAL_PIN",
            location_accuracy
        ))

    effective_tier = new_tier if is_duplicate else initial_tier
    effective_score = new_score if is_duplicate else initial_score
    dept_map = {
        "pothole": "Public Works Dept (Road Maintenance Wing)",
        "garbage": "Municipal Sanitation & Waste Bureau",
        "damaged_streetlight": "City Electrical Utility Board",
        "streetlight": "City Electrical Utility Board",
        "waterlogging": "Drainage & Flood Management Wing"
    }
    dept_assigned = dept_map.get(primary_category, "Municipal Infrastructure Services")

    return {
        "success": True,
        "message": "Report submitted and analyzed successfully",
        "report_id": report_id,
        "issue_id": issue_id,
        "is_linked_to_existing_issue": is_duplicate,
        "status": detection_status,
        "ai_category": ai_detected_category,
        "ai_confidence": primary_confidence,
        "citizen_category": category,
        "routing_category": primary_category,
        "ai_detections": detections,
        "authenticity_result": authenticity,
        "severity_score": severity_score,
        "priority_level": effective_tier,
        "priority_score": effective_score,
        "assigned_department": dept_assigned,
        "ai_analysis": {
            "status": detection_status,
            "category": ai_detected_category or primary_category,
            "confidence": primary_confidence,
            "severity_score": severity_score,
            "priority_level": effective_tier,
            "priority_score": effective_score,
            "authenticity": authenticity,
            "detections": detections,
            "assigned_department": dept_assigned
        }
    }


@router.get("")
def list_reports(
    limit: int = 50,
    offset: int = 0,
    category: Optional[str] = None,
    authenticity_status: Optional[str] = None,
    admin_user: dict = Depends(require_admin)
):
    """
    Admin-only endpoint to retrieve all citizen incident reports with pagination,
    filtering, and linked parent issue metadata.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        query = """
            SELECT 
                r.id, r.issue_id, r.user_id, r.image_url, r.latitude, r.longitude, r.address,
                r.description, r.ai_category, r.ai_confidence, r.ai_detections_json,
                r.authenticity_status, r.severity_score, r.created_at,
                i.title as issue_title, i.status as issue_status,
                i.priority_level as issue_priority, i.priority_score as issue_priority_score,
                i.assigned_department, i.assigned_to,
                u.full_name as reporter_name, u.email as reporter_email
            FROM reports r
            LEFT JOIN issues i ON r.issue_id = i.id
            LEFT JOIN users u ON r.user_id = u.id
            WHERE 1=1
        """
        params = []
        if category:
            query += " AND (r.ai_category = ? OR i.category = ?)"
            params.extend([category.lower(), category.lower()])
        if authenticity_status:
            query += " AND r.authenticity_status = ?"
            params.append(authenticity_status.upper())
        query += " ORDER BY r.created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor.execute(query, tuple(params))
        rows = cursor.fetchall()

        reports = []
        for r in rows:
            rd = dict(r)
            if rd.get("ai_detections_json"):
                try:
                    rd["detections"] = json.loads(rd["ai_detections_json"])
                except Exception:
                    rd["detections"] = []
            else:
                rd["detections"] = []
            reports.append(rd)

        return {"reports": reports, "total": len(reports), "limit": limit, "offset": offset}


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
def get_report_details(report_id: str, current_user: Optional[dict] = Depends(get_current_user)):
    """
    Retrieves comprehensive single report details including:
    - Complete citizen submission metadata (coordinates, timestamp, address, description, photo)
    - Full AI vision detections, real confidence %, authenticity score & explanations
    - Parent issue operational state (priority score, department assignment, staff, resolution proof)
    - Sibling corroborating reports under the same deduplicated issue
    - Complete chronological timeline / audit trail
    Enforces authorization: Reporter contact info is only visible to ADMIN or the reporting citizen.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                r.*,
                i.title as issue_title, i.status as issue_status, i.category as issue_category,
                i.priority_score as issue_priority_score, i.priority_level as issue_priority_level,
                i.assigned_to as issue_assigned_to, i.assigned_department as issue_assigned_department,
                i.resolution_image_url as issue_resolution_image_url, i.resolution_notes as issue_resolution_notes,
                i.resolved_at as issue_resolved_at, i.created_at as issue_created_at,
                i.report_count as issue_report_count,
                u.full_name as reporter_name, u.email as reporter_email, u.phone as reporter_phone
            FROM reports r
            LEFT JOIN issues i ON r.issue_id = i.id
            LEFT JOIN users u ON r.user_id = u.id
            WHERE r.id = ?
        """, (report_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Report not found")
        data = dict(row)

        is_owner = current_user and current_user.get("id") == data.get("user_id")
        is_admin = current_user and current_user.get("role") == "ADMIN"

        # Privacy / IDOR protection: redact contact details if not owner or admin
        if not is_owner and not is_admin:
            data["user_id"] = None
            data["reporter_name"] = "Anonymous Citizen"
            data["reporter_email"] = None
            data["reporter_phone"] = None
        else:
            if not data.get("reporter_name"):
                data["reporter_name"] = "Community Citizen"

        # Parse detections JSON
        if data.get("ai_detections_json"):
            try:
                data["detections"] = json.loads(data["ai_detections_json"])
            except Exception:
                data["detections"] = []
        else:
            data["detections"] = []

        # Fetch sibling corroborating reports sharing the same parent issue
        siblings = []
        if data.get("issue_id"):
            cursor.execute("""
                SELECT id, image_url, ai_category, ai_confidence, authenticity_status, created_at, address
                FROM reports
                WHERE issue_id = ? AND id != ?
                ORDER BY created_at DESC
            """, (data["issue_id"], report_id))
            siblings = [dict(s) for s in cursor.fetchall()]
        data["sibling_reports"] = siblings

        # Fetch audit timeline for the issue
        timeline = []
        if data.get("issue_id"):
            cursor.execute("""
                SELECT id, from_status, to_status, action_notes, actor_name, created_at
                FROM issue_timeline
                WHERE issue_id = ?
                ORDER BY created_at ASC
            """, (data["issue_id"],))
            timeline = [dict(t) for t in cursor.fetchall()]
        data["timeline"] = timeline

        return {"report": data}


@router.patch("/{report_id}/admin-override")
def admin_override_category(
    report_id: str,
    payload: CategoryOverrideRequest,
    admin_user: dict = Depends(require_admin)
):
    """
    Administrative category correction:
    Permits authorized administrators to correct an AI misclassification or specify ground truth.
    Preserves:
    - Original AI prediction (untouched)
    - Original Citizen category (untouched)
    - Admin verified category, reason, admin identity, and timestamp.
    - Appends audit log to issue_timeline.
    """
    valid_categories = {"pothole", "garbage", "damaged_streetlight", "streetlight", "waterlogging", "other"}
    clean_cat = payload.category.strip().lower().replace(" ", "_")
    if clean_cat not in valid_categories:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category '{payload.category}'. Must be one of: {sorted(list(valid_categories))}"
        )

    if not payload.reason or not payload.reason.strip():
        raise HTTPException(status_code=400, detail="Correction reason is required for administrative audit.")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, issue_id, ai_category, citizen_category FROM reports WHERE id = ?", (report_id,))
        rep = cursor.fetchone()
        if not rep:
            raise HTTPException(status_code=404, detail="Report not found")

        # Update report record with verified category metadata
        cursor.execute("""
            UPDATE reports
            SET admin_verified_category = ?,
                admin_correction_reason = ?,
                admin_verified_by = ?,
                admin_verified_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (clean_cat, payload.reason.strip(), admin_user["full_name"], report_id))

        # Also update parent issue category and recalculate department if parent exists
        issue_id = rep["issue_id"]
        if issue_id:
            dept_map = {
                "pothole": "Public Works Dept (Road Maintenance Wing)",
                "garbage": "Municipal Sanitation & Waste Bureau",
                "damaged_streetlight": "City Electrical Utility Board",
                "streetlight": "City Electrical Utility Board",
                "waterlogging": "Drainage & Flood Management Wing"
            }
            new_dept = dept_map.get(clean_cat, "Municipal Infrastructure Services")

            cursor.execute("""
                UPDATE issues
                SET category = ?,
                    assigned_department = ?,
                    admin_verified_category = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (clean_cat, new_dept, clean_cat, issue_id))

            cursor.execute("""
                INSERT INTO issue_timeline (id, issue_id, from_status, to_status, action_notes, actor_name)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                str(uuid.uuid4()),
                issue_id,
                None,
                "CATEGORY_OVERRIDE",
                f"Admin {admin_user['full_name']} verified category as '{clean_cat}'. Reason: {payload.reason.strip()}",
                admin_user["full_name"]
            ))

        conn.commit()

        return {
            "success": True,
            "message": f"Category verified as '{clean_cat}' successfully.",
            "report_id": report_id,
            "admin_verified_category": clean_cat,
            "admin_correction_reason": payload.reason.strip(),
            "admin_verified_by": admin_user["full_name"]
        }

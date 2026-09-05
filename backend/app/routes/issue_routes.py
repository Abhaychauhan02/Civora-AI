"""Issue management, lifecycle, assignment, and resolution endpoints."""
import os
import uuid
import json
import shutil
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Query
from pydantic import BaseModel

from backend.app.config import UPLOAD_DIR
from backend.app.database import get_db
from backend.app.auth import require_admin, require_auth

router = APIRouter(prefix="/api/issues", tags=["Issues"])


class StatusUpdateRequest(BaseModel):
    status: str  # 'REPORTED', 'PENDING', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'
    notes: Optional[str] = None


class AssignRequest(BaseModel):
    assigned_to: str
    assigned_department: Optional[str] = None
    notes: Optional[str] = None


@router.get("")
def list_issues(
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    """Lists issues with multi-criteria filtering and sorting by priority score."""
    with get_db() as conn:
        cursor = conn.cursor()
        query = "SELECT * FROM issues WHERE 1=1"
        params = []

        if status:
            query += " AND status = ?"
            params.append(status.upper())
        if category:
            query += " AND category = ?"
            params.append(category.lower())
        if priority:
            query += " AND priority_level = ?"
            params.append(priority.upper())
        if search:
            query += " AND (title LIKE ? OR address LIKE ? OR description LIKE ?)"
            term = f"%{search.strip()}%"
            params.extend([term, term, term])

        query += " ORDER BY priority_score DESC, updated_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor.execute(query, tuple(params))
        rows = cursor.fetchall()
        return {"issues": [dict(r) for r in rows]}


@router.get("/map")
def get_map_issues():
    """Returns lightweight geo-points for rendering map pins across the city/campus."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, title, category, latitude, longitude, address, status,
                   priority_score, priority_level, report_count, created_at
            FROM issues
            ORDER BY priority_score DESC
        """)
        rows = cursor.fetchall()
        return {"issues": [dict(r) for r in rows]}


@router.get("/{issue_id}")
def get_issue_details(issue_id: str):
    """Returns comprehensive issue details, including all citizen reports and timeline."""
    with get_db() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM issues WHERE id = ?", (issue_id,))
        issue_row = cursor.fetchone()
        if not issue_row:
            raise HTTPException(status_code=404, detail="Issue not found")
        issue_data = dict(issue_row)

        # Fetch all citizen reports linked to this issue
        cursor.execute("""
            SELECT r.*, u.full_name as reporter_name
            FROM reports r
            LEFT JOIN users u ON r.user_id = u.id
            WHERE r.issue_id = ?
            ORDER BY r.created_at ASC
        """, (issue_id,))
        reports_rows = cursor.fetchall()
        reports = []
        for r in reports_rows:
            rd = dict(r)
            if rd.get("ai_detections_json"):
                try:
                    rd["detections"] = json.loads(rd["ai_detections_json"])
                except Exception:
                    rd["detections"] = []
            reports.append(rd)
        issue_data["reports"] = reports

        # Fetch lifecycle timeline audit trail
        cursor.execute("""
            SELECT * FROM issue_timeline
            WHERE issue_id = ?
            ORDER BY created_at ASC
        """, (issue_id,))
        timeline_rows = cursor.fetchall()
        issue_data["timeline"] = [dict(t) for t in timeline_rows]

        return {"issue": issue_data}


@router.patch("/{issue_id}/status")
def update_issue_status(
    issue_id: str,
    req: StatusUpdateRequest,
    admin_user: dict = Depends(require_admin)
):
    """Admin updates the lifecycle status of an issue."""
    valid_statuses = ["REPORTED", "PENDING", "ASSIGNED", "IN_PROGRESS", "RESOLVED"]
    target_status = req.status.upper()
    if target_status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid_statuses}")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT status FROM issues WHERE id = ?", (issue_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Issue not found")

        prev_status = row["status"]
        cursor.execute("""
            UPDATE issues
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (target_status, issue_id))

        # Log timeline
        cursor.execute("""
            INSERT INTO issue_timeline (id, issue_id, from_status, to_status, action_notes, actor_name)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            str(uuid.uuid4()),
            issue_id,
            prev_status,
            target_status,
            req.notes or f"Status changed from {prev_status} to {target_status}",
            admin_user["full_name"]
        ))

    return {"success": True, "issue_id": issue_id, "status": target_status}


@router.patch("/{issue_id}/assign")
def assign_issue(
    issue_id: str,
    req: AssignRequest,
    admin_user: dict = Depends(require_admin)
):
    """Admin assigns issue to a staff member or department."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT status FROM issues WHERE id = ?", (issue_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Issue not found")

        prev_status = row["status"]
        new_status = "ASSIGNED" if prev_status in ["REPORTED", "PENDING"] else prev_status

        cursor.execute("""
            UPDATE issues
            SET assigned_to = ?,
                assigned_department = ?,
                status = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (req.assigned_to, req.assigned_department, new_status, issue_id))

        notes = f"Assigned to {req.assigned_to} ({req.assigned_department or 'Maintenance Team'}). {req.notes or ''}".strip()
        cursor.execute("""
            INSERT INTO issue_timeline (id, issue_id, from_status, to_status, action_notes, actor_name)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            str(uuid.uuid4()),
            issue_id,
            prev_status,
            new_status,
            notes,
            admin_user["full_name"]
        ))

    return {"success": True, "issue_id": issue_id, "assigned_to": req.assigned_to, "status": new_status}


@router.post("/{issue_id}/resolve")
async def resolve_issue(
    issue_id: str,
    resolution_notes: str = Form(...),
    resolution_image: Optional[UploadFile] = File(None),
    admin_user: dict = Depends(require_admin)
):
    """
    Closes the issue with mandatory resolution remarks and optional resolution proof photo.
    """
    res_web_url = None
    if resolution_image:
        file_ext = os.path.splitext(resolution_image.filename or "proof.jpg")[1] or ".jpg"
        res_filename = f"res_{uuid.uuid4().hex[:12]}{file_ext}"
        res_rel_path = os.path.join("resolutions", res_filename)
        res_abs_path = os.path.join(UPLOAD_DIR, res_rel_path)

        with open(res_abs_path, "wb") as buf:
            shutil.copyfileobj(resolution_image.file, buf)
        res_web_url = f"/uploads/resolutions/{res_filename}"

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT status FROM issues WHERE id = ?", (issue_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Issue not found")

        prev_status = row["status"]
        cursor.execute("""
            UPDATE issues
            SET status = 'RESOLVED',
                resolution_notes = ?,
                resolution_image_url = COALESCE(?, resolution_image_url),
                resolved_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (resolution_notes, res_web_url, issue_id))

        cursor.execute("""
            INSERT INTO issue_timeline (id, issue_id, from_status, to_status, action_notes, actor_name)
            VALUES (?, ?, ?, 'RESOLVED', ?, ?)
        """, (
            str(uuid.uuid4()),
            issue_id,
            prev_status,
            f"Issue marked RESOLVED. Remarks: {resolution_notes}",
            admin_user["full_name"]
        ))

    return {
        "success": True,
        "issue_id": issue_id,
        "status": "RESOLVED",
        "resolution_image_url": res_web_url,
        "resolution_notes": resolution_notes
    }

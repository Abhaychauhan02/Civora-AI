"""Authentication endpoints for Citizens and Administrators."""
import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr

from backend.app.database import get_db
from backend.app.auth import hash_password, verify_password, create_access_token, require_auth

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str
    phone: Optional[str] = None
    role: Optional[str] = "CITIZEN"  # 'CITIZEN' or 'ADMIN'


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/register")
def register_user(req: RegisterRequest):
    req_email = req.email.strip().lower()
    if not req_email or not req.password:
        raise HTTPException(status_code=400, detail="Email and password are required")

    role = req.role.upper() if req.role else "CITIZEN"
    if role not in ["CITIZEN", "ADMIN"]:
        role = "CITIZEN"

    user_id = str(uuid.uuid4())
    pwd_hash = hash_password(req.password)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE email = ?", (req_email,))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="An account with this email already exists")

        cursor.execute("""
            INSERT INTO users (id, email, password_hash, full_name, role, phone)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (user_id, req_email, pwd_hash, req.full_name, role, req.phone))

    token = create_access_token({"sub": user_id, "email": req_email, "role": role})
    return {
        "message": "User registered successfully",
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "email": req_email,
            "full_name": req.full_name,
            "role": role,
            "phone": req.phone
        }
    }


@router.post("/login")
def login_user(req: LoginRequest):
    req_email = req.email.strip().lower()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, email, password_hash, full_name, role, phone FROM users WHERE email = ?", (req_email,))
        user = cursor.fetchone()
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token({"sub": user["id"], "email": user["email"], "role": user["role"]})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "email": user["email"],
            "full_name": user["full_name"],
            "role": user["role"],
            "phone": user["phone"]
        }
    }


@router.get("/me")
def get_current_user_profile(user: dict = Depends(require_auth)):
    return {"user": user}

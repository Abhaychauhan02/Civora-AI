"""Authentication endpoints for Citizens and Administrators."""
import uuid
import re
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, EmailStr

from backend.app.database import get_db
from backend.app.auth import hash_password, verify_password, create_access_token, require_auth
from backend.app.security_utils import enforce_rate_limit

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str
    phone: Optional[str] = None
    role: Optional[str] = "CITIZEN"  # Public registration is strictly restricted to CITIZEN


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/register")
def register_user(req: RegisterRequest, request: Request):
    # Enforce rate limiting: 10 registrations per minute per IP
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(f"register:{client_ip}", max_requests=10, window_seconds=60, action_name="registration")

    req_email = req.email.strip().lower()
    if not req_email or not req.password:
        raise HTTPException(status_code=400, detail="Email and password are required")

    if not EMAIL_REGEX.match(req_email):
        raise HTTPException(status_code=400, detail="Invalid email format")

    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters long")

    # SECURITY FIX: Public registration strictly enforces CITIZEN role to prevent privilege escalation.
    # Admin accounts can only be seeded or created by an existing administrator.
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
def login_user(req: LoginRequest, request: Request):
    # Enforce rate limiting: 15 login attempts per minute per IP
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(f"login:{client_ip}", max_requests=15, window_seconds=60, action_name="login")

    req_email = req.email.strip().lower()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, email, password_hash, full_name, role, phone, token_version FROM users WHERE email = ?", (req_email,))
        user = cursor.fetchone()
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid email or password")

    t_ver = user["token_version"] if "token_version" in user.keys() else 1
    token = create_access_token({"sub": user["id"], "email": user["email"], "role": user["role"], "token_version": t_ver})
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

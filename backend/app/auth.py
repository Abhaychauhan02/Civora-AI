"""Authentication and token verification for Civora."""
import hashlib
import hmac
import os
import json
import base64
import time
from typing import Optional, Dict, Any
from fastapi import Header, HTTPException, Depends
from backend.app.config import SECRET_KEY, ACCESS_TOKEN_EXPIRE_MINUTES
from backend.app.database import get_db


def hash_password(password: str) -> str:
    """Hashes a password with a random salt using PBKDF2-HMAC-SHA256."""
    salt = os.urandom(16)
    pwd_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return f"{salt.hex()}${pwd_hash.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verifies a password against the stored salt$hash."""
    try:
        salt_hex, hash_hex = stored_hash.split("$")
        salt = bytes.fromhex(salt_hex)
        expected_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
        return hmac.compare_digest(expected_hash.hex(), hash_hex)
    except Exception:
        return False


def create_access_token(data: Dict[str, Any], expires_delta_minutes: Optional[int] = None) -> str:
    """Generates a cryptographically signed URL-safe JWT-like token."""
    delta = expires_delta_minutes or ACCESS_TOKEN_EXPIRE_MINUTES
    payload = data.copy()
    payload["exp"] = int(time.time()) + (delta * 60)
    payload["iat"] = int(time.time())

    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = base64.urlsafe_b64encode(json.dumps(header).encode()).decode().rstrip("=")
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")

    message = f"{header_b64}.{payload_b64}"
    signature = hmac.new(SECRET_KEY.encode(), message.encode(), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(signature).decode().rstrip("=")

    return f"{header_b64}.{payload_b64}.{sig_b64}"


def decode_token(token: str) -> Dict[str, Any]:
    """Verifies signature and expiration of a signed token."""
    parts = token.strip().split(".")
    if len(parts) != 3:
        raise HTTPException(status_code=401, detail="Invalid token structure")

    header_b64, payload_b64, sig_b64 = parts
    message = f"{header_b64}.{payload_b64}"
    expected_sig = hmac.new(SECRET_KEY.encode(), message.encode(), hashlib.sha256).digest()
    expected_sig_b64 = base64.urlsafe_b64encode(expected_sig).decode().rstrip("=")

    if not hmac.compare_digest(sig_b64, expected_sig_b64):
        raise HTTPException(status_code=401, detail="Token signature verification failed")

    # Pad payload for decoding
    padding = "=" * ((4 - len(payload_b64) % 4) % 4)
    try:
        payload_bytes = base64.urlsafe_b64decode(payload_b64 + padding)
        payload = json.loads(payload_bytes.decode())
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    if payload.get("exp", 0) < time.time():
        raise HTTPException(status_code=401, detail="Token has expired")

    return payload


def get_current_user(authorization: Optional[str] = Header(None)) -> Optional[Dict[str, Any]]:
    """Dependency to extract authenticated user from Authorization Bearer header (optional)."""
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization.split(" ")[1]
    payload = decode_token(token)
    user_id = payload.get("sub")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, email, full_name, role, phone FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="User account not found")
        return dict(row)


def require_auth(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Dependency that strictly requires an authenticated user."""
    user = get_current_user(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication credentials required")
    return user


def require_admin(user: Dict[str, Any] = Depends(require_auth)) -> Dict[str, Any]:
    """Dependency that strictly requires an ADMIN role."""
    if user.get("role") != "ADMIN":
        raise HTTPException(status_code=403, detail="Administrator access required")
    return user

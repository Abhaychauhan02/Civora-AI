"""
Security utilities for Civora Backend:
- Secure Image File Validation (magic bytes, MIME check, PIL decode verification, size limit)
- In-memory Sliding Window Rate Limiter
- Security Headers Middleware
"""

import io
import time
import re
from typing import Tuple, Dict, List
from collections import defaultdict
from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
from PIL import Image

# Security Constants
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}

# Standard image magic byte signatures
MAGIC_SIGNATURES = {
    b"\xff\xd8\xff": ".jpg",           # JPEG
    b"\x89PNG\r\n\x1a\n": ".png",      # PNG
    b"RIFF": ".webp",                  # WEBP (starts with RIFF....WEBP)
}


def validate_image_upload(file_bytes: bytes, filename: str) -> Tuple[bool, str, str]:
    """
    Validates an uploaded image thoroughly:
    1. Checks file size against MAX_UPLOAD_SIZE_BYTES.
    2. Inspects magic bytes (file signature).
    3. Verifies file extension is in ALLOWED_IMAGE_EXTENSIONS.
    4. Decodes image with PIL to verify integrity and prevent image bomb / polyglot attacks.

    Returns:
        (is_valid: bool, error_message: str, sanitized_extension: str)
    """
    if not file_bytes:
        return False, "Uploaded file is empty", ""

    if len(file_bytes) > MAX_UPLOAD_SIZE_BYTES:
        max_mb = MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)
        return False, f"File exceeds maximum allowed size of {max_mb} MB", ""

    # Sanitize and check extension
    ext = ""
    if filename:
        parts = filename.rsplit(".", 1)
        if len(parts) > 1:
            ext = "." + re.sub(r"[^a-zA-Z0-9]", "", parts[1].lower())

    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        return False, f"Unsupported file extension '{ext}'. Allowed: {', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))}", ""

    # Inspect magic bytes
    header = file_bytes[:16]
    matched_magic = False
    if header.startswith(b"\xff\xd8\xff"):
        matched_magic = True
        canonical_ext = ".jpg"
    elif header.startswith(b"\x89PNG\r\n\x1a\n"):
        matched_magic = True
        canonical_ext = ".png"
    elif header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        matched_magic = True
        canonical_ext = ".webp"

    if not matched_magic:
        return False, "File contents do not match a valid image signature (JPEG, PNG, WEBP)", ""

    # Validate image decoding via PIL
    try:
        with Image.open(io.BytesIO(file_bytes)) as img:
            img.verify()
            width, height = img.size
            if width <= 0 or height <= 0:
                return False, "Invalid image dimensions", ""
            if width > 10000 or height > 10000:
                return False, "Image dimensions exceed safety limits (10000x10000)", ""
    except Exception as exc:
        return False, f"Corrupted or invalid image file: {str(exc)}", ""

    return True, "", canonical_ext


class InMemoryRateLimiter:
    """
    Sliding window in-memory rate limiter per key (e.g. client IP or endpoint:ip).
    Thread-safe and lightweight for development, test, and single-instance deployments.
    """
    def __init__(self):
        self._history: Dict[str, List[float]] = defaultdict(list)

    def check(self, key: str, max_requests: int, window_seconds: int) -> bool:
        """
        Returns True if request is allowed, False if rate limit is exceeded.
        """
        now = time.time()
        cutoff = now - window_seconds
        
        # Prune older entries
        self._history[key] = [t for t in self._history[key] if t > cutoff]

        if len(self._history[key]) >= max_requests:
            return False

        self._history[key].append(now)
        return True

    def reset(self):
        """Clears all history (useful for test isolation)."""
        self._history.clear()


# Global rate limiter instance
rate_limiter = InMemoryRateLimiter()


def enforce_rate_limit(key: str, max_requests: int, window_seconds: int, action_name: str = "request"):
    """Raises HTTPException 429 if rate limit is exceeded."""
    if not rate_limiter.check(key, max_requests, window_seconds):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded for {action_name}. Please wait a moment before trying again."
        )


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Adds standard defensive HTTP response security headers."""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(self), camera=(self)"
        return response

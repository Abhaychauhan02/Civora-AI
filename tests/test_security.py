"""
Comprehensive security and reliability tests for Civora Backend:
- Authentication & credential failure handling
- Expired & tampered JWT tokens
- Role-based authorization & privilege escalation prevention
- Image upload security (extensions, magic bytes, corrupt data, size caps)
- Coordinate and payload validation
- Rate limiting enforcement
- HTTP defensive security headers
- IDOR / ownership data sanitization
"""

import io
import time
import unittest
from starlette.testclient import TestClient
from PIL import Image

from backend.main import app
from backend.app.database import init_db
from backend.app.auth import create_access_token
from backend.app.security_utils import rate_limiter, MAX_UPLOAD_SIZE_BYTES


class TestCivoraSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)

        # Login admin
        admin_resp = cls.client.post("/api/auth/login", json={"email": "admin@civora.org", "password": "admin123"})
        cls.admin_token = admin_resp.json().get("access_token")

        # Login citizen
        cit_resp = cls.client.post("/api/auth/login", json={"email": "citizen@civora.org", "password": "citizen123"})
        cls.citizen_token = cit_resp.json().get("access_token")

    def setUp(self):
        # Reset rate limiter before each test to ensure test isolation
        rate_limiter.reset()

    def test_invalid_login_credentials(self):
        """Verifies that incorrect credentials return HTTP 401."""
        resp = self.client.post("/api/auth/login", json={"email": "admin@civora.org", "password": "wrong_password_999"})
        self.assertEqual(resp.status_code, 401)
        self.assertIn("Invalid email or password", resp.json()["detail"])

    def test_missing_authentication_on_protected_endpoint(self):
        """Verifies accessing protected endpoint without token returns HTTP 401."""
        resp = self.client.get("/api/auth/me")
        self.assertEqual(resp.status_code, 401)

    def test_expired_token(self):
        """Verifies that expired access tokens are rejected with HTTP 401."""
        expired_token = create_access_token({"sub": "usr_citizen_01", "email": "citizen@civora.org", "role": "CITIZEN"}, expires_delta_minutes=-10)
        resp = self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired_token}"})
        self.assertEqual(resp.status_code, 401)
        self.assertIn("expired", resp.json()["detail"].lower())

    def test_tampered_token_signature(self):
        """Verifies that modified tokens are rejected immediately with HTTP 401."""
        tampered_token = self.citizen_token[:-4] + "AAAA"
        resp = self.client.get("/api/auth/me", headers={"Authorization": f"Bearer {tampered_token}"})
        self.assertEqual(resp.status_code, 401)

    def test_unauthorized_admin_access_by_citizen(self):
        """Verifies that citizens cannot perform administrative actions (HTTP 403)."""
        # Citizen tries to update issue status
        headers = {"Authorization": f"Bearer {self.citizen_token}"}
        resp = self.client.patch("/api/issues/iss_test123/status", json={"status": "RESOLVED"}, headers=headers)
        self.assertEqual(resp.status_code, 403)
        self.assertIn("Administrator access required", resp.json()["detail"])

    def test_citizen_cannot_self_register_as_admin(self):
        """Verifies privilege escalation is blocked: public registration role is strictly CITIZEN."""
        unique_email = f"attacker_{int(time.time()*1000)}@civora.org"
        resp = self.client.post("/api/auth/register", json={
            "email": unique_email,
            "password": "password123",
            "full_name": "Privilege Escalator",
            "role": "ADMIN"  # Attempt to escalate!
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["user"]["role"], "CITIZEN")

    def test_invalid_upload_extension_rejected(self):
        """Verifies non-image file extensions (.sh, .exe) are rejected with HTTP 400."""
        files = {"image": ("malicious_script.sh", b"echo 'hack'", "text/plain")}
        data = {"latitude": "37.7749", "longitude": "-122.4194"}
        resp = self.client.post("/api/reports/submit", files=files, data=data)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Unsupported file extension", resp.json()["detail"])

    def test_spoofed_mime_type_with_invalid_bytes_rejected(self):
        """Verifies that a script with a .jpg filename fails magic byte and PIL decode checks."""
        files = {"image": ("fake_photo.jpg", b"<?php echo 'malicious'; ?>", "image/jpeg")}
        data = {"latitude": "37.7749", "longitude": "-122.4194"}
        resp = self.client.post("/api/reports/submit", files=files, data=data)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("validation failed", resp.json()["detail"].lower())

    def test_corrupt_image_upload_rejected(self):
        """Verifies corrupted image bytes are rejected with HTTP 400."""
        # JPEG header with corrupted garbage payload
        corrupt_bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 20
        files = {"image": ("broken.jpg", corrupt_bytes, "image/jpeg")}
        data = {"latitude": "37.7749", "longitude": "-122.4194"}
        resp = self.client.post("/api/reports/submit", files=files, data=data)
        self.assertEqual(resp.status_code, 400)

    def test_oversized_file_rejected(self):
        """Verifies files exceeding MAX_UPLOAD_SIZE_BYTES are rejected with HTTP 400."""
        oversized_bytes = b"0" * (MAX_UPLOAD_SIZE_BYTES + 1024)
        files = {"image": ("huge.jpg", oversized_bytes, "image/jpeg")}
        data = {"latitude": "37.7749", "longitude": "-122.4194"}
        resp = self.client.post("/api/reports/submit", files=files, data=data)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("maximum allowed size", resp.json()["detail"].lower())

    def test_invalid_coordinates_boundary(self):
        """Verifies latitude and longitude boundaries are validated (HTTP 400)."""
        # Create a small valid JPEG
        img_buf = io.BytesIO()
        Image.new("RGB", (64, 64), color="blue").save(img_buf, format="JPEG")
        img_bytes = img_buf.getvalue()

        # Out-of-bounds latitude
        files = {"image": ("valid.jpg", img_bytes, "image/jpeg")}
        data = {"latitude": "195.0", "longitude": "-122.4194"}
        resp = self.client.post("/api/reports/submit", files=files, data=data)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Latitude must be between", resp.json()["detail"])

    def test_rate_limiting_enforcement(self):
        """Verifies that exceeding the configured rate limit triggers HTTP 429."""
        # Rapidly call login 16 times (limit is 15/min)
        triggered_429 = False
        for i in range(18):
            resp = self.client.post("/api/auth/login", json={"email": "citizen@civora.org", "password": "citizen123"})
            if resp.status_code == 429:
                triggered_429 = True
                self.assertIn("Rate limit exceeded", resp.json()["detail"])
                break
        self.assertTrue(triggered_429, "Rate limiter failed to trigger HTTP 429")

    def test_security_headers_present(self):
        """Verifies defensive HTTP security headers are attached to responses."""
        resp = self.client.get("/api/health")
        self.assertEqual(resp.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(resp.headers.get("X-Frame-Options"), "DENY")
        self.assertEqual(resp.headers.get("X-XSS-Protection"), "1; mode=block")
        self.assertEqual(resp.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin")

    def test_idor_report_sanitization(self):
        """Verifies that querying a report by a non-owner non-admin sanitizes the user_id."""
        # Submit a report as citizen
        img_buf = io.BytesIO()
        Image.new("RGB", (64, 64), color="green").save(img_buf, format="JPEG")
        files = {"image": ("green.jpg", img_buf.getvalue(), "image/jpeg")}
        data = {"latitude": "12.9716", "longitude": "77.5946"}
        headers = {"Authorization": f"Bearer {self.citizen_token}"}
        submit_resp = self.client.post("/api/reports/submit", files=files, data=data, headers=headers)
        self.assertEqual(submit_resp.status_code, 200)
        report_id = submit_resp.json()["report_id"]

        # Fetch without auth -> user_id should be sanitized to None
        anon_resp = self.client.get(f"/api/reports/{report_id}")
        self.assertEqual(anon_resp.status_code, 200)
        self.assertIsNone(anon_resp.json()["report"]["user_id"])

        # Fetch with owner auth -> user_id is present
        owner_resp = self.client.get(f"/api/reports/{report_id}", headers=headers)
        self.assertEqual(owner_resp.status_code, 200)
        self.assertIsNotNone(owner_resp.json()["report"]["user_id"])


if __name__ == "__main__":
    unittest.main()

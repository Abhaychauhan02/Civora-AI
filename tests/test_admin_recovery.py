"""
Unit & Integration Tests for Admin Recovery CLI and Role Permissions.
"""
import unittest
import sqlite3
import uuid
from backend.app.database import get_db, init_db
from backend.app.auth import hash_password, verify_password, create_access_token, decode_token
from backend.scripts.admin_recovery import list_admins, reset_admin_password, bootstrap_admin


class TestAdminRecovery(unittest.TestCase):
    def setUp(self):
        init_db()
        self.test_email = f"test_admin_{uuid.uuid4().hex[:8]}@civora.org"
        self.test_password = "initialAdminPassword123"
        self.test_full_name = "Test Admin Recovery Officer"

        # Bootstrap test admin
        bootstrap_admin(
            email=self.test_email,
            full_name=self.test_full_name,
            password=self.test_password
        )

    def tearDown(self):
        # Clean up test admin
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM users WHERE email = ?", (self.test_email,))

    def test_list_admins_identifies_account(self):
        admins = list_admins()
        emails = [a["email"] for a in admins]
        self.assertIn(self.test_email, emails)

    def test_reset_password_updates_hash_and_invalidates_tokens(self):
        # Verify initial password
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT password_hash, token_version FROM users WHERE email = ?", (self.test_email,))
            row = cursor.fetchone()
            self.assertTrue(verify_password(self.test_password, row["password_hash"]))
            v1 = row["token_version"]

        # Generate token with initial token_version
        old_token = create_access_token({"sub": "usr_test", "email": self.test_email, "token_version": v1})
        decoded_old = decode_token(old_token)
        self.assertEqual(decoded_old["token_version"], v1)

        # Reset password
        new_password = "NewlyUpdatedSecurePassword2026!"
        res = reset_admin_password(target_email=self.test_email, new_password=new_password)
        self.assertTrue(res)

        # Check DB updated
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT password_hash, token_version FROM users WHERE email = ?", (self.test_email,))
            row2 = cursor.fetchone()
            # Old password must fail
            self.assertFalse(verify_password(self.test_password, row2["password_hash"]))
            # New password must succeed
            self.assertTrue(verify_password(new_password, row2["password_hash"]))
            # token_version must be incremented
            self.assertGreater(row2["token_version"], v1)

    def test_bootstrap_prevent_duplicate_admin(self):
        # Trying to bootstrap an existing admin should safely decline
        res = bootstrap_admin(
            email=self.test_email,
            full_name="Duplicate Attempt",
            password="AnotherPassword123"
        )
        self.assertFalse(res)


if __name__ == "__main__":
    unittest.main()

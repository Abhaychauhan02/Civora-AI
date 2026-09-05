"""Unit tests for hashing and token management."""
import unittest
from backend.app.auth import hash_password, verify_password, create_access_token, decode_token


class TestAuth(unittest.TestCase):

    def test_password_hashing_and_verification(self):
        pwd = "Secr3tPassword!2026"
        hashed = hash_password(pwd)
        self.assertNotEqual(pwd, hashed)
        self.assertTrue(verify_password(pwd, hashed))
        self.assertFalse(verify_password("WrongPassword", hashed))

    def test_token_creation_and_decoding(self):
        payload = {"sub": "usr_test_123", "role": "CITIZEN"}
        token = create_access_token(payload, expires_delta_minutes=60)
        self.assertIsInstance(token, str)

        decoded = decode_token(token)
        self.assertEqual(decoded["sub"], "usr_test_123")
        self.assertEqual(decoded["role"], "CITIZEN")
        self.assertIn("exp", decoded)


if __name__ == "__main__":
    unittest.main()

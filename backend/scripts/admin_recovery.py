"""
Administrative Account Recovery & Credential Management CLI for Civora.

Security Guidelines:
- Direct, authorized host/server execution only.
- Passwords entered via non-echoing secure interactive prompt (getpass).
- Never prints password hashes, JWT secrets, or sensitive tokens.
- Does not expose passwords in process args or shell history.
- Invalidates active sessions/tokens by incrementing token_version.
- Preserves existing accounts and database records.
"""
import sys
import os
import argparse
import getpass
import re
from pathlib import Path

# Ensure backend and project root are in Python path
ROOT_DIR = Path(__file__).resolve().parent.parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.app.database import get_db, init_db
from backend.app.auth import hash_password

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def list_admins():
    """Lists non-sensitive metadata for all registered administrators."""
    init_db()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, email, full_name, role, phone, created_at, token_version
            FROM users
            WHERE role = 'ADMIN'
            ORDER BY created_at ASC
        """)
        admins = cursor.fetchall()

    if not admins:
        print("[!] No administrator accounts found in the database.")
        print("    Run with --bootstrap-admin to create the initial administrator account.")
        return []

    print("\n" + "=" * 70)
    print(" CIVORA — REGISTERED ADMINISTRATOR ACCOUNTS")
    print("=" * 70)
    for idx, a in enumerate(admins, 1):
        print(f" [{idx}] User ID     : {a['id']}")
        print(f"     Full Name   : {a['full_name']}")
        print(f"     Email       : {a['email']}")
        print(f"     Role        : {a['role']}")
        print(f"     Registered  : {a['created_at']}")
        token_ver = a["token_version"] if "token_version" in a.keys() else 1
        print(f"     Session Ver : {token_ver}")
        print("-" * 70)
    print()
    return admins


def reset_admin_password(target_email: str = None, new_password: str = None):
    """
    Resets the password for an administrator account securely.
    If target_email or new_password is not provided, prompts interactively.
    """
    init_db()
    with get_db() as conn:
        cursor = conn.cursor()

        if not target_email:
            cursor.execute("SELECT email, full_name FROM users WHERE role = 'ADMIN'")
            admins = cursor.fetchall()
            if not admins:
                print("[!] No administrator account found. Use --bootstrap-admin to create one.")
                return False

            if len(admins) == 1:
                target_email = admins[0]["email"]
                print(f"[*] Identified administrator account: {admins[0]['full_name']} ({target_email})")
            else:
                print("\nMultiple administrator accounts detected:")
                for i, a in enumerate(admins, 1):
                    print(f"  {i}. {a['full_name']} ({a['email']})")
                choice = input("\nEnter administrator email to reset: ").strip().lower()
                target_email = choice

        target_email = target_email.strip().lower()

        cursor.execute("SELECT id, email, full_name, role, token_version FROM users WHERE email = ? AND role = 'ADMIN'", (target_email,))
        user = cursor.fetchone()
        if not user:
            print(f"[!] Error: No administrator account with email '{target_email}' found.")
            return False

        # Prompt for password non-echoing if not provided programmatically
        if not new_password:
            print(f"\nResetting password for Administrator: {user['full_name']} <{user['email']}>")
            while True:
                p1 = getpass.getpass("Enter new administrator password (min 8 chars): ")
                if len(p1) < 8:
                    print("[!] Password must be at least 8 characters long. Please try again.\n")
                    continue
                p2 = getpass.getpass("Confirm new administrator password: ")
                if p1 != p2:
                    print("[!] Passwords do not match. Please try again.\n")
                    continue
                new_password = p1
                break

        # Compute secure PBKDF2 hash using existing backend auth engine
        new_hash = hash_password(new_password)
        current_version = user["token_version"] if "token_version" in user.keys() else 1
        new_version = current_version + 1

        cursor.execute("""
            UPDATE users
            SET password_hash = ?,
                token_version = ?
            WHERE id = ?
        """, (new_hash, new_version, user["id"]))

    print(f"\n[✓] SUCCESS: Password for administrator '{target_email}' updated securely.")
    print(f"[✓] Active sessions and JWT tokens have been invalidated (token_version -> {new_version}).")
    print(f"[✓] You can now sign in at the Civora web console using '{target_email}'.\n")
    return True


def bootstrap_admin(email: str = None, full_name: str = None, password: str = None, phone: str = None):
    """
    Creates an initial administrator account if needed.
    Prompts interactively using secure non-echoing password input.
    """
    init_db()
    with get_db() as conn:
        cursor = conn.cursor()

        if not email:
            while True:
                em = input("Enter administrator email address: ").strip().lower()
                if not EMAIL_REGEX.match(em):
                    print("[!] Invalid email format. Please try again.")
                    continue
                email = em
                break

        cursor.execute("SELECT id, role FROM users WHERE email = ?", (email,))
        existing = cursor.fetchone()
        if existing:
            if existing["role"] == "ADMIN":
                print(f"[!] Account '{email}' is already an administrator. Use --reset-password to change password.")
                return False
            else:
                promote = input(f"[?] User '{email}' exists as CITIZEN. Promote to ADMIN? (y/n): ").strip().lower()
                if promote == "y":
                    cursor.execute("UPDATE users SET role = 'ADMIN' WHERE id = ?", (existing["id"],))
                    print(f"[✓] User '{email}' promoted to ADMIN.")
                    return True
                return False

        if not full_name:
            full_name = input("Enter administrator full name: ").strip() or "System Administrator"

        if not password:
            while True:
                p1 = getpass.getpass("Enter password for new administrator (min 8 chars): ")
                if len(p1) < 8:
                    print("[!] Password must be at least 8 characters long.")
                    continue
                p2 = getpass.getpass("Confirm password: ")
                if p1 != p2:
                    print("[!] Passwords do not match. Please try again.")
                    continue
                password = p1
                break

        import uuid
        user_id = f"usr_admin_{uuid.uuid4().hex[:8]}"
        pwd_hash = hash_password(password)

        cursor.execute("""
            INSERT INTO users (id, email, password_hash, full_name, role, phone, token_version)
            VALUES (?, ?, ?, ?, 'ADMIN', ?, 1)
        """, (user_id, email, pwd_hash, full_name, phone))

    print(f"\n[✓] SUCCESS: Administrator account '{email}' created successfully.")
    print(f"[✓] User ID: {user_id} | Role: ADMIN\n")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Civora Administrator Account Recovery & Management CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m backend.scripts.admin_recovery --list
  python -m backend.scripts.admin_recovery --reset-password
  python -m backend.scripts.admin_recovery --reset-password admin@civora.org
  python -m backend.scripts.admin_recovery --bootstrap-admin
        """
    )
    parser.add_argument("--list", action="store_true", help="List non-sensitive details of administrator accounts")
    parser.add_argument("--reset-password", nargs="?", const="interactive", default=None, help="Reset administrator password interactively")
    parser.add_argument("--bootstrap-admin", action="store_true", help="Create a new administrator account interactively")

    args = parser.parse_args()

    if args.list:
        list_admins()
    elif args.reset_password:
        target_email = None if args.reset_password == "interactive" else args.reset_password
        reset_admin_password(target_email)
    elif args.bootstrap_admin:
        bootstrap_admin()
    else:
        # Default behavior with no flags: show list and prompt
        admins = list_admins()
        if admins:
            ans = input("Would you like to reset an administrator password now? (y/n): ").strip().lower()
            if ans == "y":
                reset_admin_password()
        else:
            ans = input("Would you like to create an administrator account now? (y/n): ").strip().lower()
            if ans == "y":
                bootstrap_admin()


if __name__ == "__main__":
    main()

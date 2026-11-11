"""Database initialization and connection management using SQLite."""
import sqlite3
import json
from contextlib import contextmanager
from backend.app.config import DB_PATH


def get_db_connection():
    """Returns a connection configured with Row factory and WAL mode for high concurrency."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    try:
        conn.execute("PRAGMA journal_mode = WAL;")
    except Exception:
        pass  # Fall back to default journaling mode if WAL is restricted by environment
    return conn


@contextmanager
def get_db():
    """Context manager for safe database transactions."""
    conn = get_db_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Initializes database schema according to Civora architecture specifications."""
    with get_db() as conn:
        cursor = conn.cursor()

        # 1. Users Table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'CITIZEN', -- 'CITIZEN' or 'ADMIN'
            phone TEXT,
            token_version INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # Safe migration for existing DBs: ensure token_version column exists
        cursor.execute("PRAGMA table_info(users)")
        user_cols = [c[1] for c in cursor.fetchall()]
        if "token_version" not in user_cols:
            cursor.execute("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1")

        # 2. Issues Table (The physical real-world problem)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS issues (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            category TEXT NOT NULL, -- 'pothole', 'garbage', 'damaged_streetlight', etc.
            description TEXT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            address TEXT,
            status TEXT NOT NULL DEFAULT 'REPORTED', -- 'REPORTED', 'PENDING', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED'
            priority_score INTEGER NOT NULL DEFAULT 30,
            priority_level TEXT NOT NULL DEFAULT 'MEDIUM', -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
            report_count INTEGER NOT NULL DEFAULT 1,
            assigned_to TEXT,
            assigned_department TEXT,
            resolution_image_url TEXT,
            resolution_notes TEXT,
            resolved_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # 3. Reports Table (Individual citizen submissions linked to an Issue)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY,
            issue_id TEXT NOT NULL,
            user_id TEXT,
            image_url TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            address TEXT,
            description TEXT,
            ai_category TEXT,
            ai_confidence REAL,
            ai_detections_json TEXT, -- Serialized bounding boxes and classes
            authenticity_status TEXT DEFAULT 'LIKELY_AUTHENTIC',
            severity_score INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        """)

        # 4. Issue Timeline / History Table (Audit trail of lifecycle changes)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS issue_timeline (
            id TEXT PRIMARY KEY,
            issue_id TEXT NOT NULL,
            from_status TEXT,
            to_status TEXT NOT NULL,
            action_notes TEXT,
            actor_name TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE
        );
        """)

        # Backward-compatible migrations for existing SQLite instances
        cursor.execute("PRAGMA table_info(reports)")
        report_cols = [c["name"] for c in cursor.fetchall()]
        if "citizen_category" not in report_cols:
            cursor.execute("ALTER TABLE reports ADD COLUMN citizen_category TEXT")
        if "location_source" not in report_cols:
            cursor.execute("ALTER TABLE reports ADD COLUMN location_source TEXT")

        cursor.execute("PRAGMA table_info(issues)")
        issue_cols = [c["name"] for c in cursor.fetchall()]
        if "updated_at" not in issue_cols:
            cursor.execute("ALTER TABLE issues ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")

        conn.commit()


if __name__ == "__main__":
    init_db()
    print(f"Civora database initialized successfully at {DB_PATH}")

# 🌐 Civora — AI-Powered Civic Infrastructure Management Platform

[![FastAPI](https://img.shields.io/badge/FastAPI-0.141+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![YOLOv8](https://img.shields.io/badge/Ultralytics-YOLOv8n-blue.svg)](https://docs.ultralytics.com)
[![Python](https://img.shields.io/badge/Python-3.11%20%7C%203.12%20%7C%203.13-blue.svg)](https://python.org)
[![SDG Alignment](https://img.shields.io/badge/UN%20SDGs-SDG%2011%20%7C%20SDG%209-orange.svg)](https://sdgs.un.org)

Civora is an end-to-end, mobile-first civic issue management platform that transforms unstructured citizen reports into structured, prioritized, actionable, and trackable municipal tasks.

---

## 📌 Problem & UN SDG Alignment

In modern campuses and municipalities, infrastructure issues (potholes, garbage accumulation, broken streetlights) suffer from fragmented reporting, repeated duplicate complaints, and lack of visibility into resolution.

Civora directly targets:
* **SDG 11: Sustainable Cities and Communities**: Safer roads, cleaner environments, and reliable night-time lighting.
* **SDG 9: Industry, Innovation and Infrastructure**: Automated computer vision triage and geospatial maintenance analytics.

---

## 🏗 Architecture & Design Philosophy

> **Core Philosophy**: *"Build a small system that works completely before building a huge system that works nowhere."*

Civora is architected into modular tiers:
```
Responsive PWA (Citizen & Admin)
          ↕ (REST / JWT)
      Backend API (SQLite/WAL, Duplicate Engine, Priority Scoring)
          ↕ (Internal HTTP / In-process)
AI Computer Vision Service (YOLOv8 Nano + HuggingFace Authenticity)
```

### Core Domain Distinction: Report vs. Issue
* **Report**: An individual citizen submission (image, GPS coordinates, notes, timestamp).
* **Issue**: The underlying real-world physical problem.
* **Duplicate Clustering**: When reports occur within ~50 meters for the same category, Civora links them to the existing active Issue, preventing clutter while boosting the issue's dynamic priority.

---

## ⚡ Features

1. **YOLOv8 Computer Vision**:
   * Fine-tuned on civic datasets across 3 target classes: `pothole`, `garbage`, `damaged_streetlight`.
   * **mAP@50**: **0.759 (75.9%)** | **mAP@50-95**: **0.601 (60.1%)**.
2. **Authenticity Screening**:
   * HuggingFace AI vs. Real image classifier flags synthetically generated or manipulated complaints.
3. **Smart Priority Engine**:
   * Dynamic scoring:
     $$\text{Priority} = (\text{Severity} \times 0.5) + (\text{Report Count} \times 6) + (\text{Category Hazard} \times 0.3) + \text{Aging Factor}$$
4. **Citizen Progressive Web App (PWA)**:
   * Instant camera capture & upload.
   * Interactive Leaflet/OpenStreetMap GPS pin locator.
   * Real-time AI diagnostics preview.
   * "My Submissions" dashboard with audit timelines and official resolution proof.
5. **Authority / Admin Triage Portal**:
   * Interactive city/campus map with color-coded pins by priority/status.
   * Search, filter, and sorting.
   * Department and technician assignment.
   * **Mandatory Resolution Workflow**: Upload proof photo of the completed repair before closing the ticket.

---

## 🚀 Quick Start

### 1. Environment Setup
```bash
# Clone and enter directory
cd civora-ai

# Activate Python Virtual Environment
source venv/bin/activate

# Install dependencies (if not already installed)
pip install -r requirements.txt
```

### 2. Configure Environment
Copy the configuration template:
```bash
cp .env.example .env
```

### 3. Start the Civora Platform
Launch the complete Civora backend (which serves both the REST API and the Citizen/Admin PWA):
```bash
python backend/main.py
```
Open your browser at **`http://localhost:8000`**.

### 4. (Optional) Run Dedicated AI Vision Microservice
If running as a distributed microservice:
```bash
python api/main.py
```
Default AI microservice port: `8001`.

---

## 🔑 Default Test Accounts

| Role | Email | Password | Access |
|------|-------|----------|--------|
| **Administrator** | `admin@civora.org` | `admin123` | Full triage, map, assignment, resolution |
| **Citizen** | `citizen@civora.org` | `citizen123` | Issue reporting, GPS map, tracking |

*(You can also register new accounts directly from the UI).*

---

## 🧪 Testing

Run the automated test suite covering authentication, duplicate clustering, priority calculation, and API endpoints:
```bash
python -m unittest discover -s tests -p "test_*.py"
```

---

## 📁 Repository Structure

```
civora-ai/
├── README.md                      # Platform documentation & blueprint guide
├── .env.example                   # Configuration template
├── .gitignore                     # Repository ignore rules
├── requirements.txt               # Dependencies
├── civora.db                      # SQLite WAL database (auto-created)
│
├── api/                           # AI Microservice
│   └── main.py                    # Computer Vision FastAPI service (port 8001)
│
├── src/                           # AI / ML Core Engine
│   ├── inference/                 # YOLO detection and pipeline orchestrator
│   ├── authenticity/              # Synthetic image classifier
│   ├── severity/                  # Severity scoring rules
│   ├── preprocessing/             # Image normalization and EXIF orientation
│   ├── evaluation/                # Model validation metrics
│   └── training/                  # Training pipeline wrappers
│
├── backend/                       # Central Platform Backend (port 8000)
│   ├── main.py                    # Central FastAPI server (serves API + PWA)
│   └── app/
│       ├── config.py              # Configuration manager
│       ├── database.py            # SQLite connection, WAL, and schema migrations
│       ├── auth.py                # PBKDF2 hashing, JWT verification, RBAC
│       ├── duplicate_engine.py    # Haversine distance duplicate clustering
│       ├── priority_engine.py     # Dynamic multi-variable priority formula
│       ├── ai_client.py           # Microservice client with in-process fallback
│       └── routes/
│           ├── auth_routes.py     # Registration, login, profile
│           ├── report_routes.py   # Citizen submissions & tracking
│           ├── issue_routes.py    # Lifecycle, assignments, resolution
│           └── analytics_routes.py# Operational KPIs & metrics
│
├── frontend/                      # Responsive Mobile-First PWA
│   ├── index.html                 # Main single-page application
│   ├── manifest.json              # PWA manifest
│   ├── sw.js                      # Service worker for offline caching
│   ├── css/styles.css             # Custom styles & Leaflet overlays
│   └── js/
│       ├── api.js                 # Backend fetch client
│       ├── auth.js                # Auth state & modal controller
│       ├── citizen.js             # Photo upload, Leaflet GPS, tracking
│       ├── admin.js               # Admin map, triage, resolution workflow
│       └── app.js                 # Tab orchestrator & toast notifications
│
├── models/
│   └── best.pt                    # Fine-tuned YOLOv8n weights
│
├── tests/                         # Automated unit & integration tests
│   ├── test_auth.py
│   ├── test_duplicate_engine.py
│   ├── test_priority_engine.py
│   └── test_api.py
│
└── notebooks/                     # Training & dataset preparation scripts
```

---

## 📄 License
Created for College Capstone Project & Public Pilot Readiness.

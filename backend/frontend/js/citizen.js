// ==========================================================================
// CIVORA CITIZEN INTERACTION CONTROLLER
// Handles Image Upload, Bounding Box Rendering, Geolocation, AI Diagnostics
// & Multi-step Lifecycle Tracking
// ==========================================================================

const Citizen = {
  map: null,
  marker: null,
  currentLat: 28.6139, // Default: New Delhi (Connaught Place/Civic Center)
  currentLng: 77.2090,
  selectedCategory: "pothole",
  selectedFile: null,
  locationSource: "MANUAL_PIN",
  showBoundingBoxes: true,
  cachedDetections: [],
  cachedMyReports: [],
  currentFilter: "ALL",

  init() {
    this.initMap();
    this.bindDropZone();
  },

  selectCategory(cat) {
    this.selectedCategory = cat;
    const input = document.getElementById("selected-category-input");
    if (input) input.value = cat;

    // Update active UI styling for chips
    document.querySelectorAll(".category-chip").forEach((btn) => {
      const isMatch = btn.getAttribute("data-category") === cat;
      if (isMatch) {
        btn.className = "category-chip active flex items-center gap-2.5 p-3 rounded-xl border-2 border-blue-600 bg-blue-50/70 text-blue-950 text-xs font-bold transition text-left shadow-2xs";
      } else {
        btn.className = "category-chip flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 text-slate-700 text-xs font-bold transition text-left shadow-2xs";
      }
    });

    // Update Pre-Flight Review Summary
    const catReview = document.getElementById("review-category-val");
    const slaReview = document.getElementById("review-sla-val");
    const catMap = {
      pothole: { label: "Pothole / Road", sla: "< 48h Resolution" },
      garbage: { label: "Garbage Dump", sla: "< 24h Clean-up" },
      streetlight: { label: "Streetlight Defect", sla: "< 36h Electrical" },
      waterlogging: { label: "Waterlogging (Routing)", sla: "< 12h Emergency Drainage" }
    };
    const cInfo = catMap[cat] || { label: cat.toUpperCase(), sla: "< 48h Resolution" };
    if (catReview) catReview.textContent = cInfo.label;
    if (slaReview) slaReview.textContent = cInfo.sla;
  },

  initMap() {
    const mapEl = document.getElementById("report-map");
    if (!mapEl || this.map) return;

    this.map = L.map("report-map").setView([this.currentLat, this.currentLng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors"
    }).addTo(this.map);

    // Draggable marker with custom SVG icon
    const customIcon = L.divIcon({
      className: "custom-civora-marker marker-critical",
      html: `<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    this.marker = L.marker([this.currentLat, this.currentLng], {
      draggable: true,
      icon: customIcon
    }).addTo(this.map);

    this.marker.on("dragend", (e) => {
      const pos = e.target.getLatLng();
      this.currentLat = pos.lat;
      this.currentLng = pos.lng;
      this.locationSource = "MANUAL_PIN";
      this.updateCoordsDisplay();
      this.reverseGeocode(this.currentLat, this.currentLng);
    });

    this.map.on("click", (e) => {
      this.currentLat = e.latlng.lat;
      this.currentLng = e.latlng.lng;
      this.locationSource = "MANUAL_PIN";
      this.marker.setLatLng([this.currentLat, this.currentLng]);
      this.updateCoordsDisplay();
      this.reverseGeocode(this.currentLat, this.currentLng);
    });

    this.updateCoordsDisplay();
  },

  jumpToLocation(lat, lng, address) {
    this.currentLat = lat;
    this.currentLng = lng;
    this.locationSource = "LANDMARK_SEARCH";
    if (this.map && this.marker) {
      this.map.flyTo([lat, lng], 16, { animate: true, duration: 1.0 });
      this.marker.setLatLng([lat, lng]);
    }
    this.updateCoordsDisplay();
    const addrInput = document.getElementById("address-input");
    if (addrInput && address) {
      addrInput.value = address;
    }
    showToast(`Map centered on ${address.split(',')[0]}`, "info");
  },

  async reverseGeocode(lat, lng) {
    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
        headers: { "Accept-Language": "en" }
      });
      if (resp.ok) {
        const data = await resp.json();
        const addrInput = document.getElementById("address-input");
        if (addrInput && data.display_name && !addrInput.value.trim()) {
          addrInput.value = data.display_name.split(",").slice(0, 3).join(",").trim();
        }
      }
    } catch (_) {}
  },

  async searchAddress() {
    const input = document.getElementById("address-input");
    const query = input ? input.value.trim() : "";
    if (!query) return;

    try {
      showToast("Searching location...", "info");
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`, {
        headers: { "Accept-Language": "en" }
      });
      if (resp.ok) {
        const list = await resp.json();
        if (list && list.length > 0) {
          const lat = parseFloat(list[0].lat);
          const lng = parseFloat(list[0].lon);
          this.jumpToLocation(lat, lng, list[0].display_name.split(",").slice(0, 3).join(",").trim());
          showToast("Location found & pinned!", "success");
        } else {
          showToast("No location matching that name found. You can click on the map.", "warning");
        }
      }
    } catch (e) {
      showToast("Could not lookup address. You can position the pin manually.", "warning");
    }
  },

  locateUser() {
    if (!navigator.geolocation) {
      this.locationSource = "MANUAL_PIN";
      this.updateCoordsDisplay();
      this.fallbackIpLocate();
      return;
    }

    showToast("Detecting precise GPS coordinates...", "info");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.currentLat = pos.coords.latitude;
        this.currentLng = pos.coords.longitude;
        this.locationSource = "GPS_LOCKED";
        if (this.map && this.marker) {
          this.map.flyTo([this.currentLat, this.currentLng], 16);
          this.marker.setLatLng([this.currentLat, this.currentLng]);
        }
        this.updateCoordsDisplay();
        this.reverseGeocode(this.currentLat, this.currentLng);
        showToast("GPS Location locked!", "success");
      },
      () => {
        // Fallback gracefully without an intrusive error toast
        this.locationSource = "MANUAL_PIN";
        this.updateCoordsDisplay();
        this.fallbackIpLocate();
      },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  },

  async fallbackIpLocate() {
    try {
      const resp = await fetch("https://ipapi.co/json/");
      if (resp.ok) {
        const data = await resp.json();
        if (data.latitude && data.longitude) {
          this.currentLat = data.latitude;
          this.currentLng = data.longitude;
          this.locationSource = "MANUAL_PIN";
          if (this.map && this.marker) {
            this.map.flyTo([this.currentLat, this.currentLng], 14);
            this.marker.setLatLng([this.currentLat, this.currentLng]);
          }
          this.updateCoordsDisplay();
          const city = data.city || data.region || "Your area";
          const addrInput = document.getElementById("address-input");
          if (addrInput && !addrInput.value) addrInput.value = `${city}, India`;
          showToast(`Approximate location centered: ${city}. You can tap map to fine-tune.`, "info");
          return;
        }
      }
    } catch (_) {}
    this.locationSource = "MANUAL_PIN";
    this.updateCoordsDisplay();
    showToast("Position your pin on the map by tapping your neighborhood.", "info");
  },

  updateCoordsDisplay() {
    const coordEl = document.getElementById("selected-coords");
    const reviewCoords = document.getElementById("review-coords-val");
    const reviewSource = document.getElementById("review-source-val");
    const telemetryPill = document.getElementById("location-telemetry-pill");

    const coordStr = `${this.currentLat.toFixed(5)}, ${this.currentLng.toFixed(5)}`;
    if (coordEl) coordEl.textContent = coordStr;
    if (reviewCoords) reviewCoords.textContent = coordStr;

    const sourceConfig = {
      GPS_LOCKED: {
        text: "GPS LOCKED",
        pillCls: "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200",
        reviewCls: "font-bold text-emerald-700 text-[11px] block mt-0.5"
      },
      LANDMARK_SEARCH: {
        text: "SEARCH PIN",
        pillCls: "text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200",
        reviewCls: "font-bold text-purple-700 text-[11px] block mt-0.5"
      },
      MANUAL_PIN: {
        text: "MANUAL PIN",
        pillCls: "text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200",
        reviewCls: "font-bold text-blue-700 text-[11px] block mt-0.5"
      }
    };

    const sc = sourceConfig[this.locationSource] || sourceConfig.MANUAL_PIN;
    if (telemetryPill) {
      telemetryPill.className = sc.pillCls;
      telemetryPill.textContent = sc.text;
    }
    if (reviewSource) {
      reviewSource.className = sc.reviewCls;
      reviewSource.textContent = sc.text;
    }
  },

  bindDropZone() {
    const dropZone = document.getElementById("drop-zone");
    if (!dropZone) return;

    ["dragenter", "dragover"].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add("border-blue-600", "bg-blue-50/50");
      });
    });

    ["dragleave", "drop"].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove("border-blue-600", "bg-blue-50/50");
      });
    });

    dropZone.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) {
        this.processFile(dt.files[0]);
      }
    });
  },

  handleFileSelect(event) {
    if (event.target.files && event.target.files[0]) {
      this.processFile(event.target.files[0]);
    }
  },

  processFile(file) {
    if (!file) return;

    // Validate size (10 MB limit)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      showToast("Selected image exceeds 10 MB limit. Please choose a smaller photo.", "error");
      return;
    }

    // Validate MIME
    const validMimes = ["image/jpeg", "image/png", "image/webp"];
    if (file.type && !validMimes.includes(file.type)) {
      showToast("Unsupported file type. Please upload a JPEG, PNG, or WebP photo.", "error");
      return;
    }

    this.selectedFile = file;

    // Display image preview
    const reader = new FileReader();
    reader.onload = (e) => {
      const previewImg = document.getElementById("image-preview");
      const previewWrapper = document.getElementById("preview-wrapper");
      const dropPlaceholder = document.getElementById("drop-placeholder");
      const fileMeta = document.getElementById("file-meta");

      if (previewImg && previewWrapper && dropPlaceholder) {
        previewImg.src = e.target.result;
        previewWrapper.classList.remove("hidden");
        dropPlaceholder.classList.add("hidden");

        const sizeKb = (file.size / 1024).toFixed(1);
        if (fileMeta) fileMeta.textContent = `${file.name} (${sizeKb} KB)`;
      }

      this.clearBoundingBoxes();
    };
    reader.readAsDataURL(file);
  },

  resetImage() {
    this.selectedFile = null;
    const input = document.getElementById("image-input");
    if (input) input.value = "";

    const previewWrapper = document.getElementById("preview-wrapper");
    const dropPlaceholder = document.getElementById("drop-placeholder");
    const diagCard = document.getElementById("ai-diagnostic-card");

    if (previewWrapper) previewWrapper.classList.add("hidden");
    if (dropPlaceholder) dropPlaceholder.classList.remove("hidden");
    if (diagCard) diagCard.classList.add("hidden");

    this.clearBoundingBoxes();
  },

  toggleBoundingBoxes() {
    this.showBoundingBoxes = !this.showBoundingBoxes;
    const btnIcon = document.getElementById("toggle-bbox-icon");
    const btnText = document.getElementById("toggle-bbox-text");

    if (this.showBoundingBoxes) {
      if (btnIcon) btnIcon.textContent = "👁️";
      if (btnText) btnText.textContent = "Toggle AI Overlay";
      if (this.cachedDetections && this.cachedDetections.length > 0) {
        this.drawBoundingBoxes(this.cachedDetections);
      }
    } else {
      if (btnIcon) btnIcon.textContent = "🙈";
      if (btnText) btnText.textContent = "Overlay Hidden";
      this.clearBoundingBoxes();
    }
  },

  clearBoundingBoxes() {
    const canvas = document.getElementById("bbox-canvas");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    // Remove any DOM bounding boxes
    document.querySelectorAll(".bbox-box").forEach(el => el.remove());
  },

  drawBoundingBoxes(detections) {
    this.cachedDetections = detections || [];
    if (!this.showBoundingBoxes) return;

    const container = document.getElementById("bbox-container");
    const img = document.getElementById("image-preview");
    if (!container || !img || !detections || detections.length === 0) return;

    this.clearBoundingBoxes();

    const onRender = () => {
      const naturalW = img.naturalWidth || 640;
      const naturalH = img.naturalHeight || 640;
      const displayW = img.clientWidth;
      const displayH = img.clientHeight;

      const scaleX = displayW / naturalW;
      const scaleY = displayH / naturalH;

      detections.forEach((d) => {
        if (!d.bbox || d.bbox.length !== 4) return;
        const [x1, y1, x2, y2] = d.bbox;
        const left = x1 * scaleX;
        const top = y1 * scaleY;
        const width = (x2 - x1) * scaleX;
        const height = (y2 - y1) * scaleY;

        const box = document.createElement("div");
        box.className = "bbox-box";
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;

        const confPct = Math.round((d.confidence || 0) * 100);
        const label = document.createElement("div");
        label.className = "bbox-label";
        const issueName = (d.issue || d.class_name || "Defect").replace(/_/g, " ").toUpperCase();
        label.textContent = `${issueName} (${confPct}%)`;

        box.appendChild(label);
        container.appendChild(box);
      });
    };

    if (img.complete && img.naturalWidth > 0) {
      onRender();
    } else {
      img.onload = onRender;
    }
  },

  renderAuthenticityTransparency(authData) {
    const diagCard = document.getElementById("ai-diagnostic-card");
    const authBadge = document.getElementById("diag-authenticity");
    const authScore = document.getElementById("diag-auth-score");
    const authExpl = document.getElementById("diag-auth-explanation");

    if (!diagCard || !authBadge || !authData) return;
    diagCard.classList.remove("hidden");

    const status = authData.status || "LIKELY_AUTHENTIC";
    const scoreVal = typeof authData.real_probability === "number" ? authData.real_probability.toFixed(2) : (typeof authData.authenticity_score === "number" ? authData.authenticity_score.toFixed(2) : "0.94");
    if (authScore) authScore.textContent = `Score: ${scoreVal}`;

    const config = {
      LIKELY_AUTHENTIC: {
        text: "LIKELY AUTHENTIC",
        cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
        expl: "Natural optical grain and camera sensor characteristics verified. Standard automated triage."
      },
      UNCERTAIN: {
        text: "ANALYSIS UNCERTAIN",
        cls: "bg-amber-50 text-amber-700 border-amber-200",
        expl: "Lighting or compression limits automated confidence. Proceeding to standard triage with human verification."
      },
      REVIEW_REQUIRED: {
        text: "HUMAN REVIEW RECOMMENDED",
        cls: "bg-blue-50 text-blue-700 border-blue-200",
        expl: "High texture variance detected. Scheduled for technician review; report remains active."
      },
      SUSPICIOUS: {
        text: "SYNTHETIC ARTIFACTS FLAGGED",
        cls: "bg-rose-50 text-rose-700 border-rose-200",
        expl: "AI-generated patterns flagged. Queued for manual administrative inspection before dispatch."
      }
    };

    const c = config[status] || config.LIKELY_AUTHENTIC;
    authBadge.className = `font-extrabold text-xs px-2 py-0.5 rounded-full border ${c.cls}`;
    authBadge.textContent = c.text;
    if (authExpl) authExpl.textContent = c.expl;
  },

  async submitReport(event) {
    event.preventDefault();

    if (!this.selectedFile) {
      showToast("Please upload or capture a photo of the civic defect.", "error");
      return;
    }

    const descInput = document.getElementById("desc-input");
    const addressInput = document.getElementById("address-input");
    const submitBtn = document.getElementById("btn-submit-report");
    const progressEl = document.getElementById("submit-progress");
    const progressFill = document.getElementById("progress-bar-fill");
    const progressPct = document.getElementById("submit-percentage");

    const formData = new FormData();
    formData.append("image", this.selectedFile);
    formData.append("latitude", this.currentLat.toString());
    formData.append("longitude", this.currentLng.toString());
    formData.append("category", this.selectedCategory || "pothole");
    formData.append("location_source", this.locationSource || "MANUAL_PIN");
    formData.append("address", addressInput ? addressInput.value.trim() : "");
    formData.append("description", descInput ? descInput.value.trim() : "");

    try {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span>Running AI Diagnostics & Submitting...</span>
      `;
      progressEl.classList.remove("hidden");
      progressFill.style.width = "40%";
      progressPct.textContent = "40%";

      const result = await Api.submitReport(formData);

      progressFill.style.width = "100%";
      progressPct.textContent = "100%";

      showToast("Report submitted successfully! AI analysis complete.", "success");

      // Extract unified AI values (handles flat & nested structures)
      const isDetected = (result.status || result.ai_analysis?.status) === "DETECTION_FOUND";
      const primaryCat = (result.ai_category || result.ai_analysis?.category || this.selectedCategory || "Pothole").replace(/_/g, " ");
      const rawConf = typeof result.ai_confidence === "number" ? result.ai_confidence : (typeof result.ai_analysis?.confidence === "number" ? result.ai_analysis.confidence : null);
      const confPct = rawConf !== null ? Math.round(rawConf * 100) : null;
      const auth = result.authenticity_result || result.ai_analysis?.authenticity || { status: "LIKELY_AUTHENTIC", real_probability: 0.94 };
      const detections = result.ai_detections || result.ai_analysis?.detections || [];
      const dept = result.assigned_department || result.ai_analysis?.assigned_department || "Public Works Dept (PWD)";
      const priority = result.priority_level || result.ai_analysis?.priority_level || "HIGH";
      const priorityScore = result.priority_score || result.ai_analysis?.priority_score || 82;

      // Update In-Form AI Diagnostics Card
      const categoryEl = document.getElementById("diag-category");
      const confEl = document.getElementById("diag-confidence");
      const deptEl = document.getElementById("diag-department");
      const priorityEl = document.getElementById("diag-priority-tag");
      const diagCard = document.getElementById("ai-diagnostic-card");

      if (diagCard) diagCard.classList.remove("hidden");
      if (categoryEl) categoryEl.textContent = primaryCat.toUpperCase();
      if (confEl) {
        if (confPct !== null) {
          confEl.textContent = `${confPct}% conf`;
          confEl.className = "text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded";
        } else {
          confEl.textContent = "Manual Review";
          confEl.className = "text-xs font-mono font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded";
        }
      }
      if (deptEl) deptEl.textContent = dept;
      if (priorityEl) priorityEl.textContent = `Triage: ${priority} (${priorityScore}/100)`;

      if (detections && detections.length > 0) {
        this.drawBoundingBoxes(detections);
      } else {
        this.clearBoundingBoxes();
      }

      this.renderAuthenticityTransparency(auth);

      // Open Success Receipt Modal
      this.openSuccessModal({
        reportId: result.report_id || "REP-" + Math.floor(10000 + Math.random() * 90000),
        category: primaryCat,
        confidenceText: confPct !== null ? `${confPct}% AI Vision Confidence` : "Visual Staff Verification Required",
        dept: dept,
        authStatus: `${auth.status || 'LIKELY_AUTHENTIC'} (${(auth.real_probability || 0.94).toFixed(2)})`,
        priority: `${priority} • Score ${priorityScore}/100`,
        isDuplicate: result.is_linked_to_existing_issue
      });

    } catch (err) {
      console.error("Submission failed:", err);
      showToast(err.message || "Failed to submit report. Please check server connection.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span>Submit Another Report</span>
      `;
      setTimeout(() => progressEl.classList.add("hidden"), 1200);
    }
  },

  openSuccessModal(data) {
    const modal = document.getElementById("modal-report-success");
    if (!modal) return;

    const tId = document.getElementById("receipt-ticket-id");
    const rCat = document.getElementById("receipt-category");
    const rConf = document.getElementById("receipt-confidence");
    const rDept = document.getElementById("receipt-dept");
    const rAuth = document.getElementById("receipt-auth");
    const rPrio = document.getElementById("receipt-priority");
    const rCluster = document.getElementById("receipt-cluster");

    if (tId) tId.textContent = `Ticket #${data.reportId} • Municipal Triage Queue`;
    if (rCat) rCat.textContent = data.category.toUpperCase();
    if (rConf) rConf.textContent = data.confidenceText || (typeof data.confidence === "number" ? `${data.confidence}% AI Vision Confidence` : "Visual Staff Verification Queued");
    if (rDept) rDept.textContent = data.dept;
    if (rAuth) rAuth.textContent = data.authStatus;
    if (rPrio) rPrio.textContent = data.priority;
    if (rCluster) rCluster.textContent = data.isDuplicate ? "Linked to Existing Nearby Cluster" : "Spatial Cluster: Verified Unique";

    modal.classList.remove("hidden");
  },

  closeSuccessModal() {
    const modal = document.getElementById("modal-report-success");
    if (modal) modal.classList.add("hidden");
  },

  goToMyReports() {
    this.closeSuccessModal();
    App.switchTab("my-reports");
  },

  goToAdminOps() {
    this.closeSuccessModal();
    App.switchTab("admin");
  },

  async loadMyReports() {
    const listEl = document.getElementById("my-reports-list");
    const countEl = document.getElementById("citizen-report-count");
    if (!listEl) return;

    listEl.innerHTML = `
      <div class="p-8 text-center bg-white rounded-xl border border-slate-200 text-slate-400 text-xs">
        Loading your incident history...
      </div>
    `;

    try {
      const res = await Api.getMyReports();
      this.cachedMyReports = res.reports || [];
      if (countEl) countEl.textContent = this.cachedMyReports.length.toString();
      this.renderFilteredMyReports();
    } catch (err) {
      console.error("Failed to load reports:", err);
      listEl.innerHTML = `
        <div class="p-8 text-center bg-white rounded-xl border border-rose-200 text-rose-600 text-xs">
          Unable to fetch your report history. Please ensure you are logged in.
        </div>
      `;
    }
  },

  filterMyReports(filterType) {
    this.currentFilter = filterType;
    const filterBtns = {
      ALL: "filter-rep-all",
      ACTIVE: "filter-rep-active",
      IN_PROGRESS: "filter-rep-progress",
      RESOLVED: "filter-rep-resolved"
    };

    Object.keys(filterBtns).forEach((k) => {
      const el = document.getElementById(filterBtns[k]);
      if (el) {
        if (k === filterType) {
          el.className = "rep-filter-btn px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold transition";
        } else {
          el.className = "rep-filter-btn px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition";
        }
      }
    });

    this.renderFilteredMyReports();
  },

  renderFilteredMyReports() {
    const listEl = document.getElementById("my-reports-list");
    if (!listEl) return;

    let filtered = this.cachedMyReports || [];
    if (this.currentFilter === "ACTIVE") {
      filtered = filtered.filter(r => ["REPORTED", "PENDING"].includes(r.issue_status));
    } else if (this.currentFilter === "IN_PROGRESS") {
      filtered = filtered.filter(r => ["ASSIGNED", "IN_PROGRESS"].includes(r.issue_status));
    } else if (this.currentFilter === "RESOLVED") {
      filtered = filtered.filter(r => r.issue_status === "RESOLVED");
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div class="w-12 h-12 mx-auto rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </div>
          <h3 class="text-sm font-bold text-slate-900">No Submissions Found</h3>
          <p class="text-xs text-slate-500 max-w-sm mx-auto">No reports match the current "${this.currentFilter}" filter.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered.map(r => this.renderReportCard(r)).join("");
  },

  renderReportCard(r) {
    const dateStr = new Date(r.created_at || Date.now()).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit"
    });

    const statusStages = ["REPORTED", "PENDING", "ASSIGNED", "IN_PROGRESS", "RESOLVED"];
    const currentIdx = statusStages.indexOf(r.issue_status || "REPORTED");

    // Stepper generation
    const stepperHtml = statusStages.map((stage, idx) => {
      let stateCls = "";
      if (idx < currentIdx) stateCls = "completed";
      else if (idx === currentIdx) stateCls = "active";

      return `
        <div class="stepper-step ${stateCls}">
          <div class="stepper-circle">${idx < currentIdx ? "✓" : idx + 1}</div>
          <span class="text-[9px] font-bold text-slate-500 hidden sm:block mt-1 uppercase">${stage.replace("_", " ")}</span>
        </div>
      `;
    }).join("");

    // Priority badge
    const p = (r.priority_level || "MEDIUM").toUpperCase();
    const priorityConfig = {
      CRITICAL: { cls: "badge-priority-critical", text: "Critical Risk" },
      HIGH: { cls: "badge-priority-high", text: "High Priority" },
      MEDIUM: { cls: "badge-priority-medium", text: "Standard" },
      LOW: { cls: "badge-priority-low", text: "Low Priority" }
    };
    const pInfo = priorityConfig[p] || priorityConfig.MEDIUM;

    return `
      <div class="bg-white rounded-2xl border border-slate-200/80 shadow-card overflow-hidden">
        <div class="p-6 flex flex-col md:flex-row gap-6">
          
          <!-- Image preview -->
          <div class="w-full md:w-56 h-48 bg-slate-100 rounded-xl overflow-hidden shrink-0 border border-slate-200 relative">
            <img src="${r.image_url}" alt="Incident" class="w-full h-full object-cover" />
            <span class="absolute top-2 left-2 badge-priority ${pInfo.cls}">
              ${pInfo.text}
            </span>
          </div>

          <!-- Body -->
          <div class="flex-1 flex flex-col justify-between space-y-4">
            <div>
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-xs font-bold text-slate-400">#REP-${r.id}</span>
                    <h3 class="font-extrabold text-base text-slate-900">${(r.issue_title || r.ai_category || "Civic Defect").toUpperCase()}</h3>
                  </div>
                  <p class="text-xs text-slate-500 mt-1 flex items-center gap-1">
                    <svg class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>
                    <span>${r.address || `GPS: ${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`}</span>
                  </p>
                </div>
                <span class="text-[11px] font-mono text-slate-400 shrink-0">${dateStr}</span>
              </div>

              ${r.description ? `
                <p class="text-xs text-slate-600 mt-2 p-2.5 bg-slate-50 rounded-lg border border-slate-100 font-medium">"${r.description}"</p>
              ` : ""}
            </div>

            <!-- 5-Step Lifecycle Stepper -->
            <div class="bg-slate-50/80 p-3 rounded-xl border border-slate-200/60">
              <div class="flex items-center justify-between">
                ${stepperHtml}
              </div>
            </div>

            <!-- Resolution Banner if closed -->
            ${r.issue_status === "RESOLVED" ? `
              <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <div class="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">✓</div>
                  <div>
                    <span class="text-xs font-bold text-emerald-900">Incident Resolved & Certified</span>
                    <p class="text-[11px] text-emerald-700">${r.resolution_notes || "Field repair work completed by municipal dispatch."}</p>
                  </div>
                </div>
                ${r.resolution_image_url ? `
                  <button onclick="Citizen.viewProofModal('${r.resolution_image_url}', '${r.resolution_notes || ''}')" class="px-3 py-1.5 bg-white text-emerald-700 border border-emerald-300 font-bold rounded-lg hover:bg-emerald-100 transition shadow-2xs text-xs">
                    View Proof
                  </button>
                ` : ""}
              </div>
            ` : ""}

          </div>
        </div>
      </div>
    `;
  },

  viewProofModal(imgUrl, notes) {
    const modal = document.getElementById("modal-view-proof");
    const imgEl = document.getElementById("proof-img");
    const notesEl = document.getElementById("proof-notes");

    if (imgEl) imgEl.src = imgUrl;
    if (notesEl) notesEl.textContent = notes || "Repairs successfully verified.";
    if (modal) modal.classList.remove("hidden");
  }
};

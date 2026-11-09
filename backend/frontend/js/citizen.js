// ==========================================================================
// CIVORA CITIZEN INTERACTION CONTROLLER
// Handles Image Upload, Bounding Box Rendering, Geolocation, AI Diagnostics
// & Multi-step Lifecycle Tracking
// ==========================================================================

const Citizen = {
  map: null,
  marker: null,
  currentLat: 28.6139, // Default: New Delhi
  currentLng: 77.2090,
  selectedFile: null,

  init() {
    this.initMap();
    this.bindDropZone();
  },

  initMap() {
    const mapEl = document.getElementById("report-map");
    if (!mapEl || this.map) return;

    this.map = L.map("report-map").setView([this.currentLat, this.currentLng], 14);
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
      this.updateCoordsDisplay();
    });

    this.map.on("click", (e) => {
      this.currentLat = e.latlng.lat;
      this.currentLng = e.latlng.lng;
      this.marker.setLatLng([this.currentLat, this.currentLng]);
      this.updateCoordsDisplay();
    });

    this.updateCoordsDisplay();
  },

  locateUser() {
    if (!navigator.geolocation) {
      showToast("Geolocation is not supported by your browser", "error");
      return;
    }

    showToast("Detecting precise GPS coordinates...", "info");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.currentLat = pos.coords.latitude;
        this.currentLng = pos.coords.longitude;
        if (this.map && this.marker) {
          this.map.setView([this.currentLat, this.currentLng], 16);
          this.marker.setLatLng([this.currentLat, this.currentLng]);
        }
        this.updateCoordsDisplay();
        showToast("GPS Location locked!", "success");
      },
      (err) => {
        showToast("Could not retrieve GPS location. You can drag the map pin manually.", "warning");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  },

  updateCoordsDisplay() {
    const coordEl = document.getElementById("selected-coords");
    if (coordEl) {
      coordEl.textContent = `${this.currentLat.toFixed(5)}, ${this.currentLng.toFixed(5)}`;
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
        label.textContent = `${d.class_name || "defect"} (${confPct}%)`;

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
    const scoreVal = typeof authData.authenticity_score === "number" ? authData.authenticity_score.toFixed(2) : "N/A";
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

      // Update AI Diagnostics Card
      const categoryEl = document.getElementById("diag-category");
      const confEl = document.getElementById("diag-confidence");
      const diagCard = document.getElementById("ai-diagnostic-card");

      if (diagCard) diagCard.classList.remove("hidden");
      if (categoryEl) categoryEl.textContent = (result.ai_category || "Civic Defect").toUpperCase();
      if (confEl) confEl.textContent = `${Math.round((result.ai_confidence || 0) * 100)}% conf`;

      if (result.ai_detections) {
        this.drawBoundingBoxes(result.ai_detections);
      }

      if (result.authenticity_result) {
        this.renderAuthenticityTransparency(result.authenticity_result);
      }

      // Scroll smoothly to the diagnostic card
      diagCard.scrollIntoView({ behavior: "smooth", block: "center" });

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
      const reports = res.reports || [];
      if (countEl) countEl.textContent = reports.length.toString();

      if (reports.length === 0) {
        listEl.innerHTML = `
          <div class="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <div class="w-12 h-12 mx-auto rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </div>
            <h3 class="text-sm font-bold text-slate-900">No Submissions Found</h3>
            <p class="text-xs text-slate-500 max-w-sm mx-auto">You have not submitted any civic incident reports yet. Use the reporting portal to submit your first report.</p>
            <button onclick="App.switchTab('report')" class="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
              Report an Issue
            </button>
          </div>
        `;
        return;
      }

      listEl.innerHTML = reports.map(r => this.renderReportCard(r)).join("");

    } catch (err) {
      console.error("Failed to load reports:", err);
      listEl.innerHTML = `
        <div class="p-8 text-center bg-white rounded-xl border border-rose-200 text-rose-600 text-xs">
          Unable to fetch your report history. Please ensure you are logged in.
        </div>
      `;
    }
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

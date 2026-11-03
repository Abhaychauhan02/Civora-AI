// Citizen Reporting Flow & Tracking Logic
const Citizen = {
  map: null,
  marker: null,
  currentLat: 28.6139, // Default coordinates (New Delhi)
  currentLng: 77.2090,
  selectedFile: null,

  init() {
    this.initMap();
    this.bindEvents();
  },

  initMap() {
    const mapEl = document.getElementById("report-map");
    if (!mapEl || this.map) return;

    this.map = L.map("report-map").setView([this.currentLat, this.currentLng], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors"
    }).addTo(this.map);

    this.marker = L.marker([this.currentLat, this.currentLng], { draggable: true }).addTo(this.map);

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

  handleImageSelection(file) {
    if (!file) return;

    // Client-side file size validation (10 MB limit)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      showToast("Selected image exceeds the 10 MB limit. Please choose a smaller photo.", "error");
      return;
    }

    // Client-side extension validation
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (file.type && !validTypes.includes(file.type)) {
      showToast("Unsupported file type. Please upload a JPEG, PNG, or WebP photo.", "error");
      return;
    }

    this.selectedFile = file;
    this.clearBoundingBoxes();

    const previewImg = document.getElementById("report-img-preview");
    const previewContainer = document.getElementById("preview-container");
    const uploadPrompt = document.getElementById("upload-prompt");

    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      previewContainer.classList.remove("hidden");
      uploadPrompt.classList.add("hidden");
    };
    reader.readAsDataURL(file);
  },

  clearImage() {
    this.selectedFile = null;
    const input = document.getElementById("image-file-input");
    if (input) input.value = "";
    document.getElementById("preview-container").classList.add("hidden");
    document.getElementById("upload-prompt").classList.remove("hidden");
    document.getElementById("ai-preview-card").classList.add("hidden");
    this.clearBoundingBoxes();
  },

  clearBoundingBoxes() {
    const overlay = document.getElementById("bbox-overlay");
    if (overlay) overlay.innerHTML = "";
  },

  drawBoundingBoxes(detections) {
    const overlay = document.getElementById("bbox-overlay");
    const img = document.getElementById("report-img-preview");
    if (!overlay || !img || !detections || detections.length === 0) return;

    overlay.innerHTML = "";

    // Calculate scale factor once image has natural dimensions loaded
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

        const boxEl = document.createElement("div");
        boxEl.className = "bbox-box";
        boxEl.style.left = `${left}px`;
        boxEl.style.top = `${top}px`;
        boxEl.style.width = `${width}px`;
        boxEl.style.height = `${height}px`;

        const labelEl = document.createElement("div");
        labelEl.className = "bbox-label";
        const issueName = d.issue.replace("_", " ").toUpperCase();
        const confPct = Math.round(d.confidence * 100);
        labelEl.textContent = `${issueName} ${confPct}%`;

        boxEl.appendChild(labelEl);
        overlay.appendChild(boxEl);
      });
    };

    if (img.complete && img.naturalWidth > 0) {
      onRender();
    } else {
      img.onload = onRender;
    }
  },

  async handleSubmit(e) {
    e.preventDefault();
    if (!this.selectedFile) {
      showToast("Please capture or upload an image of the issue", "warning");
      return;
    }

    const submitBtn = document.getElementById("submit-report-btn");
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      Analyzing with AI Vision & Verification...
    `;

    try {
      const formData = new FormData();
      formData.append("image", this.selectedFile);
      formData.append("latitude", this.currentLat);
      formData.append("longitude", this.currentLng);

      const address = document.getElementById("report-address").value.trim();
      if (address) formData.append("address", address);

      const desc = document.getElementById("report-desc").value.trim();
      if (desc) formData.append("description", desc);

      const res = await Api.submitReport(formData);

      // Display AI results card with transparent split diagnostics
      this.displayAiResults(res);

      // Draw bounding box highlights over image preview
      if (res.ai_analysis && res.ai_analysis.detections) {
        this.drawBoundingBoxes(res.ai_analysis.detections);
      }

      if (res.is_linked_to_existing_issue) {
        showToast("Report submitted! Clustered with existing nearby issue; priority boosted.", "success");
      } else {
        showToast("New civic issue successfully logged & queued for dispatch!", "success");
      }

      // Reset input fields but preserve preview card for citizen visibility
      const fileInput = document.getElementById("image-file-input");
      if (fileInput) fileInput.value = "";
      document.getElementById("report-desc").value = "";
      document.getElementById("report-address").value = "";

    } catch (err) {
      showToast(err.message || "Failed to submit report", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  },

  displayAiResults(res) {
    const card = document.getElementById("ai-preview-card");
    const aiData = res.ai_analysis;
    if (!aiData || !card) return;

    card.classList.remove("hidden");

    // 1. Civic Detection Info
    const cat = aiData.category.replace("_", " ").toUpperCase();
    const conf = Math.round((aiData.confidence || 0) * 100);
    const sev = aiData.severity_score || 0;
    const detCount = (aiData.detections || []).length;

    document.getElementById("ai-res-category").textContent = cat;
    document.getElementById("ai-res-confidence").textContent = `${conf}%`;
    document.getElementById("ai-res-severity").textContent = `${sev}/100`;

    const countEl = document.getElementById("ai-det-count");
    if (countEl) {
      countEl.textContent = `${detCount} object${detCount === 1 ? '' : 's'} located`;
    }

    // 2. Authenticity Display (Handling all 4 states transparently without accusatory language)
    const authStatus = aiData.authenticity?.status || "LIKELY_AUTHENTIC";
    const authExplanation = aiData.authenticity?.explanation || "Image exhibits natural photographic characteristics.";
    const authEl = document.getElementById("ai-res-auth");
    const explanationEl = document.getElementById("ai-res-auth-explanation");

    if (authStatus === "LIKELY_AUTHENTIC") {
      authEl.className = "text-emerald-300 bg-emerald-950/80 border border-emerald-700/80 px-2.5 py-0.5 rounded-full text-[11px] font-semibold";
      authEl.textContent = "✓ Verified Authentic Capture";
    } else if (authStatus === "UNCERTAIN") {
      authEl.className = "text-sky-300 bg-sky-950/80 border border-sky-700/80 px-2.5 py-0.5 rounded-full text-[11px] font-semibold";
      authEl.textContent = "ℹ Standard Processing";
    } else if (authStatus === "REVIEW_REQUIRED") {
      authEl.className = "text-amber-300 bg-amber-950/80 border border-amber-700/80 px-2.5 py-0.5 rounded-full text-[11px] font-semibold";
      authEl.textContent = "🔍 Visual Verification Queued";
    } else { // SUSPICIOUS
      authEl.className = "text-purple-300 bg-purple-950/80 border border-purple-700/80 px-2.5 py-0.5 rounded-full text-[11px] font-semibold";
      authEl.textContent = "📋 Secondary Audit Queued";
    }

    if (explanationEl) {
      explanationEl.textContent = authExplanation;
    }

    // 3. Duplicate Linkage Status
    const linkMsg = document.getElementById("ai-res-linked");
    const linkText = document.getElementById("ai-res-linked-text");
    if (linkMsg && linkText) {
      if (res.is_linked_to_existing_issue) {
        linkText.textContent = `Corroborated with active nearby issue #${res.issue_id}. Public priority escalated.`;
        linkMsg.classList.remove("hidden");
      } else {
        linkText.textContent = `Registered new independent municipal issue #${res.issue_id}.`;
        linkMsg.classList.remove("hidden");
      }
    }
  },

  async loadMyReports() {
    const listEl = document.getElementById("my-reports-list");
    const emptyEl = document.getElementById("my-reports-empty");
    if (!listEl) return;

    if (!Auth.currentUser) {
      listEl.innerHTML = `
        <div class="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
          <p class="text-blue-900 font-medium mb-3">Sign in to track your personal submitted reports & resolutions.</p>
          <button onclick="Auth.openModal('login')" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">Sign In</button>
        </div>
      `;
      emptyEl.classList.add("hidden");
      return;
    }

    listEl.innerHTML = `<div class="text-center py-8 text-slate-500">Loading your reports...</div>`;

    try {
      const res = await Api.getMyReports();
      const reports = res.reports || [];

      if (reports.length === 0) {
        listEl.innerHTML = "";
        emptyEl.classList.remove("hidden");
        return;
      }

      emptyEl.classList.add("hidden");
      listEl.innerHTML = reports.map(r => this.renderReportCard(r)).join("");
    } catch (err) {
      listEl.innerHTML = `<div class="text-red-500 text-center py-4">${err.message}</div>`;
    }
  },

  renderReportCard(r) {
    const statusSteps = ["REPORTED", "PENDING", "ASSIGNED", "IN_PROGRESS", "RESOLVED"];
    const currentIdx = statusSteps.indexOf(r.issue_status) >= 0 ? statusSteps.indexOf(r.issue_status) : 0;

    const priorityBadgeMap = {
      CRITICAL: { text: "🚨 Critical Urgency", cls: "bg-red-50 text-red-700 border-red-200" },
      HIGH: { text: "⚠️ High Priority", cls: "bg-orange-50 text-orange-700 border-orange-200" },
      MEDIUM: { text: "⚡ Medium Priority", cls: "bg-amber-50 text-amber-700 border-amber-200" },
      LOW: { text: "ℹ️ Low Priority", cls: "bg-slate-50 text-slate-700 border-slate-200" }
    };
    const pInfo = priorityBadgeMap[r.issue_priority] || { text: "Normal", cls: "bg-slate-50 text-slate-700 border-slate-200" };

    const dateStr = new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

    // Step indicators HTML
    const stepsHtml = statusSteps.map((s, idx) => {
      const isCompleted = idx <= currentIdx;
      const isCurrent = idx === currentIdx;
      const dotCls = isCurrent
        ? "bg-blue-600 ring-4 ring-blue-100 text-white"
        : (isCompleted ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-400");
      const labelCls = isCurrent ? "font-bold text-blue-700" : (isCompleted ? "font-medium text-slate-700" : "text-slate-400");

      return `
        <div class="flex-1 text-center">
          <div class="w-5 h-5 mx-auto rounded-full flex items-center justify-center text-[10px] ${dotCls}">
            ${isCompleted && !isCurrent ? '✓' : idx + 1}
          </div>
          <div class="text-[10px] mt-1 ${labelCls} hidden sm:block">${s.replace('_', ' ')}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs hover:shadow-sm transition">
        <div class="sm:flex">
          <div class="sm:w-52 h-44 bg-slate-900 flex-shrink-0 relative overflow-hidden">
            <img src="${r.image_url}" alt="Civic Report" class="w-full h-full object-cover">
            <span class="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full border ${pInfo.cls} shadow-xs">
              ${pInfo.text}
            </span>
          </div>

          <div class="p-4 sm:p-5 flex-1 flex flex-col justify-between space-y-3">
            <div>
              <div class="flex items-start justify-between gap-2">
                <h4 class="font-bold text-slate-900 text-sm">${r.issue_title || r.ai_category || "Civic Report"}</h4>
                <span class="text-xs text-slate-400 whitespace-nowrap">${dateStr}</span>
              </div>
              <p class="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                <svg class="w-3.5 h-3.5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                ${r.address || `GPS: ${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`}
              </p>
              ${r.description ? `<p class="text-xs text-slate-600 mt-2 bg-slate-50 p-2 rounded-lg border border-slate-100">"${r.description}"</p>` : ""}
            </div>

            <!-- Multi-step Lifecycle Tracker -->
            <div class="bg-slate-50/80 p-2.5 rounded-xl border border-slate-100">
              <div class="flex items-center justify-between relative">
                ${stepsHtml}
              </div>
            </div>

            <!-- Resolution Evidence section if resolved -->
            ${r.issue_status === "RESOLVED" ? `
              <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                <div>
                  <span class="text-xs font-bold text-emerald-800 flex items-center gap-1">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                    Resolution Verified & Closed
                  </span>
                  <p class="text-xs text-emerald-700 mt-0.5">${r.resolution_notes || "Repairs successfully completed by campus team."}</p>
                </div>
                ${r.resolution_image_url ? `
                  <button onclick="Citizen.viewResolutionModal('${r.resolution_image_url}', '${r.resolution_notes || ''}')" class="text-xs font-semibold text-emerald-700 hover:text-emerald-900 bg-white px-2.5 py-1.5 rounded-lg shadow-2xs border border-emerald-200 flex items-center gap-1">
                    <span>View Proof</span>
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  </button>
                ` : ""}
              </div>
            ` : `
              <div class="flex items-center gap-1.5 text-xs text-slate-500">
                <span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                <span>Active in municipal resolution queue</span>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  },

  viewResolutionModal(imgUrl, notes) {
    const modal = document.getElementById("resolution-proof-modal");
    document.getElementById("res-proof-img").src = imgUrl;
    document.getElementById("res-proof-notes").textContent = notes;
    modal.classList.remove("hidden");
  },

  bindEvents() {
    const fileInput = document.getElementById("image-file-input");
    const replaceBtn = document.getElementById("replace-img-btn");

    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
          this.handleImageSelection(e.target.files[0]);
        }
      });
    }

    if (replaceBtn) {
      replaceBtn.addEventListener("click", () => {
        if (fileInput) fileInput.click();
      });
    }

    const removeBtn = document.getElementById("remove-img-btn");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => this.clearImage());
    }

    const locateBtn = document.getElementById("locate-me-btn");
    if (locateBtn) {
      locateBtn.addEventListener("click", () => this.locateUser());
    }

    const form = document.getElementById("report-form");
    if (form) {
      form.addEventListener("submit", (e) => this.handleSubmit(e));
    }
  }
};

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
    this.selectedFile = file;

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
    document.getElementById("image-file-input").value = "";
    document.getElementById("preview-container").classList.add("hidden");
    document.getElementById("upload-prompt").classList.remove("hidden");
    document.getElementById("ai-preview-card").classList.add("hidden");
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
      Analyzing with AI Vision...
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

      // Display AI results card
      this.displayAiResults(res);

      if (res.is_linked_to_existing_issue) {
        showToast("Report added! Corroborated an existing nearby issue. Priority boosted!", "success");
      } else {
        showToast("New civic issue successfully created & logged!", "success");
      }

      // Reset form
      this.clearImage();
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
    const cat = aiData.category.replace("_", " ").toUpperCase();
    const conf = Math.round((aiData.confidence || 0) * 100);
    const sev = aiData.severity_score || 0;
    const authStatus = aiData.authenticity?.status || "LIKELY_AUTHENTIC";

    document.getElementById("ai-res-category").textContent = cat;
    document.getElementById("ai-res-confidence").textContent = `${conf}%`;
    document.getElementById("ai-res-severity").textContent = `${sev}/100`;

    const authEl = document.getElementById("ai-res-auth");
    if (authStatus === "LIKELY_AUTHENTIC") {
      authEl.className = "text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full text-xs font-semibold";
      authEl.textContent = "Verified Authentic Image";
    } else {
      authEl.className = "text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full text-xs font-semibold";
      authEl.textContent = `Authenticity: ${authStatus}`;
    }

    const linkMsg = document.getElementById("ai-res-linked");
    if (res.is_linked_to_existing_issue) {
      linkMsg.textContent = `Linked to existing issue ID: ${res.issue_id} (Duplicate prevention applied)`;
      linkMsg.classList.remove("hidden");
    } else {
      linkMsg.textContent = `Created new tracked issue ID: ${res.issue_id}`;
      linkMsg.classList.remove("hidden");
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
    const statusColors = {
      REPORTED: "bg-blue-100 text-blue-800",
      PENDING: "bg-amber-100 text-amber-800",
      ASSIGNED: "bg-purple-100 text-purple-800",
      IN_PROGRESS: "bg-indigo-100 text-indigo-800",
      RESOLVED: "bg-emerald-100 text-emerald-800"
    };

    const statusBadge = statusColors[r.issue_status] || "bg-slate-100 text-slate-800";
    const dateStr = new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

    return `
      <div class="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition">
        <div class="sm:flex">
          <div class="sm:w-48 h-40 bg-slate-100 flex-shrink-0 relative overflow-hidden">
            <img src="${r.image_url}" alt="Report" class="w-full h-full object-cover">
            <span class="absolute top-2 left-2 text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge}">
              ${r.issue_status || "PENDING"}
            </span>
          </div>
          <div class="p-4 flex-1 flex flex-col justify-between">
            <div>
              <div class="flex items-start justify-between gap-2">
                <h4 class="font-semibold text-slate-900">${r.issue_title || r.ai_category || "Civic Report"}</h4>
                <span class="text-xs text-slate-400 whitespace-nowrap">${dateStr}</span>
              </div>
              <p class="text-xs text-slate-500 mt-1">${r.address || `GPS: ${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`}</p>
              ${r.description ? `<p class="text-sm text-slate-600 mt-2 line-clamp-2">${r.description}</p>` : ""}
            </div>

            <!-- Resolution Evidence section if resolved -->
            ${r.issue_status === "RESOLVED" ? `
              <div class="mt-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
                <div>
                  <span class="text-xs font-bold text-emerald-800">✓ Resolved by Authority</span>
                  <p class="text-xs text-emerald-700 mt-0.5">${r.resolution_notes || "Completed as scheduled"}</p>
                </div>
                ${r.resolution_image_url ? `
                  <button onclick="Citizen.viewResolutionModal('${r.resolution_image_url}', '${r.resolution_notes || ''}')" class="text-xs font-semibold text-emerald-700 hover:text-emerald-900 bg-white px-2 py-1 rounded shadow-sm border border-emerald-200">
                    View Proof
                  </button>
                ` : ""}
              </div>
            ` : `
              <div class="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
                <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                In processing queue
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
    const dropZone = document.getElementById("image-drop-zone");

    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        this.handleImageSelection(e.target.files[0]);
      }
    });

    document.getElementById("remove-img-btn").addEventListener("click", () => this.clearImage());
    document.getElementById("locate-me-btn").addEventListener("click", () => this.locateUser());
    document.getElementById("report-form").addEventListener("submit", (e) => this.handleSubmit(e));
  }
};

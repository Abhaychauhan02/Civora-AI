// Admin Portal Management & Triage Logic
const Admin = {
  map: null,
  markersLayer: null,
  currentIssues: [],
  selectedIssueId: null,

  init() {
    this.initMap();
    this.bindEvents();
  },

  initMap() {
    const mapEl = document.getElementById("admin-map");
    if (!mapEl || this.map) return;

    this.map = L.map("admin-map").setView([28.6139, 77.2090], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors"
    }).addTo(this.map);

    this.markersLayer = L.layerGroup().addTo(this.map);
  },

  async loadDashboard() {
    if (!Auth.currentUser || Auth.currentUser.role !== "ADMIN") {
      document.getElementById("admin-auth-warning").classList.remove("hidden");
      document.getElementById("admin-content").classList.add("hidden");
      return;
    }

    document.getElementById("admin-auth-warning").classList.add("hidden");
    document.getElementById("admin-content").classList.remove("hidden");

    await Promise.all([
      this.loadAnalytics(),
      this.loadIssues(),
      this.loadMapMarkers()
    ]);
  },

  async loadAnalytics() {
    try {
      const res = await Api.getAdminAnalytics();
      const s = res.summary;

      document.getElementById("stat-total-issues").textContent = s.total_issues;
      document.getElementById("stat-total-reports").textContent = s.total_reports;
      document.getElementById("stat-dupes-prevented").textContent = s.duplicates_prevented;
      document.getElementById("stat-critical-count").textContent = s.critical_count;
      document.getElementById("stat-pending-count").textContent = s.pending_count;
      document.getElementById("stat-resolved-count").textContent = s.resolved_count;
      document.getElementById("stat-avg-hours").textContent = s.avg_resolution_hours ? `${s.avg_resolution_hours}h` : "N/A";
    } catch (err) {
      console.error("Analytics fetch error:", err);
    }
  },

  async loadMapMarkers() {
    if (!this.map || !this.markersLayer) return;
    this.markersLayer.clearLayers();

    try {
      const res = await Api.getMapIssues();
      const issues = res.issues || [];
      const bounds = [];

      issues.forEach((iss) => {
        const lat = iss.latitude;
        const lng = iss.longitude;
        if (!lat || !lng) return;

        bounds.push([lat, lng]);

        // Color coding by status / priority
        let markerColor = "#3b82f6"; // Blue
        if (iss.status === "RESOLVED") markerColor = "#10b981"; // Green
        else if (iss.priority_level === "CRITICAL") markerColor = "#ef4444"; // Red
        else if (iss.priority_level === "HIGH") markerColor = "#f97316"; // Orange
        else if (iss.priority_level === "MEDIUM") markerColor = "#f59e0b"; // Yellow

        const markerHtml = `
          <div style="background-color:${markerColor}; width:16px; height:16px; border-radius:50%; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>
        `;

        const customIcon = L.divIcon({
          html: markerHtml,
          className: "custom-map-pin",
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        });

        const m = L.marker([lat, lng], { icon: customIcon }).addTo(this.markersLayer);
        m.bindPopup(`
          <div class="p-1">
            <h4 class="font-bold text-sm">${iss.title}</h4>
            <p class="text-xs text-gray-500 mt-0.5">${iss.category} • Priority: <span class="font-bold">${iss.priority_level} (${iss.priority_score})</span></p>
            <p class="text-xs text-gray-500">Reports: ${iss.report_count} • Status: ${iss.status}</p>
            <button onclick="Admin.openIssueDetails('${iss.id}')" class="mt-2 text-xs bg-blue-600 text-white px-2 py-1 rounded font-medium">Manage Issue</button>
          </div>
        `);
      });

      if (bounds.length > 0) {
        this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
      }
    } catch (err) {
      console.error("Map load error:", err);
    }
  },

  async loadIssues() {
    const tableBody = document.getElementById("admin-issues-table-body");
    tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400">Loading issues...</td></tr>`;

    const status = document.getElementById("filter-status")?.value || "";
    const category = document.getElementById("filter-category")?.value || "";
    const priority = document.getElementById("filter-priority")?.value || "";
    const search = document.getElementById("filter-search")?.value.trim() || "";

    const params = {};
    if (status) params.status = status;
    if (category) params.category = category;
    if (priority) params.priority = priority;
    if (search) params.search = search;

    try {
      const res = await Api.getIssues(params);
      this.currentIssues = res.issues || [];

      if (this.currentIssues.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400">No issues matching filters.</td></tr>`;
        return;
      }

      tableBody.innerHTML = this.currentIssues.map((iss) => {
        const priorityBadges = {
          CRITICAL: "bg-rose-100 text-rose-800 border-rose-200",
          HIGH: "bg-orange-100 text-orange-800 border-orange-200",
          MEDIUM: "bg-amber-100 text-amber-800 border-amber-200",
          LOW: "bg-blue-100 text-blue-800 border-blue-200"
        };
        const statusBadges = {
          REPORTED: "bg-blue-50 text-blue-700",
          PENDING: "bg-amber-50 text-amber-700",
          ASSIGNED: "bg-purple-50 text-purple-700",
          IN_PROGRESS: "bg-indigo-50 text-indigo-700",
          RESOLVED: "bg-emerald-50 text-emerald-700"
        };

        const pBadge = priorityBadges[iss.priority_level] || "bg-slate-100 text-slate-700";
        const sBadge = statusBadges[iss.status] || "bg-slate-100 text-slate-700";
        const dateStr = new Date(iss.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

        return `
          <tr class="hover:bg-slate-50 transition border-b border-slate-100 cursor-pointer" onclick="Admin.openIssueDetails('${iss.id}')">
            <td class="py-3.5 px-4 font-mono text-xs text-slate-500">${iss.id}</td>
            <td class="py-3.5 px-4">
              <div class="font-medium text-slate-900">${iss.title}</div>
              <div class="text-xs text-slate-400">${iss.address || `${iss.latitude.toFixed(3)}, ${iss.longitude.toFixed(3)}`}</div>
            </td>
            <td class="py-3.5 px-4">
              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-800 capitalize">
                ${iss.category.replace("_", " ")}
              </span>
            </td>
            <td class="py-3.5 px-4">
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${pBadge}">
                ${iss.priority_level} (${iss.priority_score})
              </span>
            </td>
            <td class="py-3.5 px-4">
              <span class="inline-flex items-center gap-1 font-semibold text-xs text-slate-700 bg-slate-100 px-2 py-1 rounded">
                ${iss.report_count} ${iss.report_count > 1 ? '<span class="text-xs text-amber-600 font-bold">(Duplicate cluster)</span>' : ''}
              </span>
            </td>
            <td class="py-3.5 px-4">
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${sBadge}">
                ${iss.status}
              </span>
            </td>
            <td class="py-3.5 px-4 text-right">
              <button class="text-xs font-semibold text-blue-600 hover:text-blue-800 px-2.5 py-1 bg-blue-50 rounded">
                Manage
              </button>
            </td>
          </tr>
        `;
      }).join("");
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-rose-500">${err.message}</td></tr>`;
    }
  },

  async openIssueDetails(issueId) {
    this.selectedIssueId = issueId;
    const drawer = document.getElementById("issue-detail-drawer");
    drawer.classList.remove("hidden");

    const contentEl = document.getElementById("drawer-content");
    contentEl.innerHTML = `<div class="p-8 text-center text-slate-400">Loading issue details...</div>`;

    try {
      const res = await Api.getIssueDetails(issueId);
      const iss = res.issue;

      contentEl.innerHTML = `
        <div class="space-y-6">
          <!-- Header -->
          <div class="flex items-start justify-between border-b pb-4">
            <div>
              <span class="text-xs font-mono text-slate-400">${iss.id}</span>
              <h3 class="text-xl font-bold text-slate-900 mt-1">${iss.title}</h3>
              <p class="text-xs text-slate-500 mt-1">${iss.address || `Lat ${iss.latitude}, Lon ${iss.longitude}`}</p>
            </div>
            <div class="text-right">
              <span class="px-3 py-1 rounded-full text-xs font-bold ${iss.status === 'RESOLVED' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}">
                ${iss.status}
              </span>
              <div class="text-xs font-bold text-slate-500 mt-2">Priority: ${iss.priority_level} (${iss.priority_score}/100)</div>
            </div>
          </div>

          <!-- Quick Actions & Status Progression -->
          <div class="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Lifecycle Actions</h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-slate-700 mb-1">Update Status</label>
                <select id="action-status-select" class="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white font-medium">
                  <option value="REPORTED" ${iss.status === 'REPORTED' ? 'selected' : ''}>REPORTED</option>
                  <option value="PENDING" ${iss.status === 'PENDING' ? 'selected' : ''}>PENDING</option>
                  <option value="ASSIGNED" ${iss.status === 'ASSIGNED' ? 'selected' : ''}>ASSIGNED</option>
                  <option value="IN_PROGRESS" ${iss.status === 'IN_PROGRESS' ? 'selected' : ''}>IN PROGRESS</option>
                </select>
                <button onclick="Admin.updateStatus()" class="mt-2 w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg">Save Status</button>
              </div>

              <div>
                <label class="block text-xs font-medium text-slate-700 mb-1">Assign Responsible Staff</label>
                <input id="action-assignee-input" type="text" value="${iss.assigned_to || ''}" placeholder="Technician / Officer name" class="w-full text-xs border border-slate-300 rounded-lg p-2 bg-white">
                <button onclick="Admin.assignStaff()" class="mt-2 w-full py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-medium rounded-lg">Assign</button>
              </div>
            </div>

            <!-- Resolution Button -->
            ${iss.status !== 'RESOLVED' ? `
              <div class="mt-4 pt-3 border-t border-slate-200">
                <button onclick="Admin.openResolveModal()" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center justify-center gap-2">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                  Resolve Issue with Evidence
                </button>
              </div>
            ` : `
              <div class="mt-4 pt-3 border-t border-slate-200">
                <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <p class="text-xs font-bold text-emerald-800">Issue Resolved</p>
                  <p class="text-xs text-emerald-700 mt-1">${iss.resolution_notes || ''}</p>
                  ${iss.resolution_image_url ? `
                    <img src="${iss.resolution_image_url}" alt="Proof" class="mt-2 h-32 rounded-md object-cover border border-emerald-300">
                  ` : ''}
                </div>
              </div>
            `}
          </div>

          <!-- Citizen Reports Linked to this Issue -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <svg class="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                Corroborating Reports (${iss.reports?.length || 0})
              </h4>
              <span class="text-[10px] text-slate-500 font-mono">Clustered within 50m</span>
            </div>
            <div class="space-y-3">
              ${(iss.reports || []).map((r, idx) => {
                let authBadge = '';
                if (r.authenticity_status === 'LIKELY_AUTHENTIC') {
                  authBadge = '<span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">✓ Authentic Capture</span>';
                } else if (r.authenticity_status === 'UNCERTAIN') {
                  authBadge = '<span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">ℹ Uncertain / Normal</span>';
                } else if (r.authenticity_status === 'REVIEW_REQUIRED') {
                  authBadge = '<span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">🔍 Review Required</span>';
                } else {
                  authBadge = '<span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-800 border border-purple-200">📋 Audit Queued</span>';
                }

                const detectionsList = r.detections || [];
                const detBadge = detectionsList.length > 0 
                  ? `<span class="text-[10px] text-slate-500 font-mono">(${detectionsList.length} bbox${detectionsList.length>1?'es':''})</span>`
                  : '';

                return `
                  <div class="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs hover:border-slate-300 transition space-y-2.5">
                    <div class="flex gap-3">
                      <img src="${r.image_url}" alt="Citizen submission" class="w-20 h-20 object-cover rounded-lg flex-shrink-0 border border-slate-200">
                      <div class="flex-1 text-xs space-y-1">
                        <div class="flex justify-between items-start">
                          <span class="font-bold text-slate-900">Submission #${idx + 1}</span>
                          <span class="text-slate-400 text-[10px]">${new Date(r.created_at).toLocaleString()}</span>
                        </div>
                        <div class="text-slate-600">
                          AI Category: <span class="font-semibold text-blue-700 uppercase">${r.ai_category}</span> (${Math.round((r.ai_confidence||0)*100)}% conf) ${detBadge}
                        </div>
                        <div class="flex items-center gap-2 pt-0.5">
                          <span class="text-slate-500 font-medium">Severity: <span class="font-bold text-slate-800">${r.severity_score}/100</span></span>
                          ${authBadge}
                        </div>
                      </div>
                    </div>
                    ${r.description ? `<p class="text-xs text-slate-600 bg-slate-50 p-2 rounded border border-slate-100 italic">"${r.description}"</p>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Audit Timeline -->
          <div>
            <h4 class="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Lifecycle Audit Trail</h4>
            <div class="space-y-2 border-l-2 border-slate-200 ml-2 pl-4">
              ${(iss.timeline || []).map(t => `
                <div class="relative text-xs">
                  <div class="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-blue-600 border-2 border-white"></div>
                  <div class="font-semibold text-slate-800">${t.to_status} <span class="font-normal text-slate-400">by ${t.actor_name}</span></div>
                  <p class="text-slate-500 mt-0.5">${t.action_notes}</p>
                  <div class="text-[10px] text-slate-400">${new Date(t.created_at).toLocaleString()}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      contentEl.innerHTML = `<div class="p-8 text-center text-rose-500">${err.message}</div>`;
    }
  },

  closeDrawer() {
    document.getElementById("issue-detail-drawer").classList.add("hidden");
    this.selectedIssueId = null;
  },

  async updateStatus() {
    if (!this.selectedIssueId) return;
    const status = document.getElementById("action-status-select").value;
    try {
      await Api.updateIssueStatus(this.selectedIssueId, status);
      showToast(`Status updated to ${status}`, "success");
      this.openIssueDetails(this.selectedIssueId);
      this.loadIssues();
      this.loadMapMarkers();
      this.loadAnalytics();
    } catch (err) {
      showToast(err.message, "error");
    }
  },

  async assignStaff() {
    if (!this.selectedIssueId) return;
    const assignee = document.getElementById("action-assignee-input").value.trim();
    if (!assignee) {
      showToast("Please enter technician or staff name", "warning");
      return;
    }

    try {
      await Api.assignIssue(this.selectedIssueId, assignee, "Public Works Department");
      showToast(`Assigned to ${assignee}`, "success");
      this.openIssueDetails(this.selectedIssueId);
      this.loadIssues();
    } catch (err) {
      showToast(err.message, "error");
    }
  },

  openResolveModal() {
    document.getElementById("resolve-modal").classList.remove("hidden");
  },

  closeResolveModal() {
    document.getElementById("resolve-modal").classList.add("hidden");
  },

  async handleResolveSubmit(e) {
    e.preventDefault();
    if (!this.selectedIssueId) return;

    const notes = document.getElementById("resolve-notes").value.trim();
    const photoFile = document.getElementById("resolve-photo-input").files[0];

    if (!notes) {
      showToast("Please enter resolution remarks", "warning");
      return;
    }

    const formData = new FormData();
    formData.append("resolution_notes", notes);
    if (photoFile) {
      formData.append("resolution_image", photoFile);
    }

    try {
      await Api.resolveIssue(this.selectedIssueId, formData);
      showToast("Issue successfully resolved and verified!", "success");
      this.closeResolveModal();
      this.openIssueDetails(this.selectedIssueId);
      this.loadIssues();
      this.loadMapMarkers();
      this.loadAnalytics();
    } catch (err) {
      showToast(err.message, "error");
    }
  },

  bindEvents() {
    document.getElementById("filter-status")?.addEventListener("change", () => this.loadIssues());
    document.getElementById("filter-category")?.addEventListener("change", () => this.loadIssues());
    document.getElementById("filter-priority")?.addEventListener("change", () => this.loadIssues());
    document.getElementById("filter-search")?.addEventListener("input", () => this.loadIssues());
    document.getElementById("resolve-form")?.addEventListener("submit", (e) => this.handleResolveSubmit(e));
  }
};

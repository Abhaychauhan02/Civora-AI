// ==========================================================================
// CIVORA ADMIN OPERATIONS & TRIAGE CONTROLLER
// High-density Operations Dashboard, Leaflet GIS Markers,
// Sub-view Routing, Data Table Triage & Slide-over Inspection Drawer
// ==========================================================================

const Admin = {
  map: null,
  fullMap: null,
  markersLayer: null,
  fullMarkersLayer: null,
  currentIssues: [],
  filteredIssues: [],
  selectedIssueId: null,
  currentSubView: "overview",
  page: 1,
  pageSize: 10,

  init() {
    this.initMaps();
  },

  initMaps() {
    // 1. Overview split map
    const mapEl = document.getElementById("admin-map");
    if (mapEl && !this.map) {
      this.map = L.map("admin-map").setView([28.6139, 77.2090], 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors"
      }).addTo(this.map);
      this.markersLayer = L.layerGroup().addTo(this.map);
    }

    // 2. Full GIS map
    const fullMapEl = document.getElementById("live-full-map");
    if (fullMapEl && !this.fullMap) {
      this.fullMap = L.map("live-full-map").setView([28.6139, 77.2090], 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors"
      }).addTo(this.fullMap);
      this.fullMarkersLayer = L.layerGroup().addTo(this.fullMap);
    }
  },

  switchSubView(viewId) {
    this.currentSubView = viewId;

    const views = ["overview", "live-map", "reports", "issues", "work-orders", "alerts", "analytics", "team", "settings"];
    views.forEach(v => {
      const el = document.getElementById(`subview-${v}`);
      const navBtn = document.getElementById(`admin-nav-${v}`);
      if (el) {
        if (v === viewId) el.classList.remove("hidden");
        else el.classList.add("hidden");
      }
      if (navBtn) {
        if (v === viewId) {
          navBtn.className = "w-full flex items-center justify-between px-3 py-2 rounded-lg font-semibold bg-slate-100 text-slate-900 transition";
        } else {
          navBtn.className = "w-full flex items-center justify-between px-3 py-2 rounded-lg font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition";
        }
      }
    });

    // Titles
    const titleConfig = {
      overview: { title: "Operations Overview", desc: "Real-time civic intelligence, incoming incident triage & spatial dispatch" },
      "live-map": { title: "Geospatial Operations Canvas", desc: "Full-viewport GIS monitoring of active civic defect coordinates" },
      reports: { title: "Citizen Submissions Feed", desc: "Ingested raw citizen reports with AI detections and authenticity flags" },
      issues: { title: "Active Deduplicated Incidents", desc: "Consolidated parent defects aggregating corroborating citizen reports" },
      "work-orders": { title: "Field Technician Work Orders", desc: "Dispatched maintenance tasks organized by departmental crew" },
      alerts: { title: "High-Risk Safety Alerts & SLA", desc: "Critical severity hazards requiring emergency municipal containment" },
      analytics: { title: "Municipal Analytics & Performance", desc: "Resolution velocity, hazard distribution, and SLA adherence" },
      team: { title: "Municipal Maintenance Directory", desc: "Rosters and technical leads across infrastructure divisions" },
      settings: { title: "System Operational Settings", desc: "YOLOv8 vision thresholds, deduplication radius, and DB configurations" }
    };

    const c = titleConfig[viewId] || titleConfig.overview;
    document.getElementById("admin-page-title").textContent = c.title;
    document.getElementById("admin-page-desc").textContent = c.desc;

    if (viewId === "live-map" && this.fullMap) {
      setTimeout(() => this.fullMap.invalidateSize(), 150);
    }
  },

  async loadDashboard() {
    const isAuthed = Auth.currentUser && Auth.currentUser.role === "ADMIN";
    const warningEl = document.getElementById("admin-auth-warning");
    const contentEl = document.getElementById("admin-content");

    if (!isAuthed) {
      if (warningEl) warningEl.classList.remove("hidden");
      if (contentEl) contentEl.classList.add("hidden");
      return;
    }

    if (warningEl) warningEl.classList.add("hidden");
    if (contentEl) contentEl.classList.remove("hidden");

    // Set operator avatar
    const avatarEl = document.getElementById("admin-operator-avatar");
    const nameEl = document.getElementById("admin-operator-name");
    if (avatarEl) avatarEl.textContent = (Auth.currentUser.name || "A").slice(0, 2).toUpperCase();
    if (nameEl) nameEl.textContent = Auth.currentUser.name || "Municipal Admin";

    await Promise.all([
      this.loadAnalytics(),
      this.loadIssues(),
      this.loadMapMarkers()
    ]);
  },

  async loadAnalytics() {
    try {
      const res = await Api.getAdminAnalytics();
      const s = res.summary || {};

      if (document.getElementById("stat-total-reports")) document.getElementById("stat-total-reports").textContent = s.total_reports || 0;
      if (document.getElementById("stat-total-issues")) document.getElementById("stat-total-issues").textContent = s.total_unique_issues || s.total_issues || 0;
      if (document.getElementById("stat-unresolved-issues")) document.getElementById("stat-unresolved-issues").textContent = s.unresolved_issues !== undefined ? s.unresolved_issues : 0;
      if (document.getElementById("stat-resolved-issues")) document.getElementById("stat-resolved-issues").textContent = s.resolved_issues !== undefined ? s.resolved_issues : (s.resolved_count || 0);
      if (document.getElementById("stat-unassigned-issues")) document.getElementById("stat-unassigned-issues").textContent = s.unassigned_issues !== undefined ? s.unassigned_issues : (s.pending_count || 0);
      if (document.getElementById("stat-dupes-prevented")) document.getElementById("stat-dupes-prevented").textContent = s.corroborating_reports !== undefined ? s.corroborating_reports : (s.duplicates_prevented || 0);
      if (document.getElementById("stat-awaiting-review")) document.getElementById("stat-awaiting-review").textContent = s.awaiting_review_reports !== undefined ? s.awaiting_review_reports : 0;
      if (document.getElementById("stat-unclassified")) document.getElementById("stat-unclassified").textContent = s.unclassified_submissions !== undefined ? s.unclassified_submissions : 0;

      if (document.getElementById("stat-critical-count")) document.getElementById("stat-critical-count").textContent = s.critical_count || 0;
      if (document.getElementById("stat-pending-count")) document.getElementById("stat-pending-count").textContent = s.pending_count || 0;
      if (document.getElementById("stat-avg-hours")) document.getElementById("stat-avg-hours").textContent = s.avg_resolution_hours ? `${s.avg_resolution_hours}h` : "N/A";

      // Badges
      const badgeReports = document.getElementById("badge-sidebar-reports");
      const badgeIssues = document.getElementById("badge-sidebar-issues");
      const badgeCritical = document.getElementById("badge-sidebar-critical");

      if (badgeReports) badgeReports.textContent = s.total_reports || 0;
      if (badgeIssues) badgeIssues.textContent = s.total_issues || 0;
      if (badgeCritical) badgeCritical.textContent = s.critical_count || 0;

      // Needs attention bar
      const attnCritical = document.getElementById("attention-critical-count");
      const attnText = document.getElementById("attention-summary-text");
      if (attnCritical) attnCritical.textContent = `${s.critical_count || 0} CRITICAL`;
      if (attnText) {
        attnText.textContent = `${s.pending_count || 0} pending incidents and ${s.critical_count || 0} critical hazards require operational dispatch.`;
      }

      // Analytics View Breakdowns
      this.renderAnalyticsBreakdowns(res);

    } catch (err) {
      console.error("Analytics fetch error:", err);
    }
  },

  renderAnalyticsBreakdowns(data) {
    const statusEl = document.getElementById("analytics-status-breakdown");
    const catEl = document.getElementById("analytics-category-breakdown");
    const prioEl = document.getElementById("analytics-priority-breakdown");

    if (statusEl && data.by_status) {
      statusEl.innerHTML = Object.entries(data.by_status).map(([k, v]) => `
        <div class="flex items-center justify-between py-1 border-b border-slate-100">
          <span class="font-medium text-slate-700">${k}</span>
          <span class="font-mono font-bold bg-slate-100 px-2 py-0.5 rounded">${v}</span>
        </div>
      `).join("");
    }

    if (catEl && data.by_category) {
      catEl.innerHTML = Object.entries(data.by_category).map(([k, v]) => `
        <div class="flex items-center justify-between py-1 border-b border-slate-100">
          <span class="font-medium text-slate-700 capitalize">${k.replace("_", " ")}</span>
          <span class="font-mono font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded">${v}</span>
        </div>
      `).join("");
    }

    if (prioEl && data.by_priority) {
      prioEl.innerHTML = Object.entries(data.by_priority).map(([k, v]) => `
        <div class="flex items-center justify-between py-1 border-b border-slate-100">
          <span class="font-medium text-slate-700">${k}</span>
          <span class="font-mono font-bold bg-amber-50 text-amber-700 px-2 py-0.5 rounded">${v}</span>
        </div>
      `).join("");
    }
  },

  async loadMapMarkers() {
    if (!this.map || !this.markersLayer) return;
    this.markersLayer.clearLayers();
    if (this.fullMarkersLayer) this.fullMarkersLayer.clearLayers();

    try {
      const res = await Api.getMapIssues();
      const issues = res.issues || [];
      const bounds = [];

      issues.forEach((iss) => {
        const lat = iss.latitude;
        const lng = iss.longitude;
        if (!lat || !lng) return;

        bounds.push([lat, lng]);

        let markerClass = "marker-low";
        if (iss.status === "RESOLVED") markerClass = "marker-resolved";
        else if (iss.priority_level === "CRITICAL") markerClass = "marker-critical";
        else if (iss.priority_level === "HIGH") markerClass = "marker-high";
        else if (iss.priority_level === "MEDIUM") markerClass = "marker-medium";

        const iconHtml = `
          <div class="custom-civora-marker ${markerClass}">
            <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          </div>
        `;

        const customIcon = L.divIcon({
          html: iconHtml,
          className: "leaflet-civora-pin",
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });

        const popupContent = `
          <div class="p-2 space-y-1.5 min-w-[200px]">
            <div class="flex items-center justify-between">
              <span class="font-bold text-xs text-slate-900">${iss.title || "Civic Defect"}</span>
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${iss.priority_level === 'CRITICAL' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-800'}">${iss.priority_level}</span>
            </div>
            <p class="text-[11px] text-slate-500">${iss.category} • Status: <span class="font-bold">${iss.status}</span></p>
            <p class="text-[10px] text-slate-400">Reports: ${iss.report_count || 1}</p>
            <button onclick="Admin.openDrawer('${iss.id}')" class="w-full mt-2 py-1 px-2 bg-slate-900 text-white rounded text-xs font-bold hover:bg-slate-800 transition">
              Inspect in Drawer
            </button>
          </div>
        `;

        const m = L.marker([lat, lng], { icon: customIcon }).bindPopup(popupContent);
        m.addTo(this.markersLayer);

        if (this.fullMarkersLayer) {
          const mFull = L.marker([lat, lng], { icon: customIcon }).bindPopup(popupContent);
          mFull.addTo(this.fullMarkersLayer);
        }
      });

      if (bounds.length > 0) {
        this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
        if (this.fullMap) this.fullMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
      }

    } catch (err) {
      console.error("Map markers load error:", err);
    }
  },

  async loadIssues() {
    try {
      const res = await Api.getIssues({ limit: 150 });
      this.currentIssues = res.issues || [];
      this.filteredIssues = [...this.currentIssues];

      this.renderPriorityList();
      this.renderIssuesTable();
      this.renderSubViewsData();

    } catch (err) {
      console.error("Load issues error:", err);
    }
  },

  renderPriorityList() {
    const listEl = document.getElementById("high-priority-list");
    const countEl = document.getElementById("priority-queue-count");
    if (!listEl) return;

    // Filter for CRITICAL and HIGH priorities
    const highPrio = this.currentIssues.filter(i => i.priority_level === "CRITICAL" || i.priority_level === "HIGH");
    if (countEl) countEl.textContent = `${highPrio.length} items`;

    if (highPrio.length === 0) {
      listEl.innerHTML = `<div class="p-6 text-center text-xs text-slate-400">No high-priority hazards currently queued.</div>`;
      return;
    }

    listEl.innerHTML = highPrio.slice(0, 6).map(iss => {
      const pCls = iss.priority_level === "CRITICAL" ? "badge-priority-critical" : "badge-priority-high";
      const sCls = iss.status === "RESOLVED" ? "chip-status-resolved" : (iss.status === "IN_PROGRESS" ? "chip-status-in-progress" : "chip-status-pending");

      return `
        <div class="p-3 rounded-lg hover:bg-slate-50 transition border border-transparent hover:border-slate-200 cursor-pointer flex items-center justify-between gap-3" onclick="Admin.openDrawer('${iss.id}')">
          <div class="min-w-0 flex-1 space-y-0.5">
            <div class="flex items-center gap-2">
              <span class="badge-priority ${pCls}">${iss.priority_level}</span>
              <h4 class="font-bold text-xs text-slate-900 truncate">${iss.title || iss.category}</h4>
            </div>
            <p class="text-[11px] text-slate-500 truncate flex items-center gap-1">
              <svg class="w-3 h-3 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>
              <span>${iss.address || "Coordinates logged"}</span>
            </p>
          </div>
          <div class="flex flex-col items-end gap-1 shrink-0">
            <span class="chip-status ${sCls}">${iss.status}</span>
            <span class="text-[10px] text-slate-400 font-mono">${iss.report_count || 1} reports</span>
          </div>
        </div>
      `;
    }).join("");
  },

  renderIssuesTable() {
    const tbody = document.getElementById("issues-table-body");
    const pageInfo = document.getElementById("pagination-info");
    const prevBtn = document.getElementById("btn-prev-page");
    const nextBtn = document.getElementById("btn-next-page");

    if (!tbody) return;

    const total = this.filteredIssues.length;
    const start = (this.page - 1) * this.pageSize;
    const end = Math.min(start + this.pageSize, total);
    const pageItems = this.filteredIssues.slice(start, end);

    if (pageInfo) pageInfo.textContent = `Showing ${total > 0 ? start + 1 : 0}-${end} of ${total} issues`;
    if (prevBtn) prevBtn.disabled = this.page <= 1;
    if (nextBtn) nextBtn.disabled = end >= total;

    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="px-6 py-8 text-center text-slate-400">No matching issues found.</td></tr>`;
      return;
    }

    tbody.innerHTML = pageItems.map(iss => {
      const displayId = iss.id ? (iss.id.startsWith("iss_") ? iss.id.replace("iss_", "") : iss.id) : "00";
      const pCls = iss.priority_level === "CRITICAL" ? "badge-priority-critical" : (iss.priority_level === "HIGH" ? "badge-priority-high" : (iss.priority_level === "MEDIUM" ? "badge-priority-medium" : "badge-priority-low"));
      const sCls = iss.status === "RESOLVED" ? "chip-status-resolved" : (iss.status === "IN_PROGRESS" ? "chip-status-in-progress" : (iss.status === "ASSIGNED" ? "chip-status-assigned" : "chip-status-pending"));

      const timeAgo = this.formatTimeAgo(iss.created_at);

      return `
        <tr class="hover:bg-slate-50/70 transition">
          <td class="px-6 py-3 font-mono font-bold text-slate-900">#ISS-${displayId}</td>
          <td class="px-4 py-3 capitalize font-semibold text-slate-800">${(iss.category || "General Hazard").replace("_", " ")}</td>
          <td class="px-4 py-3 text-slate-600 max-w-xs truncate" title="${iss.address || ''}">
            ${iss.address || `GPS: ${iss.latitude.toFixed(4)}, ${iss.longitude.toFixed(4)}`}
          </td>
          <td class="px-4 py-3">
            <span class="badge-priority ${pCls}">${iss.priority_level}</span>
          </td>
          <td class="px-4 py-3">
            <span class="chip-status ${sCls}">${iss.status}</span>
          </td>
          <td class="px-4 py-3 font-mono text-slate-600">${iss.report_count || 1}</td>
          <td class="px-4 py-3 text-slate-400 font-mono">${timeAgo}</td>
          <td class="px-6 py-3 text-right">
            <button onclick="Admin.openDrawer('${iss.id}')" class="px-2.5 py-1 text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition shadow-2xs">
              Inspect
            </button>
          </td>
        </tr>
      `;
    }).join("");
  },

  async renderSubViewsData() {
    // 1. Citizen reports list - Fetch real raw citizen reports
    const repEl = document.getElementById("all-reports-container");
    if (repEl) {
      repEl.innerHTML = `<div class="p-6 text-center text-xs text-slate-400">Loading citizen submission feed...</div>`;
      try {
        const res = await Api.getAdminReports({ limit: 100 });
        const reports = res.reports || [];
        if (reports.length === 0) {
          repEl.innerHTML = `<div class="p-8 text-center text-xs text-slate-400">No citizen submissions recorded yet.</div>`;
        } else {
          repEl.innerHTML = reports.map(r => {
            const timeAgo = this.formatTimeAgo(r.created_at);
            const confText = r.ai_confidence !== null && r.ai_confidence !== undefined
              ? `${Math.round(r.ai_confidence * 100)}% conf`
              : "Manual Triage";
            const authClass = r.authenticity_status === "SUSPICIOUS" ? "bg-red-100 text-red-800 border-red-200" : (r.authenticity_status === "REVIEW_REQUIRED" ? "bg-blue-100 text-blue-800 border-blue-200" : "bg-emerald-100 text-emerald-800 border-emerald-200");

            return `
              <div class="p-4 bg-white border border-slate-200/90 rounded-xl shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs hover:border-slate-300 transition">
                <div class="flex items-center gap-3.5 min-w-0">
                  <div class="w-14 h-14 bg-slate-100 rounded-lg overflow-hidden shrink-0 border border-slate-200 cursor-pointer" onclick="Admin.openReportDetail('${r.id}')">
                    <img src="${r.image_url}" alt="Report" class="w-full h-full object-cover hover:scale-105 transition" />
                  </div>
                  <div class="space-y-0.5 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-mono font-bold text-slate-400 text-[11px]">#REP-${r.id}</span>
                      <span class="font-extrabold text-slate-900 capitalize">${(r.ai_category || "Civic Defect").replace(/_/g, " ")}</span>
                      <span class="text-[10px] font-mono font-bold bg-blue-50 text-blue-700 px-1.5 py-0.2 rounded border border-blue-100">${confText}</span>
                      <span class="text-[9px] font-bold px-1.5 py-0.2 rounded-full border ${authClass}">${r.authenticity_status || "LIKELY_AUTHENTIC"}</span>
                    </div>
                    <p class="text-slate-600 text-[11px] truncate">${r.address || `GPS: ${r.latitude ? r.latitude.toFixed(4) : "0.0000"}, ${r.longitude ? r.longitude.toFixed(4) : "0.0000"}`}</p>
                    <div class="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                      <span>${timeAgo}</span>
                      <span>•</span>
                      <span>By: <strong class="text-slate-600">${r.reporter_name || "Citizen"}</strong></span>
                      <span>•</span>
                      <button onclick="Admin.openDrawer('${r.issue_id}')" class="text-blue-600 font-bold hover:underline">Parent: #${r.issue_id}</button>
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <button onclick="Admin.openReportDetail('${r.id}')" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition text-xs shadow-2xs">
                    Inspect Report
                  </button>
                  <button onclick="Admin.openDrawer('${r.issue_id}')" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold transition text-xs">
                    Parent Issue
                  </button>
                </div>
              </div>
            `;
          }).join("");
        }
      } catch (err) {
        console.error("Failed to load admin reports:", err);
        repEl.innerHTML = `<div class="p-4 text-center text-xs text-rose-600">Failed to load reports feed.</div>`;
      }
    }

    // 2. Active Deduplicated Issues
    const activeEl = document.getElementById("active-issues-container");
    if (activeEl) {
      activeEl.innerHTML = this.currentIssues.map(iss => `
        <div class="p-4 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between text-xs">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-mono font-bold text-slate-900">#ISS-${iss.id}</span>
              <span class="font-extrabold text-sm text-slate-900">${iss.title}</span>
              <span class="badge-priority badge-priority-medium">${iss.priority_level}</span>
            </div>
            <p class="text-slate-500 mt-1">${iss.address || `GPS: ${iss.latitude}, ${iss.longitude}`}</p>
          </div>
          <button onclick="Admin.openDrawer('${iss.id}')" class="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-bold hover:bg-slate-800 transition">Manage Incident</button>
        </div>
      `).join("");
    }

    // 3. Work Orders
    const woEl = document.getElementById("work-orders-container");
    if (woEl) {
      const inProg = this.currentIssues.filter(i => i.status === "ASSIGNED" || i.status === "IN_PROGRESS");
      woEl.innerHTML = inProg.length > 0 ? inProg.map(iss => `
        <div class="p-4 bg-white border border-slate-200 rounded-xl shadow-xs space-y-2 text-xs">
          <div class="flex items-center justify-between">
            <span class="font-mono font-bold text-slate-900">#WO-${iss.id}</span>
            <span class="chip-status chip-status-in-progress">${iss.status}</span>
          </div>
          <h4 class="font-bold text-slate-900">${iss.title}</h4>
          <p class="text-slate-500 text-[11px]">${iss.address || "On-site"}</p>
          <div class="pt-2 border-t border-slate-100 flex items-center justify-between">
            <span class="text-slate-400">Assigned: <strong class="text-slate-700">${iss.assigned_to || "Public Works"}</strong></span>
            <button onclick="Admin.openDrawer('${iss.id}')" class="text-blue-600 font-bold hover:underline">Update</button>
          </div>
        </div>
      `).join("") : `<div class="col-span-3 text-center py-8 text-slate-400">No active dispatched work orders.</div>`;
    }

    // 4. Alerts
    const alertEl = document.getElementById("alerts-list-container");
    if (alertEl) {
      const criticals = this.currentIssues.filter(i => i.priority_level === "CRITICAL");
      alertEl.innerHTML = criticals.length > 0 ? criticals.map(iss => `
        <div class="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between text-xs">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center font-bold text-xs shrink-0">!</div>
            <div>
              <span class="font-extrabold text-rose-900 text-sm">${iss.title}</span>
              <p class="text-rose-700 text-[11px]">${iss.address || "High-risk location"} • Score: ${iss.priority_score}</p>
            </div>
          </div>
          <button onclick="Admin.openDrawer('${iss.id}')" class="px-3 py-1.5 bg-rose-600 text-white font-bold rounded-lg hover:bg-rose-700 transition">Immediate Action</button>
        </div>
      `).join("") : `<div class="text-center py-8 text-slate-400">No active critical hazard alerts. All clear.</div>`;
    }
  },

  applyFilters() {
    const cat = document.getElementById("filter-category").value;
    const stat = document.getElementById("filter-status").value;
    const prio = document.getElementById("filter-priority").value;
    const search = document.getElementById("admin-global-search").value.toLowerCase().trim();

    this.filteredIssues = this.currentIssues.filter(iss => {
      if (cat !== "ALL" && iss.category !== cat) return false;
      if (stat !== "ALL" && iss.status !== stat) return false;
      if (prio !== "ALL" && iss.priority_level !== prio) return false;
      if (search) {
        const matchTitle = (iss.title || "").toLowerCase().includes(search);
        const matchAddr = (iss.address || "").toLowerCase().includes(search);
        const matchId = iss.id.toString().includes(search);
        if (!matchTitle && !matchAddr && !matchId) return false;
      }
      return true;
    });

    this.page = 1;
    this.renderIssuesTable();
  },

  handleSearch(event) {
    this.applyFilters();
  },

  filterUnassigned() {
    const statSelect = document.getElementById("filter-status");
    if (statSelect) {
      statSelect.value = "PENDING";
      this.applyFilters();
    }
  },

  prevPage() {
    if (this.page > 1) {
      this.page--;
      this.renderIssuesTable();
    }
  },

  nextPage() {
    const totalPages = Math.ceil(this.filteredIssues.length / this.pageSize);
    if (this.page < totalPages) {
      this.page++;
      this.renderIssuesTable();
    }
  },

  formatTimeAgo(dateStr) {
    if (!dateStr) return "Just now";
    const sec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  },

  // Slide-Over Detail Drawer
  async openDrawer(issueId) {
    this.selectedIssueId = issueId;
    const backdrop = document.getElementById("drawer-backdrop");
    const drawer = document.getElementById("issue-detail-drawer");

    if (backdrop && drawer) {
      backdrop.classList.add("open");
      drawer.classList.add("open");
    }

    try {
      const res = await Api.getIssueDetails(issueId);
      const iss = res.issue || {};
      const reports = res.reports || [];
      const displayId = iss.id ? (iss.id.startsWith("iss_") ? iss.id.replace("iss_", "") : iss.id) : "00";

      document.getElementById("drawer-issue-id").textContent = `#ISS-${displayId}`;
      document.getElementById("drawer-title").textContent = iss.title || iss.category;
      document.getElementById("drawer-address").textContent = iss.address || `GPS: ${iss.latitude.toFixed(5)}, ${iss.longitude.toFixed(5)}`;
      document.getElementById("drawer-status-chip").textContent = iss.status;
      document.getElementById("drawer-priority-badge").textContent = iss.priority_level;
      document.getElementById("drawer-select-status").value = iss.status || "PENDING";
      const deptSelect = document.getElementById("drawer-select-dept");
      if (deptSelect && iss.assigned_department) {
        deptSelect.value = iss.assigned_department;
      }
      document.getElementById("drawer-child-count").textContent = `${reports.length} reports`;

      // Render Child Citizen Reports
      const childContainer = document.getElementById("drawer-child-reports");
      if (childContainer) {
        childContainer.innerHTML = reports.map(r => {
          const confLabel = r.ai_confidence !== null && r.ai_confidence !== undefined
            ? `${Math.round(r.ai_confidence * 100)}% conf`
            : "Manual Triage";
          const authClass = r.authenticity_status === "SUSPICIOUS" ? "bg-red-100 text-red-800" : (r.authenticity_status === "REVIEW_REQUIRED" ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800");

          return `
            <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <div class="flex items-start justify-between">
                <div>
                  <span class="font-mono text-[10px] font-bold text-slate-400">#REP-${r.id}</span>
                  <div class="font-bold text-slate-800 text-xs">${r.ai_category ? r.ai_category.toUpperCase() : "CIVIC DEFECT"} (${confLabel})</div>
                </div>
                <span class="text-[9px] font-bold px-2 py-0.5 rounded-full ${authClass}">
                  ${r.authenticity_status || 'LIKELY_AUTHENTIC'}
                </span>
              </div>

              <div class="flex gap-3">
                <a href="${r.image_url}" target="_blank" title="Click to open original high-res photograph" class="w-20 h-20 bg-slate-200 rounded-lg overflow-hidden shrink-0 border border-slate-300 block hover:opacity-90 transition">
                  <img src="${r.image_url}" alt="Report Photo" class="w-full h-full object-cover" />
                </a>
                <div class="flex-1 space-y-1 text-[11px] text-slate-500">
                  <p class="font-medium text-slate-700">${r.address || "GPS geotagged"}</p>
                  ${r.description ? `<p class="italic text-slate-600 bg-white p-1.5 rounded border border-slate-200">"${r.description}"</p>` : ""}
                  <p class="text-[10px] text-slate-400 font-mono">${new Date(r.created_at).toLocaleString()}</p>
                </div>
              </div>
            </div>
          `;
        }).join("");
      }

    } catch (err) {
      console.error("Open drawer failed:", err);
      showToast("Could not load issue details.", "error");
    }
  },

  closeDrawer(event) {
    if (event && event.target.id !== "drawer-backdrop" && event.target.tagName !== "BUTTON" && !event.target.closest("button")) {
      return;
    }
    const backdrop = document.getElementById("drawer-backdrop");
    const drawer = document.getElementById("issue-detail-drawer");
    if (backdrop && drawer) {
      backdrop.classList.remove("open");
      drawer.classList.remove("open");
    }
    this.selectedIssueId = null;
  },

  async updateIssueStatusAndAssignment() {
    if (!this.selectedIssueId) return;

    const newStatus = document.getElementById("drawer-select-status").value;
    const newDept = document.getElementById("drawer-select-dept").value;

    try {
      await Api.updateIssueStatus(this.selectedIssueId, newStatus);
      await Api.assignIssue(this.selectedIssueId, "Field Unit", newDept);

      showToast("Issue status and dispatch department updated!", "success");
      this.closeDrawer();
      this.loadDashboard();

    } catch (err) {
      console.error("Update failed:", err);
      showToast(err.message || "Failed to update issue.", "error");
    }
  },

  openResolveModal() {
    const modal = document.getElementById("modal-resolve-issue");
    if (modal) modal.classList.remove("hidden");
  },

  closeResolveModal() {
    const modal = document.getElementById("modal-resolve-issue");
    if (modal) modal.classList.add("hidden");
  },

  async submitResolutionProof() {
    if (!this.selectedIssueId) return;

    const notes = document.getElementById("resolve-notes").value.trim();
    const fileInput = document.getElementById("resolve-image");
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;

    if (!notes) {
      showToast("Please provide resolution notes describing the repair.", "warning");
      return;
    }

    const formData = new FormData();
    formData.append("resolution_notes", notes);
    if (file) {
      formData.append("resolution_image", file);
    }

    try {
      await Api.resolveIssue(this.selectedIssueId, formData);
      showToast("Issue verified and marked RESOLVED!", "success");
      this.closeResolveModal();
      this.closeDrawer();
      this.loadDashboard();

    } catch (err) {
      console.error("Resolve failed:", err);
      showToast(err.message || "Failed to mark issue resolved.", "error");
    }
  },

  // =========================================================================
  // DEDICATED REPORT INSPECTION & BOUNDING BOX VIEWER
  // =========================================================================
  currentReportDetail: null,
  repZoomLevel: 1.0,
  showRepBBoxes: true,

  async openReportDetail(reportId) {
    const modal = document.getElementById("modal-report-detail");
    if (!modal) return;
    modal.classList.remove("hidden");

    this.repZoomLevel = 1.0;
    this.showRepBBoxes = true;
    const zoomWrapper = document.getElementById("rep-img-zoom-wrapper");
    if (zoomWrapper) zoomWrapper.style.transform = "scale(1.0)";

    document.getElementById("rep-detail-id").textContent = `#REP-${reportId}`;
    document.getElementById("rep-detail-timestamp").textContent = "Loading incident details...";
    document.getElementById("rep-reporter-name").textContent = "Retrieving...";

    try {
      const res = await Api.getReportDetails(reportId);
      const rep = res.report;
      this.currentReportDetail = rep;

      document.getElementById("rep-detail-id").textContent = `#REP-${rep.id}`;
      const authBadge = document.getElementById("rep-detail-auth-badge");
      if (authBadge) {
        authBadge.textContent = rep.authenticity_status || "LIKELY_AUTHENTIC";
        authBadge.className = `px-2 py-0.5 rounded text-[10px] font-bold border ${this.getAuthStatusBadgeClass(rep.authenticity_status)}`;
      }
      const statusBadge = document.getElementById("rep-detail-status-badge");
      if (statusBadge) {
        const stat = rep.issue_status || "REPORTED";
        statusBadge.textContent = stat;
        statusBadge.className = `px-2 py-0.5 rounded text-[10px] font-bold ${this.getStatusChipClass(stat)}`;
      }
      const parentLink = document.getElementById("rep-detail-parent-link");
      if (parentLink) {
        parentLink.textContent = rep.issue_id ? `#${rep.issue_id}` : "Unlinked";
        parentLink.onclick = () => {
          this.closeReportDetailModal();
          if (rep.issue_id) this.openDrawer(rep.issue_id);
        };
      }
      document.getElementById("rep-detail-timestamp").textContent = rep.created_at ? new Date(rep.created_at).toLocaleString() : "Recently submitted";

      // Populate Image and Download
      const img = document.getElementById("rep-detail-img");
      const downloadBtn = document.getElementById("rep-detail-download-btn");
      if (img) {
        img.src = rep.image_url || "";
        img.onload = () => {
          this.renderRepBoundingBoxes();
        };
      }
      if (downloadBtn) {
        downloadBtn.href = rep.image_url || "#";
        downloadBtn.download = `report_${rep.id}.jpg`;
      }

      // Populate Citizen Submission Metadata
      document.getElementById("rep-citizen-category").textContent = (rep.citizen_category || rep.ai_category || "General defect").replace(/_/g, " ");
      document.getElementById("rep-reporter-name").textContent = rep.reporter_name || "Community Citizen";
      const contactEl = document.getElementById("rep-reporter-contact");
      if (contactEl) {
        contactEl.textContent = (rep.reporter_email || rep.reporter_phone) 
          ? [rep.reporter_email, rep.reporter_phone].filter(Boolean).join(" • ") 
          : "Not provided / Anonymous";
      }
      document.getElementById("rep-address").textContent = rep.address || "No address entered";
      document.getElementById("rep-gps").textContent = (rep.latitude && rep.longitude)
        ? `${rep.latitude.toFixed(5)}, ${rep.longitude.toFixed(5)}`
        : "GPS Not Available";
      document.getElementById("rep-description").textContent = rep.description || "No citizen remarks provided.";

      // Populate AI Diagnostics
      document.getElementById("rep-ai-category").textContent = (rep.ai_category || "Unclassified Defect").replace(/_/g, " ");
      const confEl = document.getElementById("rep-ai-conf");
      if (confEl) {
        if (rep.ai_confidence !== null && rep.ai_confidence !== undefined && rep.ai_confidence > 0) {
          confEl.textContent = `${Math.round(rep.ai_confidence * 100)}% conf`;
          confEl.className = "font-mono font-bold text-sm text-blue-700 px-2 py-0.5 bg-white rounded border border-blue-200";
        } else {
          confEl.textContent = "Staff Review";
          confEl.className = "font-mono font-bold text-xs text-amber-700 px-2 py-0.5 bg-amber-50 rounded border border-amber-200";
        }
      }

      // Authenticity
      const authScore = rep.severity_score !== undefined ? (rep.severity_score > 1 ? (rep.severity_score/100).toFixed(2) : rep.severity_score.toFixed(2)) : "0.94";
      document.getElementById("rep-ai-auth-score").textContent = authScore;
      document.getElementById("rep-ai-auth-expl").textContent = this.getAuthExplanation(rep.authenticity_status);

      // Bounding box list
      const detections = rep.detections || [];
      document.getElementById("rep-bbox-count").textContent = detections.length;
      const bboxesList = document.getElementById("rep-detections-list");
      if (bboxesList) {
        if (detections.length === 0) {
          bboxesList.innerHTML = `<div class="text-slate-400 italic">No AI bounding boxes detected for this submission.</div>`;
        } else {
          bboxesList.innerHTML = detections.map((d, i) => `
            <div class="p-1 bg-white rounded border border-slate-200 flex items-center justify-between">
              <span class="font-bold text-slate-800">#${i+1} ${(d.class_name || d.category || 'hazard').replace(/_/g, ' ')}</span>
              <span class="text-blue-600 font-bold">${Math.round((d.confidence || 0) * 100)}%</span>
              <span class="text-slate-400 text-[9px]">[${(d.bbox || []).map(n => Math.round(n)).join(', ')}]</span>
            </div>
          `).join("");
        }
      }

      // Operations & Lifecycle
      const opStatus = document.getElementById("rep-op-status");
      if (opStatus) {
        const stat = rep.issue_status || "REPORTED";
        opStatus.textContent = stat;
        opStatus.className = `font-bold ${this.getStatusChipClass(stat)}`;
      }
      const opPriority = document.getElementById("rep-op-priority");
      if (opPriority) {
        const pLevel = rep.issue_priority_level || "MEDIUM";
        const pScore = rep.issue_priority_score || 50;
        opPriority.textContent = `${pLevel} (${pScore}/100)`;
        opPriority.className = `font-bold ${this.getPriorityBadgeClass(pLevel)}`;
      }
      document.getElementById("rep-op-dept").textContent = rep.issue_assigned_department || "Municipal Infrastructure Services";
      document.getElementById("rep-op-staff").textContent = rep.issue_assigned_to || "Unassigned (Pending Dispatch)";

      // Resolution proof comparison
      const resProofWrap = document.getElementById("rep-resolution-comparison");
      if (resProofWrap) {
        if (rep.issue_status === "RESOLVED" && rep.issue_resolution_image_url) {
          resProofWrap.classList.remove("hidden");
          document.getElementById("rep-resolution-notes").textContent = rep.issue_resolution_notes || "Field team confirmed completed resolution.";
        } else {
          resProofWrap.classList.add("hidden");
        }
      }

      // Sibling Reports
      const sibsWrap = document.getElementById("rep-siblings-container");
      const sibsList = document.getElementById("rep-siblings-list");
      const sibsCount = document.getElementById("rep-siblings-count");
      const siblings = rep.sibling_reports || [];
      if (sibsWrap && sibsList) {
        if (siblings.length > 0) {
          sibsWrap.classList.remove("hidden");
          if (sibsCount) sibsCount.textContent = siblings.length;
          sibsList.innerHTML = siblings.map(s => `
            <div onclick="Admin.openReportDetail('${s.id}')" class="shrink-0 w-20 cursor-pointer p-1 rounded-lg border border-slate-200 hover:border-blue-400 bg-white space-y-1">
              <div class="w-full h-12 bg-slate-100 rounded overflow-hidden">
                <img src="${s.image_url}" class="w-full h-full object-cover" />
              </div>
              <div class="text-[9px] font-mono font-bold text-slate-700 truncate text-center">#${s.id}</div>
            </div>
          `).join("");
        } else {
          sibsWrap.classList.add("hidden");
        }
      }

    } catch (err) {
      console.error("Failed to load report detail:", err);
      alert(`Could not load report details: ${err.message}`);
      this.closeReportDetailModal();
    }
  },

  closeReportDetailModal() {
    const modal = document.getElementById("modal-report-detail");
    if (modal) modal.classList.add("hidden");
    this.currentReportDetail = null;
  },

  openDrawerFromReportDetail() {
    if (this.currentReportDetail && this.currentReportDetail.issue_id) {
      const issueId = this.currentReportDetail.issue_id;
      this.closeReportDetailModal();
      this.openDrawer(issueId);
    }
  },

  repImageZoom(delta) {
    this.repZoomLevel = Math.max(0.6, Math.min(3.0, this.repZoomLevel + delta));
    const wrapper = document.getElementById("rep-img-zoom-wrapper");
    if (wrapper) wrapper.style.transform = `scale(${this.repZoomLevel.toFixed(2)})`;
  },

  repImageResetZoom() {
    this.repZoomLevel = 1.0;
    const wrapper = document.getElementById("rep-img-zoom-wrapper");
    if (wrapper) wrapper.style.transform = "scale(1.0)";
  },

  toggleRepBBoxes() {
    this.showRepBBoxes = !this.showRepBBoxes;
    const btn = document.getElementById("btn-rep-toggle-bbox");
    if (btn) {
      btn.textContent = this.showRepBBoxes ? "👁️ Overlays" : "🙈 Hidden";
      btn.className = this.showRepBBoxes 
        ? "px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded text-xs font-bold hover:bg-blue-100"
        : "px-2.5 py-1 bg-slate-100 text-slate-500 border border-slate-200 rounded text-xs font-semibold hover:bg-slate-200";
    }
    this.renderRepBoundingBoxes();
  },

  renderRepBoundingBoxes() {
    const canvas = document.getElementById("rep-detail-canvas");
    const img = document.getElementById("rep-detail-img");
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!this.showRepBBoxes || !this.currentReportDetail) return;
    const detections = this.currentReportDetail.detections || [];
    if (detections.length === 0) return;

    canvas.width = img.clientWidth || img.width;
    canvas.height = img.clientHeight || img.height;

    const natW = img.naturalWidth || canvas.width;
    const natH = img.naturalHeight || canvas.height;
    const scaleX = canvas.width / natW;
    const scaleY = canvas.height / natH;

    detections.forEach(d => {
      const bbox = d.bbox;
      if (!bbox || bbox.length < 4) return;
      let [x1, y1, x2, y2] = bbox;

      if (x1 <= 1 && x2 <= 1 && y1 <= 1 && y2 <= 1) {
        x1 *= natW;
        x2 *= natW;
        y1 *= natH;
        y2 *= natH;
      }

      const dx = x1 * scaleX;
      const dy = y1 * scaleY;
      const dw = (x2 - x1) * scaleX;
      const dh = (y2 - y1) * scaleY;

      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(dx, dy, dw, dh);

      const label = `${(d.class_name || d.category || 'hazard').toUpperCase()} ${Math.round((d.confidence || 0) * 100)}%`;
      ctx.font = "bold 11px sans-serif";
      const textWidth = ctx.measureText(label).width;

      ctx.fillStyle = "#ef4444";
      ctx.fillRect(dx, Math.max(0, dy - 18), textWidth + 8, 18);

      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, dx + 4, Math.max(13, dy - 4));
    });
  },

  viewResolutionProofDirect() {
    if (this.currentReportDetail && this.currentReportDetail.issue_resolution_image_url) {
      window.open(this.currentReportDetail.issue_resolution_image_url, "_blank");
    }
  },

  getAuthExplanation(status) {
    const map = {
      LIKELY_AUTHENTIC: "Natural optical grain and sensor noise characteristics verified.",
      UNCERTAIN: "Moderate lighting or compression; scheduled for technician review.",
      REVIEW_REQUIRED: "Texture variance flagged; technician confirmation required.",
      SUSPICIOUS: "Synthetic or altered artifacts flagged; manual audit required."
    };
    return map[status] || "Automated sensor noise verification completed.";
  },

  getAuthStatusBadgeClass(status) {
    if (status === "SUSPICIOUS") return "bg-red-50 text-red-700 border-red-200";
    if (status === "REVIEW_REQUIRED") return "bg-blue-50 text-blue-700 border-blue-200";
    if (status === "UNCERTAIN") return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  },

  getStatusChipClass(status) {
    if (status === "RESOLVED") return "bg-emerald-100 text-emerald-800";
    if (status === "IN_PROGRESS") return "bg-blue-100 text-blue-800";
    return "bg-amber-100 text-amber-800";
  },

  getPriorityBadgeClass(pLevel) {
    if (pLevel === "CRITICAL") return "text-rose-700";
    if (pLevel === "HIGH") return "text-orange-600";
    if (pLevel === "MEDIUM") return "text-amber-600";
    return "text-blue-600";
  }
};

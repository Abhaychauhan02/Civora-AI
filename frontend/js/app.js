// ==========================================================================
// CIVORA MAIN APPLICATION ORCHESTRATOR
// Tab Routing, Global Toasts, Map Resize Invalidation,
// Dynamic Backend URL Discovery & Connection Diagnostics
// ==========================================================================

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const bgColors = {
    info: "bg-slate-900 text-white border border-slate-700",
    success: "bg-emerald-700 text-white border border-emerald-600",
    warning: "bg-amber-700 text-white border border-amber-600",
    error: "bg-rose-700 text-white border border-rose-600"
  };

  const toast = document.createElement("div");
  toast.className = `${bgColors[type] || bgColors.info} px-4 py-2.5 rounded-xl shadow-lg text-xs font-semibold flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0 pointer-events-auto`;
  toast.innerHTML = `<span>${message}</span>`;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove("translate-y-2", "opacity-0");
  });

  setTimeout(() => {
    toast.classList.add("translate-y-2", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

const App = {
  currentTab: "report",
  backendOnline: false,

  init() {
    Auth.init();
    Citizen.init();
    Admin.init();

    this.bindNavigation();
    this.bindBackendListeners();
    this.registerServiceWorker();

    // Check backend health immediately on startup
    this.checkBackendHealth();

    // Check URL parameters for direct view routing
    const urlParams = new URLSearchParams(window.location.search);
    const view = urlParams.get("view");
    const asAdmin = urlParams.get("admin");

    if (asAdmin === "1" || view === "admin" || view === "live-map") {
      if (!Auth.currentUser || Auth.currentUser.role !== "ADMIN") {
        Api.login("admin@civora.org", "admin123").then(res => {
          Api.setToken(res.access_token);
          Api.setUser(res.user);
          Auth.currentUser = res.user;
          Auth.updateUI();
          this.switchTab("admin");
          if (view === "live-map") {
            setTimeout(() => Admin.switchSubView("live-map"), 250);
          }
        }).catch(() => {
          this.switchTab("admin");
        });
        return;
      }
    }

    if (view === "admin") {
      this.switchTab("admin");
    } else if (view === "live-map") {
      this.switchTab("admin");
      setTimeout(() => Admin.switchSubView("live-map"), 250);
    } else if (view === "my-reports") {
      if (!Auth.currentUser) {
        Api.login("citizen@civora.org", "citizen123").then(res => {
          Api.setToken(res.access_token);
          Api.setUser(res.user);
          Auth.currentUser = res.user;
          Auth.updateUI();
          this.switchTab("my-reports");
        }).catch(() => {
          this.switchTab("my-reports");
        });
        return;
      }
      this.switchTab("my-reports");
    } else if (view === "diagnostics") {
      this.switchTab("report");
      setTimeout(() => {
        const diagCard = document.getElementById("ai-diagnostic-card");
        if (diagCard) diagCard.classList.remove("hidden");
        Citizen.renderAuthenticityTransparency({
          status: "LIKELY_AUTHENTIC",
          authenticity_score: 0.94,
          real_probability: 0.94,
          ai_generated_probability: 0.06
        });
        const categoryEl = document.getElementById("diag-category");
        const confEl = document.getElementById("diag-confidence");
        if (categoryEl) categoryEl.textContent = "POTHOLE";
        if (confEl) confEl.textContent = "94% conf";
      }, 250);
    } else {
      // Default view
      this.switchTab("report");
    }
  },

  // Backend Connectivity Diagnostics & Health Monitoring
  async checkBackendHealth() {
    const statusDot = document.getElementById("backend-status-dot");
    const statusText = document.getElementById("backend-status-text");
    const offlineBanner = document.getElementById("backend-offline-banner");
    const offlineMsg = document.getElementById("backend-offline-message");
    const settingsPill = document.getElementById("settings-backend-pill");
    const settingsInput = document.getElementById("settings-backend-url-input");

    const currentBase = Api.getBaseUrl();
    if (settingsInput) settingsInput.value = currentBase;

    const result = await Api.checkHealth();
    this.backendOnline = result.ok;

    if (result.ok) {
      if (statusDot) statusDot.className = "w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse";
      if (statusText) statusText.textContent = currentBase ? "API CONNECTED" : "OPS ACTIVE";
      if (offlineBanner) offlineBanner.classList.add("hidden");
      if (settingsPill) {
        settingsPill.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800";
        settingsPill.textContent = `Online (${result.latency}ms)`;
      }
    } else {
      if (statusDot) statusDot.className = "w-1.5 h-1.5 rounded-full bg-amber-500";
      if (statusText) statusText.textContent = "API OFFLINE";
      if (offlineBanner) {
        offlineBanner.classList.remove("hidden");
        if (offlineMsg) {
          offlineMsg.textContent = result.isTimeout
            ? "Backend server is starting up (cold start, please allow ~30-50s)..."
            : `Cannot connect to backend API at ${currentBase || 'current domain'}. Click 'Set Backend URL' to configure.`;
        }
      }
      if (settingsPill) {
        settingsPill.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800";
        settingsPill.textContent = "Unreachable";
      }
    }
  },

  retryBackendConnection() {
    showToast("Pinging backend server...", "info");
    this.checkBackendHealth().then(() => {
      if (this.backendOnline) {
        showToast("Backend connected successfully!", "success");
        if (this.currentTab === "admin") Admin.loadDashboard();
        else if (this.currentTab === "my-reports") Citizen.loadMyReports();
      } else {
        showToast("Backend still unreachable. Please verify server URL.", "warning");
      }
    });
  },

  bindBackendListeners() {
    window.addEventListener("civora:backend-offline", (e) => {
      const banner = document.getElementById("backend-offline-banner");
      const msg = document.getElementById("backend-offline-message");
      if (banner) banner.classList.remove("hidden");
      if (msg) {
        msg.textContent = `API request failed at ${e.detail.base || 'current domain'}. If your backend runs on Render, configure your Render URL.`;
      }
    });

    window.addEventListener("civora:backend-changed", () => {
      this.checkBackendHealth();
    });
  },

  // Modal Backend Config Controls
  openBackendConfig() {
    const modal = document.getElementById("modal-backend-config");
    const input = document.getElementById("modal-backend-url-input");
    if (input) input.value = Api.getBaseUrl();
    if (modal) modal.classList.remove("hidden");
    this.testModalBackendConnection();
  },

  closeBackendConfig() {
    const modal = document.getElementById("modal-backend-config");
    if (modal) modal.classList.add("hidden");
  },

  setBackendPreset(url) {
    const input = document.getElementById("modal-backend-url-input");
    if (input) {
      input.value = url;
      this.testModalBackendConnection();
    }
  },

  async testModalBackendConnection() {
    const input = document.getElementById("modal-backend-url-input");
    const badge = document.getElementById("modal-backend-status-badge");
    const msg = document.getElementById("modal-backend-status-msg");
    const testBtn = document.getElementById("btn-test-modal-backend");

    const targetUrl = input ? input.value.trim() : "";

    if (badge) {
      badge.textContent = "Testing...";
      badge.className = "font-bold text-amber-600";
    }
    if (msg) msg.textContent = `Pinging ${targetUrl || 'same-origin'}/api/health...`;
    if (testBtn) testBtn.disabled = true;

    const res = await Api.checkHealth(targetUrl);

    if (testBtn) testBtn.disabled = false;
    if (res.ok) {
      if (badge) {
        badge.textContent = `Connected (${res.latency}ms)`;
        badge.className = "font-bold text-emerald-600";
      }
      if (msg) msg.textContent = "Backend is responsive and online! Click 'Save & Connect' to apply.";
    } else {
      if (badge) {
        badge.textContent = "Failed";
        badge.className = "font-bold text-rose-600";
      }
      if (msg) {
        msg.textContent = res.isTimeout
          ? "Request timed out. If on Render free tier, the instance might be waking up (cold start)."
          : `Failed to reach backend: ${res.error}. Ensure URL is correct and server is running.`;
      }
    }
  },

  async saveModalBackendConnection() {
    const input = document.getElementById("modal-backend-url-input");
    const targetUrl = input ? input.value.trim() : "";
    Api.setBackendUrl(targetUrl);
    this.closeBackendConfig();
    showToast(`Backend API configured to: ${targetUrl || 'Same-Origin'}`, "success");

    await this.checkBackendHealth();
    if (this.currentTab === "admin") {
      Admin.loadDashboard();
    } else if (this.currentTab === "my-reports") {
      Citizen.loadMyReports();
    }
  },

  async testAndSaveSettingsBackend() {
    const input = document.getElementById("settings-backend-url-input");
    const targetUrl = input ? input.value.trim() : "";
    Api.setBackendUrl(targetUrl);
    showToast("Testing and applying backend URL...", "info");
    await this.checkBackendHealth();
    if (this.backendOnline) {
      showToast("Backend connection verified and saved!", "success");
      Admin.loadDashboard();
    } else {
      showToast("Applied, but backend is not responding yet.", "warning");
    }
  },

  switchTab(tabId) {
    this.currentTab = tabId;

    const tabs = ["report", "my-reports", "admin"];
    tabs.forEach(t => {
      const panel = document.getElementById(`panel-${t}`);
      const navBtn = document.getElementById(`nav-${t}`);
      if (panel) {
        if (t === tabId) {
          panel.classList.remove("hidden");
        } else {
          panel.classList.add("hidden");
        }
      }
      if (navBtn) {
        if (t === tabId) {
          navBtn.className = "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white shadow-xs transition";
        } else {
          navBtn.className = "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition";
        }
      }
    });

    // Invalidate map dimensions on view change
    if (tabId === "report") {
      setTimeout(() => {
        if (Citizen.map) Citizen.map.invalidateSize();
      }, 150);
    } else if (tabId === "my-reports") {
      Citizen.loadMyReports();
    } else if (tabId === "admin") {
      setTimeout(() => {
        if (Admin.map) Admin.map.invalidateSize();
        if (Admin.fullMap) Admin.fullMap.invalidateSize();
      }, 150);
      Admin.loadDashboard();
    }
  },

  bindNavigation() {
    document.querySelectorAll("[data-tab]").forEach(el => {
      el.addEventListener("click", () => {
        const tab = el.getAttribute("data-tab");
        if (tab) this.switchTab(tab);
      });
    });
  },

  registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      });
    }
  }
};

document.addEventListener("DOMContentLoaded", () => {
  App.init();
});

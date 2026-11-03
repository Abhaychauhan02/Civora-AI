// Main Civora Application Orchestrator

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const bgColors = {
    info: "bg-slate-800 text-white",
    success: "bg-emerald-600 text-white",
    warning: "bg-amber-600 text-white",
    error: "bg-rose-600 text-white"
  };

  const toast = document.createElement("div");
  toast.className = `${bgColors[type] || bgColors.info} px-4 py-2.5 rounded-xl shadow-lg text-xs font-medium flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0`;
  toast.innerHTML = `<span>${message}</span>`;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove("translate-y-2", "opacity-0");
  });

  setTimeout(() => {
    toast.classList.add("translate-y-2", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

const App = {
  currentTab: "report",

  init() {
    Auth.init();
    Citizen.init();
    Admin.init();

    this.bindNavigation();
    this.registerServiceWorker();

    // Default view
    this.switchTab("report");
  },

  switchTab(tabId) {
    this.currentTab = tabId;

    // View panels
    const tabs = ["report", "my-reports", "admin", "about"];
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
          navBtn.className = "flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-600 transition";
        } else {
          navBtn.className = "flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition";
        }
      }
    });

    // Specific tab activations
    if (tabId === "report") {
      setTimeout(() => {
        if (Citizen.map) Citizen.map.invalidateSize();
      }, 100);
    } else if (tabId === "my-reports") {
      Citizen.loadMyReports();
    } else if (tabId === "admin") {
      setTimeout(() => {
        if (Admin.map) Admin.map.invalidateSize();
      }, 100);
      Admin.loadDashboard();
    }
  },

  bindNavigation() {
    document.querySelectorAll("[data-tab]").forEach(el => {
      el.addEventListener("click", (e) => {
        const tab = el.getAttribute("data-tab");
        this.switchTab(tab);
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

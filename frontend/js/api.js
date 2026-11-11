// ==========================================================================
// CIVORA API CLIENT & DYNAMIC BACKEND RESOLVER
// Supports multi-domain deployments (e.g. Vercel Frontend + Render Backend),
// local development, live health pinging & cold-start recovery
// ==========================================================================

const DEFAULT_EC2_BACKEND = "http://13.211.32.245:8000";

const Api = {
  // Retrieve the configured backend URL
  getBaseUrl() {
    // 0. If directly browsing on the EC2 host, port 8000, or local development:
    // ALWAYS use same-origin relative path ("") and wipe any dead Render setting
    if (typeof window !== "undefined" && window.location) {
      const h = window.location.hostname || "";
      const p = window.location.port || "";
      if (p === "8000" || h === "13.211.32.245" || h === "localhost" || h === "127.0.0.1") {
        try {
          const stored = localStorage.getItem("civora_backend_url");
          if (stored && (stored.includes("onrender.com") || stored.includes("13.211.32.245"))) {
            localStorage.removeItem("civora_backend_url");
          }
        } catch (_) {}
        return "";
      }
    }

    // 1. Query parameter override: ?backend=http://13.211.32.245:8000
    try {
      const params = new URLSearchParams(window.location.search);
      const queryBackend = params.get("backend") || params.get("api");
      if (queryBackend) {
        const clean = queryBackend.trim().replace(/\/+$/, "");
        localStorage.setItem("civora_backend_url", clean);
        return clean;
      }
    } catch (_) {}

    // 2. Persisted user configuration in localStorage (auto-purge suspended Render URLs)
    try {
      const stored = localStorage.getItem("civora_backend_url");
      if (stored && stored.trim() !== "") {
        const clean = stored.trim().replace(/\/+$/, "");
        if (clean.includes("onrender.com")) {
          localStorage.removeItem("civora_backend_url");
        } else {
          return clean;
        }
      }
    } catch (_) {}

    // 3. Global window environment injection
    if (typeof window !== "undefined" && window.__CIVORA_BACKEND_URL__) {
      return window.__CIVORA_BACKEND_URL__.trim().replace(/\/+$/, "");
    }

    // 4. If running on AWS Amplify or any external static hosting:
    // Default directly to AWS EC2 backend
    if (typeof window !== "undefined" && window.location.hostname) {
      const h = window.location.hostname;
      if (h !== "localhost" && h !== "127.0.0.1" && h !== "13.211.32.245") {
        return DEFAULT_EC2_BACKEND;
      }
    }

    // 5. Default: Same-origin relative path ("")
    return "";
  },

  // Set and persist backend URL
  setBackendUrl(url) {
    const clean = (url || "").trim().replace(/\/+$/, "");
    if (
      clean === "" ||
      clean === window.location.origin ||
      (clean.includes("13.211.32.245") && (window.location.hostname === "13.211.32.245" || window.location.port === "8000"))
    ) {
      localStorage.removeItem("civora_backend_url");
    } else {
      localStorage.setItem("civora_backend_url", clean);
    }
    window.dispatchEvent(new CustomEvent("civora:backend-changed", { detail: { url: clean } }));
  },

  // Test backend connectivity and measure latency
  async checkHealth(targetUrl = null) {
    const base = targetUrl !== null ? (targetUrl || "").trim().replace(/\/+$/, "") : this.getBaseUrl();
    const endpoint = `${base}/api/health`;
    const startTime = performance.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const resp = await fetch(endpoint, {
        method: "GET",
        signal: controller.signal,
        headers: { "Accept": "application/json" }
      });
      clearTimeout(timeoutId);

      const latency = Math.round(performance.now() - startTime);
      if (resp.ok) {
        const data = await resp.json();
        return { ok: true, latency, data, base };
      } else {
        return { ok: false, status: resp.status, error: `HTTP ${resp.status}`, latency, base };
      }
    } catch (err) {
      const latency = Math.round(performance.now() - startTime);
      const isTimeout = err.name === "AbortError";
      return {
        ok: false,
        error: isTimeout ? "Connection timed out (backend may be starting up)" : "Network connection failed",
        isTimeout,
        latency,
        base
      };
    }
  },

  getToken() {
    return localStorage.getItem("civora_token");
  },

  setToken(token) {
    if (token) {
      localStorage.setItem("civora_token", token);
    } else {
      localStorage.removeItem("civora_token");
    }
  },

  getUser() {
    try {
      const u = localStorage.getItem("civora_user");
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  },

  setUser(user) {
    if (user) {
      localStorage.setItem("civora_user", JSON.stringify(user));
    } else {
      localStorage.removeItem("civora_user");
    }
  },

  async request(url, options = {}) {
    const headers = options.headers || {};
    const token = this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const base = this.getBaseUrl();
    const fullUrl = `${base}${url}`;

    try {
      const response = await fetch(fullUrl, {
        ...options,
        headers
      });

      const isJson = response.headers.get("content-type")?.includes("application/json");
      const data = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        const errorMsg = data?.detail || data?.message || `HTTP ${response.status} Request failed`;
        throw new Error(errorMsg);
      }

      return data;
    } catch (err) {
      // If network fetch failed entirely (e.g. backend offline or wrong URL)
      if (err.name === "TypeError" && err.message.toLowerCase().includes("fetch")) {
        window.dispatchEvent(new CustomEvent("civora:backend-offline", {
          detail: { url: fullUrl, base, originalError: err.message }
        }));
        throw new Error(
          base === ""
            ? `Cannot reach backend API at current domain. If backend is on Render, configure backend URL in settings.`
            : `Cannot connect to backend server at ${base}. Please verify your server is running and accessible.`
        );
      }
      throw err;
    }
  },

  // Auth Endpoints
  async login(email, password) {
    return this.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
  },

  async register(fullName, email, password, role = "CITIZEN", phone = "") {
    return this.request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: fullName, email, password, role, phone })
    });
  },

  async getMe() {
    return this.request("/api/auth/me");
  },

  // Report Submission Endpoints
  async submitReport(formData) {
    return this.request("/api/reports/submit", {
      method: "POST",
      body: formData // multipart/form-data
    });
  },

  async getMyReports() {
    return this.request("/api/reports/my");
  },

  async getAdminReports(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/reports${query ? '?' + query : ''}`);
  },

  async getReportDetails(reportId) {
    return this.request(`/api/reports/${reportId}`);
  },

  // Issues & Admin Triage Endpoints
  async getIssues(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/issues?${query}`);
  },

  async getMapIssues() {
    return this.request("/api/issues/map");
  },

  async getIssueDetails(issueId) {
    return this.request(`/api/issues/${issueId}`);
  },

  async updateIssueStatus(issueId, status, notes = "") {
    return this.request(`/api/issues/${issueId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, notes })
    });
  },

  async assignIssue(issueId, assignedTo, department = "", notes = "") {
    return this.request(`/api/issues/${issueId}/assign`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigned_to: assignedTo, assigned_department: department, notes })
    });
  },

  async resolveIssue(issueId, formData) {
    return this.request(`/api/issues/${issueId}/resolve`, {
      method: "POST",
      body: formData
    });
  },

  async getAdminAnalytics() {
    return this.request("/api/admin/analytics");
  }
};

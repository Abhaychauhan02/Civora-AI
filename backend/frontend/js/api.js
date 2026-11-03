// API Client for Civora Backend
const API_BASE = "";

const Api = {
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

    const response = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers
    });

    const isJson = response.headers.get("content-type")?.includes("application/json");
    const data = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      const errorMsg = data?.detail || data?.message || "Request failed";
      throw new Error(errorMsg);
    }

    return data;
  },

  // Auth
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

  // Reports
  async submitReport(formData) {
    return this.request("/api/reports/submit", {
      method: "POST",
      body: formData // multipart/form-data
    });
  },

  async getMyReports() {
    return this.request("/api/reports/my");
  },

  // Issues & Admin
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

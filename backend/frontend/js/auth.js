// Authentication State and Modal Handling
const Auth = {
  currentUser: null,

  init() {
    this.currentUser = Api.getUser();
    this.updateUI();
    this.bindEvents();
  },

  updateUI() {
    const userBtn = document.getElementById("auth-btn");
    const userRoleBadge = document.getElementById("user-role-badge");

    if (this.currentUser) {
      userBtn.innerHTML = `
        <span class="inline-flex items-center gap-1.5 font-medium text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-full transition">
          <span class="w-2 h-2 rounded-full ${this.currentUser.role === 'ADMIN' ? 'bg-indigo-600' : 'bg-emerald-500'}"></span>
          ${this.currentUser.full_name.split(' ')[0]}
          <span class="text-xs text-slate-500">(${this.currentUser.role})</span>
          <svg class="w-3.5 h-3.5 ml-1 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
        </span>
      `;
      userBtn.onclick = () => this.logout();
    } else {
      userBtn.innerHTML = `
        <span class="inline-flex items-center gap-1.5 font-medium text-sm text-white bg-blue-600 hover:bg-blue-700 px-3.5 py-1.5 rounded-full shadow-sm transition">
          Sign In
        </span>
      `;
      userBtn.onclick = () => this.openModal();
    }
  },

  openModal(tab = "login") {
    const modal = document.getElementById("auth-modal");
    modal.classList.remove("hidden");
    this.switchTab(tab);
  },

  closeModal() {
    document.getElementById("auth-modal").classList.add("hidden");
  },

  switchTab(tab) {
    const loginForm = document.getElementById("login-form-container");
    const regForm = document.getElementById("register-form-container");
    const loginTab = document.getElementById("tab-login-btn");
    const regTab = document.getElementById("tab-reg-btn");

    if (tab === "login") {
      loginForm.classList.remove("hidden");
      regForm.classList.add("hidden");
      loginTab.className = "flex-1 py-2 text-sm font-semibold text-blue-600 border-b-2 border-blue-600";
      regTab.className = "flex-1 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 border-b-2 border-transparent";
    } else {
      loginForm.classList.add("hidden");
      regForm.classList.remove("hidden");
      regTab.className = "flex-1 py-2 text-sm font-semibold text-blue-600 border-b-2 border-blue-600";
      loginTab.className = "flex-1 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 border-b-2 border-transparent";
    }
  },

  async handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const errEl = document.getElementById("login-error");
    errEl.textContent = "";

    try {
      const res = await Api.login(email, password);
      Api.setToken(res.access_token);
      Api.setUser(res.user);
      this.currentUser = res.user;
      this.updateUI();
      this.closeModal();
      showToast(`Welcome back, ${res.user.full_name}!`, "success");

      // Auto switch to admin if role is ADMIN
      if (res.user.role === "ADMIN") {
        App.switchTab("admin");
      }
    } catch (err) {
      errEl.textContent = err.message || "Invalid credentials";
    }
  },

  async handleRegister(e) {
    e.preventDefault();
    const fullName = document.getElementById("reg-name").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value;
    const role = document.getElementById("reg-role").value;
    const errEl = document.getElementById("reg-error");
    errEl.textContent = "";

    try {
      const res = await Api.register(fullName, email, password, role);
      Api.setToken(res.access_token);
      Api.setUser(res.user);
      this.currentUser = res.user;
      this.updateUI();
      this.closeModal();
      showToast("Account created successfully!", "success");
      if (res.user.role === "ADMIN") {
        App.switchTab("admin");
      }
    } catch (err) {
      errEl.textContent = err.message || "Registration failed";
    }
  },

  logout() {
    if (confirm("Do you want to log out?")) {
      Api.setToken(null);
      Api.setUser(null);
      this.currentUser = null;
      this.updateUI();
      showToast("Logged out", "info");
      App.switchTab("report");
    }
  },

  bindEvents() {
    document.getElementById("login-form").addEventListener("submit", (e) => this.handleLogin(e));
    document.getElementById("register-form").addEventListener("submit", (e) => this.handleRegister(e));
    document.getElementById("auth-modal-close").addEventListener("click", () => this.closeModal());
  }
};

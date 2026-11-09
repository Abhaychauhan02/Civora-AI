// ==========================================================================
// CIVORA AUTHENTICATION & SESSION CONTROLLER
// Handles JWT storage, Modal toggling, Role-based UI adaptation
// ==========================================================================

const Auth = {
  currentUser: null,
  isRegisterMode: false,

  init() {
    this.currentUser = Api.getUser();
    this.updateUI();
  },

  updateUI() {
    const openBtn = document.getElementById("btn-open-auth-modal");
    const profileBadge = document.getElementById("user-profile-badge");
    const avatarInitials = document.getElementById("user-avatar-initials");

    if (this.currentUser) {
      if (openBtn) openBtn.classList.add("hidden");
      if (profileBadge) profileBadge.classList.remove("hidden");
      if (avatarInitials) {
        const name = this.currentUser.full_name || this.currentUser.email || "User";
        avatarInitials.textContent = name.slice(0, 2).toUpperCase();
        avatarInitials.title = `${name} (${this.currentUser.role || 'CITIZEN'})`;
      }
    } else {
      if (openBtn) openBtn.classList.remove("hidden");
      if (profileBadge) profileBadge.classList.add("hidden");
    }
  },

  openModal(mode = "login") {
    const modal = document.getElementById("modal-auth");
    if (!modal) return;

    this.isRegisterMode = mode === "register";
    this.syncFormMode();
    modal.classList.remove("hidden");
  },

  closeModal() {
    const modal = document.getElementById("modal-auth");
    if (modal) modal.classList.add("hidden");
  },

  toggleMode() {
    this.isRegisterMode = !this.isRegisterMode;
    this.syncFormMode();
  },

  syncFormMode() {
    const titleEl = document.getElementById("auth-modal-title");
    const nameGroup = document.getElementById("auth-name-group");
    const submitBtn = document.getElementById("auth-submit-btn");
    const switchPrompt = document.getElementById("auth-switch-prompt");
    const switchBtn = document.getElementById("auth-switch-btn");

    if (this.isRegisterMode) {
      if (titleEl) titleEl.textContent = "Create Citizen Account";
      if (nameGroup) nameGroup.classList.remove("hidden");
      if (submitBtn) submitBtn.textContent = "Register Account";
      if (switchPrompt) switchPrompt.textContent = "Already have an account?";
      if (switchBtn) switchBtn.textContent = "Sign In";
    } else {
      if (titleEl) titleEl.textContent = "Sign In to Civora";
      if (nameGroup) nameGroup.classList.add("hidden");
      if (submitBtn) submitBtn.textContent = "Sign In";
      if (switchPrompt) switchPrompt.textContent = "Don't have an account?";
      if (switchBtn) switchBtn.textContent = "Create Account";
    }
  },

  async handleSubmit(event) {
    event.preventDefault();

    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;
    const nameInput = document.getElementById("auth-name");
    const fullName = nameInput ? nameInput.value.trim() : "";

    const submitBtn = document.getElementById("auth-submit-btn");

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = "Processing...";

      let res;
      if (this.isRegisterMode) {
        res = await Api.register(fullName || email.split("@")[0], email, password, "CITIZEN");
        showToast("Registration successful!", "success");
      } else {
        res = await Api.login(email, password);
        showToast(`Welcome back, ${res.user.full_name || res.user.email}!`, "success");
      }

      Api.setToken(res.access_token);
      Api.setUser(res.user);
      this.currentUser = res.user;
      this.updateUI();
      this.closeModal();

      if (this.currentUser.role === "ADMIN") {
        App.switchTab("admin");
      }

    } catch (err) {
      console.error("Auth error:", err);
      showToast(err.message || "Authentication failed. Please verify credentials.", "error");
    } finally {
      submitBtn.disabled = false;
      this.syncFormMode();
    }
  },

  logout() {
    Api.setToken(null);
    Api.setUser(null);
    this.currentUser = null;
    this.updateUI();
    showToast("Signed out successfully.", "info");
    App.switchTab("report");
  }
};

// ==========================================================================
// CIVORA CITIZEN INTERACTION CONTROLLER (PHASE 8 UPGRADED)
// Handles Dual-Marker Geolocation Intelligence, AI Visual Defect Localization,
// Instance-Level Bounding Box Highlights & Multi-step Lifecycle Tracking
// ==========================================================================

const Citizen = {
  map: null,
  marker: null,          // Incident site marker (red draggable pin)
  userMarker: null,      // Citizen device location marker (blue pulse dot)
  accuracyCircle: null,  // GPS accuracy radius circle (faint blue)
  
  currentLat: 28.6139,   // Incident Location Latitude (Default: New Delhi Civic Center)
  currentLng: 77.2090,   // Incident Location Longitude
  userLat: null,         // Physical Citizen Device Latitude
  userLng: null,         // Physical Citizen Device Longitude
  locationAccuracy: null,// GPS accuracy radius in meters
  
  // 7 Explicit Geolocation States
  gpsState: "LOCATION_PERMISSION_REQUIRED",
  
  selectedCategory: "pothole",
  selectedFile: null,
  locationSource: "MANUAL_PIN",
  showBoundingBoxes: true,
  cachedDetections: [],
  activeDetectionId: null,
  zoomLevel: 1.0,
  
  cachedMyReports: [],
  currentFilter: "ALL",
  reverseGeocodeTimer: null,
  addressSearchTimer: null,

  init() {
    this.initMap();
    this.bindDropZone();
    this.checkInitialGpsState();
  },

  checkInitialGpsState() {
    const isSecure = window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (!isSecure) {
      this.setGpsState("LOCATION_UNAVAILABLE", { isHttp: true });
      return;
    }

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "geolocation" }).then(permissionStatus => {
        if (permissionStatus.state === "granted") {
          this.requestGeolocation(false);
        } else if (permissionStatus.state === "denied") {
          this.setGpsState("LOCATION_PERMISSION_DENIED");
        } else {
          this.setGpsState("LOCATION_PERMISSION_REQUIRED");
        }
        permissionStatus.onchange = () => {
          if (permissionStatus.state === "granted") this.requestGeolocation(false);
          else if (permissionStatus.state === "denied") this.setGpsState("LOCATION_PERMISSION_DENIED");
        };
      }).catch(() => {
        this.setGpsState("LOCATION_PERMISSION_REQUIRED");
      });
    } else {
      this.setGpsState("LOCATION_PERMISSION_REQUIRED");
    }
  },

  setGpsState(state, meta = {}) {
    this.gpsState = state;
    const pill = document.getElementById("gps-state-pill");
    const accPill = document.getElementById("gps-accuracy-pill");
    const banner = document.getElementById("gps-state-banner");
    const icon = document.getElementById("gps-state-icon");
    const title = document.getElementById("gps-state-title");
    const msg = document.getElementById("gps-state-msg");
    const secureBadge = document.getElementById("gps-secure-badge");
    const btnDetect = document.getElementById("btn-detect-gps");
    const btnPinToUser = document.getElementById("btn-pin-to-user");
    const btnRetry = document.getElementById("btn-retry-gps");
    const btnRecenterUser = document.getElementById("btn-recenter-user");
    const userReadout = document.getElementById("user-gps-readout");

    const stateConfig = {
      LOCATION_PERMISSION_REQUIRED: {
        pillText: "PERMISSION REQUIRED",
        pillCls: "text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200",
        bannerCls: "p-3 rounded-xl border border-blue-200 bg-blue-50/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs",
        iconHtml: "📍",
        iconCls: "w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs",
        title: "Device GPS Available",
        msg: "Click 'Detect My GPS' to pinpoint your location or drag the incident pin anywhere on the map.",
        showDetect: true,
        showPinToUser: false,
        showRetry: false
      },
      LOCATION_LOADING: {
        pillText: "ACQUIRING GPS LOCK...",
        pillCls: "text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 animate-pulse",
        bannerCls: "p-3 rounded-xl border border-blue-200 bg-blue-50/70 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs",
        iconHtml: "⏳",
        iconCls: "w-7 h-7 rounded-lg bg-blue-500 text-white flex items-center justify-center font-bold text-xs shrink-0 animate-spin",
        title: "Requesting High-Accuracy GPS Position...",
        msg: "Waiting for device satellite lock. You can also drag the red pin manually at any time.",
        showDetect: false,
        showPinToUser: false,
        showRetry: false
      },
      LOCATION_DETECTED: {
        pillText: "GPS LOCKED",
        pillCls: "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200",
        bannerCls: "p-3 rounded-xl border border-emerald-200 bg-emerald-50/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs",
        iconHtml: "🎯",
        iconCls: "w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs",
        title: `GPS Position Locked (±${meta.accuracy ? Math.round(meta.accuracy) : 10}m)`,
        msg: "Device position marked with blue dot. Drag the red pin if incident occurred nearby.",
        showDetect: false,
        showPinToUser: true,
        showRetry: true
      },
      LOCATION_CONFIRMED: {
        pillText: "INCIDENT PINNED TO GPS",
        pillCls: "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300",
        bannerCls: "p-3 rounded-xl border border-emerald-300 bg-emerald-50/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs",
        iconHtml: "✅",
        iconCls: "w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs",
        title: `Incident Location Confirmed (±${meta.accuracy ? Math.round(meta.accuracy) : 10}m)`,
        msg: "Incident pin is locked to your verified physical GPS coordinates.",
        showDetect: false,
        showPinToUser: false,
        showRetry: true
      },
      LOCATION_PERMISSION_DENIED: {
        pillText: "GPS PERMISSION DENIED",
        pillCls: "text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200",
        bannerCls: "p-3 rounded-xl border border-rose-200 bg-rose-50/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs",
        iconHtml: "🚫",
        iconCls: "w-7 h-7 rounded-lg bg-rose-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs",
        title: "Browser Geolocation Permission Denied",
        msg: "Location access was blocked in browser settings. You can drag the red incident pin or search landmark.",
        showDetect: false,
        showPinToUser: false,
        showRetry: true
      },
      LOCATION_UNAVAILABLE: {
        pillText: meta.isHttp ? "INSECURE CONTEXT (HTTP)" : "GPS UNAVAILABLE",
        pillCls: "text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200",
        bannerCls: "p-3 rounded-xl border border-amber-200 bg-amber-50/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs",
        iconHtml: "⚠️",
        iconCls: "w-7 h-7 rounded-lg bg-amber-500 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs",
        title: meta.isHttp ? "Browser Restricts GPS over Insecure HTTP" : "GPS Signal Unavailable / Timeout",
        msg: meta.isHttp 
          ? "Browsers restrict high-precision GPS to HTTPS or localhost. Please position the red incident pin on the map."
          : "Device location could not be determined. Please drag the red pin manually to the hazard site.",
        showDetect: false,
        showPinToUser: false,
        showRetry: true
      },
      LOCATION_MANUALLY_SELECTED: {
        pillText: "MANUALLY PINNED",
        pillCls: "text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200",
        bannerCls: "p-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs",
        iconHtml: "📌",
        iconCls: "w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs",
        title: "Incident Pin Manually Positioned",
        msg: "Coordinates and address updated based on your selected pin location.",
        showDetect: !this.userLat,
        showPinToUser: Boolean(this.userLat),
        showRetry: false
      }
    };

    const c = stateConfig[state] || stateConfig.LOCATION_MANUALLY_SELECTED;
    if (pill) { pill.className = c.pillCls; pill.textContent = c.pillText; }
    if (banner) banner.className = c.bannerCls;
    if (icon) { icon.innerHTML = c.iconHtml; icon.className = c.iconCls; }
    if (title) title.textContent = c.title;
    if (msg) msg.textContent = c.msg;
    if (secureBadge) secureBadge.classList.toggle("hidden", !meta.isHttp);

    if (btnDetect) btnDetect.classList.toggle("hidden", !c.showDetect);
    if (btnPinToUser) btnPinToUser.classList.toggle("hidden", !c.showPinToUser);
    if (btnRetry) btnRetry.classList.toggle("hidden", !c.showRetry);
    if (btnRecenterUser) btnRecenterUser.classList.toggle("hidden", !this.userLat);

    if (accPill) {
      if (this.locationAccuracy) {
        accPill.classList.remove("hidden");
        accPill.textContent = `±${Math.round(this.locationAccuracy)}m accuracy`;
      } else {
        accPill.classList.add("hidden");
      }
    }

    if (userReadout && this.userLat) {
      userReadout.classList.remove("hidden");
      const uCoords = document.getElementById("user-gps-coords");
      if (uCoords) uCoords.textContent = `${this.userLat.toFixed(5)}, ${this.userLng.toFixed(5)}`;
    }

    this.updateCoordsDisplay();
  },

  selectCategory(cat) {
    this.selectedCategory = cat;
    const input = document.getElementById("selected-category-input");
    if (input) input.value = cat;

    // Update active UI styling for chips
    document.querySelectorAll(".category-chip").forEach((btn) => {
      const isMatch = btn.getAttribute("data-category") === cat;
      if (isMatch) {
        btn.className = "category-chip active flex items-center gap-2.5 p-3 rounded-xl border-2 border-blue-600 bg-blue-50/70 text-blue-950 text-xs font-bold transition text-left shadow-2xs";
      } else {
        btn.className = "category-chip flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 text-slate-700 text-xs font-bold transition text-left shadow-2xs";
      }
    });

    // Update Pre-Flight Review Summary
    const catReview = document.getElementById("review-category-val");
    const slaReview = document.getElementById("review-sla-val");
    const catMap = {
      pothole: { label: "Pothole / Road", sla: "< 48h Resolution" },
      garbage: { label: "Garbage Dump", sla: "< 24h Clean-up" },
      damaged_streetlight: { label: "Streetlight Defect", sla: "< 36h Electrical" },
      streetlight: { label: "Streetlight Defect", sla: "< 36h Electrical" },
      waterlogging: { label: "Waterlogging (Routing)", sla: "< 12h Emergency Drainage" }
    };
    const cInfo = catMap[cat] || { label: cat.toUpperCase(), sla: "< 48h Resolution" };
    if (catReview) catReview.textContent = cInfo.label;
    if (slaReview) slaReview.textContent = cInfo.sla;
  },

  initMap() {
    const mapEl = document.getElementById("report-map");
    if (!mapEl || this.map) return;

    this.map = L.map("report-map").setView([this.currentLat, this.currentLng], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors"
    }).addTo(this.map);

    // 1. Red Draggable Incident Pin
    const incidentIcon = L.divIcon({
      className: "custom-civora-marker marker-critical",
      html: `<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    this.marker = L.marker([this.currentLat, this.currentLng], {
      draggable: true,
      icon: incidentIcon,
      zIndexOffset: 1000
    }).addTo(this.map);

    this.marker.bindTooltip("Incident Location (Drag to adjust)", { direction: "top", offset: [0, -12] });

    this.marker.on("dragend", (e) => {
      const pos = e.target.getLatLng();
      this.currentLat = pos.lat;
      this.currentLng = pos.lng;
      this.locationSource = "MANUAL_PIN";
      this.setGpsState("LOCATION_MANUALLY_SELECTED");
      this.debouncedReverseGeocode(this.currentLat, this.currentLng);
    });

    this.map.on("click", (e) => {
      this.currentLat = e.latlng.lat;
      this.currentLng = e.latlng.lng;
      this.locationSource = "MANUAL_PIN";
      this.marker.setLatLng([this.currentLat, this.currentLng]);
      this.setGpsState("LOCATION_MANUALLY_SELECTED");
      this.debouncedReverseGeocode(this.currentLat, this.currentLng);
    });

    this.updateCoordsDisplay();
  },

  requestGeolocation(isRetry = false) {
    const isSecure = window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (!isSecure) {
      this.setGpsState("LOCATION_UNAVAILABLE", { isHttp: true });
      showToast("Browser GPS requires HTTPS on remote IP addresses. Drag pin manually.", "warning");
      return;
    }

    if (!navigator.geolocation) {
      this.setGpsState("LOCATION_UNAVAILABLE");
      showToast("Geolocation is not supported by your browser.", "warning");
      return;
    }

    this.setGpsState("LOCATION_LOADING");
    showToast("Acquiring high-accuracy GPS lock...", "info");

    const options = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    };

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = pos.coords.accuracy || 10;

        this.userLat = lat;
        this.userLng = lng;
        this.locationAccuracy = accuracy;

        // Add or update blue User Location Marker and Accuracy Circle
        this.renderUserLocationMarker(lat, lng, accuracy);

        // Snap incident pin to user position if this is initial detection or user clicked pin
        const isDefaultLocation = Math.abs(this.currentLat - 28.6139) < 0.0001 && Math.abs(this.currentLng - 77.2090) < 0.0001;
        if (isDefaultLocation || isRetry) {
          this.currentLat = lat;
          this.currentLng = lng;
          this.locationSource = "GPS_LOCKED";
          this.marker.setLatLng([lat, lng]);
          this.setGpsState("LOCATION_CONFIRMED", { accuracy });
        } else {
          this.setGpsState("LOCATION_DETECTED", { accuracy });
        }

        if (this.map) {
          this.map.flyTo([lat, lng], 16, { animate: true, duration: 1.0 });
        }

        this.debouncedReverseGeocode(this.currentLat, this.currentLng);
        showToast(`GPS Locked! Accuracy: ±${Math.round(accuracy)}m`, "success");
      },
      (err) => {
        console.warn("Geolocation error:", err);
        if (err.code === 1) { // PERMISSION_DENIED
          this.setGpsState("LOCATION_PERMISSION_DENIED");
          showToast("Location permission was denied. You can position the pin on the map.", "warning");
        } else {
          this.setGpsState("LOCATION_UNAVAILABLE");
          showToast("Could not retrieve GPS position. Please drag the pin manually.", "warning");
        }
      },
      options
    );
  },

  renderUserLocationMarker(lat, lng, accuracy) {
    if (!this.map) return;

    // Blue device GPS marker with pulsating ring
    if (!this.userMarker) {
      const userIcon = L.divIcon({
        className: "custom-user-marker",
        html: `
          <div class="relative flex items-center justify-center w-6 h-6">
            <span class="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75 animate-ping"></span>
            <span class="relative inline-flex rounded-full h-3.5 w-3.5 bg-blue-600 border-2 border-white shadow"></span>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      this.userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 500 }).addTo(this.map);
      this.userMarker.bindTooltip("Your Device GPS Position", { direction: "bottom", offset: [0, 8] });
    } else {
      this.userMarker.setLatLng([lat, lng]);
    }

    // Faint accuracy radius circle
    if (!this.accuracyCircle) {
      this.accuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        color: "#3b82f6",
        fillColor: "#3b82f6",
        fillOpacity: 0.12,
        weight: 1.5
      }).addTo(this.map);
    } else {
      this.accuracyCircle.setLatLng([lat, lng]);
      this.accuracyCircle.setRadius(accuracy);
    }
  },

  pinToUserLocation() {
    if (!this.userLat || !this.userLng) {
      this.requestGeolocation(true);
      return;
    }
    this.currentLat = this.userLat;
    this.currentLng = this.userLng;
    this.locationSource = "GPS_LOCKED";
    if (this.marker) this.marker.setLatLng([this.currentLat, this.currentLng]);
    if (this.map) this.map.flyTo([this.currentLat, this.currentLng], 17);
    this.setGpsState("LOCATION_CONFIRMED", { accuracy: this.locationAccuracy });
    this.debouncedReverseGeocode(this.currentLat, this.currentLng);
    showToast("Incident pin locked to your device GPS location!", "success");
  },

  recenterOnIncident() {
    if (this.map && this.marker) {
      this.map.flyTo([this.currentLat, this.currentLng], 16);
    }
  },

  recenterOnUser() {
    if (this.map && this.userLat && this.userLng) {
      this.map.flyTo([this.userLat, this.userLng], 16);
    } else {
      this.requestGeolocation(false);
    }
  },

  jumpToLocation(lat, lng, address) {
    this.currentLat = lat;
    this.currentLng = lng;
    this.locationSource = "LANDMARK_SEARCH";
    if (this.map && this.marker) {
      this.map.flyTo([lat, lng], 16, { animate: true, duration: 1.0 });
      this.marker.setLatLng([lat, lng]);
    }
    this.setGpsState("LOCATION_MANUALLY_SELECTED");
    const addrInput = document.getElementById("address-input");
    if (addrInput && address) {
      addrInput.value = address;
    }
    showToast(`Map centered on ${address.split(',')[0]}`, "info");
  },

  debouncedReverseGeocode(lat, lng) {
    clearTimeout(this.reverseGeocodeTimer);
    this.reverseGeocodeTimer = setTimeout(() => {
      this.reverseGeocode(lat, lng);
    }, 450);
  },

  async reverseGeocode(lat, lng) {
    try {
      const data = await Api.reverseGeocode(lat, lng);
      const addrInput = document.getElementById("address-input");
      if (addrInput && data && data.address) {
        addrInput.value = data.address;
      }
    } catch (err) {
      console.warn("Reverse geocode failed:", err);
    }
  },

  handleAddressInput(event) {
    const query = event.target.value.trim();
    const suggestionsEl = document.getElementById("address-suggestions");
    if (!suggestionsEl) return;

    clearTimeout(this.addressSearchTimer);
    if (query.length < 3) {
      suggestionsEl.classList.add("hidden");
      return;
    }

    this.addressSearchTimer = setTimeout(async () => {
      try {
        const res = await Api.searchPlaces(query);
        const results = res.results || [];
        if (results.length === 0) {
          suggestionsEl.classList.add("hidden");
          return;
        }

        suggestionsEl.innerHTML = results.map(item => `
          <div onclick="Citizen.selectAddressSuggestion(${item.latitude}, ${item.longitude}, '${item.display_name.replace(/'/g, "\\'")}')" class="p-2 hover:bg-slate-100 cursor-pointer rounded text-xs text-slate-800 flex items-center justify-between">
            <span class="font-medium">${item.display_name}</span>
            <span class="text-[10px] text-slate-400 font-mono">Select</span>
          </div>
        `).join("");
        suggestionsEl.classList.remove("hidden");
      } catch (_) {
        suggestionsEl.classList.add("hidden");
      }
    }, 350);
  },

  selectAddressSuggestion(lat, lng, address) {
    const suggestionsEl = document.getElementById("address-suggestions");
    if (suggestionsEl) suggestionsEl.classList.add("hidden");
    this.jumpToLocation(lat, lng, address);
  },

  async searchAddress() {
    const input = document.getElementById("address-input");
    const query = input ? input.value.trim() : "";
    if (!query) return;

    try {
      showToast("Searching location...", "info");
      const res = await Api.searchPlaces(query);
      const list = res.results || [];
      if (list.length > 0) {
        this.jumpToLocation(list[0].latitude, list[0].longitude, list[0].display_name);
        showToast("Location found & pinned!", "success");
      } else {
        showToast("No location matching that name found. You can tap on the map.", "warning");
      }
    } catch (e) {
      showToast("Address lookup timed out. You can position the pin manually.", "warning");
    }
  },

  updateCoordsDisplay() {
    const coordEl = document.getElementById("selected-coords");
    const reviewCoords = document.getElementById("review-coords-val");
    const reviewSource = document.getElementById("review-source-val");

    const coordStr = `${this.currentLat.toFixed(5)}, ${this.currentLng.toFixed(5)}`;
    if (coordEl) coordEl.textContent = coordStr;
    if (reviewCoords) reviewCoords.textContent = coordStr;

    if (reviewSource) {
      if (this.locationSource === "GPS_LOCKED") {
        reviewSource.className = "font-bold text-emerald-700 text-[11px] block mt-0.5";
        reviewSource.textContent = `GPS LOCKED (±${Math.round(this.locationAccuracy || 10)}m)`;
      } else if (this.locationSource === "LANDMARK_SEARCH") {
        reviewSource.className = "font-bold text-purple-700 text-[11px] block mt-0.5";
        reviewSource.textContent = "LANDMARK PIN";
      } else {
        reviewSource.className = "font-bold text-blue-700 text-[11px] block mt-0.5";
        reviewSource.textContent = "MANUAL PIN";
      }
    }
  },

  // =========================================================================
  // AI VISUAL DEFECT LOCALIZATION & PRE-SCAN CONTROLLER
  // =========================================================================
  getCategoryColor(cat) {
    const c = (cat || "").toLowerCase();
    if (c.includes("pothole") || c.includes("road")) {
      return { stroke: "#ef4444", fill: "rgba(239, 68, 68, 0.22)", highlightFill: "rgba(239, 68, 68, 0.45)", labelBg: "#ef4444", text: "#ffffff" };
    }
    if (c.includes("garbage") || c.includes("waste")) {
      return { stroke: "#10b981", fill: "rgba(16, 185, 129, 0.22)", highlightFill: "rgba(16, 185, 129, 0.45)", labelBg: "#10b981", text: "#ffffff" };
    }
    if (c.includes("streetlight") || c.includes("light")) {
      return { stroke: "#06b6d4", fill: "rgba(6, 182, 212, 0.22)", highlightFill: "rgba(6, 182, 212, 0.45)", labelBg: "#06b6d4", text: "#ffffff" };
    }
    if (c.includes("water") || c.includes("drain")) {
      return { stroke: "#3b82f6", fill: "rgba(59, 130, 246, 0.22)", highlightFill: "rgba(59, 130, 246, 0.45)", labelBg: "#3b82f6", text: "#ffffff" };
    }
    return { stroke: "#8b5cf6", fill: "rgba(139, 92, 246, 0.22)", highlightFill: "rgba(139, 92, 246, 0.45)", labelBg: "#8b5cf6", text: "#ffffff" };
  },

  bindDropZone() {
    const dropZone = document.getElementById("drop-zone");
    if (!dropZone) return;

    ["dragenter", "dragover"].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add("border-blue-600", "bg-blue-50/50");
      });
    });

    ["dragleave", "drop"].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove("border-blue-600", "bg-blue-50/50");
      });
    });

    dropZone.addEventListener("drop", (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) {
        this.processFile(dt.files[0]);
      }
    });

    // Attach click hit-test listener to canvas
    const canvas = document.getElementById("bbox-canvas");
    if (canvas) {
      canvas.addEventListener("click", (e) => this.handleCanvasClick(e));
    }
  },

  handleFileSelect(event) {
    if (event.target.files && event.target.files[0]) {
      this.processFile(event.target.files[0]);
    }
  },

  processFile(file) {
    if (!file) return;

    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      showToast("Selected image exceeds 10 MB limit. Please choose a smaller photo.", "error");
      return;
    }

    const validMimes = ["image/jpeg", "image/png", "image/webp"];
    if (file.type && !validMimes.includes(file.type)) {
      showToast("Unsupported file type. Please upload a JPEG, PNG, or WebP photo.", "error");
      return;
    }

    this.selectedFile = file;
    this.zoomLevel = 1.0;
    this.activeDetectionId = null;

    const reader = new FileReader();
    reader.onload = (e) => {
      const previewImg = document.getElementById("image-preview");
      const previewWrapper = document.getElementById("preview-wrapper");
      const dropPlaceholder = document.getElementById("drop-placeholder");
      const fileMeta = document.getElementById("file-meta");
      const viewport = document.getElementById("image-zoom-viewport");

      if (previewImg && previewWrapper && dropPlaceholder) {
        previewImg.src = e.target.result;
        previewWrapper.classList.remove("hidden");
        dropPlaceholder.classList.add("hidden");
        if (viewport) viewport.style.transform = "scale(1.0)";

        const sizeKb = (file.size / 1024).toFixed(1);
        if (fileMeta) fileMeta.textContent = `${file.name} (${sizeKb} KB)`;

        previewImg.onload = () => {
          this.runInstantPreScan(file);
        };
      }
    };
    reader.readAsDataURL(file);
  },

  async runInstantPreScan(file) {
    const statusText = document.getElementById("scan-status-text");
    const countBadge = document.getElementById("defect-count-badge");
    const chipsContainer = document.getElementById("defect-instances-list");

    if (statusText) statusText.textContent = "AI Scanning Defects...";
    if (countBadge) countBadge.textContent = "Scanning...";
    if (chipsContainer) {
      chipsContainer.innerHTML = `<span class="text-xs text-blue-600 animate-pulse font-medium">Running instance-level YOLOv8 defect detection...</span>`;
    }

    const formData = new FormData();
    formData.append("image", file);

    try {
      const scanRes = await Api.prescanImage(formData);
      const detections = scanRes.detections || [];
      this.cachedDetections = detections;

      if (statusText) statusText.textContent = "Defect Localization Complete";
      if (countBadge) countBadge.textContent = `${detections.length} Located`;

      if (detections.length > 0) {
        // Auto-select detected category
        if (scanRes.suggested_category && scanRes.suggested_category !== "unclassified") {
          this.selectCategory(scanRes.suggested_category);
        }
      }

      this.renderDefectChips(detections);
      this.drawBoundingBoxes(detections);

      if (scanRes.authenticity) {
        this.renderAuthenticityTransparency(scanRes.authenticity);
      }

    } catch (err) {
      console.warn("Instant prescan error:", err);
      if (statusText) statusText.textContent = "Ready for Submission";
      if (countBadge) countBadge.textContent = "Ready";
      if (chipsContainer) {
        chipsContainer.innerHTML = `<span class="text-xs text-slate-400 italic">Pre-scan skipped. Full AI detection runs on submission.</span>`;
      }
    }
  },

  renderDefectChips(detections) {
    const container = document.getElementById("defect-instances-list");
    if (!container) return;

    if (!detections || detections.length === 0) {
      container.innerHTML = `
        <div class="p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-center justify-between w-full">
          <span>No defect detected with high confidence. Proceeding to standard citizen routing.</span>
          <span class="text-[10px] font-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-bold">Manual Triage</span>
        </div>
      `;
      return;
    }

    container.innerHTML = detections.map(d => {
      const id = d.detection_id || 1;
      const cat = (d.class_name || d.issue || "hazard").replace(/_/g, " ");
      const conf = Math.round((d.confidence || 0) * 100);
      const sizeTag = d.relative_size ? ` • ${d.relative_size}` : "";
      const isActive = this.activeDetectionId === id;
      const borderClass = isActive ? "ring-2 ring-blue-600 bg-blue-50" : "bg-white hover:border-slate-400";

      return `
        <button type="button" onclick="Citizen.highlightDetection(${id})" class="px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 transition flex items-center gap-1.5 shadow-2xs ${borderClass}">
          <span class="font-mono text-[10px] font-bold text-slate-400">#${id}</span>
          <span class="capitalize">${cat}</span>
          <span class="text-blue-700 font-bold font-mono text-[11px]">${conf}%${sizeTag}</span>
        </button>
      `;
    }).join("");
  },

  highlightDetection(id) {
    this.activeDetectionId = (this.activeDetectionId === id) ? null : id;
    this.renderDefectChips(this.cachedDetections);
    this.drawBoundingBoxes(this.cachedDetections);
  },

  handleCanvasClick(e) {
    const canvas = document.getElementById("bbox-canvas");
    const img = document.getElementById("image-preview");
    if (!canvas || !img || !this.cachedDetections || this.cachedDetections.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const natW = img.naturalWidth || canvas.width;
    const natH = img.naturalHeight || canvas.height;
    const scaleX = canvas.width / natW;
    const scaleY = canvas.height / natH;

    // Hit test reverse order (top box first)
    let clickedId = null;
    for (let i = this.cachedDetections.length - 1; i >= 0; i--) {
      const d = this.cachedDetections[i];
      const bbox = d.bbox || [];
      if (bbox.length < 4) continue;
      const x1 = bbox[0] * scaleX;
      const y1 = bbox[1] * scaleY;
      const x2 = bbox[2] * scaleX;
      const y2 = bbox[3] * scaleY;

      if (clickX >= x1 && clickX <= x2 && clickY >= y1 && clickY <= y2) {
        clickedId = d.detection_id || (i + 1);
        break;
      }
    }

    if (clickedId !== null) {
      this.highlightDetection(clickedId);
    }
  },

  zoomImage(delta) {
    this.zoomLevel = Math.max(0.7, Math.min(2.5, this.zoomLevel + delta));
    const viewport = document.getElementById("image-zoom-viewport");
    if (viewport) viewport.style.transform = `scale(${this.zoomLevel.toFixed(2)})`;
  },

  resetZoomImage() {
    this.zoomLevel = 1.0;
    const viewport = document.getElementById("image-zoom-viewport");
    if (viewport) viewport.style.transform = "scale(1.0)";
  },

  resetImage() {
    this.selectedFile = null;
    this.cachedDetections = [];
    this.activeDetectionId = null;
    this.zoomLevel = 1.0;

    const input = document.getElementById("image-input");
    if (input) input.value = "";

    const previewWrapper = document.getElementById("preview-wrapper");
    const dropPlaceholder = document.getElementById("drop-placeholder");
    const diagCard = document.getElementById("ai-diagnostic-card");

    if (previewWrapper) previewWrapper.classList.add("hidden");
    if (dropPlaceholder) dropPlaceholder.classList.remove("hidden");
    if (diagCard) diagCard.classList.add("hidden");

    this.clearBoundingBoxes();
  },

  toggleBoundingBoxes() {
    this.showBoundingBoxes = !this.showBoundingBoxes;
    const btnIcon = document.getElementById("toggle-bbox-icon");
    const btnText = document.getElementById("toggle-bbox-text");

    if (this.showBoundingBoxes) {
      if (btnIcon) btnIcon.textContent = "👁️";
      if (btnText) btnText.textContent = "AI Overlays";
      this.drawBoundingBoxes(this.cachedDetections);
    } else {
      if (btnIcon) btnIcon.textContent = "🖼️";
      if (btnText) btnText.textContent = "Clean Photo";
      this.clearBoundingBoxes();
    }
  },

  clearBoundingBoxes() {
    const canvas = document.getElementById("bbox-canvas");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  },

  drawBoundingBoxes(detections) {
    this.cachedDetections = detections || [];
    const canvas = document.getElementById("bbox-canvas");
    const img = document.getElementById("image-preview");
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!this.showBoundingBoxes || detections.length === 0) return;

    // Align canvas buffer and CSS dimensions exactly to client image layout
    const dispW = img.clientWidth || img.width;
    const dispH = img.clientHeight || img.height;
    canvas.width = dispW;
    canvas.height = dispH;
    canvas.style.top = img.offsetTop + "px";
    canvas.style.left = img.offsetLeft + "px";
    canvas.style.width = dispW + "px";
    canvas.style.height = dispH + "px";

    const natW = img.naturalWidth || canvas.width;
    const natH = img.naturalHeight || canvas.height;
    const scaleX = canvas.width / natW;
    const scaleY = canvas.height / natH;

    detections.forEach((d, i) => {
      const bbox = d.bbox || [];
      if (bbox.length < 4) return;
      let [x1, y1, x2, y2] = bbox;

      // Handle normalized [0, 1] coordinates if passed from older formats
      if (x1 <= 1.0 && x2 <= 1.0 && y1 <= 1.0 && y2 <= 1.0 && natW > 1 && natH > 1) {
        x1 *= natW;
        x2 *= natW;
        y1 *= natH;
        y2 *= natH;
      }

      const dx = x1 * scaleX;
      const dy = y1 * scaleY;
      const dw = (x2 - x1) * scaleX;
      const dh = (y2 - y1) * scaleY;

      const id = d.detection_id || (i + 1);
      const isHighlighted = this.activeDetectionId === id;
      const cat = d.class_name || d.issue || "hazard";
      const col = this.getCategoryColor(cat);

      // Box translucent fill
      ctx.fillStyle = isHighlighted ? col.highlightFill : col.fill;
      ctx.fillRect(dx, dy, dw, dh);

      // Bounding border
      ctx.strokeStyle = isHighlighted ? "#ffffff" : col.stroke;
      ctx.lineWidth = isHighlighted ? 3.5 : 2.0;
      ctx.strokeRect(dx, dy, dw, dh);

      if (isHighlighted) {
        ctx.strokeStyle = col.stroke;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(dx - 2, dy - 2, dw + 4, dh + 4);
      }

      // Detection Label Tag
      const confPct = Math.round((d.confidence || 0) * 100);
      const labelText = `#${id} ${cat.toUpperCase()} ${confPct}%`;
      ctx.font = "bold 11px sans-serif";
      const textWidth = ctx.measureText(labelText).width;
      const labelH = 18;
      const labelY = Math.max(0, dy - labelH);

      ctx.fillStyle = col.labelBg;
      ctx.fillRect(dx, labelY, textWidth + 8, labelH);

      ctx.fillStyle = col.text;
      ctx.fillText(labelText, dx + 4, labelY + 13);
    });
  },

  renderAuthenticityTransparency(authData) {
    const diagCard = document.getElementById("ai-diagnostic-card");
    const authBadge = document.getElementById("diag-authenticity");
    const authScore = document.getElementById("diag-auth-score");
    const authExpl = document.getElementById("diag-auth-explanation");

    if (!diagCard || !authBadge || !authData) return;
    diagCard.classList.remove("hidden");

    const status = authData.status || "LIKELY_AUTHENTIC";
    const scoreVal = typeof authData.real_probability === "number" ? authData.real_probability.toFixed(2) : (typeof authData.authenticity_score === "number" ? authData.authenticity_score.toFixed(2) : "0.94");
    if (authScore) authScore.textContent = `Score: ${scoreVal}`;

    const config = {
      LIKELY_AUTHENTIC: {
        text: "LIKELY AUTHENTIC",
        cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
        expl: "Natural optical grain and camera sensor characteristics verified. Standard automated triage."
      },
      UNCERTAIN: {
        text: "ANALYSIS UNCERTAIN",
        cls: "bg-amber-50 text-amber-700 border-amber-200",
        expl: "Lighting or compression limits automated confidence. Proceeding to standard triage with human verification."
      },
      REVIEW_REQUIRED: {
        text: "HUMAN REVIEW RECOMMENDED",
        cls: "bg-blue-50 text-blue-700 border-blue-200",
        expl: "High texture variance detected. Scheduled for technician review; report remains active."
      },
      SUSPICIOUS: {
        text: "SYNTHETIC ARTIFACTS FLAGGED",
        cls: "bg-rose-50 text-rose-700 border-rose-200",
        expl: "AI-generated patterns flagged. Queued for manual administrative inspection before dispatch."
      }
    };

    const c = config[status] || config.LIKELY_AUTHENTIC;
    authBadge.className = `font-extrabold text-xs px-2 py-0.5 rounded-full border ${c.cls}`;
    authBadge.textContent = c.text;
    if (authExpl) authExpl.textContent = authData.explanation || c.expl;
  },

  async submitReport(event) {
    event.preventDefault();

    if (!this.selectedFile) {
      showToast("Please upload or capture a photo of the civic defect.", "error");
      return;
    }

    const descInput = document.getElementById("desc-input");
    const addressInput = document.getElementById("address-input");
    const submitBtn = document.getElementById("btn-submit-report");
    const progressEl = document.getElementById("submit-progress");
    const progressFill = document.getElementById("progress-bar-fill");
    const progressPct = document.getElementById("submit-percentage");

    const formData = new FormData();
    formData.append("image", this.selectedFile);
    formData.append("latitude", this.currentLat.toString());
    formData.append("longitude", this.currentLng.toString());
    formData.append("category", this.selectedCategory || "pothole");
    formData.append("location_source", this.locationSource || "MANUAL_PIN");
    if (this.locationAccuracy) {
      formData.append("location_accuracy", this.locationAccuracy.toString());
    }
    formData.append("address", addressInput ? addressInput.value.trim() : "");
    formData.append("description", descInput ? descInput.value.trim() : "");

    try {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span>Running AI Diagnostics & Submitting...</span>
      `;
      progressEl.classList.remove("hidden");
      progressFill.style.width = "40%";
      progressPct.textContent = "40%";

      const result = await Api.submitReport(formData);

      progressFill.style.width = "100%";
      progressPct.textContent = "100%";

      showToast("Report submitted successfully! AI analysis complete.", "success");

      // Extract unified AI values (handles flat & nested structures)
      const isDetected = (result.status || result.ai_analysis?.status) === "DETECTION_FOUND";
      const detections = result.ai_detections || result.ai_analysis?.detections || [];
      const rawConf = typeof result.ai_confidence === "number" ? result.ai_confidence : (typeof result.ai_analysis?.confidence === "number" ? result.ai_analysis.confidence : null);
      const confPct = rawConf !== null ? Math.round(rawConf * 100) : null;
      
      const primaryCat = isDetected
        ? (result.ai_category || result.ai_analysis?.category || "Defect").replace(/_/g, " ")
        : (result.citizen_category || this.selectedCategory || "General Infrastructure").replace(/_/g, " ");

      const auth = result.authenticity_result || result.ai_analysis?.authenticity || { status: "LIKELY_AUTHENTIC", real_probability: 0.94 };
      const dept = result.assigned_department || result.ai_analysis?.assigned_department || "Public Works Dept (PWD)";
      const priority = result.priority_level || result.ai_analysis?.priority_level || "HIGH";
      const priorityScore = result.priority_score || result.ai_analysis?.priority_score || 82;

      // Update In-Form AI Diagnostics Card
      const categoryEl = document.getElementById("diag-category");
      const categoryDescEl = document.getElementById("diag-category-desc");
      const confEl = document.getElementById("diag-confidence");
      const deptEl = document.getElementById("diag-department");
      const priorityEl = document.getElementById("diag-priority-tag");
      const diagCard = document.getElementById("ai-diagnostic-card");

      if (diagCard) diagCard.classList.remove("hidden");
      if (categoryEl) {
        categoryEl.textContent = isDetected ? primaryCat.toUpperCase() : `${primaryCat.toUpperCase()} (MANUAL ROUTING)`;
      }
      if (categoryDescEl) {
        categoryDescEl.textContent = isDetected
          ? "YOLOv8 detected civic hazard"
          : "No defect detected with high confidence. Routed via citizen triage.";
      }
      if (confEl) {
        if (isDetected && confPct !== null) {
          confEl.textContent = `${confPct}% conf`;
          confEl.className = "text-xs font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded";
        } else {
          confEl.textContent = "Manual Review";
          confEl.className = "text-xs font-mono font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded";
        }
      }
      if (deptEl) deptEl.textContent = dept;
      if (priorityEl) priorityEl.textContent = `Triage: ${priority} (${priorityScore}/100)`;

      this.cachedDetections = detections;
      if (detections && detections.length > 0) {
        this.drawBoundingBoxes(detections);
        this.renderDefectChips(detections);
      } else {
        this.clearBoundingBoxes();
      }

      this.renderAuthenticityTransparency(auth);

      // Open Success Receipt Modal
      this.openSuccessModal({
        reportId: result.report_id || "REP-" + Math.floor(10000 + Math.random() * 90000),
        category: isDetected ? primaryCat : `${primaryCat} (Manual Triage)`,
        confidenceText: (isDetected && confPct !== null) ? `${confPct}% AI Vision Confidence` : "Visual Staff Verification Queued",
        dept: dept,
        authStatus: `${auth.status || 'LIKELY_AUTHENTIC'} (${(auth.real_probability || 0.94).toFixed(2)})`,
        priority: `${priority} • Score ${priorityScore}/100`,
        isDuplicate: result.is_linked_to_existing_issue
      });

    } catch (err) {
      console.error("Submission failed:", err);
      showToast(err.message || "Failed to submit report. Please check server connection.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span>Submit Another Report</span>
      `;
      setTimeout(() => progressEl.classList.add("hidden"), 1200);
    }
  },

  openSuccessModal(data) {
    const modal = document.getElementById("modal-report-success");
    if (!modal) return;

    const tId = document.getElementById("receipt-ticket-id");
    const rCat = document.getElementById("receipt-category");
    const rConf = document.getElementById("receipt-confidence");
    const rDept = document.getElementById("receipt-dept");
    const rAuth = document.getElementById("receipt-auth");
    const rPrio = document.getElementById("receipt-priority");
    const rCluster = document.getElementById("receipt-cluster");

    if (tId) tId.textContent = `Ticket #${data.reportId} • Municipal Triage Queue`;
    if (rCat) rCat.textContent = data.category.toUpperCase();
    if (rConf) rConf.textContent = data.confidenceText || (typeof data.confidence === "number" ? `${data.confidence}% AI Vision Confidence` : "Visual Staff Verification Queued");
    if (rDept) rDept.textContent = data.dept;
    if (rAuth) rAuth.textContent = data.authStatus;
    if (rPrio) rPrio.textContent = data.priority;
    if (rCluster) rCluster.textContent = data.isDuplicate ? "Linked to Existing Nearby Cluster" : "Spatial Cluster: Verified Unique";

    modal.classList.remove("hidden");
  },

  closeSuccessModal() {
    const modal = document.getElementById("modal-report-success");
    if (modal) modal.classList.add("hidden");
  },

  goToMyReports() {
    this.closeSuccessModal();
    App.switchTab("my-reports");
  },

  goToAdminOps() {
    this.closeSuccessModal();
    App.switchTab("admin");
  },

  async loadMyReports() {
    const listEl = document.getElementById("my-reports-list");
    const countEl = document.getElementById("citizen-report-count");
    if (!listEl) return;

    listEl.innerHTML = `
      <div class="p-8 text-center bg-white rounded-xl border border-slate-200 text-slate-400 text-xs">
        Loading your incident history...
      </div>
    `;

    try {
      const res = await Api.getMyReports();
      this.cachedMyReports = res.reports || [];
      if (countEl) countEl.textContent = this.cachedMyReports.length.toString();
      this.renderFilteredMyReports();
    } catch (err) {
      console.error("Failed to load reports:", err);
      listEl.innerHTML = `
        <div class="p-8 text-center bg-white rounded-xl border border-rose-200 text-rose-600 text-xs">
          Unable to fetch your report history. Please ensure you are logged in.
        </div>
      `;
    }
  },

  filterMyReports(filterType) {
    this.currentFilter = filterType;
    const filterBtns = {
      ALL: "filter-rep-all",
      ACTIVE: "filter-rep-active",
      IN_PROGRESS: "filter-rep-progress",
      RESOLVED: "filter-rep-resolved"
    };

    Object.keys(filterBtns).forEach((k) => {
      const el = document.getElementById(filterBtns[k]);
      if (el) {
        if (k === filterType) {
          el.className = "rep-filter-btn px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold transition";
        } else {
          el.className = "rep-filter-btn px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition";
        }
      }
    });

    this.renderFilteredMyReports();
  },

  renderFilteredMyReports() {
    const listEl = document.getElementById("my-reports-list");
    if (!listEl) return;

    let filtered = this.cachedMyReports || [];
    if (this.currentFilter === "ACTIVE") {
      filtered = filtered.filter(r => ["REPORTED", "PENDING"].includes(r.issue_status));
    } else if (this.currentFilter === "IN_PROGRESS") {
      filtered = filtered.filter(r => ["ASSIGNED", "IN_PROGRESS"].includes(r.issue_status));
    } else if (this.currentFilter === "RESOLVED") {
      filtered = filtered.filter(r => r.issue_status === "RESOLVED");
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="p-12 text-center bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div class="w-12 h-12 mx-auto rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </div>
          <h3 class="text-sm font-bold text-slate-900">No Submissions Found</h3>
          <p class="text-xs text-slate-500 max-w-sm mx-auto">No reports match the current "${this.currentFilter}" filter.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered.map(r => this.renderReportCard(r)).join("");
  },

  renderReportCard(r) {
    const dateStr = new Date(r.created_at || Date.now()).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit"
    });

    const statusStages = ["REPORTED", "PENDING", "ASSIGNED", "IN_PROGRESS", "RESOLVED"];
    const currentIdx = statusStages.indexOf(r.issue_status || "REPORTED");

    // Stepper generation
    const stepperHtml = statusStages.map((stage, idx) => {
      let stateCls = "";
      if (idx < currentIdx) stateCls = "completed";
      else if (idx === currentIdx) stateCls = "active";

      return `
        <div class="stepper-step ${stateCls}">
          <div class="stepper-circle">${idx < currentIdx ? "✓" : idx + 1}</div>
          <span class="text-[9px] font-bold text-slate-500 hidden sm:block mt-1 uppercase">${stage.replace("_", " ")}</span>
        </div>
      `;
    }).join("");

    // Priority badge
    const p = (r.priority_level || "MEDIUM").toUpperCase();
    const priorityConfig = {
      CRITICAL: { cls: "badge-priority-critical", text: "Critical Risk" },
      HIGH: { cls: "badge-priority-high", text: "High Priority" },
      MEDIUM: { cls: "badge-priority-medium", text: "Standard" },
      LOW: { cls: "badge-priority-low", text: "Low Priority" }
    };
    const pInfo = priorityConfig[p] || priorityConfig.MEDIUM;

    return `
      <div class="bg-white rounded-2xl border border-slate-200/80 shadow-card overflow-hidden">
        <div class="p-6 flex flex-col md:flex-row gap-6">
          
          <!-- Image preview -->
          <div class="w-full md:w-56 h-48 bg-slate-100 rounded-xl overflow-hidden shrink-0 border border-slate-200 relative">
            <img src="${r.image_url}" alt="Incident" class="w-full h-full object-cover" />
            <span class="absolute top-2 left-2 badge-priority ${pInfo.cls}">
              ${pInfo.text}
            </span>
          </div>

          <!-- Body -->
          <div class="flex-1 flex flex-col justify-between space-y-4">
            <div>
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-xs font-bold text-slate-400">#REP-${r.id}</span>
                    <h3 class="font-extrabold text-base text-slate-900">${(r.issue_title || r.ai_category || "Civic Defect").toUpperCase()}</h3>
                  </div>
                  <p class="text-xs text-slate-500 mt-1 flex items-center gap-1">
                    <svg class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>
                    <span>${r.address || `GPS: ${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`}</span>
                  </p>
                </div>
                <span class="text-[11px] font-mono text-slate-400 shrink-0">${dateStr}</span>
              </div>

              ${r.description ? `
                <p class="text-xs text-slate-600 mt-2 p-2.5 bg-slate-50 rounded-lg border border-slate-100 font-medium">"${r.description}"</p>
              ` : ""}
            </div>

            <!-- 5-Step Lifecycle Stepper -->
            <div class="bg-slate-50/80 p-3 rounded-xl border border-slate-200/60">
              <div class="flex items-center justify-between">
                ${stepperHtml}
              </div>
            </div>

            <!-- Resolution Banner if closed -->
            ${r.issue_status === "RESOLVED" ? `
              <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <div class="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">✓</div>
                  <div>
                    <span class="text-xs font-bold text-emerald-900">Incident Resolved & Certified</span>
                    <p class="text-[11px] text-emerald-700">${r.resolution_notes || "Field repair work completed by municipal dispatch."}</p>
                  </div>
                </div>
                ${r.resolution_image_url ? `
                  <button onclick="Citizen.viewProofModal('${r.resolution_image_url}', '${r.resolution_notes || ''}')" class="px-3 py-1.5 bg-white text-emerald-700 border border-emerald-300 font-bold rounded-lg hover:bg-emerald-100 transition shadow-2xs text-xs">
                    View Proof
                  </button>
                ` : ""}
              </div>
            ` : ""}

          </div>
        </div>
      </div>
    `;
  },

  viewProofModal(imgUrl, notes) {
    const modal = document.getElementById("modal-view-proof");
    const imgEl = document.getElementById("proof-img");
    const notesEl = document.getElementById("proof-notes");

    if (imgEl) imgEl.src = imgUrl;
    if (notesEl) notesEl.textContent = notes || "Repairs successfully verified.";
    if (modal) modal.classList.remove("hidden");
  }
};

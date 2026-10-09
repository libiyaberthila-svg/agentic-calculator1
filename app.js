// Daily Commute Decision Agent Frontend Controller (Agentic 2.1 with Interactive Leaflet Map & GPS Telemetry)

let currentUser = "demo_commuter";
let currentSessionId = null;
let currentOptions = [];
let selectedSeat = null;
let availableSeatsData = [];
let latestReceiptData = null;
let currentTripId = "TRIP-demo";

// Live Map Variables
let liveMap = null;
let mapTileLayer = null;
let vehicleMarker = null;
let routePolyline = null;
let stationMarkers = [];
let simulationTimer = null;
let simProgress = 35.0; // percentage

// Sample Commute Coordinates Corridor (Bengaluru Metro / Express Transit Corridor)
const WAYPOINTS = [
  { name: "North Station", lat: 12.9716, lon: 77.5946, isOrigin: true },
  { name: "Tech Park Interchange", lat: 12.9850, lon: 77.6150 },
  { name: "Metro Central Terminal", lat: 13.0020, lon: 77.6400 },
  { name: "Financial District", lat: 13.0250, lon: 77.6700, isDest: true }
];

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initDefaults();
  checkHealth();
  loadUserAndWallet();
  loadPreferences();
  loadRAGDocuments();
  loadBookings();
  loadRegisteredTools();
  loadSeatMap("opt_train_exp_101");
  setupEventListeners();

  // Initialize Map when tracking tab is activated
  const trackingTabEl = document.getElementById("tracking-tab");
  if (trackingTabEl) {
    trackingTabEl.addEventListener("shown.bs.tab", () => {
      initOrRefreshMap();
    });
  }
});

// ----------------------------------------------------
// Theme Management (Dark / Light)
// ----------------------------------------------------
function initTheme() {
  const savedTheme = localStorage.getItem("commute_theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const newTheme = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem("commute_theme", newTheme);
  updateThemeIcon(newTheme);
  updateMapTiles(newTheme);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById("themeIcon");
  if (!icon) return;
  if (theme === "light") {
    icon.className = "bi bi-sun text-warning fs-6";
  } else {
    icon.className = "bi bi-moon-stars text-light fs-6";
  }
}

function initDefaults() {
  const today = new Date().toISOString().split("T")[0];
  const journeyDateEl = document.getElementById("journeyDateInput");
  if (journeyDateEl) journeyDateEl.value = today;
}

// ----------------------------------------------------
// Interactive Map (Leaflet)
// ----------------------------------------------------
function initOrRefreshMap() {
  if (typeof L === "undefined") return;

  const mapContainer = document.getElementById("liveMap");
  if (!mapContainer) return;

  if (!liveMap) {
    // Initial Map Setup centered on transit corridor
    liveMap = L.map("liveMap", {
      zoomControl: true,
      scrollWheelZoom: true
    }).setView([12.9980, 77.6300], 12);

    const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
    updateMapTiles(currentTheme);

    // Draw route line
    const latlngs = WAYPOINTS.map(w => [w.lat, w.lon]);
    routePolyline = L.polyline(latlngs, {
      color: '#38bdf8',
      weight: 5,
      opacity: 0.85,
      dashArray: '1, 8'
    }).addTo(liveMap);

    // Add station markers
    stationMarkers = WAYPOINTS.map((w) => {
      const isEndpoint = w.isOrigin || w.isDest;
      const marker = L.circleMarker([w.lat, w.lon], {
        radius: isEndpoint ? 8 : 6,
        fillColor: w.isOrigin ? '#10b981' : (w.isDest ? '#f59e0b' : '#3b82f6'),
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9
      }).addTo(liveMap);

      marker.bindPopup(`<strong>${w.name}</strong><br><span class="small text-muted">${w.isOrigin ? 'Origin Station' : (w.isDest ? 'Final Destination' : 'Corridor Stop')}</span>`);
      return marker;
    });

    // Custom Vehicle Animated Marker
    const vehicleIcon = L.divIcon({
      className: 'custom-vehicle-icon',
      html: `<div class="vehicle-marker-icon"><i class="bi bi-train-front-fill"></i></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    // Position vehicle at current interpolated position
    const currentCoord = interpolateCoord(simProgress / 100.0);
    vehicleMarker = L.marker([currentCoord.lat, currentCoord.lon], { icon: vehicleIcon }).addTo(liveMap);
    vehicleMarker.bindPopup(`<strong>Express Rail Line 9 (Active)</strong><br>Speed: <span id="popupSpeed">54.2</span> km/h`);
  } else {
    setTimeout(() => {
      liveMap.invalidateSize();
    }, 150);
  }
}

function updateMapTiles(theme) {
  if (!liveMap) return;
  if (mapTileLayer) {
    liveMap.removeLayer(mapTileLayer);
  }

  if (theme === "dark") {
    // CartoDB Dark Matter tiles
    mapTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(liveMap);
  } else {
    // OpenStreetMap standard tiles
    mapTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(liveMap);
  }
}

function interpolateCoord(fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  const totalSegments = WAYPOINTS.length - 1;
  const scaled = f * totalSegments;
  const index = Math.floor(scaled);
  const remainder = scaled - index;

  if (index >= totalSegments) {
    return { lat: WAYPOINTS[totalSegments].lat, lon: WAYPOINTS[totalSegments].lon };
  }

  const p1 = WAYPOINTS[index];
  const p2 = WAYPOINTS[index + 1];

  const lat = p1.lat + (p2.lat - p1.lat) * remainder;
  const lon = p1.lon + (p2.lon - p1.lon) * remainder;
  return { lat, lon };
}

// ----------------------------------------------------
// Health Check & User Wallet
// ----------------------------------------------------
async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    if (res.ok) {
      const data = await res.json();
      const badge = document.getElementById("backendStatusBadge");
      if (badge) {
        badge.className = "badge bg-success d-none d-md-inline";
        badge.innerHTML = `<i class="bi bi-check-circle-fill me-1"></i>Agent Online (${data.registered_tools_count} Tools)`;
      }
    }
  } catch (err) {
    const badge = document.getElementById("backendStatusBadge");
    if (badge) {
      badge.className = "badge bg-danger d-none d-md-inline";
      badge.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-1"></i>Disconnected`;
    }
  }
}

async function loadUserAndWallet() {
  try {
    const res = await fetch(`/api/auth/user?username=${currentUser}`);
    if (res.ok) {
      const data = await res.json();
      currentUser = data.username;
      document.getElementById("navUsername").innerText = data.display_name || data.username;
      const formattedBal = data.wallet_balance.toLocaleString("en-IN", { minimumFractionDigits: 2 });
      document.getElementById("navWalletBalance").innerText = formattedBal;
      document.getElementById("modalWalletBalance").innerText = formattedBal;
      loadWalletTransactions();
    }
  } catch (err) {
    console.error("Failed to load wallet", err);
  }
}

async function quickTopup(amount) {
  try {
    const res = await fetch("/api/wallet/topup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: currentUser,
        amount: amount,
        description: `Simulated Demo Wallet Top-Up (+₹${amount})`
      })
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    alert(`Top-up successful! Added ₹${amount} to simulated demo wallet.`);
    loadUserAndWallet();
  } catch (err) {
    alert("Top-up failed: " + err.message);
  }
}

async function loadWalletTransactions() {
  try {
    const res = await fetch(`/api/wallet/transactions?user_id=${currentUser}`);
    if (!res.ok) return;
    const txns = await res.json();
    const tbody = document.getElementById("walletTxnTableBody");
    if (!tbody) return;
    if (!txns || txns.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No transactions recorded yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = txns.map((t) => `
      <tr>
        <td><code>${t.txn_id}</code></td>
        <td><span class="badge ${t.txn_type === 'CREDIT' ? 'bg-success' : 'bg-danger'}">${t.txn_type}</span></td>
        <td class="fw-bold ${t.txn_type === 'CREDIT' ? 'text-success' : 'text-danger'}">${t.txn_type === 'CREDIT' ? '+' : '-'}₹${t.amount.toFixed(2)}</td>
        <td>₹${t.balance_after.toFixed(2)}</td>
        <td class="small">${t.description}</td>
        <td class="small text-muted">${new Date(t.timestamp).toLocaleTimeString()}</td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Error loading transactions", err);
  }
}

// ----------------------------------------------------
// Event Listeners
// ----------------------------------------------------
function setupEventListeners() {
  // Theme Toggle
  document.getElementById("themeToggleBtn").addEventListener("click", toggleTheme);

  // Login Form
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = document.getElementById("loginUsername").value;
    const p = document.getElementById("loginPassword").value;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p })
      });
      if (!res.ok) throw new Error("Invalid username or password");
      const user = await res.json();
      currentUser = user.username;
      loadUserAndWallet();
      bootstrap.Modal.getInstance(document.getElementById("loginModal")).hide();
      alert(`Signed in as ${user.display_name}!`);
    } catch (err) {
      alert("Login Error: " + err.message);
    }
  });

  // Plan commute form submit
  document.getElementById("commuteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await runCommutePlan();
  });

  // Manual booking button
  document.getElementById("manualBookBtn").addEventListener("click", async () => {
    await executeManualBooking();
  });

  // Refresh bookings button
  document.getElementById("refreshBookingsBtn").addEventListener("click", () => {
    loadBookings();
  });

  // Verify booking button
  document.getElementById("verifyBtn").addEventListener("click", async () => {
    const bId = document.getElementById("verifyBookingIdInput").value.trim();
    if (bId) await verifyBooking(bId);
  });

  // Disruption simulation button
  document.getElementById("triggerDisruptionBtn").addEventListener("click", async () => {
    await triggerDisruption();
  });

  // RAG upload form
  document.getElementById("ragUploadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await uploadRAGDocument();
  });

  // RAG query button
  document.getElementById("ragQueryBtn").addEventListener("click", async () => {
    await runRAGQuery();
  });

  // Preferences form
  document.getElementById("prefsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    await savePreferences();
  });

  // View Receipt Button
  document.getElementById("viewReceiptBtn").addEventListener("click", () => {
    if (latestReceiptData) {
      showReceiptModal(latestReceiptData);
    }
  });

  // Advance Live Tracking Simulation (Step Forward)
  document.getElementById("advanceTrackingBtn").addEventListener("click", async () => {
    advanceSimStep(15.0);
  });

  // Auto Play Simulation
  document.getElementById("autoPlaySimBtn").addEventListener("click", () => {
    startAutoPlaySim();
  });

  // Pause Simulation
  document.getElementById("pauseSimBtn").addEventListener("click", () => {
    pauseAutoPlaySim();
  });

  // Reset Simulation
  document.getElementById("resetSimBtn").addEventListener("click", () => {
    resetSim();
  });
}

// ----------------------------------------------------
// Run Commute Plan
// ----------------------------------------------------
async function runCommutePlan() {
  const btn = document.getElementById("planBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Agent Working...`;

  const payload = {
    user_id: currentUser,
    origin: document.getElementById("originInput").value,
    destination: document.getElementById("destinationInput").value,
    journey_date: document.getElementById("journeyDateInput").value,
    desired_arrival_time: document.getElementById("targetArrivalInput").value,
    budget_limit: parseFloat(document.getElementById("budgetInput").value),
    ranking_strategy: document.getElementById("strategyInput").value,
    passenger_name: document.getElementById("passengerNameInput").value,
    passenger_count: 1,
    seat_preference: document.getElementById("seatPrefInput").value,
    payment_mode: document.getElementById("paymentModeInput").value,
    auto_book: document.getElementById("autoBookToggle").checked,
    auto_book_authorized: document.getElementById("authConsentToggle").checked
  };

  try {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    currentSessionId = data.session_id;
    currentTripId = `TRIP-${currentSessionId}`;
    currentOptions = data.all_options || [];

    document.getElementById("activeSessionBadge").innerText = `Session: ${currentSessionId}`;
    renderCommuteResults(data);
    renderTraces(data.steps_executed || []);
    loadBookings();
    loadUserAndWallet();
  } catch (err) {
    alert("Agent planning failed: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="bi bi-play-circle me-2"></i>Run Autonomous Agent Plan`;
  }
}

// ----------------------------------------------------
// Render Commute Results
// ----------------------------------------------------
function renderCommuteResults(data) {
  const container = document.getElementById("optionsContainer");
  const explanationBox = document.getElementById("explanationBox");
  const explanationText = document.getElementById("explanationText");
  const bookingAlert = document.getElementById("bookingResultAlert");
  const bookingDetails = document.getElementById("bookingResultDetails");
  const disruptionBanner = document.getElementById("disruptionBanner");

  explanationBox.classList.remove("d-none");
  explanationText.innerHTML = data.decision_explanation || "Evaluation complete.";

  if (data.disruption_detected) {
    disruptionBanner.classList.remove("d-none");
    document.getElementById("disruptionText").innerText = "Route plan dynamically adjusted following real-time disruption broadcast.";
  } else {
    disruptionBanner.classList.add("d-none");
  }

  if (data.booking_result && data.booking_result.status === "CONFIRMED") {
    latestReceiptData = data.booking_result.receipt || {
      receipt_id: `RCPT-${data.booking_result.booking_id}`,
      booking_id: data.booking_result.booking_id,
      passenger_name: data.booking_result.passenger_name,
      origin: data.booking_result.origin,
      destination: data.booking_result.destination,
      departure_time: data.booking_result.departure_time,
      arrival_time: data.booking_result.arrival_time,
      seat_number: data.booking_result.seat_number,
      seat_type: data.booking_result.seat_type,
      total_paid: data.booking_result.total_amount,
      currency: "INR",
      payment_mode: data.booking_result.payment_mode,
      payment_status: data.booking_result.payment_status,
      timestamp: data.booking_result.created_at
    };

    bookingAlert.classList.remove("d-none");
    bookingDetails.innerHTML = `
      Booking ID: <code>${data.booking_result.booking_id}</code> |
      Seat: <strong>${data.booking_result.seat_number} (${data.booking_result.seat_type})</strong> |
      Total: <strong>₹${data.booking_result.total_amount.toFixed(2)}</strong> |
      Payment: <span class="badge ${data.booking_result.payment_status === 'PAID' ? 'bg-success' : 'bg-warning'}">${data.booking_result.payment_mode} (${data.booking_result.payment_status})</span>
    `;
  } else {
    bookingAlert.classList.add("d-none");
  }

  if (!data.all_options || data.all_options.length === 0) {
    container.innerHTML = `<div class="col-12 text-center py-4 text-danger">No commute options found.</div>`;
    return;
  }

  container.innerHTML = data.all_options.map((opt) => {
    const isRec = data.recommended_option && data.recommended_option.id === opt.id;
    const modeIcons = {
      express_train: "bi-train-front text-info",
      metro: "bi-subway text-primary",
      bus: "bi-bus-front text-warning",
      rideshare: "bi-car-front text-success"
    };
    const icon = modeIcons[opt.mode] || "bi-signpost text-light";

    return `
      <div class="col-md-6">
        <div class="card commute-card ${isRec ? 'recommended' : ''} ${!opt.is_eligible ? 'ineligible' : ''} p-3">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div class="d-flex align-items-center gap-2">
              <i class="bi ${icon} fs-4"></i>
              <div>
                <h6 class="mb-0 fw-bold">${opt.title}</h6>
                <span class="small text-muted">${opt.origin} → ${opt.destination}</span>
              </div>
            </div>
            ${isRec ? '<span class="badge bg-success"><i class="bi bi-star-fill me-1"></i>Top Choice</span>' : ''}
            ${!opt.is_eligible ? '<span class="badge bg-danger">Rejected</span>' : ''}
          </div>

          <div class="row g-2 text-center my-2 py-2 bg-dark rounded border border-secondary">
            <div class="col-4">
              <div class="small text-muted">Departure</div>
              <div class="fw-bold">${opt.departure_time}</div>
            </div>
            <div class="col-4">
              <div class="small text-muted">Arrival</div>
              <div class="fw-bold text-success">${opt.arrival_time}</div>
            </div>
            <div class="col-4">
              <div class="small text-muted">Duration</div>
              <div class="fw-bold">${opt.duration_minutes} min</div>
            </div>
          </div>

          <div class="d-flex justify-content-between align-items-center mt-2">
            <div>
              <span class="fs-5 fw-bold text-primary">₹${opt.total_fare.toFixed(2)}</span>
              <span class="small text-muted ms-1">(Reliability: ${(opt.reliability_score * 100).toFixed(0)}%)</span>
            </div>
            ${opt.requires_booking ? `
              <button class="btn btn-sm btn-outline-info" onclick="switchToSeatBooking('${opt.id}')">
                <i class="bi bi-ticket-perforated me-1"></i>Select Seat
              </button>
            ` : '<span class="badge bg-secondary">Direct Boarding</span>'}
          </div>

          ${opt.rejection_reasons && opt.rejection_reasons.length > 0 ? `
            <div class="small text-danger mt-2 border-top border-secondary pt-1">
              <i class="bi bi-x-circle me-1"></i>${opt.rejection_reasons.join(', ')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");
}

// ----------------------------------------------------
// Render Workflow Traces
// ----------------------------------------------------
function renderTraces(steps) {
  const container = document.getElementById("traceTimelineContainer");
  const countBadge = document.getElementById("traceCountBadge");
  countBadge.innerText = `${steps.length} Stages Executed`;

  if (!steps || steps.length === 0) {
    container.innerHTML = `<div class="text-muted py-4">No traces available.</div>`;
    return;
  }

  container.innerHTML = steps.map((step) => {
    const toolCallsHtml = (step.tool_calls || []).map((t) => `
      <div class="p-2 my-1 rounded bg-dark border border-secondary font-monospace small">
        <div class="d-flex justify-content-between text-info">
          <span><i class="bi bi-gear-wide-connected me-1"></i><strong>${t.tool_name}</strong></span>
          <span class="text-muted">${t.execution_time_ms} ms</span>
        </div>
        <div class="text-muted small text-truncate">Input: ${JSON.stringify(t.input_params)}</div>
      </div>
    `).join("");

    return `
      <div class="trace-item">
        <div class="d-flex align-items-center gap-2 mb-1">
          <span class="stage-badge stage-${step.stage}">${step.stage}</span>
          <span class="small text-muted">Step ${step.step_number}</span>
          <span class="small text-muted ms-auto">${new Date(step.timestamp).toLocaleTimeString()}</span>
        </div>
        <div class="small text-light mb-2">${step.description}</div>
        ${toolCallsHtml ? `<div class="ms-2 mb-2">${toolCallsHtml}</div>` : ''}
      </div>
    `;
  }).join("");
}

// ----------------------------------------------------
// Seat Map & Manual Booking
// ----------------------------------------------------
async function loadSeatMap(optionId) {
  try {
    const res = await fetch("/api/booking/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ option_id: optionId })
    });
    if (!res.ok) return;
    const data = await res.json();
    availableSeatsData = data.seats || [];
    renderSeatGrid(availableSeatsData);
  } catch (err) {
    console.error("Failed to load seat map", err);
  }
}

function renderSeatGrid(seats) {
  const grid = document.getElementById("seatGrid");
  grid.innerHTML = seats.map((s) => {
    let classes = "seat-btn";
    if (!s.is_available) classes += " booked";
    if (s.seat_type === "quiet") classes += " quiet";
    if (s.seat_type === "front") classes += " front";
    if (selectedSeat && selectedSeat.seat_number === s.seat_number) classes += " selected";

    return `
      <div class="${classes}" onclick="pickSeat('${s.seat_number}')">
        <div>${s.seat_number}</div>
        <div style="font-size:0.7rem;" class="text-muted">${s.seat_type}</div>
      </div>
    `;
  }).join("");
}

window.pickSeat = function(seatNum) {
  const seat = availableSeatsData.find(s => s.seat_number === seatNum);
  if (!seat || !seat.is_available) return;
  selectedSeat = seat;
  document.getElementById("selectedSeatBadge").innerText = `${seat.seat_number} (${seat.seat_type})`;
  const baseFare = 180.0;
  const total = baseFare + (seat.extra_fee || 0);
  document.getElementById("bookingFareText").innerText = `₹${total.toFixed(2)}`;
  renderSeatGrid(availableSeatsData);
};

window.switchToSeatBooking = function(optionId) {
  const tabBtn = document.getElementById("booking-tab");
  const tab = new bootstrap.Tab(tabBtn);
  tab.show();
  loadSeatMap(optionId);
};

window.switchToLiveTracking = function() {
  const tabBtn = document.getElementById("tracking-tab");
  const tab = new bootstrap.Tab(tabBtn);
  tab.show();
  initOrRefreshMap();
};

async function executeManualBooking() {
  const btn = document.getElementById("manualBookBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Confirming with Provider...`;

  const paymentMode = document.getElementById("manualBookingPaymentMode").value;

  const payload = {
    option_id: "opt_train_exp_101",
    journey_date: document.getElementById("journeyDateInput").value || new Date().toISOString().split("T")[0],
    user_id: currentUser,
    passenger_name: document.getElementById("passengerNameInput").value || "Demo Commuter",
    passenger_count: 1,
    seat_number: selectedSeat ? selectedSeat.seat_number : null,
    seat_preference: document.getElementById("seatPrefInput").value,
    max_budget: parseFloat(document.getElementById("budgetInput").value) || 2000.0,
    payment_mode: paymentMode,
    is_auto_booked: false,
    user_authorized: true,
    idempotency_key: `manual_bkg_${Date.now()}`
  };

  try {
    const res = await fetch("/api/booking/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.status === "CONFIRMED") {
      loadBookings();
      loadUserAndWallet();
      loadSeatMap("opt_train_exp_101");
      if (data.receipt) {
        showReceiptModal(data.receipt);
      } else {
        alert(`Booking Confirmed!\nBooking ID: ${data.booking_id}\nSeat: ${data.seat_number}\nPayment: ${data.payment_mode} (${data.payment_status})`);
      }
    } else {
      alert(`Booking Failed: ${data.failure_reason}`);
    }
  } catch (err) {
    alert("Error executing booking: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="bi bi-lock me-1"></i>Execute Confirmed Seat Reservation`;
  }
}

async function loadBookings() {
  try {
    const res = await fetch("/api/booking/history");
    if (!res.ok) return;
    const data = await res.json();
    const tbody = document.getElementById("bookingsTableBody");
    if (!data.bookings || data.bookings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No bookings recorded yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = data.bookings.map((b) => `
      <tr>
        <td><code>${b.booking_id}</code></td>
        <td>${b.passenger_name}</td>
        <td><span class="badge bg-secondary">${b.seat_number}</span></td>
        <td>₹${b.total_amount.toFixed(2)}</td>
        <td><span class="badge ${b.payment_status === 'PAID' ? 'bg-success' : 'bg-warning'}">${b.payment_mode || 'WALLET'} (${b.payment_status || 'PAID'})</span></td>
        <td><span class="badge ${b.status === 'CONFIRMED' ? 'bg-success' : 'bg-danger'}">${b.status}</span></td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Error loading bookings", err);
  }
}

async function verifyBooking(bId) {
  const resultBox = document.getElementById("verifyResultBox");
  resultBox.innerHTML = `<span class="text-muted">Querying provider...</span>`;
  try {
    const res = await fetch(`/api/booking/status/${bId}`);
    const data = await res.json();
    if (data.verified) {
      resultBox.innerHTML = `<div class="alert alert-success py-2 mb-0"><i class="bi bi-patch-check-fill me-1"></i><strong>VERIFIED:</strong> Seat ${data.seat_number} confirmed for ${data.passenger_name} | Payment: ${data.payment_mode} (${data.payment_status}) (Code: ${data.verification_code})</div>`;
    } else {
      resultBox.innerHTML = `<div class="alert alert-danger py-2 mb-0"><i class="bi bi-x-circle-fill me-1"></i>Verification failed: ${data.message || data.status}</div>`;
    }
  } catch (err) {
    resultBox.innerHTML = `<span class="text-danger">Verification error: ${err.message}</span>`;
  }
}

// ----------------------------------------------------
// Receipt Modal Helper
// ----------------------------------------------------
function showReceiptModal(receipt) {
  const container = document.getElementById("receiptCardContent");
  container.innerHTML = `
    <div class="receipt-watermark">SIMULATED DEMO</div>
    <div class="text-center mb-3">
      <i class="bi bi-ticket-detailed fs-1 text-success"></i>
      <h5 class="fw-bold mb-0">Autonomous Transit Receipt</h5>
      <span class="badge bg-dark border border-secondary text-muted">Receipt ID: ${receipt.receipt_id || 'RCPT-DEMO'}</span>
    </div>

    <div class="row g-2 small border-top border-bottom border-secondary py-2 mb-3">
      <div class="col-6"><span class="text-muted">Booking ID:</span> <code>${receipt.booking_id}</code></div>
      <div class="col-6"><span class="text-muted">Passenger:</span> <strong>${receipt.passenger_name}</strong></div>
      <div class="col-6"><span class="text-muted">Route:</span> ${receipt.origin} → ${receipt.destination}</div>
      <div class="col-6"><span class="text-muted">Seat:</span> <strong>${receipt.seat_number} (${receipt.seat_type})</strong></div>
      <div class="col-6"><span class="text-muted">Departure:</span> ${receipt.departure_time}</div>
      <div class="col-6"><span class="text-muted">Arrival:</span> ${receipt.arrival_time}</div>
    </div>

    <div class="d-flex justify-content-between mb-1 small">
      <span class="text-muted">Base Fare:</span>
      <span>₹${(receipt.base_fare || receipt.total_paid).toFixed(2)}</span>
    </div>
    <div class="d-flex justify-content-between mb-2 small">
      <span class="text-muted">Seat Reservation Fee:</span>
      <span>₹${(receipt.seat_fee || 0).toFixed(2)}</span>
    </div>
    <div class="d-flex justify-content-between border-top border-secondary pt-2 mb-3 fw-bold fs-6">
      <span>Total Paid / Due:</span>
      <span class="text-success">₹${receipt.total_paid.toFixed(2)}</span>
    </div>

    <div class="p-2 rounded bg-dark border border-secondary small text-center mb-2">
      Payment Mode: <strong>${receipt.payment_mode}</strong> | Status: <span class="badge ${receipt.payment_status === 'PAID' ? 'bg-success' : 'bg-warning'}">${receipt.payment_status}</span>
      ${receipt.txn_id ? `<div class="text-muted" style="font-size:0.75rem;">Transaction Ref: <code>${receipt.txn_id}</code></div>` : ''}
    </div>

    <div class="text-center text-muted" style="font-size: 0.7rem;">
      <i class="bi bi-shield-exclamation me-1"></i>${receipt.disclaimer || 'SIMULATED RECEIPT - NOT A REAL MONETARY CHARGE'}
    </div>
  `;

  const modal = new bootstrap.Modal(document.getElementById("receiptModal"));
  modal.show();
}

// ----------------------------------------------------
// Live Map Telemetry & Simulation Loop
// ----------------------------------------------------
function advanceSimStep(delta = 15.0) {
  simProgress += delta;
  if (simProgress > 100.0) {
    simProgress = 100.0;
    pauseAutoPlaySim();
  }
  updateSimView();
}

function startAutoPlaySim() {
  if (simulationTimer) clearInterval(simulationTimer);
  document.getElementById("autoPlaySimBtn").className = "btn btn-sm btn-success";
  document.getElementById("autoPlaySimBtn").innerHTML = `<i class="bi bi-arrow-repeat spin me-1"></i>Auto-Pilot Active`;

  simulationTimer = setInterval(() => {
    simProgress += 4.0;
    if (simProgress >= 100.0) {
      simProgress = 100.0;
      pauseAutoPlaySim();
    }
    updateSimView();
  }, 1200);
}

function pauseAutoPlaySim() {
  if (simulationTimer) {
    clearInterval(simulationTimer);
    simulationTimer = null;
  }
  document.getElementById("autoPlaySimBtn").className = "btn btn-sm btn-primary";
  document.getElementById("autoPlaySimBtn").innerHTML = `<i class="bi bi-play-fill me-1"></i>Start Auto-Pilot Simulation`;
}

function resetSim() {
  pauseAutoPlaySim();
  simProgress = 0.0;
  updateSimView();
}

function updateSimView() {
  const coord = interpolateCoord(simProgress / 100.0);
  
  if (vehicleMarker && liveMap) {
    vehicleMarker.setLatLng([coord.lat, coord.lon]);
    // Smooth pan
    liveMap.panTo([coord.lat, coord.lon], { animate: true, duration: 0.8 });
  }

  // Update UI Elements
  document.getElementById("trackingProgressText").innerText = `${simProgress.toFixed(0)}%`;
  document.getElementById("trackingProgressFill").style.width = `${simProgress.toFixed(0)}%`;
  document.getElementById("trackingCoords").innerText = `${coord.lat.toFixed(4)}° N, ${coord.lon.toFixed(4)}° E`;

  let currentStop = "North Station";
  let nextStop = "Tech Park Interchange";
  let speed = 54.0 + (Math.sin(simProgress) * 6.0);
  let eta = Math.max(0, Math.round((100.0 - simProgress) * 0.35));

  if (simProgress < 30) {
    currentStop = "North Station (Departed)";
    nextStop = "Tech Park Interchange";
  } else if (simProgress < 70) {
    currentStop = "Transit Corridor Sector 4";
    nextStop = "Metro Central Terminal";
  } else if (simProgress < 100) {
    currentStop = "Metro Central Terminal";
    nextStop = "Financial District";
  } else {
    currentStop = "Financial District (Arrived)";
    nextStop = "Journey Complete";
    speed = 0.0;
    eta = 0;
  }

  document.getElementById("trackingCurrentStop").innerText = currentStop;
  document.getElementById("trackingNextStop").innerText = nextStop;
  document.getElementById("hudSpeed").innerText = speed.toFixed(1);
  document.getElementById("hudEta").innerText = eta;
}

// ----------------------------------------------------
// Disruption & Re-planning
// ----------------------------------------------------
async function triggerDisruption() {
  if (!currentSessionId) {
    alert("Please run an initial Commute Plan first so the agent has an active session to re-plan.");
    return;
  }

  const btn = document.getElementById("triggerDisruptionBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Re-planning Workflow...`;

  const payload = {
    session_id: currentSessionId,
    disruption: {
      disruption_type: document.getElementById("disruptionTypeSelect").value,
      severity: "severe",
      affected_mode: document.getElementById("affectedModeSelect").value,
      delay_minutes: parseInt(document.getElementById("delayMinutesInput").value, 10),
      location: "Active Corridor",
      description: document.getElementById("disruptionDescInput").value
    },
    allow_auto_rebook: document.getElementById("replanAutoRebook").checked,
    payment_mode: document.getElementById("paymentModeInput").value
  };

  try {
    const res = await fetch("/api/replan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    
    document.getElementById("replanResultsBox").innerHTML = `
      <div class="alert alert-warning mb-3">
        <h6 class="alert-heading fw-bold"><i class="bi bi-arrow-repeat me-1"></i>Autonomous Re-plan Decision</h6>
        <p class="mb-0">${data.decision_explanation}</p>
      </div>
      <div class="p-3 bg-dark rounded border border-secondary">
        <h6 class="text-muted small text-uppercase fw-bold">New Recommended Route</h6>
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <h5 class="mb-0 text-success">${data.recommended_option ? data.recommended_option.title : 'None'}</h5>
            <span class="small text-muted">Arrival: ${data.recommended_option ? data.recommended_option.arrival_time : 'N/A'} | Fare: ₹${data.recommended_option ? data.recommended_option.total_fare.toFixed(2) : '0.00'}</span>
          </div>
          <span class="badge bg-success">Optimal Backup</span>
        </div>
      </div>
    `;

    renderCommuteResults(data);
    renderTraces(data.steps_executed || []);
    loadUserAndWallet();
  } catch (err) {
    alert("Re-planning error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="bi bi-radioactive me-2"></i>Broadcast Disruption & Trigger REPLAN Loop`;
  }
}

// ----------------------------------------------------
// RAG Knowledge Base
// ----------------------------------------------------
async function loadRAGDocuments() {
  try {
    const res = await fetch("/api/rag/documents");
    if (!res.ok) return;
    const docs = await res.json();
    const list = document.getElementById("ragDocList");
    if (!docs || docs.length === 0) {
      list.innerHTML = `<li class="list-group-item bg-transparent text-muted">No documents indexed yet.</li>`;
      return;
    }
    list.innerHTML = docs.map((d) => `
      <li class="list-group-item bg-transparent text-light border-secondary d-flex justify-content-between align-items-center">
        <div>
          <i class="bi bi-file-earmark-text text-primary me-2"></i>
          <strong>${d.filename}</strong>
          <span class="badge bg-dark border border-secondary ms-2">${d.source_type.toUpperCase()}</span>
        </div>
        <span class="badge bg-secondary">${d.chunk_count} Chunks</span>
      </li>
    `).join("");
  } catch (err) {
    console.error("Error loading RAG documents", err);
  }
}

async function uploadRAGDocument() {
  const fileInput = document.getElementById("ragFileInput");
  if (!fileInput.files || fileInput.files.length === 0) return;

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  try {
    const res = await fetch("/api/rag/upload", {
      method: "POST",
      body: formData
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    alert(data.message);
    fileInput.value = "";
    loadRAGDocuments();
    checkHealth();
  } catch (err) {
    alert("Upload failed: " + err.message);
  }
}

async function runRAGQuery() {
  const query = document.getElementById("ragQueryInput").value.trim();
  if (!query) return;

  const container = document.getElementById("ragQueryResultContainer");
  container.innerHTML = `<span class="text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Searching vector index...</span>`;

  try {
    const res = await fetch("/api/rag/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, top_k: 3 })
    });
    const data = await res.json();

    const sourcesHtml = (data.sources || []).map((s) => `
      <div class="rag-source-box">
        <div class="d-flex justify-content-between text-info small mb-1">
          <span><i class="bi bi-link-45deg"></i> Source: <strong>${s.source}</strong></span>
          <span>Score: ${s.score}</span>
        </div>
        <div class="text-light small">${s.excerpt}</div>
      </div>
    `).join("");

    container.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="mb-0 fw-bold text-success"><i class="bi bi-shield-check me-1"></i>Grounded Knowledge Response</h6>
        <span class="badge bg-primary">Confidence: ${(data.confidence_score * 100).toFixed(0)}%</span>
      </div>
      <div class="small text-light mb-3" style="white-space: pre-line;">${data.answer}</div>
      <h6 class="text-muted small text-uppercase fw-bold mb-1">Retrieved Citations</h6>
      ${sourcesHtml || '<span class="text-muted small">No direct excerpts.</span>'}
    `;
  } catch (err) {
    container.innerHTML = `<span class="text-danger">RAG Query failed: ${err.message}</span>`;
  }
}

// ----------------------------------------------------
// Preferences & Memory
// ----------------------------------------------------
async function loadPreferences() {
  try {
    const res = await fetch(`/api/preferences?user_id=${currentUser}`);
    if (!res.ok) return;
    const prefs = await res.json();
    document.getElementById("prefMaxBudget").value = prefs.max_budget || 2000.0;
    document.getElementById("prefArrivalTime").value = prefs.latest_arrival_time || "09:00";
    document.getElementById("prefSeat").value = prefs.seat_preference || "window";
    document.getElementById("prefStrategy").value = prefs.ranking_strategy || "balanced";
  } catch (err) {
    console.error("Error loading preferences", err);
  }
}

async function savePreferences() {
  const payload = {
    user_id: currentUser,
    max_budget: parseFloat(document.getElementById("prefMaxBudget").value),
    latest_arrival_time: document.getElementById("prefArrivalTime").value,
    seat_preference: document.getElementById("prefSeat").value,
    ranking_strategy: document.getElementById("prefStrategy").value,
    payment_mode_preference: document.getElementById("paymentModeInput").value,
    auto_book_enabled: document.getElementById("autoBookToggle").checked,
    auto_book_authorized: document.getElementById("authConsentToggle").checked
  };

  try {
    const res = await fetch("/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      alert("Preferences saved successfully to SQLite memory.");
    }
  } catch (err) {
    alert("Failed to save preferences: " + err.message);
  }
}

async function loadRegisteredTools() {
  try {
    const res = await fetch("/api/tools");
    if (!res.ok) return;
    const data = await res.json();
    const tbody = document.getElementById("toolsCatalogBody");
    tbody.innerHTML = (data.tools || []).map((t) => `
      <tr>
        <td><code>${t.name}</code></td>
        <td class="small text-muted">${t.description}</td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Error loading tools catalog", err);
  }
}

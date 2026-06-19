/**
 * SAVEECO Executive Copilot — app.js
 * v1.0
 *
 * Key rule: ZOHO.embeddedApp.on("PageLoad") + ZOHO.embeddedApp.init()
 * MUST be called. Without init() the CRM shell never points the iframe
 * at index.html and you get a blank / placeholder widget.
 *
 * Replace fetchMockData() with live ZOHO.CRM.API calls when ready.
 * Sections to update are marked: [ZOHO API] and [OPENAI]
 */

/* ─── CONFIG ─────────────────────────────────── */
var CONFIG = {
  version: "1.0",
  autoRefreshMs: 0,   // set e.g. 300000 for 5-min auto-refresh
  zohoModules: {
    leads:       "Leads",
    accounts:    "Accounts",
    deals:       "Deals",
    projects:    "Projects",
    rfqs:        "RFQs",
    budgetPlans: "Budget_Plans",
    vendors:     "Vendors"
  }
};

/* ─── MOCK DATA ──────────────────────────────── */
var MOCK_DATA = {
  sales: {
    leads:    { value: 70, label: "Total Leads",    icon: "&#128101;", delta: "Active pipeline" },
    accounts: { value: 2,  label: "Total Accounts", icon: "&#127970;", delta: "Key relationships" },
    deals:    { value: 2,  label: "Total Deals",    icon: "&#129309;", delta: "In negotiation" }
  },
  projects: {
    totalProjects: { value: 4, label: "Total Projects", icon: "&#128208;", delta: "Ongoing" }
  },
  procurement: {
    rfqs:        { value: 4, label: "Total RFQs",        icon: "&#128203;", delta: "Open requests" },
    budgetPlans: { value: 4, label: "Total Budget Plans", icon: "&#128202;", delta: "Approved plans" },
    vendors:     { value: 1, label: "Total Vendors",      icon: "&#127981;", delta: "Registered" }
  },
  health: {
    crmStatus:         { label: "CRM Status",         status: "healthy", text: "Operational", detail: "All modules synced" },
    projectsStatus:    { label: "Projects Status",    status: "healthy", text: "On Track",    detail: "4 active, 0 overdue" },
    procurementStatus: { label: "Procurement Status", status: "warning", text: "Attention",   detail: "1 RFQ pending approval" }
  }
};

/* ─── STATE ──────────────────────────────────── */
var appState = { loading: false, lastLoaded: null };

/* ─── ZOHO SDK INIT ──────────────────────────── */
/*
 * This is the #1 fix. The original code had this block commented out.
 * Without ZOHO.embeddedApp.init(), the CRM host never receives the
 * ready signal, never injects the iframe src, and the slot shows the
 * raw translation key "crm.canvas.homeview.widgets" instead of your HTML.
 */
function initZohoSDK() {
  try {
    ZOHO.embeddedApp.on("PageLoad", function (data) {
      console.log("[Copilot] Zoho PageLoad", data);
      loadDashboard();
    });
    ZOHO.embeddedApp.init();
  } catch (e) {
    /* Running outside Zoho (local file preview) — load mock data directly */
    console.warn("[Copilot] Zoho SDK unavailable, standalone mode:", e.message);
    loadDashboard();
  }
}

/* ─── LOAD DASHBOARD ─────────────────────────── */
function loadDashboard() {
  if (appState.loading) return;
  appState.loading = true;
  setRefreshing(true);
  showOverlay(true);

  /*
   * [ZOHO API] — replace fetchMockData() with live CRM calls, e.g.:
   *
   * ZOHO.CRM.API.searchRecord({
   *   Entity: CONFIG.zohoModules.leads,
   *   Type: "criteria",
   *   Query: "(Lead_Status:equals:New)"
   * }).then(function(resp) {
   *   var count = resp && resp.data ? resp.data.length : 0;
   *   // build data object, then call renderDashboard(data)
   * });
   *
   * [OPENAI] — call a Zoho Function that proxies OpenAI to get
   * an AI summary, then set data.aiSummary before renderDashboard().
   */

  fetchMockData(function (data) {
    try {
      renderDashboard(data);
      appState.lastLoaded = new Date();
      updateLastUpdated();
    } catch (err) {
      console.error("[Copilot] render error:", err);
      showError(err.message);
    } finally {
      appState.loading = false;
      setRefreshing(false);
      showOverlay(false);
    }
  });
}

/* ─── MOCK FETCH ─────────────────────────────── */
/* Delete this function when switching to live Zoho API calls */
function fetchMockData(callback) {
  setTimeout(function () {
    callback(JSON.parse(JSON.stringify(MOCK_DATA)));
  }, 600);
}

/* ─── RENDER DASHBOARD ───────────────────────── */
function renderDashboard(data) {
  renderKpiRow("salesKpiRow",       objVals(data.sales),       "#1e5fad", "salesBadge",       "Active");
  renderKpiRow("projectsKpiRow",    objVals(data.projects),    "#3b82f6", "projectsBadge",    "On Track");
  renderKpiRow("procurementKpiRow", objVals(data.procurement), "#16a34a", "procurementBadge", "Monitoring");
  renderHealth("healthGrid", data.health);
  renderBanner(data);
}

function renderKpiRow(containerId, kpis, accent, badgeId, badgeText) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var html = "";
  for (var i = 0; i < kpis.length; i++) {
    var k = kpis[i];
    html +=
      '<div class="kpi-tile" style="--accent:' + accent + '">' +
        '<div class="kpi-icon">' + k.icon + '</div>' +
        '<div class="kpi-value">' + k.value + '</div>' +
        '<div class="kpi-label">' + k.label + '</div>' +
        '<div class="kpi-delta">' + (k.delta || "") + '</div>' +
      '</div>';
  }
  el.innerHTML = html;
  var badge = document.getElementById(badgeId);
  if (badge) badge.textContent = badgeText;
}

function renderHealth(containerId, health) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var items = objVals(health);
  var labels = { healthy: "Healthy", warning: "Attention", critical: "Critical" };
  var icons  = { healthy: "&#10004;", warning: "&#9888;",  critical: "&#10006;" };
  var html = "";
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    html +=
      '<div class="health-card">' +
        '<div class="health-label">' + item.label + '</div>' +
        '<div class="health-status">' +
          '<span class="status-dot status-' + item.status + '"></span>' +
          item.text +
        '</div>' +
        '<div class="health-detail">' + item.detail + '</div>' +
        '<div class="health-pill pill-' + item.status + '">' +
          icons[item.status] + ' ' + (labels[item.status] || "Unknown") +
        '</div>' +
      '</div>';
  }
  el.innerHTML = html;
}

function renderBanner(data) {
  var all = objVals(data.sales).concat(objVals(data.projects)).concat(objVals(data.procurement));
  var total = 0;
  for (var i = 0; i < all.length; i++) total += (all[i].value || 0);

  var totalEl = document.getElementById("bannerTotal");
  if (totalEl) totalEl.textContent = total;

  var headEl = document.getElementById("bannerHeadline");
  if (headEl) {
    headEl.textContent =
      data.sales.leads.value + " leads in pipeline \u00b7 " +
      data.projects.totalProjects.value + " active projects";
  }

  var subEl = document.getElementById("bannerSub");
  if (subEl) {
    subEl.textContent = "Snapshot as of " + new Date().toLocaleDateString("en-IN", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
  }
}

/* ─── UTILS ──────────────────────────────────── */
function objVals(obj) {
  return Object.keys(obj).map(function (k) { return obj[k]; });
}

function showOverlay(on) {
  var el = document.getElementById("loadingOverlay");
  if (el) el.style.display = on ? "flex" : "none";
}

function setRefreshing(on) {
  var btn  = document.getElementById("refreshBtn");
  if (btn) btn.disabled = on;
}

function updateLastUpdated() {
  var el = document.getElementById("lastUpdated");
  if (!el || !appState.lastLoaded) return;
  el.textContent = "Updated " + appState.lastLoaded.toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit"
  });
}

function showError(msg) {
  ["salesKpiRow","projectsKpiRow","procurementKpiRow","healthGrid"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<p class="error-msg">&#9888; ' + (msg || "Refresh to retry.") + '</p>';
  });
}

/* ─── AUTO-REFRESH ───────────────────────────── */
if (CONFIG.autoRefreshMs > 0) {
  setInterval(loadDashboard, CONFIG.autoRefreshMs);
}

/* ─── BOOT ───────────────────────────────────── */
var verEl = document.getElementById("footerVersion");
if (verEl) verEl.textContent = "v" + CONFIG.version;

initZohoSDK();

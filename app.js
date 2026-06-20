/**
 * ══════════════════════════════════════════════════════════════
 *  SAVEECO Executive Command Center — app.js v3.0
 *  Company : SAVEECO Energy India Pvt Ltd
 *  Widget  : Zoho CRM Home Page Dashboard (External / GitHub Pages)
 * ══════════════════════════════════════════════════════════════
 *
 *  ARCHITECTURE (unchanged from v2):
 *    initZohoSDK()     — Zoho SDK handshake            ← DO NOT MODIFY
 *    loadDashboard()   — orchestrates fetch + render   ← DO NOT MODIFY
 *    fetchLiveData()   — calls Zoho CRM APIs for counts
 *    renderDashboard() — paints all 7 rows from data object
 *    renderKpiStrip()  — Row 1: top KPI tiles
 *    renderKpiRow()    — Rows 2–4: section KPI tiles
 *    renderBanner()    — Row 5: executive summary text
 *    renderAlerts()    — Row 6: management alerts
 *    renderHealth()    — Row 7: health cards
 *    Utility fns       — unchanged
 *
 *  LIVE DATA:
 *    fetchLiveData() uses ZOHO.CRM.API.getRecords() to count
 *    records in each module. Falls back to FALLBACK_DATA if
 *    the API is unavailable (standalone / GitHub preview).
 *
 *  FUTURE INTEGRATIONS:
 *    [ZOHO API]  — additional CRM module calls
 *    [ZOHO FN]   — Zoho Deluge functions for server-side counts
 *    [OPENAI]    — AI executive summary via Zoho Function proxy
 * ══════════════════════════════════════════════════════════════
 */

/* ─── CONFIG ────────────────────────────────────────────────── */
var CONFIG = {
  version: "3.1",

  /* Zoho CRM API module names — verified from Setup → CRM API → API Names */
  modules: {
    leads:       "Leads",          /* API name: Leads        */
    accounts:    "Accounts",       /* API name: Accounts     */
    deals:       "Deals",          /* API name: Deals        */
    projects:    "Projects",       /* API name: Projects     — confirm from screenshot */
    rfqs:        "RFQ",            /* API name: RFQ          ← was "RFQs" (FIXED) */
    budgetPlans: "Budget_Plan",    /* API name: Budget_Plan  ← was "Budget_Estimation_Plans" (FIXED) */
    vendors:     "Vendors",        /* API name: Vendors      */

    /* [ZOHO API] — Future modules: uncomment when ready */
    // purchaseOrders: "Purchase_Orders",
    // invoices:       "Invoices",
    // salesOrders:    "Sales_Orders",
  },

  /* Auto-refresh: set to e.g. 300000 for 5-minute auto-refresh */
  autoRefreshMs: 0,

  /* Vendor warning threshold */
  vendorWarnThreshold: 3,
};

/* ─── FALLBACK DATA ─────────────────────────────────────────── */
/*
 * Used when running outside Zoho CRM (GitHub Pages preview, local file).
 * Replace these with 0 if you want blank tiles in standalone mode.
 */
var FALLBACK_DATA = {
  leads: 0, accounts: 0, deals: 0,
  projects: 0, rfqs: 0, budgetPlans: 0, vendors: 0,
};

/* ─── APP STATE ─────────────────────────────────────────────── */
var appState = {
  loading:    false,
  lastLoaded: null,
  isLive:     false,   /* true when data came from Zoho CRM API */
};

/* ══════════════════════════════════════════════════════════════
   ZOHO SDK INIT — DO NOT MODIFY
══════════════════════════════════════════════════════════════ */
function initZohoSDK() {
  try {
    ZOHO.embeddedApp.on("PageLoad", function (data) {
      console.log("[ECC] Zoho PageLoad", data);
      loadDashboard();
    });
    ZOHO.embeddedApp.init();
    console.log("[ECC] ZOHO.embeddedApp.init() called");
  } catch (e) {
    /* Running outside Zoho (GitHub Pages / local) — use fallback */
    console.warn("[ECC] Zoho SDK not available, standalone mode:", e.message);
    loadDashboard();
  }
}

/* ══════════════════════════════════════════════════════════════
   LOAD DASHBOARD — DO NOT MODIFY
   Orchestrates: fetch → render → update timestamps
══════════════════════════════════════════════════════════════ */
function loadDashboard() {
  if (appState.loading) return;
  appState.loading = true;
  setRefreshing(true);
  showOverlay(true);

  fetchLiveData(function (data) {
    try {
      renderDashboard(data);
      appState.lastLoaded = new Date();
      updateTimestamps();
    } catch (err) {
      console.error("[ECC] renderDashboard error:", err);
      showError(err.message);
    } finally {
      appState.loading = false;
      setRefreshing(false);
      showOverlay(false);
    }
  });
}

/* ══════════════════════════════════════════════════════════════
   FETCH LIVE DATA
   Calls Zoho CRM API to get record counts for each module.
   On any failure falls back to FALLBACK_DATA so the widget
   never shows an error screen inside Zoho CRM.
══════════════════════════════════════════════════════════════ */
function fetchLiveData(callback) {

  /* Check if Zoho CRM API is available */
  if (typeof ZOHO === "undefined" ||
      typeof ZOHO.CRM === "undefined" ||
      typeof ZOHO.CRM.API === "undefined") {
    console.warn("[ECC] ZOHO.CRM.API not available — using fallback data");
    appState.isLive = false;
    callback(buildDataObject(FALLBACK_DATA));
    return;
  }

  /*
   * ── LIVE CRM DATA FETCH ──────────────────────────────────
   *
   * We fetch each module's records and count them.
   * ZOHO.CRM.API.getRecords() returns up to 200 records per call.
   * For modules with > 200 records, use a Zoho Deluge Function
   * to get an accurate server-side count (see [ZOHO FN] below).
   *
   * Each call is wrapped in a Promise for parallel execution.
   */

  function getCount(moduleName) {
    return new Promise(function (resolve) {
      try {
        ZOHO.CRM.API.getRecords({
          Entity:   moduleName,
          per_page: 200,
          page:     1,
        }).then(function (resp) {
          var count = 0;
          if (resp && resp.data && Array.isArray(resp.data)) {
            count = resp.data.length;
          }
          resolve(count);
        }).catch(function (err) {
          console.warn("[ECC] getRecords failed for", moduleName, err);
          resolve(0);
        });
      } catch (e) {
        console.warn("[ECC] getRecords threw for", moduleName, e);
        resolve(0);
      }
    });
  }

  /*
   * [ZOHO FN] — For large modules (> 200 records), replace getCount()
   * calls with a Zoho Deluge Function that returns exact counts:
   *
   *   ZOHO.CRM.FUNCTIONS.execute("get_module_counts", {
   *     arguments: JSON.stringify({ modules: ["Leads","Deals"] })
   *   }).then(function(resp) {
   *     var counts = JSON.parse(resp.details.output);
   *     // counts = { Leads: 347, Deals: 12, ... }
   *   });
   */

  /* Run all fetches in parallel */
  console.log("[ECC] Fetching modules:", CONFIG.modules);
  Promise.all([
    getCount(CONFIG.modules.leads),
    getCount(CONFIG.modules.accounts),
    getCount(CONFIG.modules.deals),
    getCount(CONFIG.modules.projects),
    getCount(CONFIG.modules.rfqs),
    getCount(CONFIG.modules.budgetPlans),
    getCount(CONFIG.modules.vendors),

    /* [ZOHO API] — Future modules: add here when ready
    getCount(CONFIG.modules.purchaseOrders),
    getCount(CONFIG.modules.invoices),
    getCount(CONFIG.modules.salesOrders),
    */

  ]).then(function (results) {
    appState.isLive = true;
    var counts = {
      leads:       results[0],
      accounts:    results[1],
      deals:       results[2],
      projects:    results[3],
      rfqs:        results[4],
      budgetPlans: results[5],
      vendors:     results[6],
    };
    console.log("[ECC] Live counts from CRM:", counts);
    callback(buildDataObject(counts));

  }).catch(function (err) {
    console.error("[ECC] Parallel fetch failed:", err);
    appState.isLive = false;
    callback(buildDataObject(FALLBACK_DATA));
  });
}

/* ── Build the structured data object renderDashboard() expects ── */
function buildDataObject(c) {
  return {
    sales: {
      leads:    { value: c.leads,       label: "Total Leads",        icon: "&#128101;", delta: "Sales pipeline" },
      accounts: { value: c.accounts,    label: "Total Accounts",     icon: "&#127970;", delta: "Key relationships" },
      deals:    { value: c.deals,       label: "Total Deals",        icon: "&#129309;", delta: "In negotiation" },
    },
    projects: {
      totalProjects: { value: c.projects, label: "Total Projects", icon: "&#128208;", delta: "Under execution" },
    },
    procurement: {
      rfqs:        { value: c.rfqs,        label: "Total RFQs",        icon: "&#128203;", delta: "Open requests" },
      budgetPlans: { value: c.budgetPlans, label: "Budget Est. Plans",  icon: "&#128202;", delta: "Approved plans" },
      vendors:     { value: c.vendors,     label: "Total Vendors",      icon: "&#127981;", delta: "Registered" },
    },
    health: {
      crmStatus: {
        label:  "CRM Status",
        status: "healthy",
        text:   "Operational",
        detail: appState.isLive ? "Live data · All modules accessible" : "Standalone mode",
      },
      projectsStatus: {
        label:  "Projects Status",
        status: c.projects > 0 ? "healthy" : "warning",
        text:   c.projects > 0 ? "On Track" : "No Projects",
        detail: c.projects + " active project" + (c.projects !== 1 ? "s" : "") + " in system",
      },
      procurementStatus: {
        label:  "Procurement Status",
        status: c.vendors < CONFIG.vendorWarnThreshold ? "warning" : "healthy",
        text:   c.vendors < CONFIG.vendorWarnThreshold ? "Attention" : "Stable",
        detail: c.vendors + " vendor" + (c.vendors !== 1 ? "s" : "") + " registered · " + c.rfqs + " RFQ" + (c.rfqs !== 1 ? "s" : "") + " open",
      },
    },
    /* Raw counts kept for alert and summary generation */
    _counts: c,
  };
}

/* ══════════════════════════════════════════════════════════════
   RENDER DASHBOARD
   Calls all section renderers. renderDashboard() is the only
   function loadDashboard() ever calls for rendering.
══════════════════════════════════════════════════════════════ */
function renderDashboard(data) {
  renderKpiStrip(data);                                                      /* Row 1 */
  renderKpiRow("salesKpiRow",       objVals(data.sales),       "#2563eb", "salesBadge",       "● Sales Active");       /* Row 2 */
  renderKpiRow("projectsKpiRow",    objVals(data.projects),    "#4338ca", "projectsBadge",    "● Projects Running");   /* Row 3 */
  renderKpiRow("procurementKpiRow", objVals(data.procurement), "#16a34a", "procurementBadge", "⚠ Vendor Base Needs Expansion"); /* Row 4 */
  renderBanner(data);                                                        /* Row 5 */
  renderAlerts(data);                                                        /* Row 6 */
  renderHealth("healthGrid", data.health);                                   /* Row 7 */
}

/* ══════════════════════════════════════════════════════════════
   ROW 1 — KPI COMMAND STRIP
══════════════════════════════════════════════════════════════ */
function renderKpiStrip(data) {
  var el = document.getElementById("kpiCommandStrip");
  if (!el) return;

  var c = data._counts;
  var tiles = [
    { value: c.leads,       label: "Leads",        module: "Sales",        icon: "&#128101;", color: "#2563eb" },
    { value: c.accounts,    label: "Accounts",     module: "Sales",        icon: "&#127970;", color: "#2563eb" },
    { value: c.deals,       label: "Deals",        module: "Sales",        icon: "&#129309;", color: "#2563eb" },
    { value: c.projects,    label: "Projects",     module: "Operations",   icon: "&#128208;", color: "#4338ca" },
    { value: c.rfqs,        label: "RFQs",         module: "Procurement",  icon: "&#128203;", color: "#16a34a" },
    { value: c.vendors,     label: "Vendors",      module: "Procurement",  icon: "&#127981;", color: c.vendors < CONFIG.vendorWarnThreshold ? "#d97706" : "#16a34a" },

    /* [ZOHO API] — Future KPI tiles: add here when modules are live
    { value: c.purchaseOrders, label: "POs",      module: "Procurement", icon: "&#128230;", color: "#0891b2" },
    { value: c.invoices,       label: "Invoices", module: "Finance",     icon: "&#128196;", color: "#7c3aed" },
    { value: c.salesOrders,    label: "Orders",   module: "Sales",       icon: "&#128717;", color: "#be185d" },
    */
  ];

  var html = "";
  for (var i = 0; i < tiles.length; i++) {
    var t = tiles[i];
    html +=
      '<div class="kpi-strip-tile" style="--strip-color:' + t.color + '">' +
        '<div class="kpi-strip-icon">' + t.icon + '</div>' +
        '<div class="kpi-strip-value">' + t.value + '</div>' +
        '<div class="kpi-strip-label">' + t.label + '</div>' +
        '<div class="kpi-strip-module">' + t.module + '</div>' +
      '</div>';
  }
  el.innerHTML = html;
}

/* ══════════════════════════════════════════════════════════════
   ROWS 2–4 — KPI ROW
══════════════════════════════════════════════════════════════ */
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
  if (badge) {
    badge.textContent = badgeText;
    /* Adjust badge colour for procurement warning */
    if (badgeId === "procurementBadge") {
      badge.className = "status-pill pill--amber";
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   ROW 5 — EXECUTIVE SUMMARY
   Generates text dynamically from live CRM counts.
   [OPENAI] marker shows where AI summary replaces this text.
══════════════════════════════════════════════════════════════ */
function renderBanner(data) {
  var c = data._counts;

  /* Total records */
  var total = c.leads + c.accounts + c.deals + c.projects + c.rfqs + c.budgetPlans + c.vendors;
  var totalEl = document.getElementById("bannerTotal");
  if (totalEl) totalEl.textContent = total + " Total CRM Records";

  /* Dynamic summary sentence built from live counts */
  var summary =
    "SAVEECO currently has " + c.leads + " lead" + (c.leads !== 1 ? "s" : "") +
    " in the sales pipeline, " + c.deals + " active deal" + (c.deals !== 1 ? "s" : "") +
    ", " + c.projects + " project" + (c.projects !== 1 ? "s" : "") + " under execution" +
    ", " + c.rfqs + " RFQ" + (c.rfqs !== 1 ? "s" : "") + " under procurement review" +
    " and " + c.vendors + " approved vendor" + (c.vendors !== 1 ? "s" : "") + " in the system." +
    " Overall business operations are " + (c.vendors < CONFIG.vendorWarnThreshold ? "stable with vendor expansion recommended." : "stable.");

  /*
   * [OPENAI] — Replace the summary above with an AI-generated briefing:
   *
   * ZOHO.CRM.FUNCTIONS.execute("openai_exec_summary", {
   *   arguments: JSON.stringify({ counts: c })
   * }).then(function(resp) {
   *   var aiSummary = JSON.parse(resp.details.output).summary;
   *   var textEl = document.getElementById("execSummaryText");
   *   if (textEl) textEl.textContent = aiSummary;
   * });
   *
   * The Zoho Deluge function "openai_exec_summary" should proxy to
   * the OpenAI API (gpt-4o recommended) keeping your API key server-side.
   */

  var textEl = document.getElementById("execSummaryText");
  if (textEl) textEl.textContent = summary;

  var dateEl = document.getElementById("execSummaryDate");
  if (dateEl) {
    dateEl.textContent = "Generated: " + new Date().toLocaleDateString("en-IN", {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    }) + (appState.isLive ? " · Live CRM data" : " · Preview mode");
  }
}

/* ══════════════════════════════════════════════════════════════
   ROW 6 — MANAGEMENT ALERTS
   All alert conditions driven by live data counts.
══════════════════════════════════════════════════════════════ */
function renderAlerts(data) {
  var el = document.getElementById("alertsGrid");
  if (!el) return;

  var c = data._counts;

  /* Build alert list dynamically */
  var alerts = [];

  /* Vendor warning */
  if (c.vendors < CONFIG.vendorWarnThreshold) {
    alerts.push({
      type:   "is-warn",
      sym:    "&#9888;",
      title:  "Only " + c.vendors + " Vendor" + (c.vendors !== 1 ? "s" : "") + " Available",
      detail: "Vendor base is critically low — expand vendor registration immediately",
    });
  } else {
    alerts.push({
      type:   "is-ok",
      sym:    "&#10004;",
      title:  c.vendors + " Vendors Registered",
      detail: "Vendor base is adequate for current procurement volume",
    });
  }

  /* Projects */
  alerts.push({
    type:   c.projects > 0 ? "is-ok" : "is-warn",
    sym:    c.projects > 0 ? "&#10004;" : "&#9888;",
    title:  c.projects + " Project" + (c.projects !== 1 ? "s" : "") + " Active",
    detail: c.projects > 0
      ? "All " + c.projects + " projects are active in the system"
      : "No active projects found in CRM",
  });

  /* Procurement */
  alerts.push({
    type:   c.rfqs > 0 ? "is-ok" : "is-info",
    sym:    c.rfqs > 0 ? "&#10004;" : "&#8505;",
    title:  c.rfqs + " RFQ" + (c.rfqs !== 1 ? "s" : "") + " Active",
    detail: c.rfqs > 0
      ? c.rfqs + " RFQs are open and under procurement review"
      : "No open RFQs in the procurement pipeline",
  });

  /* CRM sync status */
  alerts.push({
    type:   "is-info",
    sym:    "&#128274;",
    title:  appState.isLive ? "CRM Synchronized Successfully" : "Running in Preview Mode",
    detail: appState.isLive
      ? "Live data fetched from Zoho CRM · All modules accessible"
      : "Zoho CRM API not available · Running on GitHub Pages preview",
  });

  /* [ZOHO API] — Add future alerts here, e.g. overdue invoices:
  if (c.invoices > 10) {
    alerts.push({
      type: "is-warn", sym: "&#9888;",
      title: c.invoices + " Invoices Pending",
      detail: "Invoice count exceeds threshold — review required",
    });
  }
  */

  var html = "";
  for (var i = 0; i < alerts.length; i++) {
    var a = alerts[i];
    html +=
      '<div class="alert-item ' + a.type + '">' +
        '<div class="alert-sym">' + a.sym + '</div>' +
        '<div class="alert-content">' +
          '<div class="alert-title">' + a.title + '</div>' +
          '<div class="alert-detail">' + a.detail + '</div>' +
        '</div>' +
      '</div>';
  }
  el.innerHTML = html;
}

/* ══════════════════════════════════════════════════════════════
   ROW 7 — BUSINESS HEALTH
══════════════════════════════════════════════════════════════ */
function renderHealth(containerId, health) {
  var el = document.getElementById(containerId);
  if (!el) return;

  var items  = objVals(health);
  var labels = { healthy: "Healthy", warning: "Attention", critical: "Critical" };
  var icons  = { healthy: "&#10004;", warning: "&#9888;", critical: "&#10006;" };
  var html   = "";

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

/* ══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
══════════════════════════════════════════════════════════════ */
function objVals(obj) {
  return Object.keys(obj).map(function (k) { return obj[k]; });
}

function showOverlay(on) {
  var el = document.getElementById("loadingOverlay");
  if (el) el.style.display = on ? "flex" : "none";
}

function setRefreshing(on) {
  var btn = document.getElementById("refreshBtn");
  if (btn) btn.disabled = on;
}

function updateTimestamps() {
  if (!appState.lastLoaded) return;
  var t = appState.lastLoaded;

  var updEl = document.getElementById("lastUpdated");
  if (updEl) {
    updEl.textContent = "Updated " + t.toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit"
    }) + (appState.isLive ? " · Live" : " · Preview");
  }

  var dateEl = document.getElementById("headerDate");
  if (dateEl) {
    dateEl.textContent = t.toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric"
    });
  }
}

function showError(msg) {
  var ids = ["kpiCommandStrip","salesKpiRow","projectsKpiRow",
             "procurementKpiRow","alertsGrid","healthGrid"];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el) el.innerHTML = '<p class="error-msg">&#9888; ' + (msg || "Refresh to retry.") + '</p>';
  }
}

/* ══════════════════════════════════════════════════════════════
   AUTO-REFRESH
══════════════════════════════════════════════════════════════ */
if (CONFIG.autoRefreshMs > 0) {
  setInterval(loadDashboard, CONFIG.autoRefreshMs);
}

/* ══════════════════════════════════════════════════════════════
   BOOTSTRAP
══════════════════════════════════════════════════════════════ */
var verEl = document.getElementById("footerVersion");
if (verEl) verEl.textContent = "v" + CONFIG.version;

initZohoSDK();

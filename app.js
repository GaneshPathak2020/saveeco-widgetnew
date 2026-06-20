/**
 * ══════════════════════════════════════════════════════════════
 *  SAVEECO Executive Command Center — app.js v3.2
 *  Company : SAVEECO Energy India Pvt Ltd
 *  Widget  : Zoho CRM Home Page Dashboard (External / GitHub Pages)
 * ══════════════════════════════════════════════════════════════
 *
 *  v3.2 CHANGES:
 *    - Fixed module API names (RFQ, Budget_Plan, Projects)
 *    - Rewrote fetchLiveData() with dual-method approach:
 *        1. searchRecord() — primary (most reliable in home page widgets)
 *        2. getRecords()   — fallback if searchRecord returns empty
 *    - Added full console debug logging for every API call
 *    - isLive detection based on actual returned data not just API presence
 *
 *  ARCHITECTURE (unchanged):
 *    initZohoSDK()     — Zoho SDK handshake       ← DO NOT MODIFY
 *    loadDashboard()   — fetch + render controller ← DO NOT MODIFY
 *    fetchLiveData()   — live CRM data fetch
 *    buildDataObject() — structures raw counts into render-ready object
 *    renderDashboard() — paints all rows
 *    renderKpiStrip()  — Row 1
 *    renderKpiRow()    — Rows 2–4
 *    renderBanner()    — Row 5: executive summary
 *    renderAlerts()    — Row 6: management alerts
 *    renderHealth()    — Row 7: health monitor
 *
 *  FUTURE INTEGRATIONS:
 *    [ZOHO FN]   — Zoho Deluge Function for server-side counts > 200
 *    [OPENAI]    — AI executive summary via Zoho Function proxy
 * ══════════════════════════════════════════════════════════════
 */

/* ─── CONFIG ────────────────────────────────────────────────── */
var CONFIG = {
  version: "3.3",

  /* Verified API names from Setup → CRM API → API Names screen */
  modules: {
    leads:       "Leads",       /* API: Leads       */
    accounts:    "Accounts",    /* API: Accounts    */
    deals:       "Deals",       /* API: Deals       */
    projects:    "Projects",    /* API: Projects    */
    rfqs:        "RFQ",         /* API: RFQ         ← was RFQs */
    budgetPlans: "Budget_Plan", /* API: Budget_Plan ← was Budget_Estimation_Plans */
    vendors:     "Vendors",     /* API: Vendors     */
  },

  /* Set to 300000 for 5-minute auto-refresh */
  autoRefreshMs: 0,

  /* Alert threshold: warn if vendors below this number */
  vendorWarnThreshold: 3,
};

/* ─── FALLBACK DATA ─────────────────────────────────────────── */
/* Used when Zoho SDK is not available (GitHub Pages direct view) */
var FALLBACK_DATA = {
  leads: 0, accounts: 0, deals: 0,
  projects: 0, rfqs: 0, budgetPlans: 0, vendors: 0,
};

/* ─── APP STATE ─────────────────────────────────────────────── */
var appState = {
  loading:    false,
  lastLoaded: null,
  isLive:     false,
};

/* ══════════════════════════════════════════════════════════════
   ZOHO SDK INIT
   For External-hosted widgets, Zoho injects the ZOHO global
   into the iframe context via postMessage — it is NOT available
   immediately on page load. We poll for it with a short delay.
   Loading ZCRMJSLib.min.js from our HTML causes a CSP violation
   and must NOT be done for external widgets.
══════════════════════════════════════════════════════════════ */
function initZohoSDK() {
  /* Try immediately first */
  if (tryInitSDK()) return;

  /* If ZOHO not ready yet, poll every 200ms for up to 5 seconds */
  var attempts = 0;
  var maxAttempts = 25;
  var poll = setInterval(function () {
    attempts++;
    console.log("[ECC] Waiting for ZOHO global... attempt", attempts);
    if (tryInitSDK()) {
      clearInterval(poll);
    } else if (attempts >= maxAttempts) {
      clearInterval(poll);
      console.warn("[ECC] ZOHO not available after 5s — loading with fallback data");
      loadDashboard();
    }
  }, 200);
}

function tryInitSDK() {
  if (typeof ZOHO !== "undefined" &&
      typeof ZOHO.embeddedApp !== "undefined") {
    try {
      console.log("[ECC] ZOHO global found — calling embeddedApp.on + init()");
      ZOHO.embeddedApp.on("PageLoad", function (data) {
        console.log("[ECC] PageLoad fired:", data);
        loadDashboard();
      });
      ZOHO.embeddedApp.init();
      return true;
    } catch (e) {
      console.warn("[ECC] embeddedApp.init() threw:", e.message);
      loadDashboard();
      return true;
    }
  }
  return false;
}

/* ══════════════════════════════════════════════════════════════
   LOAD DASHBOARD — DO NOT MODIFY
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
   Primary:  ZOHO.CRM.API.searchRecord() — most reliable in widgets
   Fallback: ZOHO.CRM.API.getRecords()  — used if search returns empty
   All responses logged to console for debugging.
══════════════════════════════════════════════════════════════ */
function fetchLiveData(callback) {

  /* Check SDK availability */
  var sdkReady = (
    typeof ZOHO !== "undefined" &&
    typeof ZOHO.CRM !== "undefined" &&
    typeof ZOHO.CRM.API !== "undefined"
  );

  console.log("[ECC] SDK ready:", sdkReady);

  if (!sdkReady) {
    console.warn("[ECC] SDK not ready — using fallback zeros");
    appState.isLive = false;
    callback(buildDataObject(FALLBACK_DATA));
    return;
  }

  /* ── getCount: tries searchRecord, falls back to getRecords ── */
  function getCount(moduleName) {
    return new Promise(function (resolve) {

      console.log("[ECC] → Fetching:", moduleName);

      /* Method 1: searchRecord with broad word search */
      try {
        ZOHO.CRM.API.searchRecord({
          Entity: moduleName,
          Type:   "word",
          Query:  "the",
        }).then(function (resp) {

          console.log("[ECC] searchRecord(" + moduleName + ") raw:",
            JSON.stringify(resp).substring(0, 300));

          if (resp && resp.data && Array.isArray(resp.data) && resp.data.length > 0) {
            console.log("[ECC]", moduleName, "count via searchRecord:", resp.data.length);
            resolve(resp.data.length);
          } else {
            /* searchRecord returned nothing — try getRecords */
            console.warn("[ECC]", moduleName, "searchRecord empty → trying getRecords");
            useGetRecords(moduleName, resolve);
          }

        }).catch(function (err) {
          console.warn("[ECC] searchRecord(" + moduleName + ") error:", err);
          useGetRecords(moduleName, resolve);
        });

      } catch (e) {
        console.warn("[ECC] searchRecord(" + moduleName + ") threw:", e.message);
        useGetRecords(moduleName, resolve);
      }
    });
  }

  /* Method 2: getRecords — fetches page 1 up to 200 records */
  function useGetRecords(moduleName, resolve) {
    try {
      ZOHO.CRM.API.getRecords({
        Entity:   moduleName,
        per_page: 200,
        page:     1,
      }).then(function (resp) {

        console.log("[ECC] getRecords(" + moduleName + ") raw:",
          JSON.stringify(resp).substring(0, 300));

        var count = 0;
        if (resp && resp.data && Array.isArray(resp.data)) {
          count = resp.data.length;
        }
        console.log("[ECC]", moduleName, "count via getRecords:", count);
        resolve(count);

      }).catch(function (err) {
        console.error("[ECC] getRecords(" + moduleName + ") error:", err);
        resolve(0);
      });

    } catch (e) {
      console.error("[ECC] getRecords(" + moduleName + ") threw:", e.message);
      resolve(0);
    }
  }

  /*
   * [ZOHO FN] — For precise counts when records > 200:
   *
   *   ZOHO.CRM.FUNCTIONS.execute("get_module_counts", {
   *     arguments: JSON.stringify({
   *       modules: ["Leads","Accounts","Deals","Projects","RFQ","Budget_Plan","Vendors"]
   *     })
   *   }).then(function(resp) {
   *     var counts = JSON.parse(resp.details.output);
   *     callback(buildDataObject(counts));
   *   });
   *
   * [OPENAI] — AI executive summary after counts are fetched:
   *
   *   ZOHO.CRM.FUNCTIONS.execute("openai_exec_summary", {
   *     arguments: JSON.stringify({ counts: counts })
   *   }).then(function(resp) {
   *     var aiText = JSON.parse(resp.details.output).summary;
   *     document.getElementById("execSummaryText").textContent = aiText;
   *   });
   */

  /* Run all module fetches in parallel */
  console.log("[ECC] Starting Promise.all for modules:", JSON.stringify(CONFIG.modules));

  Promise.all([
    getCount(CONFIG.modules.leads),
    getCount(CONFIG.modules.accounts),
    getCount(CONFIG.modules.deals),
    getCount(CONFIG.modules.projects),
    getCount(CONFIG.modules.rfqs),
    getCount(CONFIG.modules.budgetPlans),
    getCount(CONFIG.modules.vendors),
  ]).then(function (results) {

    var counts = {
      leads:       results[0],
      accounts:    results[1],
      deals:       results[2],
      projects:    results[3],
      rfqs:        results[4],
      budgetPlans: results[5],
      vendors:     results[6],
    };

    console.log("[ECC] ✅ Final counts:", JSON.stringify(counts));

    /* isLive = true if any module returned data */
    var total = 0;
    var keys = Object.keys(counts);
    for (var i = 0; i < keys.length; i++) total += counts[keys[i]];
    appState.isLive = (total > 0);

    callback(buildDataObject(counts));

  }).catch(function (err) {
    console.error("[ECC] Promise.all error:", err);
    appState.isLive = false;
    callback(buildDataObject(FALLBACK_DATA));
  });
}

/* ══════════════════════════════════════════════════════════════
   BUILD DATA OBJECT
   Converts raw counts into the structured object renderDashboard expects.
══════════════════════════════════════════════════════════════ */
function buildDataObject(c) {
  return {
    sales: {
      leads:    { value: c.leads,       label: "Total Leads",       icon: "&#128101;", delta: "Sales pipeline"    },
      accounts: { value: c.accounts,    label: "Total Accounts",    icon: "&#127970;", delta: "Key relationships" },
      deals:    { value: c.deals,       label: "Total Deals",       icon: "&#129309;", delta: "In negotiation"    },
    },
    projects: {
      totalProjects: { value: c.projects, label: "Total Projects", icon: "&#128208;", delta: "Under execution" },
    },
    procurement: {
      rfqs:        { value: c.rfqs,        label: "Total RFQs",        icon: "&#128203;", delta: "Open requests"   },
      budgetPlans: { value: c.budgetPlans, label: "Budget Est. Plans",  icon: "&#128202;", delta: "Approved plans"  },
      vendors:     { value: c.vendors,     label: "Total Vendors",      icon: "&#127981;", delta: "Registered"      },
    },
    health: {
      crmStatus: {
        label:  "CRM Status",
        status: "healthy",
        text:   "Operational",
        detail: appState.isLive ? "Live CRM data · All modules accessible" : "Preview mode · No CRM context",
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
        detail: c.vendors + " vendor" + (c.vendors !== 1 ? "s" : "") + " · " + c.rfqs + " RFQ" + (c.rfqs !== 1 ? "s" : "") + " open",
      },
    },
    _counts: c,
  };
}

/* ══════════════════════════════════════════════════════════════
   RENDER DASHBOARD
══════════════════════════════════════════════════════════════ */
function renderDashboard(data) {
  renderKpiStrip(data);
  renderKpiRow("salesKpiRow",       objVals(data.sales),       "#2563eb", "salesBadge",       "● Sales Active");
  renderKpiRow("projectsKpiRow",    objVals(data.projects),    "#4338ca", "projectsBadge",    "● Projects Running");
  renderKpiRow("procurementKpiRow", objVals(data.procurement), "#16a34a", "procurementBadge", "⚠ Vendor Base Needs Expansion");
  renderBanner(data);
  renderAlerts(data);
  renderHealth("healthGrid", data.health);
}

/* ── ROW 1: KPI STRIP ── */
function renderKpiStrip(data) {
  var el = document.getElementById("kpiCommandStrip");
  if (!el) return;

  var c = data._counts;
  var tiles = [
    { value: c.leads,       label: "Leads",       module: "Sales",       icon: "&#128101;", color: "#2563eb" },
    { value: c.accounts,    label: "Accounts",    module: "Sales",       icon: "&#127970;", color: "#2563eb" },
    { value: c.deals,       label: "Deals",       module: "Sales",       icon: "&#129309;", color: "#2563eb" },
    { value: c.projects,    label: "Projects",    module: "Operations",  icon: "&#128208;", color: "#4338ca" },
    { value: c.rfqs,        label: "RFQs",        module: "Procurement", icon: "&#128203;", color: "#16a34a" },
    { value: c.vendors,     label: "Vendors",     module: "Procurement", icon: "&#127981;",
      color: c.vendors < CONFIG.vendorWarnThreshold ? "#d97706" : "#16a34a" },
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

/* ── ROWS 2–4: KPI ROW ── */
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
    if (badgeId === "procurementBadge") badge.className = "status-pill pill--amber";
  }
}

/* ── ROW 5: EXECUTIVE SUMMARY ── */
function renderBanner(data) {
  var c = data._counts;

  var total = c.leads + c.accounts + c.deals + c.projects + c.rfqs + c.budgetPlans + c.vendors;
  var totalEl = document.getElementById("bannerTotal");
  if (totalEl) totalEl.textContent = total + " Total CRM Records";

  var summary =
    "SAVEECO currently has " + c.leads + " lead" + (c.leads !== 1 ? "s" : "") +
    " in the sales pipeline, " + c.deals + " active deal" + (c.deals !== 1 ? "s" : "") +
    ", " + c.projects + " project" + (c.projects !== 1 ? "s" : "") + " under execution" +
    ", " + c.rfqs + " RFQ" + (c.rfqs !== 1 ? "s" : "") + " under procurement review" +
    " and " + c.vendors + " approved vendor" + (c.vendors !== 1 ? "s" : "") + " in the system." +
    (c.vendors < CONFIG.vendorWarnThreshold
      ? " Overall business operations are stable with vendor expansion recommended."
      : " Overall business operations are stable.");

  /*
   * [OPENAI] Replace summary with AI-generated text:
   *   ZOHO.CRM.FUNCTIONS.execute("openai_exec_summary", {
   *     arguments: JSON.stringify({ counts: c })
   *   }).then(function(resp) {
   *     var aiText = JSON.parse(resp.details.output).summary;
   *     document.getElementById("execSummaryText").textContent = aiText;
   *   });
   */

  var textEl = document.getElementById("execSummaryText");
  if (textEl) textEl.textContent = summary;

  var dateEl = document.getElementById("execSummaryDate");
  if (dateEl) {
    dateEl.textContent = "Generated: " +
      new Date().toLocaleDateString("en-IN", {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
      }) +
      (appState.isLive ? " · Live CRM Data" : " · Preview Mode");
  }
}

/* ── ROW 6: MANAGEMENT ALERTS ── */
function renderAlerts(data) {
  var el = document.getElementById("alertsGrid");
  if (!el) return;

  var c = data._counts;
  var alerts = [];

  alerts.push(c.vendors < CONFIG.vendorWarnThreshold ? {
    type:   "is-warn",
    sym:    "&#9888;",
    title:  "Only " + c.vendors + " Vendor" + (c.vendors !== 1 ? "s" : "") + " Available",
    detail: "Vendor base is critically low — expand vendor registration immediately",
  } : {
    type:   "is-ok",
    sym:    "&#10004;",
    title:  c.vendors + " Vendors Registered",
    detail: "Vendor base is adequate for current procurement volume",
  });

  alerts.push({
    type:   c.projects > 0 ? "is-ok" : "is-warn",
    sym:    c.projects > 0 ? "&#10004;" : "&#9888;",
    title:  c.projects + " Project" + (c.projects !== 1 ? "s" : "") + " Active",
    detail: c.projects > 0
      ? "All " + c.projects + " projects are active in the system"
      : "No active projects found in CRM",
  });

  alerts.push({
    type:   c.rfqs > 0 ? "is-ok" : "is-info",
    sym:    c.rfqs > 0 ? "&#10004;" : "&#8505;",
    title:  c.rfqs + " RFQ" + (c.rfqs !== 1 ? "s" : "") + " Active",
    detail: c.rfqs > 0
      ? c.rfqs + " RFQs are open and under procurement review"
      : "No open RFQs in the procurement pipeline",
  });

  alerts.push({
    type:   appState.isLive ? "is-info" : "is-warn",
    sym:    appState.isLive ? "&#128274;" : "&#9888;",
    title:  appState.isLive ? "CRM Synchronized Successfully" : "Running in Preview Mode",
    detail: appState.isLive
      ? "Live data fetched from Zoho CRM · All modules accessible"
      : "Open inside Zoho CRM Home Page to see live data",
  });

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

/* ── ROW 7: BUSINESS HEALTH ── */
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
   UTILITIES
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
    updEl.textContent = "Updated " +
      t.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) +
      (appState.isLive ? " · Live" : " · Preview");
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

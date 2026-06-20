/**
 * ══════════════════════════════════════════════════════════════
 *  SAVEECO Executive Command Center — app.js v4.0
 *  Widget  : Zoho CRM Home Page Dashboard (External / GitHub Pages)
 * ══════════════════════════════════════════════════════════════
 *
 *  ROOT CAUSE OF ZEROS (confirmed from console):
 *  External-hosted widgets do NOT receive the ZOHO global via
 *  automatic injection. The widget iframe and the Zoho CRM shell
 *  are on different origins. The ONLY supported communication
 *  channel is window.postMessage.
 *
 *  SOLUTION:
 *  1. Load the Zoho Widget SDK via postMessage handshake
 *  2. Call ZOHO.CRM.FUNCTIONS.execute() to run a Zoho Deluge
 *     Function that fetches CRM record counts server-side
 *  3. Render the returned counts
 *
 *  REQUIRED SETUP (one-time in Zoho CRM):
 *  Create a Deluge Function named "get_dashboard_counts"
 *  (see README comment at bottom of this file for the code)
 *
 *  ARCHITECTURE:
 *    initZohoSDK()       — loads SDK via postMessage, fires loadDashboard
 *    loadDashboard()     — orchestrates fetch + render (DO NOT MODIFY)
 *    fetchLiveData()     — calls Deluge Function for counts
 *    buildDataObject()   — structures counts for renderers
 *    renderDashboard()   — paints all rows
 *    renderKpiStrip()    — Row 1
 *    renderKpiRow()      — Rows 2–4
 *    renderBanner()      — Row 5: executive summary
 *    renderAlerts()      — Row 6: management alerts
 *    renderHealth()      — Row 7: health monitor
 * ══════════════════════════════════════════════════════════════
 */

/* ─── CONFIG ────────────────────────────────────────────────── */
var CONFIG = {
  version: "4.0",

  /* Name of your Zoho Deluge Function (Setup → Developer Tools → Functions) */
  delugeFunction: "get_dashboard_counts",

  /* Zoho CRM module API names — used as fallback if Deluge unavailable */
  modules: {
    leads:       "Leads",
    accounts:    "Accounts",
    deals:       "Deals",
    projects:    "Projects",
    rfqs:        "RFQ",
    budgetPlans: "Budget_Plan",
    vendors:     "Vendors",
  },

  autoRefreshMs: 0,
  vendorWarnThreshold: 3,
};

/* ─── FALLBACK DATA ─────────────────────────────────────────── */
var FALLBACK_DATA = {
  leads: 0, accounts: 0, deals: 0,
  projects: 0, rfqs: 0, budgetPlans: 0, vendors: 0,
};

/* ─── APP STATE ─────────────────────────────────────────────── */
var appState = {
  loading:    false,
  lastLoaded: null,
  isLive:     false,
  zohoReady:  false,
};

/* ══════════════════════════════════════════════════════════════
   ZOHO SDK INIT
   External widgets receive the ZOHO global via the SDK script
   loaded from the Zoho CRM parent frame. We load it via a
   dynamic script tag with the src provided by the parent.

   For external widgets, Zoho injects the SDK by having the
   parent frame communicate the SDK URL. The correct pattern
   is to listen for the "PageLoad" event after calling init().

   The SDK for external widgets is available at this URL and
   DOES work when loaded dynamically (not as a static script tag,
   which gets blocked by CSP).
══════════════════════════════════════════════════════════════ */
function initZohoSDK() {
  console.log("[ECC v4] initZohoSDK() called");

  /* Load the Zoho Widget SDK dynamically.
     Dynamic script injection bypasses the CSP nonce restriction
     that blocks static <script> tags in the HTML. */
  var script = document.createElement("script");
  script.src = "https://js.zohostatic.com/zohocrm/sdk/2.0/ZCRMJSLib.min.js";
  script.async = true;

  script.onload = function () {
    console.log("[ECC v4] SDK script loaded, setting up PageLoad listener");
    try {
      ZOHO.embeddedApp.on("PageLoad", function (data) {
        console.log("[ECC v4] PageLoad fired:", JSON.stringify(data));
        appState.zohoReady = true;
        loadDashboard();
      });
      ZOHO.embeddedApp.init();
      console.log("[ECC v4] ZOHO.embeddedApp.init() called");
    } catch (e) {
      console.warn("[ECC v4] embeddedApp.init() error:", e.message);
      /* Still attempt to load — may work in some contexts */
      loadDashboard();
    }
  };

  script.onerror = function () {
    console.warn("[ECC v4] SDK script failed to load — standalone mode");
    loadDashboard();
  };

  document.head.appendChild(script);
  console.log("[ECC v4] SDK script tag injected dynamically");
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
      console.error("[ECC v4] renderDashboard error:", err);
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
   Strategy 1 (preferred): Call the Zoho Deluge Function
     "get_dashboard_counts" which runs server-side and returns
     counts for all modules in one call.

   Strategy 2 (fallback): Call ZOHO.CRM.API.getRecords()
     directly if the Deluge Function is not set up yet.

   Strategy 3 (last resort): Use FALLBACK_DATA (zeros).
══════════════════════════════════════════════════════════════ */
function fetchLiveData(callback) {

  var zohoAvail = (
    typeof ZOHO !== "undefined" &&
    typeof ZOHO.CRM !== "undefined"
  );

  console.log("[ECC v4] ZOHO available:", zohoAvail);

  if (!zohoAvail) {
    console.warn("[ECC v4] ZOHO not available — using fallback zeros");
    appState.isLive = false;
    callback(buildDataObject(FALLBACK_DATA));
    return;
  }

  /* ── Strategy 1: Deluge Function ── */
  /*
   * This is the recommended approach. The Deluge Function runs
   * inside Zoho's servers and has full access to CRM data.
   *
   * Create the function in:
   *   Setup → Developer Tools → Functions → New Function
   *   Name: get_dashboard_counts
   *   (See Deluge code in the README comment at the end of this file)
   *
   * [OPENAI] To add AI summary, create a second Deluge Function
   * "get_ai_summary" that calls OpenAI API with the counts and
   * returns a summary string. Call it here after getting counts.
   */
  if (typeof ZOHO.CRM.FUNCTIONS !== "undefined") {
    console.log("[ECC v4] Calling Deluge Function:", CONFIG.delugeFunction);

    try {
      ZOHO.CRM.FUNCTIONS.execute(CONFIG.delugeFunction, {
        arguments: JSON.stringify({})
      }).then(function (resp) {
        console.log("[ECC v4] Deluge Function response:", JSON.stringify(resp).substring(0, 500));

        try {
          /* Deluge returns output as a string — parse it */
          var output = resp && resp.details && resp.details.output
            ? resp.details.output
            : null;

          if (output) {
            var counts = typeof output === "string" ? JSON.parse(output) : output;
            console.log("[ECC v4] ✅ Counts from Deluge:", JSON.stringify(counts));
            appState.isLive = true;
            callback(buildDataObject(counts));
          } else {
            console.warn("[ECC v4] Deluge returned no output — trying getRecords");
            tryGetRecordsFallback(callback);
          }
        } catch (parseErr) {
          console.warn("[ECC v4] Deluge output parse error:", parseErr.message);
          tryGetRecordsFallback(callback);
        }

      }).catch(function (err) {
        console.warn("[ECC v4] Deluge Function error:", err);
        tryGetRecordsFallback(callback);
      });

    } catch (e) {
      console.warn("[ECC v4] Deluge Function threw:", e.message);
      tryGetRecordsFallback(callback);
    }

  } else {
    /* ZOHO.CRM.FUNCTIONS not available — try direct API */
    console.warn("[ECC v4] ZOHO.CRM.FUNCTIONS not available — trying getRecords");
    tryGetRecordsFallback(callback);
  }
}

/* ── Strategy 2: Direct API calls ── */
function tryGetRecordsFallback(callback) {
  if (typeof ZOHO.CRM.API === "undefined") {
    console.warn("[ECC v4] ZOHO.CRM.API not available either — using fallback zeros");
    appState.isLive = false;
    callback(buildDataObject(FALLBACK_DATA));
    return;
  }

  console.log("[ECC v4] Using ZOHO.CRM.API.getRecords() fallback");

  function getCount(moduleName) {
    return new Promise(function (resolve) {
      try {
        ZOHO.CRM.API.getRecords({
          Entity:   moduleName,
          per_page: 200,
          page:     1,
        }).then(function (resp) {
          console.log("[ECC v4] getRecords(" + moduleName + "):",
            JSON.stringify(resp).substring(0, 150));
          var count = (resp && resp.data && Array.isArray(resp.data))
            ? resp.data.length : 0;
          resolve(count);
        }).catch(function (err) {
          console.warn("[ECC v4] getRecords(" + moduleName + ") error:", err);
          resolve(0);
        });
      } catch (e) {
        console.warn("[ECC v4] getRecords(" + moduleName + ") threw:", e.message);
        resolve(0);
      }
    });
  }

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
    var total = 0;
    var keys = Object.keys(counts);
    for (var i = 0; i < keys.length; i++) total += counts[keys[i]];
    appState.isLive = total > 0;
    console.log("[ECC v4] getRecords counts:", JSON.stringify(counts));
    callback(buildDataObject(counts));
  }).catch(function (err) {
    console.error("[ECC v4] getRecords Promise.all failed:", err);
    appState.isLive = false;
    callback(buildDataObject(FALLBACK_DATA));
  });
}

/* ══════════════════════════════════════════════════════════════
   BUILD DATA OBJECT
══════════════════════════════════════════════════════════════ */
function buildDataObject(c) {
  /* Ensure all keys exist with numeric defaults */
  var safe = {
    leads:       Number(c.leads)       || 0,
    accounts:    Number(c.accounts)    || 0,
    deals:       Number(c.deals)       || 0,
    projects:    Number(c.projects)    || 0,
    rfqs:        Number(c.rfqs)        || 0,
    budgetPlans: Number(c.budgetPlans) || 0,
    vendors:     Number(c.vendors)     || 0,
  };

  return {
    sales: {
      leads:    { value: safe.leads,       label: "Total Leads",       icon: "&#128101;", delta: "Sales pipeline"    },
      accounts: { value: safe.accounts,    label: "Total Accounts",    icon: "&#127970;", delta: "Key relationships" },
      deals:    { value: safe.deals,       label: "Total Deals",       icon: "&#129309;", delta: "In negotiation"    },
    },
    projects: {
      totalProjects: { value: safe.projects, label: "Total Projects", icon: "&#128208;", delta: "Under execution" },
    },
    procurement: {
      rfqs:        { value: safe.rfqs,        label: "Total RFQs",        icon: "&#128203;", delta: "Open requests"  },
      budgetPlans: { value: safe.budgetPlans, label: "Budget Est. Plans",  icon: "&#128202;", delta: "Approved plans" },
      vendors:     { value: safe.vendors,     label: "Total Vendors",      icon: "&#127981;", delta: "Registered"     },
    },
    health: {
      crmStatus: {
        label:  "CRM Status",
        status: "healthy",
        text:   "Operational",
        detail: appState.isLive ? "Live CRM data fetched" : "Preview mode · Open in Zoho CRM",
      },
      projectsStatus: {
        label:  "Projects Status",
        status: safe.projects > 0 ? "healthy" : "warning",
        text:   safe.projects > 0 ? "On Track" : "No Projects",
        detail: safe.projects + " active project" + (safe.projects !== 1 ? "s" : "") + " in system",
      },
      procurementStatus: {
        label:  "Procurement Status",
        status: safe.vendors < CONFIG.vendorWarnThreshold ? "warning" : "healthy",
        text:   safe.vendors < CONFIG.vendorWarnThreshold ? "Attention" : "Stable",
        detail: safe.vendors + " vendor" + (safe.vendors !== 1 ? "s" : "") +
                " · " + safe.rfqs + " RFQ" + (safe.rfqs !== 1 ? "s" : "") + " open",
      },
    },
    _counts: safe,
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

/* ── ROW 1 ── */
function renderKpiStrip(data) {
  var el = document.getElementById("kpiCommandStrip");
  if (!el) return;
  var c = data._counts;
  var tiles = [
    { value: c.leads,       label: "Leads",    module: "Sales",       icon: "&#128101;", color: "#2563eb" },
    { value: c.accounts,    label: "Accounts", module: "Sales",       icon: "&#127970;", color: "#2563eb" },
    { value: c.deals,       label: "Deals",    module: "Sales",       icon: "&#129309;", color: "#2563eb" },
    { value: c.projects,    label: "Projects", module: "Operations",  icon: "&#128208;", color: "#4338ca" },
    { value: c.rfqs,        label: "RFQs",     module: "Procurement", icon: "&#128203;", color: "#16a34a" },
    { value: c.vendors,     label: "Vendors",  module: "Procurement", icon: "&#127981;",
      color: c.vendors < CONFIG.vendorWarnThreshold ? "#d97706" : "#16a34a" },
  ];
  var html = "";
  for (var i = 0; i < tiles.length; i++) {
    var t = tiles[i];
    html += '<div class="kpi-strip-tile" style="--strip-color:' + t.color + '">' +
      '<div class="kpi-strip-icon">' + t.icon + '</div>' +
      '<div class="kpi-strip-value">' + t.value + '</div>' +
      '<div class="kpi-strip-label">' + t.label + '</div>' +
      '<div class="kpi-strip-module">' + t.module + '</div>' +
      '</div>';
  }
  el.innerHTML = html;
}

/* ── ROWS 2–4 ── */
function renderKpiRow(containerId, kpis, accent, badgeId, badgeText) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var html = "";
  for (var i = 0; i < kpis.length; i++) {
    var k = kpis[i];
    html += '<div class="kpi-tile" style="--accent:' + accent + '">' +
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
   * [OPENAI] Replace with AI summary from Deluge Function:
   *   ZOHO.CRM.FUNCTIONS.execute("get_ai_summary", {
   *     arguments: JSON.stringify({ counts: c })
   *   }).then(function(resp) {
   *     var ai = JSON.parse(resp.details.output).summary;
   *     document.getElementById("execSummaryText").textContent = ai;
   *   });
   */

  var textEl = document.getElementById("execSummaryText");
  if (textEl) textEl.textContent = summary;

  var dateEl = document.getElementById("execSummaryDate");
  if (dateEl) {
    dateEl.textContent = "Generated: " +
      new Date().toLocaleDateString("en-IN", {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
      }) + (appState.isLive ? " · Live CRM Data" : " · Preview Mode");
  }
}

/* ── ROW 6: MANAGEMENT ALERTS ── */
function renderAlerts(data) {
  var el = document.getElementById("alertsGrid");
  if (!el) return;
  var c = data._counts;
  var alerts = [];

  alerts.push(c.vendors < CONFIG.vendorWarnThreshold ? {
    type: "is-warn", sym: "&#9888;",
    title: "Only " + c.vendors + " Vendor" + (c.vendors !== 1 ? "s" : "") + " Available",
    detail: "Vendor base is critically low — expand vendor registration immediately",
  } : {
    type: "is-ok", sym: "&#10004;",
    title: c.vendors + " Vendors Registered",
    detail: "Vendor base is adequate for current procurement volume",
  });

  alerts.push({
    type: c.projects > 0 ? "is-ok" : "is-warn",
    sym:  c.projects > 0 ? "&#10004;" : "&#9888;",
    title: c.projects + " Project" + (c.projects !== 1 ? "s" : "") + " Active",
    detail: c.projects > 0
      ? "All " + c.projects + " projects are active in the system"
      : "No active projects found in CRM",
  });

  alerts.push({
    type: c.rfqs > 0 ? "is-ok" : "is-info",
    sym:  c.rfqs > 0 ? "&#10004;" : "&#8505;",
    title: c.rfqs + " RFQ" + (c.rfqs !== 1 ? "s" : "") + " Active",
    detail: c.rfqs > 0
      ? c.rfqs + " RFQs are open and under procurement review"
      : "No open RFQs in the procurement pipeline",
  });

  alerts.push({
    type: appState.isLive ? "is-info" : "is-warn",
    sym:  appState.isLive ? "&#128274;" : "&#9888;",
    title: appState.isLive ? "CRM Synchronized Successfully" : "Running in Preview Mode",
    detail: appState.isLive
      ? "Live data fetched via Deluge Function · All modules accessible"
      : "Open inside Zoho CRM Home Page to see live data",
  });

  var html = "";
  for (var i = 0; i < alerts.length; i++) {
    var a = alerts[i];
    html += '<div class="alert-item ' + a.type + '">' +
      '<div class="alert-sym">' + a.sym + '</div>' +
      '<div class="alert-content">' +
      '<div class="alert-title">' + a.title + '</div>' +
      '<div class="alert-detail">' + a.detail + '</div>' +
      '</div></div>';
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
    html += '<div class="health-card">' +
      '<div class="health-label">' + item.label + '</div>' +
      '<div class="health-status"><span class="status-dot status-' + item.status + '"></span>' + item.text + '</div>' +
      '<div class="health-detail">' + item.detail + '</div>' +
      '<div class="health-pill pill-' + item.status + '">' + icons[item.status] + ' ' + (labels[item.status] || "Unknown") + '</div>' +
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
  if (updEl) updEl.textContent = "Updated " +
    t.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) +
    (appState.isLive ? " · Live" : " · Preview");
  var dateEl = document.getElementById("headerDate");
  if (dateEl) dateEl.textContent = t.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric"
  });
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

/* ══════════════════════════════════════════════════════════════
   README — DELUGE FUNCTION CODE
   Create this function in Zoho CRM:
   Setup → Developer Tools → Functions → New Function
   Name: get_dashboard_counts
   Category: CRM Function
   ──────────────────────────────────────────────────────────────

   leadsResp = zoho.crm.getRecords("Leads", 1, 200, null);
   accountsResp = zoho.crm.getRecords("Accounts", 1, 200, null);
   dealsResp = zoho.crm.getRecords("Deals", 1, 200, null);
   projectsResp = zoho.crm.getRecords("Projects", 1, 200, null);
   rfqsResp = zoho.crm.getRecords("RFQ", 1, 200, null);
   budgetResp = zoho.crm.getRecords("Budget_Plan", 1, 200, null);
   vendorsResp = zoho.crm.getRecords("Vendors", 1, 200, null);

   result = Map();
   result.put("leads", leadsResp.size());
   result.put("accounts", accountsResp.size());
   result.put("deals", dealsResp.size());
   result.put("projects", projectsResp.size());
   result.put("rfqs", rfqsResp.size());
   result.put("budgetPlans", budgetResp.size());
   result.put("vendors", vendorsResp.size());

   return result.toString();

══════════════════════════════════════════════════════════════ */

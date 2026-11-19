/*
 * Shared bits for every page.
 *
 * FEEDBACK_URL: paste the owner's Google Form link here (must start with
 * https://docs.google.com/forms/ or https://forms.gle/). While it is empty, no
 * feedback link is shown anywhere, so the site never shows a broken link.
 *
 * Also fills the live "data coverage" box on the methodology page from
 * prices.json, so those numbers are never typed by hand.
 */
(function () {
  "use strict";

  var FEEDBACK_URL = "";

  function isFormUrl(u) {
    return /^https:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)/.test(u);
  }

  // Sidebar link + any in-page feedback buttons (elements with data-feedback).
  if (isFormUrl(FEEDBACK_URL)) {
    var slot = document.getElementById("feedback-slot");
    if (slot) {
      var a = document.createElement("a");
      a.className = "nav-link nav-feedback";
      a.href = FEEDBACK_URL;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Give feedback";
      slot.appendChild(a);
      slot.hidden = false;
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-feedback]"), function (node) {
      node.setAttribute("href", FEEDBACK_URL);
      node.hidden = false;
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-feedback-missing]"), function (node) {
      node.hidden = true;
    });
  }

  // ---------- live coverage (methodology page only) ----------
  var box = document.getElementById("coverage");
  if (!box) return;

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  function fmt(p) {
    var m = /^(\d{4})-(\d{2})$/.exec(p || "");
    return m ? MONTHS[Number(m[2]) - 1] + " " + m[1] : p;
  }
  function set(id, text) { var n = document.getElementById(id); if (n) n.textContent = text; }

  fetch("prices.json", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function (data) {
      var items = data.items || {}, regions = {}, sources = {}, periods = [], records = 0, types = {};
      Object.keys(items).forEach(function (item) {
        Object.keys(items[item] || {}).forEach(function (region) {
          regions[region] = true;
          (items[item][region] || []).forEach(function (rec) {
            records++;
            if (rec.period) periods.push(rec.period);
            sources[(rec.source_name || "") + "|" + (rec.source_url || "")] = true;
            if (rec.quote_type) types[rec.quote_type] = (types[rec.quote_type] || 0) + 1;
          });
        });
      });
      periods.sort();
      set("cov-materials", String(Object.keys(items).length));
      set("cov-regions", String(Object.keys(regions).length));
      set("cov-records", String(records));
      set("cov-sources", String(Object.keys(sources).length));
      set("cov-range", periods.length
        ? (periods[0] === periods[periods.length - 1] ? fmt(periods[0]) : fmt(periods[0]) + " to " + fmt(periods[periods.length - 1]))
        : "none yet");
      if (data.is_sample !== false) {
        set("cov-note", "These counts are from ILLUSTRATIVE DEMO DATA - NOT REAL PRICES.");
      }
      box.hidden = false;
    })
    .catch(function () { /* coverage box stays hidden if data is missing */ });
})();

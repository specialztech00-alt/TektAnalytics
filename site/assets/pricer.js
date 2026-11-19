/*
 * TektAnalytics basket pricer.
 * Prices come only from prices.json (built by scripts/build_json.py).
 * Runs entirely in the browser: nothing is saved or sent anywhere.
 * Security: data is inserted with textContent / createElement only, never innerHTML.
 */
(function () {
  "use strict";

  var DATA_URL = "prices.json";
  var MIN_PERIODS_FOR_ESCALATION = 3;
  var MAX_PERIODS_FOR_ESCALATION = 6;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  var DELIVERY_LABELS = { ex_depot: "Ex-depot", delivered: "Delivered", not_stated: "Delivery basis not stated" };
  var QUOTE_LABELS = { market_quote: "Supplier quote", published_report: "Published report", supplier_list: "Supplier price list" };

  var dataset = null;   // { isSample, generatedAt, series: { region: { item: series } } }
  var lines = [];       // [{ id, item, qty }]
  var nextId = 1;

  // ---------- helpers ----------

  function byId(id) { return document.getElementById(id); }

  function el(tag, opts, children) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.cls) node.className = opts.cls;
    if (opts.text != null) node.textContent = String(opts.text);
    if (opts.attrs) Object.keys(opts.attrs).forEach(function (k) { node.setAttribute(k, opts.attrs[k]); });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function isHttpUrl(url) { return typeof url === "string" && /^https?:\/\//i.test(url.trim()); }

  function periodIndex(p) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(p || ""));
    if (!m) return null;
    var month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    return Number(m[1]) * 12 + (month - 1);
  }

  function formatPeriod(idx) { return MONTHS[idx % 12] + " " + Math.floor(idx / 12); }

  var nairaFmt = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });
  function formatNaira(n) { return "₦" + nairaFmt.format(Math.round(n)); }

  function pct(x, digits) { return (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(digits) + "%"; }

  function median(values) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function label(map, v) { return v ? (map[v] || String(v)) : ""; }

  // ---------- data shaping ----------

  // One series per region + item: points sorted by month, each with median price and records.
  function shape(data) {
    var series = {};
    var items = data.items || {};
    Object.keys(items).forEach(function (item) {
      var regions = items[item] || {};
      Object.keys(regions).forEach(function (region) {
        var byPeriod = {};
        (regions[region] || []).forEach(function (rec) {
          var idx = periodIndex(rec && rec.period);
          var price = Number(rec && rec.price_ngn);
          if (idx === null || !isFinite(price) || price <= 0) return;
          (byPeriod[idx] = byPeriod[idx] || []).push(rec);
        });
        var points = Object.keys(byPeriod).map(Number).sort(function (a, b) { return a - b; })
          .map(function (idx) {
            var recs = byPeriod[idx];
            return { idx: idx, value: median(recs.map(function (r) { return Number(r.price_ngn); })), records: recs };
          });
        if (!points.length) return;
        var latest = points[points.length - 1];
        (series[region] = series[region] || {})[item] = {
          item: item,
          region: region,
          unit: latest.records[latest.records.length - 1].unit || "",
          points: points,
          latest: latest,
          escalation: escalationRate(points)
        };
      });
    });
    return series;
  }

  // Average monthly-equivalent rate over up to the last 6 recorded months.
  // Returns { ok, g, periods } or { ok: false, periods }.
  function escalationRate(points) {
    var used = points.slice(-MAX_PERIODS_FOR_ESCALATION);
    if (used.length < MIN_PERIODS_FOR_ESCALATION) return { ok: false, periods: points.length };
    var rates = [];
    for (var i = 1; i < used.length; i++) {
      var months = used[i].idx - used[i - 1].idx;
      rates.push(Math.pow(used[i].value / used[i - 1].value, 1 / months) - 1);
    }
    var g = rates.reduce(function (a, b) { return a + b; }, 0) / rates.length;
    return { ok: true, g: g, periods: used.length };
  }

  function regionsList() { return Object.keys(dataset.series).sort(function (a, b) { return a.localeCompare(b); }); }

  function itemsIn(region) {
    return Object.keys(dataset.series[region] || {}).sort(function (a, b) { return a.localeCompare(b); });
  }

  function currentRegion() { return byId("region-select").value; }

  function monthsUntilPurchase() {
    var m = Number(byId("months-input").value);
    if (!isFinite(m) || m < 0) return 0;
    return Math.min(Math.floor(m), 36);
  }

  function sourcesOf(point) {
    var seen = {}, list = [];
    point.records.forEach(function (r) {
      var detail = [r.spec, label(DELIVERY_LABELS, r.delivery_basis), label(QUOTE_LABELS, r.quote_type)]
        .filter(Boolean).join(" · ");
      var key = (r.source_url || "") + "|" + (r.source_name || "") + "|" + detail;
      if (seen[key]) return;
      seen[key] = true;
      list.push({ name: r.source_name || r.source_url || "Unnamed source", url: r.source_url, detail: detail });
    });
    return list;
  }

  // ---------- calculation ----------

  // Returns one result per line plus totals. Pure: reads state, renders nothing.
  function calculate() {
    var region = currentRegion();
    var m = monthsUntilPurchase();
    var results = lines.map(function (line) {
      var s = (dataset.series[region] || {})[line.item] || null;
      var qty = Number(line.qty);
      var qtyOk = line.qty !== "" && isFinite(qty) && qty > 0;
      var total = s && qtyOk ? Math.round(qty * s.latest.value) : null;
      var esc = null;
      if (s && s.escalation.ok && total !== null && m > 0) {
        var factor = Math.pow(1 + s.escalation.g, m) - 1;
        esc = { factor: factor, amount: Math.round(total * factor) };
      }
      return { line: line, series: s, qtyOk: qtyOk, total: total, esc: esc };
    });
    var priced = results.filter(function (r) { return r.total !== null; });
    var subtotal = priced.reduce(function (a, r) { return a + r.total; }, 0);
    var withEsc = priced.filter(function (r) { return r.esc; });
    var escTotal = withEsc.reduce(function (a, r) { return a + r.esc.amount; }, 0);
    return {
      region: region, months: m, results: results, pricedCount: priced.length,
      subtotal: subtotal, escCount: withEsc.length, escTotal: escTotal, grand: subtotal + escTotal
    };
  }

  // ---------- rendering ----------

  function escalationText(r, months) {
    var s = r.series;
    if (!s) return "";
    if (!s.escalation.ok) {
      return "Not shown: needs " + MIN_PERIODS_FOR_ESCALATION + "+ months of prices (has " + s.escalation.periods + ")";
    }
    var rate = "g = " + pct(s.escalation.g, 2) + " per month from " + s.escalation.periods + " months";
    if (months === 0) return rate + ". Set months until purchase to estimate an allowance.";
    if (!r.esc) return rate;
    return pct(r.esc.factor, 1) + " over " + months + " month" + (months === 1 ? "" : "s") +
      " ≈ " + formatNaira(r.esc.amount) + " (" + rate + ")";
  }

  function render() {
    var calc = calculate();
    var body = byId("basket-body");
    clear(body);

    calc.results.forEach(function (r) {
      var line = r.line, s = r.series;

      var itemSel = el("select", { attrs: { "aria-label": "Material" } });
      var available = itemsIn(calc.region);
      if (!s) itemSel.appendChild(el("option", { text: "Choose a material", attrs: { value: "" } }));
      available.forEach(function (it) {
        var opt = el("option", { text: it });
        opt.value = it;
        if (it === line.item) opt.selected = true;
        itemSel.appendChild(opt);
      });
      itemSel.addEventListener("change", function () { line.item = itemSel.value; render(); });

      var qtyInput = el("input", {
        cls: "qty-input",
        attrs: { type: "number", min: "0", step: "any", inputmode: "decimal", "aria-label": "Quantity", value: line.qty }
      });
      qtyInput.addEventListener("change", function () { line.qty = qtyInput.value.trim(); render(); });

      var qtyCell = el("td", { cls: "nowrap" }, [qtyInput, el("span", { cls: "muted small", text: s && s.unit ? " " + s.unit : "" })]);
      if (s && line.qty !== "" && !r.qtyOk) qtyCell.appendChild(el("div", { cls: "field-hint", text: "Enter a quantity above 0" }));

      var priceCell = el("td", { cls: "num" });
      var srcCell = el("td");
      if (s) {
        priceCell.appendChild(document.createTextNode(formatNaira(s.latest.value)));
        priceCell.appendChild(el("div", { cls: "muted small", text: formatPeriod(s.latest.idx) }));
        if (s.latest.records.length > 1) {
          priceCell.appendChild(el("div", { cls: "muted small", text: "median of " + s.latest.records.length + " sources" }));
        }
        sourcesOf(s.latest).forEach(function (src, i) {
          var nameNode = isHttpUrl(src.url)
            ? el("a", { text: src.name, attrs: { href: src.url.trim(), target: "_blank", rel: "noopener noreferrer" } })
            : el("span", null, [el("span", { text: src.name }), el("span", { cls: "muted", text: " (no public link)" })]);
          var block = el("div", { cls: i ? "source-block" : "" }, [nameNode]);
          if (src.detail) block.appendChild(el("div", { cls: "muted small", text: src.detail }));
          srcCell.appendChild(block);
        });
      } else {
        priceCell.textContent = "—";
      }

      var removeBtn = el("button", { cls: "btn-link", text: "Remove", attrs: { type: "button" } });
      removeBtn.addEventListener("click", function () {
        lines = lines.filter(function (l) { return l.id !== line.id; });
        if (!lines.length) addLine();
        render();
      });

      body.appendChild(el("tr", null, [
        el("td", null, [itemSel]),
        qtyCell,
        priceCell,
        el("td", { cls: "num", text: r.total !== null ? formatNaira(r.total) : "—" }),
        el("td", { cls: "small", text: escalationText(r, calc.months) }),
        srcCell,
        el("td", { cls: "no-print" }, [removeBtn])
      ]));
    });

    // Add button: disabled once every material in the region is already in the basket.
    var used = {};
    lines.forEach(function (l) { if (l.item) used[l.item] = true; });
    var remaining = itemsIn(calc.region).filter(function (it) { return !used[it]; });
    byId("add-line").disabled = remaining.length === 0;
    var addNote = byId("add-note");
    addNote.hidden = remaining.length !== 0;
    addNote.textContent = "Every material with a price in " + calc.region + " is already in the basket.";

    byId("subtotal").textContent = calc.pricedCount ? formatNaira(calc.subtotal) : "—";
    var escRow = byId("escalation-row");
    escRow.hidden = !(calc.months > 0 && calc.escCount > 0);
    byId("escalation-label").textContent = "Escalation allowance, " + calc.months + " month" +
      (calc.months === 1 ? "" : "s") + " (estimate, not a forecast; " + calc.escCount + " of " +
      calc.pricedCount + " lines)";
    byId("escalation-total").textContent = formatNaira(calc.escTotal);
    byId("grand-total").textContent = calc.pricedCount ? formatNaira(calc.grand) : "—";

    var notes = [];
    notes.push(calc.pricedCount + " of " + calc.results.length + " line" + (calc.results.length === 1 ? "" : "s") + " priced.");
    if (calc.months > 0 && calc.escCount < calc.pricedCount) {
      notes.push((calc.pricedCount - calc.escCount) + " priced line" + (calc.pricedCount - calc.escCount === 1 ? " has" : "s have") +
        " no escalation estimate (fewer than " + MIN_PERIODS_FOR_ESCALATION + " months of prices), so the total is at latest prices for " +
        (calc.pricedCount - calc.escCount === 1 ? "it" : "them") + ".");
    }
    byId("totals-note").textContent = notes.join(" ");

    byId("print-meta").textContent = "Region: " + calc.region + " · Months until purchase: " + calc.months +
      " · Printed " + new Date().toISOString().slice(0, 10) + (dataset.isSample ? " · ILLUSTRATIVE DEMO DATA - NOT REAL PRICES" : "");
    byId("csv-btn").disabled = calc.pricedCount === 0;
  }

  function addLine() {
    var region = currentRegion();
    var used = {};
    lines.forEach(function (l) { if (l.item) used[l.item] = true; });
    var next = itemsIn(region).filter(function (it) { return !used[it]; })[0] || "";
    lines.push({ id: nextId++, item: next, qty: "" });
  }

  // ---------- CSV export ----------

  // Quote every cell; prefix cells that start with = + - @ so spreadsheets
  // don't treat text from the data file as a formula.
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function downloadCsv() {
    var calc = calculate();
    var rows = [];
    if (dataset.isSample) rows.push(["ILLUSTRATIVE DEMO DATA - NOT REAL PRICES"]);
    rows.push(["TektAnalytics basket", "Region: " + calc.region, "Months until purchase: " + calc.months,
      "Generated: " + new Date().toISOString().slice(0, 10)]);
    rows.push([]);
    rows.push(["Material", "Quantity", "Unit", "Unit price (NGN)", "Price month", "Sources used",
      "Line total (NGN)", "Escalation allowance (NGN)", "Escalation note", "Source details", "Source links"]);
    calc.results.forEach(function (r) {
      if (!r.series) return;
      var s = r.series, srcs = sourcesOf(s.latest);
      rows.push([
        s.item, r.qtyOk ? r.line.qty : "", s.unit, Math.round(s.latest.value), s.latest.records[0].period,
        s.latest.records.length, r.total !== null ? r.total : "", r.esc ? r.esc.amount : "",
        escalationText(r, calc.months),
        srcs.map(function (x) { return x.name + (x.detail ? " (" + x.detail + ")" : ""); }).join("; "),
        srcs.map(function (x) { return isHttpUrl(x.url) ? x.url.trim() : "no public link"; }).join("; ")
      ]);
    });
    rows.push([]);
    rows.push(["Subtotal (latest prices)", "", "", "", "", "", calc.subtotal]);
    if (calc.months > 0 && calc.escCount) {
      rows.push(["Escalation allowance (estimate, not a forecast)", "", "", "", "", "", "", calc.escTotal]);
    }
    rows.push(["Total", "", "", "", "", "", calc.grand]);

    var csv = "﻿" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
    var url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    var a = el("a", { attrs: { href: url, download: "tektanalytics-basket-" + new Date().toISOString().slice(0, 10) + ".csv" } });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---------- main ----------

  function showStatus(kind, heading, text) {
    var box = byId("status");
    clear(box);
    box.className = "status" + (kind === "error" ? " is-error" : "");
    box.setAttribute("role", kind === "error" ? "alert" : "status");
    box.appendChild(el("h2", { text: heading }));
    box.appendChild(el("p", { text: text }));
    box.hidden = false;
  }

  function init() {
    fetch(DATA_URL, { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("The server answered " + res.status + " for " + DATA_URL + ".");
        return res.json();
      })
      .then(function (data) {
        if (!data || typeof data !== "object" || typeof data.items !== "object" || data.items === null) {
          throw new Error("prices.json is not in the expected format. Rebuild it with scripts/build_json.py.");
        }
        var isSample = data.is_sample !== false;
        if (isSample) {
          byId("sample-banner").hidden = false;
          document.title = "[DEMO DATA] " + document.title;
        }
        dataset = { isSample: isSample, series: shape(data) };
        if (typeof data.generated_at === "string" && data.generated_at) {
          byId("generated-line").textContent =
            "Page data built " + data.generated_at.replace("T", " ").replace(/Z$/, " UTC") + ".";
        }

        var regions = regionsList();
        if (!regions.length) {
          showStatus("info", "No price records yet", "Add checked, sourced prices to data/prices.csv, then rebuild.");
          return;
        }
        var regionSel = byId("region-select");
        regions.forEach(function (r) {
          var opt = el("option", { text: r });
          opt.value = r;
          regionSel.appendChild(opt);
        });
        regionSel.addEventListener("change", function () {
          // Keep lines whose material exists in the new region; clear the rest.
          var available = dataset.series[currentRegion()] || {};
          lines.forEach(function (l) { if (!available[l.item]) l.item = ""; });
          render();
        });
        byId("months-input").addEventListener("input", render);
        byId("add-line").addEventListener("click", function () { addLine(); render(); });
        byId("print-btn").addEventListener("click", function () { window.print(); });
        byId("csv-btn").addEventListener("click", downloadCsv);

        addLine();
        byId("pricer").hidden = false;
        render();
      })
      .catch(function (err) {
        showStatus("error", "Could not load the price data (prices.json)",
          (location.protocol === "file:"
            ? "This page was opened directly as a file. Run: python scripts/build_json.py, then python -m http.server -d site, and open http://localhost:8000/pricer.html."
            : ((err && err.message) || "Unknown error.") + " Run python scripts/build_json.py and reload."));
      });
  }

  init();
})();

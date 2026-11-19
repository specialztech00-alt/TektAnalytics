/*
 * TektAnalytics dashboard.
 * Everything shown is computed from prices.json (built by scripts/build_json.py).
 * No prices, materials, percentages or claims are hard-coded here.
 * Security: data from the file is only ever inserted with textContent /
 * createElement / setAttribute — never innerHTML.
 */
(function () {
  "use strict";

  var DATA_URL = "prices.json";
  var MAX_KPIS = 6;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  var ACCENT = "#f97316";

  var chart = null;
  var chartDefaultsSet = false;
  var combos = [];

  // ---------- small helpers ----------

  function byId(id) { return document.getElementById(id); }

  // Create an element. opts: { cls, text, attrs }. children: array of nodes.
  function el(tag, opts, children) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.cls) node.className = opts.cls;
    if (opts.text != null) node.textContent = String(opts.text);
    if (opts.attrs) {
      Object.keys(opts.attrs).forEach(function (k) { node.setAttribute(k, opts.attrs[k]); });
    }
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function isHttpUrl(url) { return typeof url === "string" && /^https?:\/\//i.test(url.trim()); }

  // "2026-02" -> month index (2026*12 + 1), or null if malformed.
  function periodIndex(p) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(p || ""));
    if (!m) return null;
    var month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    return Number(m[1]) * 12 + (month - 1);
  }

  function indexToPeriod(idx) {
    var y = Math.floor(idx / 12), m = (idx % 12) + 1;
    return y + "-" + (m < 10 ? "0" : "") + m;
  }

  function formatPeriod(idx) { return MONTHS[idx % 12] + " " + Math.floor(idx / 12); }

  function shortPeriod(idx) { return MONTHS[idx % 12].slice(0, 3) + " " + Math.floor(idx / 12); }

  var nairaFmt = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });
  function formatNaira(n) { return "₦" + nairaFmt.format(n); }

  function median(values) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  // ---------- data shaping ----------

  // Turn prices.json into one "combo" per item+region with a per-period series.
  function buildCombos(data) {
    var out = [];
    var stats = { records: 0, skipped: 0, sources: {}, latestIdx: null };
    var items = data.items || {};

    Object.keys(items).forEach(function (item) {
      var regions = items[item] || {};
      Object.keys(regions).forEach(function (region) {
        var byPeriod = {};
        (regions[region] || []).forEach(function (rec) {
          var idx = periodIndex(rec && rec.period);
          var price = Number(rec && rec.price_ngn);
          if (idx === null || !isFinite(price) || price <= 0) { stats.skipped++; return; }
          stats.records++;
          if (rec.source_url || rec.source_name) {
            stats.sources[(rec.source_url || "") + "|" + (rec.source_name || "")] = true;
          }
          (byPeriod[idx] = byPeriod[idx] || []).push(rec);
        });

        var points = Object.keys(byPeriod).map(Number).sort(function (a, b) { return a - b; })
          .map(function (idx) {
            var recs = byPeriod[idx];
            return {
              idx: idx,
              value: median(recs.map(function (r) { return Number(r.price_ngn); })),
              records: recs
            };
          });
        if (!points.length) return;

        var latest = points[points.length - 1];
        if (stats.latestIdx === null || latest.idx > stats.latestIdx) stats.latestIdx = latest.idx;
        out.push({
          item: item,
          region: region,
          unit: latest.records[latest.records.length - 1].unit || "",
          points: points,
          latest: latest,
          change: computeChange(points)
        });
      });
    });

    stats.sourceCount = Object.keys(stats.sources).length;
    return { combos: out, stats: stats };
  }

  // Change between the latest period and the previous AVAILABLE period,
  // labelled with the real gap in months.
  function computeChange(points) {
    if (points.length < 2) return { text: "n/a - one period so far", since: null };
    var last = points[points.length - 1], prev = points[points.length - 2];
    var gap = last.idx - prev.idx;
    var pct = (last.value - prev.value) / prev.value * 100;
    var rounded = Math.round(pct * 10) / 10;
    var sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
    var label = gap === 1 ? "month-on-month" : "over " + gap + " months";
    return {
      text: sign + Math.abs(rounded).toFixed(1) + "% " + label,
      since: "vs " + formatPeriod(prev.idx)
    };
  }

  // Schema v2 labels. Unknown values are shown as-is (as text, never HTML).
  var DELIVERY_LABELS = {
    ex_depot: "Ex-depot",
    delivered: "Delivered",
    not_stated: "Delivery basis not stated"
  };
  var QUOTE_LABELS = {
    market_quote: "Supplier quote",
    published_report: "Published report",
    supplier_list: "Supplier price list"
  };

  function label(map, value) { return value ? (map[value] || String(value)) : ""; }

  // One line describing exactly what was priced and how: spec, delivery basis,
  // quote type and the date the owner recorded it.
  function recordDetail(r) {
    var parts = [];
    if (r.spec) parts.push(r.spec);
    if (r.delivery_basis) parts.push(label(DELIVERY_LABELS, r.delivery_basis));
    if (r.quote_type) parts.push(label(QUOTE_LABELS, r.quote_type));
    if (r.collected_on) parts.push("recorded " + r.collected_on);
    return parts.join(" · ");
  }

  function sourcesOf(point) {
    var seen = {}, list = [];
    point.records.forEach(function (r) {
      var key = (r.source_url || "") + "|" + (r.source_name || "") + "|" + recordDetail(r);
      if (seen[key]) return;
      seen[key] = true;
      list.push({
        name: r.source_name || r.source_url || "Unnamed source",
        url: r.source_url,
        detail: recordDetail(r)
      });
    });
    return list;
  }

  function sourceNode(src) {
    if (isHttpUrl(src.url)) {
      return el("a", { text: src.name, attrs: { href: src.url.trim(), target: "_blank", rel: "noopener noreferrer" } });
    }
    // Phone/WhatsApp quotes have no public page: say so instead of hiding it.
    return el("span", null, [
      el("span", { text: src.name }),
      el("span", { cls: "muted", text: " (no public link)" })
    ]);
  }

  // ---------- rendering ----------

  function showStatus(kind, heading, lines) {
    var box = byId("status");
    clear(box);
    box.className = "status" + (kind === "error" ? " is-error" : "");
    box.setAttribute("role", kind === "error" ? "alert" : "status");
    box.appendChild(el("h2", { text: heading }));
    lines.forEach(function (line) {
      var p = el("p");
      line.forEach(function (part) {
        p.appendChild(typeof part === "string" ? document.createTextNode(part) : el("code", { text: part.code }));
      });
      box.appendChild(p);
    });
    box.hidden = false;
  }

  function renderMeta(stats, data) {
    var parts = [];
    if (stats.latestIdx !== null) parts.push("Data last updated: " + formatPeriod(stats.latestIdx));
    parts.push(plural(stats.records, "record", "records"));
    parts.push(plural(stats.sourceCount, "source", "sources"));
    byId("meta-line").textContent = parts.join(" · ");

    if (typeof data.generated_at === "string" && data.generated_at) {
      byId("generated-line").textContent =
        "Page data built " + data.generated_at.replace("T", " ").replace(/Z$/, " UTC") + ".";
    }
  }

  function renderKpis() {
    var grid = byId("kpi-grid");
    clear(grid);
    var sorted = combos.slice().sort(function (a, b) {
      return (b.latest.idx - a.latest.idx) || a.item.localeCompare(b.item) || a.region.localeCompare(b.region);
    });
    sorted.slice(0, MAX_KPIS).forEach(function (c) {
      var price = el("p", { cls: "kpi-price", text: formatNaira(c.latest.value) });
      if (c.unit) price.appendChild(el("span", { cls: "kpi-unit", text: " / " + c.unit }));
      var periodText = formatPeriod(c.latest.idx);
      if (c.latest.records.length > 1) periodText += " · median of " + c.latest.records.length + " sources";
      grid.appendChild(el("article", { cls: "kpi" }, [
        el("h3", { cls: "kpi-item", text: c.item }),
        el("p", { cls: "kpi-region", text: c.region }),
        price,
        el("p", { cls: "kpi-period", text: periodText }),
        el("span", { cls: "kpi-change", text: c.change.text, attrs: c.change.since ? { title: c.change.since } : {} })
      ]));
    });
    var note = byId("kpi-note");
    if (sorted.length > MAX_KPIS) {
      note.textContent = "Showing the " + MAX_KPIS + " most recently updated of " + sorted.length +
        " material and region pairs. All are listed in the table below.";
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  function renderTable() {
    var body = byId("table-body");
    clear(body);
    var sorted = combos.slice().sort(function (a, b) {
      return a.item.localeCompare(b.item) || a.region.localeCompare(b.region);
    });
    sorted.forEach(function (c) {
      var changeCell = el("td", null, [el("div", { cls: "nowrap", text: c.change.text })]);
      if (c.change.since) changeCell.appendChild(el("div", { cls: "muted small", text: c.change.since }));

      var srcCell = el("td");
      sourcesOf(c.latest).forEach(function (s, i) {
        var block = el("div", { cls: i ? "source-block" : "" }, [sourceNode(s)]);
        if (s.detail) block.appendChild(el("div", { cls: "muted small", text: s.detail }));
        srcCell.appendChild(block);
      });

      var priceText = formatNaira(c.latest.value);
      var priceCell = el("td", { cls: "num", text: priceText });
      if (c.latest.records.length > 1) {
        priceCell.appendChild(el("div", { cls: "muted small", text: "median of " + c.latest.records.length + " sources" }));
      }

      body.appendChild(el("tr", null, [
        el("td", { text: c.item }),
        el("td", { text: c.unit }),
        el("td", { text: c.region }),
        priceCell,
        el("td", { cls: "nowrap", text: formatPeriod(c.latest.idx) }),
        changeCell,
        srcCell
      ]));
    });
  }

  // ---------- chart ----------

  function fillSelect(select, values, selected) {
    clear(select);
    values.forEach(function (v) {
      var opt = el("option", { text: v });
      opt.value = v;
      if (v === selected) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function itemsList() {
    var seen = {};
    return combos.map(function (c) { return c.item; })
      .filter(function (i) { if (seen[i]) return false; seen[i] = true; return true; })
      .sort(function (a, b) { return a.localeCompare(b); });
  }

  function regionsFor(item) {
    return combos.filter(function (c) { return c.item === item; })
      .map(function (c) { return c.region; })
      .sort(function (a, b) { return a.localeCompare(b); });
  }

  function findCombo(item, region) {
    for (var i = 0; i < combos.length; i++) {
      if (combos[i].item === item && combos[i].region === region) return combos[i];
    }
    return null;
  }

  function setupSelectors() {
    var itemSel = byId("item-select"), regionSel = byId("region-select");
    // Default to the most recently updated pair.
    var first = combos.slice().sort(function (a, b) { return b.latest.idx - a.latest.idx; })[0];
    fillSelect(itemSel, itemsList(), first.item);
    fillSelect(regionSel, regionsFor(first.item), first.region);

    itemSel.addEventListener("change", function () {
      var regions = regionsFor(itemSel.value);
      fillSelect(regionSel, regions, regions[0]);
      renderChart();
    });
    regionSel.addEventListener("change", renderChart);
  }

  function renderChart() {
    var c = findCombo(byId("item-select").value, byId("region-select").value);
    var note = byId("chart-note"), legend = byId("chart-legend"), canvas = byId("price-chart");
    if (!c) return;

    if (typeof window.Chart === "undefined") {
      canvas.parentNode.hidden = true;
      legend.hidden = true;
      note.textContent = "The chart library could not be loaded (check your internet connection). " +
        "The table below still lists every latest price.";
      note.hidden = false;
      return;
    }

    // One label per calendar month from first to last period, so gaps are visible.
    var firstIdx = c.points[0].idx, lastIdx = c.latest.idx;
    var labels = [], values = [], pointByIdx = {};
    c.points.forEach(function (p) { pointByIdx[p.idx] = p; });
    for (var i = firstIdx; i <= lastIdx; i++) {
      labels.push(shortPeriod(i));
      values.push(pointByIdx[i] ? pointByIdx[i].value : null);
    }
    var hasGap = c.points.length > 1 && (lastIdx - firstIdx + 1) > c.points.length;
    canvas.parentNode.hidden = false;
    if (!chartDefaultsSet) {
      window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
      window.Chart.defaults.color = "#475569";
      chartDefaultsSet = true;
    }

    canvas.setAttribute("aria-label", "Line chart of " + c.item + " price in " + c.region + ", " +
      (c.points.length === 1 ? "one period: " + formatPeriod(firstIdx)
        : formatPeriod(firstIdx) + " to " + formatPeriod(lastIdx)) +
      ". Latest values are also listed in the table below.");

    if (c.points.length === 1) {
      note.textContent = "More periods needed to show a trend";
      note.hidden = false;
    } else {
      note.hidden = true;
    }
    if (hasGap) {
      legend.textContent = "Dashed line: no price recorded for the months in between.";
      legend.hidden = false;
    } else {
      legend.hidden = true;
    }

    var dataset = {
      label: c.item + " — " + c.region,
      data: values,
      borderColor: ACCENT,
      backgroundColor: ACCENT,
      pointBackgroundColor: ACCENT,
      pointBorderColor: "#ffffff",
      pointBorderWidth: 2,
      pointRadius: 6,
      pointHoverRadius: 8,
      borderWidth: 2.5,
      tension: 0,
      spanGaps: true,
      segment: {
        // Months with no data are null; the line spans them but is dashed there.
        borderDash: function (ctx) { return ctx.p0.skip || ctx.p1.skip ? [6, 6] : undefined; }
      }
    };

    var options = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: function (item) { return item.raw !== null; },
          callbacks: {
            label: function (ctx) {
              var p = pointByIdx[firstIdx + ctx.dataIndex];
              var txt = formatNaira(ctx.raw) + (c.unit ? " / " + c.unit : "");
              return p && p.records.length > 1 ? txt + " (median of " + p.records.length + " sources)" : txt;
            },
            afterLabel: function (ctx) {
              var p = pointByIdx[firstIdx + ctx.dataIndex];
              return p ? sourcesOf(p).map(function (s) { return "Source: " + s.name; }) : [];
            }
          }
        }
      },
      scales: {
        x: { offset: true, grid: { display: false }, ticks: { color: "#475569" } },
        y: {
          grace: "10%",
          ticks: { color: "#475569", callback: function (v) { return formatNaira(v); } },
          grid: { color: "#e2e8f0" }
        }
      }
    };

    if (chart) chart.destroy();
    chart = new window.Chart(canvas, { type: "line", data: { labels: labels, datasets: [dataset] }, options: options });
  }

  // ---------- main ----------

  function loadError(detail) {
    byId("meta-line").textContent = "Data not loaded";
    showStatus("error", "Could not load the price data (prices.json)", [
      [location.protocol === "file:"
        ? "This page was opened directly as a file, and browsers block loading data that way."
        : detail + " The data file may not have been built yet."],
      ["From the project folder, run:"],
      [{ code: "python scripts/build_json.py" }],
      [{ code: "python -m http.server -d site" }],
      ["Then open ", { code: "http://localhost:8000" }, " in your browser."]
    ]);
  }

  // Chart.js loads async. Call cb when it loads; if it fails or is slow (20s),
  // call cb anyway so the fallback message shows, and redraw if it arrives later.
  function whenChartReady(cb) {
    if (window.Chart) { cb(); return; }
    var note = byId("chart-note");
    note.textContent = "Loading chart…";
    note.hidden = false;
    byId("price-chart").parentNode.hidden = true;
    var drawn = false;
    var script = byId("chartjs-script");
    if (script) {
      script.addEventListener("load", function () {
        if (!drawn && window.Chart) { drawn = true; cb(); }
      });
      script.addEventListener("error", function () { if (!drawn) cb(); });
    }
    setTimeout(function () { if (!drawn && !window.Chart) cb(); }, 20000);
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

        // Anything other than an explicit is_sample=false is treated as demo data.
        if (data.is_sample !== false) {
          byId("sample-banner").hidden = false;
          document.title = "[DEMO DATA] " + document.title;
        }

        var built = buildCombos(data);
        combos = built.combos;
        renderMeta(built.stats, data);

        if (!combos.length) {
          showStatus("info", "No price records yet", [
            ["The data file has no usable price rows. Add checked, sourced prices to ",
              { code: "data/prices.csv" }, ", then run ", { code: "python scripts/build_json.py" }, "."]
          ]);
          return;
        }
        if (built.stats.skipped) {
          showStatus("info", "Some rows were skipped", [
            [plural(built.stats.skipped, "record was", "records were") +
              " skipped because the price or period was not valid. Run scripts/validate.py to find them."]
          ]);
        }

        byId("dashboard").hidden = false;
        renderKpis();
        renderTable();
        setupSelectors();
        whenChartReady(renderChart);
      })
      .catch(function (err) {
        loadError(err && err.message && /fetch|NetworkError|Load failed/i.test(err.message)
          ? "The file could not be fetched." : (err && err.message) || "Unknown error.");
      });
  }

  init();
})();

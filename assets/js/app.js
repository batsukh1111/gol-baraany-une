(() => {
  const MN = "mn-MN";
  const state = {
    catalog: null,
    weekly: null,
    monthly: null,
    selected: new Set(),
    category: "all",
    query: "",
    weeklyChart: null,
    monthlyChart: null,
  };

  const $ = (id) => document.getElementById(id);

  function fmtMoney(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return new Intl.NumberFormat(MN, { maximumFractionDigits: 0 }).format(n) + " ₮";
  }

  function fmtPct(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return sign + n.toFixed(1) + "%";
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`;
  }

  function fmtMonth(ym) {
    if (!ym) return "—";
    const [y, m] = ym.split("-");
    return `${y} оны ${Number(m)}-р сар`;
  }

  function pctChange(now, then) {
    if (now == null || then == null || then === 0) return null;
    return ((now - then) / then) * 100;
  }

  function changeClass(n) {
    if (n == null) return "flat";
    if (n > 0.05) return "up";
    if (n < -0.05) return "down";
    return "flat";
  }

  function changeArrow(n) {
    if (n == null) return "";
    if (n > 0.05) return "↑";
    if (n < -0.05) return "↓";
    return "→";
  }

  function badge(n) {
    const cls = changeClass(n);
    return `<span class="change-badge ${cls}">${changeArrow(n)} ${fmtPct(n)}</span>`;
  }

  function parseDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(iso, days) {
    const dt = parseDate(iso);
    dt.setDate(dt.getDate() + days);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function findClosest(series, targetIso, maxDays) {
    let best = null;
    let bestDiff = Infinity;
    const target = parseDate(targetIso).getTime();
    for (const row of series) {
      const diff = Math.abs(parseDate(row.date).getTime() - target);
      const days = diff / 86400000;
      if (days <= maxDays && days < bestDiff) {
        best = row;
        bestDiff = days;
      }
    }
    return best;
  }

  function weeklyCompare(product) {
    const series = product.series || [];
    if (!series.length) return null;
    const latest = series[series.length - 1];
    const prevWeek = findClosest(series.slice(0, -1), addDays(latest.date, -7), 5);
    const prevMonth = findClosest(series.slice(0, -1), addDays(latest.date, -30), 8);
    const prevYear = findClosest(series.slice(0, -1), addDays(latest.date, -365), 14);
    return {
      latest,
      week: prevWeek,
      month: prevMonth,
      year: prevYear,
      weekPct: pctChange(latest.price, prevWeek && prevWeek.price),
      monthPct: pctChange(latest.price, prevMonth && prevMonth.price),
      yearPct: pctChange(latest.price, prevYear && prevYear.price),
    };
  }

  function monthlyLatest(product) {
    const months = state.monthly.months;
    let idx = -1;
    for (let i = months.length - 1; i >= 0; i -= 1) {
      if (product.cpi[i] != null || product.ppi[i] != null) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return null;
    const prev = idx > 0 ? idx - 1 : -1;
    const year = months.findIndex((m, i) => i < idx && m === addYearMonth(months[idx], -1));
    return {
      month: months[idx],
      idx,
      cpi: product.cpi[idx],
      ppi: product.ppi[idx],
      cpiMonthPct: prev >= 0 ? pctChange(product.cpi[idx], product.cpi[prev]) : null,
      ppiMonthPct: prev >= 0 ? pctChange(product.ppi[idx], product.ppi[prev]) : null,
      cpiYearPct: year >= 0 ? pctChange(product.cpi[idx], product.cpi[year]) : null,
      ppiYearPct: year >= 0 ? pctChange(product.ppi[idx], product.ppi[year]) : null,
    };
  }

  function addYearMonth(ym, years) {
    const [y, m] = ym.split("-").map(Number);
    return `${y + years}-${String(m).padStart(2, "0")}`;
  }

  const PX_API =
    "https://data.1212.mn/api/v1/mn/NSO/" +
    encodeURIComponent("Economy, environment") +
    "/" +
    encodeURIComponent("Consumer Price Index") +
    "/DT_NSO_0600_001V4.px";
  const PX_PAGE =
    "https://www.1212.mn/mn/statcate/table-view/Economy,%20environment/Consumer%20Price%20Index/DT_NSO_0600_001V4.px";

  function roundPrice(value) {
    if (value == null || Number.isNaN(Number(value))) return null;
    const n = Number(value);
    if (Math.abs(n - Math.round(n)) < 1e-6) return Math.round(n);
    return Math.round(n * 10) / 10;
  }

  async function loadJSON(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(path + " " + res.status);
    return res.json();
  }

  function parseWeekly(raw, catalog) {
    const prodCat = raw.dimension["Бүтээгдэхүүн"].category;
    const timeCat = raw.dimension["Хугацаа"].category;
    const values = raw.value;
    const nTimes = Object.keys(timeCat.index).length;
    const times = new Array(nTimes);
    Object.entries(timeCat.index).forEach(([code, idx]) => {
      times[idx] = String(timeCat.label[code]).replace(/\./g, "-");
    });

    const products = catalog.products.map((product) => {
      const pIdx = prodCat.index[product.pxCode];
      const series = [];
      if (pIdx != null) {
        const offset = pIdx * nTimes;
        times.forEach((date, tIdx) => {
          const v = values[offset + tIdx];
          if (v == null) return;
          series.push({ date, price: roundPrice(v) });
        });
        series.sort((a, b) => (a.date < b.date ? -1 : 1));
      }
      return {
        id: product.id,
        name: product.name,
        short: product.short,
        unit: product.unit,
        category: product.category,
        pxCode: product.pxCode,
        series,
      };
    });

    const latestDate = products.reduce((max, p) => {
      const last = p.series.length ? p.series[p.series.length - 1].date : null;
      return last && (!max || last > max) ? last : max;
    }, null);

    return {
      title: raw.label || "7 хоногийн үнэ",
      source: raw.source || "Үндэсний статистикийн хороо, 1212.mn",
      sourceUrl: PX_PAGE,
      apiUrl: PX_API,
      updated: String(raw.updated || "").slice(0, 10) || latestDate,
      latestDate,
      live: true,
      products,
    };
  }

  async function fetchWeeklyLive(catalog) {
    const pxCodes = catalog.products.map((p) => p.pxCode);
    const res = await fetch(PX_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: [
          { code: "Бүтээгдэхүүн", selection: { filter: "item", values: pxCodes } },
          { code: "Хугацаа", selection: { filter: "all", values: ["*"] } },
        ],
        response: { format: "json-stat2" },
      }),
    });
    if (!res.ok) throw new Error("1212.mn " + res.status);
    return parseWeekly(await res.json(), catalog);
  }

  function productById(id) {
    return state.catalog.products.find((p) => p.id === id);
  }

  function weeklyById(id) {
    return state.weekly.products.find((p) => p.id === id);
  }

  function monthlyById(id) {
    return state.monthly.products.find((p) => p.id === id);
  }

  function renderFilters() {
    const cats = [{ id: "all", name: "Бүгд" }, ...(state.catalog.categories || [])];
    $("categoryFilters").innerHTML = cats
      .map(
        (c) =>
          `<button type="button" class="chip${state.category === c.id ? " active" : ""}" data-cat="${c.id}">${c.name}</button>`
      )
      .join("");
  }

  function renderProductGrid() {
    const q = state.query.trim().toLowerCase();
    const items = state.catalog.products.filter((p) => {
      const catOk = state.category === "all" || p.category === state.category;
      const text = (p.name + " " + p.short).toLowerCase();
      return catOk && (!q || text.includes(q));
    });
    $("productGrid").innerHTML = items
      .map(
        (p) => `
        <button type="button" class="product-btn${state.selected.has(p.id) ? " selected" : ""}" data-id="${p.id}">
          ${p.short}
          <small>${p.name}</small>
        </button>`
      )
      .join("");
    $("selectedRow").innerHTML = [...state.selected]
      .map((id) => {
        const p = productById(id);
        return `<button type="button" class="sel-chip" data-id="${id}">${p.short} ×</button>`;
      })
      .join("");
  }

  function renderWeekly() {
    const ids = [...state.selected];
    if (!ids.length) {
      $("weeklyEmpty").classList.remove("hidden");
      $("weeklyContent").classList.add("hidden");
      return;
    }
    $("weeklyEmpty").classList.add("hidden");
    $("weeklyContent").classList.remove("hidden");

    const rows = ids.map((id) => ({ id, product: weeklyById(id), cmp: weeklyCompare(weeklyById(id)) }));

    if (ids.length === 1 && rows[0].cmp) {
      const { product, cmp } = rows[0];
      $("weeklyKpis").innerHTML = `
        <div class="kpi">
          <div class="label">${product.short} · ${fmtDate(cmp.latest.date)}</div>
          <div class="value">${fmtMoney(cmp.latest.price)}</div>
          <div class="sub">1 ${product.unit} тутмын дундаж үнэ</div>
        </div>
        <div class="kpi">
          <div class="label">Өмнөх 7 хоногоос</div>
          <div class="value ${changeClass(cmp.weekPct)}">${fmtPct(cmp.weekPct)}</div>
          <div class="sub">${cmp.week ? fmtMoney(cmp.week.price) + " · " + fmtDate(cmp.week.date) : "харьцуулах тоо алга"}</div>
        </div>
        <div class="kpi">
          <div class="label">Өмнөх сараас</div>
          <div class="value ${changeClass(cmp.monthPct)}">${fmtPct(cmp.monthPct)}</div>
          <div class="sub">${cmp.month ? fmtMoney(cmp.month.price) + " · " + fmtDate(cmp.month.date) : "харьцуулах тоо алга"}</div>
        </div>
        <div class="kpi">
          <div class="label">Жилийн өмнөхөөс</div>
          <div class="value ${changeClass(cmp.yearPct)}">${fmtPct(cmp.yearPct)}</div>
          <div class="sub">${cmp.year ? fmtMoney(cmp.year.price) + " · " + fmtDate(cmp.year.date) : "харьцуулах тоо алга"}</div>
        </div>`;
    } else {
      $("weeklyKpis").innerHTML = `
        <div class="kpi">
          <div class="label">Сонгосон бараа</div>
          <div class="value">${ids.length}</div>
          <div class="sub">График харахын тулд зөвхөн нэгийг үлдээнэ үү</div>
        </div>`;
    }

    $("weeklyTable").innerHTML = rows
      .map(({ id, product, cmp }) => {
        if (!cmp) {
          return `<tr><td class="name-cell">${product.short}</td><td colspan="4">Мэдээ алга</td></tr>`;
        }
        return `<tr>
          <td class="name-cell"><button class="row-btn" data-only="${id}">${product.short}</button><div style="color:var(--muted);font-size:12px">${product.name}</div></td>
          <td>${fmtMoney(cmp.latest.price)}<div style="color:var(--muted);font-size:12px">${fmtDate(cmp.latest.date)}</div></td>
          <td>${badge(cmp.weekPct)}</td>
          <td>${badge(cmp.monthPct)}</td>
          <td>${badge(cmp.yearPct)}</td>
        </tr>`;
      })
      .join("");

    if (ids.length === 1 && rows[0].cmp) {
      $("weeklyChartWrap").classList.remove("hidden");
      $("weeklyChartTitle").textContent = rows[0].product.short + " — үнийн хөдөлгөөн, өөрчлөлтийн хувь";
      drawWeeklyChart(rows[0].product);
    } else {
      $("weeklyChartWrap").classList.add("hidden");
      if (state.weeklyChart) state.weeklyChart.destroy();
      state.weeklyChart = null;
    }
  }

  function drawWeeklyChart(product) {
    const series = product.series || [];
    const labels = series.map((s) => s.date);
    const prices = series.map((s) => s.price);
    const yoy = series.map((s) => {
      const prev = findClosest(
        series.filter((x) => x.date < s.date),
        addDays(s.date, -365),
        14
      );
      const n = pctChange(s.price, prev && prev.price);
      return n == null ? null : Number(n.toFixed(1));
    });
    const ctx = $("weeklyChart");
    if (state.weeklyChart) state.weeklyChart.destroy();
    state.weeklyChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Үнэ, төгрөг",
            data: prices,
            yAxisID: "y",
            borderColor: "#1a6fb5",
            backgroundColor: "rgba(26,111,181,0.12)",
            fill: true,
            tension: 0.2,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: "Жилийн өөрчлөлт, %",
            data: yoy,
            yAxisID: "y1",
            borderColor: "#c9a227",
            borderDash: [5, 4],
            tension: 0.2,
            pointRadius: 0,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label(item) {
                if (item.dataset.yAxisID === "y1") return `${item.dataset.label}: ${fmtPct(item.raw)}`;
                return `${item.dataset.label}: ${fmtMoney(item.raw)}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 10,
              callback(value) {
                const label = this.getLabelForValue(value);
                return fmtDate(label);
              },
            },
          },
          y: {
            position: "left",
            title: { display: true, text: "Төгрөг" },
            ticks: { callback: (v) => new Intl.NumberFormat(MN).format(v) },
          },
          y1: {
            position: "right",
            grid: { drawOnChartArea: false },
            title: { display: true, text: "%" },
            ticks: { callback: (v) => v + "%" },
          },
        },
      },
    });
  }

  function renderMonthly() {
    const ids = [...state.selected];
    if (!ids.length) {
      $("monthlyEmpty").classList.remove("hidden");
      $("monthlyContent").classList.add("hidden");
      return;
    }
    $("monthlyEmpty").classList.add("hidden");
    $("monthlyContent").classList.remove("hidden");

    const months = state.monthly.months;
    const history = ids.length === 1;
    const lastN = history ? months : months.slice(-1);
    const lastIdx = months.length - lastN.length;

    $("monthlyTable").innerHTML = ids
      .map((id) => {
        const p = monthlyById(id);
        return lastN
          .map((ym, offset) => {
            const i = lastIdx + offset;
            const prev = i > 0 ? i - 1 : -1;
            const year = months.findIndex((m, j) => j < i && m === addYearMonth(ym, -1));
            const cpiM = prev >= 0 ? pctChange(p.cpi[i], p.cpi[prev]) : null;
            const ppiM = prev >= 0 ? pctChange(p.ppi[i], p.ppi[prev]) : null;
            const cpiY = year >= 0 ? pctChange(p.cpi[i], p.cpi[year]) : null;
            const ppiY = year >= 0 ? pctChange(p.ppi[i], p.ppi[year]) : null;
            return `<tr>
              <td class="name-cell">${history ? (offset === 0 ? p.short : "") : p.short}</td>
              <td>${fmtMonth(ym)}</td>
              <td>${fmtMoney(p.cpi[i])}</td>
              <td>${badge(cpiM)}</td>
              <td>${badge(cpiY)}</td>
              <td>${fmtMoney(p.ppi[i])}</td>
              <td>${badge(ppiM)}</td>
              <td>${badge(ppiY)}</td>
            </tr>`;
          })
          .join("");
      })
      .join("");

    if (ids.length === 1) {
      $("monthlyChartWrap").classList.remove("hidden");
      drawMonthlyChart(monthlyById(ids[0]));
    } else {
      $("monthlyChartWrap").classList.add("hidden");
      if (state.monthlyChart) state.monthlyChart.destroy();
      state.monthlyChart = null;
    }
  }

  function drawMonthlyChart(product) {
    const labels = state.monthly.months;
    const ctx = $("monthlyChart");
    if (state.monthlyChart) state.monthlyChart.destroy();
    state.monthlyChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Зах зээлийн үнэ",
            data: product.cpi,
            borderColor: "#1a6fb5",
            backgroundColor: "rgba(26,111,181,0.10)",
            fill: false,
            tension: 0.2,
            pointRadius: 3,
            borderWidth: 2,
          },
          {
            label: "Үйлдвэрлэгчийн үнэ",
            data: product.ppi,
            borderColor: "#c9a227",
            tension: 0.2,
            pointRadius: 3,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              title(items) {
                return fmtMonth(items[0].label);
              },
              label(item) {
                return `${item.dataset.label}: ${fmtMoney(item.raw)}`;
              },
            },
          },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 12 } },
          y: {
            title: { display: true, text: "Төгрөг" },
            ticks: { callback: (v) => new Intl.NumberFormat(MN).format(v) },
          },
        },
      },
    });
  }

  function renderAll() {
    renderFilters();
    renderProductGrid();
    renderWeekly();
    renderMonthly();
  }

  function toggleProduct(id) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    renderAll();
  }

  function onlyProduct(id) {
    state.selected = new Set([id]);
    renderAll();
    $("weeklyTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function bindEvents() {
    $("productSearch").addEventListener("input", (e) => {
      state.query = e.target.value;
      renderProductGrid();
    });
    $("clearBtn").addEventListener("click", () => {
      state.selected.clear();
      state.query = "";
      $("productSearch").value = "";
      renderAll();
    });
    $("categoryFilters").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cat]");
      if (!btn) return;
      state.category = btn.getAttribute("data-cat");
      renderFilters();
      renderProductGrid();
    });
    $("productGrid").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-id]");
      if (btn) toggleProduct(btn.getAttribute("data-id"));
    });
    $("selectedRow").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-id]");
      if (btn) toggleProduct(btn.getAttribute("data-id"));
    });
    $("weeklyTable").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-only]");
      if (btn) onlyProduct(btn.getAttribute("data-only"));
    });
  }

  async function init() {
    try {
      const [catalog, monthly] = await Promise.all([
        loadJSON("data/products.json"),
        loadJSON("data/monthly.json"),
      ]);
      state.catalog = catalog;
      state.monthly = monthly;
      if (catalog.defaultProductId) state.selected.add(catalog.defaultProductId);
      $("monthlyMeta").textContent = `Сарын мэдээ: ${fmtMonth(monthly.updated)}`;

      let weekly;
      try {
        weekly = await fetchWeeklyLive(catalog);
        $("weeklyMeta").textContent = `7 хоногийн мэдээ: ${fmtDate(weekly.latestDate)} · 1212.mn-ээс шууд`;
      } catch (liveErr) {
        console.warn("1212.mn live fetch failed, using saved copy", liveErr);
        weekly = await loadJSON("data/weekly.json");
        weekly.live = false;
        $("weeklyMeta").textContent = `7 хоногийн мэдээ: ${fmtDate(weekly.latestDate)} · хадгалсан хуулбар`;
      }
      state.weekly = weekly;
      bindEvents();
      renderAll();
    } catch (err) {
      $("weeklyMeta").textContent = "Өгөгдөл ачаалахад алдаа гарлаа";
      $("monthlyMeta").textContent = String(err.message || err);
      console.error(err);
    }
  }

  init();
})();

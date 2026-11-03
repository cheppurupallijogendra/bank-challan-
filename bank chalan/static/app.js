/* Retention Lens front end. Every number on the page comes from the Flask API. */

const $ = (sel, root = document) => root.querySelector(sel);
const nf = new Intl.NumberFormat("en-US");
const money = (n) => "$" + nf.format(Math.round(n));
const rootStyle = getComputedStyle(document.documentElement);
const token = (name) => rootStyle.getPropertyValue(name).trim();

const COLORS = {
  stay: token("--stay"),
  leave: token("--leave"),
  gold: token("--gold"),
  muted: token("--muted"),
  line: token("--line"),
  text: token("--text"),
};

async function api(path, params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined)
  );
  const res = await fetch(`/api/${path}?${query}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatValue(value, kind) {
  if (kind === "money") return money(value);
  if (kind === "whole") return nf.format(Math.round(value));
  return value.toFixed(1);
}

/* Chart.js defaults */
Chart.defaults.font.family = token("--font-body");
Chart.defaults.color = COLORS.muted;
Chart.defaults.borderColor = COLORS.line;

/* ---------- Dots (100 dots = 100% of customers) ---------- */
function renderDots(el, rate, label, animate = false) {
  const leaving = Math.round(rate);
  el.innerHTML = "";
  el.classList.toggle("reveal", animate);
  for (let i = 0; i < 100; i++) {
    const dot = document.createElement("span");
    dot.className = "dot " + (i >= 100 - leaving ? "leave" : "stay");
    dot.style.setProperty("--i", i);
    el.appendChild(dot);
  }
  el.setAttribute("aria-label", label);
}

/* ---------- Overview and comparison table ---------- */
async function loadOverview() {
  const o = await api("overview");

  $("#headline").textContent = `${nf.format(o.churned)} of ${nf.format(o.total)} bank customers have left.`;
  $("#lede").textContent =
    `That is a churn rate of ${o.rate}%. Explore who leaves, which groups are most at risk, and test any customer segment yourself.`;

  const stats = [
    ["Average age", `${o.avg_age} years`],
    ["Average credit score", nf.format(o.avg_credit)],
    ["Average balance", money(o.avg_balance)],
    ["Active members", `${o.active_share}%`],
  ];
  $("#stats").innerHTML = stats
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");

  renderDots($("#dots"), o.rate, `${Math.round(o.rate)} of every 100 customers left`, true);

  $("#compareBody").innerHTML = o.profile
    .map((p) => {
      const diff = p.left - p.stayed;
      const pct = p.stayed ? Math.abs(diff / p.stayed) * 100 : 0;
      const cls = pct < 3 ? "" : diff > 0 ? "up" : "down";
      return `<tr><td>${p.label}</td><td>${formatValue(p.stayed, p.kind)}</td><td class="${cls}">${formatValue(p.left, p.kind)}</td></tr>`;
    })
    .join("");

  return o;
}

/* ---------- Churn rate by group ---------- */
const DIMENSIONS = [
  ["geography", "Country"],
  ["gender", "Gender"],
  ["age", "Age group"],
  ["products", "Products held"],
  ["active", "Membership"],
  ["card", "Credit card"],
  ["credit", "Credit score"],
  ["tenure", "Years with bank"],
  ["balance", "Balance"],
];
let dimChart;

function buildChips(container, items, onPick, initial) {
  container.innerHTML = "";
  items.forEach(([key, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = label;
    btn.setAttribute("aria-pressed", key === initial ? "true" : "false");
    btn.addEventListener("click", () => {
      container.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
      onPick(key);
    });
    container.appendChild(btn);
  });
}

async function drawDimension(key) {
  const data = await api("churn-by", { dim: key });
  const labels = data.groups.map((g) => g.label);
  const rates = data.groups.map((g) => g.rate);

  if (dimChart) dimChart.destroy();
  dimChart = new Chart($("#dimChart"), {
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Churn rate",
          data: rates,
          backgroundColor: rates.map((r) => (r > data.overall ? COLORS.leave : COLORS.stay)),
          borderRadius: 6,
          maxBarThickness: 68,
          order: 2,
        },
        {
          type: "line",
          label: "Bank average",
          data: labels.map(() => data.overall),
          borderColor: COLORS.gold,
          borderDash: [7, 6],
          borderWidth: 2,
          pointRadius: 0,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              ctx.dataset.type === "line" ? `Bank average: ${data.overall}%` : `Churn rate: ${ctx.parsed.y}%`,
            afterLabel: (ctx) => {
              if (ctx.dataset.type === "line") return "";
              const g = data.groups[ctx.dataIndex];
              return `${nf.format(g.churned)} of ${nf.format(g.customers)} customers left`;
            },
          },
        },
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => v + "%" }, title: { display: true, text: "Customers who left" } },
        x: { grid: { display: false }, title: { display: true, text: data.dimension } },
      },
    },
  });
}

async function loadHotspots() {
  const items = await api("hotspots");
  $("#hotspots").innerHTML = items
    .map(
      (h) => `<li>
        <div class="hs-top"><span class="hs-name">${escapeHtml(h.dimension)}: ${escapeHtml(h.group)}</span><span class="hs-rate">${h.rate}%</span></div>
        <div class="hs-meta">${nf.format(h.customers)} customers, ${h.lift} times the bank average</div>
      </li>`
    )
    .join("");
}

/* ---------- Distribution ---------- */
const DISTRIBUTIONS = [
  ["age", "Age"],
  ["credit", "Credit score"],
  ["balance", "Balance"],
];
let distChart;

async function drawDistribution(key) {
  const data = await api("distribution", { field: key });
  const label = DISTRIBUTIONS.find((d) => d[0] === key)[1];
  if (distChart) distChart.destroy();
  distChart = new Chart($("#distChart"), {
    type: "bar",
    data: {
      labels: data.labels,
      datasets: [
        { label: "Stayed", data: data.stayed, backgroundColor: COLORS.stay, borderRadius: 3 },
        { label: "Left", data: data.left, backgroundColor: COLORS.leave, borderRadius: 3 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { usePointStyle: true, boxWidth: 9 } } },
      scales: {
        x: { stacked: true, grid: { display: false }, title: { display: true, text: label }, ticks: { maxRotation: 60 } },
        y: { stacked: true, title: { display: true, text: "Customers" } },
      },
    },
  });
}

/* ---------- Correlation heatmap ---------- */
async function loadHeatmap() {
  const { labels, matrix } = await api("correlation");
  const n = labels.length;
  const grid = $("#heatmap");
  grid.style.gridTemplateColumns = `110px repeat(${n}, 1fr)`;

  let html = `<div></div>` + labels.map((l) => `<div class="heat-label heat-col">${l}</div>`).join("");
  matrix.forEach((row, i) => {
    html += `<div class="heat-label">${labels[i]}</div>`;
    row.forEach((r, j) => {
      const strength = Math.pow(Math.abs(r), 0.7);
      const rgb = r >= 0 ? "255,122,89" : "111,211,195";
      const bg = i === j ? "rgba(159,195,194,0.25)" : `rgba(${rgb},${Math.max(strength, 0.06).toFixed(2)})`;
      const ink = strength > 0.55 && i !== j ? "var(--bg-deep)" : "var(--text)";
      html += `<div class="heat-cell" role="cell" style="background:${bg};color:${ink}" title="${labels[i]} and ${labels[j]}: ${r}">${r.toFixed(2)}</div>`;
    });
  });
  grid.innerHTML = html;

  const target = matrix[n - 1];
  const ranked = labels
    .map((l, i) => ({ l, r: target[i] }))
    .filter((_, i) => i !== n - 1)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  const [a, b] = ranked;
  const dir = (r) => (r > 0 ? "more" : "less");
  $("#corrNote").textContent =
    `Coral means two columns rise together, aqua means one rises as the other falls. ` +
    `Churn is linked most strongly to ${a.l.toLowerCase()} (${a.r.toFixed(2)}) and ${b.l.toLowerCase()} (${b.r.toFixed(2)}): ` +
    `higher ${a.l.toLowerCase()} goes with ${dir(a.r)} leaving.`;
}

/* ---------- Segment explorer ---------- */
const filterIds = {
  geography: "#fGeo", gender: "#fGender", products: "#fProducts",
  active: "#fActive", card: "#fCard", age_min: "#fAgeMin", age_max: "#fAgeMax",
};
let segTimer;

function readFilters() {
  const params = {};
  Object.entries(filterIds).forEach(([key, sel]) => { params[key] = $(sel).value; });
  return params;
}

async function updateSegment() {
  const s = await api("segment", readFilters());
  const sub = $("#segSub");
  if (s.customers === 0) {
    $("#segRate").textContent = "–";
    sub.textContent = "No customers match these filters. Widen the age range or set a filter back to Any.";
    $("#segCount").textContent = "0";
    $("#segChurned").textContent = "0";
    $("#segBalance").textContent = "–";
    $("#segCredit").textContent = "–";
    $("#segDots").innerHTML = "";
    return;
  }
  const gap = Math.abs(s.rate - s.overall).toFixed(1);
  const compare =
    gap === "0.0" ? `the same as the bank average of ${s.overall}%`
    : s.rate > s.overall ? `${gap} points above the bank average of ${s.overall}%`
    : `${gap} points below the bank average of ${s.overall}%`;
  $("#segRate").textContent = `${s.rate}%`;
  sub.textContent = `of matching customers left, ${compare}.`;
  $("#segCount").textContent = nf.format(s.customers);
  $("#segChurned").textContent = nf.format(s.churned);
  $("#segBalance").textContent = money(s.avg_balance);
  $("#segCredit").textContent = nf.format(s.avg_credit);
  renderDots($("#segDots"), s.rate, `${Math.round(s.rate)} of every 100 matching customers left`);
}

function setFilters(values) {
  Object.entries(filterIds).forEach(([key, sel]) => {
    $(sel).value = values[key] ?? (key === "age_min" ? "18" : key === "age_max" ? "92" : "");
  });
  updateSegment();
}

const PRESETS = {
  "germany-inactive": { geography: "Germany", active: "0" },
  midlife: { age_min: "45", age_max: "60" },
  "three-products": { products: "3" },
};

function initExplorer() {
  Object.values(filterIds).forEach((sel) => {
    $(sel).addEventListener("input", () => {
      clearTimeout(segTimer);
      segTimer = setTimeout(updateSegment, 200);
    });
  });
  $("#resetFilters").addEventListener("click", () => setFilters({}));
  document.querySelectorAll("[data-preset]").forEach((btn) =>
    btn.addEventListener("click", () => setFilters(PRESETS[btn.dataset.preset]))
  );
  updateSegment();
}

/* ---------- Customer table ---------- */
const COLUMNS = [
  ["CustomerId", "ID", "num"], ["Surname", "Surname", ""], ["Geography", "Country", ""],
  ["Gender", "Gender", ""], ["Age", "Age", "num"], ["Tenure", "Tenure", "num"],
  ["CreditScore", "Credit score", "num"], ["Balance", "Balance", "num"],
  ["NumOfProducts", "Products", "num"], ["IsActiveMember", "Active", ""], ["Exited", "Outcome", ""],
];
const table = { page: 1, q: "", status: "", sort: "CustomerId", order: "asc" };
let searchTimer;

function renderTableHead() {
  $("#custHead").innerHTML =
    "<tr>" +
    COLUMNS.map(([key, label]) => {
      const sorted = table.sort === key ? (table.order === "asc" ? "ascending" : "descending") : "none";
      return `<th scope="col" aria-sort="${sorted}"><button type="button" class="sort-btn" data-sort="${key}">${label}</button></th>`;
    }).join("") +
    "</tr>";
  document.querySelectorAll(".sort-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      const key = btn.dataset.sort;
      table.order = table.sort === key && table.order === "asc" ? "desc" : "asc";
      table.sort = key;
      table.page = 1;
      loadCustomers();
    })
  );
}

async function loadCustomers() {
  const data = await api("customers", table);
  table.page = data.page;
  renderTableHead();

  const body = $("#custBody");
  if (!data.rows.length) {
    body.innerHTML = `<tr><td class="empty" colspan="${COLUMNS.length}">No customers match this search. Try a shorter surname or set Outcome to All customers.</td></tr>`;
  } else {
    body.innerHTML = data.rows
      .map(
        (r) => `<tr>
          <td class="num">${r.CustomerId}</td>
          <td>${escapeHtml(r.Surname)}</td>
          <td>${r.Geography}</td>
          <td>${r.Gender}</td>
          <td class="num">${r.Age}</td>
          <td class="num">${r.Tenure}</td>
          <td class="num">${r.CreditScore}</td>
          <td class="num">${money(r.Balance)}</td>
          <td class="num">${r.NumOfProducts}</td>
          <td>${r.IsActiveMember ? "Yes" : "No"}</td>
          <td><span class="pill ${r.Exited ? "left" : "stayed"}">${r.Exited ? "Left" : "Stayed"}</span></td>
        </tr>`
      )
      .join("");
  }

  const first = data.total ? (data.page - 1) * data.per_page + 1 : 0;
  const last = Math.min(data.page * data.per_page, data.total);
  $("#pagerInfo").textContent = `Showing ${nf.format(first)} to ${nf.format(last)} of ${nf.format(data.total)} customers`;
  $("#prevPage").disabled = data.page <= 1;
  $("#nextPage").disabled = data.page >= data.pages;
}

function initTable() {
  $("#tSearch").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { table.q = e.target.value; table.page = 1; loadCustomers(); }, 250);
  });
  $("#tStatus").addEventListener("change", (e) => { table.status = e.target.value; table.page = 1; loadCustomers(); });
  $("#prevPage").addEventListener("click", () => { table.page -= 1; loadCustomers(); });
  $("#nextPage").addEventListener("click", () => { table.page += 1; loadCustomers(); });
  loadCustomers();
}

/* ---------- Start ---------- */
async function init() {
  try {
    buildChips($("#dimChips"), DIMENSIONS, drawDimension, "geography");
    buildChips($("#distChips"), DISTRIBUTIONS, drawDistribution, "age");
    await Promise.all([
      loadOverview(), drawDimension("geography"), loadHotspots(),
      drawDistribution("age"), loadHeatmap(),
    ]);
    initExplorer();
    initTable();
  } catch (err) {
    $("#headline").textContent = "The data could not be loaded.";
    $("#lede").textContent = "Make sure the Flask server is running (python app.py) and reload this page.";
    console.error(err);
  }
}
init();

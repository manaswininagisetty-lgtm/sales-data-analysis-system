const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = n => new Intl.NumberFormat("en-IN", {style:"currency", currency:"INR", maximumFractionDigits:2}).format(n || 0);
const num = n => new Intl.NumberFormat("en-IN").format(n || 0);
let page = 1;

function note(text, type = "danger") { $("msg").innerHTML = `<div class="alert alert-${type} alert-dismissible">${esc(text)}<button class="btn-close" data-bs-dismiss="alert" onclick="this.parentNode.remove()"></button></div>`; window.scrollTo(0, 0); }
async function api(url, opts) {
  const r = await fetch(url, opts); const ct = r.headers.get("content-type") || "";
  const body = ct.includes("json") ? await r.json() : null;
  if (!r.ok) { const e = new Error(body?.error || r.statusText); e.body = body; throw e; }
  return body;
}
const post = (url, data) => api(url, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)});
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { note(e.message); } };

document.querySelectorAll("#nav a").forEach(a => a.onclick = ev => {
  ev.preventDefault(); document.querySelectorAll("#nav a").forEach(x => x.classList.toggle("active", x === a));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.id === a.dataset.t));
  ({dash: loadDash, imp: loadImports, sales: () => { loadProductSelect(); loadSales(1); }, prod: loadProducts})[a.dataset.t]();
});

const qs = () => new URLSearchParams({start:$("fStart").value, end:$("fEnd").value, category:$("fCat").value, region:$("fReg").value}).toString();
const rows = (list, fn, empty = 4) => list.length ? list.map(fn).join("") : `<tr><td colspan="${empty}" class="text-center text-muted py-3">No data</td></tr>`;

const loadDash = guard(async () => {
  const q = qs(), [s, p, m, c, r] = await Promise.all(["summary","products","monthly","categories","regions"].map(k => api(`/api/analytics/${k}?${q}`)));
  const k = (t, v, cls = "") => `<div class="col-6 col-lg-2"><div class="card kpi"><div class="card-body py-2"><div class="small text-muted">${t}</div><h4 class="${cls}" style="font-size:1.05rem">${esc(v)}</h4></div></div></div>`;
  $("kpis").innerHTML = k("Total revenue", money(s.total_revenue)) + k("Units sold", num(s.total_quantity)) + k("Transactions", num(s.transactions)) +
    k("Avg sale value", money(s.avg_sale_value)) + k("Top product", s.top_product || "–") + k("Best month", s.best_month ? `${s.best_month} (${money(s.best_month_revenue)})` : "–");
  $("chM").src = `/api/charts/monthly.png?${q}&_=${Date.now()}`; $("chP").src = `/api/charts/products.png?${q}&_=${Date.now()}`;
  $("tProd").innerHTML = rows(p, x => `<tr><td>${x.rank}</td><td>${esc(x.product_name)}</td><td>${esc(x.category)}</td><td class="text-end">${num(x.quantity)}</td><td class="text-end">${money(x.revenue)}</td><td class="text-end">${x.share_pct}%</td></tr>`, 6);
  $("tMon").innerHTML = rows(m, x => `<tr><td>${x.month}</td><td class="text-end">${num(x.quantity)}</td><td class="text-end">${money(x.revenue)}</td><td class="text-end ${x.growth_pct < 0 ? "text-danger" : "text-success"}">${x.growth_pct == null ? "–" : x.growth_pct + "%"}</td></tr>`);
  const dim = (l, key) => rows(l, x => `<tr><td>${esc(x[key])}</td><td class="text-end">${num(x.quantity)} units</td><td class="text-end">${money(x.revenue)}</td><td class="text-end">${x.share_pct}%</td></tr>`);
  $("tCat").innerHTML = dim(c, "category"); $("tReg").innerHTML = dim(r, "region");
  const f = await api("/api/filters"), keep = (el, items) => { const v = el.value; el.innerHTML = `<option value="">All</option>` + items.map(i => `<option>${esc(i)}</option>`).join(""); el.value = v; };
  keep($("fCat"), f.categories); keep($("fReg"), f.regions);
});

const upload = guard(async () => {
  const f = $("file").files[0]; if (!f) return note("Choose a .csv file first.", "warning");
  const fd = new FormData(); fd.append("file", f); $("impResult").innerHTML = "Importing…";
  try {
    const r = await api("/api/import", {method:"POST", body:fd});
    $("impResult").innerHTML = `<div class="alert alert-success mb-2">${esc(r.message)} — <b>${r.inserted}</b> imported, <b>${r.duplicates}</b> duplicates skipped, <b>${r.errors}</b> invalid rows.
      ${r.duplicates + r.errors ? `<a href="/api/imports/${r.import_id}/report.csv">Download full report</a>` : ""}</div>` +
      (r.details.length ? `<div class="scroll"><table class="table table-sm"><thead><tr><th>Line</th><th>Type</th><th>Problem</th><th>Row</th></tr></thead><tbody>` +
        r.details.map(e => `<tr><td>${e.line}</td><td><span class="badge text-bg-${e.type.startsWith("dup") ? "warning" : "danger"}">${e.type}</span></td><td>${esc(e.reason)}</td><td><code>${esc(e.row)}</code></td></tr>`).join("") + "</tbody></table></div>" : "");
  } catch (e) { $("impResult").innerHTML = `<div class="alert alert-danger">${esc(e.message)}${e.body?.required_columns ? "<br>Required: <code>" + e.body.required_columns.join(", ") + "</code>" : ""}</div>`; }
  loadImports();
});
const loadImports = guard(async () => {
  $("tImp").innerHTML = rows(await api("/api/imports"), x => `<tr><td>${x.import_id}</td><td>${esc(x.filename)}</td><td>${esc(x.imported_at)}</td><td>${x.total_rows}</td><td>${x.inserted_rows}</td><td>${x.duplicate_rows}</td><td>${x.error_rows}</td><td>${x.duplicate_rows + x.error_rows ? `<a href="/api/imports/${x.import_id}/report.csv">report</a>` : ""}</td></tr>`, 8);
});

const loadSales = guard(async p => {
  page = Math.max(p || 1, 1); const r = await api(`/api/sales?page=${page}&q=${encodeURIComponent($("q").value)}`); page = r.page;
  $("tSales").innerHTML = rows(r.rows, x => `<tr><td>${x.sale_id}</td><td>${x.sale_date}</td><td>${esc(x.product_name)}</td><td>${esc(x.category)}</td><td class="text-end">${x.quantity}</td><td class="text-end">${money(x.unit_price)}</td><td class="text-end">${money(x.revenue)}</td><td>${esc(x.region)}</td><td><button class="btn btn-sm btn-outline-danger" onclick="delSale(${x.sale_id})">✕</button></td></tr>`, 9);
  $("pg").textContent = `Page ${r.page} of ${r.pages} · ${r.total} sales`;
});
const loadProductSelect = guard(async () => { $("sProd").innerHTML = (await api("/api/products")).map(p => `<option value="${p.product_id}">${esc(p.product_name)}</option>`).join(""); });
const addSale = guard(async () => {
  await post("/api/sales", {product_id:$("sProd").value, sale_date:$("sDate").value, quantity:$("sQty").value, unit_price:$("sPrice").value, region:$("sReg").value});
  note("Sale added.", "success"); loadSales(1);
});
const delSale = guard(async id => { if (confirm("Delete sale #" + id + "?")) { await api("/api/sales/" + id, {method:"DELETE"}); loadSales(page); } });

const loadProducts = guard(async () => {
  $("tProducts").innerHTML = rows(await api("/api/products"), x => `<tr><td>${x.product_id}</td><td>${esc(x.product_name)}</td><td>${esc(x.category)}</td><td><button class="btn btn-sm btn-outline-danger" onclick="delProd(${x.product_id})">✕</button></td></tr>`);
});
const addProd = guard(async () => { await post("/api/products", {product_name:$("pName").value, category:$("pCat").value}); $("pName").value = $("pCat").value = ""; note("Product added.", "success"); loadProducts(); });
const delProd = guard(async id => { if (confirm("Delete this product?")) { await api("/api/products/" + id, {method:"DELETE"}); loadProducts(); } });

loadDash();

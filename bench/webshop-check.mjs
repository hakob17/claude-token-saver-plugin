#!/usr/bin/env node
// Black-box acceptance check for the "Brew & Bean" webshop task (bench/fixture/webshop-PLAN.md).
// The builds never see this file. It installs, runs `npm test`, starts the app on a free port
// with an empty DATA_DIR, exercises the API contract and the pages, restarts the app to check
// persistence, and prints one JSON line: { passed, total, failed: [...], testsPass, started }.
//   node bench/webshop-check.mjs <project dir>
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const dir = path.resolve(process.argv[2] || ".");
const PASSWORD = "bench-secret-7";
const results = [];
const check = (name, ok) => results.push({ name, ok: !!ok });
const sh = (cmd, timeout) => {
  try { execSync(cmd, { cwd: dir, stdio: "ignore", timeout }); return true; } catch { return false; }
};
const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function report(extra) {
  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, failed, ...extra }));
}

if (!fs.existsSync(path.join(dir, "package.json"))) { report({ testsPass: false, started: false, note: "no package.json" }); process.exit(0); }
sh("npm install --no-audit --no-fund --loglevel=error", 300_000);
const testsPass = sh("npm test --silent", 300_000);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "webshop-data-"));
let server = null, base = "";
async function start() {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn("npm", ["start", "--silent"], {
    cwd: dir, detached: true, stdio: "ignore",
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_PASSWORD: PASSWORD, NODE_ENV: "production" },
  });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return true; } catch {}
    await sleep(500);
  }
  return false;
}
function stop() { try { process.kill(-server.pid, "SIGTERM"); } catch {} }

async function req(method, p, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, type: r.headers.get("content-type") || "" };
  } catch { return { status: 0, json: null, text: "", type: "" }; }
}
const isProduct = (p) => p && p.id != null && typeof p.name === "string" && ["light", "medium", "dark"].includes(p.roast) &&
  Number.isInteger(p.priceCents) && Number.isInteger(p.stock);

const started = await start();
check("server starts and /api/health ok", started);
if (!started) { stop(); report({ testsPass, started }); process.exit(0); }

// Public catalogue and guides
let r = await req("GET", "/api/products");
const products = Array.isArray(r.json) ? r.json : [];
check("seeds >= 8 products with the Product shape", products.length >= 8 && products.every(isProduct));
r = await req("GET", "/api/products?roast=dark");
check("roast filter", Array.isArray(r.json) && r.json.length > 0 && r.json.every((p) => p.roast === "dark") && r.json.length < products.length);
const p0 = products.find((p) => p.stock >= 3) || products[0];
// An id that doesn't exist but has the same type as real ids (apps may reject a string where ids are numbers).
const missingId = typeof p0?.id === "number" ? 987654321 : "does-not-exist-999";
r = await req("GET", `/api/products/${p0?.id}`);
check("GET product by id", r.status === 200 && r.json?.id == p0?.id);
check("unknown product 404", (await req("GET", `/api/products/${missingId}`)).status === 404);
r = await req("GET", "/api/guides");
const guides = Array.isArray(r.json) ? r.json : [];
check(">= 3 guides with slug/title/ratio/steps", guides.length >= 3 && guides.every((g) => g.slug && g.title && g.ratio && Array.isArray(g.steps) && g.steps.length));
check("GET guide by slug", (await req("GET", `/api/guides/${guides[0]?.slug}`)).json?.slug === guides[0]?.slug);
check("unknown guide 404", (await req("GET", "/api/guides/no-such-guide")).status === 404);

// Pages
for (const pg of ["/", "/shop", "/admin", `/guides/${guides[0]?.slug}`]) {
  r = await req("GET", pg);
  check(`page ${pg.startsWith("/guides") ? "/guides/:slug" : pg} serves HTML`, r.status === 200 && /html/i.test(r.type) && /<html|<!doctype/i.test(r.text));
}

// Orders
const customer = { name: "Ada Bench", email: "ada@example.com" };
r = await req("POST", "/api/orders", { items: [{ productId: p0.id, qty: 2 }], customer });
const order = r.json;
check("create order 201 pending with correct total", r.status === 201 && order?.status === "pending" && order?.totalCents === 2 * p0.priceCents);
r = await req("GET", `/api/products/${p0.id}`);
check("order reduces stock", r.json?.stock === p0.stock - 2);
check("GET order by id", (await req("GET", `/api/orders/${order?.id}`)).json?.id == order?.id);
check("unknown order 404", (await req("GET", "/api/orders/does-not-exist-999")).status === 404);
check("empty items 400", (await req("POST", "/api/orders", { items: [], customer })).status === 400);
check("invalid email 400", (await req("POST", "/api/orders", { items: [{ productId: p0.id, qty: 1 }], customer: { name: "X", email: "not-an-email" } })).status === 400);
check("invalid qty 400", (await req("POST", "/api/orders", { items: [{ productId: p0.id, qty: 0 }], customer })).status === 400);
check("unknown product in order 404", (await req("POST", "/api/orders", { items: [{ productId: missingId, qty: 1 }], customer })).status === 404);
const stockBefore = (await req("GET", `/api/products/${p0.id}`)).json?.stock;
check("insufficient stock 409", (await req("POST", "/api/orders", { items: [{ productId: p0.id, qty: stockBefore + 1 }], customer })).status === 409);
check("409 leaves stock unchanged", (await req("GET", `/api/products/${p0.id}`)).json?.stock === stockBefore);

// Admin
check("wrong password 401", (await req("POST", "/api/admin/login", { password: "wrong" })).status === 401);
check("admin route without token 401", (await req("GET", "/api/admin/orders")).status === 401);
r = await req("POST", "/api/admin/login", { password: PASSWORD });
const token = r.json?.token;
check("login returns token", r.status === 200 && typeof token === "string" && token.length > 0);
r = await req("GET", "/api/admin/orders", undefined, token);
check("admin lists orders", r.status === 200 && Array.isArray(r.json) && r.json.some((o) => o.id == order?.id));
const newP = { name: "Bench Blend", origin: "Testland", roast: "medium", priceCents: 1450, stock: 7, description: "x" };
r = await req("POST", "/api/admin/products", newP, token);
const created = r.json;
check("admin creates product 201", r.status === 201 && isProduct(created) && created.priceCents === 1450);
check("created product is public", (await req("GET", `/api/products/${created?.id}`)).json?.name === "Bench Blend");
check("invalid price 400", (await req("POST", "/api/admin/products", { ...newP, priceCents: 9.99 }, token)).status === 400);
check("invalid roast 400", (await req("POST", "/api/admin/products", { ...newP, roast: "burnt" }, token)).status === 400);
r = await req("PUT", `/api/admin/products/${created?.id}`, { priceCents: 1600 }, token);
check("admin updates product", r.status === 200 && r.json?.priceCents === 1600);
check("update unknown product 404", (await req("PUT", `/api/admin/products/${missingId}`, { priceCents: 100 }, token)).status === 404);
check("bad status 400", (await req("PATCH", `/api/admin/orders/${order?.id}`, { status: "lost" }, token)).status === 400);
r = await req("PATCH", `/api/admin/orders/${order?.id}`, { status: "cancelled" }, token);
check("cancel order 200", r.status === 200 && r.json?.status === "cancelled");
const afterCancel = (await req("GET", `/api/products/${p0.id}`)).json?.stock;
await req("PATCH", `/api/admin/orders/${order?.id}`, { status: "cancelled" }, token);
check("cancel restores stock once", afterCancel === p0.stock && (await req("GET", `/api/products/${p0.id}`)).json?.stock === p0.stock);
r = await req("DELETE", `/api/admin/products/${created?.id}`, undefined, token);
check("admin deletes product 204", r.status === 204 && (await req("GET", `/api/products/${created?.id}`)).status === 404);

// Persistence across a restart
r = await req("POST", "/api/orders", { items: [{ productId: p0.id, qty: 1 }], customer });
const keep = r.json?.id;
stop(); await sleep(1500);
const restarted = await start();
check("data persists across restart", restarted && (await req("GET", `/api/orders/${keep}`)).status === 200);
stop();
fs.rmSync(dataDir, { recursive: true, force: true });
report({ testsPass, started });
process.exit(0);

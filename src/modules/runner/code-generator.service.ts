import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OpenRouterService } from '../ai/openrouter.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { RunnerEventsService } from './runner-events.service';

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GeneratedCodebase {
  files: GeneratedFile[];
  entrypoint: string;
  runtime: 'node';
  dependencies: Record<string, string>;
  summary: string;
}

const SYSTEM_PROMPT = `You are a senior product engineer generating production-quality internal business tools for Stack62. Given a business system description, produce a self-contained Node.js Express app that can be booted as a standalone service.

Constraints:
- Single JSON response, no markdown.
- Use only Node 20 built-ins plus "express" and "better-sqlite3" (both will be installed automatically). No other deps unless truly necessary.
- The entrypoint is "server.js" and must listen on process.env.PORT.
- Serve at least one JSON API under /api and a single-page HTML UI at GET /.
- Store data in SQLite at ./db/app.db (create directory if missing). Create tables on boot with IF NOT EXISTS.
- Expose GET /health -> { ok: true } for readiness checks.
- Keep everything in <= 4 files. Inline the HTML/CSS/JS into server.js or a public/index.html.

Quality bar:
- Interpret the prompt into a real workflow, not a generic CRUD demo.
- Include domain-specific tables, seeded sample data, dashboards, filters, search, status chips, and at least one useful workflow action.
- The first screen should be the working app, not a landing page.
- Use a polished operational UI with a dense dashboard, tables, forms, and charts/counters where useful.
- For retail/sales prompts, include orders, line items, products, inventory, staff/cashiers, payments, daily close, top sellers, and low-stock alerts.
- For schedules, include calendar/list views, reminder status, assignee filters, and recurrence metadata.
- For agents/coworker jobs, include job runs, triggers, logs, outcomes, and next-run controls.

Respond with ONLY valid JSON in this shape:
{
  "summary": "One-sentence description of what was built.",
  "entrypoint": "server.js",
  "runtime": "node",
  "dependencies": { "express": "^4.19.2", "better-sqlite3": "^11.3.0" },
  "files": [
    { "path": "server.js", "content": "<full JS source>" },
    { "path": "public/index.html", "content": "<optional html>" }
  ]
}`;

@Injectable()
export class CodeGeneratorService {
  private readonly logger = new Logger(CodeGeneratorService.name);
  private readonly systemsRoot: string;
  private readonly allowedDependencies: Set<string>;

  constructor(
    private readonly configService: ConfigService,
    private readonly openRouterService: OpenRouterService,
    private readonly organizationsService: OrganizationsService,
    private readonly runnerEventsService: RunnerEventsService,
  ) {
    const configured = this.configService.get<string>(
      'GENERATED_SYSTEMS_ROOT',
      'generated/systems',
    );
    this.systemsRoot = path.resolve(configured);
    if (!fs.existsSync(this.systemsRoot)) {
      fs.mkdirSync(this.systemsRoot, { recursive: true });
    }
    this.allowedDependencies = new Set(
      this.configService
        .get<string>('RUNNER_ALLOWED_DEPENDENCIES', 'express,better-sqlite3')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }

  resolveDir(systemId: string) {
    return path.join(this.systemsRoot, systemId);
  }

  async generate(params: {
    systemId: string;
    organizationId: string;
    prompt: string;
    model?: string | null;
  }): Promise<{ codebase: GeneratedCodebase; dir: string }> {
    this.runnerEventsService.emit({
      systemId: params.systemId,
      phase: 'generation',
      level: 'info',
      message: 'Loading AI generation settings',
    });

    const org = await this.organizationsService.findById(params.organizationId);
    const orgApiKey = org?.openrouterApiKey ?? null;
    const model = params.model ?? org?.preferredModel ?? null;

    this.runnerEventsService.emit({
      systemId: params.systemId,
      phase: 'generation',
      level: 'info',
      message: 'Requesting source code from AI model',
      detail: model ?? 'Using the configured default model.',
    });

    let codebase: GeneratedCodebase;
    try {
      const raw = await this.openRouterService.complete(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: params.prompt },
        ],
        orgApiKey,
        model,
      );

      this.runnerEventsService.emit({
        systemId: params.systemId,
        phase: 'generation',
        level: 'done',
        message: 'AI response received',
      });

      codebase = this.parseResponse(raw, params.prompt);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'AI code generation failed.';
      this.logger.warn(
        `AI code generation unavailable; using deterministic generator: ${message}`,
      );
      this.runnerEventsService.emit({
        systemId: params.systemId,
        phase: 'generation',
        level: 'info',
        message: 'AI code generation unavailable; using built-in generator',
        detail: this.summarizeGenerationError(message),
      });
      codebase = this.fallbackCodebase(params.prompt);
    }

    this.runnerEventsService.emit({
      systemId: params.systemId,
      phase: 'generation',
      level: 'done',
      message: 'Generated codebase parsed',
      detail: `${codebase.files.length} source file${codebase.files.length === 1 ? '' : 's'} ready.`,
    });

    const dir = await this.writeToDisk(params.systemId, codebase);
    return { codebase, dir };
  }

  private summarizeGenerationError(message: string) {
    if (/usage limit|rate limit|429|credits/i.test(message)) {
      return 'The configured test AI provider is temporarily unavailable, so Stack62 used the built-in app generator.';
    }
    return message.slice(0, 300);
  }

  /**
   * Write a pre-built codebase (e.g. from a fallback or tests) without an AI call.
   */
  async writeFallback(
    systemId: string,
    label: string,
  ): Promise<{ codebase: GeneratedCodebase; dir: string }> {
    const codebase = this.fallbackCodebase(label);
    const dir = await this.writeToDisk(systemId, codebase);
    return { codebase, dir };
  }

  private async writeToDisk(
    systemId: string,
    codebase: GeneratedCodebase,
  ): Promise<string> {
    const dir = this.resolveDir(systemId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const dependencies = this.filterDependencies(codebase.dependencies);

    this.runnerEventsService.emit({
      systemId,
      phase: 'file',
      level: 'info',
      message: 'Writing generated source files',
      detail: dir,
    });

    // Write package.json
    const pkg = {
      name: `stack62-system-${systemId.slice(0, 8)}`,
      private: true,
      version: '0.0.1',
      type: 'commonjs',
      main: codebase.entrypoint,
      scripts: { start: `node ${codebase.entrypoint}` },
      dependencies,
    };
    await fs.promises.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify(pkg, null, 2),
    );
    this.runnerEventsService.emit({
      systemId,
      phase: 'file',
      level: 'done',
      message: 'Wrote package.json',
    });

    // Write README.md
    await fs.promises.writeFile(
      path.join(dir, 'README.md'),
      `# Stack62 Generated System\n\n${codebase.summary}\n\nGenerated at ${new Date().toISOString()}.\n`,
    );
    this.runnerEventsService.emit({
      systemId,
      phase: 'file',
      level: 'done',
      message: 'Wrote README.md',
    });

    // Write each file
    for (const file of codebase.files) {
      const rel = this.safeRelative(file.path);
      if (!rel) continue;
      const abs = path.join(dir, rel);
      const parent = path.dirname(abs);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
      await fs.promises.writeFile(abs, file.content);
      this.runnerEventsService.emit({
        systemId,
        phase: 'file',
        level: 'done',
        message: `Wrote ${rel}`,
        detail: `${Buffer.byteLength(file.content, 'utf8')} bytes`,
      });
    }

    this.runnerEventsService.emit({
      systemId,
      phase: 'file',
      level: 'done',
      message: 'Source files are ready on disk',
    });

    return dir;
  }

  private safeRelative(p: string): string | null {
    const cleaned = p.replace(/^[/\\]+/, '').replace(/\.\.\//g, '');
    if (!cleaned || cleaned.includes('\0')) return null;
    return cleaned;
  }

  private filterDependencies(dependencies: Record<string, string>) {
    const safe: Record<string, string> = {};
    for (const [name, version] of Object.entries(dependencies)) {
      if (this.allowedDependencies.has(name)) {
        safe[name] = version;
        continue;
      }

      this.logger.warn(
        `Rejected generated dependency outside allowlist: ${name}`,
      );
    }

    for (const required of ['express', 'better-sqlite3']) {
      safe[required] =
        safe[required] ?? (required === 'express' ? '^4.19.2' : '^11.3.0');
    }

    return safe;
  }

  private parseResponse(
    raw: string,
    originalPrompt: string,
  ): GeneratedCodebase {
    const match =
      raw.match(/```json\s*([\s\S]*?)```/i) ??
      raw.match(/```\s*([\s\S]*?)```/i);
    const jsonStr = match ? match[1] : raw;
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first < 0) return this.fallbackCodebase(originalPrompt);

    try {
      const parsed = JSON.parse(
        jsonStr.slice(first, last + 1),
      ) as Partial<GeneratedCodebase>;
      if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
        return this.fallbackCodebase(originalPrompt);
      }
      return {
        summary: parsed.summary ?? 'Generated system',
        entrypoint: parsed.entrypoint ?? 'server.js',
        runtime: 'node',
        dependencies: parsed.dependencies ?? {
          express: '^4.19.2',
          'better-sqlite3': '^11.3.0',
        },
        files: parsed.files.filter(
          (f) => f && f.path && typeof f.content === 'string',
        ),
      };
    } catch (err) {
      this.logger.warn(
        `AI codegen parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.fallbackCodebase(originalPrompt);
    }
  }

  private fallbackCodebase(prompt: string): GeneratedCodebase {
    const safe = prompt.replace(/`/g, '\\`').slice(0, 200);
    const retail = /coffee|cafe|shop|sales|pos|retail/i.test(prompt);
    if (retail) {
      return this.retailSalesCodebase(safe);
    }

    const server = `const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
app.use(express.json());

const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(path.join(dbDir, 'app.db'));
db.exec(\`CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)\`);

app.get('/health', (_, res) => res.json({ ok: true }));

app.get('/api/items', (_, res) => {
  const rows = db.prepare('SELECT * FROM items ORDER BY id DESC').all();
  res.json(rows);
});

app.post('/api/items', (req, res) => {
  const title = String(req.body && req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title required' });
  const result = db.prepare('INSERT INTO items (title) VALUES (?)').run(title);
  res.json({ id: result.lastInsertRowid, title });
});

app.get('/', (_, res) => {
  res.type('html').send(\`<!doctype html>
<html><head><meta charset="utf-8"><title>Stack62 System</title>
<style>body{font-family:system-ui;max-width:680px;margin:40px auto;padding:0 16px;color:#1e293b}
h1{font-size:22px}input,button{padding:8px 12px;font-size:14px;border-radius:8px;border:1px solid #cbd5e1}
button{background:#4f46e5;color:white;border-color:#4338ca;cursor:pointer;margin-left:6px}
li{padding:8px 0;border-bottom:1px solid #e2e8f0}.muted{color:#64748b;font-size:13px}</style></head>
<body><h1>Stack62 Running System</h1>
<p class="muted">${safe}</p>
<form id="f"><input id="t" placeholder="Add item"/><button>Add</button></form>
<ul id="l"></ul>
<script>
async function load(){const r=await fetch('/api/items');const d=await r.json();
document.getElementById('l').innerHTML=d.map(i=>'<li>'+i.title+'</li>').join('')}
document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();
const t=document.getElementById('t').value.trim();if(!t)return;
await fetch('/api/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t})});
document.getElementById('t').value='';load()});
load();
</script></body></html>\`);
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log('[stack62-system] listening on', port));
`;
    return {
      summary: 'Starter Express + SQLite system (fallback).',
      entrypoint: 'server.js',
      runtime: 'node',
      dependencies: { express: '^4.19.2', 'better-sqlite3': '^11.3.0' },
      files: [{ path: 'server.js', content: server }],
    };
  }

  private retailSalesCodebase(prompt: string): GeneratedCodebase {
    const server = `const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
app.use(express.json());
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(path.join(dbDir, 'app.db'));

db.exec(\`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  cost REAL NOT NULL,
  stock INTEGER NOT NULL,
  reorder_level INTEGER NOT NULL,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL,
  cashier_id INTEGER,
  customer_name TEXT,
  payment_method TEXT NOT NULL,
  subtotal REAL NOT NULL,
  discount REAL DEFAULT 0,
  tax REAL DEFAULT 0,
  total REAL NOT NULL,
  status TEXT DEFAULT 'paid',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL
);
\`);

const hasProducts = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
if (!hasProducts) {
  const addProduct = db.prepare('INSERT INTO products (name, category, price, cost, stock, reorder_level) VALUES (?, ?, ?, ?, ?, ?)');
  [
    ['Espresso', 'Coffee', 3.5, 0.9, 80, 20],
    ['Cappuccino', 'Coffee', 4.75, 1.4, 62, 20],
    ['Latte', 'Coffee', 5.25, 1.5, 58, 20],
    ['Cold Brew', 'Coffee', 5.5, 1.2, 34, 18],
    ['Croissant', 'Bakery', 3.25, 1.35, 18, 12],
    ['Blueberry Muffin', 'Bakery', 3.75, 1.2, 9, 10],
    ['Iced Tea', 'Tea', 3.95, 0.8, 25, 15]
  ].forEach(p => addProduct.run(...p));
  const addStaff = db.prepare('INSERT INTO staff (name, role) VALUES (?, ?)');
  [['Amara Okafor', 'Cashier'], ['Jon Bell', 'Barista'], ['Lina Chen', 'Manager']].forEach(s => addStaff.run(...s));
}

function money(n){ return Math.round(Number(n || 0) * 100) / 100; }

app.get('/health', (_, res) => res.json({ ok: true }));

app.get('/api/dashboard', (_, res) => {
  const today = db.prepare("SELECT COALESCE(SUM(total),0) revenue, COUNT(*) orders, COALESCE(AVG(total),0) avgOrder FROM orders WHERE date(created_at)=date('now')").get();
  const all = db.prepare("SELECT COALESCE(SUM(total),0) revenue, COUNT(*) orders, COALESCE(AVG(total),0) avgOrder FROM orders").get();
  const payments = db.prepare("SELECT payment_method method, SUM(total) total FROM orders GROUP BY payment_method ORDER BY total DESC").all();
  const top = db.prepare(\`SELECT p.name, SUM(oi.quantity) qty, SUM(oi.line_total) sales
    FROM order_items oi JOIN products p ON p.id=oi.product_id GROUP BY p.id ORDER BY sales DESC LIMIT 5\`).all();
  const lowStock = db.prepare('SELECT * FROM products WHERE stock <= reorder_level ORDER BY stock ASC').all();
  res.json({ today, all, payments, top, lowStock });
});

app.get('/api/products', (_, res) => res.json(db.prepare('SELECT * FROM products ORDER BY category, name').all()));
app.get('/api/staff', (_, res) => res.json(db.prepare('SELECT * FROM staff ORDER BY name').all()));
app.get('/api/orders', (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = q
    ? db.prepare("SELECT o.*, s.name cashier FROM orders o LEFT JOIN staff s ON s.id=o.cashier_id WHERE o.order_no LIKE ? OR o.customer_name LIKE ? ORDER BY o.id DESC LIMIT 100").all('%'+q+'%', '%'+q+'%')
    : db.prepare('SELECT o.*, s.name cashier FROM orders o LEFT JOIN staff s ON s.id=o.cashier_id ORDER BY o.id DESC LIMIT 100').all();
  res.json(rows);
});

app.post('/api/orders', (req, res) => {
  const body = req.body || {};
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json({ error: 'Add at least one item' });
  const cashierId = Number(body.cashierId || 1);
  const paymentMethod = String(body.paymentMethod || 'card');
  const discount = money(body.discount || 0);
  const taxRate = 0.075;
  const products = db.prepare('SELECT * FROM products WHERE id = ?');
  let subtotal = 0;
  const lines = items.map(item => {
    const product = products.get(Number(item.productId));
    if (!product) throw new Error('Invalid product');
    const quantity = Math.max(1, Number(item.quantity || 1));
    const lineTotal = money(product.price * quantity);
    subtotal += lineTotal;
    return { product, quantity, unitPrice: product.price, lineTotal };
  });
  subtotal = money(subtotal);
  const tax = money(Math.max(0, subtotal - discount) * taxRate);
  const total = money(subtotal - discount + tax);
  const orderNo = 'CS-' + new Date().toISOString().slice(2,10).replace(/-/g,'') + '-' + Math.floor(Math.random()*9000+1000);
  const tx = db.transaction(() => {
    const order = db.prepare('INSERT INTO orders (order_no, cashier_id, customer_name, payment_method, subtotal, discount, tax, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(orderNo, cashierId, body.customerName || 'Walk-in', paymentMethod, subtotal, discount, tax, total);
    const addLine = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)');
    const stock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
    lines.forEach(line => { addLine.run(order.lastInsertRowid, line.product.id, line.quantity, line.unitPrice, line.lineTotal); stock.run(line.quantity, line.product.id); });
    return order.lastInsertRowid;
  });
  const id = tx();
  res.json({ id, orderNo, subtotal, discount, tax, total });
});

app.post('/api/products/:id/restock', (req, res) => {
  const qty = Math.max(1, Number((req.body || {}).quantity || 1));
  db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(qty, Number(req.params.id));
  res.json({ ok: true });
});

app.get('/', (_, res) => res.type('html').send(\`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Coffee Sales Tracker</title>
<style>
:root{font-family:Inter,system-ui,Segoe UI,sans-serif;color:#18212f;background:#eef2f6}body{margin:0}.app{display:grid;grid-template-columns:260px 1fr;min-height:100vh}.side{background:#101827;color:white;padding:22px}.brand{font-size:18px;font-weight:800}.muted{color:#7e8da3;font-size:12px}.nav{margin-top:28px;display:grid;gap:8px}.nav button{border:0;background:transparent;color:#b8c2d2;text-align:left;padding:10px;border-radius:7px;cursor:pointer}.nav button.active,.nav button:hover{background:#263348;color:white}.main{padding:22px 26px}.top{display:flex;align-items:center;gap:12px;margin-bottom:18px}.top h1{margin:0;font-size:22px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{background:white;border:1px solid #dce3eb;border-radius:8px;padding:14px;box-shadow:0 1px 2px #0001}.metric{font-size:24px;font-weight:800;margin-top:8px}.layout{display:grid;grid-template-columns:1.4fr .9fr;gap:14px;margin-top:14px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;border-bottom:1px solid #e5eaf0;padding:9px}th{color:#64748b;font-size:11px;text-transform:uppercase}.pill{display:inline-flex;border-radius:999px;padding:3px 8px;background:#e8f4ee;color:#147a44;font-size:11px}.danger{background:#fff0f0;color:#b42318}.form{display:grid;gap:9px}input,select,button{font:inherit}input,select{border:1px solid #cfd8e3;border-radius:7px;padding:9px;background:white}button.primary{border:0;background:#1f6feb;color:white;border-radius:7px;padding:10px 12px;font-weight:700;cursor:pointer}.row{display:flex;gap:8px}.row>*{flex:1}.hide{display:none}@media(max-width:900px){.app{grid-template-columns:1fr}.side{display:none}.grid,.layout{grid-template-columns:1fr}}
</style></head><body><div class="app"><aside class="side"><div class="brand">Coffee Sales Ops</div><p class="muted">${prompt}</p><div class="nav"><button class="active" data-view="dashboard">Dashboard</button><button data-view="orders">Orders</button><button data-view="products">Inventory</button><button data-view="close">Daily close</button></div></aside><main class="main"><div class="top"><h1 id="title">Dashboard</h1><span class="muted">Live operational preview</span></div>
<section id="dashboard"><div class="grid" id="metrics"></div><div class="layout"><div class="card"><h3>Recent orders</h3><table><thead><tr><th>Order</th><th>Customer</th><th>Payment</th><th>Total</th></tr></thead><tbody id="recent"></tbody></table></div><div class="card"><h3>Top sellers</h3><table><tbody id="top"></tbody></table><h3>Low stock</h3><div id="low"></div></div></div></section>
<section id="orders" class="hide"><div class="layout"><div class="card"><h3>Orders</h3><input id="search" placeholder="Search orders or customers"><table><thead><tr><th>Order</th><th>Cashier</th><th>Total</th><th>Status</th></tr></thead><tbody id="ordersTable"></tbody></table></div><div class="card"><h3>New sale</h3><div class="form"><input id="customer" placeholder="Customer name"><select id="cashier"></select><select id="payment"><option>card</option><option>cash</option><option>transfer</option></select><div class="row"><select id="product"></select><input id="qty" type="number" min="1" value="1"></div><input id="discount" type="number" min="0" step="0.01" placeholder="Discount"><button class="primary" onclick="createOrder()">Record sale</button></div></div></div></section>
<section id="products" class="hide"><div class="card"><h3>Inventory</h3><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th></th></tr></thead><tbody id="productsTable"></tbody></table></div></section>
<section id="close" class="hide"><div class="card"><h3>Daily close checklist</h3><p class="muted">Review revenue, reconcile cash/card totals, restock low items, then export the order list from the Orders view.</p><div id="closeSummary"></div></div></section>
</main></div><script>
let products=[], staff=[];
const fmt=n=>'$'+Number(n||0).toFixed(2);
document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>show(b.dataset.view));
function show(id){document.querySelectorAll('section').forEach(s=>s.classList.add('hide'));document.getElementById(id).classList.remove('hide');document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id));document.getElementById('title').textContent=id[0].toUpperCase()+id.slice(1)}
async function boot(){products=await (await fetch('/api/products')).json();staff=await (await fetch('/api/staff')).json();fillSelects();await refresh();}
function fillSelects(){product.innerHTML=products.map(p=>'<option value="'+p.id+'">'+p.name+' - '+fmt(p.price)+'</option>').join('');cashier.innerHTML=staff.map(s=>'<option value="'+s.id+'">'+s.name+'</option>').join('')}
async function refresh(){const d=await (await fetch('/api/dashboard')).json();metrics.innerHTML=[
['Today',fmt(d.today.revenue)],['Orders',d.today.orders],['Avg order',fmt(d.today.avgOrder)],['All revenue',fmt(d.all.revenue)]
].map(x=>'<div class="card"><div class="muted">'+x[0]+'</div><div class="metric">'+x[1]+'</div></div>').join('');
const orders=await (await fetch('/api/orders?q='+(search?.value||''))).json();recent.innerHTML=orders.slice(0,8).map(o=>'<tr><td>'+o.order_no+'</td><td>'+o.customer_name+'</td><td>'+o.payment_method+'</td><td>'+fmt(o.total)+'</td></tr>').join('');ordersTable.innerHTML=orders.map(o=>'<tr><td>'+o.order_no+'</td><td>'+(o.cashier||'')+'</td><td>'+fmt(o.total)+'</td><td><span class="pill">'+o.status+'</span></td></tr>').join('');
top.innerHTML=d.top.map(t=>'<tr><td>'+t.name+'</td><td>'+t.qty+' sold</td><td>'+fmt(t.sales)+'</td></tr>').join('')||'<tr><td>No sales yet</td></tr>';low.innerHTML=d.lowStock.map(p=>'<p><span class="pill danger">'+p.stock+' left</span> '+p.name+'</p>').join('')||'<p class="muted">No low stock items.</p>';productsTable.innerHTML=products.map(p=>'<tr><td>'+p.name+'</td><td>'+p.category+'</td><td>'+fmt(p.price)+'</td><td><span class="pill '+(p.stock<=p.reorder_level?'danger':'')+'">'+p.stock+'</span></td><td><button onclick="restock('+p.id+')">Restock</button></td></tr>').join('');closeSummary.innerHTML=metrics.innerHTML}
async function createOrder(){await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customerName:customer.value,cashierId:cashier.value,paymentMethod:payment.value,discount:discount.value,items:[{productId:product.value,quantity:qty.value}]})});products=await (await fetch('/api/products')).json();await refresh();show('dashboard')}
async function restock(id){await fetch('/api/products/'+id+'/restock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quantity:12})});products=await (await fetch('/api/products')).json();await refresh()}
document.addEventListener('input',e=>{if(e.target.id==='search')refresh()});boot();
</script></body></html>\`));

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log('[coffee-sales-tracker] listening on', port));
`;
    return {
      summary: 'Coffee shop sales tracker with POS orders, inventory, cashier tracking, dashboards, and daily close workflow.',
      entrypoint: 'server.js',
      runtime: 'node',
      dependencies: { express: '^4.19.2', 'better-sqlite3': '^11.3.0' },
      files: [{ path: 'server.js', content: server }],
    };
  }
}

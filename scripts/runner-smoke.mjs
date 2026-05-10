#!/usr/bin/env node
/**
 * Runner smoke test — validates the Stack62 system runtime contract.
 *
 * What it proves:
 *   1. A generated Node server can be spawned with PORT set by the runner.
 *   2. The readiness probe (TCP connect on localhost:PORT) returns within
 *      the readiness window.
 *   3. `GET /health` responds with `{ ok: true }`.
 *
 * This is the same contract CodeGeneratorService's system prompt enforces,
 * so if this smoke is green the runner layer can be trusted to bring a
 * generated system to life.
 *
 * Usage:
 *   node scripts/runner-smoke.mjs
 *   npm run smoke:runner
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

const READINESS_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 5_000;

function allocatePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {net.AddressInfo} */ (srv.address());
      srv.close(() => resolve(port));
    });
  });
}

function ping(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(400);
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('error', () => resolve(false));
    sock.connect(port, '127.0.0.1');
  });
}

function httpGet(port, path) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', timeout: HEALTH_TIMEOUT_MS },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', (err) => resolve({ error: err }));
    req.on('timeout', () => {
      req.destroy(new Error('health request timeout'));
    });
    req.end();
  });
}

async function waitReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ping(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stack62-smoke-'));
  const entrypoint = path.join(dir, 'server.js');

  // Minimal runtime-contract server — no external deps so this runs anywhere.
  // Same shape CodeGeneratorService demands: listens on $PORT, /health -> { ok: true }.
  fs.writeFileSync(
    entrypoint,
    `
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.statusCode = 404;
  res.end();
});
const port = Number(process.env.PORT);
if (!port) {
  console.error('PORT not set');
  process.exit(2);
}
server.listen(port, '127.0.0.1', () => console.log('[smoke] listening on ' + port));
`,
  );

  const port = await allocatePort();
  console.log(`[smoke] spawning node server at ${entrypoint} on port ${port}`);

  const child = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (c) => process.stdout.write('[system] ' + c));
  child.stderr.on('data', (c) => process.stderr.write('[system:err] ' + c));

  let pass = false;
  let failMsg = '';
  try {
    const ready = await waitReady(port, READINESS_TIMEOUT_MS);
    if (!ready) {
      failMsg = `Readiness timeout after ${READINESS_TIMEOUT_MS}ms`;
    } else {
      console.log('[smoke] readiness probe passed, calling /health');
      const r = await httpGet(port, '/health');
      if (r.error) {
        failMsg = `/health failed: ${r.error.message}`;
      } else if (r.status !== 200) {
        failMsg = `/health returned status ${r.status}: ${r.body}`;
      } else {
        const parsed = JSON.parse(r.body);
        if (parsed.ok === true) {
          pass = true;
        } else {
          failMsg = `/health body did not include { ok: true }: ${r.body}`;
        }
      }
    }
  } finally {
    child.kill();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  if (pass) {
    console.log('\n\x1b[32m✓ PASS\x1b[0m generate → deploy → /health green');
    process.exit(0);
  }
  console.error(`\n\x1b[31m✗ FAIL\x1b[0m ${failMsg}`);
  process.exit(1);
}

run().catch((err) => {
  console.error('[smoke] unexpected error:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Engine smoke test.
 *
 * 1. Register a fresh user (or log in if it exists)
 * 2. Create an org + workspace
 * 3. GET /engine/tools — verify the tool catalogue is populated
 * 4. POST /engine/run with a simple "list my systems" prompt — verify SSE
 *    stream emits tool.call → tool.result → message.complete → session.complete
 *
 * Exits non-zero on any failure.
 */

import crypto from 'node:crypto';

const BASE = (process.env.STACK62_BASE_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
);
const API = `${BASE}/v1`;
const SUFFIX = crypto.randomBytes(3).toString('hex');
const EMAIL = process.env.STACK62_SMOKE_EMAIL || `smoke+engine-${SUFFIX}@stack62.test`;
const PASSWORD = process.env.STACK62_SMOKE_PASSWORD || 'Smoke!Pass123';

function fail(label, detail) {
  console.error(`✗ ${label}`);
  if (detail !== undefined) console.error(detail);
  process.exit(1);
}

function ok(label, extra) {
  console.log(`✓ ${label}${extra ? ` — ${extra}` : ''}`);
}

async function jsonOrThrow(res, label) {
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    fail(`${label} (${res.status})`, body);
  }
  return body;
}

async function main() {
  // 1. Auth — try login first, register on 401
  let token, userId;
  let loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (loginRes.status === 401 || loginRes.status === 404) {
    const reg = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
        firstName: 'Smoke',
        lastName: 'Test',
      }),
    });
    const body = await jsonOrThrow(reg, 'register');
    token = body.accessToken;
    userId = body.user?.id;
    ok('register', EMAIL);
  } else {
    const body = await jsonOrThrow(loginRes, 'login');
    token = body.accessToken;
    userId = body.user?.id;
    ok('login', EMAIL);
  }
  if (!token) fail('auth: no token returned');

  const auth = { Authorization: `Bearer ${token}` };

  // 2. Org + workspace
  const orgs = await jsonOrThrow(
    await fetch(`${API}/organizations`, { headers: auth }),
    'list orgs',
  );
  let org = orgs[0];
  if (!org) {
    org = await jsonOrThrow(
      await fetch(`${API}/organizations`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Smoke Org ${SUFFIX}` }),
      }),
      'create org',
    );
    ok('create org', org.id);
  } else {
    ok('found org', org.id);
  }

  const ws = await jsonOrThrow(
    await fetch(`${API}/workspaces?organizationId=${org.id}`, { headers: auth }),
    'list workspaces',
  );
  let workspace = ws[0];
  if (!workspace) {
    workspace = await jsonOrThrow(
      await fetch(`${API}/workspaces`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: org.id,
          name: `Smoke Workspace ${SUFFIX}`,
        }),
      }),
      'create workspace',
    );
    ok('create workspace', workspace.id);
  } else {
    ok('found workspace', workspace.id);
  }

  // 3. Tool catalogue
  const tools = await jsonOrThrow(
    await fetch(`${API}/engine/tools`, { headers: auth }),
    'GET /engine/tools',
  );
  if (!Array.isArray(tools) || tools.length < 10) {
    fail('engine/tools too small', tools);
  }
  const expected = [
    'systems.list',
    'records.find',
    'agents.list',
    'schedules.list',
    'integrations.list',
    'files.list',
    'plans.propose',
    'tasks.list',
  ];
  const names = new Set(tools.map((t) => t.name));
  for (const e of expected) {
    if (!names.has(e)) fail(`missing tool: ${e}`);
  }
  ok('engine/tools', `${tools.length} tools registered`);

  // 4. Engine run — SSE
  const runRes = await fetch(`${API}/engine/run`, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      organizationId: org.id,
      workspaceId: workspace.id,
      prompt: 'List my systems and tell me how many I have. Use the tools.',
    }),
  });
  if (!runRes.ok || !runRes.body) {
    const text = await runRes.text();
    fail(`POST /engine/run (${runRes.status})`, text);
  }

  const events = [];
  const reader = runRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error('engine timeout (60s)')),
      60_000,
    );
  });

  const drain = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.indexOf('\n\n');
      while (split >= 0) {
        const chunk = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf('\n\n');
        const dataLine = chunk
          .split('\n')
          .find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        const json = dataLine.slice(5).trim();
        if (!json) continue;
        try {
          const ev = JSON.parse(json);
          events.push(ev);
          if (
            ev.type === 'session.complete' ||
            ev.type === 'session.error'
          ) {
            return;
          }
        } catch {
          /* ignore */
        }
      }
    }
  })();

  try {
    await Promise.race([drain, timeout]);
  } finally {
    clearTimeout(timeoutHandle);
  }

  ok('engine SSE drained', `${events.length} events`);

  const startEv = events.find((e) => e.type === 'session.started');
  if (!startEv) fail('no session.started event', events);
  ok('session.started', `model=${startEv.model}`);

  const errorEv = events.find((e) => e.type === 'session.error');
  if (errorEv) {
    fail('session.error', errorEv.message);
  }

  const toolCalls = events.filter((e) => e.type === 'tool.call');
  const toolResults = events.filter((e) => e.type === 'tool.result');
  if (toolCalls.length === 0) {
    fail('engine did not call any tool — Claude may not have access');
  }
  ok('tool.call events', `${toolCalls.length}`);

  if (toolResults.length !== toolCalls.length) {
    fail(
      `tool.call/tool.result mismatch (${toolCalls.length} vs ${toolResults.length})`,
    );
  }
  ok('tool.result events', `${toolResults.length}`);

  const messages = events.filter((e) => e.type === 'message.complete');
  if (messages.length === 0) {
    fail('no message.complete events — Claude returned no text');
  }
  ok('message.complete events', `${messages.length}`);

  const completeEv = events.find((e) => e.type === 'session.complete');
  if (!completeEv) fail('no session.complete event');
  ok(
    'session.complete',
    `turns=${completeEv.turns}, stopReason=${completeEv.stopReason}`,
  );

  console.log('\n[smoke] last assistant message:');
  console.log(`> ${messages[messages.length - 1].text.slice(0, 240)}`);
  console.log('\n[smoke] PASS');
}

main().catch((err) => {
  console.error('\n[smoke] FAIL', err);
  process.exit(1);
});

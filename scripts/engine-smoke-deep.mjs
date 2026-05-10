#!/usr/bin/env node
/**
 * Deep engine test:
 *   - chains multiple tool calls in one turn,
 *   - exercises tasks.create then tasks.list,
 *   - exercises plans.propose to confirm plan tooling reaches AiService.
 */
import crypto from 'node:crypto';

const BASE = (process.env.STACK62_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = `${BASE}/v1`;
const SUFFIX = crypto.randomBytes(3).toString('hex');
const EMAIL = `smoke+deep-${SUFFIX}@stack62.test`;
const PASSWORD = 'Smoke!Pass123';

function fail(label, detail) {
  console.error(`✗ ${label}`);
  if (detail !== undefined) console.error(typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 800));
  process.exit(1);
}
function ok(label, extra) {
  console.log(`✓ ${label}${extra ? ` — ${extra}` : ''}`);
}
async function jsonOrThrow(res, label) {
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) fail(`${label} (${res.status})`, body);
  return body;
}

async function runEngine(token, payload, deadlineMs = 90_000) {
  const res = await fetch(`${API}/engine/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) fail(`engine/run ${res.status}`, await res.text());
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`engine timeout (${deadlineMs}ms)`)),
      deadlineMs,
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
        const dl = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!dl) continue;
        const json = dl.slice(5).trim();
        if (!json) continue;
        try {
          const ev = JSON.parse(json);
          events.push(ev);
          if (ev.type === 'session.complete' || ev.type === 'session.error') return;
        } catch { /* */ }
      }
    }
  })();
  try { await Promise.race([drain, timeout]); } finally { clearTimeout(timeoutHandle); }
  return events;
}

async function main() {
  // Auth
  const reg = await jsonOrThrow(
    await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, firstName: 'Deep', lastName: 'Smoke' }),
    }),
    'register',
  );
  const token = reg.accessToken;
  ok('register', EMAIL);

  // Org/workspace
  const org = await jsonOrThrow(
    await fetch(`${API}/organizations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Deep Org ${SUFFIX}` }),
    }),
    'create org',
  );
  ok('org', org.id);

  const ws = await jsonOrThrow(
    await fetch(`${API}/workspaces`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: org.id, name: `Deep WS ${SUFFIX}` }),
    }),
    'create workspace',
  );
  ok('workspace', ws.id);

  // Test 1: Multi-tool chain — task create then list
  console.log('\n--- TEST 1: tasks.create then tasks.list ---');
  const events1 = await runEngine(token, {
    organizationId: org.id,
    workspaceId: ws.id,
    prompt:
      'Create a task titled "Smoke deadline check" with priority high, then list all tasks and tell me the title and status of the one you just created.',
  });
  const calls1 = events1.filter((e) => e.type === 'tool.call').map((e) => e.name);
  ok('event count', `${events1.length}`);
  ok('tool calls', calls1.join(', '));
  if (!calls1.includes('tasks.create')) fail('expected tasks.create call');
  if (!calls1.includes('tasks.list')) fail('expected tasks.list call');
  const last1 = events1.filter((e) => e.type === 'message.complete').pop();
  if (!last1) fail('no message.complete in test 1');
  if (!last1.text.toLowerCase().includes('smoke deadline check'))
    fail('assistant did not reference the task title in its reply', last1.text);
  ok('PASS test 1', `final: "${last1.text.slice(0, 100)}…"`);

  // Test 2: Plans.propose
  console.log('\n--- TEST 2: plans.propose for a new system ---');
  const events2 = await runEngine(token, {
    organizationId: org.id,
    workspaceId: ws.id,
    prompt:
      'Propose a plan to create a small "Inventory" system with a "Products" module containing Name (text), SKU (text), Quantity (number), Price (number).',
  });
  const calls2 = events2.filter((e) => e.type === 'tool.call').map((e) => e.name);
  const errEv2 = events2.find((e) => e.type === 'session.error');
  if (errEv2) fail('session.error', errEv2.message);
  ok('tool calls', calls2.join(', '));
  if (!calls2.includes('plans.propose'))
    fail('expected plans.propose call');
  const planResult = events2.find(
    (e) => e.type === 'tool.result' && e.name === 'plans.propose',
  );
  if (!planResult || !planResult.ok)
    fail('plans.propose failed', planResult);
  ok('PASS test 2', `plan ${planResult.output?.requestId ?? '?'} ${planResult.output?.status ?? ''}`);

  // Test 3: integrations.list (should return empty)
  console.log('\n--- TEST 3: integrations.list ---');
  const events3 = await runEngine(token, {
    organizationId: org.id,
    workspaceId: ws.id,
    prompt: 'What integrations are connected? Use the tool.',
  });
  const calls3 = events3.filter((e) => e.type === 'tool.call').map((e) => e.name);
  if (!calls3.includes('integrations.list')) fail('expected integrations.list call');
  ok('PASS test 3', calls3.join(', '));

  console.log('\n[deep smoke] ALL PASS');
}

main().catch((err) => {
  console.error('\n[deep smoke] FAIL', err);
  process.exit(1);
});

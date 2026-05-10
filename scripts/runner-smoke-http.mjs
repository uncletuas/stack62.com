#!/usr/bin/env node
/**
 * Full end-to-end smoke against a live Stack62 backend.
 *
 * Flow:
 *   login → pick org+workspace → create system → POST /runner/generate →
 *   POST /runner/deploy → poll until running → mint preview token →
 *   GET /sys/<id>/health via the proxy → assert { ok: true } → stop.
 *
 * Skips cleanly (exit 0) when STACK62_SMOKE_EMAIL / STACK62_SMOKE_PASSWORD
 * are not set, so it's safe to include in CI that may not always have creds.
 *
 * Environment:
 *   STACK62_BASE_URL        default http://localhost:3000
 *   STACK62_SMOKE_EMAIL     required for this to run
 *   STACK62_SMOKE_PASSWORD  required for this to run
 *   STACK62_SMOKE_PROMPT    optional; default "Simple greeting service"
 */

const BASE = (process.env.STACK62_BASE_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
);
const API = `${BASE}/v1`;
const EMAIL = process.env.STACK62_SMOKE_EMAIL;
const PASSWORD = process.env.STACK62_SMOKE_PASSWORD;
const PROMPT =
  process.env.STACK62_SMOKE_PROMPT ||
  'A minimal greeting service with /api/hello returning { message: "hi" }';

if (!EMAIL || !PASSWORD) {
  console.log(
    '[smoke-http] STACK62_SMOKE_EMAIL / STACK62_SMOKE_PASSWORD not set — skipping.',
  );
  process.exit(0);
}

function j(res) {
  return res.text().then((t) => {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  });
}

async function req(method, path, { token, body, qs } = {}) {
  const url = qs
    ? `${API}${path}?${new URLSearchParams(qs).toString()}`
    : `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'content-type': body ? 'application/json' : undefined,
      authorization: token ? `Bearer ${token}` : undefined,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await j(res);
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function pollUntilRunning(token, id, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const d = await req('GET', `/runner/deployments/${id}`, { token });
    if (d.status === 'running') return d;
    if (d.status === 'crashed') {
      throw new Error(`Deployment crashed: ${d.errorMessage}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Timeout waiting for deployment to become running');
}

async function run() {
  console.log(`[smoke-http] target: ${BASE}`);

  const login = await req('POST', '/auth/login', {
    body: { email: EMAIL, password: PASSWORD },
  });
  const token = login.accessToken;

  const orgs = await req('GET', '/organizations', { token });
  const org = Array.isArray(orgs) ? orgs[0] : orgs?.[0];
  if (!org) throw new Error('User has no organization');
  const workspaces = await req('GET', '/workspaces', {
    token,
    qs: { organizationId: org.id },
  });
  const ws = Array.isArray(workspaces) ? workspaces[0] : null;
  if (!ws) throw new Error('No workspace in organization');

  const system = await req('POST', '/systems', {
    token,
    body: {
      organizationId: org.id,
      workspaceId: ws.id,
      name: `smoke-${Date.now()}`,
      description: 'Runner smoke test',
    },
  });

  console.log(`[smoke-http] generating code for system ${system.id}…`);
  await req('POST', '/runner/generate', {
    token,
    body: {
      systemId: system.id,
      organizationId: org.id,
      workspaceId: ws.id,
      prompt: PROMPT,
    },
  });

  console.log('[smoke-http] deploying…');
  const deployment = await req('POST', '/runner/deploy', {
    token,
    body: {
      systemId: system.id,
      organizationId: org.id,
      workspaceId: ws.id,
    },
  });

  console.log('[smoke-http] polling status (up to 90s)…');
  const running = await pollUntilRunning(token, deployment.id);
  console.log(`[smoke-http] running on port ${running.port}`);

  const preview = await req(
    'POST',
    `/runner/deployments/${running.id}/preview-session`,
    { token },
  );
  const healthUrl = `${BASE}/sys/${running.id}/health?_t=${encodeURIComponent(
    preview.token,
  )}`;
  console.log(`[smoke-http] GET ${healthUrl}`);

  const healthRes = await fetch(healthUrl, { redirect: 'manual' });
  // The proxy may redirect on first query-token request — follow once manually.
  let body;
  if (healthRes.status >= 300 && healthRes.status < 400) {
    const location = healthRes.headers.get('location');
    const cookie = healthRes.headers.get('set-cookie') || '';
    const followed = await fetch(`${BASE}${location}`, {
      headers: { cookie },
    });
    body = await j(followed);
    if (followed.status !== 200) {
      throw new Error(
        `/health via proxy → ${followed.status}: ${JSON.stringify(body)}`,
      );
    }
  } else if (healthRes.ok) {
    body = await j(healthRes);
  } else {
    throw new Error(`/health via proxy → ${healthRes.status}`);
  }

  if (!body || body.ok !== true) {
    throw new Error(`Expected { ok: true }, got ${JSON.stringify(body)}`);
  }

  console.log('[smoke-http] stopping deployment…');
  await req('POST', `/runner/deployments/${running.id}/stop`, { token });

  console.log(
    '\n\x1b[32m✓ PASS\x1b[0m login → create system → generate → deploy → /sys/:id/health returned { ok: true }',
  );
}

run().catch((err) => {
  console.error(`\n\x1b[31m✗ FAIL\x1b[0m ${err.message}`);
  process.exit(1);
});

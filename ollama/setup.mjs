#!/usr/bin/env node
/**
 * Provision the Stack62 local intelligence stack on an Ollama server.
 *
 *   node ollama/setup.mjs
 *
 * What it does (idempotent — safe to re-run):
 *   1. Checks the Ollama server is reachable.
 *   2. Pulls the base instruct model + the embedding model.
 *   3. Builds the tailored `stack62-local` model from Modelfile.stack62-local.
 *   4. Prints the env vars to point Stack62 at it.
 *
 * Env:
 *   OLLAMA_HOST   default http://localhost:11434  (e.g. http://ollama:11434 in Docker)
 *   BASE_MODEL    default qwen2.5:7b-instruct
 *   EMBED_MODEL   default nomic-embed-text
 *   LOCAL_MODEL   default stack62-local
 *
 * Works against a remote Ollama too — everything goes over the HTTP API, so the
 * `ollama` CLI does NOT need to be installed on this machine.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
const BASE_MODEL = process.env.BASE_MODEL || 'qwen2.5:7b-instruct';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';
const LOCAL_MODEL = process.env.LOCAL_MODEL || 'stack62-local';
const here = dirname(fileURLToPath(import.meta.url));

function log(msg) {
  process.stdout.write(`${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`\n✖ ${msg}\n`);
  process.exit(1);
}

async function reachable() {
  try {
    const res = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Stream an NDJSON progress endpoint (pull/create) to the console. */
async function streamJob(path, body, label) {
  log(`→ ${label} …`);
  const res = await fetch(`${HOST}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`${label} failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let lastStatus = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.error) throw new Error(`${label}: ${obj.error}`);
      const status = obj.status || '';
      if (status && status !== lastStatus) {
        lastStatus = status;
        log(`   ${status}`);
      }
    }
  }
  log(`✓ ${label} done`);
}

async function modelExists(name) {
  try {
    const res = await fetch(`${HOST}/api/tags`);
    const data = await res.json();
    return (data.models || []).some(
      (m) => m.name === name || m.name === `${name}:latest`,
    );
  } catch {
    return false;
  }
}

async function main() {
  log(`Stack62 local model setup → ${HOST}\n`);

  if (!(await reachable())) {
    fail(
      `Cannot reach Ollama at ${HOST}.\n` +
        `  • Install Ollama: https://ollama.com/download\n` +
        `  • Start it (it serves on :11434), or set OLLAMA_HOST to your server.\n` +
        `  • In Docker: \`docker compose up -d ollama\` then re-run with` +
        ` OLLAMA_HOST=http://localhost:11434`,
    );
  }
  log('✓ Ollama reachable\n');

  await streamJob('/api/pull', { name: BASE_MODEL, stream: true }, `pull ${BASE_MODEL}`);
  await streamJob('/api/pull', { name: EMBED_MODEL, stream: true }, `pull ${EMBED_MODEL}`);

  const modelfile = readFileSync(join(here, 'Modelfile.stack62-local'), 'utf8');
  // /api/create accepts the full Modelfile text via `modelfile`. Pass both
  // `model` and `name` for compatibility across Ollama versions.
  await streamJob(
    '/api/create',
    { model: LOCAL_MODEL, name: LOCAL_MODEL, modelfile, stream: true },
    `create ${LOCAL_MODEL}`,
  );

  if (!(await modelExists(LOCAL_MODEL))) {
    fail(`Created ${LOCAL_MODEL} but it is not listed — check the Ollama logs.`);
  }

  log(`\n✓ All set. Point Stack62 at the local model with:`);
  log(`    OLLAMA_BASE_URL=${HOST}`);
  log(`    OLLAMA_MODEL=${LOCAL_MODEL}`);
  log(`    EMBEDDING_MODEL=${EMBED_MODEL}`);
  log(`    OPENAI_EMBEDDING_BASE_URL=${HOST}/v1`);
  log(`\nVerify behaviour with:  node ollama/evaluate.mjs`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));

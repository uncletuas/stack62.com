#!/usr/bin/env node
/**
 * Evaluate the local model against the exact behavioural contracts Stack62's
 * engine relies on. This is the "does the local brain actually work" check —
 * run it after setup, after changing the Modelfile, or after swapping models.
 *
 *   node ollama/evaluate.mjs
 *
 * Env:
 *   OLLAMA_HOST   default http://localhost:11434
 *   LOCAL_MODEL   default stack62-local
 *
 * Exits non-zero if the pass rate is below THRESHOLD, so it can gate CI / a
 * deploy step.
 */
const HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
const MODEL = process.env.LOCAL_MODEL || 'stack62-local';
const THRESHOLD = Number(process.env.EVAL_THRESHOLD || 0.8);

async function chat(messages, { json = false } = {}) {
  const res = await fetch(`${HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      ...(json ? { format: 'json' } : {}),
      options: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return (data.message?.content ?? '').trim();
}

/**
 * Each case: { name, run() → { pass, detail } }. Kept tolerant of normal model
 * variance — they catch a *broken* setup (wrong model, can't emit JSON, ignores
 * grounding), not stylistic nitpicks.
 */
const CASES = [
  {
    name: 'Tier-1 tool triage emits valid JSON with a tool field',
    async run() {
      const out = await chat(
        [
          {
            role: 'system',
            content:
              'You are a fast triage layer. Pick the single most appropriate ' +
              'read tool for the user prompt. Reply with ONLY a JSON object: ' +
              '{ "tool": { "name": "<tool>", "input": {} } | null, "reply": "<text>" }. ' +
              'Tools: files.list (list files), tasks.list (list tasks), ' +
              'systems.list (list systems).',
          },
          { role: 'user', content: 'show me my open tasks' },
        ],
        { json: true },
      );
      let obj;
      try {
        obj = JSON.parse(out);
      } catch {
        return { pass: false, detail: `not JSON: ${out.slice(0, 120)}` };
      }
      const ok =
        obj && 'tool' in obj && (obj.tool === null || typeof obj.tool === 'object');
      const picked = obj?.tool?.name;
      return {
        pass: Boolean(ok),
        detail: `tool=${picked ?? 'null'} (expected tasks.list-ish)`,
      };
    },
  },
  {
    name: 'Generative summarize returns only the result (no preamble)',
    async run() {
      const text =
        'Our Q3 review covered three areas. Sales grew 12% led by the new ' +
        'enterprise tier. Support ticket volume fell 8% after the docs ' +
        'revamp. Hiring is paused until Q4 except for two senior engineers.';
      const out = await chat([
        {
          role: 'system',
          content:
            'You are handling a summarize task. Return ONLY the summary — no ' +
            'preamble, no commentary.',
        },
        { role: 'user', content: `Summarize in one sentence:\n\n${text}` },
      ]);
      const lower = out.toLowerCase();
      const hasPreamble = /^(sure|here(?:'s| is)|okay|certainly|the summary)/.test(
        lower,
      );
      const reasonable = out.length > 15 && out.length < text.length;
      return {
        pass: !hasPreamble && reasonable,
        detail: hasPreamble ? `preamble: ${out.slice(0, 60)}` : `len=${out.length}`,
      };
    },
  },
  {
    name: 'Org-QA returns NEED_CONTEXT when the answer is absent',
    async run() {
      const out = await chat([
        {
          role: 'system',
          content:
            'Answer using ONLY the context. If the answer is not present, reply ' +
            'with the single token NEED_CONTEXT.\n\nContext: The team has 3 ' +
            'members: Ada (admin), Ben (staff), Cy (staff).',
        },
        { role: 'user', content: 'What is our refund policy?' },
      ]);
      return {
        pass: out.includes('NEED_CONTEXT'),
        detail: out.slice(0, 80),
      };
    },
  },
  {
    name: 'Org-QA answers correctly when grounded',
    async run() {
      const out = await chat([
        {
          role: 'system',
          content:
            'Answer using ONLY the context. If absent, reply NEED_CONTEXT.\n\n' +
            'Context: The team has 3 members: Ada (admin), Ben (staff), Cy (staff).',
        },
        { role: 'user', content: 'Who is the admin?' },
      ]);
      return {
        pass: /ada/i.test(out) && !out.includes('NEED_CONTEXT'),
        detail: out.slice(0, 80),
      };
    },
  },
  {
    name: 'Widget grounding: does not invent facts',
    async run() {
      const out = await chat([
        {
          role: 'system',
          content:
            'You are a website assistant. Answer ONLY from the context. If not ' +
            'covered, say you are not sure and offer to connect them with the ' +
            'team. Never invent prices.\n\nContext: Acme sells widgets. Hours ' +
            '9-5 Mon-Fri.',
        },
        { role: 'user', content: 'How much does a widget cost?' },
      ]);
      const invented = /\$\s?\d/.test(out);
      const deferred =
        /not sure|not (?:specified|listed|available|provided|mentioned)|don'?t (?:have|know)|could you|provide|more (?:info|detail)|reach out|contact|team|happy to help|unable to/i.test(
          out,
        );
      return {
        pass: !invented && deferred,
        detail: invented ? `invented price: ${out.slice(0, 60)}` : out.slice(0, 80),
      };
    },
  },
];

async function main() {
  process.stdout.write(`Evaluating ${MODEL} @ ${HOST}\n\n`);
  try {
    const res = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error('bad status');
  } catch {
    process.stderr.write(
      `✖ Cannot reach Ollama at ${HOST}. Run \`node ollama/setup.mjs\` first.\n`,
    );
    process.exit(1);
  }

  let passed = 0;
  for (const c of CASES) {
    try {
      const { pass, detail } = await c.run();
      if (pass) passed += 1;
      process.stdout.write(
        `${pass ? '✓' : '✗'} ${c.name}\n   ${detail}\n`,
      );
    } catch (err) {
      process.stdout.write(
        `✗ ${c.name}\n   ERROR: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  const rate = passed / CASES.length;
  process.stdout.write(
    `\n${passed}/${CASES.length} passed (${(rate * 100).toFixed(0)}%, threshold ${(THRESHOLD * 100).toFixed(0)}%)\n`,
  );
  if (rate < THRESHOLD) {
    process.stdout.write(
      `\nBelow threshold. Tips: ensure OLLAMA_MODEL=${MODEL}, the model finished ` +
        `pulling, and num_ctx in the Modelfile is large enough. A bigger base ` +
        `model (e.g. qwen2.5:14b-instruct) improves reliability.\n`,
    );
    process.exit(1);
  }
  process.stdout.write('\n✓ Local model meets the engine contracts.\n');
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

# Organizational Intelligence Layer — Testing Guide

This covers the new local-first cost-saving intelligence router, the org
knowledge layer, the budget governor, and the embeddable website widget.

## What's new (where to look)

- **Local-first router** — `src/modules/engine/intent-classifier.service.ts`
  (Tier 0 rules, Tier 1 local generative) + `src/modules/engine/engine.service.ts`
  (cache, Tier 1.5 org-knowledge, budget gate, provider-agnostic frontier).
- **OIL module** — `src/modules/org-intelligence/`: response cache, budget
  governor + spend ledger, org-context brief, observability endpoints.
- **Provider-agnostic LLM** — `src/modules/engine/llm/` (OpenAI primary).
- **Embeddable widget** — `src/modules/widget/`.

New tables auto-create on boot (`DATABASE_SYNC=true`): `ai_response_cache`,
`ai_spend_counters`, `widget_tokens`.

## 1. Prerequisites & boot

```bash
# Brings up Postgres, Redis, Ollama, API, worker. The one-shot `ollama-init`
# container pulls the base + embedding models AND builds the tailored
# `stack62-local` model from ollama/Modelfile.stack62-local (first run takes a
# few minutes).
docker compose up -d

# Confirm the models are present:
docker exec stack62-ollama ollama list   # expect stack62-local, qwen2.5:7b-instruct, nomic-embed-text
```

**Not using Docker?** Install Ollama (https://ollama.com/download), start it,
then provision + verify the local model from the host:

```bash
npm run ai:setup    # pulls base + embedding models, builds stack62-local
npm run ai:eval     # checks the model against the engine's task contracts
```

See [../ollama/README.md](../ollama/README.md) for tuning and the optional
real fine-tuning path.

Minimum `.env` for the **local-first + OpenAI-primary** setup:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...            # only used for high-level / frontier tasks
OPENAI_MODEL=gpt-4o
OPENAI_MODEL_CHEAP=gpt-4o-mini

# Local tier (the $0 path). docker-compose already points these at the ollama service.
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=stack62-local          # the tailored model built by ai:setup / ollama-init
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_DIMENSIONS=768
OPENAI_EMBEDDING_BASE_URL=http://ollama:11434/v1

STACK62_ROUTER_ENABLED=true
AI_RESPONSE_CACHE_ENABLED=true
AI_MONTHLY_BUDGET_USD=0          # 0 = unlimited; set low to test the governor
```

Get a JWT for the API calls below (use your normal login), and note your
`organizationId` / `workspaceId`. Examples assume:

```bash
API=http://localhost:3000/v1
TOKEN=<your-jwt>
ORG=<organizationId>
WS=<workspaceId>
```

## 2. Local routing at $0 (the core claim)

The engine streams Server-Sent Events; the first `session.routed` event shows
which tier handled the request. Anything tier 0/1 or `cache`/`org-knowledge`
never hit a paid API.

```bash
curl -N -X POST "$API/engine/run" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"organizationId":"'$ORG'","workspaceId":"'$WS'","prompt":"list my systems"}'
```

Try these and watch the `session.routed` `tier`/`reason`:

| Prompt | Expected route |
| --- | --- |
| `hi` | tier 0 (greeting), `$0` |
| `list my tasks` / `show files` | tier 0 tool, `$0` |
| `summarize: <paste a few paragraphs>` | tier 1 local generative, `$0` |
| `who is on the team?` | tier 1 org-knowledge (after a doc/team exists), `$0` |
| `build me a CRM for a clinic` | escalates to frontier (OpenAI) |

**Proof of $0:** before/after each local prompt, the `ai_request_logs` table
should gain **no** rows:

```bash
docker exec stack62-postgres psql -U postgres -d stack62 \
  -c "select count(*) from ai_request_logs;"
```

## 3. Response cache

Ask a non-trivial question that resolves to a single read (e.g. *"what systems
do we have running?"*). The first call may escalate to the frontier; **ask the
exact same thing again** — the second routes via `response cache (exact/…)` and
re-runs the underlying read live (fresh data, $0).

```bash
curl "$API/org-intelligence/cache/stats?organizationId=$ORG" -H "Authorization: Bearer $TOKEN"
# { "entries": N, "totalHits": M }   ← totalHits climbs on each cache replay
```

Clear it if needed:

```bash
curl -X POST "$API/org-intelligence/cache/invalidate" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"organizationId":"'$ORG'"}'
```

## 4. Budget governor

Set a tiny cap and restart so the gate is easy to trip:

```dotenv
AI_MONTHLY_BUDGET_USD=0.05
AI_BUDGET_WARN_RATIO=0.5
```

Send a few frontier-bound prompts (e.g. "build…"). Watch:

```bash
curl "$API/org-intelligence/budget?organizationId=$ORG" -H "Authorization: Bearer $TOKEN"
# { limitUsd, spentUsd, ratio, overBudget, nearLimit }
```

- Past `warnRatio` → the engine downgrades to `OPENAI_MODEL_CHEAP` (see the API
  log line `near budget cap — downgraded …`).
- At/over the cap → the chat returns the budget notice ("reached its monthly AI
  budget") with `stopReason: budget_exhausted`, and local tiers still work.

## 5. Embeddable website widget

### a. Mint a scoped token (admin)

```bash
curl -X POST "$API/widget/tokens" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "organizationId":"'$ORG'",
    "label":"Marketing site",
    "allowedOrigins":["http://localhost:5500"],
    "greeting":"Hi! Ask me about our products.",
    "knowledgeBase":"We are Acme Co. We sell widgets. Hours: 9-5 Mon-Fri. Returns accepted within 30 days.",
    "useDocumentSearch":false
  }'
# → response includes "token":"s62w_…"  (shown ONCE — copy it)
```

The widget answers ONLY from `knowledgeBase` (+ indexed docs if
`useDocumentSearch:true`). It has **no** access to CRM data or write actions.

### b. Embed it

Create `test.html` and serve it from an allowed origin
(`npx http-server -p 5500`, then open http://localhost:5500/test.html):

```html
<!doctype html><html><body>
  <h1>My site</h1>
  <script src="http://localhost:3000/v1/widget/loader.js"
          data-stack62-token="s62w_PASTE_TOKEN_HERE"
          data-title="Ask Acme"></script>
</body></html>
```

A chat bubble appears bottom-right. Ask *"what are your hours?"* → answered from
the knowledge base (locally/$0 when Ollama is up).

> CORS: the public widget endpoints reflect the request origin. Keep
> `CORS_ORIGIN=*` while testing, or ensure your global CORS allows the embedding
> site. `allowedOrigins` on the token is the per-widget enforcement.

### c. Manage tokens

```bash
curl "$API/widget/tokens?organizationId=$ORG" -H "Authorization: Bearer $TOKEN"   # list
curl -X DELETE "$API/widget/tokens/<id>" -H "Authorization: Bearer $TOKEN"        # revoke
```

## Cloud-only mode (no self-hosting)

Leave `OLLAMA_BASE_URL` unset and point embeddings at OpenAI
(`OPENAI_EMBEDDING_BASE_URL` unset → uses OpenRouter/OpenAI). The router then
skips the local tiers and relies on Tier 0 rules + cache + cheap-model routing.
Less saving, simpler ops.

## Known limitations / next

- Widget answers are non-streaming (one reply per turn) — fine for a v1.
- `useDocumentSearch` grounds on **all** indexed files; only enable it once
  you're indexing public-safe documents.
- Cache invalidation is TTL + manual (`/cache/invalidate`); it's freshness-safe
  by design (read tools replay live; replies are a pure function of the prompt).
- Not yet built: per-org fine-tuning (deferred Phase 2).

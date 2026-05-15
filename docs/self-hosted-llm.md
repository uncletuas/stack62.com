# Self-hosted LLM for Tier-0/1 routing (Phase 7)

Stack62's router has three tiers:

- **Tier 0** — regex / deterministic rules. Zero LLM calls, sub-ms.
- **Tier 1** — small model intent triage. Picks one read-only tool.
- **Tier 2/3** — Anthropic / OpenAI for tool-using reasoning + writes.

By default Tier-1 talks to a local [Ollama](https://ollama.com) box
over `OLLAMA_BASE_URL` (Ollama's native `/api/chat`). For production
the cheaper, faster, lower-blast-radius option is a self-hosted Llama
endpoint that speaks the OpenAI chat-completions protocol (vLLM, TGI,
LM Studio, Together, or any OpenAI-compatible gateway).

This doc explains how to flip the router to a self-hosted endpoint.

## What changes when you turn this on

- Tier-1 traffic (read-only list/search intents) stops paying per-token
  to OpenRouter/Anthropic. On a busy workspace this is the bulk of the
  router cost — most user prompts are "show my pending plans" or
  "list workflows".
- Tier-2 and Tier-3 keep going to Anthropic/OpenAI. The plan→diff
  reasoning, writes, and tool-using agentic loops still need the
  cloud frontier model.
- The router falls back to Tier-3 automatically if the self-hosted
  endpoint is unreachable. There is no hard dependency on it being
  up.

## Env vars to set

Set these on the **API service** (NOT the meeting-bot worker):

| Env | Required | What |
|---|---|---|
| `SELF_HOSTED_LLM_URL` | yes | Base URL of the OpenAI-compatible endpoint. Examples: `https://my-vllm.lambda.example/`, `https://api.together.xyz/`. Do not include `/v1/...` — the client appends `/v1/chat/completions`. |
| `SELF_HOSTED_LLM_MODEL` | yes | The model id the endpoint expects. e.g. `meta-llama/Llama-3.3-70B-Instruct` for vLLM, `meta-llama/Llama-3.3-70B-Instruct-Turbo` on Together. |
| `SELF_HOSTED_LLM_API_KEY` | optional | Bearer token. Required for hosted gateways (Together, OpenRouter). Omit for an in-VPC vLLM behind private networking. |

When `SELF_HOSTED_LLM_URL` is unset, the router falls back to
`OLLAMA_BASE_URL` / `OLLAMA_MODEL` (the old single-machine path).

## Recommended deployments

### Option A — vLLM on Lambda Labs / RunPod (best cost/perf)

For a workspace doing >50k Tier-1 calls/day, a dedicated H100 running
Llama-3.3-70B-Instruct in vLLM is ~$3-5k/month and easily out-throughputs
the equivalent OpenRouter spend.

1. Spin up an H100 instance.
2. Install vLLM:
   ```bash
   pip install vllm
   ```
3. Launch:
   ```bash
   vllm serve meta-llama/Llama-3.3-70B-Instruct \
     --host 0.0.0.0 \
     --port 8000 \
     --api-key $YOUR_RANDOM_KEY
   ```
4. Front it with Caddy/Nginx for TLS, or use Lambda's private
   networking to keep it off the public internet entirely.
5. Set `SELF_HOSTED_LLM_URL=https://your-vllm.example/`,
   `SELF_HOSTED_LLM_MODEL=meta-llama/Llama-3.3-70B-Instruct`,
   `SELF_HOSTED_LLM_API_KEY=$YOUR_RANDOM_KEY` on the API.

### Option B — Together AI (managed)

If you don't want to run GPUs, Together offers Llama-3.3-70B at
per-token pricing roughly 1/3 of OpenRouter's same model.

1. Get a Together API key.
2. Set:
   - `SELF_HOSTED_LLM_URL=https://api.together.xyz/`
   - `SELF_HOSTED_LLM_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo`
   - `SELF_HOSTED_LLM_API_KEY=<your together key>`

### Option C — OpenRouter (cheapest to test)

Already supported. The OpenAI client points at OpenRouter; this env
just gives the router a separate, smaller model for Tier 1. Useful
for A/B testing before standing up an H100.

## Verifying

After deploying with the new env:

1. Hit any Coworker prompt that triggers a list intent like
   "show my pending plans". The chat response should include a
   `tier=1, reason=local-model intent match` debug badge (visible in
   the engine log; you can also check `/v1/engine/last-call` if you
   wire that up).
2. Tail the API logs. You should see no Anthropic API call for that
   request — only a fetch to your `SELF_HOSTED_LLM_URL`.
3. For load testing, ramp up to 100 RPS against `/v1/coworker/chat`
   with synthetic list-class prompts. Tier-1 latency should be
   <800ms p95 against a warm H100, <1.5s p95 against Together.

## Falling back

The router runs `isAvailable()` against `/v1/models` with a 1.5s
timeout before every Tier-1 call (cached for 15s). If the self-hosted
endpoint is down, the classifier returns `tier=3, reason=local model
unavailable` and the prompt goes straight to Anthropic. **You will
not see user-visible errors** — just a transparent cost spike until
the endpoint is back.

## Why we don't just use Anthropic for everything

Tier-0/1 traffic is a long tail of "list X" and "find Y" prompts that
do not need 200B parameters of reasoning. A 70B Llama is more than
enough to pick between `plans.list`, `systems.list`, and
`workflows.list`. Paying Anthropic $0.015/1k input tokens for that
choice is the kind of bill that grows quietly until someone notices.

The split exists so Stack62 can scale to thousands of seats without
the marginal-cost-per-user creeping into bad-business-model territory.

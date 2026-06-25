# Stack62 local model (Ollama)

The on-premise model that powers Stack62's $0 local tiers: Tier-1 tool triage,
local generative drafting, Tier-1.5 org-knowledge answers, and the website
widget. Frontier models (OpenAI) are reserved for genuinely hard tasks.

## What "training" means here

Ollama **serves** models; it does not train them. Two ways to make the local
model work well for Stack62:

1. **Tailoring (this folder, no GPU needed).** `Modelfile.stack62-local` bakes
   in the right parameters (low temperature for stable routing, an 8k context
   window for the org brief) on top of a strong instruct base
   (`qwen2.5:7b-instruct`). The engine already sends a precise system prompt per
   task, so this is what reliably gets clean JSON + grounded answers. **This is
   the recommended path** and what `setup.mjs` provisions.
2. **True fine-tuning (optional, needs a GPU + dataset).** Train a LoRA adapter
   on your own labelled examples, export to GGUF, and import into Ollama. See
   [FINE-TUNING.md](./FINE-TUNING.md). Deferred Phase-2 work.

## Quick start

```bash
# 1. Install + start Ollama (https://ollama.com/download), or `docker compose up -d ollama`.
# 2. Pull base + embedding models and build the tailored model:
npm run ai:setup           # = node ollama/setup.mjs
# 3. Verify it meets the engine's behavioural contracts:
npm run ai:eval            # = node ollama/evaluate.mjs
```

Then point Stack62 at it (the docker-compose stack does this automatically):

```dotenv
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=stack62-local
EMBEDDING_MODEL=nomic-embed-text
OPENAI_EMBEDDING_BASE_URL=http://localhost:11434/v1
```

## Files

| File | Purpose |
| --- | --- |
| `Modelfile.stack62-local` | Tailored model definition (base + parameters + persona). |
| `setup.mjs` | Pull base/embedding models, build `stack62-local`. Idempotent. Honors `OLLAMA_HOST`. |
| `evaluate.mjs` | Run the engine's task contracts against the model; non-zero exit on failure. |
| `FINE-TUNING.md` | Optional real LoRA fine-tuning procedure. |

## Tuning notes

- **Reliability vs. size:** `qwen2.5:7b-instruct` is a strong default. If the
  eval is shaky on your hardware, bump to `qwen2.5:14b-instruct` (edit the
  `FROM` line) — slower, more accurate.
- **CPU vs. GPU:** runs on CPU; a GPU makes it ~10× faster. Enable the GPU block
  in `docker-compose.yml`.
- After editing the Modelfile, re-run `npm run ai:setup` then `npm run ai:eval`.

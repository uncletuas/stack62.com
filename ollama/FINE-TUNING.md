# Optional: real fine-tuning (LoRA → GGUF → Ollama)

This is the heavyweight path you can take **later** if tailoring
(`Modelfile.stack62-local`) isn't accurate enough for your domain. It needs a
GPU and a labelled dataset, which is why it's deferred — the tailored model
handles the routine tiers well without it.

> Don't start here. Run `npm run ai:setup && npm run ai:eval` first. Only
> fine-tune if the eval pass-rate is low on a model size you can afford to run.

## When it's worth it

- You want the local model to handle tasks the base model gets wrong even with a
  good prompt (e.g. your industry's jargon, a bespoke output format).
- You have ≥ a few hundred high-quality `(input → ideal output)` examples.
- You can run a GPU (a single 16–24 GB card handles a 7B QLoRA).

## 1. Build a dataset

Collect real Stack62 interactions you want the local model to nail, as JSONL
chat examples. The richest source is the `ai_request_logs` table (prompt/response
previews) plus the router's task contracts:

```jsonl
{"messages":[{"role":"system","content":"You are a fast triage layer..."},{"role":"user","content":"show me overdue invoices"},{"role":"assistant","content":"{\"tool\":{\"name\":\"data.query\",\"input\":{...}},\"reply\":\"...\"}"}]}
{"messages":[{"role":"system","content":"Summarize..."},{"role":"user","content":"..."},{"role":"assistant","content":"..."}]}
```

Curate hard: quality beats quantity. Hold out ~10% for evaluation.

## 2. Train a LoRA adapter

Use any standard trainer. [Unsloth](https://github.com/unslothai/unsloth) is the
simplest for a single GPU:

```python
# pip install unsloth
from unsloth import FastLanguageModel
model, tok = FastLanguageModel.from_pretrained("unsloth/Qwen2.5-7B-Instruct", load_in_4bit=True)
model = FastLanguageModel.get_peft_model(model, r=16, lora_alpha=16)
# ... load your JSONL, format with the chat template, run SFTTrainer ...
model.save_pretrained_gguf("stack62-tuned", tok, quantization_method="q4_k_m")
```

(Or axolotl / LLaMA-Factory — same idea: SFT a LoRA, merge, export GGUF.)

## 3. Import into Ollama

Point a Modelfile at the exported GGUF and keep the Stack62 parameters:

```dockerfile
# Modelfile.stack62-tuned
FROM ./stack62-tuned.Q4_K_M.gguf
PARAMETER temperature 0.2
PARAMETER num_ctx 8192
SYSTEM """You are Stack62's built-in local intelligence ..."""
```

```bash
ollama create stack62-tuned -f Modelfile.stack62-tuned
OLLAMA_MODEL=stack62-tuned node ollama/evaluate.mjs   # must beat the tailored baseline
```

## 4. Roll out

If the eval improves, set `OLLAMA_MODEL=stack62-tuned` for the API + worker and
redeploy. Re-train periodically as you accumulate more labelled data. Treat the
adapter as a versioned artifact (store the GGUF + the dataset snapshot).

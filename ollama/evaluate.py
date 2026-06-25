#!/usr/bin/env python3
"""Evaluate the local model against Stack62's engine contracts (stdlib only).

Mirrors evaluate.mjs but runs anywhere python3 exists — e.g. ON the EC2 box
against localhost:11434, so Ollama never needs external exposure:

    ssh ... 'OLLAMA_HOST=http://localhost:11434 LOCAL_MODEL=stack62-local python3 -' < ollama/evaluate.py

Exits non-zero if the pass rate is below EVAL_THRESHOLD.
"""
import json
import os
import re
import sys
import urllib.request

HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
MODEL = os.environ.get("LOCAL_MODEL", "stack62-local")
THRESHOLD = float(os.environ.get("EVAL_THRESHOLD", "0.8"))


def chat(messages, json_mode=False):
    body = {
        "model": MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": 0},
    }
    if json_mode:
        body["format"] = "json"
    req = urllib.request.Request(
        f"{HOST}/api/chat",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    return (data.get("message", {}).get("content") or "").strip()


def case_tool_triage():
    out = chat(
        [
            {
                "role": "system",
                "content": (
                    "You are a fast triage layer. Pick the single most appropriate "
                    "read tool for the user prompt. Reply with ONLY a JSON object: "
                    '{ "tool": { "name": "<tool>", "input": {} } | null, "reply": "<text>" }. '
                    "Tools: files.list, tasks.list, systems.list."
                ),
            },
            {"role": "user", "content": "show me my open tasks"},
        ],
        json_mode=True,
    )
    try:
        obj = json.loads(out)
    except Exception:
        return False, f"not JSON: {out[:120]}"
    ok = isinstance(obj, dict) and "tool" in obj and (obj["tool"] is None or isinstance(obj["tool"], dict))
    picked = (obj.get("tool") or {}).get("name") if isinstance(obj.get("tool"), dict) else None
    return ok, f"tool={picked} (expected tasks.list-ish)"


def case_summarize():
    text = (
        "Our Q3 review covered three areas. Sales grew 12% led by the new "
        "enterprise tier. Support ticket volume fell 8% after the docs revamp. "
        "Hiring is paused until Q4 except for two senior engineers."
    )
    out = chat([
        {"role": "system", "content": "You are handling a summarize task. Return ONLY the summary — no preamble."},
        {"role": "user", "content": f"Summarize in one sentence:\n\n{text}"},
    ])
    preamble = re.match(r"^(sure|here(?:'s| is)|okay|certainly|the summary)", out.lower())
    reasonable = 15 < len(out) < len(text)
    return (not preamble and reasonable), (f"preamble: {out[:60]}" if preamble else f"len={len(out)}")


def case_need_context():
    out = chat([
        {"role": "system", "content": "Answer using ONLY the context. If absent, reply with the single token NEED_CONTEXT.\n\nContext: The team has 3 members: Ada (admin), Ben (staff), Cy (staff)."},
        {"role": "user", "content": "What is our refund policy?"},
    ])
    return ("NEED_CONTEXT" in out), out[:80]


def case_grounded():
    out = chat([
        {"role": "system", "content": "Answer using ONLY the context. If absent, reply NEED_CONTEXT.\n\nContext: The team has 3 members: Ada (admin), Ben (staff), Cy (staff)."},
        {"role": "user", "content": "Who is the admin?"},
    ])
    return (bool(re.search(r"ada", out, re.I)) and "NEED_CONTEXT" not in out), out[:80]


def case_widget_grounding():
    out = chat([
        {"role": "system", "content": "You are a website assistant. Answer ONLY from the context. If not covered, say you are not sure and offer to connect them with the team. Never invent prices.\n\nContext: Acme sells widgets. Hours 9-5 Mon-Fri."},
        {"role": "user", "content": "How much does a widget cost?"},
    ])
    invented = bool(re.search(r"\$\s?\d", out))
    # "Deferred" = it didn't make up a price and signalled it doesn't know /
    # asked for more / pointed to the team.
    deferred = bool(
        re.search(
            r"not sure|not (?:specified|listed|available|provided|mentioned)|"
            r"don'?t (?:have|know)|could you|provide|more (?:info|detail)|"
            r"reach out|contact|team|happy to help|unable to",
            out,
            re.I,
        )
    )
    return (not invented and deferred), (f"invented: {out[:60]}" if invented else out[:80])


CASES = [
    ("Tier-1 tool triage emits valid JSON with a tool field", case_tool_triage),
    ("Generative summarize returns only the result (no preamble)", case_summarize),
    ("Org-QA returns NEED_CONTEXT when answer is absent", case_need_context),
    ("Org-QA answers correctly when grounded", case_grounded),
    ("Widget grounding: does not invent facts", case_widget_grounding),
]


def main():
    print(f"Evaluating {MODEL} @ {HOST}\n")
    passed = 0
    for name, fn in CASES:
        try:
            ok, detail = fn()
            passed += 1 if ok else 0
            print(f"{'PASS' if ok else 'FAIL'} {name}\n     {detail}")
        except Exception as e:
            print(f"FAIL {name}\n     ERROR: {e}")
    rate = passed / len(CASES)
    print(f"\n{passed}/{len(CASES)} passed ({rate*100:.0f}%, threshold {THRESHOLD*100:.0f}%)")
    sys.exit(0 if rate >= THRESHOLD else 1)


if __name__ == "__main__":
    main()
